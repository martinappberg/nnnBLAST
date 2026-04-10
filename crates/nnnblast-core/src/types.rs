use serde::{Deserialize, Serialize};

#[cfg(feature = "server")]
use std::sync::Arc;
#[cfg(feature = "server")]
use tokio::sync::RwLock;

/// A single motif in the structured query (e.g., "AGGAGG" or "ATCGATCG").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Motif {
    /// The motif sequence in IUPAC codes (uppercase, T-normalized — U→T).
    pub sequence: Vec<u8>,
    /// Per-motif max mismatch override. `None` means use the global default.
    pub max_mismatches: Option<usize>,
}

/// Gap constraint between two adjacent motifs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GapConstraint {
    pub min: usize,
    pub max: usize,
}

/// A parsed structured query: motifs interleaved with gap constraints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredQuery {
    pub motifs: Vec<Motif>,
    pub gaps: Vec<GapConstraint>,
}

/// Parameters for a search job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchParams {
    pub query: StructuredQuery,
    pub max_mismatches: usize,
    pub evalue_cutoff: f64,
    pub match_score: i32,
    pub mismatch_score: i32,
    /// Whether the original query contained U (RNA mode display).
    #[serde(default)]
    pub rna_mode: bool,
}

impl Default for SearchParams {
    fn default() -> Self {
        Self {
            query: StructuredQuery {
                motifs: vec![],
                gaps: vec![],
            },
            max_mismatches: 2,
            evalue_cutoff: 10.0,
            match_score: 2,
            mismatch_score: -3,
            rna_mode: false,
        }
    }
}

/// NCBI-specific parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NcbiParams {
    pub database: String,
    pub email: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_max_blast_hits")]
    pub max_blast_hits: usize,
}

fn default_max_blast_hits() -> usize {
    500
}

/// A single BLAST hit from NCBI (anchor match).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastHit {
    pub accession: String,
    /// Full description from BLAST (organism, sequence type, etc.)
    pub description: String,
    /// Total length of the subject sequence.
    pub subject_length: usize,
    /// 1-based start on plus strand.
    pub hit_from: usize,
    /// 1-based end on plus strand.
    pub hit_to: usize,
    pub strand: char,
    pub score: i32,
    pub evalue: f64,
}

/// Progress state for a multi-step NCBI search job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub stage: String,
    pub detail: Option<String>,
}

/// Alignment of a single motif against a region of the subject.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotifAlignment {
    pub motif_index: usize,
    /// Start position in the subject (0-based within fetched region, or genomic coordinate).
    pub subject_start: usize,
    pub subject_segment: Vec<u8>,
    pub mismatches: usize,
    pub score: i32,
}

/// A complete structured hit: all motifs matched with gap constraints satisfied.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hit {
    pub subject_id: String,
    /// Full description (organism, sequence type, etc.)
    #[serde(default)]
    pub description: String,
    /// Total length of the subject sequence.
    #[serde(default)]
    pub subject_length: usize,
    pub strand: char,
    pub motif_alignments: Vec<MotifAlignment>,
    pub total_score: i32,
    pub evalue: f64,
    pub bit_score: f64,
    /// Genomic start coordinate of the full structured hit (for display).
    #[serde(default)]
    pub genomic_start: usize,
    /// Genomic end coordinate.
    #[serde(default)]
    pub genomic_end: usize,
}

/// A subject sequence from the database (local mode).
#[derive(Debug, Clone)]
pub struct SubjectSequence {
    pub id: String,
    pub sequence: Vec<u8>,
}

/// Results of a search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub hits: Vec<Hit>,
    pub database_size: usize,
    pub num_sequences: usize,
    pub query_info: String,
}

/// Shared progress handle for updating job status from async pipeline.
#[cfg(feature = "server")]
pub type ProgressHandle = Arc<RwLock<JobProgress>>;

// ─── IUPAC helpers ───

/// Check if a query base matches a subject base under IUPAC rules.
///
/// - Standard IUPAC codes (R, Y, M, etc.): match compatible bases, scored as match (+2)
/// - X: ALWAYS returns false (penalized wildcard — always counts as mismatch)
/// - N: should not appear in motifs (parser converts standalone N to gaps)
pub fn iupac_match(query_base: u8, subject_base: u8) -> bool {
    let q = normalize_base(query_base);
    let s = normalize_base(subject_base);
    match q {
        b'A' => s == b'A',
        b'T' => s == b'T',
        b'G' => s == b'G',
        b'C' => s == b'C',
        b'R' => s == b'A' || s == b'G',
        b'Y' => s == b'C' || s == b'T',
        b'S' => s == b'G' || s == b'C',
        b'W' => s == b'A' || s == b'T',
        b'K' => s == b'G' || s == b'T',
        b'M' => s == b'A' || s == b'C',
        b'B' => s != b'A',
        b'D' => s != b'C',
        b'H' => s != b'G',
        b'V' => s != b'T',
        b'N' => true,  // legacy: if N somehow appears in a motif, treat as any-base
        b'X' => false,  // X = penalized wildcard, ALWAYS a mismatch
        _ => false,
    }
}

/// Normalize a base: uppercase + U→T.
pub fn normalize_base(b: u8) -> u8 {
    match b.to_ascii_uppercase() {
        b'U' => b'T',
        other => other,
    }
}

/// Number of bases an IUPAC code can match.
pub fn iupac_degeneracy(base: u8) -> usize {
    match normalize_base(base) {
        b'A' | b'T' | b'G' | b'C' => 1,
        b'R' | b'Y' | b'S' | b'W' | b'K' | b'M' => 2,
        b'B' | b'D' | b'H' | b'V' => 3,
        b'N' | b'X' => 4,
        _ => 4,
    }
}

/// Compute information content of a motif in bits.
pub fn motif_information_content(motif: &Motif) -> f64 {
    motif
        .sequence
        .iter()
        .map(|&b| 2.0 - (iupac_degeneracy(b) as f64).log2())
        .sum()
}

/// Reverse complement of a DNA/RNA sequence. U is treated as T. X stays as X.
pub fn reverse_complement(seq: &[u8]) -> Vec<u8> {
    seq.iter()
        .rev()
        .map(|&b| match normalize_base(b) {
            b'A' => b'T',
            b'T' => b'A',
            b'G' => b'C',
            b'C' => b'G',
            b'R' => b'Y',
            b'Y' => b'R',
            b'S' => b'S',
            b'W' => b'W',
            b'K' => b'M',
            b'M' => b'K',
            b'B' => b'V',
            b'V' => b'B',
            b'D' => b'H',
            b'H' => b'D',
            b'N' => b'N',
            b'X' => b'X', // penalized wildcard has no complement
            _ => b'N',
        })
        .collect()
}

/// Compute Hamming distance between two byte sequences.
pub fn hamming_distance(a: &[u8], b: &[u8]) -> usize {
    a.iter()
        .zip(b.iter())
        .filter(|(x, y)| normalize_base(**x) != normalize_base(**y))
        .count()
        + a.len().abs_diff(b.len()) // length difference counts as mismatches
}

/// Select the primary anchor (highest IC). Returns motif index.
pub fn select_anchor(query: &StructuredQuery) -> usize {
    query
        .motifs
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| {
            let ic_a = motif_information_content(a);
            let ic_b = motif_information_content(b);
            ic_a.partial_cmp(&ic_b)
                .unwrap()
                .then(a.sequence.len().cmp(&b.sequence.len()))
        })
        .map(|(i, _)| i)
        .unwrap_or(0)
}

/// Select a secondary anchor for multi-anchor BLAST (when primary is short).
/// Picks highest IC motif that isn't the primary, tiebreaks on Hamming distance.
pub fn select_secondary_anchor(query: &StructuredQuery, primary_idx: usize) -> Option<usize> {
    if query.motifs.len() < 2 {
        return None;
    }
    let primary_seq = &query.motifs[primary_idx].sequence;
    query
        .motifs
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != primary_idx)
        .max_by(|(_, a), (_, b)| {
            let ic_a = motif_information_content(a);
            let ic_b = motif_information_content(b);
            ic_a.partial_cmp(&ic_b)
                .unwrap()
                .then_with(|| {
                    // Tiebreak: prefer more different from primary
                    hamming_distance(&a.sequence, primary_seq)
                        .cmp(&hamming_distance(&b.sequence, primary_seq))
                })
        })
        .map(|(i, _)| i)
}

/// Compute the expected distance range between two motifs in the query.
/// Returns (min_distance, max_distance) in nucleotides between the END of motif `from`
/// and the START of motif `to` (from < to).
pub fn expected_distance_range(
    query: &StructuredQuery,
    from: usize,
    to: usize,
) -> (usize, usize) {
    assert!(from < to);
    let mut min_dist = 0usize;
    let mut max_dist = 0usize;
    for i in from..to {
        if i > from {
            // Add the intermediate motif length
            min_dist += query.motifs[i].sequence.len();
            max_dist += query.motifs[i].sequence.len();
        }
        // Add the gap constraint
        min_dist += query.gaps[i].min;
        max_dist += query.gaps[i].max;
    }
    (min_dist, max_dist)
}

/// Compute left and right span needed for fetching flanking regions around an anchor hit.
pub fn compute_flanking_spans(query: &StructuredQuery, anchor_idx: usize) -> (usize, usize) {
    // Left span: everything to the left of anchor
    let left_span: usize = (0..anchor_idx)
        .map(|i| query.motifs[i].sequence.len() + query.gaps[i].max)
        .sum();

    // Right span: everything to the right of anchor
    let right_span: usize = (anchor_idx..query.motifs.len() - 1)
        .map(|i| query.gaps[i].max + query.motifs[i + 1].sequence.len())
        .sum();

    (left_span, right_span)
}

// ─── Fetch region planning (dedup + adaptive merge) ───

/// A region to fetch from NCBI Efetch — covers one or more merged BLAST hits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchRegion {
    pub accession: String,
    pub description: String,
    pub subject_length: usize,
    pub fetch_start: usize,
    pub fetch_end: usize,
    pub best_score: i32,
}

/// Plan which regions to fetch from NCBI, given raw BLAST hits and the query.
///
/// Groups hits by accession, adaptively merges nearby windows to minimize HTTP
/// requests while covering every BLAST hit location. Caps by unique accessions.
///
/// Returns a sorted (by best score) list of `FetchRegion`s.
pub fn plan_fetch_regions(
    blast_hits: &[BlastHit],
    query: &StructuredQuery,
    max_accessions: usize,
) -> (Vec<FetchRegion>, FetchPlanStats) {
    let query_span: usize = query.motifs.iter().map(|m| m.sequence.len()).sum::<usize>()
        + query.gaps.iter().map(|g| g.max).sum::<usize>();
    let padding = query_span + 50;
    let max_fetch_size: usize = 5_000_000; // 5Mb max per fetch
    let max_regions_per_accession: usize = 10;

    // Group by accession
    let mut per_accession: std::collections::HashMap<
        String,
        (String, usize, Vec<(usize, usize, i32)>), // (description, subject_length, [(start, end, score)])
    > = std::collections::HashMap::new();

    for hit in blast_hits {
        let fetch_start = hit.hit_from.saturating_sub(padding).max(1);
        let fetch_end = hit.hit_to + padding;
        per_accession
            .entry(hit.accession.clone())
            .or_insert_with(|| (hit.description.clone(), hit.subject_length, Vec::new()))
            .2
            .push((fetch_start, fetch_end, hit.score));
    }

    let unique_accessions = per_accession.len();

    // For each accession, adaptively merge windows
    let mut all_regions: Vec<FetchRegion> = Vec::new();
    for (accession, (description, subject_length, windows)) in &per_accession {
        let mut wins: Vec<(usize, usize, i32)> = windows.clone();

        let mut gap = (query_span * 2).max(20_000);
        let mut merged = merge_windows(&mut wins, gap, max_fetch_size);
        while merged.len() > max_regions_per_accession && gap < max_fetch_size {
            gap *= 4;
            merged = merge_windows(&mut wins, gap, max_fetch_size);
        }

        for (start, end, score) in merged {
            all_regions.push(FetchRegion {
                accession: accession.clone(),
                description: description.clone(),
                subject_length: *subject_length,
                fetch_start: start,
                fetch_end: end,
                best_score: score,
            });
        }
    }

    // Sort by best score descending
    all_regions.sort_by(|a, b| b.best_score.cmp(&a.best_score));

    // Cap by unique accessions
    let capped_at = if max_accessions > 0 && unique_accessions > max_accessions {
        // Find top N accessions by best score
        let mut best_per_acc: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
        for r in &all_regions {
            let entry = best_per_acc.entry(r.accession.clone()).or_insert(0);
            *entry = (*entry).max(r.best_score);
        }
        let mut acc_scores: Vec<(String, i32)> = best_per_acc.into_iter().collect();
        acc_scores.sort_by(|a, b| b.1.cmp(&a.1));
        let top: std::collections::HashSet<String> = acc_scores
            .into_iter()
            .take(max_accessions)
            .map(|(acc, _)| acc)
            .collect();
        all_regions.retain(|r| top.contains(&r.accession));
        Some(max_accessions)
    } else {
        None
    };

    let stats = FetchPlanStats {
        total_blast_hits: blast_hits.len(),
        unique_accessions,
        total_regions: all_regions.len(),
        capped_at,
    };

    (all_regions, stats)
}

/// Statistics from the fetch planning step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchPlanStats {
    pub total_blast_hits: usize,
    pub unique_accessions: usize,
    pub total_regions: usize,
    pub capped_at: Option<usize>,
}

/// Merge sorted windows within `gap` of each other, respecting `max_size`.
fn merge_windows(
    windows: &mut Vec<(usize, usize, i32)>,
    gap: usize,
    max_size: usize,
) -> Vec<(usize, usize, i32)> {
    windows.sort_by_key(|w| w.0);
    let mut merged: Vec<(usize, usize, i32)> = Vec::new();
    for &(start, end, score) in windows.iter() {
        if let Some(last) = merged.last_mut() {
            if start <= last.1 + gap && (end - last.0) <= max_size {
                last.1 = last.1.max(end);
                last.2 = last.2.max(score);
                continue;
            }
        }
        merged.push((start, end, score));
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_hit(accession: &str, from: usize, to: usize, score: i32) -> BlastHit {
        BlastHit {
            accession: accession.to_string(),
            description: format!("desc {}", accession),
            subject_length: 100_000,
            hit_from: from,
            hit_to: to,
            strand: '+',
            score,
            evalue: 1.0,
        }
    }

    fn simple_query() -> StructuredQuery {
        StructuredQuery {
            motifs: vec![
                Motif { sequence: b"ATCGATCG".to_vec(), max_mismatches: None },
                Motif { sequence: b"GGCCAAGG".to_vec(), max_mismatches: None },
            ],
            gaps: vec![GapConstraint { min: 5, max: 15 }],
        }
    }

    #[test]
    fn single_hit_one_region() {
        let hits = vec![make_hit("ACC1", 1000, 1050, 100)];
        let (regions, stats) = plan_fetch_regions(&hits, &simple_query(), 0);
        assert_eq!(regions.len(), 1);
        assert_eq!(stats.unique_accessions, 1);
        assert_eq!(stats.total_regions, 1);
        assert_eq!(regions[0].accession, "ACC1");
    }

    #[test]
    fn nearby_hits_merge() {
        // Two hits 500bp apart on same accession — should merge
        let hits = vec![
            make_hit("ACC1", 1000, 1050, 100),
            make_hit("ACC1", 1500, 1550, 90),
        ];
        let (regions, stats) = plan_fetch_regions(&hits, &simple_query(), 0);
        assert_eq!(regions.len(), 1);
        assert_eq!(stats.total_regions, 1);
        assert!(regions[0].best_score == 100);
    }

    #[test]
    fn distant_hits_separate() {
        // Two hits 10Mb apart — should NOT merge into one region
        let hits = vec![
            make_hit("ACC1", 1_000_000, 1_000_050, 100),
            make_hit("ACC1", 11_000_000, 11_000_050, 90),
        ];
        let (regions, _) = plan_fetch_regions(&hits, &simple_query(), 0);
        assert!(regions.len() >= 2, "distant hits should be separate regions");
    }

    #[test]
    fn max_accessions_caps() {
        let hits = vec![
            make_hit("ACC1", 1000, 1050, 100),
            make_hit("ACC2", 2000, 2050, 50),
            make_hit("ACC3", 3000, 3050, 75),
        ];
        let (regions, stats) = plan_fetch_regions(&hits, &simple_query(), 2);
        assert_eq!(stats.capped_at, Some(2));
        // Should keep ACC1 (score 100) and ACC3 (score 75), drop ACC2 (score 50)
        let accessions: std::collections::HashSet<_> = regions.iter().map(|r| r.accession.as_str()).collect();
        assert!(accessions.contains("ACC1"));
        assert!(accessions.contains("ACC3"));
        assert!(!accessions.contains("ACC2"));
    }

    #[test]
    fn empty_hits() {
        let (regions, stats) = plan_fetch_regions(&[], &simple_query(), 0);
        assert_eq!(regions.len(), 0);
        assert_eq!(stats.total_blast_hits, 0);
    }

    #[test]
    fn adaptive_merge_reduces_regions() {
        // Many hits scattered across a large range — should adaptively merge
        let hits: Vec<BlastHit> = (0..100)
            .map(|i| make_hit("ACC1", i * 50_000, i * 50_000 + 50, 100 - i as i32))
            .collect();
        let (regions, _) = plan_fetch_regions(&hits, &simple_query(), 0);
        // Should merge into ≤ 10 regions (maxRegionsPerAccession)
        assert!(regions.len() <= 10, "got {} regions, expected ≤ 10", regions.len());
        assert!(regions.len() >= 1);
    }
}
