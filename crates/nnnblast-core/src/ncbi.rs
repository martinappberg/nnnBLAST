use crate::types::BlastHit;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

#[derive(Debug, Error)]
pub enum NcbiError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("BLAST submission failed: {0}")]
    SubmitFailed(String),
    #[error("BLAST polling failed: {0}")]
    PollFailed(String),
    #[error("BLAST timeout after {0} seconds")]
    Timeout(u64),
    #[error("XML parse error: {0}")]
    XmlParse(String),
    #[error("Efetch failed: {0}")]
    EfetchFailed(String),
}

const BLAST_URL: &str = "https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi";
const EFETCH_URL: &str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const POLL_INTERVAL: Duration = Duration::from_secs(5);
const BLAST_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes

/// Submit a BLAST query to NCBI. Returns the RID (Request Identifier).
/// IUPAC ambiguity codes are passed through — BLAST handles them natively
/// as long as the low-complexity filter is disabled (FILTER=F).
pub async fn submit_blast(
    client: &reqwest::Client,
    anchor_seq: &str,
    database: &str,
    email: &str,
    api_key: Option<&str>,
    evalue: f64,
    max_hits: usize,
) -> Result<String, NcbiError> {
    let mut params = vec![
        ("CMD", "Put".to_string()),
        ("PROGRAM", "blastn".to_string()),
        ("DATABASE", database.to_string()),
        ("QUERY", anchor_seq.to_string()),
        ("EXPECT", evalue.to_string()),
        ("HITLIST_SIZE", max_hits.to_string()),
        ("TOOL", "nnnblast".to_string()),
        ("EMAIL", email.to_string()),
        ("FORMAT_TYPE", "XML".to_string()),
    ];

    // Disable megablast (uses word_size=28, useless for short motifs)
    params.push(("MEGABLAST", "no".to_string()));

    // Always disable low-complexity filter: it masks IUPAC codes and short motifs
    params.push(("FILTER", "F".to_string()));

    // Short query tuning
    let qlen = anchor_seq.len();
    if qlen < 30 {
        params.push(("WORD_SIZE", "7".to_string()));
    }

    if let Some(key) = api_key {
        params.push(("api_key", key.to_string()));
    }

    let resp = client
        .post(BLAST_URL)
        .form(&params)
        .send()
        .await?;

    let text = resp.text().await?;

    // Extract RID from response
    let rid = extract_value(&text, "RID")
        .ok_or_else(|| NcbiError::SubmitFailed("No RID in response".into()))?;

    if rid.is_empty() {
        return Err(NcbiError::SubmitFailed("Empty RID".into()));
    }

    tracing::info!("BLAST submitted, RID={}, query={}", rid, anchor_seq);
    Ok(rid)
}

/// Poll NCBI BLAST for results. Returns parsed hits and database size.
pub async fn poll_blast_results(
    client: &reqwest::Client,
    rid: &str,
    api_key: Option<&str>,
) -> Result<(Vec<BlastHit>, usize), NcbiError> {
    let start = tokio::time::Instant::now();

    loop {
        if start.elapsed() > BLAST_TIMEOUT {
            return Err(NcbiError::Timeout(BLAST_TIMEOUT.as_secs()));
        }

        sleep(POLL_INTERVAL).await;

        let mut url = format!("{}?CMD=Get&RID={}&FORMAT_TYPE=XML", BLAST_URL, rid);
        if let Some(key) = api_key {
            url.push_str(&format!("&api_key={}", key));
        }

        let resp = client.get(&url).send().await?;
        let text = resp.text().await?;

        // Check status
        if text.contains("Status=WAITING") {
            tracing::debug!("BLAST still running...");
            continue;
        }

        if text.contains("Status=FAILED") || text.contains("Status=UNKNOWN") {
            return Err(NcbiError::PollFailed(
                "BLAST search failed or RID expired".into(),
            ));
        }

        // Results ready — parse XML
        let (hits, db_size) = parse_blast_xml(&text)?;
        tracing::info!("BLAST returned {} hits, db_size={}", hits.len(), db_size);
        return Ok((hits, db_size));
    }
}

/// Fetch a region of a nucleotide sequence from NCBI Efetch.
/// `start` and `end` are 1-based inclusive coordinates.
pub async fn fetch_region(
    client: &reqwest::Client,
    accession: &str,
    start: usize,
    end: usize,
    api_key: Option<&str>,
) -> Result<Vec<u8>, NcbiError> {
    let mut url = format!(
        "{}?db=nuccore&id={}&rettype=fasta&retmode=text&seq_start={}&seq_stop={}",
        EFETCH_URL, accession, start, end
    );
    if let Some(key) = api_key {
        url.push_str(&format!("&api_key={}", key));
    }

    let resp = client
        .get(&url)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(NcbiError::EfetchFailed(format!(
            "HTTP {} for {}",
            resp.status(),
            accession
        )));
    }

    let text = resp.text().await?;
    let seq = parse_fasta_sequence(&text);

    if seq.is_empty() {
        return Err(NcbiError::EfetchFailed(format!(
            "Empty sequence for {} {}..{}",
            accession, start, end
        )));
    }

    Ok(seq)
}

// ─── Parsing helpers ───

/// Extract a value like `RID = ABCDEF` from BLAST text response.
fn extract_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim();
            if let Some(val) = rest.strip_prefix('=') {
                return Some(val.trim().to_string());
            }
        }
    }
    None
}

/// Parse BLAST XML output to extract hits and database size.
fn parse_blast_xml(xml: &str) -> Result<(Vec<BlastHit>, usize), NcbiError> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    // Strip DOCTYPE declaration (quick-xml can't resolve external DTDs)
    let cleaned: String = xml
        .lines()
        .filter(|line| !line.trim_start().starts_with("<!DOCTYPE"))
        .collect::<Vec<_>>()
        .join("\n");

    let mut reader = Reader::from_str(&cleaned);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut hits = Vec::new();
    let mut db_len: usize = 0;

    // State for parsing — track the tag we're about to read text for
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
                            let strand = if hsp_hit_from <= hsp_hit_to {
                                '+'
                            } else {
                                '-'
                            };
                            let (from, to) = if strand == '+' {
                                (hsp_hit_from, hsp_hit_to)
                            } else {
                                (hsp_hit_to, hsp_hit_from)
                            };
                            hits.push(BlastHit {
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
                if pending_tag.is_empty() {
                    continue;
                }
                let text = e.unescape().unwrap_or_default().to_string();
                let text = text.trim().to_string();
                if text.is_empty() {
                    continue;
                }

                // Match based on which tag this text belongs to
                match pending_tag.as_str() {
                    "Hit_accession" | "accession" if in_hit && !in_hsp => {
                        current_accession = text;
                    }
                    "Hit_def" if in_hit && !in_hsp => {
                        current_description = text;
                    }
                    "Hit_len" if in_hit && !in_hsp => {
                        current_hit_len = text.parse().unwrap_or(0);
                    }
                    "Hsp_hit-from" if in_hsp => {
                        hsp_hit_from = text.parse().unwrap_or(0);
                    }
                    "Hsp_hit-to" if in_hsp => {
                        hsp_hit_to = text.parse().unwrap_or(0);
                    }
                    "Hsp_score" if in_hsp => {
                        hsp_score = text.parse().unwrap_or(0);
                    }
                    "Hsp_evalue" if in_hsp => {
                        hsp_evalue = text.parse().unwrap_or(0.0);
                    }
                    "Statistics_db-len" => {
                        db_len = text.parse().unwrap_or(0);
                    }
                    _ => {}
                }
            }
            Err(e) => {
                return Err(NcbiError::XmlParse(format!(
                    "XML error at position {}: {:?}",
                    reader.error_position(),
                    e
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok((hits, db_len))
}

/// Parse a FASTA response from Efetch into raw sequence bytes.
fn parse_fasta_sequence(fasta: &str) -> Vec<u8> {
    let mut seq = Vec::new();
    for line in fasta.lines() {
        let line = line.trim();
        if line.starts_with('>') || line.is_empty() {
            continue;
        }
        for &b in line.as_bytes() {
            if b.is_ascii_alphabetic() {
                seq.push(b.to_ascii_uppercase());
            }
        }
    }
    seq
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_value() {
        let text = "    RID = ABC123\n    RTOE = 30\n";
        assert_eq!(extract_value(text, "RID"), Some("ABC123".into()));
        assert_eq!(extract_value(text, "RTOE"), Some("30".into()));
    }

    #[test]
    fn test_parse_fasta_sequence() {
        let fasta = ">seq1 description\nATCGATCG\nGGCCAAT\n";
        let seq = parse_fasta_sequence(fasta);
        assert_eq!(seq, b"ATCGATCGGGCCAAT");
    }

    #[test]
    fn test_parse_blast_xml_real_format() {
        // Matches actual NCBI BLAST XML output format
        let xml = r#"<?xml version="1.0" encoding="US-ASCII"?>
<!DOCTYPE BlastOutput PUBLIC "-//NCBI//NCBI BlastOutput/EN" "http://www.ncbi.nlm.nih.gov/dtd/NCBI_BlastOutput.dtd">
<BlastOutput>
  <BlastOutput_program>blastn</BlastOutput_program>
  <BlastOutput_iterations>
    <Iteration>
      <Iteration_hits>
        <Hit>
          <Hit_num>1</Hit_num>
          <Hit_id>gi|168823576|gb|AC204904.10|</Hit_id>
          <Hit_accession>AC204904</Hit_accession>
          <Hit_len>190203</Hit_len>
          <Hit_hsps>
            <Hsp>
              <Hsp_num>1</Hsp_num>
              <Hsp_bit-score>35.55</Hsp_bit-score>
              <Hsp_score>38</Hsp_score>
              <Hsp_evalue>58.97</Hsp_evalue>
              <Hsp_query-from>1</Hsp_query-from>
              <Hsp_query-to>19</Hsp_query-to>
              <Hsp_hit-from>1000</Hsp_hit-from>
              <Hsp_hit-to>1018</Hsp_hit-to>
              <Hsp_hit-frame>1</Hsp_hit-frame>
              <Hsp_identity>19</Hsp_identity>
            </Hsp>
          </Hit_hsps>
        </Hit>
      </Iteration_hits>
      <Iteration_stat>
        <Statistics>
          <Statistics_db-num>124278414</Statistics_db-num>
          <Statistics_db-len>991049906671</Statistics_db-len>
        </Statistics>
      </Iteration_stat>
    </Iteration>
  </BlastOutput_iterations>
</BlastOutput>"#;

        let (hits, db_len) = parse_blast_xml(xml).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].accession, "AC204904");
        assert_eq!(hits[0].hit_from, 1000);
        assert_eq!(hits[0].hit_to, 1018);
        assert_eq!(hits[0].strand, '+');
        assert_eq!(hits[0].score, 38);
        assert_eq!(db_len, 991_049_906_671);
    }

    #[test]
    fn test_minus_strand_detection() {
        let xml = r#"<?xml version="1.0"?>
<BlastOutput>
  <BlastOutput_iterations>
    <Iteration>
      <Iteration_hits>
        <Hit>
          <Hit_accession>NC_000002</Hit_accession>
          <Hit_hsps>
            <Hsp>
              <Hsp_hit-from>164016</Hsp_hit-from>
              <Hsp_hit-to>163998</Hsp_hit-to>
              <Hsp_hit-frame>-1</Hsp_hit-frame>
              <Hsp_score>38</Hsp_score>
              <Hsp_evalue>58.97</Hsp_evalue>
            </Hsp>
          </Hit_hsps>
        </Hit>
      </Iteration_hits>
      <Iteration_stat>
        <Statistics>
          <Statistics_db-len>1000000</Statistics_db-len>
        </Statistics>
      </Iteration_stat>
    </Iteration>
  </BlastOutput_iterations>
</BlastOutput>"#;

        let (hits, _) = parse_blast_xml(xml).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].strand, '-');
        assert_eq!(hits[0].hit_from, 163998);
        assert_eq!(hits[0].hit_to, 164016);
    }
}
