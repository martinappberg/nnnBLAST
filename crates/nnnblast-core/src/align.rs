use crate::types::{iupac_match, Motif, MotifAlignment};

/// Score an ungapped alignment of a motif against a subject region.
///
/// Returns `None` if the alignment exceeds the mismatch limit.
pub fn score_ungapped(
    motif: &Motif,
    subject: &[u8],
    subject_offset: usize,
    match_score: i32,
    mismatch_score: i32,
    max_mismatches: usize,
) -> Option<(i32, usize)> {
    let m = motif.sequence.len();
    if subject.len() < m {
        return None;
    }

    let mut best_score = i32::MIN;
    let mut best_pos = 0;
    let mut best_mm = m + 1;

    // Slide the motif across the subject window
    for start in 0..=(subject.len() - m) {
        let mut score = 0i32;
        let mut mismatches = 0usize;
        let mut ok = true;

        for j in 0..m {
            if iupac_match(motif.sequence[j], subject[start + j]) {
                score += match_score;
            } else {
                mismatches += 1;
                score += mismatch_score;
                if mismatches > max_mismatches {
                    ok = false;
                    break;
                }
            }
        }

        if ok && score > best_score {
            best_score = score;
            best_pos = start;
            best_mm = mismatches;
        }
    }

    if best_mm <= max_mismatches {
        Some((best_score, subject_offset + best_pos))
    } else {
        None
    }
}

/// Align a motif against a subject window and produce a `MotifAlignment`.
pub fn align_motif_in_window(
    motif: &Motif,
    motif_index: usize,
    subject: &[u8],
    window_start: usize,
    window_end: usize,
    match_score: i32,
    mismatch_score: i32,
    max_mismatches: usize,
) -> Option<MotifAlignment> {
    let end = window_end.min(subject.len());
    if window_start >= end {
        return None;
    }
    let window = &subject[window_start..end];

    let (score, abs_pos) =
        score_ungapped(motif, window, window_start, match_score, mismatch_score, max_mismatches)?;

    let m = motif.sequence.len();
    let seg_start = abs_pos;
    let seg_end = (abs_pos + m).min(subject.len());
    let segment = subject[seg_start..seg_end].to_vec();

    // Count actual mismatches at the best position
    let mismatches = motif
        .sequence
        .iter()
        .zip(segment.iter())
        .filter(|(&q, &s)| !iupac_match(q, s))
        .count();

    Some(MotifAlignment {
        motif_index,
        subject_start: abs_pos,
        subject_segment: segment,
        mismatches,
        score,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_motif(seq: &[u8]) -> Motif {
        Motif {
            sequence: seq.to_vec(),
            max_mismatches: None,
        }
    }

    #[test]
    fn exact_match() {
        let motif = make_motif(b"ATCG");
        let (score, pos) = score_ungapped(&motif, b"ATCG", 0, 2, -3, 0).unwrap();
        assert_eq!(score, 8); // 4 * 2
        assert_eq!(pos, 0);
    }

    #[test]
    fn one_mismatch() {
        let motif = make_motif(b"ATCG");
        let (score, _) = score_ungapped(&motif, b"AACG", 0, 2, -3, 1).unwrap();
        assert_eq!(score, 3); // 3*2 + 1*(-3)
    }

    #[test]
    fn too_many_mismatches() {
        let motif = make_motif(b"ATCG");
        assert!(score_ungapped(&motif, b"TTTT", 0, 2, -3, 1).is_none());
    }

    #[test]
    fn sliding_window() {
        let motif = make_motif(b"ATCG");
        let subject = b"GGGATCGAAA";
        let (score, pos) = score_ungapped(&motif, subject, 0, 2, -3, 0).unwrap();
        assert_eq!(score, 8);
        assert_eq!(pos, 3);
    }

    #[test]
    fn iupac_motif() {
        let motif = make_motif(b"RYWS");
        // R=A/G, Y=C/T, W=A/T, S=G/C
        // Subject: ACAG → R(A)=match, Y(C)=match, W(A)=match, S(G)=match
        let (score, _) = score_ungapped(&motif, b"ACAG", 0, 2, -3, 0).unwrap();
        assert_eq!(score, 8);
    }
}
