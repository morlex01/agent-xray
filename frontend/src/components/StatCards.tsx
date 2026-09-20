import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

interface Stats {
  runs: number;
  judgments: number;
  failed: number;
  avoidable: number;
  elapsedMs: number;
  throughput: number;
  wasted: number;
  apiUsage?: { input_tokens: number; output_tokens: number } | null;
}

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const spring = useSpring(value, { stiffness: 120, damping: 24 });
  const display = useTransform(spring, (v) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString(),
  );
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  return <motion.span>{display}</motion.span>;
}

export function StatCards({ stats, demoData }: { stats: Stats; demoData: boolean }) {
  const items = [
    { label: "Runs analyzed", value: stats.runs, decimals: 0, accent: false },
    { label: "Typed judgments", value: stats.judgments, decimals: 0, accent: true },
    { label: "Failed runs", value: stats.failed, decimals: 0, accent: false },
    { label: "Avoidable failures", value: stats.avoidable, decimals: 0, accent: false },
    { label: "Elapsed time", value: stats.elapsedMs / 1000, decimals: 1, suffix: "s" },
    { label: "Throughput", value: stats.throughput, decimals: 2, suffix: "/s" },
    { label: "Wasted cost", value: stats.wasted, decimals: 3, prefix: "$" },
  ];

  return (
    <div className="grid grid-cols-7 gap-1.5 shrink-0">
      {items.map((it) => (
        <div
          key={it.label}
          className={`panel px-2.5 py-1.5 ${it.accent ? "border-jev" : ""}`}
        >
          <div className="label-caps mb-1 flex items-center justify-between gap-1">
            <span>{it.label}</span>
            {demoData ? <span className="text-jev-ink normal-case tracking-normal">demo</span> : <span className="text-electric normal-case tracking-normal">live</span>}
          </div>
          <div className={`metric-value ${it.accent ? "text-jev" : ""}`}>
            {it.prefix || ""}
            <CountUp value={it.value} decimals={it.decimals} />
            {it.suffix ? <span className="text-[10px] text-ink-faint ml-0.5">{it.suffix}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
