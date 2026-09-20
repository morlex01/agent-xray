import { statusColor, statusBorder } from "../lib/judgments";
import type { AgentTrace, TraceAnalysis } from "../types";

interface Props {
  traces: AgentTrace[];
  selectedId: string | null;
  analyses: Map<string, TraceAnalysis>;
  onSelect: (id: string) => void;
  running?: boolean;
}

export function TraceStrip({ traces, selectedId, analyses, onSelect, running }: Props) {
  return (
    <div className="panel px-2 py-1.5 shrink-0 overflow-hidden">
      <div className="flex items-center justify-between mb-1 px-0.5">
        <div className="label-caps">
          Trace strip · {traces.length} queued
          {running ? " · analyzing" : ""}
        </div>
        <div className="flex items-center gap-2 mono text-ink-faint">
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-ink-faint inline-block" />queued</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-jev inline-block" />analyzing</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-ok inline-block" />success</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-warn inline-block" />warning</span>
          <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-fail inline-block" />failed</span>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {traces.length === 0 ? (
          <div className="text-[11px] text-ink-faint px-1">No traces loaded</div>
        ) : (
          traces.map((t) => {
            const selected = t.id === selectedId;
            const analysis = analyses.get(t.id);
            const failed = analysis?.metrics?.is_failed_run;
            let dot = statusColor(t.status);
            if (selected && running) dot = "bg-jev animate-strip-active";
            else if (failed === true) dot = "bg-fail";
            else if (failed === false) dot = "bg-ok";
            else if (t.status === "partial") dot = "bg-warn";

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.id)}
                className={`shrink-0 h-9 min-w-[56px] rounded-sm border px-1.5 flex flex-col items-center justify-center transition-colors ${
                  selected
                    ? "border-electric bg-electric-pale"
                    : `${statusBorder(t.status)} bg-surface hover:border-ink`
                }`}
                title={`${t.id} · ${t.agent_name} · ${t.status}${analysis ? " · analyzed" : ""}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full mb-0.5 ${dot}`} />
                <span className="mono text-[9px] text-ink font-medium leading-none">
                  {t.id.replace(/^trace_/, "").slice(0, 6)}
                </span>
                <span className="mono text-[8px] text-ink-faint truncate max-w-[50px] leading-none mt-0.5">
                  {t.agent_name.split("-")[0]}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
