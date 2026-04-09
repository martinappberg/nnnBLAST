import { useState } from "react";

export function HelpPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        className="text-sm text-blue-600 hover:underline"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Show"} query syntax help
      </button>
      {open && (
        <div className="mt-2 p-4 bg-gray-50 rounded text-sm space-y-3 text-left">
          <div>
            <h4 className="font-semibold mb-1">Basic syntax</h4>
            <code className="block bg-white p-2 rounded text-xs">
              MOTIF1[N:min-max]MOTIF2[N:min-max]MOTIF3
            </code>
          </div>
          <div>
            <h4 className="font-semibold mb-1">Gap specifications</h4>
            <ul className="list-disc ml-4 space-y-1">
              <li>
                <code>[N:10]</code> — exactly 10 nucleotides gap
              </li>
              <li>
                <code>[N:5-15]</code> — between 5 and 15 nucleotides
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1">Per-motif mismatches</h4>
            <ul className="list-disc ml-4 space-y-1">
              <li>
                <code>AGGAGG{"{"} mm:1{"}"}</code> — allow max 1 mismatch in this
                motif
              </li>
              <li>
                <code>ATCGATCG{"{"} mm:0{"}"}</code> — require exact match
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1">IUPAC ambiguity codes</h4>
            <p className="text-gray-600">
              R=A/G, Y=C/T, S=G/C, W=A/T, K=G/T, M=A/C, B=not A, D=not C,
              H=not G, V=not T, N=any
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">Examples</h4>
            <ul className="list-disc ml-4 space-y-1 font-mono text-xs">
              <li>AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC</li>
              <li>AGGAGG{"{"}mm:1{"}"}[N:10]ATCGATCG</li>
              <li>RYWSAGG[N:5-20]BDHVN</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
