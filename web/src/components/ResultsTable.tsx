import { useState } from "react";
import type { Hit, SearchResults } from "../types";
import { AlignmentView } from "./AlignmentView";

export function ResultsTable({
  results,
  queryMotifs,
}: {
  results: SearchResults;
  queryMotifs: string[];
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  type SortKey = "evalue" | "total_score" | "bit_score";
  const [sortKey, setSortKey] = useState<SortKey>("evalue");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = [...results.hits].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortAsc ? diff : -diff;
  });

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === "evalue");
    }
  };

  const arrow = (key: string) =>
    key === sortKey ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[#1C1917]">
          Results: {results.hits.length} hit
          {results.hits.length !== 1 ? "s" : ""}
        </h3>
        <span className="text-sm text-[#A8A29E]">
          Database: {results.num_sequences.toLocaleString()} sequences,{" "}
          {results.database_size.toLocaleString()} bp
        </span>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-4 text-xs text-[#57534E]">
        <span className="text-[#A8A29E]">Sort by:</span>
        {(
          [
            ["evalue", "E-value"],
            ["total_score", "Score"],
            ["bit_score", "Bit Score"],
          ] as [SortKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleSort(key)}
            className={`px-3 py-1 rounded-full border transition-colors ${
              sortKey === key
                ? "border-[#F9A8B8] bg-[#FFFBFB] text-[#F9A8B8] font-semibold"
                : "border-[#FECDD3] hover:border-[#F9A8B8] hover:bg-[#FFFBFB]"
            }`}
          >
            {label}
            {arrow(key)}
          </button>
        ))}
      </div>

      {results.hits.length === 0 ? (
        <div className="text-center py-8 text-[#A8A29E]">
          No hits found. Try relaxing mismatch or E-value constraints.
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((hit, idx) => (
            <HitCard
              key={idx}
              hit={hit}
              idx={idx}
              expanded={expandedIdx === idx}
              onToggle={() =>
                setExpandedIdx(expandedIdx === idx ? null : idx)
              }
              queryMotifs={queryMotifs}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HitCard({
  hit,
  idx,
  expanded,
  onToggle,
  queryMotifs,
}: {
  hit: Hit;
  idx: number;
  expanded: boolean;
  onToggle: () => void;
  queryMotifs: string[];
}) {
  const description = hit.description || hit.subject_id;
  const ncbiUrl = `https://www.ncbi.nlm.nih.gov/nuccore/${hit.subject_id}`;

  return (
    <div
      className={`bg-white rounded-xl border transition-colors ${
        expanded
          ? "border-[#F9A8B8] shadow-md"
          : "border-[#FECDD3] hover:border-[#F9A8B8]/50 shadow-sm"
      }`}
    >
      {/* Card header — clickable */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={onToggle}
      >
        {/* Row 1: rank + description */}
        <div className="flex items-start gap-3">
          <span className="text-xs text-[#A8A29E] font-mono mt-0.5 shrink-0">
            #{idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <h4
              className="text-sm font-semibold text-[#1C1917] leading-snug truncate"
              title={description}
            >
              {description}
            </h4>

            {/* Row 2: accession + strand + subject length */}
            <div className="flex items-center gap-3 mt-1 text-xs">
              <a
                href={ncbiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[#F9A8B8] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {hit.subject_id}
              </a>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  hit.strand === "plus"
                    ? "bg-[#56949F]/10 text-[#56949F]"
                    : "bg-[#D7827E]/10 text-[#D7827E]"
                }`}
              >
                {hit.strand === "plus" ? "+" : "\u2212"} strand
              </span>
              {hit.subject_length > 0 && (
                <span className="text-[#A8A29E]">
                  {hit.subject_length.toLocaleString()} bp
                </span>
              )}
            </div>
          </div>

          {/* Expand/collapse chevron */}
          <span className="text-[#A8A29E] shrink-0 mt-1 text-sm">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>

        {/* Row 3: stats + motif pills */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mt-3 ml-7">
          {/* Stats */}
          <div className="flex items-center gap-3 text-xs text-[#57534E]">
            <span>
              <span className="text-[#A8A29E]">E-value</span>{" "}
              <span className="font-semibold">{formatEvalue(hit.evalue)}</span>
            </span>
            <span className="text-[#FECDD3]">|</span>
            <span>
              <span className="text-[#A8A29E]">Score</span>{" "}
              <span className="font-semibold">{hit.total_score}</span>
            </span>
            <span className="text-[#FECDD3]">|</span>
            <span>
              <span className="text-[#A8A29E]">Bit</span>{" "}
              <span className="font-semibold">{hit.bit_score.toFixed(1)}</span>
            </span>
          </div>

          {/* Motif pills */}
          <div className="flex items-center gap-1.5">
            {hit.motif_alignments.map((ma, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                  ma.mismatches === 0
                    ? "bg-[#56949F]/10 border-[#56949F]/30 text-[#56949F]"
                    : "bg-[#D7827E]/10 border-[#D7827E]/30 text-[#D7827E]"
                }`}
              >
                M{ma.motif_index + 1}
                <span className="font-bold">{ma.mismatches}mm</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Expanded alignment details */}
      {expanded && (
        <div className="border-t border-[#FECDD3] p-4">
          <AlignmentView hit={hit} queryMotifs={queryMotifs} />
        </div>
      )}
    </div>
  );
}

function formatEvalue(e: number): string {
  if (e === 0) return "0";
  if (e < 0.001) return e.toExponential(2);
  if (e < 1) return e.toFixed(4);
  return e.toFixed(2);
}
