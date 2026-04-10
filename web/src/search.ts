/**
 * Browser-side nnnBLAST search pipeline with:
 * - Web Worker pool for WASM (no main-thread blocking)
 * - Accession deduplication (fetch each accession once)
 * - Adaptive concurrency (3 without API key, 10 with)
 * - User-controlled processing limits
 * - localStorage persistence & checkpoint/resume
 * - Per-fetch retry with exponential backoff
 * - AbortController cancellation
 * - Clear error messages for every failure mode
 */

import type { SearchResults, Hit } from "./types";
import type { WorkerRequest, WorkerResponse } from "./worker";

// ─── Worker Pool ───

const POOL_SIZE = Math.min(navigator.hardwareConcurrency || 4, 4);

interface PendingCall {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  ready: boolean;
  pending: Map<string, PendingCall>;
}

let pool: PoolWorker[] | null = null;
let poolReadyPromise: Promise<void> | null = null;
let roundRobin = 0;

function createPool(): Promise<void> {
  if (poolReadyPromise) return poolReadyPromise;

  pool = [];
  const readyPromises: Promise<void>[] = [];

  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const pw: PoolWorker = { worker, ready: false, pending: new Map() };

    const readyP = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Worker init timeout")),
        30000,
      );
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === "ready") {
          pw.ready = true;
          clearTimeout(timeout);
          // Install permanent handler
          worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
            handleWorkerMessage(pw, ev.data);
          };
          resolve();
          return;
        }
        if (msg.type === "error" && msg.id === "__init__") {
          clearTimeout(timeout);
          reject(new Error(msg.message));
          return;
        }
        // Shouldn't happen during init, but handle gracefully
        handleWorkerMessage(pw, msg);
      };
    });

    worker.postMessage({ type: "init" } satisfies WorkerRequest);
    pool.push(pw);
    readyPromises.push(readyP);
  }

  poolReadyPromise = Promise.all(readyPromises).then(() => {});
  return poolReadyPromise;
}

function handleWorkerMessage(pw: PoolWorker, msg: WorkerResponse) {
  if (msg.type === "result") {
    const p = pw.pending.get(msg.id);
    if (p) {
      pw.pending.delete(msg.id);
      p.resolve(msg.data);
    }
  } else if (msg.type === "error" && msg.id !== "__init__") {
    const p = pw.pending.get(msg.id);
    if (p) {
      pw.pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  }
}

/** Pick a worker (round-robin) and send a request. */
function callWorker(request: WorkerRequest & { id: string }): Promise<string> {
  if (!pool || pool.length === 0) {
    return Promise.reject(new Error("Worker pool not initialized"));
  }
  const pw = pool[roundRobin % pool.length];
  roundRobin++;

  return new Promise<string>((resolve, reject) => {
    pw.pending.set(request.id, { resolve, reject });
    pw.worker.postMessage(request);
  });
}

let callId = 0;
function nextId(): string {
  return String(++callId);
}

// ─── WASM-via-worker helpers (same API shape as direct WASM calls) ───

export async function initWasm() {
  await createPool();
}

async function wasmParseQuery(query: string): Promise<string> {
  return callWorker({ type: "parse_query", id: nextId(), query });
}

async function wasmChooseStrategy(queryJson: string): Promise<string> {
  return callWorker({ type: "choose_strategy", id: nextId(), queryJson });
}

async function wasmParseBlastXml(xml: string): Promise<string> {
  return callWorker({ type: "parse_blast_xml", id: nextId(), xml });
}

async function wasmCheckRegion(
  queryJson: string,
  fasta: string,
  accession: string,
  description: string,
  subjectLength: number,
  paramsJson: string,
): Promise<string> {
  return callWorker({
    type: "check_region",
    id: nextId(),
    queryJson,
    fasta,
    accession,
    description,
    subjectLength,
    paramsJson,
  });
}

async function wasmScoreHits(
  hitsJson: string,
  queryJson: string,
  dbSize: number,
  matchScore: number,
  mismatchScore: number,
  evalCutoff: number,
): Promise<string> {
  return callWorker({
    type: "score_hits",
    id: nextId(),
    hitsJson,
    queryJson,
    dbSize,
    matchScore,
    mismatchScore,
    evalCutoff,
  });
}

// ─── Types ───

const BLAST_URL = "https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi";
const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const STORAGE_KEY = "nnnblast_active_job";

export type Phase =
  | "blast_submitting"
  | "blast_polling"
  | "blast_done"
  | "deduplicating"
  | "fetching"
  | "scoring"
  | "complete"
  | "error"
  | "cancelled";

export interface PersistedJob {
  id: string;
  query: string;
  database: string;
  email: string;
  apiKey?: string;
  evalCutoff: number;
  maxAccessions: number;
  startedAt: string;
  updatedAt: string;
  phase: Phase;
  rid?: string;
  blastHitsJson?: string;
  dbSize?: number;
  totalBlastHits?: number;
  uniqueAccessions?: number;
  cappedAt?: number;
  accessionQueue?: string[];
  fetchedAccessions: string[];
  failedAccessions: string[];
  partialHits: Hit[];
  results?: SearchResults;
  error?: string;
  errorPhase?: string;
  retryCount: number;
}

export interface WasmSearchParams {
  query: string;
  database: string;
  email: string;
  apiKey?: string;
  evalCutoff: number;
  maxAccessions: number;
  proxyUrl: string;
  onProgress: (stage: string, detail?: string) => void;
  signal?: AbortSignal;
  resumeJob?: PersistedJob;
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

interface FetchRegion {
  accession: string;
  description: string;
  subject_length: number;
  fetchStart: number;
  fetchEnd: number;
  bestScore: number;
}

// ─── Persistence helpers ───

export function loadPersistedJob(): PersistedJob | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveJob(job: PersistedJob) {
  try {
    job.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
  } catch {
    // localStorage full — continue without persistence
  }
}

export function clearPersistedJob() {
  localStorage.removeItem(STORAGE_KEY);
}

function createJob(params: WasmSearchParams): PersistedJob {
  return {
    id: crypto.randomUUID(),
    query: params.query,
    database: params.database,
    email: params.email,
    apiKey: params.apiKey,
    evalCutoff: params.evalCutoff,
    maxAccessions: params.maxAccessions,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: "blast_submitting",
    fetchedAccessions: [],
    failedAccessions: [],
    partialHits: [],
    retryCount: 0,
  };
}

// ─── Network helpers ───

function proxyFetch(
  proxyUrl: string,
  targetUrl: string,
  signal?: AbortSignal,
  method: string = "GET",
): Promise<Response> {
  const proxied = `${proxyUrl}?url=${encodeURIComponent(targetUrl)}`;
  return fetch(proxied, { method, signal });
}

function appendApiKey(url: string, apiKey?: string): string {
  if (apiKey) return `${url}&api_key=${apiKey}`;
  return url;
}

async function fetchWithRetry(
  proxyUrl: string,
  url: string,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const resp = await proxyFetch(proxyUrl, url, signal);
      if (resp.status === 429) {
        const delay = Math.min(60000, 1000 * Math.pow(2, attempt + 4));
        await sleep(delay);
        continue;
      }
      if (resp.status >= 500 && attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      return resp;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }
  throw lastError || new Error("Fetch failed after retries");
}

// ─── Main search pipeline ───

export async function searchWasm(params: WasmSearchParams): Promise<SearchResults> {
  await initWasm();
  const job = params.resumeJob || createJob(params);

  if (!params.resumeJob) saveJob(job);

  try {
    return await runPipeline(params, job);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      job.phase = "cancelled";
      saveJob(job);
      throw new Error("Search cancelled. Your progress is saved — you can resume later.");
    }
    job.phase = "error";
    job.error = e instanceof Error ? e.message : String(e);
    job.errorPhase = job.phase;
    saveJob(job);
    throw e;
  }
}

async function runPipeline(
  params: WasmSearchParams,
  job: PersistedJob,
): Promise<SearchResults> {
  const { onProgress, signal, proxyUrl } = params;

  // ─── Phase: BLAST submission ───
  if (job.phase === "blast_submitting") {
    onProgress("submitting_blast");
    signal?.throwIfAborted();

    const parseResult = await wasmParseQuery(params.query);
    const parsed = JSON.parse(parseResult);
    const strategyResult = await wasmChooseStrategy(JSON.stringify(parsed.query));
    const strategy = JSON.parse(strategyResult);

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
    if (params.apiKey) blastParams.set("api_key", params.apiKey);

    onProgress("submitting_blast", `Anchor: ${strategy.blast_query.length}bp`);
    const submitResp = await proxyFetch(
      proxyUrl,
      `${BLAST_URL}?${blastParams.toString()}`,
      signal,
    );
    const submitText = await submitResp.text();
    const ridMatch = submitText.match(/RID = (\S+)/);
    if (!ridMatch) throw new Error("Failed to get BLAST RID from NCBI. Response may be malformed.");
    job.rid = ridMatch[1];
    job.phase = "blast_polling";
    saveJob(job);
  }

  // ─── Phase: BLAST polling ───
  if (job.phase === "blast_polling") {
    if (!job.rid) throw new Error("No RID saved — cannot poll. Please start a new search.");
    onProgress("waiting_for_blast", `RID: ${job.rid}`);

    const maxWait = 600_000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      signal?.throwIfAborted();
      await sleep(5000);

      const pollUrl = appendApiKey(
        `${BLAST_URL}?CMD=Get&RID=${job.rid}&FORMAT_TYPE=XML`,
        params.apiKey,
      );
      const pollResp = await fetchWithRetry(proxyUrl, pollUrl, signal);
      const pollText = await pollResp.text();

      if (pollText.includes("Status=WAITING")) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        onProgress("waiting_for_blast", `RID: ${job.rid} (${elapsed}s)`);
        continue;
      }
      if (pollText.includes("Status=FAILED") || pollText.includes("Status=UNKNOWN")) {
        throw new Error(`BLAST search failed or RID expired. RID: ${job.rid}`);
      }

      // Parse results (in worker)
      const blastResultJson = await wasmParseBlastXml(pollText);
      const blastResult: BlastXmlParsed = JSON.parse(blastResultJson);
      job.blastHitsJson = JSON.stringify(blastResult.hits);
      job.dbSize = blastResult.db_len;
      job.totalBlastHits = blastResult.hits.length;
      job.phase = "blast_done";
      saveJob(job);
      break;
    }

    if (job.phase === "blast_polling") {
      throw new Error(`BLAST timeout after 10 minutes. RID: ${job.rid}. NCBI may be busy — try resuming later.`);
    }
  }

  // ─── Phase: Dedup ───
  if (job.phase === "blast_done" || job.phase === "deduplicating") {
    job.phase = "deduplicating";
    onProgress("deduplicating", `${job.totalBlastHits} BLAST hits`);
    signal?.throwIfAborted();

    const blastHits: BlastHitParsed[] = JSON.parse(job.blastHitsJson || "[]");

    if (blastHits.length === 0) {
      job.phase = "complete";
      job.results = {
        hits: [],
        database_size: job.dbSize || 0,
        num_sequences: 0,
        query_info: "0 BLAST hits",
      };
      saveJob(job);
      clearPersistedJob();
      return job.results;
    }

    // Parse query for span calculation
    const parseResult = await wasmParseQuery(params.query);
    const parsed = JSON.parse(parseResult);
    const querySpan =
      parsed.query.motifs.reduce((s: number, m: { sequence: number[] }) => s + m.sequence.length, 0) +
      parsed.query.gaps.reduce((s: number, g: { max: number }) => s + g.max, 0);
    const padding = querySpan + 50;

    // Group by accession, then merge only overlapping windows (not all into one)
    const perAccession = new Map<string, { description: string; subject_length: number; hits: BlastHitParsed[] }>();
    for (const hit of blastHits) {
      let entry = perAccession.get(hit.accession);
      if (!entry) {
        entry = { description: hit.description, subject_length: hit.subject_length, hits: [] };
        perAccession.set(hit.accession, entry);
      }
      entry.hits.push(hit);
    }

    // For each accession, compute non-overlapping fetch windows
    const allRegions: FetchRegion[] = [];
    for (const [accession, entry] of perAccession) {
      // Build individual windows per hit, then merge overlapping ones
      const windows = entry.hits.map((h) => ({
        start: Math.max(1, h.hit_from - padding),
        end: h.hit_to + padding,
        bestScore: h.score,
      }));
      windows.sort((a, b) => a.start - b.start);

      // Merge overlapping/adjacent windows
      const merged: { start: number; end: number; bestScore: number }[] = [];
      for (const w of windows) {
        const last = merged[merged.length - 1];
        if (last && w.start <= last.end) {
          last.end = Math.max(last.end, w.end);
          last.bestScore = Math.max(last.bestScore, w.bestScore);
        } else {
          merged.push({ ...w });
        }
      }

      for (const m of merged) {
        allRegions.push({
          accession,
          description: entry.description,
          subject_length: entry.subject_length,
          fetchStart: m.start,
          fetchEnd: m.end,
          bestScore: m.bestScore,
        });
      }
    }

    // Sort by best BLAST score, cap by unique accessions
    allRegions.sort((a, b) => b.bestScore - a.bestScore);
    job.uniqueAccessions = perAccession.size;

    // Cap by unique accessions: keep all regions for the top N accessions
    let regions = allRegions;
    if (params.maxAccessions > 0 && perAccession.size > params.maxAccessions) {
      job.cappedAt = params.maxAccessions;
      // Find which accessions are in the top N (by best score across their regions)
      const bestPerAccession = new Map<string, number>();
      for (const r of allRegions) {
        bestPerAccession.set(r.accession, Math.max(bestPerAccession.get(r.accession) || 0, r.bestScore));
      }
      const topAccessions = new Set(
        [...bestPerAccession.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, params.maxAccessions)
          .map(([acc]) => acc),
      );
      regions = allRegions.filter((r) => topAccessions.has(r.accession));
    }

    job.accessionQueue = regions.map((g) => JSON.stringify(g));
    job.phase = "fetching";
    saveJob(job);

    onProgress(
      "deduplicating",
      `${blastHits.length} hits → ${perAccession.size} unique accessions, ${regions.length} regions${job.cappedAt ? ` (top ${job.cappedAt} accessions)` : ""}`,
    );
  }

  // ─── Phase: Fetch + check (workers handle alignment in parallel) ───
  if (job.phase === "fetching") {
    const queue: FetchRegion[] = (job.accessionQueue || []).map((s) => JSON.parse(s));
    // fetchedAccessions tracks "accession:start-end" keys for region-level resume
    const fetchedSet = new Set(job.fetchedAccessions);
    const regionKey = (r: FetchRegion) => `${r.accession}:${r.fetchStart}-${r.fetchEnd}`;
    const remaining = queue.filter((g) => !fetchedSet.has(regionKey(g)));
    const total = queue.length;

    const concurrency = params.apiKey ? 10 : 3;
    const delay = params.apiKey ? 100 : 350;

    const searchParams = JSON.stringify({
      max_mismatches: 2,
      match_score: 2,
      mismatch_score: -3,
    });

    const parseResult = await wasmParseQuery(params.query);
    const parsed = JSON.parse(parseResult);
    const queryJson = JSON.stringify(parsed.query);

    let checkpointCounter = 0;

    for (let i = 0; i < remaining.length; i += concurrency) {
      signal?.throwIfAborted();
      const batch = remaining.slice(i, i + concurrency);

      const promises = batch.map(async (group) => {
        const efetchUrl = appendApiKey(
          `${EFETCH_URL}?db=nuccore&id=${group.accession}&rettype=fasta&retmode=text&seq_start=${group.fetchStart}&seq_stop=${group.fetchEnd}`,
          params.apiKey,
        );
        try {
          const resp = await fetchWithRetry(proxyUrl, efetchUrl, signal);
          if (!resp.ok) {
            job.failedAccessions.push(regionKey(group));
            return [];
          }
          const fasta = await resp.text();
          // WASM alignment runs in a Web Worker — no main thread blocking
          const hitsJson = await wasmCheckRegion(
            queryJson,
            fasta,
            group.accession,
            group.description,
            group.subject_length,
            searchParams,
          );
          return JSON.parse(hitsJson) as Hit[];
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          job.failedAccessions.push(regionKey(group));
          return [];
        }
      });

      const batchResults = await Promise.all(promises);
      for (const group of batch) {
        job.fetchedAccessions.push(regionKey(group));
      }
      for (const hits of batchResults) {
        job.partialHits.push(...hits);
      }

      checkpointCounter += batch.length;
      const done = job.fetchedAccessions.length;
      const pct = Math.round((done / total) * 100);
      const failCount = job.failedAccessions.length;
      const detail = `${done}/${total} regions (${pct}%)${failCount > 0 ? ` — ${failCount} failed` : ""}`;
      onProgress("fetching_regions", detail);

      // Checkpoint every 10 batches
      if (checkpointCounter >= 10) {
        saveJob(job);
        checkpointCounter = 0;
      }

      if (i + concurrency < remaining.length) {
        await sleep(delay);
      }
    }

    job.phase = "scoring";
    saveJob(job);
  }

  // ─── Phase: Score ───
  if (job.phase === "scoring") {
    onProgress("analyzing");
    signal?.throwIfAborted();

    const parseResult = await wasmParseQuery(params.query);
    const parsed = JSON.parse(parseResult);

    const scoredJson = await wasmScoreHits(
      JSON.stringify(job.partialHits),
      JSON.stringify(parsed.query),
      job.dbSize || 0,
      2,
      -3,
      params.evalCutoff,
    );
    const scoredHits: Hit[] = JSON.parse(scoredJson);

    const failedCount = job.failedAccessions.length;
    const results: SearchResults = {
      hits: scoredHits,
      database_size: job.dbSize || 0,
      num_sequences: job.uniqueAccessions || 0,
      query_info: [
        `${job.totalBlastHits} BLAST hits`,
        `${job.uniqueAccessions} unique accessions`,
        job.cappedAt ? `top ${job.cappedAt} processed` : undefined,
        `${scoredHits.length} structured hits`,
        failedCount > 0 ? `${failedCount} accessions failed` : undefined,
      ]
        .filter(Boolean)
        .join(" → "),
    };

    job.phase = "complete";
    job.results = results;
    saveJob(job);

    return results;
  }

  // If we somehow get here with phase=complete, return cached results
  if (job.phase === "complete" && job.results) {
    return job.results;
  }

  throw new Error(`Unexpected job phase: ${job.phase}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
