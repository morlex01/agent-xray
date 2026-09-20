import { motion } from "framer-motion";
import type { TraceAnalysis } from "../types";
import { NOUL_LABELS, NOUL_ORDER, POSITIVE_NOULS, barColor } from "../lib/judgments";

interface Props {
  analysis: TraceAnalysis | null;
  revealed: number;
  reducedMotion: boolean;
}

export function ChecksPanel({ analysis, revealed, reducedMotion }: Props) {
  const showCount = analysis ? Math.max(revealed, analysis ? 14 : 0) : 0;

  return (
    <section className="panel p-2.5 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <div className="label-caps">JEV X-Ray Checks · 14 Noul</div>
        {analysis?.demo_data ? (
          <span className="mono text-jev-ink font-semibold">DEMO DATA</span>
        ) : analysis ? (
          <span className="mono text-electric font-semibold">LIVE JEV</span>
        ) : null}
      </div>

      {!analysis ? (
        <div className="grid grid-cols-2 gap-1 flex-1 content-start">
          {NOUL_ORDER.map((id) => (
            <div key={id} className="border border-line-soft rounded-sm px-1.5 py-1 bg-page/40">
              <div className="text-[10px] text-ink-mute truncate">{NOUL_LABELS[id]}</div>
              <div className="h-1 mt-1 bg-line-faint rounded-sm" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 flex-1 min-h-0 overflow-y-auto content-start">
            {NOUL_ORDER.map((id, idx) => {
              const j = analysis.nouls[id];
              const show = idx < showCount;
              const p = j?.noul ?? 0;
              const positive = POSITIVE_NOULS.has(id);
              const yes = p >= 0.5;
              return (
                <motion.div
                  key={id}
                  initial={reducedMotion ? false : { opacity: 0.4 }}
                  animate={{ opacity: show ? 1 : 0.35 }}
                  className="border border-line-soft rounded-sm px-1.5 py-1 bg-surface hover:border-ink/40"
                >
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <div className="text-[10px] text-ink truncate font-medium" title={NOUL_LABELS[id]}>
                      {NOUL_LABELS[id]}
                    </div>
                    <div className="mono text-ink-mute shrink-0">
                      {show ? (yes ? "Y" : "N") : "·"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 bg-line-faint rounded-sm overflow-hidden origin-left">
                      <motion.div
                        className={`h-full origin-bottom ${barColor(p, positive)}`}
                        style={{ transformOrigin: "bottom" }}
                        initial={{ height: 0, width: "100%" }}
                        animate={{
                          height: "100%",
                          width: show ? `${Math.round(p * 100)}%` : "0%",
                        }}
                        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : idx * 0.03 }}
                      />
                    </div>
                    <div className="w-8 text-right mono text-ink font-semibold">
                      {show ? p.toFixed(2) : "—"}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-2 mt-1.5 border-t border-line-soft shrink-0">
            <MetaChip
              label="Failure type"
              value={analysis.failure_type?.choice ?? "—"}
              sub={
                analysis.failure_type?.confidence != null
                  ? `p ${analysis.failure_type.confidence.toFixed(2)}`
                  : undefined
              }
              accent="jev"
            />
            <MetaChip
              label="Failure stage"
              value={analysis.failure_stage?.choice ?? "—"}
              sub={
                analysis.failure_stage?.confidence != null
                  ? `p ${analysis.failure_stage.confidence.toFixed(2)}`
                  : undefined
              }
              accent="electric"
            />
            <MetaChip
              label="Severity"
              value={analysis.severity ? `${analysis.severity.score.toFixed(1)} / 4` : "—"}
              sub={
                analysis.severity?.confidence != null
                  ? `p ${analysis.severity.confidence.toFixed(2)}`
                  : undefined
              }
              accent="fail"
            />
          </div>
        </>
      )}
    </section>
  );
}

function MetaChip({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "jev" | "electric" | "fail";
}) {
  const border =
    accent === "jev" ? "border-jev" : accent === "electric" ? "border-electric" : "border-fail";
  const text =
    accent === "jev" ? "text-jev-ink" : accent === "electric" ? "text-electric" : "text-fail";
  return (
    <div className={`rounded-sm border ${border} bg-page/50 px-1.5 py-1`}>
      <div className="label-caps mb-0.5">{label}</div>
      <div className={`text-[11px] font-semibold truncate ${text}`}>{value}</div>
      {sub ? <div className="mono text-ink-faint">{sub}</div> : null}
    </div>
  );
}
