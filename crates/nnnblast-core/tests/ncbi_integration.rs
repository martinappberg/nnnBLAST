//! Integration tests that hit NCBI's live API.
//!
//! These tests are `#[ignore]` by default — they require network access and
//! NCBI credentials. Run with:
//!
//!   NCBI_API_KEY=... NCBI_EMAIL=... cargo test --test ncbi_integration -- --ignored --test-threads=1
//!
//! Using `--test-threads=1` avoids concurrent NCBI requests that could trigger
//! rate limiting between tests.

use nnnblast_core::ncbi;
use nnnblast_core::query::parse_query;
use nnnblast_core::search::search_ncbi;
use nnnblast_core::types::{JobProgress, NcbiParams, ProgressHandle, SearchParams};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

fn get_api_key() -> Option<String> {
    std::env::var("NCBI_API_KEY").ok()
}

fn get_email() -> String {
    std::env::var("NCBI_EMAIL").unwrap_or_else(|_| "test@example.com".into())
}

fn make_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap()
}

// ─── efetch tests ───

#[tokio::test]
#[ignore]
async fn efetch_returns_valid_fasta() {
    let client = make_client();
    let start = Instant::now();

    let result = ncbi::fetch_region(
        &client,
        "NC_000001.11", // Human chromosome 1
        10000,
        10500,
        get_api_key().as_deref(),
        &get_email(),
    )
    .await;

    let elapsed = start.elapsed();

    assert!(result.is_ok(), "efetch failed: {:?}", result.err());
    let seq = result.unwrap();
    assert!(seq.len() > 400, "expected ~500bp, got {}", seq.len());
    assert!(
        seq.iter()
            .all(|&b| b"ACGTNacgtn".contains(&b)),
        "unexpected bases in sequence"
    );
    assert!(
        elapsed < Duration::from_secs(30),
        "efetch too slow: {:?}",
        elapsed
    );
}

#[tokio::test]
#[ignore]
async fn efetch_batch_timing_regression() {
    // Fetch 5 regions sequentially and verify total time is reasonable.
    // This is the core performance regression guard — if NCBI access
    // gets slower or our rate-limit handling regresses, this catches it.
    let client = make_client();
    let accessions: Vec<(&str, usize, usize)> = vec![
        ("NC_000001.11", 10000, 10500),
        ("NC_000002.12", 20000, 20500),
        ("NC_000003.12", 30000, 30500),
        ("NC_000004.12", 40000, 40500),
        ("NC_000005.10", 50000, 50500),
    ];

    let start = Instant::now();
    for (acc, s, e) in &accessions {
        let result = ncbi::fetch_region(
            &client,
            acc,
            *s,
            *e,
            get_api_key().as_deref(),
            &get_email(),
        )
        .await;
        assert!(
            result.is_ok(),
            "efetch failed for {}: {:?}",
            acc,
            result.err()
        );
        // Respect NCBI rate limit between sequential requests
        tokio::time::sleep(Duration::from_millis(110)).await;
    }
    let elapsed = start.elapsed();

    // 5 fetches with 110ms spacing should complete in under 30 seconds
    assert!(
        elapsed < Duration::from_secs(30),
        "batch efetch too slow: {:?} (expected < 30s)",
        elapsed
    );
}

// ─── BLAST submit + poll tests ───

#[tokio::test]
#[ignore]
async fn blast_submit_and_poll() {
    let client = make_client();

    // 16S rRNA V4 forward primer — well-characterized, guaranteed to find hits
    let rid = ncbi::submit_blast(
        &client,
        "GTGCCAGCAGCCGCGGTAA",
        "core_nt",
        &get_email(),
        get_api_key().as_deref(),
        100000.0,
        10, // small hit count for speed
    )
    .await
    .expect("BLAST submission failed");

    assert!(!rid.is_empty(), "RID should not be empty");

    let (hits, db_size) = ncbi::poll_blast_results(&client, &rid, get_api_key().as_deref())
        .await
        .expect("BLAST polling failed");

    assert!(db_size > 0, "database size should be > 0");
    assert!(
        !hits.is_empty(),
        "should find hits for 16S V4 forward primer"
    );

    // Verify hit structure
    let first = &hits[0];
    assert!(!first.accession.is_empty());
    assert!(first.hit_from > 0);
    assert!(first.hit_to > 0);
    assert!(
        first.strand == '+' || first.strand == '-',
        "strand should be + or -, got {}",
        first.strand
    );
}

// ─── Full pipeline test ───

#[tokio::test]
#[ignore]
async fn full_pipeline_16s_v4_region() {
    // End-to-end test with the canonical 16S V4 primers that the user tests with.
    // This is the same query from the bug report.
    let parsed = parse_query("GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC")
        .expect("query parse failed");

    let params = SearchParams {
        query: parsed,
        max_mismatches: 2,
        evalue_cutoff: 10.0,
        match_score: 2,
        mismatch_score: -3,
        rna_mode: false,
    };

    let ncbi_params = NcbiParams {
        database: "core_nt".into(),
        email: get_email(),
        api_key: get_api_key(),
        max_blast_hits: 20, // small for integration test speed
    };

    let progress: ProgressHandle = Arc::new(RwLock::new(JobProgress {
        stage: "starting".into(),
        detail: None,
    }));

    let start = Instant::now();
    let results = search_ncbi(&params, &ncbi_params, progress)
        .await
        .expect("search_ncbi failed");
    let elapsed = start.elapsed();

    assert!(results.database_size > 0);
    // 16S V4 region is extremely well-conserved — should always find hits
    assert!(
        !results.hits.is_empty(),
        "16S V4 query should find structured hits"
    );

    // Timing: full pipeline should complete in under 10 minutes
    assert!(
        elapsed < Duration::from_secs(600),
        "pipeline took {:?} (expected < 10 min)",
        elapsed
    );

    // Verify E-values are valid
    for hit in &results.hits {
        assert!(hit.evalue.is_finite(), "E-value should be finite");
        assert!(hit.evalue >= 0.0, "E-value should be non-negative");
        assert!(hit.bit_score.is_finite(), "bit score should be finite");
    }

    // Verify hits are sorted by E-value
    for w in results.hits.windows(2) {
        assert!(
            w[0].evalue <= w[1].evalue,
            "hits should be sorted by E-value: {} > {}",
            w[0].evalue,
            w[1].evalue
        );
    }
}
