/**
 * Deterministic Fix Pack builder — turns current JEV analysis into a coding prompt
 * and Markdown download. Never invents files/APIs; never calls an external model.
 */
import type { AgentTrace, Insights, TraceAnalysis, TraceStep } from "../types";
import { FINAL_PATTERNS } from "./demoPreview";
import { NOUL_LABELS } from "./judgments";

export interface FixPackStats {
  runs: number;
  judgments: number;
  failed: number;
  avoidable: number;
  wasted: number;
}

export interface FixPackInput {
  insights: Insights;
  analyses: TraceAnalysis[];
  traces: AgentTrace[];
  stats: FixPackStats;
  demoData: boolean;
  jevModel?: string | null;
  jobId?: string | null;
  generatedAt?: Date;
}

export type TraceClass = "confirmed_failure" | "near_miss" | "successful_control";

export interface ClassifiedTrace {
  analysis: TraceAnalysis;
  trace?: AgentTrace;
  klass: TraceClass;
  failureType: string | null;
  /** Real stage only when confirmed failure and stage is not unknown/empty */
  stage: string | null;
  highConfidence: boolean;
  warningKeys: string[];
}

const SECRET_RE =
  /(?:api[_-]?key|authorization|bearer|token|password|secret|credential|private[_-]?key)\s*[:=]\s*["']?[^\s"',}]+/gi;
const LONG_TOKEN_RE = /\b(?:sk-|pk-|ghp_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]{8,}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const WARNING_JUDGMENTS = [
  "wrong_tool",
  "unnecessary_tool_call",
  "premature_stop",
  "ignored_tool_output",
  "unnecessary_retry",
  "excessive_retry_loop",
  "missing_context",
  "tool_failure",
  "permission_failure",
  "continued_after_completion",
  "human_approval_needed",
  "avoidable_cost",
] as const;

const WARNING_THRESHOLD = 0.45;
const HIGH_CONFIDENCE = 0.55;
const LOW_CONFIDENCE = 0.55;

export function sanitizeText(value: unknown, limit = 280): string {
  if (value == null) return "";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  text = text
    .replace(SECRET_RE, "[REDACTED]")
    .replace(LONG_TOKEN_RE, "[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > limit) return text.slice(0, limit - 3) + "...";
  return text;
}

const REMEDIATION: Record<string, string> = {
  unnecessary_retry:
    "Respect `Retry-After`, add exponential backoff and jitter, cap attempts, and add idempotency keys for side-effecting calls.",
  excessive_retry_loop:
    "Respect `Retry-After`, add exponential backoff and jitter, cap attempts, and add idempotency keys for side-effecting calls.",
  agent_loop:
    "Respect `Retry-After`, add exponential backoff and jitter, cap attempts, and add idempotency keys for side-effecting calls.",
  rate_limit_retry_loop:
    "Respect `Retry-After`, add exponential backoff and jitter, cap attempts, and add idempotency keys for side-effecting calls.",
  wrong_tool: "Validate tool selection and tool capabilities before execution.",
  tool_failure: "Classify errors and use safe fallback behavior when tools fail.",
  external_api: "Classify errors and use safe fallback behavior when tools fail.",
  missing_context: "Validate required fields before tool execution.",
  ignored_tool_output:
    "Treat failed tool responses as blocking and verify results before continuing.",
  ignored_output:
    "Treat failed tool responses as blocking and verify results before continuing.",
  permission:
    "Add an explicit human approval gate before sensitive, irreversible, or privileged actions.",
  permission_failure:
    "Add an explicit human approval gate before sensitive, irreversible, or privileged actions.",
  human_approval_needed:
    "Add an explicit human approval gate before sensitive, irreversible, or privileged actions.",
  premature_stop: "Define completion criteria and verify the final result before stopping.",
  continued_after_completion: "Add a termination guard once the user request is complete.",
  unnecessary_tool_call: "Gate tool calls on necessity; skip tools that do not advance the goal.",
  avoidable_cost: "Eliminate avoidable retries and unnecessary tool calls that inflate cost.",
  bad_instruction: "Clarify instruction handling and refuse ambiguous high-risk actions.",
  unknown: "Inspect the failing traces, classify the dominant error class, then apply a targeted fix.",
};

function judgmentScore(a: TraceAnalysis, key: string): number {
  // Internal property remains `.noul`; user-facing label is "judgment score".
  return Number(a.nouls?.[key]?.noul ?? 0);
}

function rawFailureType(a: TraceAnalysis): string | null {
  const fromChoice = a.failure_type?.choice;
  const fromMetrics = (a.metrics as { primary_failure?: string } | undefined)?.primary_failure;
  const ft = (fromChoice || fromMetrics || "").trim();
  return ft || null;
}

function isRealFailureType(ft: string | null): boolean {
  if (!ft) return false;
  const n = ft.toLowerCase();
  return n !== "none" && n !== "n/a" && n !== "null";
}

function isSuccessStatus(status: string | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "success" || s === "ok" || s === "completed" || s === "complete";
}

function isFailedStatus(status: string | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "failure" || s === "error" || s === "failed" || s === "timeout" || s === "partial";
}

function confidenceOf(a: TraceAnalysis): number | null {
  const c =
    a.failure_type?.confidence ??
    a.failure_stage?.confidence ??
    a.severity?.confidence ??
    null;
  return c == null ? null : Number(c);
}

function isHighConfidence(a: TraceAnalysis, klass: TraceClass): boolean {
  if (klass !== "confirmed_failure") return false;
  const c = confidenceOf(a);
  if (c == null) {
    // No confidence reported — treat metric-backed failures as high enough for root causes
    return true;
  }
  return c >= HIGH_CONFIDENCE;
}

function warningKeysFor(a: TraceAnalysis): string[] {
  return WARNING_JUDGMENTS.filter((k) => judgmentScore(a, k) >= WARNING_THRESHOLD);
}

export function classifyTrace(analysis: TraceAnalysis, trace?: AgentTrace): ClassifiedTrace {
  const status = trace?.status;
  const ft = rawFailureType(analysis);
  const realFt = isRealFailureType(ft) ? ft : null;
  const warnings = warningKeysFor(analysis);

  let klass: TraceClass;
  if (isFailedStatus(status) || realFt) {
    klass = "confirmed_failure";
  } else if (isSuccessStatus(status) && warnings.length > 0) {
    klass = "near_miss";
  } else if (
    // metrics may mark is_failed_run even when status=success & type=none — do NOT trust alone
    Boolean((analysis.metrics as { is_failed_run?: boolean } | undefined)?.is_failed_run) &&
    !isSuccessStatus(status) &&
    realFt
  ) {
    klass = "confirmed_failure";
  } else if (warnings.length > 0 && !isSuccessStatus(status) && !isFailedStatus(status)) {
    // ambiguous status with warnings → near miss rather than confirmed
    klass = "near_miss";
  } else {
    klass = "successful_control";
  }

  // Successful + failure_type none must never be confirmed failure
  if (isSuccessStatus(status) && !realFt) {
    klass = warnings.length > 0 ? "near_miss" : "successful_control";
  }

  const stageRaw = (analysis.failure_stage?.choice || "").trim();
  const stageOk =
    klass === "confirmed_failure" &&
    stageRaw &&
    stageRaw.toLowerCase() !== "unknown"
      ? stageRaw
      : null;

  return {
    analysis,
    trace,
    klass,
    failureType: klass === "confirmed_failure" ? realFt : null,
    stage: stageOk,
    highConfidence: isHighConfidence(analysis, klass),
    warningKeys: warnings,
  };
}

export function classifyAll(
  analyses: TraceAnalysis[],
  traces: AgentTrace[],
): ClassifiedTrace[] {
  const byId = new Map(traces.map((t) => [t.id, t]));
  return analyses.map((a) => classifyTrace(a, byId.get(a.trace_id)));
}

function severityLabel(a: TraceAnalysis, opts?: { forConfirmed?: boolean }): string | null {
  const sev = a.severity;
  if (!sev) return opts?.forConfirmed ? null : null;
  const score = Number(sev.score ?? 0);
  const legend = sev.legend || {};
  const entries = Object.entries(legend);
  if (entries.length) {
    const nearest = entries.reduce((best, cur) => {
      const bd = Math.abs(Number(best[0]) - score);
      const cd = Math.abs(Number(cur[0]) - score);
      return cd < bd ? cur : best;
    });
    const label = String(nearest[1] || "").toLowerCase();
    if (label === "no failure" || label === "none" || label === "unknown") {
      return opts?.forConfirmed ? `score ${score.toFixed(2)}` : `${nearest[1]} (score ${score.toFixed(2)})`;
    }
    return `${nearest[1]} (score ${score.toFixed(2)})`;
  }
  return `score ${score.toFixed(2)}`;
}

function failedSteps(trace: AgentTrace | undefined): TraceStep[] {
  if (!trace?.steps?.length) return [];
  return trace.steps.filter((s) => {
    const st = String(s.status || "").toLowerCase();
    return Boolean(s.error) || st === "error" || st === "failure" || st === "timeout" || st === "fail";
  });
}

/** Aggregate failure types from confirmed failures only — never includes `none`. */
function topFailureTypes(classified: ClassifiedTrace[], limit = 5): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of classified) {
    if (c.klass !== "confirmed_failure") continue;
    if (!c.failureType || !isRealFailureType(c.failureType)) continue;
    counts.set(c.failureType, (counts.get(c.failureType) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Top patterns for remediation: prefer high-confidence confirmed failure types.
 * Fall back to near-miss warning keys only when no stronger evidence exists.
 * Never returns `none`.
 */
function topPatterns(classified: ClassifiedTrace[], insights: Insights): string[] {
  const high = classified.filter((c) => c.klass === "confirmed_failure" && c.highConfidence);
  const allConfirmed = classified.filter((c) => c.klass === "confirmed_failure");
  const pool = high.length ? high : allConfirmed;

  const fromConfirmed = topFailureTypes(pool, 5).map((t) => t.name);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const v = raw.trim();
    if (!v || !isRealFailureType(v)) return;
    if (v.toLowerCase() === "none") return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  for (const n of fromConfirmed) push(n);

  if (out.length < 3 && insights.top_pattern) push(insights.top_pattern);
  if (
    out.length < 3 &&
    insights.common_retry_loop &&
    insights.common_retry_loop !== "none detected"
  ) {
    push(insights.common_retry_loop);
  }

  if (out.length === 0) {
    // No confirmed failures — use near-miss warning keys as soft patterns (labeled later)
    const warnCounts = new Map<string, number>();
    for (const c of classified.filter((x) => x.klass === "near_miss")) {
      for (const w of c.warningKeys) warnCounts.set(w, (warnCounts.get(w) || 0) + 1);
    }
    [...warnCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([k]) => push(k));
  }

  // Do not pad with FINAL_PATTERNS titles that invent patterns not in data
  void FINAL_PATTERNS;
  return out.slice(0, 3);
}

function formatConfidence(c: number | null | undefined): string {
  if (c == null || Number.isNaN(Number(c))) return "n/a";
  const n = Number(c);
  const base = n.toFixed(2);
  if (n < LOW_CONFIDENCE) return `${base} (low-confidence signal)`;
  return base;
}

function relevantJudgments(a: TraceAnalysis, klass: TraceClass): string[] {
  const lines: string[] = [];
  const highlight = [
    "unnecessary_retry",
    "excessive_retry_loop",
    "tool_failure",
    "wrong_tool",
    "missing_context",
    "ignored_tool_output",
    "permission_failure",
    "premature_stop",
    "continued_after_completion",
    "human_approval_needed",
    "unnecessary_tool_call",
    "avoidable_cost",
    "task_completed",
    "safe_to_retry",
  ];
  for (const key of highlight) {
    const v = judgmentScore(a, key);
    if (klass === "successful_control") {
      if (key === "task_completed" && v >= 0.55) {
        lines.push(`${NOUL_LABELS[key] || key} (${key}): judgment score=${v.toFixed(2)}`);
      }
      continue;
    }
    if (v < WARNING_THRESHOLD && key !== "task_completed") continue;
    if (klass === "confirmed_failure" && key === "task_completed" && v >= 0.55) continue;
    const label = NOUL_LABELS[key] || key;
    lines.push(`${label} (${key}): judgment score=${v.toFixed(2)}`);
  }

  if (klass === "confirmed_failure") {
    if (a.failure_type?.choice && isRealFailureType(a.failure_type.choice)) {
      lines.push(
        `failure_type: ${a.failure_type.choice}, confidence=${formatConfidence(a.failure_type.confidence)}`,
      );
    }
    const stage = (a.failure_stage?.choice || "").trim();
    if (stage && stage.toLowerCase() !== "unknown") {
      lines.push(`failure_stage: ${stage}, confidence=${formatConfidence(a.failure_stage?.confidence)}`);
    }
    const sev = severityLabel(a, { forConfirmed: true });
    if (sev) {
      lines.push(`severity: ${sev}, confidence=${formatConfidence(a.severity?.confidence)}`);
    }
  } else if (klass === "near_miss") {
    // Do not present failure_type=none or stage=unknown as findings
    lines.push(`classification: Near miss (successful run with elevated warning judgments)`);
  } else {
    lines.push(`classification: Successful control`);
  }
  return lines;
}

function remediationFor(pattern: string): string | null {
  const key = pattern.toLowerCase().replace(/\s+/g, "_");
  if (key === "none") return null;
  if (REMEDIATION[key]) return REMEDIATION[key];
  for (const [k, v] of Object.entries(REMEDIATION)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  if (/retry|loop|rate.?limit|429/.test(key)) return REMEDIATION.unnecessary_retry;
  if (/tool.?fail|timeout/.test(key)) return REMEDIATION.tool_failure;
  if (/missing|context/.test(key)) return REMEDIATION.missing_context;
  if (/wrong.?tool/.test(key)) return REMEDIATION.wrong_tool;
  if (/permission|approval/.test(key)) return REMEDIATION.permission;
  if (/premature|stop/.test(key)) return REMEDIATION.premature_stop;
  if (/ignored/.test(key)) return REMEDIATION.ignored_tool_output;
  if (/continued|termination/.test(key)) return REMEDIATION.continued_after_completion;
  return REMEDIATION.unknown;
}

function sourceLabel(demoData: boolean, jevModel?: string | null): string {
  if (demoData) return "DEMO DATA";
  return jevModel ? `LIVE JEV (${jevModel})` : "LIVE JEV";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fixPackFilename(when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = pad2(when.getMonth() + 1);
  const d = pad2(when.getDate());
  const hh = pad2(when.getHours());
  const mm = pad2(when.getMinutes());
  return `agent-xray-fix-pack-${y}${m}${d}-${hh}${mm}.md`;
}

function avoidableStats(classified: ClassifiedTrace[], insights: Insights, stats: FixPackStats) {
  const confirmed = classified.filter((c) => c.klass === "confirmed_failure");
  const avoidableConfirmed = confirmed.filter((c) =>
    Boolean((c.analysis.metrics as { is_avoidable?: boolean } | undefined)?.is_avoidable),
  );
  const denom = confirmed.length;
  const numer = avoidableConfirmed.length;
  const pct = denom > 0 ? Math.round((1000 * numer) / denom) / 10 : null;
  return {
    confirmedCount: denom,
    avoidableConfirmedCount: numer,
    pctAmongConfirmed: pct,
    insightsAvoidablePct: insights.avoidable_pct,
    insightsNote:
      "Insights avoidable % may use all analyzed runs as denominator; prefer % among confirmed failures when present.",
    wasted: Number(stats.wasted || insights.wasted_cost_usd || 0),
  };
}

function buildEvidenceBlocks(classified: ClassifiedTrace[], limitPerClass: Record<TraceClass, number>): string[] {
  const blocks: string[] = [];
  const order: TraceClass[] = ["confirmed_failure", "near_miss", "successful_control"];
  const titles: Record<TraceClass, string> = {
    confirmed_failure: "Confirmed failures",
    near_miss: "Near misses",
    successful_control: "Successful controls",
  };

  for (const klass of order) {
    const items = classified.filter((c) => c.klass === klass).slice(0, limitPerClass[klass]);
    if (!items.length) continue;
    blocks.push(`### ${titles[klass]}`);
    for (const c of items) {
      const a = c.analysis;
      const trace = c.trace;
      const lines: string[] = [];
      lines.push(`#### ${a.trace_id} · agent \`${a.agent_name}\``);
      const status = trace?.status ?? "n/a";
      if (klass === "confirmed_failure") {
        lines.push(
          `- status: ${status}; failure_type: ${c.failureType ?? "n/a"}; stage: ${c.stage ?? "n/a (not reported)"}; severity: ${severityLabel(a) ?? "n/a"}`,
        );
      } else if (klass === "near_miss") {
        lines.push(
          `- status: ${status}; classification: Near miss; warning judgments: ${c.warningKeys.join(", ") || "n/a"}`,
        );
      } else {
        lines.push(`- status: ${status}; classification: Successful control`);
      }
      if (trace?.user_request) {
        lines.push(`- user_request: ${sanitizeText(trace.user_request, 220)}`);
      }
      const judgments = relevantJudgments(a, klass);
      if (judgments.length) {
        lines.push(`- JEV judgments:`);
        for (const j of judgments.slice(0, 12)) lines.push(`  - ${j}`);
      }
      const steps = failedSteps(trace).slice(0, 4);
      if (klass === "confirmed_failure" && steps.length) {
        lines.push(`- failed / errored tool steps (sanitized):`);
        for (const s of steps) {
          lines.push(
            `  - [${sanitizeText(s.action || s.role, 40)}] tool=${sanitizeText(s.tool_name || "n/a", 40)} status=${sanitizeText(s.status, 24)} error=${sanitizeText(s.error || "", 160)}`,
          );
          if (s.output != null) lines.push(`    output: ${sanitizeText(s.output, 160)}`);
          if (s.input != null) lines.push(`    input: ${sanitizeText(s.input, 120)}`);
        }
      } else if (klass === "confirmed_failure") {
        lines.push(`- no explicit tool error fields on steps; use JEV judgments and stream line as evidence.`);
        if (a.stream_line) lines.push(`- stream: ${sanitizeText(a.stream_line, 240)}`);
      }
      // Preserve concrete 429 / retry-loop evidence when present in any class
      const blob = JSON.stringify(trace || {}).toLowerCase();
      if (blob.includes("429") || blob.includes("rate_limit") || blob.includes("retry-after")) {
        lines.push(`- rate-limit / 429 evidence present in trace payload (sanitized excerpts below).`);
        for (const s of (trace?.steps || []).slice(0, 12)) {
          const piece = `${s.error || ""} ${typeof s.output === "string" ? s.output : JSON.stringify(s.output || "")}`.toLowerCase();
          if (piece.includes("429") || piece.includes("rate") || piece.includes("retry")) {
            lines.push(
              `  - tool=${sanitizeText(s.tool_name || "n/a", 40)} status=${sanitizeText(s.status, 24)} error=${sanitizeText(s.error || "", 160)} output=${sanitizeText(s.output, 160)}`,
            );
          }
        }
      }
      blocks.push(lines.join("\n"));
    }
  }
  return blocks;
}

function buildAcceptanceTests(classified: ClassifiedTrace[], patterns: string[]): string[] {
  const tests: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    if (!seen.has(t)) {
      seen.add(t);
      tests.push(t);
    }
  };

  const confirmed = classified.filter((c) => c.klass === "confirmed_failure");
  const near = classified.filter((c) => c.klass === "near_miss");
  const ok = classified.filter((c) => c.klass === "successful_control");

  for (const p of patterns) {
    const key = p.toLowerCase();
    if (/retry|loop|rate|429|agent_loop|unnecessary_retry|excessive/.test(key)) {
      add(
        "Confirmed-failure regression: simulate HTTP 429 / rate-limit with Retry-After; assert the agent backs off with jitter, does not exceed the attempt cap, and does not busy-loop.",
      );
      add(
        "Confirmed-failure regression: identical side-effecting tool call with an idempotency key is not duplicated across retries.",
      );
    }
    if (/wrong_tool|wrong tool/.test(key)) {
      add(
        "Confirmed-failure regression: when the goal requires tool A, the agent does not invoke an unrelated tool B; selection is validated against declared capabilities.",
      );
    }
    if (/tool_failure|tool fail|timeout|external_api/.test(key)) {
      add(
        "Confirmed-failure regression: a failing tool (error/timeout) is classified and triggers safe fallback instead of an unbounded retry storm.",
      );
    }
    if (/missing_context|missing context/.test(key)) {
      add(
        "Confirmed-failure regression: required context fields are validated before tool execution; missing fields block the call with a clear error.",
      );
    }
    if (/ignored/.test(key)) {
      add(
        "Confirmed-failure regression: a failed or contradictory tool response blocks progress until verified; the agent does not ignore the failure.",
      );
    }
    if (/permission|approval|human/.test(key)) {
      add(
        "Confirmed-failure regression: sensitive / privileged actions require an explicit approval gate before execution.",
      );
    }
    if (/premature|stop/.test(key)) {
      add(
        "Confirmed-failure regression: the agent only stops when completion criteria are met and the final result is verified.",
      );
    }
    if (/continued|termination|after_completion/.test(key)) {
      add(
        "Confirmed-failure regression: after successful completion, a termination guard prevents further tool calls.",
      );
    }
  }

  for (const c of confirmed.slice(0, 6)) {
    const ft = c.failureType;
    if (!ft || !isRealFailureType(ft)) continue;
    add(
      `Confirmed failure (${c.analysis.trace_id}, agent ${c.analysis.agent_name}): replaying the sanitized scenario must not reproduce the detected failure pattern (failure_type=${ft}).`,
    );
  }

  for (const c of near.slice(0, 4)) {
    add(
      `Near miss (${c.analysis.trace_id}, agent ${c.analysis.agent_name}): verify the agent uses the correct tool; verify unnecessary tool calls are not made; verify task completion criteria are satisfied; confirm the trace remains successful.`,
    );
  }

  for (const c of ok.slice(0, 3)) {
    add(
      `Successful control (${c.analysis.trace_id}, agent ${c.analysis.agent_name}): verify that existing successful behavior is preserved.`,
    );
  }

  add("Smoke: dashboard / unrelated UI and visual design remain unchanged.");
  return tests;
}

function rootCauseEntries(classified: ClassifiedTrace[]): ClassifiedTrace[] {
  const high = classified.filter((c) => c.klass === "confirmed_failure" && c.highConfidence);
  if (high.length) return high;
  // Only when no stronger evidence: include low-confidence confirmed failures
  const low = classified.filter((c) => c.klass === "confirmed_failure" && !c.highConfidence);
  return low;
}

export function buildCodingPrompt(input: FixPackInput): string {
  const { insights, analyses, traces, stats, demoData, jevModel } = input;
  const classified = classifyAll(analyses, traces);
  const confirmed = classified.filter((c) => c.klass === "confirmed_failure");
  const near = classified.filter((c) => c.klass === "near_miss");
  const controls = classified.filter((c) => c.klass === "successful_control");
  const patterns = topPatterns(classified, insights);
  const failureTypes = topFailureTypes(classified);
  const rootCauses = rootCauseEntries(classified);
  const agents = [...new Set(confirmed.map((c) => c.analysis.agent_name).filter(Boolean))];
  const evidence = buildEvidenceBlocks(classified, {
    confirmed_failure: 6,
    near_miss: 4,
    successful_control: 2,
  });
  const acceptance = buildAcceptanceTests(classified, patterns);
  const avoid = avoidableStats(classified, insights, stats);

  const problem =
    patterns[0]
      ? `Dominant confirmed failure pattern: ${patterns[0]}${patterns.length > 1 ? ` (also seen: ${patterns.slice(1).join(", ")})` : ""}.`
      : near.length
        ? `No confirmed failures; ${near.length} near-miss successful run(s) with elevated warning judgments.`
        : `No confirmed failures or near misses in this pack (${controls.length} successful control(s)).`;

  const lines: string[] = [];
  lines.push(`# Agent X-Ray coding fix prompt`);
  lines.push(``);
  lines.push(
    `Source: ${sourceLabel(demoData, jevModel)}. Built deterministically from JEV analysis — do not invent files, functions, APIs, or architecture that are not present in the repository or the evidence below.`,
  );
  lines.push(``);
  lines.push(`## Problem`);
  lines.push(problem);
  if (insights.top_pattern && isRealFailureType(insights.top_pattern)) {
    lines.push(
      `Top insight pattern: ${insights.top_pattern}. Cost hotspot agent: ${insights.most_expensive_agent}. Common retry loop: ${insights.common_retry_loop}.`,
    );
  } else {
    lines.push(
      `Cost hotspot agent: ${insights.most_expensive_agent}. Common retry loop: ${insights.common_retry_loop}.`,
    );
  }
  lines.push(
    `Estimated avoidable cost (wasted): $${avoid.wasted.toFixed(4)}. Avoidable among confirmed failures: ${avoid.avoidableConfirmedCount}/${avoid.confirmedCount}${avoid.pctAmongConfirmed != null ? ` (${avoid.pctAmongConfirmed}%)` : ""} — denominator is confirmed failed runs only. Insights avoidable % (all-run denominator, for reference): ${avoid.insightsAvoidablePct}%.`,
  );
  lines.push(``);
  lines.push(`## Classification`);
  lines.push(`- Confirmed failures: ${confirmed.length} — ${confirmed.map((c) => c.analysis.trace_id).join(", ") || "none"}`);
  lines.push(`- Near misses: ${near.length} — ${near.map((c) => c.analysis.trace_id).join(", ") || "none"}`);
  lines.push(`- Successful controls: ${controls.length} — ${controls.map((c) => c.analysis.trace_id).join(", ") || "none"}`);
  lines.push(``);
  lines.push(`## Affected agents and traces (confirmed failures)`);
  lines.push(`Agents: ${agents.length ? agents.join(", ") : "(none — no confirmed failures)"}.`);
  lines.push(
    `Confirmed failure trace IDs: ${confirmed.length ? confirmed.map((c) => c.analysis.trace_id).join(", ") : "none"}.`,
  );
  if (near.length) {
    lines.push(`Near-miss trace IDs (not failures): ${near.map((c) => c.analysis.trace_id).join(", ")}.`);
  }
  lines.push(``);
  lines.push(`## Failure types, stages, severity (confirmed failures only)`);
  if (!rootCauses.length) {
    lines.push(`_No confirmed root causes in this pack._`);
  }
  for (const c of rootCauses.slice(0, 10)) {
    const a = c.analysis;
    const confNote = c.highConfidence ? "" : " [low-confidence signal]";
    lines.push(
      `- ${a.trace_id} (${a.agent_name})${confNote}: type=${c.failureType ?? "n/a"} (conf=${formatConfidence(a.failure_type?.confidence)}), stage=${c.stage ?? "n/a (not reported)"} (conf=${c.stage ? formatConfidence(a.failure_stage?.confidence) : "n/a"}), severity=${severityLabel(a) ?? "n/a"}`,
    );
  }
  if (failureTypes.length) {
    lines.push(`Aggregate failure types (excludes none): ${failureTypes.map((f) => `${f.name}×${f.count}`).join(", ")}.`);
  }
  lines.push(``);
  lines.push(`## Relevant JEV judgments`);
  for (const c of [...rootCauses, ...near, ...controls].slice(0, 8)) {
    lines.push(`### ${c.analysis.trace_id} (${c.klass.replace(/_/g, " ")})`);
    for (const j of relevantJudgments(c.analysis, c.klass)) lines.push(`- ${j}`);
  }
  lines.push(``);
  lines.push(`## Evidence (sanitized; secrets redacted)`);
  lines.push(evidence.join("\n\n") || "_No evidence recorded._");
  lines.push(``);
  lines.push(`## Recommended implementation changes`);
  if (patterns.length === 0) {
    lines.push(`_No remediation requirements — no confirmed failure patterns (and no near-miss patterns to harden)._`);
  } else {
    const onlyNearMissPatterns =
      confirmed.length === 0 && near.length > 0
        ? "These patterns come from Near misses only — harden carefully; do not treat as confirmed outages."
        : "Derive changes only from confirmed patterns present in this analysis.";
    lines.push(onlyNearMissPatterns);
    for (const p of patterns) {
      const rem = remediationFor(p);
      if (!rem) continue;
      lines.push(`- **${p}**: ${rem}`);
    }
  }
  for (const r of insights.recommendations.slice(0, 5)) {
    lines.push(`- Insight recommendation: ${r}`);
  }
  lines.push(``);
  lines.push(`## Working rules (mandatory)`);
  lines.push(
    `1. Inspect the actual repository first. Locate the real modules that implement the failing agent behavior, tool calling, retries, and completion logic before editing.`,
  );
  lines.push(
    `2. Do not invent filenames, functions, APIs, services, or architecture that are not already in the repo or explicitly named in the evidence above.`,
  );
  lines.push(
    `3. Preserve unrelated behavior and visual design. Do not redesign UI, rename products, or change unrelated features.`,
  );
  lines.push(`4. Prefer minimal, targeted patches with tests.`);
  lines.push(`5. Treat this analysis source as ${sourceLabel(demoData, jevModel)}.`);
  lines.push(
    `6. Do not “fix” successful controls. Near misses need verification, not the same remediation priority as confirmed failures.`,
  );
  lines.push(``);
  lines.push(`## Acceptance tests`);
  for (const t of acceptance) lines.push(`- ${t}`);
  lines.push(``);
  lines.push(`## Deliverable`);
  lines.push(
    `Implement the fixes for confirmed failures, add/adjust the acceptance tests above, and summarize which repository files you changed and why.`,
  );
  return lines.join("\n");
}

export function buildFixPackMarkdown(input: FixPackInput): string {
  const { insights, analyses, traces, stats, demoData, jevModel, jobId, generatedAt } = input;
  const when = generatedAt || new Date();
  const classified = classifyAll(analyses, traces);
  const confirmed = classified.filter((c) => c.klass === "confirmed_failure");
  const near = classified.filter((c) => c.klass === "near_miss");
  const controls = classified.filter((c) => c.klass === "successful_control");
  const patterns = topPatterns(classified, insights);
  const failureTypes = topFailureTypes(classified);
  const rootCauses = rootCauseEntries(classified);
  const prompt = buildCodingPrompt(input);
  const acceptance = buildAcceptanceTests(classified, patterns);
  const evidence = buildEvidenceBlocks(classified, {
    confirmed_failure: 10,
    near_miss: 6,
    successful_control: 3,
  });
  const avoid = avoidableStats(classified, insights, stats);

  const lines: string[] = [];
  lines.push(`# Agent X-Ray Fix Pack`);
  lines.push(``);
  lines.push(`- Generated: ${when.toISOString()}`);
  lines.push(`- Source: **${sourceLabel(demoData, jevModel)}**`);
  if (jobId) lines.push(`- Job: \`${jobId}\``);
  lines.push(`- Analyses in pack: ${analyses.length}`);
  lines.push(
    `- Classification: ${confirmed.length} confirmed failure(s), ${near.length} near miss(es), ${controls.length} successful control(s)`,
  );
  lines.push(``);
  lines.push(`## Analysis Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Runs analyzed | ${stats.runs} |`);
  lines.push(`| Confirmed failures | ${confirmed.length} |`);
  lines.push(`| Near misses | ${near.length} |`);
  lines.push(`| Successful controls | ${controls.length} |`);
  lines.push(`| Avoidable among confirmed failures | ${avoid.avoidableConfirmedCount}/${avoid.confirmedCount}${avoid.pctAmongConfirmed != null ? ` (${avoid.pctAmongConfirmed}%)` : ""} |`);
  lines.push(`| Insights avoidable % (all-run denominator, reference) | ${insights.avoidable_pct}% |`);
  lines.push(`| Wasted cost | $${avoid.wasted.toFixed(4)} |`);
  lines.push(`| Typed judgments | ${stats.judgments} |`);
  lines.push(`| Top pattern | ${insights.top_pattern} |`);
  lines.push(`| Most expensive agent | ${insights.most_expensive_agent} |`);
  lines.push(`| Common retry loop | ${insights.common_retry_loop} |`);
  lines.push(``);
  lines.push(`Top three patterns (confirmed failures preferred; never includes \`none\`):`);
  if (!patterns.length) {
    lines.push(`_None — no confirmed failure patterns._`);
  } else {
    for (let i = 0; i < Math.min(3, patterns.length); i++) {
      lines.push(`${i + 1}. ${patterns[i]}`);
    }
  }
  lines.push(``);
  lines.push(`## Root Causes`);
  lines.push(``);
  if (failureTypes.length) {
    lines.push(`Detected failure types (excludes \`none\`):`);
    for (const f of failureTypes) lines.push(`- ${f.name} × ${f.count}`);
    lines.push(``);
  } else {
    lines.push(`_No aggregate failure types (no confirmed failures with a real failure_type)._`);
    lines.push(``);
  }
  if (!rootCauses.length) {
    lines.push(`_No confirmed root causes. Near misses are listed under Trace Evidence, not as root causes._`);
    lines.push(``);
  }
  for (const c of rootCauses.slice(0, 12)) {
    const a = c.analysis;
    const agentStats = insights.by_agent?.[a.agent_name];
    const confNote = c.highConfidence ? "" : " — **low-confidence signal**";
    lines.push(`### ${a.trace_id}${confNote}`);
    lines.push(
      `- Agent: ${a.agent_name}${agentStats ? ` (failures=${agentStats.failures}, waste=$${agentStats.waste_usd})` : ""}`,
    );
    lines.push(
      `- Failure type: ${c.failureType ?? "n/a"} (confidence=${formatConfidence(a.failure_type?.confidence)})`,
    );
    lines.push(
      `- Stage: ${c.stage ?? "n/a (not reported)"} (confidence=${c.stage ? formatConfidence(a.failure_stage?.confidence) : "n/a"})`,
    );
    lines.push(
      `- Severity: ${severityLabel(a) ?? "n/a"} (confidence=${formatConfidence(a.severity?.confidence)})`,
    );
    const js = relevantJudgments(a, c.klass);
    if (js.length) {
      lines.push(`- Supporting judgments:`);
      for (const j of js) lines.push(`  - ${j}`);
    }
    lines.push(``);
  }
  lines.push(`## Recommended Fixes`);
  lines.push(``);
  lines.push(
    `Concrete remediations derived from JEV judgments (mapping applied only to real patterns — never for \`none\`):`,
  );
  lines.push(``);
  if (!patterns.length) {
    lines.push(`_No remediation requirements for successful controls._`);
  } else {
    for (const p of patterns) {
      const rem = remediationFor(p);
      if (!rem) continue;
      lines.push(`- **${p}**: ${rem}`);
    }
  }
  lines.push(``);
  if (insights.recommendations.length) {
    lines.push(`Insight recommendations:`);
    for (const r of insights.recommendations) lines.push(`- ${r}`);
    lines.push(``);
  }
  lines.push(`## Ready-to-Use Coding Prompt`);
  lines.push(``);
  lines.push(prompt);
  lines.push(``);
  lines.push(`## Acceptance Tests`);
  lines.push(``);
  for (const t of acceptance) lines.push(`- ${t}`);
  lines.push(``);
  lines.push(`## Trace Evidence`);
  lines.push(``);
  lines.push(
    `Grouped as Confirmed failures / Near misses / Successful controls. Only relevant sanitized evidence. API keys, tokens, passwords, and personal data are redacted.`,
  );
  lines.push(``);
  lines.push(evidence.join("\n\n") || "_No step-level evidence available._");
  lines.push(``);
  return lines.join("\n");
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export function downloadTextFile(filename: string, contents: string, mime = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
