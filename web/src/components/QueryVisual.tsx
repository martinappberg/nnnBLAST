/** Visual diagram of the structured query: colored motif blocks with gap ranges. */
export function QueryVisual({ query }: { query: string }) {
  const parsed = parseForVisual(query);
  if (parsed.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-3 px-2">
      {parsed.map((part, i) => {
        if (part.type === "motif") {
          return (
            <div
              key={i}
              className="px-2 py-1 rounded-lg font-mono text-sm font-bold text-white shrink-0"
              style={{
                backgroundColor: COLORS[part.colorIdx % COLORS.length],
              }}
              title={
                part.mm !== undefined
                  ? `max ${part.mm} mismatches`
                  : undefined
              }
            >
              {part.text.split("").map((ch, j) => {
                if (ch === "X") {
                  return (
                    <span
                      key={j}
                      className="opacity-70"
                      style={{
                        textDecoration: "underline dotted",
                        textUnderlineOffset: "3px",
                      }}
                    >
                      X
                    </span>
                  );
                }
                return <span key={j}>{ch}</span>;
              })}
              {part.mm !== undefined && (
                <span className="ml-1 text-xs opacity-75">({part.mm}mm)</span>
              )}
            </div>
          );
        }
        if (part.type === "inline_gap") {
          return (
            <div
              key={i}
              className="flex items-center gap-0.5 text-xs text-[#A8A29E] shrink-0"
            >
              <div className="border-t-2 border-dashed border-[#B4637A]/40 w-4" />
              <span className="font-mono whitespace-nowrap text-[#B4637A]/60">
                {part.count}
              </span>
              <div className="border-t-2 border-dashed border-[#B4637A]/40 w-4" />
            </div>
          );
        }
        return (
          <div
            key={i}
            className="flex items-center gap-1 text-xs text-[#A8A29E] shrink-0"
          >
            <div className="border-t-2 border-dashed border-[#B4637A]/40 w-6" />
            <span className="font-mono whitespace-nowrap text-[#57534E]">
              {part.min === part.max
                ? `${part.min}`
                : `${part.min}-${part.max}`}
            </span>
            <div className="border-t-2 border-dashed border-[#B4637A]/40 w-6" />
          </div>
        );
      })}
    </div>
  );
}

const COLORS = [
  "#B4637A",
  "#56949F",
  "#D7827E",
  "#907AA9",
  "#EA9D34",
  "#286983",
];

type VisualPart =
  | { type: "motif"; text: string; mm?: number; colorIdx: number }
  | { type: "gap"; min: number; max: number }
  | { type: "inline_gap"; count: number };

function parseForVisual(query: string): VisualPart[] {
  const parts: VisualPart[] = [];
  const upper = query.toUpperCase().trim();
  let i = 0;
  let motifIdx = 0;
  let currentMotif = "";
  let currentMm: number | undefined = undefined;

  const flushMotif = () => {
    if (currentMotif) {
      parts.push({
        type: "motif",
        text: currentMotif,
        mm: currentMm,
        colorIdx: motifIdx++,
      });
      currentMotif = "";
      currentMm = undefined;
    }
  };

  while (i < upper.length) {
    if (upper[i] === "[") {
      flushMotif();
      const close = upper.indexOf("]", i);
      if (close === -1) break;
      const gapStr = upper.slice(i + 1, close);
      const gap = parseGap(gapStr);
      parts.push({ type: "gap", ...gap });
      i = close + 1;
    } else if (upper[i] === "{") {
      const close = upper.indexOf("}", i);
      if (close === -1) break;
      const mmStr = upper.slice(i + 1, close);
      const match = mmStr.match(/MM:(\d+)/);
      if (match) currentMm = parseInt(match[1]);
      i = close + 1;
    } else if (upper[i] === "N") {
      // N outside brackets = gap shorthand. Count consecutive Ns.
      let nCount = 0;
      while (i < upper.length && upper[i] === "N") {
        nCount++;
        i++;
      }
      flushMotif();
      parts.push({ type: "inline_gap", count: nCount });
    } else if (/[A-Z]/.test(upper[i])) {
      currentMotif += upper[i];
      i++;
    } else {
      i++;
    }
  }
  flushMotif();
  return parts;
}

function parseGap(s: string): { min: number; max: number } {
  const num = s.replace(/^N:/, "");
  if (num.includes("-")) {
    const [a, b] = num.split("-").map(Number);
    return { min: a, max: b };
  }
  const v = parseInt(num);
  return { min: v, max: v };
}
