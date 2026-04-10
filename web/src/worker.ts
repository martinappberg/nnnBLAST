/**
 * Web Worker for nnnBLAST WASM computation.
 *
 * Loads the WASM module and handles CPU-intensive operations off the main thread:
 * - parse_and_validate_query
 * - choose_blast_strategy
 * - parse_blast_xml
 * - check_motifs_in_region
 * - score_hits
 */

import init, {
  parse_and_validate_query,
  choose_blast_strategy,
  parse_blast_xml,
  check_motifs_in_region,
  score_hits,
} from "./wasm/nnnblast_wasm";

// ─── Message types ───

export type WorkerRequest =
  | { type: "init" }
  | { type: "parse_query"; id: string; query: string }
  | { type: "choose_strategy"; id: string; queryJson: string }
  | { type: "parse_blast_xml"; id: string; xml: string }
  | {
      type: "check_region";
      id: string;
      queryJson: string;
      fasta: string;
      accession: string;
      description: string;
      subjectLength: number;
      paramsJson: string;
    }
  | {
      type: "score_hits";
      id: string;
      hitsJson: string;
      queryJson: string;
      dbSize: number;
      matchScore: number;
      mismatchScore: number;
      evalCutoff: number;
    };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; id: string; data: string }
  | { type: "error"; id: string; message: string };

// ─── Worker logic ───

let ready = false;

async function initialize() {
  await init();
  ready = true;
  self.postMessage({ type: "ready" } satisfies WorkerResponse);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      await initialize();
    } catch (err) {
      self.postMessage({
        type: "error",
        id: "__init__",
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (!ready) {
    self.postMessage({
      type: "error",
      id: msg.id,
      message: "WASM not initialized",
    } satisfies WorkerResponse);
    return;
  }

  try {
    let result: string;

    switch (msg.type) {
      case "parse_query":
        result = parse_and_validate_query(msg.query);
        break;
      case "choose_strategy":
        result = choose_blast_strategy(msg.queryJson);
        break;
      case "parse_blast_xml":
        result = parse_blast_xml(msg.xml);
        break;
      case "check_region":
        result = check_motifs_in_region(
          msg.queryJson,
          msg.fasta,
          msg.accession,
          msg.description,
          msg.subjectLength,
          msg.paramsJson,
        );
        break;
      case "score_hits":
        result = score_hits(
          msg.hitsJson,
          msg.queryJson,
          msg.dbSize,
          msg.matchScore,
          msg.mismatchScore,
          msg.evalCutoff,
        );
        break;
      default:
        self.postMessage({
          type: "error",
          id: (msg as { id: string }).id,
          message: `Unknown message type`,
        } satisfies WorkerResponse);
        return;
    }

    self.postMessage({
      type: "result",
      id: msg.id,
      data: result,
    } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
