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
    key === sortKey ? (sortAsc ? " \u25b2" : " \u25bc") : "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">
          Results: {results.hits.length} hit{results.hits.length !== 1 ? "s" : ""}
        </h3>
        <span className="text-sm text-gray-500">
          Database: {results.num_sequences} sequences, {results.database_size.toLocaleString()} bp
        </span>
      </div>

      {results.hits.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No hits found. Try relaxing mismatch or E-value constraints.
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left">
              <th className="py-2 px-2">#</th>
              <th className="py-2 px-2">Subject</th>
              <th className="py-2 px-2">Strand</th>
              <th
                className="py-2 px-2 cursor-pointer hover:text-blue-600"
                onClick={() => handleSort("total_score")}
              >
                Score{arrow("total_score")}
              </th>
              <th
                className="py-2 px-2 cursor-pointer hover:text-blue-600"
                onClick={() => handleSort("evalue")}
              >
                E-value{arrow("evalue")}
              </th>
              <th
                className="py-2 px-2 cursor-pointer hover:text-blue-600"
                onClick={() => handleSort("bit_score")}
              >
                Bit Score{arrow("bit_score")}
              </th>
              <th className="py-2 px-2">Motifs</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((hit, idx) => (
              <HitRow
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
          </tbody>
        </table>
      )}
    </div>
  );
}

function HitRow({
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
  return (
    <>
      <tr
        className="border-b border-gray-200 hover:bg-blue-50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-2 px-2 text-gray-500">{idx + 1}</td>
        <td className="py-2 px-2 font-mono font-semibold">{hit.subject_id}</td>
        <td className="py-2 px-2 text-center">{hit.strand}</td>
        <td className="py-2 px-2">{hit.total_score}</td>
        <td className="py-2 px-2">{formatEvalue(hit.evalue)}</td>
        <td className="py-2 px-2">{hit.bit_score.toFixed(1)}</td>
        <td className="py-2 px-2 text-gray-500">
          {hit.motif_alignments
            .map((ma) => `${ma.mismatches}mm`)
            .join(", ")}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="p-3">
            <AlignmentView hit={hit} queryMotifs={queryMotifs} />
          </td>
        </tr>
      )}
    </>
  );
}

function formatEvalue(e: number): string {
  if (e === 0) return "0";
  if (e < 0.001) return e.toExponential(2);
  if (e < 1) return e.toFixed(4);
  return e.toFixed(2);
}
