import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Link, useSearchParams } from "react-router-dom";
import { submitSearch, getResults, isServerMode } from "./api";
import { searchWasm, loadPersistedJob, clearPersistedJob, type PersistedJob } from "./search";
import { QueryVisual } from "./components/QueryVisual";
import { ResultsTable } from "./components/ResultsTable";
import { HelpPanel } from "./components/HelpPanel";
import { AboutPage } from "./pages/About";
import type { JobProgress, SearchResults } from "./types";
import { DATABASES } from "./types";

// Cloudflare Worker CORS proxy URL — set this after deploying the proxy
const PROXY_URL = import.meta.env.VITE_PROXY_URL || "https://nnnblast-cors-proxy.nnnblast.workers.dev";

const EXAMPLE_PRESETS = [
  {
    name: "16S rRNA V4 region (515F\u2013806R)",
    query: "GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC",
    description:
      "Universal bacterial/archaeal 16S rRNA conserved primer sites flanking the V4 hypervariable region.",
    strategy: "Single anchor (19-20bp motifs)",
  },
  {
    name: "16S rRNA V1-V2 (27F\u2013338R)",
    query: "AGAGTTTGATCMTGGCTCAG[N:280-330]GCTGCCTCCCGTAGGAGT",
    description:
      "16S rRNA gene: 27F universal primer site + 338R primer site, flanking V1-V2 hypervariable regions.",
    strategy: "Single anchor (18-20bp motifs)",
  },
  {
    name: "23S rRNA conserved domains",
    query: "GGATGCCTTGGCYACTAGATG[N:40-80]CCTGTCACTTCGRTGAAGGAG",
    description:
      "23S ribosomal RNA conserved regions (domains IV-V), found across bacteria. Y=C/T, R=A/G.",
    strategy: "Single anchor (20-21bp motifs with IUPAC)",
  },
];

const STAGE_LABELS: Record<string, string> = {
  starting: "Starting...",
  submitting_blast: "Submitting to NCBI BLAST...",
  waiting_for_blast: "Waiting for BLAST results...",
  fetching_regions: "Fetching flanking regions...",
  analyzing: "Analyzing structured motifs...",
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function SearchPage() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("query") || "";

  const [query, setQuery] = useState(initialQuery);
  const [database, setDatabase] = useState("core_nt");
  const [email, setEmail] = useState(() => localStorage.getItem("nnnblast_email") || "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("nnnblast_api_key") || "");
  const [evalCutoff, setEvalCutoff] = useState(10);
  const [maxAccessions, setMaxAccessions] = useState(500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const [resumableJob, setResumableJob] = useState<PersistedJob | null>(null);
  const pollRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Check for resumable job on mount
  useEffect(() => {
    const saved = loadPersistedJob();
    if (saved && (saved.phase === "fetching" || saved.phase === "blast_polling" || saved.phase === "error")) {
      setResumableJob(saved);
    } else if (saved && saved.phase === "complete" && saved.results) {
      setResults(saved.results);
      setQuery(saved.query);
    }
  }, []);

  // Persist email and API key
  useEffect(() => { localStorage.setItem("nnnblast_email", email); }, [email]);
  useEffect(() => { localStorage.setItem("nnnblast_api_key", apiKey); }, [apiKey]);

  const timerRef = useRef<number | null>(null);

  // Elapsed time ticker (1s interval while loading)
  useEffect(() => {
    if (loading) {
      timerRef.current = window.setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading]);

  const extractMotifs = (q: string): string[] => {
    const motifs: string[] = [];
    let buf = "";
    let inBracket = false;
    for (const ch of q.toUpperCase()) {
      if (ch === "[" || ch === "{") {
        if (!inBracket && buf) {
          motifs.push(buf);
          buf = "";
        }
        inBracket = true;
      } else if (ch === "]" || ch === "}") {
        inBracket = false;
      } else if (!inBracket && /[A-Z]/.test(ch)) {
        buf += ch;
      }
    }
    if (buf) motifs.push(buf);
    return motifs;
  };

  const validateQuery = (q: string): string[] => {
    const warnings: string[] = [];
    const motifs = extractMotifs(q);
    if (motifs.length === 0) return warnings;
    const longestMotif = Math.max(...motifs.map((m) => m.length));
    if (longestMotif < 15) {
      warnings.push(
        `Longest motif is only ${longestMotif}bp. At least one motif should be ~15bp+ for NCBI BLAST to anchor on.`
      );
    }
    for (let i = 0; i < motifs.length; i++) {
      if (motifs[i].length < 4) {
        warnings.push(
          `Motif ${i + 1} ("${motifs[i]}") is very short (${motifs[i].length}bp). It may match everywhere.`
        );
      }
    }
    const invalidBases = q.replace(
      /[\[\]{}:0-9NnXxMmAaTtGgCcUuRrYySsWwKkBbDdHhVv\s-]/g,
      ""
    );
    if (invalidBases.length > 0) {
      warnings.push(`Invalid characters in query: "${invalidBases}"`);
    }
    return warnings;
  };

  const queryWarnings = validateQuery(query);

  const runSearch = useCallback(async (resumeJob?: PersistedJob) => {
    if (!resumeJob && !email.trim()) {
      setError("Email is required (NCBI policy).");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    setResumableJob(null);
    setProgress({ stage: "starting" });
    setElapsed(0);
    setPollCount(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (isServerMode() && !resumeJob) {
        const { job_id } = await submitSearch({
          query,
          database,
          email,
          api_key: apiKey || undefined,
          max_mismatches: 2,
          evalue_cutoff: evalCutoff,
        });
        const poll = async () => {
          try {
            const res = await getResults(job_id);
            if (res.status === "complete") {
              setResults(res.results!);
              setProgress(null);
              setLoading(false);
            } else if (res.status === "failed") {
              setError(res.error ?? "Search failed");
              setProgress(null);
              setLoading(false);
            } else {
              if (res.progress) setProgress(res.progress);
              setPollCount((c) => c + 1);
              pollRef.current = window.setTimeout(poll, 2000);
            }
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
            setProgress(null);
            setLoading(false);
          }
        };
        poll();
      } else {
        const searchResults = await searchWasm({
          query: resumeJob?.query || query,
          database: resumeJob?.database || database,
          email: resumeJob?.email || email,
          apiKey: resumeJob?.apiKey || apiKey || undefined,
          evalCutoff: resumeJob?.evalCutoff || evalCutoff,
          maxAccessions: resumeJob?.maxAccessions || maxAccessions,
          proxyUrl: PROXY_URL,
          onProgress: (stage, detail) => {
            setProgress({ stage, detail: detail ?? undefined });
            setPollCount((c) => c + 1);
          },
          signal: controller.signal,
          resumeJob,
        });
        setResults(searchResults);
        setProgress(null);
        setLoading(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setProgress(null);
      setLoading(false);
    }
  }, [query, database, email, apiKey, evalCutoff, maxAccessions]);

  const handleSearch = useCallback(() => runSearch(), [runSearch]);
  const handleResume = useCallback((job: PersistedJob) => runSearch(job), [runSearch]);
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setLoading(false);
    setProgress(null);
  }, []);
  const handleDiscard = useCallback(() => {
    clearPersistedJob();
    setResumableJob(null);
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Resume banner */}
      {resumableJob && !loading && (
        <section className="bg-[#FFF7ED] border border-[#F9A8B8]/40 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-[#1C1917]">
                Unfinished search from {new Date(resumableJob.startedAt).toLocaleString()}
              </div>
              <div className="text-sm text-[#57534E] mt-0.5">
                {resumableJob.phase === "fetching"
                  ? `${resumableJob.fetchedAccessions.length}/${resumableJob.accessionQueue?.length ?? "?"} accessions fetched. ${resumableJob.partialHits.length} hits found so far.`
                  : resumableJob.phase === "blast_polling"
                    ? `Waiting for BLAST results (RID: ${resumableJob.rid})`
                    : resumableJob.phase === "error"
                      ? `Failed during ${resumableJob.errorPhase}: ${resumableJob.error}`
                      : `Phase: ${resumableJob.phase}`}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 rounded-xl text-sm font-medium bg-[#F9A8B8] text-[#1C1917] hover:bg-[#F48BA0] transition-colors"
                onClick={() => handleResume(resumableJob)}
              >
                Resume
              </button>
              <button
                className="px-4 py-2 rounded-xl text-sm text-[#A8A29E] hover:text-[#D7827E] transition-colors"
                onClick={handleDiscard}
              >
                Discard
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Query section */}
      <section className="bg-white rounded-2xl shadow-sm border border-[#FECDD3]/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1C1917]">Query</h2>
          <HelpPanel />
        </div>

        {/* Example presets */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-[#A8A29E] self-center mr-1">
            Examples:
          </span>
          {EXAMPLE_PRESETS.map((preset, i) => (
            <button
              key={i}
              className="text-xs px-3 py-1.5 rounded-full border border-[#FECDD3]/50 hover:border-[#F9A8B8] hover:bg-[#FFF0F3] transition-colors text-[#57534E]"
              onClick={() => setQuery(preset.query)}
              title={`${preset.description}\n\nBLAST strategy: ${preset.strategy}`}
            >
              {preset.name}
            </button>
          ))}
        </div>

        <textarea
          className="w-full border border-[#FECDD3]/50 rounded-xl px-4 py-3 font-mono text-sm focus:ring-2 focus:ring-[#F9A8B8] focus:border-[#F9A8B8] outline-none bg-white"
          rows={2}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC"
          spellCheck={false}
        />
        <QueryVisual query={query} />

        {/* Query validation warnings */}
        {queryWarnings.length > 0 && (
          <div className="space-y-1">
            {queryWarnings.map((w, i) => (
              <div
                key={i}
                className="text-xs px-3 py-2 rounded-lg bg-[#FFF0ED] border border-[#D7827E]/30 text-[#D7827E]"
              >
                {w}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-[#A8A29E]">
          At least one motif should be ~15bp+ for NCBI BLAST. Shorter motifs work as flanking
          constraints. IUPAC codes (R, Y, M, K, S, W, B, D, H, V) for ambiguity. X = any base
          (penalized). N = gap shorthand.
        </p>
      </section>

      {/* Parameters section */}
      <section className="bg-white rounded-2xl shadow-sm border border-[#FECDD3]/50 p-6">
        <h2 className="text-lg font-semibold text-[#1C1917] mb-4">
          Parameters
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Database */}
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">
              Database
            </label>
            <select
              className="w-full border border-[#FECDD3]/50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F9A8B8] outline-none"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
            >
              {DATABASES.map((db) => (
                <option key={db.value} value={db.value}>
                  {db.label}
                </option>
              ))}
            </select>
          </div>

          {/* E-value cutoff */}
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">
              E-value cutoff
            </label>
            <select
              className="w-full border border-[#FECDD3]/50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F9A8B8] outline-none"
              value={evalCutoff}
              onChange={(e) => setEvalCutoff(Number(e.target.value))}
            >
              <option value={0.001}>0.001</option>
              <option value={0.01}>0.01</option>
              <option value={0.1}>0.1</option>
              <option value={1}>1</option>
              <option value={10}>10 (default)</option>
              <option value={100}>100</option>
              <option value={1000}>1000</option>
            </select>
            <p className="text-[10px] text-[#A8A29E] mt-0.5">Lower = stricter. Only show hits expected &lt;N times by chance</p>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">
              Email <span className="text-[#D7827E]">*</span>
            </label>
            <input
              type="email"
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F9A8B8] outline-none ${
                !email.trim() ? "border-[#D7827E]/40 bg-[#FFF8F7]" : "border-[#FECDD3]/50"
              }`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-[10px] text-[#A8A29E] mt-0.5">Required by NCBI usage policy</p>
          </div>

          {/* API key (optional) */}
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">
              NCBI API key
            </label>
            <input
              type="text"
              className="w-full border border-[#FECDD3]/50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F9A8B8] outline-none"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Optional — speeds up search 3x"
            />
            <p className="text-[10px] text-[#A8A29E] mt-0.5">
              Get one free at{" "}
              <a href="https://www.ncbi.nlm.nih.gov/account/settings/" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#57534E]">
                ncbi.nlm.nih.gov/account
              </a>
            </p>
          </div>

          {/* Max sequences to process */}
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">
              Max sequences to scan
            </label>
            <select
              className="w-full border border-[#FECDD3]/50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F9A8B8] outline-none"
              value={maxAccessions}
              onChange={(e) => setMaxAccessions(Number(e.target.value))}
            >
              <option value={100}>100</option>
              <option value={500}>500 (default)</option>
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
              <option value={0}>All (no limit)</option>
            </select>
            <p className="text-[10px] text-[#A8A29E] mt-0.5">Top BLAST hits to check for structured motifs</p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            className="bg-[#F9A8B8] text-[#1C1917] px-8 py-2.5 rounded-xl font-semibold hover:bg-[#F48BA0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            onClick={handleSearch}
            disabled={loading || !query.trim() || !email.trim()}
          >
            {loading ? "Searching..." : "Search NCBI"}
          </button>
          {loading && (
            <button
              className="px-4 py-2.5 rounded-xl text-sm text-[#D7827E] border border-[#D7827E]/30 hover:bg-[#D7827E]/10 transition-colors"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
          {!loading && !email.trim() && query.trim() && (
            <span className="text-xs text-[#D7827E]">Enter your email to enable search</span>
          )}
        </div>
      </section>

      {/* Progress */}
      {loading && progress && (
        <section className="bg-[#FFF0F3] border border-[#FECDD3]/50 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-[#F9A8B8] border-t-transparent rounded-full" />
              <div>
                <div className="font-medium text-[#1C1917]">
                  {STAGE_LABELS[progress.stage] || progress.stage}
                </div>
                {progress.detail && (
                  <div className="text-sm text-[#E8889A]">
                    {progress.detail}
                  </div>
                )}
              </div>
            </div>
            <div className="text-right text-xs text-[#E8889A] font-mono tabular-nums">
              <div>{formatElapsed(elapsed)}</div>
              {pollCount > 0 && (
                <div className="text-[#D7827E]">
                  {pollCount} check{pollCount !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Error */}
      {error && (
        <section className="bg-[#FFF0ED] border border-[#D7827E]/30 text-[#D7827E] rounded-2xl p-4 text-sm">
          {error}
        </section>
      )}

      {/* Results */}
      {results && (
        <section className="bg-white rounded-2xl shadow-sm border border-[#FECDD3]/50 p-6">
          <ResultsTable
            results={results}
            queryMotifs={extractMotifs(query)}
          />
        </section>
      )}
    </main>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-[#FFFBFB]">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#FECDD3] via-[#FBD5DC] to-[#FCE4EC] py-6 px-6 border-b border-[#F9B8C6]/40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="group">
            <h1 className="text-3xl tracking-tight text-[#1C1917]">
              <span className="font-light">nnn</span>
              <span className="font-bold text-[#BE185D]">BLAST</span>
            </h1>
            <p className="mt-1 text-[#9F7A86] text-sm">
              Structured motif nucleotide search across NCBI databases
            </p>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/"
              className="text-sm text-[#6B3A4A] hover:text-[#BE185D] transition-colors"
            >
              Search
            </Link>
            <Link
              to="/about"
              className="text-sm text-[#6B3A4A] hover:text-[#BE185D] transition-colors"
            >
              About
            </Link>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>

      <footer className="border-t border-[#FECDD3]/50 py-4 px-6 text-center text-xs text-[#A8A29E] mt-8">
        nnnBLAST -- Structured motif nucleotide search powered by NCBI BLAST
      </footer>
    </div>
  );
}

export default App;
