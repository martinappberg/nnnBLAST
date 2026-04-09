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

const VALID_IUPAC: &[u8] = b"ACGTURYWSKMBDHVN";

/// Parse a structured query string into a `StructuredQuery`.
///
/// Syntax:
///   MOTIF1{mm:X}[N:min-max]MOTIF2[N:count]MOTIF3
///
/// Examples:
///   AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC
///   AGGAGG{mm:1}[N:10]ATCGATCG
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
            // Gap specification: [N:X] or [N:X-Y]
            // First, flush the current motif
            if !current_motif_seq.is_empty() {
                motifs.push(Motif {
                    sequence: current_motif_seq.clone(),
                    max_mismatches: current_mm.take(),
                });
                current_motif_seq.clear();
            } else if motifs.is_empty() {
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
            // Must follow a motif (or be mid-motif — we flush motif after)
            let close = chars[i..]
                .iter()
                .position(|&c| c == '}')
                .ok_or_else(|| ParseError::InvalidMismatch("Unclosed brace".into()))?;
            let mm_str: String = chars[i + 1..i + close].iter().collect();
            current_mm = Some(parse_mismatch_spec(&mm_str)?);
            i += close + 1;
        } else if VALID_IUPAC.contains(&(ch as u8)) {
            current_motif_seq.push(ch as u8);
            i += 1;
        } else if ch.is_whitespace() {
            i += 1;
        } else {
            return Err(ParseError::InvalidBase(ch));
        }
    }

    // Flush trailing motif
    if !current_motif_seq.is_empty() {
        motifs.push(Motif {
            sequence: current_motif_seq,
            max_mismatches: current_mm.take(),
        });
    }

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

    // Normalize U→T in all motif sequences
    for motif in &mut motifs {
        for base in &mut motif.sequence {
            if *base == b'U' {
                *base = b'T';
            }
        }
    }

    Ok(StructuredQuery { motifs, gaps })
}

/// Check if the raw query string contains U (indicating RNA).
pub fn detect_rna_mode(input: &str) -> bool {
    input.chars().any(|c| c == 'U' || c == 'u')
}

/// Parse gap spec: "N:5", "N:5-15", "5", "5-15"
fn parse_gap_spec(s: &str) -> Result<GapConstraint, ParseError> {
    let s = s.trim();
    // Strip leading "N:" if present
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
        assert_eq!(q.gaps[1].min, 10);
        assert_eq!(q.gaps[1].max, 25);
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
    fn parse_iupac() {
        let q = parse_query("RYWSAGG[N:5]BDHVN").unwrap();
        assert_eq!(q.motifs[0].sequence, b"RYWSAGG");
        assert_eq!(q.motifs[1].sequence, b"BDHVN");
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
}
