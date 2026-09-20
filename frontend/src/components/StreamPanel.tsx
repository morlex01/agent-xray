import { useEffect, useRef } from "react";

interface Props {
  lines: string[];
  demoData: boolean;
}

export function StreamPanel({ lines, demoData }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <section className="border border-ink rounded-sm flex flex-col min-h-0 overflow-hidden bg-terminal h-full">
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/15 shrink-0">
        <div className="label-caps text-white/50">Typed output stream</div>
        {demoData ? (
          <span className="mono text-jev-soft font-semibold">DEMO DATA</span>
        ) : (
          <span className="mono text-electric-soft font-semibold">LIVE JEV</span>
        )}
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto mono p-2 min-h-0 text-[10px]">
        {lines.length === 0 ? (
          <div className="text-white/35">awaiting judgments…</div>
        ) : (
          lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 32)}`} className="text-[#7dd3fc] whitespace-pre-wrap leading-relaxed">
              <span className="text-jev-soft mr-1.5">›</span>
              {line}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
