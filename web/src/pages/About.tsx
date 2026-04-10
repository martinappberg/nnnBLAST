import { Link } from "react-router-dom";

const INTERACTIVE_EXAMPLES = [
  {
    title: "16S rRNA V4 region",
    description:
      "Classic 515F-806R primer pair flanking the V4 hypervariable region. Two conserved ~20bp motifs with a 250-300nt variable gap.",
    query: "GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC",
  },
  {
    title: "16S rRNA V1-V2",
    description:
      "27F-338R primer pair spanning V1 and V2 hypervariable regions. Uses IUPAC M (A/C) for degenerate positions.",
    query: "AGAGTTTGATCMTGGCTCAG[N:280-330]GCTGCCTCCCGTAGGAGT",
  },
  {
    title: "23S rRNA domains IV-V",
    description:
      "Conserved 23S rRNA regions with Y (C/T) and R (A/G) degenerate positions. Shorter gap between motifs.",
    query: "GGATGCCTTGGCYACTAGATG[N:40-80]CCTGTCACTTCGRTGAAGGAG",
  },
];

const PIPELINE_STEPS = [
  {
    step: "1",
    title: "Parse",
    description:
      "The structured query is split into motifs and gap constraints. The longest motif is selected as the BLAST anchor.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    ),
  },
  {
    step: "2",
    title: "BLAST",
    description:
      "The anchor motif is submitted to NCBI BLAST against the chosen nucleotide database to find candidate regions.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    ),
  },
  {
    step: "3",
    title: "Fetch",
    description:
      "For each BLAST hit, flanking genomic regions are fetched from NCBI to cover the full structured motif span.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    ),
  },
  {
    step: "4",
    title: "Check",
    description:
      "Each candidate is scanned for all motifs at the expected positions, respecting gap constraints and mismatch limits.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    step: "5",
    title: "Score",
    description:
      "Valid hits are scored and ranked. A composite E-value is calculated combining BLAST statistics with motif-level scoring.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
];

const SYNTAX_TABLE = [
  { char: "A, T, G, C", role: "Exact nucleotide", penalty: "None", note: "Standard DNA bases" },
  { char: "U", role: "Uracil (RNA)", penalty: "None", note: "Treated as T" },
  { char: "R", role: "A or G (purine)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "Y", role: "C or T (pyrimidine)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "S", role: "G or C (strong)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "W", role: "A or T (weak)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "K", role: "G or T (keto)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "M", role: "A or C (amino)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "B", role: "C, G, or T (not A)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "D", role: "A, G, or T (not C)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "H", role: "A, C, or T (not G)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "V", role: "A, C, or G (not T)", penalty: "None", note: "IUPAC ambiguity" },
  { char: "X", role: "Any base (wildcard)", penalty: "Penalized", note: "Matches any base but counts toward mismatch score" },
  { char: "N", role: "Gap shorthand", penalty: "N/A", note: "N = [N:1], NN = [N:2], etc. Inserts a variable gap." },
  { char: "[N:min-max]", role: "Variable-length gap", penalty: "N/A", note: "Gap of min to max nucleotides between motifs" },
];

const COMPARISON_TABLE = [
  {
    feature: "Multi-motif with gaps",
    nnnblast: "Yes (core feature)",
    blast: "No",
    phiblast: "Partial (single pattern)",
    hmmer: "Yes (profile HMMs)",
  },
  {
    feature: "Variable gap lengths",
    nnnblast: "Yes ([N:min-max])",
    blast: "No",
    phiblast: "No",
    hmmer: "Yes (insert states)",
  },
  {
    feature: "IUPAC ambiguity codes",
    nnnblast: "Full support",
    blast: "Limited",
    phiblast: "No",
    hmmer: "No (uses profiles)",
  },
  {
    feature: "Speed",
    nnnblast: "Fast (BLAST-anchored)",
    blast: "Very fast",
    phiblast: "Moderate",
    hmmer: "Slow for large DBs",
  },
  {
    feature: "Sensitivity control",
    nnnblast: "Mismatch + E-value",
    blast: "E-value only",
    phiblast: "E-value + pattern",
    hmmer: "E-value + profile",
  },
  {
    feature: "Setup complexity",
    nnnblast: "Query string only",
    blast: "Query string only",
    phiblast: "Query + pattern file",
    hmmer: "Requires MSA/profile",
  },
];

export function AboutPage() {
  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-16">
      {/* Hero */}
      <section className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-[#1C1917]">
          What is{" "}
          <span className="font-light">nnn</span>
          <span className="text-[#F9A8B8]">BLAST</span>?
        </h1>
        <p className="text-lg text-[#57534E] max-w-2xl mx-auto leading-relaxed">
          nnnBLAST is a structured motif search tool for nucleotide databases. It
          finds sequences that contain multiple conserved motifs separated by
          variable-length gaps -- a pattern that standard BLAST cannot express in
          a single query. Think of it as "BLAST for primer pairs and multi-part
          signatures."
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-[#F9A8B8] text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-[#9B4D63] transition-colors shadow-sm"
          >
            Try a search
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[#1C1917]">How it works</h2>
        <p className="text-[#57534E]">
          nnnBLAST uses NCBI BLAST as a fast pre-filter, then validates the full
          structured motif locally. This gives you BLAST-level speed with
          multi-motif precision.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          {PIPELINE_STEPS.map((step, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-[#FECDD3] p-5 text-center space-y-2 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#FFFBFB] text-[#F9A8B8]">
                {step.icon}
              </div>
              <div className="text-xs font-bold text-[#F9A8B8] uppercase tracking-wider">
                Step {step.step}
              </div>
              <div className="font-semibold text-[#1C1917]">{step.title}</div>
              <p className="text-xs text-[#57534E] leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Query Syntax */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[#1C1917]">Query syntax</h2>
        <div className="bg-[#FAF0F0] rounded-2xl p-5 font-mono text-sm border border-[#FECDD3]">
          <span className="text-[#F9A8B8] font-bold">MOTIF1</span>
          <span className="text-[#A8A29E]">[N:min-max]</span>
          <span className="text-[#56949F] font-bold">MOTIF2</span>
          <span className="text-[#A8A29E]">[N:min-max]</span>
          <span className="text-[#D7827E] font-bold">MOTIF3</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-[#FECDD3] text-left">
                <th className="py-2 px-3 text-[#57534E] font-semibold">Character</th>
                <th className="py-2 px-3 text-[#57534E] font-semibold">Role</th>
                <th className="py-2 px-3 text-[#57534E] font-semibold">Penalty</th>
                <th className="py-2 px-3 text-[#57534E] font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {SYNTAX_TABLE.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-[#FECDD3] hover:bg-[#FFFBFB] transition-colors"
                >
                  <td className="py-2 px-3 font-mono font-bold text-[#1C1917]">
                    {row.char}
                  </td>
                  <td className="py-2 px-3 text-[#57534E]">{row.role}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        row.penalty === "Penalized"
                          ? "bg-[#D7827E]/15 text-[#D7827E]"
                          : row.penalty === "None"
                            ? "bg-[#56949F]/15 text-[#56949F]"
                            : "bg-[#A8A29E]/15 text-[#A8A29E]"
                      }`}
                    >
                      {row.penalty}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-[#A8A29E]">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* E-value Derivation */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[#1C1917]">E-value derivation</h2>
        <div className="bg-white rounded-2xl border border-[#FECDD3] p-6 space-y-4 shadow-sm">
          <div className="bg-[#FAF0F0] rounded-xl p-4 font-mono text-center text-lg border border-[#FECDD3]">
            {"E = N"}
            <sub>eff</sub>
            {" \u00D7 \u220F W"}
            <sub>i</sub>
            {" \u00D7 \u220F p"}
            <sub>i</sub>
            {"(S"}
            <sub>i</sub>
            {")"}
          </div>
          <div className="space-y-3 text-sm text-[#57534E]">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <span className="font-mono font-bold text-[#1C1917]">
                N<sub>eff</sub>
              </span>
              <span>
                Effective database size: the number of candidate sequences that
                passed the initial BLAST filter. This replaces the full database
                size to avoid over-counting.
              </span>

              <span className="font-mono font-bold text-[#1C1917]">
                W<sub>i</sub>
              </span>
              <span>
                Gap window factor for the i-th gap: (max - min + 1) / L, where L
                is the total candidate region length. Wider gap ranges increase
                the chance of a random match.
              </span>

              <span className="font-mono font-bold text-[#1C1917]">
                p<sub>i</sub>(S<sub>i</sub>)
              </span>
              <span>
                Probability of observing score S<sub>i</sub> or better for motif
                i by chance. This is computed from the motif length, number of
                mismatches, and IUPAC degeneracy. An exact-match 20-mer has p
                ~4<sup>-20</sup>; each mismatch multiplies by ~3.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Worked Example */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[#1C1917]">Worked example</h2>
        <div className="bg-white rounded-2xl border border-[#FECDD3] p-6 space-y-4 shadow-sm">
          <div className="text-sm text-[#57534E]">
            <strong className="text-[#1C1917]">Query:</strong>{" "}
            <code className="bg-[#FAF0F0] px-2 py-0.5 rounded text-xs font-mono">
              GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC
            </code>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-[#FFFBFB] rounded-xl p-4 space-y-2 border border-[#FECDD3]">
              <div className="font-semibold text-[#F9A8B8]">Motif 1 (19bp)</div>
              <code className="text-xs font-mono block">GTGCCAGCMGCCGCGGTAA</code>
              <ul className="text-xs text-[#57534E] space-y-1">
                <li>18 exact positions + 1 IUPAC M (A or C)</li>
                <li>
                  p<sub>exact</sub> = (1/4)<sup>18</sup> x (2/4)<sup>1</sup>{" "}
                  = 2<sup>-37</sup>
                </li>
                <li>With 0 mismatches: p(S) = 2<sup>-37</sup></li>
              </ul>
            </div>
            <div className="bg-[#FFFBFB] rounded-xl p-4 space-y-2 border border-[#FECDD3]">
              <div className="font-semibold text-[#F9A8B8]">Motif 2 (20bp)</div>
              <code className="text-xs font-mono block">ATTAGAWACCCBDGTAGTCC</code>
              <ul className="text-xs text-[#57534E] space-y-1">
                <li>17 exact + W (A/T) + B (C/G/T) + D (A/G/T)</li>
                <li>
                  p<sub>exact</sub> = (1/4)<sup>17</sup> x (2/4) x (3/4)<sup>2</sup>{" "}
                  = 9 x 2<sup>-40</sup>
                </li>
                <li>With 0 mismatches: p(S) = 9 x 2<sup>-40</sup></li>
              </ul>
            </div>
          </div>
          <div className="bg-[#FAF0F0] rounded-xl p-4 space-y-2 text-sm border border-[#FECDD3]">
            <div className="font-semibold text-[#1C1917]">Putting it together</div>
            <ul className="text-xs text-[#57534E] space-y-1">
              <li>
                <strong>Gap window:</strong> W = (300 - 250 + 1) / 600 = 0.085
              </li>
              <li>
                <strong>N<sub>eff</sub>:</strong> say 500 BLAST candidates
              </li>
              <li>
                <strong>E-value:</strong> 500 x 0.085 x 2<sup>-37</sup> x 9 x 2<sup>-40</sup>{" "}
                -- extremely significant
              </li>
            </ul>
            <p className="text-xs text-[#A8A29E] pt-1">
              The product of two long-motif probabilities makes false positives
              vanishingly unlikely. This is the power of structured motif search.
            </p>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[#1C1917]">
          Comparison with other tools
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-[#FECDD3] text-left">
                <th className="py-2 px-3 text-[#57534E] font-semibold">Feature</th>
                <th className="py-2 px-3 text-[#F9A8B8] font-semibold">nnnBLAST</th>
                <th className="py-2 px-3 text-[#57534E] font-semibold">BLAST</th>
                <th className="py-2 px-3 text-[#57534E] font-semibold">PHI-BLAST</th>
                <th className="py-2 px-3 text-[#57534E] font-semibold">HMMER</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_TABLE.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-[#FECDD3] hover:bg-[#FFFBFB] transition-colors"
                >
                  <td className="py-2 px-3 font-medium text-[#1C1917]">
                    {row.feature}
                  </td>
                  <td className="py-2 px-3 text-[#F9A8B8] font-medium">
                    {row.nnnblast}
                  </td>
                  <td className="py-2 px-3 text-[#57534E]">{row.blast}</td>
                  <td className="py-2 px-3 text-[#57534E]">{row.phiblast}</td>
                  <td className="py-2 px-3 text-[#57534E]">{row.hmmer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive Examples */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-[#1C1917]">Try it yourself</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {INTERACTIVE_EXAMPLES.map((example, i) => (
            <Link
              key={i}
              to={`/?query=${encodeURIComponent(example.query)}`}
              className="group bg-white rounded-2xl border border-[#FECDD3] p-5 space-y-3 shadow-sm hover:shadow-md hover:border-[#F9A8B8] transition-all"
            >
              <div className="font-semibold text-[#1C1917] group-hover:text-[#F9A8B8] transition-colors">
                {example.title}
              </div>
              <p className="text-xs text-[#57534E] leading-relaxed">
                {example.description}
              </p>
              <div className="flex items-center gap-1 text-xs font-semibold text-[#F9A8B8]">
                Try this query
                <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Citation */}
      <section className="max-w-4xl mx-auto mt-12 mb-8 text-center">
        <p className="text-xs text-[#A8A29E]">
          Vlassak, A. &amp; Kjellberg, M. nnnBLAST: Structured motif nucleotide search with variable gaps.{" "}
          <a href="https://github.com/martinappberg/nnnBLAST" className="text-[#E8889A] hover:underline">
            github.com/martinappberg/nnnBLAST
          </a>
        </p>
      </section>
    </main>
  );
}
