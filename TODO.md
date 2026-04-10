# nnnBLAST — Outstanding Work

## Priority 1: Web Worker for WASM (fixes page unresponsive)

**Problem**: WASM `check_motifs_in_region` runs on the main thread and blocks the UI. With large queries (280bp motifs + 6kb gaps), scanning 50kb+ regions takes significant CPU time per accession, causing "Page Unresponsive" dialogs.

**Solution**: Move all WASM calls to a Web Worker.

### Architecture

```
Main Thread (React)          Web Worker (WASM)
├── UI rendering             ├── WASM module loaded here
├── Progress display         ├── check_motifs_in_region()
├── User interaction         ├── parse_blast_xml()
│                            ├── score_hits()
├── postMessage(region) ───> ├── process region
├── <── onmessage(hits)      ├── return hits
```

### Implementation

1. **Create `web/src/worker.ts`** — Web Worker that:
   - Loads and initializes WASM on startup
   - Receives messages: `{ type: "check_region", queryJson, fasta, accession, ... }`
   - Calls `wasm.check_motifs_in_region()` 
   - Posts back: `{ type: "region_result", hits, accession }`
   - Also handles: `parse_blast_xml`, `score_hits`, `parse_and_validate_query`

2. **Update `web/src/search.ts`** — Instead of calling WASM directly:
   - Create the worker: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`
   - Send regions to worker via `postMessage`
   - Receive results via `onmessage`
   - Worker processes regions without blocking main thread
   - Can even process multiple regions in parallel with a worker pool (2-4 workers)

3. **Vite config** — Vite handles Web Workers natively with `?worker` imports or `new Worker(new URL(...))` syntax. No extra config needed.

4. **Worker pool for parallelism** — Create N workers (e.g., `navigator.hardwareConcurrency` or 4), round-robin regions to them. Each worker has its own WASM instance. This gives true parallelism for the CPU-bound alignment work.

### Message protocol

```typescript
// Main → Worker
type WorkerRequest = 
  | { type: "init" }
  | { type: "parse_query", query: string }
  | { type: "parse_blast_xml", xml: string }
  | { type: "check_region", id: string, queryJson: string, fasta: string, accession: string, description: string, subjectLength: number, paramsJson: string }
  | { type: "score_hits", hitsJson: string, queryJson: string, dbSize: number, matchScore: number, mismatchScore: number, evalCutoff: number }

// Worker → Main  
type WorkerResponse =
  | { type: "ready" }
  | { type: "parse_query_result", result: string }
  | { type: "parse_blast_xml_result", result: string }
  | { type: "region_result", id: string, hits: Hit[] }
  | { type: "score_result", hits: Hit[] }
  | { type: "error", message: string }
```

---

## Priority 2: Fix genomic coordinates display

**Problem**: Alignment view shows "Genomic region: 0–0" because WASM search path doesn't set `genomic_start`/`genomic_end` on Hit objects.

**Fix**: In `search.ts`, after WASM returns hits for a region, set `hit.genomic_start = group.fetchStart` and `hit.genomic_end = group.fetchEnd` on each hit. (This was partially done but needs to be verified in the current code path.)

---

## Priority 3: Strand display consistency

**Problem**: Result card shows "– strand" (from BLAST) but alignment view shows "Strand: +" (from local scan on RC'd sequence). Confusing.

**Fix**: The alignment view should not show its own strand indicator — the card-level strand badge is the authoritative one. Remove "Strand:" from `AlignmentView.tsx` or make it match the parent Hit's strand.

---

## Priority 4: Server-side search also needs accession dedup

**Problem**: The Rust `search_ncbi()` in `search.rs` still fetches each BLAST hit individually (no accession dedup). The WASM path deduplicates but the server path doesn't.

**Fix**: Port the accession deduplication logic from `search.ts` to `search.rs`. Group BLAST hits by accession, compute widest fetch window per accession, fetch once.

---

## Priority 5: E-value = 0 display

**Problem**: Some hits show "E-value 0" which is mathematically impossible. Likely a floating point underflow.

**Fix**: In `stats.rs` / WASM scoring, if E-value computes to 0.0 or subnormal, clamp to a minimum like `1e-300` or display as "< 1e-300".

---

## Future Ideas

- **Position-specific scoring** — PSSM-like motifs where each position has variable conservation
- **Gapped alignment within motifs** — Smith-Waterman for longer motifs with indels
- **Result export** — CSV/TSV download of results
- **Batch queries** — Submit multiple structured queries at once
- **Local FASTA mode in browser** — Drag-and-drop a FASTA file, search with WASM (no NCBI needed)
- **Empirical E-value calibration** — Fit λ/K from actual score distributions
