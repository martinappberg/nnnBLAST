use crate::types::{Motif, StructuredQuery};

/// Compute the probability that a single random position matches a motif
/// with alignment score >= the given score.
///
/// For a motif of length m with d mismatches:
///   score(d) = (m - d) * match_score + d * mismatch_score
///   P(d mismatches) = C(m, d) * prod_i P(match_i or mismatch_i)
///
/// For positions with IUPAC ambiguity codes, P(match) = degeneracy/4.
pub fn motif_match_probability(
    motif: &Motif,
    min_score: i32,
    match_score: i32,
    mismatch_score: i32,
    base_freqs: &[f64; 4], // A, C, G, T frequencies
) -> f64 {
    let m = motif.sequence.len();
    // For each position, compute P(match) considering IUPAC and base composition
    let per_pos_match_prob: Vec<f64> = motif
        .sequence
        .iter()
        .map(|&b| iupac_match_probability(b, base_freqs))
        .collect();

    // Enumerate over all mismatch counts d=0..m
    // For each d, check if score >= min_score
    // P(exactly d mismatches) requires summing over all C(m,d) combinations,
    // but since per-position probabilities may differ (IUPAC), we use
    // a dynamic-programming approach.
    //
    // dp[j][d] = probability of exactly d mismatches in the first j positions
    let mut dp = vec![vec![0.0f64; m + 1]; m + 1];
    dp[0][0] = 1.0;

    for j in 0..m {
        let p_match = per_pos_match_prob[j];
        let p_mismatch = 1.0 - p_match;
        for d in 0..=j {
            if dp[j][d] == 0.0 {
                continue;
            }
            // Match at position j
            dp[j + 1][d] += dp[j][d] * p_match;
            // Mismatch at position j
            if d + 1 <= m {
                dp[j + 1][d + 1] += dp[j][d] * p_mismatch;
            }
        }
    }

    // Sum probabilities for all d where score(d) >= min_score
    let mut total_prob = 0.0;
    for d in 0..=m {
        let score = (m - d) as i32 * match_score + d as i32 * mismatch_score;
        if score >= min_score {
            total_prob += dp[m][d];
        }
    }

    total_prob
}

/// Probability that a random base matches an IUPAC code given base frequencies.
fn iupac_match_probability(query_base: u8, base_freqs: &[f64; 4]) -> f64 {
    // base_freqs: [A, C, G, T]
    let q = query_base.to_ascii_uppercase();
    match q {
        b'A' => base_freqs[0],
        b'C' => base_freqs[1],
        b'G' => base_freqs[2],
        b'T' => base_freqs[3],
        b'R' => base_freqs[0] + base_freqs[2],         // A or G
        b'Y' => base_freqs[1] + base_freqs[3],         // C or T
        b'S' => base_freqs[2] + base_freqs[1],         // G or C
        b'W' => base_freqs[0] + base_freqs[3],         // A or T
        b'K' => base_freqs[2] + base_freqs[3],         // G or T
        b'M' => base_freqs[0] + base_freqs[1],         // A or C
        b'B' => 1.0 - base_freqs[0],                   // not A
        b'D' => 1.0 - base_freqs[1],                   // not C
        b'H' => 1.0 - base_freqs[2],                   // not G
        b'V' => 1.0 - base_freqs[3],                   // not T
        b'N' => 1.0,
        b'X' => 0.0, // X = penalized wildcard, ALWAYS a mismatch
        _ => 0.25,    // fallback for unknown bases
    }
}

/// Compute the E-value for a structured hit.
///
/// E = N_eff × ∏(W_i) × ∏(p_i(S_i))
///
/// Where:
/// - N_eff = effective database size (total positions, both strands)
/// - W_i = gap window width for gap i
/// - p_i(S_i) = probability of motif i matching with score >= S_i
pub fn compute_evalue(
    query: &StructuredQuery,
    motif_scores: &[i32],
    database_size: u64,
    num_sequences: u64,
    match_score: i32,
    mismatch_score: i32,
    base_freqs: &[f64; 4],
) -> f64 {
    let total_query_span = estimate_query_span(query) as u64;

    // N_eff: both strands, minus the query footprint per sequence
    // Simplified: 2 * (database_size - num_sequences * total_query_span)
    let n_eff = if database_size > num_sequences * total_query_span {
        2.0 * (database_size - num_sequences * total_query_span) as f64
    } else {
        2.0 * database_size as f64
    };

    // Work in log space to avoid floating-point underflow with long motifs.
    // log(E) = log(N_eff) + Σ log(W_i) + Σ log(p_i)
    let log_e = n_eff.ln()
        + query
            .gaps
            .iter()
            .map(|g| ((g.max - g.min + 1) as f64).ln())
            .sum::<f64>()
        + query
            .motifs
            .iter()
            .zip(motif_scores.iter())
            .map(|(motif, &score)| {
                let p = motif_match_probability(motif, score, match_score, mismatch_score, base_freqs);
                if p <= 0.0 { f64::NEG_INFINITY } else { p.ln() }
            })
            .sum::<f64>();

    if log_e.is_nan() || log_e == f64::NEG_INFINITY || log_e < -700.0 {
        // Probability too small for f64 — clamp to a displayable minimum
        1e-300
    } else {
        log_e.exp()
    }
}

/// Estimate the minimum span of the full structured query.
fn estimate_query_span(query: &StructuredQuery) -> usize {
    let motif_len: usize = query.motifs.iter().map(|m| m.sequence.len()).sum();
    let gap_len: usize = query.gaps.iter().map(|g| g.min).sum();
    motif_len + gap_len
}

/// Convert raw score to bit score.
///
/// For nucleotide scoring with match=+2, mismatch=-3:
///   λ ≈ 1.28, K ≈ 0.46 (empirically derived, similar to BLASTN defaults)
///
/// Bit score = (λ * S - ln(K)) / ln(2)
pub fn raw_to_bit_score(raw_score: i32) -> f64 {
    let lambda: f64 = 1.28;
    let k: f64 = 0.46;
    (lambda * raw_score as f64 - k.ln()) / 2.0f64.ln()
}

/// Estimate base frequencies from a set of sequences.
pub fn estimate_base_frequencies(sequences: &[&[u8]]) -> [f64; 4] {
    let mut counts = [0u64; 4]; // A, C, G, T
    let mut total = 0u64;

    for seq in sequences {
        for &b in *seq {
            match b.to_ascii_uppercase() {
                b'A' => counts[0] += 1,
                b'C' => counts[1] += 1,
                b'G' => counts[2] += 1,
                b'T' => counts[3] += 1,
                _ => {} // skip ambiguous
            }
            total += 1;
        }
    }

    if total == 0 {
        return [0.25, 0.25, 0.25, 0.25];
    }

    [
        counts[0] as f64 / total as f64,
        counts[1] as f64 / total as f64,
        counts[2] as f64 / total as f64,
        counts[3] as f64 / total as f64,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_exact_match_probability() {
        // Motif "ATCG", uniform base freqs, exact match (score = 8)
        let motif = Motif {
            sequence: b"ATCG".to_vec(),
            max_mismatches: None,
        };
        let freqs = [0.25, 0.25, 0.25, 0.25];
        let p = motif_match_probability(&motif, 8, 2, -3, &freqs);
        // Exact match: (1/4)^4 = 1/256 ≈ 0.00390625
        assert!((p - 1.0 / 256.0).abs() < 1e-10);
    }

    #[test]
    fn allow_one_mismatch() {
        // Motif "ATCG", score with 1 mismatch = 3*2 + 1*(-3) = 3
        let motif = Motif {
            sequence: b"ATCG".to_vec(),
            max_mismatches: None,
        };
        let freqs = [0.25, 0.25, 0.25, 0.25];
        let p = motif_match_probability(&motif, 3, 2, -3, &freqs);
        // P(0 mm) + P(1 mm) = (1/4)^4 + C(4,1)*(1/4)^3*(3/4) = 1/256 + 4*3/256 = 13/256
        assert!((p - 13.0 / 256.0).abs() < 1e-10);
    }

    #[test]
    fn evalue_single_motif() {
        // Single motif, no gaps → should be proportional to N_eff * p
        let query = StructuredQuery {
            motifs: vec![Motif {
                sequence: b"ATCGATCG".to_vec(),
                max_mismatches: None,
            }],
            gaps: vec![],
        };
        let freqs = [0.25, 0.25, 0.25, 0.25];
        let e = compute_evalue(
            &query,
            &[16], // 8 * 2 = perfect match score
            1_000_000,
            100,
            2,
            -3,
            &freqs,
        );
        // E should be small: ~2M * (1/4)^8 ≈ 2M * 1.5e-5 ≈ 30
        assert!(e > 0.0);
        assert!(e < 100.0);
    }

    #[test]
    fn evalue_decreases_with_more_motifs() {
        let freqs = [0.25, 0.25, 0.25, 0.25];
        let db_size = 1_000_000;

        // One motif
        let q1 = StructuredQuery {
            motifs: vec![Motif {
                sequence: b"ATCGATCG".to_vec(),
                max_mismatches: None,
            }],
            gaps: vec![],
        };
        let e1 = compute_evalue(&q1, &[16], db_size, 100, 2, -3, &freqs);

        // Two motifs with gap
        let q2 = StructuredQuery {
            motifs: vec![
                Motif { sequence: b"ATCGATCG".to_vec(), max_mismatches: None },
                Motif { sequence: b"GGCCAA".to_vec(), max_mismatches: None },
            ],
            gaps: vec![crate::types::GapConstraint { min: 5, max: 15 }],
        };
        let e2 = compute_evalue(&q2, &[16, 12], db_size, 100, 2, -3, &freqs);

        // E2 should be much smaller (more significant)
        assert!(e2 < e1);
    }

    #[test]
    fn bit_score_positive() {
        assert!(raw_to_bit_score(10) > 0.0);
    }

    #[test]
    fn x_wildcard_never_matches() {
        // X always mismatches — P(match) = 0.0
        let freqs = [0.25, 0.25, 0.25, 0.25];
        let p = iupac_match_probability(b'X', &freqs);
        assert_eq!(p, 0.0);
    }

    #[test]
    fn x_wildcard_motif_probability() {
        // Motif "AX": X always mismatches, so exact match (score=4) is impossible.
        // With min_score=-1 (allows 1mm): P = P(A matches)*P(X mismatches) = 0.25*1.0 = 0.25
        let motif = Motif {
            sequence: b"AX".to_vec(),
            max_mismatches: None,
        };
        let freqs = [0.25, 0.25, 0.25, 0.25];
        // score(0mm) = 4, score(1mm) = -1, score(2mm) = -6
        let p = motif_match_probability(&motif, -1, 2, -3, &freqs);
        assert!((p - 0.25).abs() < 1e-10, "expected 0.25, got {}", p);
    }

    #[test]
    fn evalue_with_large_db_size() {
        // Regression test: NCBI core_nt db is ~991 billion bp, which overflows u32.
        // E-value must be finite and reasonable, not clamped to 1e-300.
        let query = StructuredQuery {
            motifs: vec![Motif {
                sequence: b"ATCGATCG".to_vec(),
                max_mismatches: None,
            }],
            gaps: vec![],
        };
        let freqs = [0.25, 0.25, 0.25, 0.25];
        let large_db: u64 = 991_049_906_671; // ~991 billion
        let e = compute_evalue(&query, &[16], large_db, 1, 2, -3, &freqs);
        assert!(e > 1.0, "E-value should be > 1 for 8bp motif in huge db, got {}", e);
        assert!(e < 1e10, "E-value should be reasonable, got {}", e);
        assert!(e != 1e-300, "E-value must not be clamped — db_size was likely truncated");
    }
}
