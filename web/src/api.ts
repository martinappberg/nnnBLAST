import type { JobResult, SearchRequest } from "./types";

/**
 * Detect whether we're running with a backend server (dev mode) or as a static site (WASM mode).
 * In dev mode, Vite proxies /api/* to localhost:3001.
 * In static mode (GitHub Pages), there's no /api endpoint.
 */
export function isServerMode(): boolean {
  // If running on localhost with the Vite dev server proxying to backend
  return import.meta.env.DEV && !import.meta.env.VITE_WASM_MODE;
}

// ─── Server mode API (existing backend) ───

export async function submitSearch(
  req: SearchRequest
): Promise<{ job_id: string }> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function getResults(jobId: string): Promise<JobResult> {
  const res = await fetch(`/api/results/${jobId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}
