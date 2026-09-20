export const NOUL_LABELS: Record<string, string> = {
  task_completed: "Task completed",
  wrong_tool: "Wrong tool",
  unnecessary_tool_call: "Unnecessary tool call",
  unnecessary_retry: "Unnecessary retry",
  excessive_retry_loop: "Excessive retry loop",
  missing_context: "Missing context",
  tool_failure: "Tool failure",
  ignored_tool_output: "Ignored tool output",
  permission_failure: "Permission failure",
  premature_stop: "Premature stop",
  continued_after_completion: "Continued after completion",
  human_approval_needed: "Human approval needed",
  safe_to_retry: "Safe to retry",
  avoidable_cost: "Avoidable cost",
};

export const NOUL_ORDER = Object.keys(NOUL_LABELS);

export const POSITIVE_NOULS = new Set(["task_completed", "safe_to_retry"]);

export function barColor(p: number, positiveGood = false): string {
  if (positiveGood) {
    if (p >= 0.7) return "bg-ok";
    if (p >= 0.4) return "bg-warn";
    return "bg-fail";
  }
  if (p >= 0.75) return "bg-fail";
  if (p >= 0.45) return "bg-jev";
  return "bg-electric/70";
}

export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "success" || s === "ok") return "bg-ok";
  if (s === "failure" || s === "error") return "bg-fail";
  if (s === "partial" || s === "retry" || s === "warn" || s === "warning") return "bg-warn";
  if (s === "running" || s === "analyzing") return "bg-jev";
  if (s === "queued") return "bg-ink-faint";
  return "bg-ink-faint";
}

export function statusBorder(status: string): string {
  const s = status.toLowerCase();
  if (s === "success" || s === "ok") return "border-ok";
  if (s === "failure" || s === "error") return "border-fail";
  if (s === "partial" || s === "retry" || s === "warn" || s === "warning") return "border-warn";
  if (s === "running" || s === "analyzing") return "border-jev";
  return "border-line-soft";
}
