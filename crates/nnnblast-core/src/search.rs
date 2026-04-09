use crate::align::align_motif_in_window;
use crate::index::Database;
use crate::ncbi::{self, NcbiError};
use crate::stats::{compute_evalue, estimate_base_frequencies, raw_to_bit_score};
use crate::types::{
    reverse_complement, select_anchor, Hit,
    MotifAlignment, NcbiParams, ProgressHandle, SearchParams, SearchResults,
};
use rayon::prelude::*;
use std::collections::HashSet;

/// Build a composite BLAST query: motifs joined by N-wildcards (min gap size).
/// Returns the composite sequence and the anchor offset within it.
fn build_composite_query(query: &crate::types::StructuredQuery) -> (String, usize) {
    let mut composite = String::new();
    let anchor_idx = select_anchor(query);
    let mut anchor_offset = 0;

    for (i, motif) in query.motifs.iter().enumerate() {
        if i == anchor_idx {
            anchor_offset = composite.len();
        }
        let motif_str: String = motif.sequence.iter().map(|&b| b as char).collect();
        composite.push_str(&motif_str);
        if i < query.gaps.len() {
            // Insert N's for minimum gap
            for _ in 0..query.gaps[i].min {
                composite.push('N');
            }
        }
    }
    (composite, anchor_offset)
}

/// Determine the best BLAST strategy based on query characteristics.
enum BlastStrategy {
    /// BLAST just the anchor motif (long enough on its own)
    SingleAnchor { anchor_idx: usize, sequence: String },
    /// Build composite query: motifs + N-gaps (all motifs short, gaps small)
    Composite { sequence: String, anchor_idx: usize },
    /// BLAST each motif independently as multi-FASTA, intersect results
    MultiMotif { sequences: Vec<(usize, String)> },
}

fn choose_blast_strategy(query: &crate::types::StructuredQuery) -> BlastStrategy {
    let anchor_idx = select_anchor(query);
    let anchor_len = query.motifs[anchor_idx].sequence.len();
    let anchor_seq: String = query.motifs[anchor_idx]
        .sequence
        .iter()
        .map(|&b| b as char)
        .collect();

    // Case 1: Anchor is long enough on its own (>= 18bp)
    if anchor_len >= 18 {
        return BlastStrategy::SingleAnchor {
            anchor_idx,
            sequence: anchor_seq,
        };
    }

    // For shorter anchors, consider composite or multi-motif
    let total_max_gap: usize = query.gaps.iter().map(|g| g.max).sum();
    let total_min_gap: usize = query.gaps.iter().map(|g| g.min).sum();
    let total_motif_len: usize = query.motifs.iter().map(|m| m.sequence.len()).sum();

    // Case 2: Gaps are small enough for composite (total composite <= 200bp)
    // Composite uses min gaps as N-wildcards, creating a single BLAST query
    let composite_len = total_motif_len + total_min_gap;
    if composite_len >= 12 && total_min_gap <= 100 && query.motifs.len() > 1 {
        let (composite, _) = build_composite_query(query);
        return BlastStrategy::Composite {
            sequence: composite,
            anchor_idx,
        };
    }

    // Case 3: Gaps too large or single motif — BLAST motifs independently
    if query.motifs.len() > 1 && total_max_gap > 100 {
        let sequences: Vec<(usize, String)> = query
            .motifs
            .iter()
            .enumerate()
            .filter(|(_, m)| m.sequence.len() >= 7) // skip motifs too short even for BLAST
            .map(|(i, m)| {
                let seq: String = m.sequence.iter().map(|&b| b as char).collect();
                (i, seq)
            })
            .collect();
        if sequences.len() >= 2 {
            return BlastStrategy::MultiMotif { sequences };
        }
    }

    // Fallback: just BLAST the anchor
    BlastStrategy::SingleAnchor {
        anchor_idx,
        sequence: anchor_seq,
    }
}

/// NCBI-backed structured motif search.
///
/// Pipeline:
/// 1. Choose BLAST strategy based on motif lengths and gap sizes
/// 2. BLAST against NCBI, poll for results
/// 3. For each hit: fetch flanking region via Efetch
/// 4. Run local motif extension
/// 5. Score, deduplicate, rank
pub async fn search_ncbi(
    params: &SearchParams,
    ncbi_params: &NcbiParams,
    progress: ProgressHandle,
) -> Result<SearchResults, NcbiError> {
    let query = &params.query;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    // Step 1: Choose strategy
    let strategy = choose_blast_strategy(query);
    let anchor_idx = select_anchor(query);

    // Step 2: BLAST
    update_progress(&progress, "submitting_blast", None).await;

    let (blast_hits, db_size) = match &strategy {
        BlastStrategy::SingleAnchor { sequence, .. } => {
            update_progress(
                &progress,
                "submitting_blast",
                Some(format!("Anchor: {} ({}bp)", sequence, sequence.len())),
            )
            .await;
            let rid = ncbi::submit_blast(
                &client,
                sequence,
                &ncbi_params.database,
                &ncbi_params.email,
                ncbi_params.api_key.as_deref(),
                100000.0, // very permissive — BLAST is just the coarse filter
                ncbi_params.max_blast_hits,
            )
            .await?;
            update_progress(
                &progress,
                "waiting_for_blast",
                Some(format!("RID: {}", rid)),
            )
            .await;
            ncbi::poll_blast_results(&client, &rid, ncbi_params.api_key.as_deref()).await?
        }
        BlastStrategy::Composite { sequence, .. } => {
            update_progress(
                &progress,
                "submitting_blast",
                Some(format!("Composite query: {}bp (motifs + N-gaps)", sequence.len())),
            )
            .await;
            let rid = ncbi::submit_blast(
                &client,
                sequence,
                &ncbi_params.database,
                &ncbi_params.email,
                ncbi_params.api_key.as_deref(),
                100000.0, // very permissive — our structured E-value does real filtering
                ncbi_params.max_blast_hits,
            )
            .await?;
            update_progress(
                &progress,
                "waiting_for_blast",
                Some(format!("RID: {}", rid)),
            )
            .await;
            ncbi::poll_blast_results(&client, &rid, ncbi_params.api_key.as_deref()).await?
        }
        BlastStrategy::MultiMotif { sequences } => {
            // Build multi-FASTA query
            let multi_fasta: String = sequences
                .iter()
                .map(|(i, seq)| format!(">motif_{}\n{}", i, seq))
                .collect::<Vec<_>>()
                .join("\n");
            update_progress(
                &progress,
                "submitting_blast",
                Some(format!("{} motifs as multi-FASTA", sequences.len())),
            )
            .await;
            let rid = ncbi::submit_blast(
                &client,
                &multi_fasta,
                &ncbi_params.database,
                &ncbi_params.email,
                ncbi_params.api_key.as_deref(),
                100000.0, // very permissive — our structured E-value does real filtering
                ncbi_params.max_blast_hits,
            )
            .await?;
            update_progress(
                &progress,
                "waiting_for_blast",
                Some(format!("RID: {} ({} motifs)", rid, sequences.len())),
            )
            .await;
            ncbi::poll_blast_results(&client, &rid, ncbi_params.api_key.as_deref()).await?
        }
    };

    // Step 3: Filter hits
    let candidates = blast_hits;
    tracing::info!(
        "BLAST returned {} hits, db_size={}",
        candidates.len(),
        db_size
    );
    for (i, h) in candidates.iter().take(3).enumerate() {
        tracing::info!(
            "  BLAST hit {}: {} {}..{} strand={} score={} evalue={}",
            i, h.accession, h.hit_from, h.hit_to, h.strand, h.score, h.evalue
        );
    }

    if candidates.is_empty() {
        return Ok(SearchResults {
            hits: vec![],
            database_size: db_size,
            num_sequences: 0,
            query_info: "0 BLAST hits".into(),
        });
    }

    // Step 4: Fetch flanking regions and check ALL motifs
    //
    // For every BLAST hit, we fetch a region large enough to contain the
    // full structured pattern, then scan it with our local search to find
    // all motifs within gap constraints.
    //
    // The fetch window must be wide enough regardless of which motif or
    // composite the BLAST hit corresponds to.
    let total_query_span: usize = query.motifs.iter().map(|m| m.sequence.len()).sum::<usize>()
        + query.gaps.iter().map(|g| g.max).sum::<usize>();
    // Add generous padding (the BLAST hit might be for any motif or composite)
    let padding = total_query_span + 50;

    let total_candidates = candidates.len();
    let mut structured_hits: Vec<Hit> = Vec::new();

    let delay = if ncbi_params.api_key.is_some() {
        std::time::Duration::from_millis(100)
    } else {
        std::time::Duration::from_millis(350)
    };

    for (i, blast_hit) in candidates.iter().enumerate() {
        update_progress(
            &progress,
            "fetching_regions",
            Some(format!("{}/{}", i + 1, total_candidates)),
        )
        .await;

        // Fetch a wide region around the BLAST hit
        let fetch_start = blast_hit.hit_from.saturating_sub(padding).max(1);
        let fetch_end = blast_hit.hit_to + padding;

        let region = match ncbi::fetch_region(
            &client,
            &blast_hit.accession,
            fetch_start,
            fetch_end,
            ncbi_params.api_key.as_deref(),
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    "Failed to fetch region for {}: {}",
                    blast_hit.accession,
                    e
                );
                tokio::time::sleep(delay).await;
                continue;
            }
        };

        tracing::info!(
            "  Fetched {} bp for {} ({}..{})",
            region.len(),
            blast_hit.accession,
            fetch_start,
            fetch_end
        );
        if region.len() < 50 {
            tracing::warn!("  Region too short, skipping");
            tokio::time::sleep(delay).await;
            continue;
        }

        // Scan the fetched region for the full structured pattern
        let mut region_hits =
            search_strand(&blast_hit.accession, &region, '+', params, anchor_idx);
        let rc = reverse_complement(&region);
        region_hits.extend(search_strand(
            &blast_hit.accession,
            &rc,
            '-',
            params,
            anchor_idx,
        ));

        tracing::info!(
            "  Local scan found {} structured hits in region",
            region_hits.len()
        );

        for mut hit in region_hits {
            hit.genomic_start = fetch_start;
            hit.genomic_end = fetch_end;
            structured_hits.push(hit);
        }

        tokio::time::sleep(delay).await;
    }

    // Step 5: Score, deduplicate, rank
    update_progress(&progress, "analyzing", None).await;

    let base_freqs = [0.25f64; 4]; // uniform for large databases

    // Compute E-values
    for hit in &mut structured_hits {
        let motif_scores: Vec<i32> = hit.motif_alignments.iter().map(|ma| ma.score).collect();
        hit.evalue = compute_evalue(
            query,
            &motif_scores,
            db_size,
            1, // num_sequences not used for NCBI mode
            params.match_score,
            params.mismatch_score,
            &base_freqs,
        );
        hit.bit_score = raw_to_bit_score(hit.total_score);
    }

    // Filter by E-value
    structured_hits.retain(|h| h.evalue <= params.evalue_cutoff);

    // Deduplicate: same accession + strand + similar start position
    deduplicate_hits(&mut structured_hits);

    // Sort by E-value
    structured_hits.sort_by(|a, b| a.evalue.partial_cmp(&b.evalue).unwrap());

    let query_info = format!(
        "{} motifs, {} gaps, anchor=motif[{}], {} BLAST candidates, {} structured hits, db={}",
        query.motifs.len(),
        query.gaps.len(),
        anchor_idx,
        total_candidates,
        structured_hits.len(),
        ncbi_params.database,
    );

    Ok(SearchResults {
        hits: structured_hits,
        database_size: db_size,
        num_sequences: total_candidates,
        query_info,
    })
}

/// Deduplicate hits on the same accession+strand with overlapping positions.
fn deduplicate_hits(hits: &mut Vec<Hit>) {
    let mut seen: HashSet<String> = HashSet::new();
    hits.retain(|hit| {
        let first_start = hit
            .motif_alignments
            .first()
            .map(|a| a.subject_start)
            .unwrap_or(0);
        let key = format!("{}:{}:{}", hit.subject_id, hit.strand, first_start / 10);
        seen.insert(key)
    });
}

// ─── Local search (reused from original implementation) ───

/// Run a structured motif search against a local FASTA database.
pub fn search_local(db: &Database, params: &SearchParams) -> SearchResults {
    let query = &params.query;
    if query.motifs.is_empty() {
        return SearchResults {
            hits: vec![],
            database_size: db.total_bases,
            num_sequences: db.sequences.len(),
            query_info: "Empty query".into(),
        };
    }

    let seq_refs: Vec<&[u8]> = db.sequences.iter().map(|s| s.sequence.as_slice()).collect();
    let base_freqs = estimate_base_frequencies(&seq_refs);
    let anchor_idx = select_anchor(query);

    let all_hits: Vec<Hit> = db
        .sequences
        .par_iter()
        .flat_map(|subject| {
            let mut hits = Vec::new();
            hits.extend(search_strand(
                &subject.id,
                &subject.sequence,
                '+',
                params,
                anchor_idx,
            ));
            let rc = reverse_complement(&subject.sequence);
            hits.extend(search_strand(&subject.id, &rc, '-', params, anchor_idx));
            hits
        })
        .collect();

    let mut hits_with_evalue: Vec<Hit> = all_hits
        .into_iter()
        .map(|mut hit| {
            let motif_scores: Vec<i32> = hit.motif_alignments.iter().map(|ma| ma.score).collect();
            hit.evalue = compute_evalue(
                query,
                &motif_scores,
                db.total_bases,
                db.sequences.len(),
                params.match_score,
                params.mismatch_score,
                &base_freqs,
            );
            hit.bit_score = raw_to_bit_score(hit.total_score);
            hit
        })
        .filter(|hit| hit.evalue <= params.evalue_cutoff)
        .collect();

    hits_with_evalue.sort_by(|a, b| a.evalue.partial_cmp(&b.evalue).unwrap());

    SearchResults {
        hits: hits_with_evalue,
        database_size: db.total_bases,
        num_sequences: db.sequences.len(),
        query_info: format!(
            "{} motifs, {} gaps, anchor=motif[{}]",
            query.motifs.len(),
            query.gaps.len(),
            anchor_idx
        ),
    }
}

fn search_strand(
    subject_id: &str,
    subject: &[u8],
    strand: char,
    params: &SearchParams,
    anchor_idx: usize,
) -> Vec<Hit> {
    let query = &params.query;
    let anchor = &query.motifs[anchor_idx];
    let anchor_len = anchor.sequence.len();
    let max_mm = anchor.max_mismatches.unwrap_or(params.max_mismatches);

    if subject.len() < anchor_len {
        return vec![];
    }

    let mut hits = Vec::new();

    for pos in 0..=(subject.len() - anchor_len) {
        let anchor_alignment = crate::align::align_motif_in_window(
            anchor,
            anchor_idx,
            subject,
            pos,
            pos + anchor_len,
            params.match_score,
            params.mismatch_score,
            max_mm,
        );

        let anchor_aln = match anchor_alignment {
            Some(a) => a,
            None => continue,
        };

        if let Some(hit) = extend_from_anchor(
            subject_id, subject, strand, params, anchor_idx, &anchor_aln,
        ) {
            hits.push(hit);
        }
    }

    hits
}

/// Given an anchor hit, try to find all flanking motifs within gap constraints.
/// Shared between NCBI and local search modes.
pub fn extend_from_anchor(
    subject_id: &str,
    subject: &[u8],
    strand: char,
    params: &SearchParams,
    anchor_idx: usize,
    anchor_aln: &MotifAlignment,
) -> Option<Hit> {
    let query = &params.query;
    let k = query.motifs.len();
    let mut alignments: Vec<Option<MotifAlignment>> = vec![None; k];
    alignments[anchor_idx] = Some(anchor_aln.clone());

    // Extend right from anchor
    let mut prev_end = anchor_aln.subject_start + query.motifs[anchor_idx].sequence.len();
    for i in (anchor_idx + 1)..k {
        let gap = &query.gaps[i - 1];
        let motif = &query.motifs[i];
        let max_mm = motif.max_mismatches.unwrap_or(params.max_mismatches);

        let window_start = prev_end + gap.min;
        let window_end = prev_end + gap.max + motif.sequence.len();

        let aln = align_motif_in_window(
            motif,
            i,
            subject,
            window_start,
            window_end,
            params.match_score,
            params.mismatch_score,
            max_mm,
        )?;

        prev_end = aln.subject_start + motif.sequence.len();
        alignments[i] = Some(aln);
    }

    // Extend left from anchor
    let mut prev_start = anchor_aln.subject_start;
    for i in (0..anchor_idx).rev() {
        let gap = &query.gaps[i];
        let motif = &query.motifs[i];
        let max_mm = motif.max_mismatches.unwrap_or(params.max_mismatches);
        let motif_len = motif.sequence.len();

        let window_end = prev_start.checked_sub(gap.min)?;
        let window_start = prev_start
            .saturating_sub(gap.max + motif_len);

        let aln = align_motif_in_window(
            motif,
            i,
            subject,
            window_start,
            window_end,
            params.match_score,
            params.mismatch_score,
            max_mm,
        )?;

        prev_start = aln.subject_start;
        alignments[i] = Some(aln);
    }

    let motif_alignments: Vec<MotifAlignment> =
        alignments.into_iter().collect::<Option<Vec<_>>>()?;

    let total_score: i32 = motif_alignments.iter().map(|a| a.score).sum();

    Some(Hit {
        subject_id: subject_id.to_string(),
        strand,
        motif_alignments,
        total_score,
        evalue: 0.0,
        bit_score: 0.0,
        genomic_start: 0,
        genomic_end: 0,
    })
}

async fn update_progress(handle: &ProgressHandle, stage: &str, detail: Option<String>) {
    let mut p = handle.write().await;
    p.stage = stage.to_string();
    p.detail = detail;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::parse_query;

    fn make_db(seqs: &[(&str, &str)]) -> Database {
        let fasta: String = seqs
            .iter()
            .map(|(id, seq)| format!(">{}\n{}\n", id, seq))
            .collect();
        Database::from_fasta_str(&fasta)
    }

    #[test]
    fn find_exact_structured_hit() {
        let subject = format!(
            "AAAA{}{}{}{}{}AAAA",
            "AGGAGG", "CCCCCCCCCC", "ATCGATCG", "TTTTTTTTTTTTTTT", "AGGCC",
        );
        let db = make_db(&[("test_seq", &subject)]);
        let query = parse_query("AGGAGG[N:5-15]ATCGATCG[N:10-20]AGGCC").unwrap();
        let params = SearchParams {
            query,
            max_mismatches: 0,
            evalue_cutoff: 1e10,
            match_score: 2,
            mismatch_score: -3,
            rna_mode: false,
        };
        let results = search_local(&db, &params);
        assert!(!results.hits.is_empty());
        assert_eq!(results.hits[0].total_score, 38);
    }

    #[test]
    fn find_with_mismatches() {
        let subject = format!("AAAA{}{}{}AAAA", "AAGAGG", "CCCCC", "ATCGATCG");
        let db = make_db(&[("test_seq", &subject)]);
        let query = parse_query("AGGAGG[N:3-7]ATCGATCG").unwrap();
        let params = SearchParams {
            query,
            max_mismatches: 1,
            evalue_cutoff: 1e10,
            match_score: 2,
            mismatch_score: -3,
            rna_mode: false,
        };
        let results = search_local(&db, &params);
        assert!(!results.hits.is_empty());
    }

    #[test]
    fn no_hit_outside_gap_range() {
        let subject = format!("AAAA{}{}{}AAAA", "AGGAGG", "A".repeat(30), "ATCGATCG");
        let db = make_db(&[("test_seq", &subject)]);
        let query = parse_query("AGGAGG[N:5-15]ATCGATCG").unwrap();
        let params = SearchParams {
            query,
            max_mismatches: 0,
            evalue_cutoff: 1e10,
            match_score: 2,
            mismatch_score: -3,
            rna_mode: false,
        };
        let results = search_local(&db, &params);
        assert!(results.hits.is_empty());
    }

    #[test]
    fn reverse_complement_hit() {
        let subject = "AAAACGATCGATAAAA";
        let db = make_db(&[("seq1", subject)]);
        let query = parse_query("ATCGATCG").unwrap();
        let params = SearchParams {
            query,
            max_mismatches: 0,
            evalue_cutoff: 1e10,
            match_score: 2,
            mismatch_score: -3,
            rna_mode: false,
        };
        let results = search_local(&db, &params);
        let rc_hits: Vec<_> = results.hits.iter().filter(|h| h.strand == '-').collect();
        assert!(!rc_hits.is_empty());
    }

    #[test]
    fn rna_query_works() {
        // Query with U should find matches against T in subject
        let subject = "AAAATCGATCGAAAA";
        let db = make_db(&[("seq1", subject)]);
        let query = parse_query("AUCGAUCG").unwrap();
        let params = SearchParams {
            query,
            max_mismatches: 0,
            evalue_cutoff: 1e10,
            match_score: 2,
            mismatch_score: -3,
            rna_mode: true,
        };
        let results = search_local(&db, &params);
        assert!(!results.hits.is_empty());
    }
}
