import { useState } from "react";

export function HelpPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        className="text-sm text-[#B4637A] hover:underline"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Show"} query syntax help
      </button>
      {open && (
        <div className="mt-2 p-4 bg-[#FFF8F6] rounded-xl text-sm space-y-3 text-left border border-[#F0DDE3]">
          <div>
            <h4 className="font-semibold mb-1 text-[#1C1917]">Basic syntax</h4>
            <code className="block bg-[#FAF0F0] p-2 rounded-lg text-xs font-mono">
              MOTIF1[N:min-max]MOTIF2[N:min-max]MOTIF3
            </code>
          </div>
          <div>
            <h4 className="font-semibold mb-1 text-[#1C1917]">Gap specifications</h4>
            <ul className="list-disc ml-4 space-y-1 text-[#57534E]">
              <li>
                <code className="text-[#B4637A]">[N:10]</code> -- exactly 10
                nucleotides gap
              </li>
              <li>
                <code className="text-[#B4637A]">[N:5-15]</code> -- between 5 and
                15 nucleotides
              </li>
              <li>
                <code className="text-[#B4637A]">N</code> -- shorthand for{" "}
                <code>[N:1]</code> (single nucleotide gap)
              </li>
              <li>
                <code className="text-[#B4637A]">NN</code> -- shorthand for{" "}
                <code>[N:2]</code> (two nucleotide gap)
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1 text-[#1C1917]">Wildcard positions</h4>
            <ul className="list-disc ml-4 space-y-1 text-[#57534E]">
              <li>
                <code className="text-[#B4637A]">X</code> -- any base
                (penalized, counts toward mismatch score)
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1 text-[#1C1917]">Per-motif mismatches</h4>
            <ul className="list-disc ml-4 space-y-1 text-[#57534E]">
              <li>
                <code className="text-[#B4637A]">{"AGGAGG{mm:1}"}</code> --
                allow max 1 mismatch in this motif
              </li>
              <li>
                <code className="text-[#B4637A]">{"ATCGATCG{mm:0}"}</code> --
                require exact match
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1 text-[#1C1917]">
              IUPAC ambiguity codes (no penalty)
            </h4>
            <p className="text-[#57534E]">
              R=A/G, Y=C/T, S=G/C, W=A/T, K=G/T, M=A/C, B=not A, D=not C,
              H=not G, V=not T
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1 text-[#1C1917]">Examples</h4>
            <ul className="list-disc ml-4 space-y-1 font-mono text-xs text-[#57534E]">
              <li>AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC</li>
              <li>{"AGGAGG{mm:1}[N:10]ATCGATCG"}</li>
              <li>RYWSAGGX[N:5-20]BDHV</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
