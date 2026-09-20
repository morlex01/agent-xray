/**
 * View-model for the Final Diagnostic visual report.
 * Uses Fix Pack classification helpers — does not change Fix Pack Markdown/prompt content.
 */
import type { AgentTrace, Insights, TraceAnalysis } from "../types";
import {
  classifyAll,
  type ClassifiedTrace,
  type FixPackStats,
} from "./fixPack";

export interface RootCauseCard {
  n: string;
  pattern: string;
  agent: string;
  severity: string;
  confidence: number | null;
  evidence: string;
  traceCount: number;
  klass: "confirmed_failure" | "near_miss";
  accent: "fail" | "warn" | "jev";
}

export interface PriorityAction {
  id: "P1" | "P2" | "P3";
  label: string;
  action: string;
  result: string;
}

export interface FailureFlow {
  steps: string[];
  failIndex: number;
  stage: string;
  pattern: string;
}

export interface DiagnosticReport {
  headline: string;
  confirmed: number;
  nearMisses: number;
  controls: number;
  highestSeverity: string;
  severityRank: number; // 0..4 for bar fill
  metrics: {
    runs: number;
    avoidable: number;
    wasted: number;
    judgments: number;
  };
  rootCauses: RootCauseCard[];
  flow: FailureFlow | null;
  actions: PriorityAction[];
  classified: ClassifiedTrace[];
}

const REMEDIATION_SHORT: Record<string, { action: string; result: string }> = {
  unnecessary_retry: {
    action: "Cap retries with exponential backoff, jitter, and Retry-After.",
    result: "Stops busy-loops on 429 / transient errors.",
  },
  excessive_retry_loop: {
    action: "Cap retries with exponential backoff, jitter, and Retry-After.",
    result: "Stops busy-loops on 429 / transient errors.",
  },
  agent_loop: {
    action: "Cap retries with exponential backoff, jitter, and Retry-After.",
    result: "Breaks non-productive agent retry loops.",
  },
  rate_limit_retry_loop: {
    action: "Honor Retry-After; add idempotency keys on side-effecting calls.",
    result: "Prevents duplicate work under rate limits.",
  },
  wrong_tool: {
    action: "Validate tool selection against declared capabilities before invoke.",
    result: "Blocks mismatched tool calls.",
  },
  tool_failure: {
    action: "Classify tool errors and apply safe fallbacks.",
    result: "Contains hard tool failures without storms.",
  },
  external_api: {
    action: "Classify external API errors and apply safe fallbacks.",
    result: "Contains upstream outages.",
  },
  missing_context: {
    action: "Validate required fields before tool execution.",
    result: "Prevents blind calls with incomplete state.",
  },
  ignored_tool_output: {
    action: "Treat failed tool responses as blocking until verified.",
    result: "Stops progress on ignored errors.",
  },
  ignored_output: {
    action: "Treat failed tool responses as blocking until verified.",
    result: "Stops progress on ignored errors.",
  },
  permission: {
    action: "Add an explicit human approval gate for privileged actions.",
    result: "Prevents unauthorized side effects.",
  },
  permission_failure: {
    action: "Add an explicit human approval gate for privileged actions.",
    result: "Prevents unauthorized side effects.",
  },
  human_approval_needed: {
    action: "Add an explicit human approval gate for privileged actions.",
    result: "Prevents unauthorized side effects.",
  },
  premature_stop: {
    action: "Define completion criteria and verify the final result before stop.",
    result: "Avoids unfinished successful-looking runs.",
  },
  continued_after_completion: {
    action: "Add a termination guard once the request is complete.",
    result: "Stops post-completion tool churn.",
  },
  unnecessary_tool_call: {
    action: "Gate tool calls on necessity toward the user goal.",
    result: "Cuts avoidable cost and noise.",
  },
};

function isRealFt(ft: string | null | undefined): boolean {
  if (!ft) return false;
  const n = ft.toLowerCase();
  return n !== "none" && n !== "n/a" && n !== "null" && n !== "unknown";
}

function severityFromAnalysis(a: TraceAnalysis): { label: string; rank: number } {
  const sev = a.severity;
  if (!sev) return { label: "n/a", rank: 0 };
  const score = Number(sev.score ?? 0);
  const legend = sev.legend || {};
  const entries = Object.entries(legend);
  if (entries.length) {
    const nearest = entries.reduce((best, cur) => {
      const bd = Math.abs(Number(best[0]) - score);
      const cd = Math.abs(Number(cur[0]) - score);
      return cd < bd ? cur : best;
    });
    const label = String(nearest[1] || "n/a");
    const lower = label.toLowerCase();
    let rank = Math.round(score);
    if (lower.includes("critical")) rank = 4;
    else if (lower.includes("major")) rank = 3;
    else if (lower.includes("moderate")) rank = 2;
    else if (lower.includes("minor")) rank = 1;
    else if (lower.includes("no failure") || lower === "none") rank = 0;
    return { label, rank: Math.max(0, Math.min(4, rank)) };
  }
  return { label: `score ${score.toFixed(1)}`, rank: Math.max(0, Math.min(4, Math.round(score))) };
}

function patternCounts(confirmed: ClassifiedTrace[]): Map<string, ClassifiedTrace[]> {
  const m = new Map<string, ClassifiedTrace[]>();
  for (const c of confirmed) {
    const ft = c.failureType;
    if (!isRealFt(ft)) continue;
    const list = m.get(ft!) || [];
    list.push(c);
    m.set(ft!, list);
  }
  return m;
}

function shortEvidence(c: ClassifiedTrace): string {
  const steps = c.trace?.steps || [];
  const bad = steps.find((s) => {
    const st = String(s.status || "").toLowerCase();
    return Boolean(s.error) || st === "error" || st === "failure" || st === "timeout";
  });
  if (bad) {
    const err = String(bad.error || bad.output || bad.status || "").replace(/\s+/g, " ").trim();
    const tool = bad.tool_name || bad.action || "step";
    return `${tool}: ${err.slice(0, 72)}${err.length > 72 ? "…" : ""}`;
  }
  if (c.klass === "near_miss" && c.warningKeys.length) {
    return `Warnings: ${c.warningKeys.slice(0, 2).join(", ")}`;
  }
  if (c.analysis.stream_line) {
    return c.analysis.stream_line.replace(/\s+/g, " ").trim().slice(0, 80);
  }
  return `failure_type=${c.failureType ?? "n/a"}`;
}

function buildFlow(dominant: ClassifiedTrace | null): FailureFlow | null {
  if (!dominant || dominant.klass !== "confirmed_failure") return null;
  const pattern = dominant.failureType || "";
  const stage = dominant.stage || "";
  const blob = JSON.stringify(dominant.trace || {}).toLowerCase();
  const has429 = blob.includes("429") || blob.includes("rate_limit") || /retry|loop|agent_loop|unnecessary_retry/.test(pattern);

  let steps: string[] = [];
  let failIndex = 0;

  if (has429 || /retry|loop/.test(pattern)) {
    steps = ["Request", "Tool call", "Retry", "Failure"];
    failIndex = 3;
  } else if (stage === "tool_selection") {
    steps = ["Request", "Tool select", "Failure"];
    failIndex = 2;
  } else if (stage === "tool_execution") {
    steps = ["Request", "Tool call", "Failure"];
    failIndex = 2;
  } else if (stage === "tool_response") {
    steps = ["Request", "Tool call", "Response", "Failure"];
    failIndex = 3;
  } else if (stage === "planning") {
    steps = ["Request", "Plan", "Failure"];
    failIndex = 2;
  } else if (stage === "result_interpretation") {
    steps = ["Request", "Tool call", "Interpret", "Failure"];
    failIndex = 3;
  } else if (stage === "completion") {
    steps = ["Request", "Execute", "Complete", "Failure"];
    failIndex = 3;
  } else if (stage) {
    steps = ["Request", stage.replace(/_/g, " "), "Failure"];
    failIndex = 2;
  } else {
    return null;
  }

  return { steps, failIndex, stage: stage || "n/a", pattern };
}

function remFor(pattern: string): { action: string; result: string } | null {
  const key = pattern.toLowerCase().replace(/\s+/g, "_");
  if (REMEDIATION_SHORT[key]) return REMEDIATION_SHORT[key];
  for (const [k, v] of Object.entries(REMEDIATION_SHORT)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  if (/retry|loop|429|rate/.test(key)) return REMEDIATION_SHORT.unnecessary_retry;
  if (/wrong.?tool/.test(key)) return REMEDIATION_SHORT.wrong_tool;
  if (/tool.?fail|timeout|external/.test(key)) return REMEDIATION_SHORT.tool_failure;
  if (/missing|context/.test(key)) return REMEDIATION_SHORT.missing_context;
  if (/permission|approval|human/.test(key)) return REMEDIATION_SHORT.permission;
  if (/premature|stop/.test(key)) return REMEDIATION_SHORT.premature_stop;
  if (/ignored/.test(key)) return REMEDIATION_SHORT.ignored_tool_output;
  if (/continued|termination/.test(key)) return REMEDIATION_SHORT.continued_after_completion;
  return null;
}

function buildActions(
  patterns: string[],
  insights: Insights,
  hasConfirmed: boolean,
): PriorityAction[] {
  const out: PriorityAction[] = [];
  const ids: Array<"P1" | "P2" | "P3"> = ["P1", "P2", "P3"];
  const labels = ["immediate fix", "reliability improvement", "regression protection"];

  for (let i = 0; i < 3; i++) {
    const pattern = patterns[i];
    if (pattern) {
      const rem = remFor(pattern);
      if (rem) {
        out.push({
          id: ids[i],
          label: labels[i],
          action: rem.action,
          result: rem.result,
        });
        continue;
      }
    }
    const rec = insights.recommendations[i];
    if (rec) {
      out.push({
        id: ids[i],
        label: labels[i],
        action: rec,
        result: hasConfirmed
          ? "Reduces recurrence of the dominant confirmed pattern."
          : "Hardens near-miss and control coverage.",
      });
    }
  }

  // Ensure P3 regression if we have fewer than 3
  if (out.length < 3 && hasConfirmed && patterns[0]) {
    out.push({
      id: ids[out.length] as "P1" | "P2" | "P3",
      label: labels[out.length],
      action: `Add a regression test that replaying the dominant scenario does not reproduce ${patterns[0]}.`,
      result: "Locks the fix against recurrence.",
    });
  }

  return out.slice(0, 3);
}


export interface ClassificationSegment {
  key: "confirmed" | "near" | "ok";
  label: string;
  count: number;
  pct: number;
  className: string;
}

/** Proportional classification bar segments — widths are count / totalRuns. Zero counts omitted. */
export function classificationDistribution(
  confirmed: number,
  nearMisses: number,
  controls: number,
  totalRuns: number,
): { confirmedPct: number; nearPct: number; controlPct: number; segments: ClassificationSegment[] } {
  const total = Math.max(0, totalRuns);
  const pct = (n: number) => (total > 0 ? (100 * n) / total : 0);
  const confirmedPct = pct(confirmed);
  const nearPct = pct(nearMisses);
  const controlPct = pct(controls);
  const all: ClassificationSegment[] = [
    { key: "confirmed", label: "Confirmed failed runs", count: confirmed, pct: confirmedPct, className: "bg-fail" },
    { key: "near", label: "Near misses", count: nearMisses, pct: nearPct, className: "bg-warn" },
    { key: "ok", label: "Successful controls", count: controls, pct: controlPct, className: "bg-ok" },
  ];
  return {
    confirmedPct,
    nearPct,
    controlPct,
    segments: all.filter((s) => s.count > 0 && s.pct > 0),
  };
}

export function buildDiagnosticReport(
  insights: Insights,
  analyses: TraceAnalysis[],
  traces: AgentTrace[],
  stats: FixPackStats,
): DiagnosticReport {
  const classified = classifyAll(analyses, traces);
  const confirmed = classified.filter((c) => c.klass === "confirmed_failure");
  const near = classified.filter((c) => c.klass === "near_miss");
  const controls = classified.filter((c) => c.klass === "successful_control");

  const highConf = confirmed.filter((c) => c.highConfidence);
  const rootPool = highConf.length ? highConf : confirmed;

  let highestSeverity = "n/a";
  let severityRank = 0;
  for (const c of rootPool) {
    const s = severityFromAnalysis(c.analysis);
    if (s.rank > severityRank) {
      severityRank = s.rank;
      highestSeverity = s.label;
    }
  }

  const byPattern = patternCounts(rootPool);
  const sortedPatterns = [...byPattern.entries()].sort((a, b) => b[1].length - a[1].length);

  // Pad with near-miss warning keys only if fewer than 3 confirmed patterns
  const rootCauses: RootCauseCard[] = [];
  let n = 1;
  for (const [pattern, list] of sortedPatterns.slice(0, 3)) {
    const sample = list[0];
    const sev = severityFromAnalysis(sample.analysis);
    const agents = [...new Set(list.map((c) => c.analysis.agent_name))];
    const conf =
      sample.analysis.failure_type?.confidence ??
      sample.analysis.failure_stage?.confidence ??
      null;
    rootCauses.push({
      n: String(n).padStart(2, "0"),
      pattern,
      agent: agents[0] || sample.analysis.agent_name,
      severity: sev.label,
      confidence: conf == null ? null : Number(conf),
      evidence: shortEvidence(sample),
      traceCount: list.length,
      klass: "confirmed_failure",
      accent: sev.rank >= 3 ? "fail" : sev.rank >= 2 ? "jev" : "warn",
    });
    n += 1;
  }

  if (rootCauses.length < 3 && near.length) {
    const warnCounts = new Map<string, ClassifiedTrace[]>();
    for (const c of near) {
      for (const w of c.warningKeys.slice(0, 1)) {
        const list = warnCounts.get(w) || [];
        list.push(c);
        warnCounts.set(w, list);
      }
    }
    for (const [pattern, list] of [...warnCounts.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (rootCauses.length >= 3) break;
      if (rootCauses.some((r) => r.pattern === pattern)) continue;
      const sample = list[0];
      rootCauses.push({
        n: String(rootCauses.length + 1).padStart(2, "0"),
        pattern,
        agent: sample.analysis.agent_name,
        severity: "near miss",
        confidence: sample.analysis.failure_type?.confidence ?? null,
        evidence: shortEvidence(sample),
        traceCount: list.length,
        klass: "near_miss",
        accent: "warn",
      });
    }
  }

  const patternNames = rootCauses.filter((r) => r.klass === "confirmed_failure").map((r) => r.pattern);
  const allPatternNames = rootCauses.map((r) => r.pattern);

  const confirmedPatternCount = new Set(patternNames).size;
  let headline: string;
  if (confirmedPatternCount === 0 && near.length === 0) {
    headline = `${controls.length} successful control${controls.length === 1 ? "" : "s"} — no confirmed failures`;
  } else if (confirmedPatternCount === 0) {
    headline = `${near.length} near miss${near.length === 1 ? "" : "es"} — no confirmed failure patterns`;
  } else if (confirmedPatternCount === 1) {
    headline = `1 confirmed failure pattern detected`;
  } else {
    headline = `${confirmedPatternCount} confirmed failure patterns detected`;
  }

  const dominant = rootPool.find((c) => c.failureType === patternNames[0]) || rootPool[0] || null;
  const flow = buildFlow(dominant);

  const avoidableConfirmed = confirmed.filter((c) =>
    Boolean((c.analysis.metrics as { is_avoidable?: boolean } | undefined)?.is_avoidable),
  ).length;

  return {
    headline,
    confirmed: confirmed.length,
    nearMisses: near.length,
    controls: controls.length,
    highestSeverity,
    severityRank,
    metrics: {
      runs: stats.runs,
      avoidable: avoidableConfirmed || stats.avoidable,
      wasted: stats.wasted,
      judgments: stats.judgments,
    },
    rootCauses,
    flow,
    actions: buildActions(allPatternNames.length ? allPatternNames : patternNames, insights, confirmed.length > 0),
    classified,
  };
}
