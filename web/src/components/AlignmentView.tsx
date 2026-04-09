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
    <div className="bg-[#FFF8F6] rounded-xl p-3 text-xs font-mono overflow-x-auto space-y-2 border border-[#F0DDE3]">
      <div className="text-[#57534E] text-xs font-sans mb-1">
        Subject: <span className="font-bold text-[#1C1917]">{hit.subject_id}</span>{" "}
        | Strand: <span className="font-bold text-[#1C1917]">{hit.strand}</span>{" "}
        | Score: <span className="font-bold text-[#1C1917]">{hit.total_score}</span>
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

/** Check if a query base is an X (wildcard) position */
function isWildcardX(qBase: string): boolean {
  return qBase.toUpperCase() === "X";
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
        <div className="text-[#A8A29E] text-center my-1">
          --- gap: {gap} nt ---
        </div>
      )}
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <span className="text-[#A8A29E] text-right">
          Query M{aln.motif_index + 1}:
        </span>
        <span>{querySeq}</span>
        <span className="text-[#A8A29E] text-right">Match:</span>
        <span>
          {querySeq.split("").map((qBase, j) => {
            const sBase = subjectStr[j] ?? " ";
            const isX = isWildcardX(qBase);
            const isMatch = qBase.toUpperCase() === sBase.toUpperCase();
            if (isX) {
              // X positions: show ~ in a distinct color (not a real mismatch)
              return (
                <span key={j} className="text-[#D7827E] opacity-70">
                  ~
                </span>
              );
            }
            return (
              <span
                key={j}
                className={
                  isMatch
                    ? "text-[#56949F]"
                    : "text-[#D7827E] font-bold"
                }
              >
                {isMatch ? "|" : "x"}
              </span>
            );
          })}
        </span>
        <span className="text-[#A8A29E] text-right">
          Subj @{aln.subject_start}:
        </span>
        <span>
          {subjectStr.split("").map((sBase, j) => {
            const qBase = querySeq[j] ?? "";
            const isX = isWildcardX(qBase);
            const isMatch = qBase.toUpperCase() === sBase.toUpperCase();
            if (isX) {
              return (
                <span key={j} className="text-[#D7827E] opacity-70">
                  {sBase}
                </span>
              );
            }
            return (
              <span
                key={j}
                className={
                  isMatch ? "" : "text-[#D7827E] font-bold underline"
                }
              >
                {sBase}
              </span>
            );
          })}
        </span>
        <span className="text-[#A8A29E] text-right">Info:</span>
        <span className="text-[#A8A29E] font-sans">
          score={aln.score}, mismatches={aln.mismatches}
        </span>
      </div>
    </div>
  );
}

function bytesToString(bytes: number[]): string {
  return bytes.map((b) => String.fromCharCode(b)).join("");
}
