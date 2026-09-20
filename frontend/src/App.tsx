import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { TracePanel } from "./components/TracePanel";
import { ChecksPanel } from "./components/ChecksPanel";
import { StatCards } from "./components/StatCards";
import { ChartsPanel } from "./components/ChartsPanel";
import { StreamPanel } from "./components/StreamPanel";
import { TraceStrip } from "./components/TraceStrip";
import { CompactInsight, InsightsPanel } from "./components/InsightsPanel";
import { useAnalysis } from "./hooks/useAnalysis";
import { PREVIEW_INSIGHTS } from "./lib/demoPreview";

export default function App() {
  const {
    state,
    reset,
    loadDemo,
    upload,
    setMode,
    selectTrace,
    togglePause,
    runAnalysis,
    restartDemo,
    getAnalyses,
  } = useAnalysis();

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const fn = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  // Auto-load demo with populated preview on first paint
  useEffect(() => {
    void loadDemo(48).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTrace = useMemo(
    () => state.traces.find((t) => t.id === state.selectedTraceId) || state.traces[0] || null,
    [state.traces, state.selectedTraceId],
  );

  const analyses = useMemo(() => getAnalyses(), [getAnalyses, state.analysesVersion]);

  // Dismissed overlay must not clear analysis data; reset only when a new run starts.
  const [insightOverlayDismissed, setInsightOverlayDismissed] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.running) setInsightOverlayDismissed(false);
  }, [state.running]);

  const closeInsightOverlay = useCallback(() => {
    setInsightOverlayDismissed(true);
  }, []);

  const showInsights =
    !!state.insights &&
    !insightOverlayDismissed &&
    (state.phase === "insights" || state.phase === "summary" || state.phase === "complete");

  const compactInsights = state.insights || (state.demoData && state.phase === "idle" ? PREVIEW_INSIGHTS : null);

  return (
    <div className="h-screen w-screen overflow-hidden bg-page text-ink">
      <div
        ref={dashboardRef}
        tabIndex={-1}
        className="h-full w-full max-w-[1920px] mx-auto px-2.5 py-2 flex flex-col gap-1.5 relative outline-none"
      >
        <Header
          mode={state.mode}
          running={state.running}
          paused={state.paused}
          phase={state.phase}
          demoData={state.demoData}
          jevModel={state.activeAnalysis?.jev_model || null}
          hasApiKey={state.hasApiKey}
          onMode={setMode}
          onUpload={(f) => void upload(f)}
          onRun={() => {
            if (state.mode === "live") {
              const ids = state.traces.map((tr) => tr.id);
              void runAnalysis({ count: ids.length || 1, speed: 1, traceIds: ids.length ? ids : undefined });
            } else {
              void runAnalysis({ count: 48, speed: 1 });
            }
          }}
          onReset={reset}
          onPause={togglePause}
          onRestartDemo={() => void restartDemo()}
        />

        {state.error ? (
          <div className="panel px-3 py-1.5 text-sm text-fail border-fail shrink-0">{state.error}</div>
        ) : state.notice ? (
          <div className="panel px-3 py-1.5 text-sm text-ink border-electric shrink-0">{state.notice}</div>
        ) : null}

        <StatCards stats={state.stats} demoData={state.demoData} />

        {/* Main workspace: 32% | 28% | 40% */}
        <div className="flex-1 min-h-0 grid gap-1.5" style={{ gridTemplateColumns: "32% 28% 1fr" }}>
          <div className="min-h-0 min-w-0">
            <TracePanel
              trace={selectedTrace}
              analysis={state.activeAnalysis}
              reducedMotion={reducedMotion}
            />
          </div>

          <div className="min-h-0 min-w-0">
            <ChecksPanel
              analysis={state.activeAnalysis}
              revealed={state.revealedChecks || (state.activeAnalysis ? 14 : 0)}
              reducedMotion={reducedMotion}
            />
          </div>

          <div className="min-h-0 min-w-0 flex flex-col gap-2">
            <div className="flex-[1.35] min-h-[280px]">
              <ChartsPanel charts={state.charts} />
            </div>
            <div className="flex-[0.7] min-h-[120px] shrink-0">
              <StreamPanel lines={state.streamLines} demoData={state.demoData} />
            </div>
            <CompactInsight insights={compactInsights} demoData={state.demoData} />
          </div>
        </div>

        <TraceStrip
          traces={state.traces}
          selectedId={state.selectedTraceId}
          analyses={analyses}
          onSelect={selectTrace}
          running={state.running}
        />

        <footer className="flex justify-between items-center px-1 text-[9px] text-ink-faint shrink-0 mono gap-2">
          <span className="truncate">AGENT X-RAY · local-first · TypeSafe JEV · dense 16:9 workspace</span>
          <a
            href="https://x.com/0xMorlex"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 shrink-0 text-ink-mute hover:text-ink border border-line-soft rounded-sm px-1.5 py-0.5 bg-surface"
            title="Morlex on X"
          >
            <img
              src="/morlex-avatar.jpg"
              alt="Morlex"
              className="h-4 w-4 rounded-sm object-cover border border-line-soft"
            />
            <span className="font-semibold text-ink">Morlex</span>
            <span className="text-electric">@0xMorlex</span>
          </a>
          <span className="shrink-0">
            {state.phase !== "idle" ? `phase: ${state.phase}` : "preview ready"} · {state.traces.length} traces
          </span>
        </footer>

        <InsightsPanel
          insights={state.insights}
          show={showInsights}
          reducedMotion={reducedMotion}
          demoData={state.demoData}
          stats={state.stats}
          analyses={Array.from(analyses.values())}
          traces={state.traces}
          jobId={state.jobId}
          jevModel={state.activeAnalysis?.jev_model || null}
          onClose={closeInsightOverlay}
          returnFocusRef={dashboardRef}
        />
      </div>
    </div>
  );
}
