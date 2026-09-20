"""Analyze traces — demo or live JEV — and build aggregate insights/charts."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Callable, Optional

from .demo_engine import analyze_demo
from .jev_client import JevClient
from .schemas import Insights, TraceAnalysis


def analyze_one(
    trace: dict[str, Any],
    mode: str,
    jev: Optional[JevClient] = None,
    on_rate_limit: Optional[Callable[..., None]] = None,
) -> TraceAnalysis:
    if mode == "demo":
        return analyze_demo(trace)
    if jev is None:
        jev = JevClient()
    return jev.analyze_trace(trace, on_rate_limit=on_rate_limit)


def build_insights(analyses: list[TraceAnalysis], traces_by_id: dict[str, dict]) -> Insights:
    if not analyses:
        return Insights(recommendations=["Load traces and run analysis to generate insights."])

    failure_types = Counter()
    agents_fail = Counter()
    agents_cost: dict[str, float] = defaultdict(float)
    agents_waste: dict[str, float] = defaultdict(float)
    retry_patterns = Counter()
    avoidable = 0
    failed = 0
    total_waste = 0.0

    for a in analyses:
        m = a.metrics or {}
        if m.get("is_failed_run"):
            failed += 1
        if m.get("is_avoidable"):
            avoidable += 1
        waste = float(m.get("wasted_cost_usd") or 0)
        total_waste += waste
        ft = m.get("primary_failure") or (a.failure_type.choice if a.failure_type else "unknown")
        failure_types[ft] += 1
        agents_fail[a.agent_name] += 1 if m.get("is_failed_run") else 0
        agents_cost[a.agent_name] += float((traces_by_id.get(a.trace_id) or {}).get("estimated_cost_usd") or 0)
        agents_waste[a.agent_name] += waste
        if (a.nouls.get("excessive_retry_loop") and a.nouls["excessive_retry_loop"].noul >= 0.6) or (
            a.nouls.get("unnecessary_retry") and a.nouls["unnecessary_retry"].noul >= 0.7
        ):
            pat = (a.metrics or {}).get("demo_pattern") or ft
            retry_patterns[str(pat)] += 1

    top_pattern = failure_types.most_common(1)[0][0] if failure_types else "none"
    most_expensive = max(agents_cost.items(), key=lambda x: x[1])[0] if agents_cost else "n/a"
    common_retry = retry_patterns.most_common(1)[0][0] if retry_patterns else "none detected"
    avoidable_pct = round(100.0 * avoidable / max(len(analyses), 1), 1)

    by_agent = {}
    for name in set(list(agents_cost.keys()) + list(agents_fail.keys())):
        by_agent[name] = {
            "failures": agents_fail.get(name, 0),
            "cost_usd": round(agents_cost.get(name, 0), 4),
            "waste_usd": round(agents_waste.get(name, 0), 4),
        }

    recs = template_recommendations(top_pattern, avoidable_pct, common_retry, failure_types)
    return Insights(
        top_pattern=top_pattern,
        most_expensive_agent=most_expensive,
        common_retry_loop=common_retry,
        avoidable_pct=avoidable_pct,
        by_agent=by_agent,
        wasted_cost_usd=round(total_waste, 4),
        recommendations=recs,
    )


def template_recommendations(
    top_pattern: str,
    avoidable_pct: float,
    common_retry: str,
    failure_types: Counter,
) -> list[str]:
    recs: list[str] = []
    mapping = {
        "unnecessary_retry": "Add idempotency keys and cap retries at 2 with exponential backoff + jitter.",
        "tool_failure": "Surface tool errors to the planner; fail fast on non-retryable status codes.",
        "wrong_tool": "Tighten tool descriptions and add a pre-call eligibility check.",
        "missing_context": "Require schema validation of required context before the first tool call.",
        "permission": "Provision scoped credentials up front; escalate auth failures instead of retrying.",
        "premature_stop": "Gate stop decisions on an explicit task-completion checklist.",
        "agent_loop": "Detect completion signals and hard-stop after success.",
        "ignored_output": "Force the next step to cite the prior tool output fields it used.",
        "external_api": "Circuit-break external APIs and cache stable responses.",
        "bad_instruction": "Validate tool argument schemas before invocation.",
        "none": "No dominant failure — keep monitoring severity and avoidable cost.",
    }
    if top_pattern in mapping:
        recs.append(mapping[top_pattern])
    if avoidable_pct >= 40:
        recs.append(f"{avoidable_pct}% of analyzed runs look avoidable — prioritize retry/tool policy fixes.")
    if common_retry and common_retry not in ("none", "none detected"):
        recs.append(f"Most common retry-related pattern: {common_retry}. Deduplicate identical queries.")
    if failure_types.get("permission", 0) >= 2:
        recs.append("Multiple permission failures — add a human-approval gate for privileged tools.")
    if not recs:
        recs.append("Review high-severity traces first; combine JEV probabilities with your own thresholds.")
    return recs[:6]


def build_charts(analyses: list[TraceAnalysis]) -> dict[str, Any]:
    failure_types: Counter = Counter()
    severity_buckets: Counter = Counter()
    by_agent: Counter = Counter()
    retries = {"unnecessary_retry": 0, "excessive_retry_loop": 0, "clean": 0}
    waste_by_agent: dict[str, float] = defaultdict(float)

    for a in analyses:
        ft = (a.metrics or {}).get("primary_failure") or (a.failure_type.choice if a.failure_type else "unknown")
        failure_types[ft] += 1
        sev = float((a.severity.score if a.severity else 0) or 0)
        bucket = ["none", "minor", "moderate", "major", "critical"][min(4, max(0, int(round(sev))))]
        severity_buckets[bucket] += 1
        by_agent[a.agent_name or "unknown"] += 1
        ur = a.nouls.get("unnecessary_retry")
        er = a.nouls.get("excessive_retry_loop")
        if er and er.noul >= 0.6:
            retries["excessive_retry_loop"] += 1
        elif ur and ur.noul >= 0.55:
            retries["unnecessary_retry"] += 1
        else:
            retries["clean"] += 1
        waste_by_agent[a.agent_name or "unknown"] += float((a.metrics or {}).get("wasted_cost_usd") or 0)

    return {
        "failure_types": [{"name": k, "value": v} for k, v in failure_types.most_common()],
        "severity": [{"name": k, "value": v} for k, v in severity_buckets.items()],
        "by_agent": [{"name": k, "value": v} for k, v in by_agent.most_common()],
        "retries": [{"name": k, "value": v} for k, v in retries.items()],
        "waste": [{"name": k, "value": round(v, 4)} for k, v in sorted(waste_by_agent.items(), key=lambda x: -x[1])],
    }
