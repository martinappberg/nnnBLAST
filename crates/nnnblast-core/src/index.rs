use crate::types::SubjectSequence;
use std::io::{BufRead, BufReader, Read};

/// A simple database: a collection of subject sequences parsed from FASTA.
///
/// For the initial version we use a straightforward scan approach.
/// Future optimization: FM-index for seed lookup.
#[derive(Debug, Clone)]
pub struct Database {
    pub sequences: Vec<SubjectSequence>,
    pub total_bases: u64,
}

impl Database {
    /// Parse a FASTA-formatted string into a Database.
    pub fn from_fasta_str(fasta: &str) -> Self {
        Self::from_fasta_reader(fasta.as_bytes())
    }

    /// Parse FASTA from a reader.
    pub fn from_fasta_reader<R: Read>(reader: R) -> Self {
        let buf = BufReader::new(reader);
        let mut sequences = Vec::new();
        let mut current_id = String::new();
        let mut current_seq = Vec::new();

        for line in buf.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            if let Some(header) = line.strip_prefix('>') {
                // Flush previous sequence
                if !current_id.is_empty() && !current_seq.is_empty() {
                    sequences.push(SubjectSequence {
                        id: current_id.clone(),
                        sequence: current_seq.clone(),
                    });
                }
                // Start new sequence
                current_id = header.split_whitespace().next().unwrap_or(header).to_string();
                current_seq.clear();
            } else {
                current_seq.extend(line.bytes().filter(|b| b.is_ascii_alphabetic()));
            }
        }

        // Flush last
        if !current_id.is_empty() && !current_seq.is_empty() {
            sequences.push(SubjectSequence {
                id: current_id,
                sequence: current_seq,
            });
        }

        let total_bases: u64 = sequences.iter().map(|s| s.sequence.len() as u64).sum();

        Database {
            sequences,
            total_bases,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_fasta() {
        let fasta = ">seq1 description\nATCGATCG\nGGCCAAT\n>seq2\nAAAATTTTCCCCGGGG\n";
        let db = Database::from_fasta_str(fasta);
        assert_eq!(db.sequences.len(), 2);
        assert_eq!(db.sequences[0].id, "seq1");
        assert_eq!(db.sequences[0].sequence, b"ATCGATCGGGCCAAT");
        assert_eq!(db.sequences[1].id, "seq2");
        assert_eq!(db.sequences[1].sequence, b"AAAATTTTCCCCGGGG");
        assert_eq!(db.total_bases, 31);
    }

    #[test]
    fn empty_fasta() {
        let db = Database::from_fasta_str("");
        assert_eq!(db.sequences.len(), 0);
    }
}
