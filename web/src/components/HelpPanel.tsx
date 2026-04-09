import { useState } from "react";

export function HelpPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="text-sm text-[#E8889A] hover:text-[#BE185D] transition-colors flex items-center gap-1"
        onClick={() => setOpen(!open)}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01" />
        </svg>
        Syntax help
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-[420px] p-5 bg-white rounded-2xl shadow-lg border border-[#FECDD3]/60 text-sm space-y-4 text-left">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-baseline">
            <h4 className="col-span-2 font-semibold text-[#1C1917] text-xs uppercase tracking-wider mb-1">Gaps</h4>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">[N:10]</code>
            <span className="text-[#57534E]">Exactly 10 nt gap</span>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">[N:5-15]</code>
            <span className="text-[#57534E]">5-15 nt gap (range)</span>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">N</code>
            <span className="text-[#57534E]">1 nt gap (shorthand)</span>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">NNN</code>
            <span className="text-[#57534E]">3 nt gap (shorthand)</span>

            <h4 className="col-span-2 font-semibold text-[#1C1917] text-xs uppercase tracking-wider mt-2 mb-1">In Motifs</h4>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">X</code>
            <span className="text-[#57534E]">Any base (penalized, counts as mismatch)</span>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">R Y S W K M</code>
            <span className="text-[#57534E]">IUPAC ambiguity (no penalty)</span>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">B D H V</code>
            <span className="text-[#57534E]">3-way ambiguity (no penalty)</span>

            <h4 className="col-span-2 font-semibold text-[#1C1917] text-xs uppercase tracking-wider mt-2 mb-1">Mismatch Control</h4>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">{"{mm:1}"}</code>
            <span className="text-[#57534E]">Allow 1 mismatch in this motif</span>
            <code className="text-[#BE185D] bg-[#FEF2F2] px-1.5 py-0.5 rounded text-xs">{"{mm:0}"}</code>
            <span className="text-[#57534E]">Require exact match</span>
          </div>
          <div className="pt-2 border-t border-[#FECDD3]/40">
            <p className="text-xs text-[#A8A29E]">
              IUPAC: R=A/G, Y=C/T, S=G/C, W=A/T, K=G/T, M=A/C
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
