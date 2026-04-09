import { useCallback, useEffect, useRef, useState } from "react";
import { submitSearch, getResults } from "./api";
import { QueryVisual } from "./components/QueryVisual";
import { ResultsTable } from "./components/ResultsTable";
import { HelpPanel } from "./components/HelpPanel";
import type { JobProgress, SearchResults } from "./types";
import { DATABASES } from "./types";

const EXAMPLE_PRESETS = [
  {
    name: "16S rRNA V4 region (515F–806R)",
    query: "GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC",
    description: "Universal bacterial/archaeal 16S rRNA conserved primer sites flanking the V4 hypervariable region.",
    strategy: "Single anchor (19-20bp motifs)",
  },
  {
    name: "16S rRNA V1-V2 (27F–338R)",
    query: "AGAGTTTGATCMTGGCTCAG[N:280-330]GCTGCCTCCCGTAGGAGT",
    description: "16S rRNA gene: 27F universal primer site + 338R primer site, flanking V1-V2 hypervariable regions.",
    strategy: "Single anchor (18-20bp motifs)",
  },
  {
    name: "23S rRNA conserved domains",
    query: "GGATGCCTTGGCYACTAGATG[N:40-80]CCTGTCACTTCGRTGAAGGAG",
    description: "23S ribosomal RNA conserved regions (domains IV-V), found across bacteria. Y=C/T, R=A/G.",
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

function App() {
  const [query, setQuery] = useState(EXAMPLE_PRESETS[0].query);
  const [database, setDatabase] = useState("core_nt");
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maxMm, setMaxMm] = useState(2);
  const [evalCutoff, setEvalCutoff] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<number | null>(null);
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
        `Longest motif is only ${longestMotif}bp. NCBI BLAST requires at least ~15bp for reliable results. Consider using longer conserved regions.`
      );
    }
    for (let i = 0; i < motifs.length; i++) {
      if (motifs[i].length < 4) {
        warnings.push(`Motif ${i + 1} ("${motifs[i]}") is very short (${motifs[i].length}bp). It may match everywhere.`);
      }
    }
    const invalidBases = q.replace(/[\[\]{}:0-9NnMmAaTtGgCcUuRrYySsWwKkBbDdHhVv\s-]/g, "");
    if (invalidBases.length > 0) {
      warnings.push(`Invalid characters in query: "${invalidBases}"`);
    }
    return warnings;
  };

  const queryWarnings = validateQuery(query);

  const handleSearch = useCallback(async () => {
    if (!email.trim()) {
      setError("Email is required (NCBI policy).");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ stage: "starting" });
    setElapsed(0);
    setPollCount(0);

    try {
      const { job_id } = await submitSearch({
        query,
        database,
        email,
        api_key: apiKey || undefined,
        max_mismatches: maxMm,
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
        } catch (e: any) {
          setError(e.message);
          setProgress(null);
          setLoading(false);
        }
      };
      poll();
    } catch (e: any) {
      setError(e.message);
      setProgress(null);
      setLoading(false);
    }
  }, [query, database, email, apiKey, maxMm, evalCutoff]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white py-6 px-6 shadow-lg">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight">
            nnn<span className="text-blue-300">BLAST</span>
          </h1>
          <p className="mt-1 text-blue-200 text-sm">
            Structured motif search across NCBI nucleotide databases
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Query section */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Query</h2>
            <HelpPanel />
          </div>

          {/* Example presets */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-gray-500 self-center mr-1">Examples:</span>
            {EXAMPLE_PRESETS.map((preset, i) => (
              <button
                key={i}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                onClick={() => setQuery(preset.query)}
                title={`${preset.description}\n\nBLAST strategy: ${preset.strategy}`}
              >
                {preset.name}
              </button>
            ))}
          </div>

          <textarea
            className="w-full border border-gray-300 rounded-lg px-4 py-3 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                  className="text-xs px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800"
                >
                  {w}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400">
            Each motif must be at least ~15bp for NCBI BLAST. Supports IUPAC ambiguity codes (R, Y, M, K, S, W, B, D, H, V, N) and RNA (U).
          </p>
        </section>

        {/* Parameters section */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Parameters
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Database */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Database
              </label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
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

            {/* Max mismatches */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Max mismatches (global)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={maxMm}
                  onChange={(e) => setMaxMm(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm font-mono w-4 text-center">
                  {maxMm}
                </span>
              </div>
            </div>

            {/* E-value cutoff */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                E-value cutoff
              </label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                value={evalCutoff}
                onChange={(e) => setEvalCutoff(Number(e.target.value))}
              >
                <option value={0.001}>0.001</option>
                <option value={0.01}>0.01</option>
                <option value={0.1}>0.1</option>
                <option value={1}>1</option>
                <option value={10}>10</option>
                <option value={100}>100</option>
                <option value={1000}>1000</option>
              </select>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Email (required by NCBI)
              </label>
              <input
                type="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {/* API key (optional) */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                NCBI API key (optional, faster)
              </label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="mt-5">
            <button
              className="bg-blue-600 text-white px-8 py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              onClick={handleSearch}
              disabled={loading || !query.trim() || !email.trim()}
            >
              {loading ? "Searching..." : "Search NCBI"}
            </button>
          </div>
        </section>

        {/* Progress */}
        {loading && progress && (
          <section className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                <div>
                  <div className="font-medium text-blue-800">
                    {STAGE_LABELS[progress.stage] || progress.stage}
                  </div>
                  {progress.detail && (
                    <div className="text-sm text-blue-600">{progress.detail}</div>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-blue-500 font-mono tabular-nums">
                <div>{formatElapsed(elapsed)}</div>
                {pollCount > 0 && (
                  <div className="text-blue-400">
                    {pollCount} check{pollCount !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Error */}
        {error && (
          <section className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </section>
        )}

        {/* Results */}
        {results && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <ResultsTable
              results={results}
              queryMotifs={extractMotifs(query)}
            />
          </section>
        )}
      </main>

      <footer className="border-t border-gray-200 py-4 px-6 text-center text-xs text-gray-400 mt-8">
        nnnBLAST — Structured motif nucleotide search powered by NCBI BLAST
      </footer>
    </div>
  );
}

export default App;
