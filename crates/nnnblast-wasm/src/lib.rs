use nnnblast_core::{
    align::align_motif_in_window,
    query::{detect_rna_mode, motif_to_blast_query, parse_query},
    stats::{compute_evalue, raw_to_bit_score},
    types::*,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ─── Query Parsing ───

/// Parse and validate a structured query string. Returns JSON.
#[wasm_bindgen]
pub fn parse_and_validate_query(input: &str) -> Result<String, JsError> {
    let query = parse_query(input).map_err(|e| JsError::new(&e.to_string()))?;
    let rna_mode = detect_rna_mode(input);
    let result = ParseResult {
        query,
        rna_mode,
    };
    Ok(serde_json::to_string(&result).unwrap())
}

#[derive(Serialize)]
struct ParseResult {
    query: StructuredQuery,
    rna_mode: bool,
}

// ─── BLAST Strategy ───

/// Choose the BLAST strategy and return the query string(s) to send to NCBI.
/// Returns JSON with strategy type and BLAST query sequences.
#[wasm_bindgen]
pub fn choose_blast_strategy(query_json: &str) -> Result<String, JsError> {
    let query: StructuredQuery =
        serde_json::from_str(query_json).map_err(|e| JsError::new(&e.to_string()))?;

    let anchor_idx = select_anchor(&query);
    let anchor_seq = motif_to_blast_query(&query.motifs[anchor_idx].sequence);
    let anchor_len = query.motifs[anchor_idx].sequence.len();

    // Determine strategy
    let strategy = if anchor_len >= 18 {
        BlastStrategyResult {
            strategy: "single_anchor".into(),
            blast_query: anchor_seq.clone(),
            anchor_idx,
        }
    } else {
        // Try composite
        let total_min_gap: usize = query.gaps.iter().map(|g| g.min).sum();
        let total_motif_len: usize = query.motifs.iter().map(|m| m.sequence.len()).sum();
        let composite_len = total_motif_len + total_min_gap;

        if composite_len >= 12 && total_min_gap <= 100 && query.motifs.len() > 1 {
            let mut composite = String::new();
            for (i, motif) in query.motifs.iter().enumerate() {
                composite.push_str(&motif_to_blast_query(&motif.sequence));
                if i < query.gaps.len() {
                    for _ in 0..query.gaps[i].min {
                        composite.push('N');
                    }
                }
            }
            BlastStrategyResult {
                strategy: "composite".into(),
                blast_query: composite,
                anchor_idx,
            }
        } else {
            BlastStrategyResult {
                strategy: "single_anchor".into(),
                blast_query: anchor_seq,
                anchor_idx,
            }
        }
    };

    Ok(serde_json::to_string(&strategy).unwrap())
}

#[derive(Serialize)]
struct BlastStrategyResult {
    strategy: String,
    blast_query: String,
    anchor_idx: usize,
}

// ─── BLAST XML Parsing ───

/// Parse NCBI BLAST XML response into JSON array of hits.
#[wasm_bindgen]
pub fn parse_blast_xml(xml: &str) -> Result<String, JsError> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let cleaned: String = xml
        .lines()
        .filter(|line| !line.trim_start().starts_with("<!DOCTYPE"))
        .collect::<Vec<_>>()
        .join("\n");

    let mut reader = Reader::from_str(&cleaned);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut hits: Vec<BlastHitJs> = Vec::new();
    let mut db_len: usize = 0;

    let mut in_hit = false;
    let mut in_hsp = false;
    let mut current_accession = String::new();
    let mut current_description = String::new();
    let mut current_hit_len: usize = 0;
    let mut pending_tag = String::new();
    let mut hsp_hit_from: usize = 0;
    let mut hsp_hit_to: usize = 0;
    let mut hsp_score: i32 = 0;
    let mut hsp_evalue: f64 = 0.0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                pending_tag = name.clone();
                match name.as_str() {
                    "Hit" => {
                        in_hit = true;
                        current_accession.clear();
                        current_description.clear();
                        current_hit_len = 0;
                    }
                    "Hsp" => {
                        in_hsp = true;
                        hsp_hit_from = 0;
                        hsp_hit_to = 0;
                        hsp_score = 0;
                        hsp_evalue = 0.0;
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                pending_tag.clear();
                match name.as_str() {
                    "Hit" => in_hit = false,
                    "Hsp" => {
                        if in_hsp && in_hit && hsp_hit_from > 0 {
                            let strand = if hsp_hit_from <= hsp_hit_to { '+' } else { '-' };
                            let (from, to) = if strand == '+' {
                                (hsp_hit_from, hsp_hit_to)
                            } else {
                                (hsp_hit_to, hsp_hit_from)
                            };
                            hits.push(BlastHitJs {
                                accession: current_accession.clone(),
                                description: current_description.clone(),
                                subject_length: current_hit_len,
                                hit_from: from,
                                hit_to: to,
                                strand,
                                score: hsp_score,
                                evalue: hsp_evalue,
                            });
                        }
                        in_hsp = false;
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if pending_tag.is_empty() { continue; }
                let text = e.unescape().unwrap_or_default().to_string();
                let text = text.trim().to_string();
                if text.is_empty() { continue; }
                match pending_tag.as_str() {
                    "Hit_accession" | "accession" if in_hit && !in_hsp => {
                        current_accession = text;
                    }
                    "Hit_def" if in_hit && !in_hsp => current_description = text,
                    "Hit_len" if in_hit && !in_hsp => current_hit_len = text.parse().unwrap_or(0),
                    "Hsp_hit-from" if in_hsp => hsp_hit_from = text.parse().unwrap_or(0),
                    "Hsp_hit-to" if in_hsp => hsp_hit_to = text.parse().unwrap_or(0),
                    "Hsp_score" if in_hsp => hsp_score = text.parse().unwrap_or(0),
                    "Hsp_evalue" if in_hsp => hsp_evalue = text.parse().unwrap_or(0.0),
                    "Statistics_db-len" => db_len = text.parse().unwrap_or(0),
                    _ => {}
                }
            }
            Err(e) => return Err(JsError::new(&format!("XML parse error: {:?}", e))),
            _ => {}
        }
        buf.clear();
    }

    let result = BlastXmlResult { hits, db_len };
    Ok(serde_json::to_string(&result).unwrap())
}

#[derive(Serialize, Deserialize)]
struct BlastHitJs {
    accession: String,
    description: String,
    subject_length: usize,
    hit_from: usize,
    hit_to: usize,
    strand: char,
    score: i32,
    evalue: f64,
}

#[derive(Serialize)]
struct BlastXmlResult {
    hits: Vec<BlastHitJs>,
    db_len: usize,
}

// ─── Fetch Region Planning ───

/// Plan fetch regions from BLAST hits: group by accession, adaptively merge
/// nearby windows, cap by max_accessions. Returns JSON with regions + stats.
#[wasm_bindgen]
pub fn plan_fetch_regions(
    blast_hits_json: &str,
    query_json: &str,
    max_accessions: usize,
) -> Result<String, JsError> {
    let hits: Vec<BlastHitJs> =
        serde_json::from_str(blast_hits_json).map_err(|e| JsError::new(&e.to_string()))?;
    let query: StructuredQuery =
        serde_json::from_str(query_json).map_err(|e| JsError::new(&e.to_string()))?;

    // Convert BlastHitJs → BlastHit (core type)
    let core_hits: Vec<nnnblast_core::types::BlastHit> = hits
        .iter()
        .map(|h| nnnblast_core::types::BlastHit {
            accession: h.accession.clone(),
            description: h.description.clone(),
            subject_length: h.subject_length,
            hit_from: h.hit_from,
            hit_to: h.hit_to,
            strand: h.strand,
            score: h.score,
            evalue: h.evalue,
        })
        .collect();

    let (regions, stats) = nnnblast_core::types::plan_fetch_regions(&core_hits, &query, max_accessions);

    let result = FetchPlanResult { regions, stats };
    Ok(serde_json::to_string(&result).unwrap())
}

#[derive(Serialize)]
struct FetchPlanResult {
    regions: Vec<nnnblast_core::types::FetchRegion>,
    stats: nnnblast_core::types::FetchPlanStats,
}

// ─── Motif Checking ───

/// Check all motifs in a fetched region. Returns JSON array of structured hits.
/// `query_json`: JSON of StructuredQuery
/// `region_fasta`: raw FASTA text from Efetch
/// `params_json`: JSON with max_mismatches, match_score, mismatch_score
#[wasm_bindgen]
pub fn check_motifs_in_region(
    query_json: &str,
    region_fasta: &str,
    accession: &str,
    description: &str,
    subject_length: usize,
    params_json: &str,
) -> Result<String, JsError> {
    let query: StructuredQuery =
        serde_json::from_str(query_json).map_err(|e| JsError::new(&e.to_string()))?;
    let params: SearchParamsJs =
        serde_json::from_str(params_json).map_err(|e| JsError::new(&e.to_string()))?;

    // Parse FASTA
    let region = parse_fasta_sequence(region_fasta);
    if region.len() < 50 {
        return Ok("[]".into());
    }

    let anchor_idx = select_anchor(&query);

    // Search both strands
    let mut hits = search_strand(accession, &region, '+', &query, &params, anchor_idx);
    let rc = reverse_complement(&region);
    hits.extend(search_strand(accession, &rc, '-', &query, &params, anchor_idx));

    // Set metadata
    for hit in &mut hits {
        hit.description = description.to_string();
        hit.subject_length = subject_length;
    }

    Ok(serde_json::to_string(&hits).unwrap())
}

#[derive(Deserialize)]
struct SearchParamsJs {
    max_mismatches: usize,
    match_score: i32,
    mismatch_score: i32,
}

fn search_strand(
    subject_id: &str,
    subject: &[u8],
    strand: char,
    query: &StructuredQuery,
    params: &SearchParamsJs,
    anchor_idx: usize,
) -> Vec<Hit> {
    let anchor = &query.motifs[anchor_idx];
    let anchor_len = anchor.sequence.len();
    let max_mm = anchor.max_mismatches.unwrap_or(params.max_mismatches);

    if subject.len() < anchor_len {
        return vec![];
    }

    let mut hits = Vec::new();

    for pos in 0..=(subject.len() - anchor_len) {
        let anchor_aln = match align_motif_in_window(
            anchor, anchor_idx, subject, pos, pos + anchor_len,
            params.match_score, params.mismatch_score, max_mm,
        ) {
            Some(a) => a,
            None => continue,
        };

        if let Some(hit) = extend_from_anchor(
            subject_id, subject, strand, query, params, anchor_idx, &anchor_aln,
        ) {
            hits.push(hit);
        }
    }
    hits
}

fn extend_from_anchor(
    subject_id: &str,
    subject: &[u8],
    strand: char,
    query: &StructuredQuery,
    params: &SearchParamsJs,
    anchor_idx: usize,
    anchor_aln: &MotifAlignment,
) -> Option<Hit> {
    let k = query.motifs.len();
    let mut alignments: Vec<Option<MotifAlignment>> = vec![None; k];
    alignments[anchor_idx] = Some(anchor_aln.clone());

    let mut prev_end = anchor_aln.subject_start + query.motifs[anchor_idx].sequence.len();
    for i in (anchor_idx + 1)..k {
        let gap = &query.gaps[i - 1];
        let motif = &query.motifs[i];
        let max_mm = motif.max_mismatches.unwrap_or(params.max_mismatches);
        let window_start = prev_end + gap.min;
        let window_end = prev_end + gap.max + motif.sequence.len();
        let aln = align_motif_in_window(
            motif, i, subject, window_start, window_end,
            params.match_score, params.mismatch_score, max_mm,
        )?;
        prev_end = aln.subject_start + motif.sequence.len();
        alignments[i] = Some(aln);
    }

    let mut prev_start = anchor_aln.subject_start;
    for i in (0..anchor_idx).rev() {
        let gap = &query.gaps[i];
        let motif = &query.motifs[i];
        let max_mm = motif.max_mismatches.unwrap_or(params.max_mismatches);
        let window_end = prev_start.checked_sub(gap.min)?;
        let window_start = prev_start.saturating_sub(gap.max + motif.sequence.len());
        let aln = align_motif_in_window(
            motif, i, subject, window_start, window_end,
            params.match_score, params.mismatch_score, max_mm,
        )?;
        prev_start = aln.subject_start;
        alignments[i] = Some(aln);
    }

    let motif_alignments: Vec<MotifAlignment> = alignments.into_iter().collect::<Option<Vec<_>>>()?;
    let total_score: i32 = motif_alignments.iter().map(|a| a.score).sum();

    Some(Hit {
        subject_id: subject_id.to_string(),
        description: String::new(),
        subject_length: 0,
        strand,
        motif_alignments,
        total_score,
        evalue: 0.0,
        bit_score: 0.0,
        genomic_start: 0,
        genomic_end: 0,
    })
}

// ─── E-value Scoring ───

/// Compute E-values for a JSON array of hits. Returns scored JSON.
#[wasm_bindgen]
pub fn score_hits(
    hits_json: &str,
    query_json: &str,
    db_size: usize,
    match_score: i32,
    mismatch_score: i32,
    evalue_cutoff: f64,
) -> Result<String, JsError> {
    let mut hits: Vec<Hit> =
        serde_json::from_str(hits_json).map_err(|e| JsError::new(&e.to_string()))?;
    let query: StructuredQuery =
        serde_json::from_str(query_json).map_err(|e| JsError::new(&e.to_string()))?;

    let base_freqs = [0.25f64; 4];

    for hit in &mut hits {
        let motif_scores: Vec<i32> = hit.motif_alignments.iter().map(|ma| ma.score).collect();
        hit.evalue = compute_evalue(
            &query, &motif_scores, db_size, 1,
            match_score, mismatch_score, &base_freqs,
        );
        hit.bit_score = raw_to_bit_score(hit.total_score);
    }

    hits.retain(|h| h.evalue <= evalue_cutoff);
    hits.sort_by(|a, b| a.evalue.partial_cmp(&b.evalue).unwrap());

    // Deduplicate
    let mut seen = std::collections::HashSet::new();
    hits.retain(|hit| {
        let first_start = hit.motif_alignments.first().map(|a| a.subject_start).unwrap_or(0);
        let key = format!("{}:{}:{}", hit.subject_id, hit.strand, first_start / 10);
        seen.insert(key)
    });

    Ok(serde_json::to_string(&hits).unwrap())
}

// ─── Helpers ───

fn parse_fasta_sequence(fasta: &str) -> Vec<u8> {
    let mut seq = Vec::new();
    for line in fasta.lines() {
        let line = line.trim();
        if line.starts_with('>') || line.is_empty() { continue; }
        for &b in line.as_bytes() {
            if b.is_ascii_alphabetic() {
                seq.push(b.to_ascii_uppercase());
            }
        }
    }
    seq
}
