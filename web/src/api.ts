import type { JobResult, SearchRequest } from "./types";

const BASE = "";

export async function submitSearch(
  req: SearchRequest
): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/api/search`, {
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
  const res = await fetch(`${BASE}/api/results/${jobId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}
