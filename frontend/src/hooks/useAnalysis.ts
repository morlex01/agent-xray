import { useCallback, useEffect, useRef, useState } from "react";
import { getDemoTraces, getHealth, startAnalysis, subscribeEvents, uploadTraces } from "../lib/api";
import { seedPreviewFromTraces } from "../lib/demoPreview";
import type {
  AgentTrace,
  AppState,
  Insights,
  JobResult,
  TraceAnalysis,
} from "../types";

const initialStats = {
  runs: 0,
  judgments: 0,
  failed: 0,
  avoidable: 0,
  elapsedMs: 0,
  throughput: 0,
  wasted: 0,
  apiUsage: null as { input_tokens: number; output_tokens: number } | null,
};

const initial: AppState = {
  mode: "demo",
  phase: "idle",
  running: false,
  paused: false,
  jobId: null,
  traces: [],
  selectedTraceId: null,
  activeAnalysis: null,
  streamLines: [],
  stats: { ...initialStats },
  charts: {},
  insights: null,
  demoData: true,
  hasApiKey: false,
  error: null,
  notice: null,
  revealedChecks: 0,
  analysesVersion: 0,
};

export function useAnalysis() {
  const [state, setState] = useState<AppState>(initial);
  const unsubRef = useRef<(() => void) | null>(null);
  const analysesRef = useRef<Map<string, TraceAnalysis>>(new Map());
  const pauseRef = useRef(false);

  useEffect(() => {
    pauseRef.current = state.paused;
  }, [state.paused]);

  useEffect(() => {
    getHealth()
      .then((h) => setState((s) => ({ ...s, hasApiKey: h.has_api_key })))
      .catch(() => undefined);
    return () => {
      unsubRef.current?.();
    };
  }, []);

  const applyPreview = useCallback((traces: AgentTrace[]) => {
    const preview = seedPreviewFromTraces(traces);
    analysesRef.current = preview.analyses;
    return preview;
  }, []);

  const reset = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    analysesRef.current.clear();
    setState((s) => ({
      ...initial,
      hasApiKey: s.hasApiKey,
      mode: s.mode,
      traces: [],
    }));
  }, []);

  const loadDemo = useCallback(
    async (count = 48) => {
      const res = await getDemoTraces(count);
      const preview = applyPreview(res.traces);
      setState((s) => ({
        ...s,
        traces: res.traces,
        selectedTraceId: preview.selectedTraceId,
        activeAnalysis: preview.activeAnalysis,
        streamLines: preview.streamLines,
        stats: preview.stats,
        charts: preview.charts,
        insights: null,
        demoData: true,
        phase: "idle",
        error: null,
        notice: null,
        revealedChecks: preview.revealedChecks,
        running: false,
        paused: false,
        analysesVersion: s.analysesVersion + 1,
      }));
      return res.traces;
    },
    [applyPreview],
  );

  const upload = useCallback(async (file: File) => {
    const res = await uploadTraces(file);
    const uploaded = res.traces?.length ? res.traces : [];
    setState((s) => ({
      ...s,
      error: null,
      notice: null,
      traces: uploaded.length ? uploaded : s.traces,
      selectedTraceId: uploaded[0]?.id ?? s.selectedTraceId,
      streamLines: [`uploaded ${res.uploaded} traces`],
      demoData: false,
      mode: s.hasApiKey ? s.mode : "demo",
      activeAnalysis: null,
      charts: {},
      stats: { ...initialStats },
      revealedChecks: 0,
      insights: null,
    }));
    analysesRef.current.clear();
    return res;
  }, []);

  const setMode = useCallback((mode: "demo" | "live") => {
    setState((s) => ({ ...s, mode }));
  }, []);

  const selectTrace = useCallback((id: string) => {
    const analysis = analysesRef.current.get(id) ?? null;
    setState((s) => ({
      ...s,
      selectedTraceId: id,
      activeAnalysis: analysis,
      revealedChecks: analysis ? 14 : s.revealedChecks,
    }));
  }, []);

  const togglePause = useCallback(() => {
    setState((s) => ({ ...s, paused: !s.paused }));
  }, []);

  const bindEvents = useCallback((jobId: string, demoFlag: boolean) => {
    const waitIfPaused = async () => {
      while (pauseRef.current) {
        await new Promise((r) => setTimeout(r, 120));
      }
    };

    return subscribeEvents(jobId, {
      onEvent: (event, raw) => {
        const data = raw as Record<string, unknown>;
        void (async () => {
          await waitIfPaused();
          if (event === "phase") {
            const phase = String(data.phase || "checks");
            const message = String((data as { message?: string }).message || "");
            setState((s) => ({
              ...s,
              phase: phase as AppState["phase"],
              demoData: Boolean(data.demo_data ?? (demoFlag || s.demoData)),
              notice: /rate limited/i.test(message)
                ? "JEV rate limited, retrying"
                : s.notice,
              error: null,
            }));
          }
          if (event === "trace_result") {
            const analysis = data.analysis as TraceAnalysis;
            const trace = data.trace as AgentTrace;
            analysesRef.current.set(analysis.trace_id, analysis);
            const agentFailed =
              Boolean((analysis.metrics as { is_failed_run?: boolean } | undefined)?.is_failed_run) ||
              ["failure", "error", "partial"].includes(String(trace?.status || "").toLowerCase()) ||
              (analysis.failure_type?.choice && analysis.failure_type.choice !== "none");
            setState((s) => {
              const tracesMap = new Map(s.traces.map((t) => [t.id, t]));
              if (trace?.id) tracesMap.set(trace.id, { ...(tracesMap.get(trace.id) || ({} as AgentTrace)), ...trace });
              const lines = [...s.streamLines, analysis.stream_line].slice(-80);
              return {
                ...s,
                traces: Array.from(tracesMap.values()),
                selectedTraceId: analysis.trace_id,
                activeAnalysis: analysis,
                streamLines: lines,
                phase: "checks",
                revealedChecks: Math.min(14, Math.max(s.revealedChecks, 2) + 2),
                demoData: Boolean(data.demo_data ?? (demoFlag || s.demoData)),
                analysesVersion: s.analysesVersion + 1,
                error: null,
                notice: agentFailed ? "Agent failure detected and analyzed" : null,
              };
            });
          }
          if (event === "progress") {
            setState((s) => ({
              ...s,
              phase: s.phase === "checks" ? "charts" : s.phase,
              charts: (data.charts as JobResult["charts"]) || s.charts,
              stats: {
                ...s.stats,
                runs: Number(data.completed || s.stats.runs),
                judgments: Number(data.typed_judgments || s.stats.judgments),
                failed: Number(data.failed_runs || s.stats.failed),
                avoidable: Number(data.avoidable_failures || s.stats.avoidable),
                wasted: Number(data.wasted_cost_usd || s.stats.wasted),
                apiUsage: (data.api_usage as AppState["stats"]["apiUsage"]) || s.stats.apiUsage,
              },
              revealedChecks: 14,
            }));
          }
          if (event === "complete") {
            const result = data as unknown as JobResult;
            for (const a of result.analyses || []) {
              analysesRef.current.set(a.trace_id, a);
            }
            setState((s) => {
              const last =
                analysesRef.current.get(s.selectedTraceId || "") ||
                result.analyses?.[result.analyses.length - 1] ||
                null;
              const agentFailed =
                (result.failed_runs || 0) > 0 ||
                Boolean((last?.metrics as { is_failed_run?: boolean } | undefined)?.is_failed_run);
              return {
                ...s,
                running: false,
                phase: "complete",
                error: null,
                notice: agentFailed ? "Agent failure detected and analyzed" : null,
                charts: result.charts || s.charts,
                insights: (result.insights as Insights) || null,
                demoData: result.demo_data ?? demoFlag,
                stats: {
                  runs: result.completed,
                  judgments: result.typed_judgments,
                  failed: result.failed_runs,
                  avoidable: result.avoidable_failures,
                  elapsedMs: result.elapsed_ms,
                  throughput: result.throughput,
                  wasted: result.wasted_cost_usd,
                  apiUsage: result.api_usage || null,
                },
                streamLines: (result.analyses || []).map((a) => a.stream_line).slice(-80),
                activeAnalysis: last,
                revealedChecks: 14,
                analysesVersion: s.analysesVersion + 1,
              };
            });
          }
          if (event === "job_error") {
            setState((s) => ({
              ...s,
              running: false,
              phase: "error",
              notice: null,
              error: String((data as { error?: string }).error || "Analysis failed"),
            }));
          }
          if (event === "trace_error") {
            // Per-trace JEV/system failure — keep queue running; do not mark global error.
            const msg = String((data as { error?: string; trace_id?: string }).error || "Trace analysis skipped");
            const tid = String((data as { trace_id?: string }).trace_id || "");
            setState((s) => ({
              ...s,
              notice: tid ? `Skipped ${tid}: ${msg}` : msg,
              streamLines: [...s.streamLines, `! ${tid || "trace"} ${msg}`].slice(-80),
            }));
          }
        })();
      },
    });
  }, []);

  const runAnalysis = useCallback(
    async (opts?: { count?: number; speed?: number; traceIds?: string[] }) => {
      unsubRef.current?.();
      analysesRef.current.clear();
      const mode = state.mode;
      let traces = state.traces;
      if (mode === "demo" && traces.length === 0) {
        traces = await loadDemo(opts?.count ?? 48);
      }
      setState((s) => ({
        ...s,
        running: true,
        paused: false,
        phase: "init",
        error: null,
        streamLines: [],
        insights: null,
        charts: {},
        stats: { ...initialStats },
        activeAnalysis: null,
        revealedChecks: 0,
        demoData: mode === "demo",
        notice: null,
      }));

      let traceIds = opts?.traceIds;
      if (!traceIds && traces.length > 0) {
        // Live and demo both process the loaded queue; backend paces Live sequentially.
        traceIds = traces.slice(0, opts?.count ?? traces.length).map((tr) => tr.id);
      }
      try {
        const start = await startAnalysis({
          mode,
          demo_count: opts?.count ?? (mode === "demo" ? 48 : Math.min(traces.length || 12, 48)),
          speed: opts?.speed ?? 1.0,
          trace_ids: traceIds,
        });
        setState((s) => ({ ...s, jobId: start.job_id, phase: "intake", error: null }));
        unsubRef.current = bindEvents(start.job_id, mode === "demo");
      } catch (err) {
        setState((s) => ({
          ...s,
          running: false,
          phase: "error",
          notice: null,
          error: err instanceof Error ? err.message : "Analysis failed",
        }));
      }
    },
    [state.mode, state.traces, state.selectedTraceId, loadDemo, bindEvents],
  );

  const restartDemo = useCallback(async () => {
    unsubRef.current?.();
    unsubRef.current = null;
    analysesRef.current.clear();
    await loadDemo(48);
    const start = await startAnalysis({ mode: "demo", demo_count: 48, speed: 1.0 });
    setState((s) => ({
      ...s,
      mode: "demo",
      jobId: start.job_id,
      running: true,
      paused: false,
      phase: "intake",
      error: null,
      streamLines: [],
      insights: null,
      charts: {},
      stats: { ...initialStats },
      activeAnalysis: null,
      revealedChecks: 0,
      demoData: true,
    }));
    unsubRef.current = bindEvents(start.job_id, true);
  }, [loadDemo, bindEvents]);

  const getAnalyses = useCallback(() => analysesRef.current, [state.analysesVersion]);

  return {
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
  };
}
