/**
 * Browser-side nnnBLAST search pipeline.
 *
 * Orchestrates: WASM (parsing, alignment, scoring) + NCBI (BLAST, Efetch via CORS proxy).
 * This replaces the Rust server for static-site deployment.
 */

import type { SearchResults, Hit } from "./types";

// WASM module — loaded dynamically
let wasm: typeof import("./wasm/nnnblast_wasm") | null = null;

export async function initWasm() {
  if (wasm) return wasm;
  const mod = await import("./wasm/nnnblast_wasm");
  await mod.default(); // initialize WASM
  wasm = mod;
  return wasm;
}

const BLAST_URL = "https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi";
const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

export interface WasmSearchParams {
  query: string;
  database: string;
  email: string;
  apiKey?: string;
  evalCutoff: number;
  proxyUrl: string; // Cloudflare Worker URL
  onProgress: (stage: string, detail?: string) => void;
}

interface BlastHitParsed {
  accession: string;
  description: string;
  subject_length: number;
  hit_from: number;
  hit_to: number;
  strand: string;
  score: number;
  evalue: number;
}

interface BlastXmlParsed {
  hits: BlastHitParsed[];
  db_len: number;
}

function proxyFetch(proxyUrl: string, targetUrl: string, options?: RequestInit): Promise<Response> {
  const proxied = `${proxyUrl}?url=${encodeURIComponent(targetUrl)}`;
  return fetch(proxied, options);
}

/**
 * Full browser-side search pipeline.
 */
export async function searchWasm(params: WasmSearchParams): Promise<SearchResults> {
  const w = await initWasm();
  const { onProgress } = params;

  // Step 1: Parse query (WASM)
  onProgress("parsing");
  const parseResult = w.parse_and_validate_query(params.query);
  const parsed = JSON.parse(parseResult);

  // Step 2: Choose BLAST strategy (WASM)
  const strategyResult = w.choose_blast_strategy(JSON.stringify(parsed.query));
  const strategy = JSON.parse(strategyResult);

  // Step 3: Submit BLAST via proxy
  onProgress("submitting_blast", `Anchor: ${strategy.blast_query} (${strategy.blast_query.length}bp)`);

  const blastParams = new URLSearchParams({
    CMD: "Put",
    PROGRAM: "blastn",
    DATABASE: params.database,
    QUERY: strategy.blast_query,
    EXPECT: "100000",
    HITLIST_SIZE: "500",
    MEGABLAST: "no",
    WORD_SIZE: strategy.blast_query.length < 30 ? "7" : "11",
    FILTER: "F",
    TOOL: "nnnblast",
    EMAIL: params.email,
    FORMAT_TYPE: "XML",
  });

  const submitResp = await proxyFetch(
    params.proxyUrl,
    `${BLAST_URL}?${blastParams.toString()}`
  );
  const submitText = await submitResp.text();

  const ridMatch = submitText.match(/RID = (\S+)/);
  if (!ridMatch) throw new Error("Failed to get BLAST RID");
  const rid = ridMatch[1];

  // Step 4: Poll for BLAST results
  onProgress("waiting_for_blast", `RID: ${rid}`);

  let blastXml = "";
  const maxWait = 600_000; // 10 min
  const pollInterval = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await sleep(pollInterval);

    const pollResp = await proxyFetch(
      params.proxyUrl,
      `${BLAST_URL}?CMD=Get&RID=${rid}&FORMAT_TYPE=XML`
    );
    const pollText = await pollResp.text();

    if (pollText.includes("Status=WAITING")) {
      onProgress("waiting_for_blast", `RID: ${rid}`);
      continue;
    }
    if (pollText.includes("Status=FAILED") || pollText.includes("Status=UNKNOWN")) {
      throw new Error("BLAST search failed or RID expired");
    }

    blastXml = pollText;
    break;
  }

  if (!blastXml) throw new Error("BLAST timeout");

  // Step 5: Parse BLAST XML (WASM)
  const blastResult: BlastXmlParsed = JSON.parse(w.parse_blast_xml(blastXml));

  if (blastResult.hits.length === 0) {
    return {
      hits: [],
      database_size: blastResult.db_len,
      num_sequences: 0,
      query_info: "0 BLAST hits",
    };
  }

  // Step 6: Fetch regions and check motifs
  const totalHits = blastResult.hits.length;
  const querySpan =
    parsed.query.motifs.reduce((s: number, m: { sequence: number[] }) => s + m.sequence.length, 0) +
    parsed.query.gaps.reduce((s: number, g: { max: number }) => s + g.max, 0);
  const padding = querySpan + 50;

  const searchParams = JSON.stringify({
    max_mismatches: 2,
    match_score: 2,
    mismatch_score: -3,
  });

  const allHits: Hit[] = [];
  const concurrency = 3;
  let completed = 0;

  // Process in batches
  for (let i = 0; i < totalHits; i += concurrency) {
    const batch = blastResult.hits.slice(i, i + concurrency);
    const promises = batch.map(async (hit) => {
      const fetchStart = Math.max(1, hit.hit_from - padding);
      const fetchEnd = hit.hit_to + padding;

      try {
        const efetchUrl = `${EFETCH_URL}?db=nuccore&id=${hit.accession}&rettype=fasta&retmode=text&seq_start=${fetchStart}&seq_stop=${fetchEnd}`;
        const resp = await proxyFetch(params.proxyUrl, efetchUrl);
        const fasta = await resp.text();

        const hitsJson = w.check_motifs_in_region(
          JSON.stringify(parsed.query),
          fasta,
          hit.accession,
          hit.description,
          hit.subject_length,
          searchParams,
        );
        return JSON.parse(hitsJson) as Hit[];
      } catch {
        return [] as Hit[];
      }
    });

    const batchResults = await Promise.all(promises);
    for (const hits of batchResults) {
      allHits.push(...hits);
    }
    completed += batch.length;
    onProgress("fetching_regions", `${completed}/${totalHits}`);

    // Rate limit
    if (i + concurrency < totalHits) {
      await sleep(350);
    }
  }

  // Step 7: Score (WASM)
  onProgress("analyzing");
  const scoredJson = w.score_hits(
    JSON.stringify(allHits),
    JSON.stringify(parsed.query),
    blastResult.db_len,
    2,  // match_score
    -3, // mismatch_score
    params.evalCutoff,
  );
  const scoredHits: Hit[] = JSON.parse(scoredJson);

  return {
    hits: scoredHits,
    database_size: blastResult.db_len,
    num_sequences: totalHits,
    query_info: `${parsed.query.motifs.length} motifs, ${parsed.query.gaps.length} gaps, ${totalHits} BLAST candidates, ${scoredHits.length} structured hits`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
