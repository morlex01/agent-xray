import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import type { AgentTrace, TraceAnalysis } from "../types";
import { statusColor } from "../lib/judgments";

interface Props {
  trace: AgentTrace | null;
  analysis: TraceAnalysis | null;
  reducedMotion: boolean;
  activeStep?: number;
}

export function TracePanel({ trace, analysis, reducedMotion, activeStep }: Props) {
  if (!trace) {
    return (
      <section className="panel p-2.5 h-full flex flex-col">
        <div className="label-caps mb-2">Trace Under Analysis</div>
        <div className="text-xs text-ink-mute flex-1 flex items-center justify-center border border-dashed border-line-soft rounded-sm">
          Loading demo traces…
        </div>
      </section>
    );
  }

  const steps = trace.steps || [];
  const active = activeStep ?? Math.min(steps.length - 1, Math.max(0, steps.findIndex((s) => s.status === "error" || s.status === "retry")));

  return (
    <section className="panel p-2.5 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-1.5 shrink-0">
        <div className="label-caps">Trace Under Analysis</div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${statusColor(trace.status)}`} />
          <span className="mono text-ink-mute">{trace.id}</span>
        </div>
      </div>

      <div className="shrink-0 mb-2 border border-line-soft rounded-sm bg-page/60 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="text-[12px] font-semibold text-ink truncate">{trace.agent_name}</div>
          <span className="mono uppercase text-ink-mute">{trace.status}</span>
        </div>
        <div className="text-[11px] text-ink-soft leading-snug line-clamp-2 mb-1">{trace.user_request}</div>
        <div className="flex gap-3 mono text-ink-faint">
          <span>{trace.duration_ms} ms</span>
          <span>${trace.estimated_cost_usd.toFixed(4)}</span>
          <span>{steps.length} steps</span>
          {analysis?.metrics?.demo_pattern ? (
            <span className="text-jev-ink">pattern: {String(analysis.metrics.demo_pattern)}</span>
          ) : null}
        </div>
      </div>

      {/* Compact timeline */}
      <div className="flex gap-0.5 mb-2 shrink-0 h-1.5">
        {steps.map((step, i) => (
          <div
            key={`tl-${i}`}
            className={`flex-1 rounded-sm ${
              step.status === "error"
                ? "bg-fail"
                : step.status === "retry"
                  ? "bg-warn"
                  : i === active
                    ? "bg-electric"
                    : "bg-ok/70"
            } ${i === active ? "ring-1 ring-electric ring-offset-1" : ""}`}
            title={`${step.action} · ${step.status}`}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 min-h-0">
        {steps.map((step, i) => {
          const isErr = step.status === "error" || !!step.error;
          const isRetry = step.status === "retry";
          const isActive = i === active;
          return (
            <motion.div
              key={`${trace.id}-${i}`}
              initial={reducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reducedMotion ? 0 : Math.min(i * 0.02, 0.3) }}
              className={`rounded-sm border px-2 py-1 ${
                isActive
                  ? "border-electric bg-electric-pale"
                  : isErr
                    ? "border-fail/50 bg-fail/5"
                    : isRetry
                      ? "border-warn/50 bg-warn/5"
                      : "border-line-soft bg-surface"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px]">
                {isErr ? (
                  <AlertTriangle className="h-3 w-3 text-fail shrink-0" />
                ) : step.tool_name ? (
                  <Wrench className="h-3 w-3 text-jev shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-ok shrink-0" />
                )}
                <span className="text-ink font-medium truncate">{step.action}</span>
                {step.tool_name ? <span className="mono text-jev-ink shrink-0">{step.tool_name}</span> : null}
                <span className="ml-auto mono text-ink-faint uppercase shrink-0">{step.status}</span>
              </div>
              {step.error ? <div className="mono text-fail mt-0.5 pl-4 truncate">{step.error}</div> : null}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
