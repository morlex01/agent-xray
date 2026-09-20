import type { AgentTrace, Insights, JobResult, TraceAnalysis } from "../types";
import { NOUL_LABELS, NOUL_ORDER } from "./judgments";

/** Deterministic preview profile for initial DEMO DATA screen (rate_limit_retry_loop). */
const PREVIEW_NOULS: Record<string, number> = {
  task_completed: 0.08,
  wrong_tool: 0.12,
  unnecessary_tool_call: 0.35,
  unnecessary_retry: 0.94,
  excessive_retry_loop: 0.97,
  missing_context: 0.15,
  tool_failure: 0.88,
  ignored_tool_output: 0.42,
  permission_failure: 0.05,
  premature_stop: 0.10,
  continued_after_completion: 0.03,
  human_approval_needed: 0.20,
  safe_to_retry: 0.55,
  avoidable_cost: 0.91,
};

const PREVIEW_STREAM = [
  "trace_0001 · browser-ops · FAIL · unnecessary_retry p=0.94 · severity 3.1 · DEMO",
  "trace_0002 · api-runner · FAIL · wrong_tool p=0.86 · severity 2.4 · DEMO",
  "trace_0003 · research-bot · PARTIAL · missing_context p=0.95 · severity 2.6 · DEMO",
  "trace_0004 · checkout-agent · FAIL · tool_failure p=0.96 · severity 2.9 · DEMO",
  "trace_0005 · browser-ops · FAIL · excessive_retry_loop p=0.97 · severity 3.1 · DEMO",
  "trace_0006 · data-scout · OK · avoidable_cost p=0.48 · severity 1.2 · DEMO",
  "trace_0007 · api-runner · FAIL · permission p=0.93 · severity 3.4 · DEMO",
  "trace_0008 · research-bot · FAIL · wrong_tool p=0.91 · severity 2.8 · DEMO",
];

export const PREVIEW_STATS = {
  runs: 48,
  judgments: 816,
  failed: 31,
  avoidable: 24,
  elapsedMs: 18400,
  throughput: 2.61,
  wasted: 4.872,
  apiUsage: null as { input_tokens: number; output_tokens: number } | null,
};

export const PREVIEW_CHARTS: JobResult["charts"] = {
  failure_types: [
    { name: "unnecessary_retry", value: 12 },
    { name: "tool_failure", value: 8 },
    { name: "wrong_tool", value: 6 },
    { name: "missing_context", value: 5 },
    { name: "permission", value: 3 },
    { name: "none", value: 14 },
  ],
  severity: [
    { name: "1", value: 6 },
    { name: "2", value: 11 },
    { name: "3", value: 18 },
    { name: "4", value: 13 },
  ],
  by_agent: [
    { name: "browser-ops", value: 11 },
    { name: "api-runner", value: 9 },
    { name: "research-bot", value: 7 },
    { name: "checkout-agent", value: 5 },
    { name: "data-scout", value: 3 },
  ],
  retries: [
    { name: "retry_loop", value: 19 },
    { name: "single_retry", value: 8 },
    { name: "no_retry", value: 21 },
  ],
  waste: [
    { name: "browser-ops", value: 1.84 },
    { name: "api-runner", value: 1.42 },
    { name: "research-bot", value: 0.91 },
    { name: "checkout-agent", value: 0.70 },
  ],
};

export const PREVIEW_INSIGHTS: Insights = {
  top_pattern: "Unnecessary retry loops",
  most_expensive_agent: "browser-ops",
  common_retry_loop: "rate_limit → retry ×5",
  avoidable_pct: 77.4,
  by_agent: {
    "browser-ops": { failures: 11, cost_usd: 2.41, waste_usd: 1.84 },
    "api-runner": { failures: 9, cost_usd: 1.98, waste_usd: 1.42 },
    "research-bot": { failures: 7, cost_usd: 1.22, waste_usd: 0.91 },
    "checkout-agent": { failures: 5, cost_usd: 0.95, waste_usd: 0.7 },
    "data-scout": { failures: 3, cost_usd: 0.44, waste_usd: 0.0 },
  },
  wasted_cost_usd: 4.872,
  recommendations: [
    "Cap retries on rate-limit errors; backoff instead of tight loops.",
    "Surface tool failures after 2 attempts — stop burning tokens.",
    "Require page context before browser click / navigate actions.",
  ],
};

export function buildPreviewAnalysis(trace: AgentTrace): TraceAnalysis {
  const nouls: TraceAnalysis["nouls"] = {};
  for (const id of NOUL_ORDER) {
    nouls[id] = {
      id,
      noul: PREVIEW_NOULS[id] ?? 0.2,
      label: NOUL_LABELS[id] || id,
    };
  }
  return {
    trace_id: trace.id,
    agent_name: trace.agent_name,
    mode: "demo",
    nouls,
    failure_type: {
      id: "failure_type",
      choice: "unnecessary_retry",
      probabilities: {
        unnecessary_retry: 0.62,
        tool_failure: 0.18,
        wrong_tool: 0.1,
        missing_context: 0.06,
        permission: 0.04,
      },
      confidence: 0.86,
    },
    failure_stage: {
      id: "failure_stage",
      choice: "tool_execution",
      probabilities: {
        tool_execution: 0.71,
        tool_selection: 0.14,
        planning: 0.1,
        response: 0.05,
      },
      confidence: 0.81,
    },
    severity: {
      id: "severity",
      score: 3.1,
      legend: { "1": "low", "2": "moderate", "3": "high", "4": "critical" },
      probabilities: { "1": 0.05, "2": 0.15, "3": 0.55, "4": 0.25 },
      confidence: 0.88,
    },
    metrics: {
      is_failed_run: true,
      avoidable: true,
      demo_pattern: "rate_limit_retry_loop",
      retries: 5,
    },
    usage: null,
    demo_data: true,
    stream_line: `${trace.id} · ${trace.agent_name} · FAIL · unnecessary_retry p=0.94 · severity 3.1 · DEMO`,
  };
}

export function seedPreviewFromTraces(traces: AgentTrace[]) {
  const selected = traces[0] || null;
  const activeAnalysis = selected ? buildPreviewAnalysis(selected) : null;
  const analyses = new Map<string, TraceAnalysis>();
  // Seed first ~12 traces as "analyzed" for strip coloring
  traces.slice(0, 12).forEach((t, i) => {
    const a = buildPreviewAnalysis(t);
    // Vary failure flag for strip variety
    a.metrics = {
      ...a.metrics,
      is_failed_run: i % 3 !== 2,
      avoidable: i % 4 !== 0,
    };
    analyses.set(t.id, a);
  });
  return {
    selectedTraceId: selected?.id ?? null,
    activeAnalysis,
    analyses,
    streamLines: PREVIEW_STREAM,
    stats: { ...PREVIEW_STATS },
    charts: structuredClone(PREVIEW_CHARTS),
    insights: null as Insights | null, // overlay only after run
    revealedChecks: 14,
  };
}

export const FINAL_PATTERNS = [
  { n: "01", title: "Unnecessary retry loops" },
  { n: "02", title: "Tool failures after repeated calls" },
  { n: "03", title: "Missing context before browser actions" },
];
