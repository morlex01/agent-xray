"""Deterministic demo JEV results — labeled DEMO DATA, no API key required."""

from __future__ import annotations

import hashlib
from typing import Any

from .jev_client import (
    FAILURE_STAGE_CRITERIA,
    FAILURE_TYPE_CRITERIA,
    NOUL_QUESTIONS,
    SEVERITY_LEVELS,
    combine_metrics,
    format_stream_line,
)
from .schemas import ChoiceJudgment, NoulJudgment, ScoreJudgment, TraceAnalysis

# Pattern → expected judgment profile (deterministic for recording)
PATTERN_PROFILES: dict[str, dict[str, Any]] = {
    "rate_limit_retry_loop": {
        "nouls": {
            "task_completed": 0.08,
            "wrong_tool": 0.12,
            "unnecessary_tool_call": 0.35,
            "unnecessary_retry": 0.94,
            "excessive_retry_loop": 0.97,
            "missing_context": 0.15,
            "tool_failure": 0.88,
            "ignored_tool_output": 0.42,
            "permission_failure": 0.05,
            "premature_stop": 0.10,
            "continued_after_completion": 0.03,
            "human_approval_needed": 0.20,
            "safe_to_retry": 0.55,
            "avoidable_cost": 0.91,
        },
        "failure_type": "unnecessary_retry",
        "failure_stage": "tool_execution",
        "severity": 3.1,
    },
    "wrong_browser_action": {
        "nouls": {
            "task_completed": 0.18,
            "wrong_tool": 0.86,
            "unnecessary_tool_call": 0.55,
            "unnecessary_retry": 0.40,
            "excessive_retry_loop": 0.22,
            "missing_context": 0.25,
            "tool_failure": 0.48,
            "ignored_tool_output": 0.35,
            "permission_failure": 0.08,
            "premature_stop": 0.15,
            "continued_after_completion": 0.05,
            "human_approval_needed": 0.12,
            "safe_to_retry": 0.70,
            "avoidable_cost": 0.62,
        },
        "failure_type": "wrong_tool",
        "failure_stage": "tool_selection",
        "severity": 2.4,
    },
    "wrong_api": {
        "nouls": {
            "task_completed": 0.12,
            "wrong_tool": 0.91,
            "unnecessary_tool_call": 0.48,
            "unnecessary_retry": 0.55,
            "excessive_retry_loop": 0.30,
            "missing_context": 0.20,
            "tool_failure": 0.72,
            "ignored_tool_output": 0.28,
            "permission_failure": 0.10,
            "premature_stop": 0.18,
            "continued_after_completion": 0.04,
            "human_approval_needed": 0.15,
            "safe_to_retry": 0.68,
            "avoidable_cost": 0.70,
        },
        "failure_type": "wrong_tool",
        "failure_stage": "tool_selection",
        "severity": 2.8,
    },
    "missing_auth": {
        "nouls": {
            "task_completed": 0.05,
            "wrong_tool": 0.15,
            "unnecessary_tool_call": 0.22,
            "unnecessary_retry": 0.60,
            "excessive_retry_loop": 0.45,
            "missing_context": 0.82,
            "tool_failure": 0.90,
            "ignored_tool_output": 0.55,
            "permission_failure": 0.93,
            "premature_stop": 0.25,
            "continued_after_completion": 0.02,
            "human_approval_needed": 0.40,
            "safe_to_retry": 0.25,
            "avoidable_cost": 0.58,
        },
        "failure_type": "permission",
        "failure_stage": "tool_execution",
        "severity": 3.4,
    },
    "missing_context": {
        "nouls": {
            "task_completed": 0.22,
            "wrong_tool": 0.20,
            "unnecessary_tool_call": 0.38,
            "unnecessary_retry": 0.35,
            "excessive_retry_loop": 0.18,
            "missing_context": 0.95,
            "tool_failure": 0.40,
            "ignored_tool_output": 0.25,
            "permission_failure": 0.08,
            "premature_stop": 0.45,
            "continued_after_completion": 0.03,
            "human_approval_needed": 0.30,
            "safe_to_retry": 0.50,
            "avoidable_cost": 0.48,
        },
        "failure_type": "missing_context",
        "failure_stage": "planning",
        "severity": 2.6,
    },
    "tool_timeout": {
        "nouls": {
            "task_completed": 0.15,
            "wrong_tool": 0.10,
            "unnecessary_tool_call": 0.18,
            "unnecessary_retry": 0.72,
            "excessive_retry_loop": 0.55,
            "missing_context": 0.12,
            "tool_failure": 0.96,
            "ignored_tool_output": 0.20,
            "permission_failure": 0.05,
            "premature_stop": 0.35,
            "continued_after_completion": 0.02,
            "human_approval_needed": 0.18,
            "safe_to_retry": 0.75,
            "avoidable_cost": 0.65,
        },
        "failure_type": "tool_failure",
        "failure_stage": "tool_execution",
        "severity": 2.9,
    },
    "duplicate_search": {
        "nouls": {
            "task_completed": 0.78,
            "wrong_tool": 0.08,
            "unnecessary_tool_call": 0.88,
            "unnecessary_retry": 0.70,
            "excessive_retry_loop": 0.40,
            "missing_context": 0.10,
            "tool_failure": 0.05,
            "ignored_tool_output": 0.55,
            "permission_failure": 0.02,
            "premature_stop": 0.05,
            "continued_after_completion": 0.25,
            "human_approval_needed": 0.08,
            "safe_to_retry": 0.85,
            "avoidable_cost": 0.80,
        },
        "failure_type": "unnecessary_retry",
        "failure_stage": "tool_selection",
        "severity": 1.8,
    },
    "hallucinated_tool": {
        "nouls": {
            "task_completed": 0.10,
            "wrong_tool": 0.97,
            "unnecessary_tool_call": 0.70,
            "unnecessary_retry": 0.45,
            "excessive_retry_loop": 0.25,
            "missing_context": 0.30,
            "tool_failure": 0.92,
            "ignored_tool_output": 0.15,
            "permission_failure": 0.05,
            "premature_stop": 0.40,
            "continued_after_completion": 0.02,
            "human_approval_needed": 0.20,
            "safe_to_retry": 0.60,
            "avoidable_cost": 0.55,
        },
        "failure_type": "wrong_tool",
        "failure_stage": "tool_selection",
        "severity": 3.2,
    },
    "permission_denied": {
        "nouls": {
            "task_completed": 0.06,
            "wrong_tool": 0.12,
            "unnecessary_tool_call": 0.20,
            "unnecessary_retry": 0.50,
            "excessive_retry_loop": 0.35,
            "missing_context": 0.45,
            "tool_failure": 0.88,
            "ignored_tool_output": 0.40,
            "permission_failure": 0.98,
            "premature_stop": 0.30,
            "continued_after_completion": 0.02,
            "human_approval_needed": 0.72,
            "safe_to_retry": 0.15,
            "avoidable_cost": 0.42,
        },
        "failure_type": "permission",
        "failure_stage": "tool_execution",
        "severity": 3.6,
    },
    "premature_stop": {
        "nouls": {
            "task_completed": 0.20,
            "wrong_tool": 0.10,
            "unnecessary_tool_call": 0.15,
            "unnecessary_retry": 0.12,
            "excessive_retry_loop": 0.05,
            "missing_context": 0.35,
            "tool_failure": 0.18,
            "ignored_tool_output": 0.45,
            "permission_failure": 0.05,
            "premature_stop": 0.94,
            "continued_after_completion": 0.02,
            "human_approval_needed": 0.25,
            "safe_to_retry": 0.80,
            "avoidable_cost": 0.35,
        },
        "failure_type": "premature_stop",
        "failure_stage": "completion",
        "severity": 2.7,
    },
    "continued_after_success": {
        "nouls": {
            "task_completed": 0.92,
            "wrong_tool": 0.15,
            "unnecessary_tool_call": 0.85,
            "unnecessary_retry": 0.40,
            "excessive_retry_loop": 0.20,
            "missing_context": 0.08,
            "tool_failure": 0.10,
            "ignored_tool_output": 0.30,
            "permission_failure": 0.02,
            "premature_stop": 0.03,
            "continued_after_completion": 0.96,
            "human_approval_needed": 0.35,
            "safe_to_retry": 0.40,
            "avoidable_cost": 0.78,
        },
        "failure_type": "agent_loop",
        "failure_stage": "completion",
        "severity": 2.2,
    },
    "invalid_json": {
        "nouls": {
            "task_completed": 0.14,
            "wrong_tool": 0.18,
            "unnecessary_tool_call": 0.25,
            "unnecessary_retry": 0.62,
            "excessive_retry_loop": 0.40,
            "missing_context": 0.22,
            "tool_failure": 0.90,
            "ignored_tool_output": 0.35,
            "permission_failure": 0.05,
            "premature_stop": 0.28,
            "continued_after_completion": 0.03,
            "human_approval_needed": 0.15,
            "safe_to_retry": 0.72,
            "avoidable_cost": 0.58,
        },
        "failure_type": "tool_failure",
        "failure_stage": "tool_execution",
        "severity": 2.5,
    },
    "wrong_arguments": {
        "nouls": {
            "task_completed": 0.16,
            "wrong_tool": 0.35,
            "unnecessary_tool_call": 0.30,
            "unnecessary_retry": 0.58,
            "excessive_retry_loop": 0.32,
            "missing_context": 0.40,
            "tool_failure": 0.85,
            "ignored_tool_output": 0.42,
            "permission_failure": 0.08,
            "premature_stop": 0.20,
            "continued_after_completion": 0.04,
            "human_approval_needed": 0.18,
            "safe_to_retry": 0.70,
            "avoidable_cost": 0.60,
        },
        "failure_type": "bad_instruction",
        "failure_stage": "tool_execution",
        "severity": 2.6,
    },
    "repeated_query": {
        "nouls": {
            "task_completed": 0.70,
            "wrong_tool": 0.08,
            "unnecessary_tool_call": 0.82,
            "unnecessary_retry": 0.88,
            "excessive_retry_loop": 0.65,
            "missing_context": 0.12,
            "tool_failure": 0.08,
            "ignored_tool_output": 0.70,
            "permission_failure": 0.02,
            "premature_stop": 0.05,
            "continued_after_completion": 0.20,
            "human_approval_needed": 0.10,
            "safe_to_retry": 0.88,
            "avoidable_cost": 0.85,
        },
        "failure_type": "unnecessary_retry",
        "failure_stage": "tool_selection",
        "severity": 1.9,
    },
    "missing_human_approval": {
        "nouls": {
            "task_completed": 0.55,
            "wrong_tool": 0.12,
            "unnecessary_tool_call": 0.20,
            "unnecessary_retry": 0.10,
            "excessive_retry_loop": 0.05,
            "missing_context": 0.25,
            "tool_failure": 0.15,
            "ignored_tool_output": 0.18,
            "permission_failure": 0.22,
            "premature_stop": 0.08,
            "continued_after_completion": 0.10,
            "human_approval_needed": 0.97,
            "safe_to_retry": 0.10,
            "avoidable_cost": 0.45,
        },
        "failure_type": "permission",
        "failure_stage": "completion",
        "severity": 3.8,
    },
    "successful_run": {
        "nouls": {
            "task_completed": 0.96,
            "wrong_tool": 0.04,
            "unnecessary_tool_call": 0.08,
            "unnecessary_retry": 0.05,
            "excessive_retry_loop": 0.02,
            "missing_context": 0.05,
            "tool_failure": 0.03,
            "ignored_tool_output": 0.04,
            "permission_failure": 0.02,
            "premature_stop": 0.03,
            "continued_after_completion": 0.04,
            "human_approval_needed": 0.08,
            "safe_to_retry": 0.90,
            "avoidable_cost": 0.06,
        },
        "failure_type": "none",
        "failure_stage": "unknown",
        "severity": 0.15,
    },
    "external_api": {
        "nouls": {
            "task_completed": 0.18,
            "wrong_tool": 0.10,
            "unnecessary_tool_call": 0.22,
            "unnecessary_retry": 0.68,
            "excessive_retry_loop": 0.48,
            "missing_context": 0.15,
            "tool_failure": 0.88,
            "ignored_tool_output": 0.25,
            "permission_failure": 0.08,
            "premature_stop": 0.22,
            "continued_after_completion": 0.03,
            "human_approval_needed": 0.20,
            "safe_to_retry": 0.65,
            "avoidable_cost": 0.55,
        },
        "failure_type": "external_api",
        "failure_stage": "tool_response",
        "severity": 2.7,
    },
}


def _pattern_of(trace: dict[str, Any]) -> str:
    meta = trace.get("metadata") or {}
    p = meta.get("failure_pattern") or meta.get("pattern")
    if p and p in PATTERN_PROFILES:
        return p
    status = str(trace.get("status", "")).lower()
    if status in ("success", "ok", "completed"):
        return "successful_run"
    # hash fallback for unknown
    h = int(hashlib.md5(str(trace.get("id", "")).encode()).hexdigest()[:8], 16)
    keys = list(PATTERN_PROFILES.keys())
    return keys[h % len(keys)]


def _jitter(seed: str, base: float, amp: float = 0.03) -> float:
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    delta = ((h % 1000) / 1000.0 - 0.5) * 2 * amp
    return max(0.0, min(1.0, round(base + delta, 4)))


def analyze_demo(trace: dict[str, Any]) -> TraceAnalysis:
    pattern = _pattern_of(trace)
    profile = PATTERN_PROFILES[pattern]
    tid = str(trace.get("id", "unknown"))

    nouls: dict[str, NoulJudgment] = {}
    for qid in NOUL_QUESTIONS:
        base = float(profile["nouls"].get(qid, 0.1))
        val = _jitter(f"{tid}:{qid}", base)
        nouls[qid] = NoulJudgment(id=qid, noul=val, label=qid)

    ft_choice = profile["failure_type"]
    ft_probs = _choice_probs(ft_choice, list(FAILURE_TYPE_CRITERIA.keys()), tid + ":ft")
    failure_type = ChoiceJudgment(
        id="failure_type",
        choice=ft_choice,
        probabilities=ft_probs,
        confidence=_peak_confidence(ft_probs),
    )

    fs_choice = profile["failure_stage"]
    fs_probs = _choice_probs(fs_choice, list(FAILURE_STAGE_CRITERIA.keys()), tid + ":fs")
    failure_stage = ChoiceJudgment(
        id="failure_stage",
        choice=fs_choice,
        probabilities=fs_probs,
        confidence=_peak_confidence(fs_probs),
    )

    sev_score = float(profile["severity"])
    sev_score = max(0.0, min(float(len(SEVERITY_LEVELS) - 1), sev_score + _jitter(tid + ":sev", 0, 0.08) - 0.04))
    legend = {str(i): SEVERITY_LEVELS[i] for i in range(len(SEVERITY_LEVELS))}
    sev_probs = _score_probs(sev_score, len(SEVERITY_LEVELS), tid + ":sp")
    severity = ScoreJudgment(
        id="severity",
        score=round(sev_score, 2),
        legend=legend,
        probabilities=sev_probs,
        confidence=_peak_confidence(sev_probs),
    )

    metrics = combine_metrics(nouls, failure_type, failure_stage, severity, trace)
    metrics["demo_pattern"] = pattern
    stream_line = format_stream_line(tid, nouls, failure_type)

    return TraceAnalysis(
        trace_id=tid,
        agent_name=str(trace.get("agent_name", "")),
        mode="demo",
        nouls=nouls,
        failure_type=failure_type,
        failure_stage=failure_stage,
        severity=severity,
        metrics=metrics,
        usage=None,
        demo_data=True,
        stream_line=stream_line,
    )


def _choice_probs(winner: str, options: list[str], seed: str) -> dict[str, float]:
    raw: dict[str, float] = {}
    for opt in options:
        if opt == winner:
            raw[opt] = 0.72 + _jitter(seed + opt, 0, 0.08)
        else:
            raw[opt] = 0.02 + _jitter(seed + opt, 0, 0.015)
    total = sum(raw.values()) or 1.0
    return {k: round(v / total, 4) for k, v in raw.items()}


def _score_probs(score: float, n_levels: int, seed: str) -> dict[str, float]:
    raw: dict[str, float] = {}
    for i in range(n_levels):
        dist = abs(score - i)
        raw[str(i)] = max(0.02, 0.85 - dist * 0.35) + _jitter(seed + str(i), 0, 0.02)
    total = sum(raw.values()) or 1.0
    return {k: round(v / total, 4) for k, v in raw.items()}


def _peak_confidence(probs: dict[str, float]) -> float:
    if not probs:
        return 0.0
    vals = sorted(probs.values(), reverse=True)
    top = vals[0]
    second = vals[1] if len(vals) > 1 else 0.0
    return round(min(1.0, max(0.0, (top - second) / max(top, 1e-6))), 4)
