import type { Hit, MotifAlignment } from "../types";

/** Expandable alignment view for a single hit, showing each motif aligned against the subject. */
export function AlignmentView({
  hit,
  queryMotifs,
}: {
  hit: Hit;
  queryMotifs: string[];
}) {
  const sortedAlns = [...hit.motif_alignments].sort(
    (a, b) => a.subject_start - b.subject_start
  );

  return (
    <div className="bg-gray-50 rounded p-3 text-xs font-mono overflow-x-auto space-y-2">
      <div className="text-gray-600 text-xs font-sans mb-1">
        Subject: <span className="font-bold">{hit.subject_id}</span> | Strand:{" "}
        <span className="font-bold">{hit.strand}</span> | Score:{" "}
        <span className="font-bold">{hit.total_score}</span>
      </div>
      {sortedAlns.map((aln, i) => (
        <MotifAlignmentRow
          key={i}
          aln={aln}
          querySeq={queryMotifs[aln.motif_index] ?? ""}
          gap={
            i > 0
              ? aln.subject_start -
                (sortedAlns[i - 1].subject_start +
                  sortedAlns[i - 1].subject_segment.length)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function MotifAlignmentRow({
  aln,
  querySeq,
  gap,
}: {
  aln: MotifAlignment;
  querySeq: string;
  gap?: number;
}) {
  const subjectStr = bytesToString(aln.subject_segment);

  return (
    <div>
      {gap !== undefined && (
        <div className="text-gray-400 text-center my-1">
          --- gap: {gap} nt ---
        </div>
      )}
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <span className="text-gray-500 text-right">
          Query M{aln.motif_index + 1}:
        </span>
        <span>{querySeq}</span>
        <span className="text-gray-500 text-right">Match:</span>
        <span>
          {querySeq.split("").map((qBase, j) => {
            const sBase = subjectStr[j] ?? " ";
            const isMatch =
              qBase.toUpperCase() === sBase.toUpperCase();
            return (
              <span
                key={j}
                className={isMatch ? "text-green-700" : "text-red-600 font-bold"}
              >
                {isMatch ? "|" : "x"}
              </span>
            );
          })}
        </span>
        <span className="text-gray-500 text-right">
          Subj @{aln.subject_start}:
        </span>
        <span>
          {subjectStr.split("").map((sBase, j) => {
            const qBase = querySeq[j] ?? "";
            const isMatch =
              qBase.toUpperCase() === sBase.toUpperCase();
            return (
              <span
                key={j}
                className={isMatch ? "" : "text-red-600 font-bold underline"}
              >
                {sBase}
              </span>
            );
          })}
        </span>
        <span className="text-gray-500 text-right">Info:</span>
        <span className="text-gray-500 font-sans">
          score={aln.score}, mismatches={aln.mismatches}
        </span>
      </div>
    </div>
  );
}

function bytesToString(bytes: number[]): string {
  return bytes.map((b) => String.fromCharCode(b)).join("");
}
