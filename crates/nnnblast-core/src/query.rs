use crate::types::{GapConstraint, Motif, StructuredQuery};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("Empty query")]
    Empty,
    #[error("Invalid gap specification: {0}")]
    InvalidGap(String),
    #[error("Invalid mismatch specification: {0}")]
    InvalidMismatch(String),
    #[error("Invalid base '{0}' in motif")]
    InvalidBase(char),
    #[error("Query must contain at least one motif")]
    NoMotifs,
    #[error("Gap min ({min}) > max ({max})")]
    GapMinExceedsMax { min: usize, max: usize },
}

/// Valid characters WITHIN a motif. N is NOT included — it creates gaps.
/// X = penalized any-base wildcard (always counts as mismatch, sent as N to BLAST).
const VALID_MOTIF_BASES: &[u8] = b"ACGTURYWSKMBDHVX";

/// Parse a structured query string into a `StructuredQuery`.
///
/// Character roles:
/// - A,T,G,C,U: exact bases (part of motif)
/// - R,Y,S,W,K,M,B,D,H,V: IUPAC ambiguity codes (part of motif, no penalty)
/// - X: penalized any-base wildcard (part of motif, always counts as mismatch)
/// - N: gap shorthand — N=[N:1], NN=[N:2], NNN=[N:3]. Breaks the motif.
/// - [N:5-15]: explicit gap range
/// - {mm:2}: per-motif mismatch override
///
/// Examples:
///   AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC
///   AGGAGG{mm:1}NNATCGATCG         — NN = 2bp gap
///   GTGCCAGCXGCCGCGGTAA             — X keeps motif continuous (19bp)
///   RYWSAGG[N:5-15]ATCGATCG
pub fn parse_query(input: &str) -> Result<StructuredQuery, ParseError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(ParseError::Empty);
    }

    let input_upper = input.to_uppercase();
    let chars: Vec<char> = input_upper.chars().collect();
    let len = chars.len();

    let mut motifs: Vec<Motif> = Vec::new();
    let mut gaps: Vec<GapConstraint> = Vec::new();
    let mut current_motif_seq: Vec<u8> = Vec::new();
    let mut current_mm: Option<usize> = None;
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        if ch == '[' {
            // Explicit gap specification: [N:X] or [N:X-Y]
            flush_motif(&mut motifs, &mut current_motif_seq, &mut current_mm);

            if motifs.is_empty() {
                return Err(ParseError::InvalidGap(
                    "Gap at start of query (no preceding motif)".into(),
                ));
            }

            let close = chars[i..]
                .iter()
                .position(|&c| c == ']')
                .ok_or_else(|| ParseError::InvalidGap("Unclosed bracket".into()))?;
            let gap_str: String = chars[i + 1..i + close].iter().collect();
            let gap = parse_gap_spec(&gap_str)?;
            gaps.push(gap);
            i += close + 1;
        } else if ch == '{' {
            // Mismatch specification: {mm:X}
            let close = chars[i..]
                .iter()
                .position(|&c| c == '}')
                .ok_or_else(|| ParseError::InvalidMismatch("Unclosed brace".into()))?;
            let mm_str: String = chars[i + 1..i + close].iter().collect();
            current_mm = Some(parse_mismatch_spec(&mm_str)?);
            i += close + 1;
        } else if ch == 'N' {
            // N = gap shorthand. Count consecutive N's.
            // First, flush the current motif.
            flush_motif(&mut motifs, &mut current_motif_seq, &mut current_mm);

            if motifs.is_empty() {
                return Err(ParseError::InvalidGap(
                    "Gap (N) at start of query (no preceding motif)".into(),
                ));
            }

            let mut n_count = 0;
            while i < len && chars[i] == 'N' {
                n_count += 1;
                i += 1;
            }
            gaps.push(GapConstraint {
                min: n_count,
                max: n_count,
            });
            // Don't increment i — already advanced in the while loop
        } else if VALID_MOTIF_BASES.contains(&(ch as u8)) {
            current_motif_seq.push(ch as u8);
            i += 1;
        } else if ch.is_whitespace() {
            i += 1;
        } else {
            return Err(ParseError::InvalidBase(ch));
        }
    }

    // Flush trailing motif
    flush_motif(&mut motifs, &mut current_motif_seq, &mut current_mm);

    if motifs.is_empty() {
        return Err(ParseError::NoMotifs);
    }

    if gaps.len() != motifs.len() - 1 {
        return Err(ParseError::InvalidGap(format!(
            "Expected {} gap(s) for {} motif(s), got {}",
            motifs.len() - 1,
            motifs.len(),
            gaps.len()
        )));
    }

    // Normalize U→T in all motif sequences (but keep X as X)
    for motif in &mut motifs {
        for base in &mut motif.sequence {
            if *base == b'U' {
                *base = b'T';
            }
        }
    }

    Ok(StructuredQuery { motifs, gaps })
}

/// Flush the current motif buffer into the motifs vec (if non-empty).
fn flush_motif(
    motifs: &mut Vec<Motif>,
    current_seq: &mut Vec<u8>,
    current_mm: &mut Option<usize>,
) {
    if !current_seq.is_empty() {
        motifs.push(Motif {
            sequence: current_seq.clone(),
            max_mismatches: current_mm.take(),
        });
        current_seq.clear();
    }
}

/// Check if the raw query string contains U (indicating RNA).
pub fn detect_rna_mode(input: &str) -> bool {
    input.chars().any(|c| c == 'U' || c == 'u')
}

/// Parse gap spec: "N:5", "N:5-15", "5", "5-15"
fn parse_gap_spec(s: &str) -> Result<GapConstraint, ParseError> {
    let s = s.trim();
    let num_part = if let Some(rest) = s.strip_prefix("N:") {
        rest.trim()
    } else {
        s
    };

    if let Some((min_s, max_s)) = num_part.split_once('-') {
        let min: usize = min_s
            .trim()
            .parse()
            .map_err(|_| ParseError::InvalidGap(format!("Cannot parse min: '{min_s}'")))?;
        let max: usize = max_s
            .trim()
            .parse()
            .map_err(|_| ParseError::InvalidGap(format!("Cannot parse max: '{max_s}'")))?;
        if min > max {
            return Err(ParseError::GapMinExceedsMax { min, max });
        }
        Ok(GapConstraint { min, max })
    } else {
        let val: usize = num_part
            .trim()
            .parse()
            .map_err(|_| ParseError::InvalidGap(format!("Cannot parse: '{num_part}'")))?;
        Ok(GapConstraint {
            min: val,
            max: val,
        })
    }
}

/// Parse mismatch spec: "mm:2" or "MM:2"
fn parse_mismatch_spec(s: &str) -> Result<usize, ParseError> {
    let s = s.trim();
    let num_part = if let Some(rest) = s.strip_prefix("MM:") {
        rest.trim()
    } else {
        return Err(ParseError::InvalidMismatch(format!(
            "Expected 'mm:N', got '{s}'"
        )));
    };
    num_part
        .parse()
        .map_err(|_| ParseError::InvalidMismatch(format!("Cannot parse: '{num_part}'")))
}

/// Convert a motif sequence for BLAST submission: X→N.
pub fn motif_to_blast_query(seq: &[u8]) -> String {
    seq.iter()
        .map(|&b| if b == b'X' { 'N' } else { b as char })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_two_motifs() {
        let q = parse_query("AGGAGG[N:5-15]ATCGATCG").unwrap();
        assert_eq!(q.motifs.len(), 2);
        assert_eq!(q.gaps.len(), 1);
        assert_eq!(q.motifs[0].sequence, b"AGGAGG");
        assert_eq!(q.motifs[1].sequence, b"ATCGATCG");
        assert_eq!(q.gaps[0].min, 5);
        assert_eq!(q.gaps[0].max, 15);
    }

    #[test]
    fn parse_three_motifs() {
        let q = parse_query("AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC").unwrap();
        assert_eq!(q.motifs.len(), 3);
        assert_eq!(q.gaps.len(), 2);
    }

    #[test]
    fn parse_exact_gap() {
        let q = parse_query("AAA[N:10]TTT").unwrap();
        assert_eq!(q.gaps[0].min, 10);
        assert_eq!(q.gaps[0].max, 10);
    }

    #[test]
    fn parse_with_mismatches() {
        let q = parse_query("AGGAGG{mm:1}[N:5-15]ATCGATCG{mm:0}").unwrap();
        assert_eq!(q.motifs[0].max_mismatches, Some(1));
        assert_eq!(q.motifs[1].max_mismatches, Some(0));
    }

    #[test]
    fn parse_iupac_no_n() {
        // IUPAC codes except N are valid in motifs
        let q = parse_query("RYWSAGG[N:5]BDHV").unwrap();
        assert_eq!(q.motifs[0].sequence, b"RYWSAGG");
        assert_eq!(q.motifs[1].sequence, b"BDHV");
    }

    #[test]
    fn parse_single_motif() {
        let q = parse_query("ATCGATCG").unwrap();
        assert_eq!(q.motifs.len(), 1);
        assert_eq!(q.gaps.len(), 0);
    }

    #[test]
    fn reject_empty() {
        assert!(parse_query("").is_err());
    }

    #[test]
    fn reject_gap_min_exceeds_max() {
        assert!(parse_query("AAA[N:15-5]TTT").is_err());
    }

    // ─── New tests for X wildcard and N-as-gap ───

    #[test]
    fn x_stays_in_motif() {
        let q = parse_query("GTGCCAGCXGCCGCGGTAA").unwrap();
        assert_eq!(q.motifs.len(), 1); // ONE motif, not broken
        assert_eq!(q.motifs[0].sequence, b"GTGCCAGCXGCCGCGGTAA");
        assert_eq!(q.gaps.len(), 0);
    }

    #[test]
    fn n_creates_gap() {
        // Single N between motifs = [N:1] gap
        let q = parse_query("AGGAGGNATCGATCG").unwrap();
        assert_eq!(q.motifs.len(), 2);
        assert_eq!(q.motifs[0].sequence, b"AGGAGG");
        assert_eq!(q.motifs[1].sequence, b"ATCGATCG");
        assert_eq!(q.gaps.len(), 1);
        assert_eq!(q.gaps[0].min, 1);
        assert_eq!(q.gaps[0].max, 1);
    }

    #[test]
    fn nn_creates_gap_2() {
        let q = parse_query("AGGAGGNNATCGATCG").unwrap();
        assert_eq!(q.motifs.len(), 2);
        assert_eq!(q.gaps[0].min, 2);
        assert_eq!(q.gaps[0].max, 2);
    }

    #[test]
    fn nnnnn_creates_gap_5() {
        let q = parse_query("AGGAGGNNNNNATCGATCG").unwrap();
        assert_eq!(q.gaps[0].min, 5);
        assert_eq!(q.gaps[0].max, 5);
    }

    #[test]
    fn x_and_n_mixed() {
        // AGGXGG has X in motif, then N gap, then ATCGATCG
        let q = parse_query("AGGXGGNATCGATCG").unwrap();
        assert_eq!(q.motifs.len(), 2);
        assert_eq!(q.motifs[0].sequence, b"AGGXGG");
        assert_eq!(q.motifs[1].sequence, b"ATCGATCG");
        assert_eq!(q.gaps[0].min, 1);
    }

    #[test]
    fn motif_to_blast_replaces_x() {
        assert_eq!(motif_to_blast_query(b"AGGXGG"), "AGGNGG");
        assert_eq!(motif_to_blast_query(b"ATCGATCG"), "ATCGATCG");
        assert_eq!(motif_to_blast_query(b"XXXXX"), "NNNNN");
    }

    #[test]
    fn x_does_not_match_in_iupac() {
        use crate::types::iupac_match;
        // X should NEVER match (always a mismatch)
        assert!(!iupac_match(b'X', b'A'));
        assert!(!iupac_match(b'X', b'T'));
        assert!(!iupac_match(b'X', b'G'));
        assert!(!iupac_match(b'X', b'C'));
    }

    #[test]
    fn rna_with_x_and_n() {
        let q = parse_query("AUGXCGNATCG").unwrap();
        assert_eq!(q.motifs.len(), 2);
        // U→T normalization, X stays
        assert_eq!(q.motifs[0].sequence, b"ATGXCG");
        assert_eq!(q.motifs[1].sequence, b"ATCG");
        assert_eq!(q.gaps[0].min, 1);
    }
}
