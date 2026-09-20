"""TypeSafe JEV client — one system_one call with all 17 judgments per trace."""

from __future__ import annotations

import os
import random
import re
import time
from typing import Any, Optional

from .schemas import ChoiceJudgment, NoulJudgment, ScoreJudgment, TraceAnalysis

# Atomic Noul instructions (complete questions — IDs are for code only)
NOUL_QUESTIONS: dict[str, str] = {
    "task_completed": (
        "Based on the full agent execution trace in `trace`, did the agent "
        "successfully complete the user's request stated in `trace.user_request`?"
    ),
    "wrong_tool": (
        "Did the agent select or invoke a tool that was clearly inappropriate "
        "for the step's goal given the available tools and the user request?"
    ),
    "unnecessary_tool_call": (
        "Did the agent make one or more tool calls that were not needed to "
        "progress toward completing the user request?"
    ),
    "unnecessary_retry": (
        "Did the agent retry an action that had already succeeded or that "
        "clearly would not succeed with the same inputs?"
    ),
    "excessive_retry_loop": (
        "Does the trace show an excessive retry loop — three or more consecutive "
        "retries of the same failing action without meaningful change?"
    ),
    "missing_context": (
        "Did the agent fail because required context (credentials, prior results, "
        "user constraints, or file contents) was missing from the state?"
    ),
    "tool_failure": (
        "Did at least one tool invocation fail with an error, timeout, or "
        "non-success status that impacted the run?"
    ),
    "ignored_tool_output": (
        "Did the agent ignore or contradict clear information returned by a "
        "tool in a subsequent step?"
    ),
    "permission_failure": (
        "Did the agent encounter a permission, authorization, or access-denied "
        "failure while executing tools?"
    ),
    "premature_stop": (
        "Did the agent stop before completing the user request when further "
        "useful steps were still possible?"
    ),
    "continued_after_completion": (
        "Did the agent continue taking actions after the user request was "
        "already successfully completed?"
    ),
    "human_approval_needed": (
        "Should the agent have paused for human approval before taking a "
        "sensitive, irreversible, or costly action in this trace?"
    ),
    "safe_to_retry": (
        "Would it be safe to automatically retry this failed run without "
        "risking duplicate side effects, data corruption, or financial harm?"
    ),
    "avoidable_cost": (
        "Was a measurable portion of the estimated cost wasted due to avoidable "
        "retries, wrong tools, or unnecessary tool calls?"
    ),
}

FAILURE_TYPE_CRITERIA: dict[str, str] = {
    "none": "No meaningful failure; the run succeeded or issues were negligible.",
    "tool_failure": "A tool errored, timed out, or returned a hard failure.",
    "wrong_tool": "The agent chose an inappropriate tool for the goal.",
    "missing_context": "Required context or credentials were absent.",
    "unnecessary_retry": "Retries were unnecessary or looping.",
    "permission": "Access or permission was denied.",
    "bad_instruction": "The agent followed a bad or ambiguous instruction poorly.",
    "agent_loop": "The agent entered a non-productive loop.",
    "external_api": "An external API or service caused the failure.",
    "premature_stop": "The agent stopped too early.",
    "ignored_output": "Tool output was ignored or contradicted.",
    "unknown": "Failure type cannot be determined from the trace.",
}

FAILURE_STAGE_CRITERIA: dict[str, str] = {
    "planning": "Failure originated while planning the approach.",
    "tool_selection": "Failure originated when selecting which tool to use.",
    "tool_execution": "Failure originated during tool execution.",
    "tool_response": "Failure originated when handling the tool response.",
    "result_interpretation": "Failure originated when interpreting results.",
    "completion": "Failure originated at completion / stop decision.",
    "unknown": "Stage cannot be determined.",
}

SEVERITY_LEVELS: list[str] = [
    "no failure",
    "minor",
    "moderate",
    "major",
    "critical",
]

_SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)",
    re.IGNORECASE,
)
_SECRET_PATTERNS = (
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b", re.IGNORECASE),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(
        r"(?i)\b(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*['\"]?[^\s,;'\"]+"
    ),
)


def build_questions() -> dict[str, Any]:
    """Build the full set of 17 typed questions for one system_one call."""
    from typesafe_sdk import Choice, Noul, Score

    questions: dict[str, Any] = {}
    for qid, instructions in NOUL_QUESTIONS.items():
        questions[qid] = Noul(instructions=instructions)

    questions["failure_type"] = Choice(
        instructions=(
            "What is the primary failure type in `trace`? Choose the single "
            "best label for the dominant failure pattern."
        ),
        criteria=FAILURE_TYPE_CRITERIA,
    )
    questions["failure_stage"] = Choice(
        instructions=(
            "At which stage of the agent loop did the primary failure in "
            "`trace` originate?"
        ),
        criteria=FAILURE_STAGE_CRITERIA,
    )
    questions["severity"] = Score(
        instructions=(
            "How severe is the primary failure (or residual issue) in `trace`?"
        ),
        criteria=SEVERITY_LEVELS,
    )
    return questions


def trace_to_state(trace: dict[str, Any]) -> dict[str, Any]:
    """Build a compact, secret-redacted state for the external JEV call."""
    steps = []
    for i, s in enumerate(trace.get("steps") or []):
        steps.append(
            {
                "i": i,
                "role": _truncate(_redact_value(s.get("role")), 80),
                "action": _truncate(_redact_value(s.get("action")), 400),
                "tool_name": _truncate(_redact_value(s.get("tool_name")), 120),
                "status": _truncate(_redact_value(s.get("status")), 80),
                "error": _truncate(_redact_value(s.get("error")), 400),
                "input": _truncate(_redact_value(s.get("input")), 400),
                "output": _truncate(_redact_value(s.get("output")), 400),
            }
        )
    return {
        "trace": {
            "id": trace.get("id"),
            "agent_name": _truncate(_redact_value(trace.get("agent_name")), 120),
            "status": _truncate(_redact_value(trace.get("status")), 80),
            "duration_ms": trace.get("duration_ms"),
            "estimated_cost_usd": trace.get("estimated_cost_usd"),
            "user_request": _truncate(_redact_value(trace.get("user_request")), 1000),
            "steps": steps,
            "metadata": _redact_value(trace.get("metadata") or {}),
        }
    }


def _redact_text(value: str) -> str:
    redacted = value
    for pattern in _SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def _redact_value(value: Any, *, depth: int = 0) -> Any:
    """Redact common secret fields while bounding nested untrusted metadata."""
    if depth > 5:
        return "[TRUNCATED]"
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= 50:
                result["__truncated__"] = True
                break
            key_text = str(key)
            result[key_text] = (
                "[REDACTED]"
                if _SENSITIVE_KEY.search(key_text)
                else _redact_value(item, depth=depth + 1)
            )
        return result
    if isinstance(value, (list, tuple)):
        result = [_redact_value(item, depth=depth + 1) for item in value[:50]]
        if len(value) > 50:
            result.append("[TRUNCATED]")
        return result
    return value


def _truncate(value: Any, limit: int) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return value if len(value) <= limit else value[: limit - 3] + "..."
    text = str(value)
    return text if len(text) <= limit else text[: limit - 3] + "..."


def normalize_response(
    trace: dict[str, Any],
    answers: dict[str, Any],
    usage: Optional[dict[str, int]] = None,
    mode: str = "live",
    jev_model: Optional[str] = None,
) -> TraceAnalysis:
    """Normalize SDK answer objects into TraceAnalysis."""
    nouls: dict[str, NoulJudgment] = {}
    for qid in NOUL_QUESTIONS:
        ans = answers.get(qid)
        if ans is None:
            continue
        noul_val = float(getattr(ans, "noul", ans.get("noul", 0.0) if isinstance(ans, dict) else 0.0))
        nouls[qid] = NoulJudgment(id=qid, noul=noul_val, label=qid)

    ft = answers.get("failure_type")
    fs = answers.get("failure_stage")
    sev = answers.get("severity")

    failure_type = None
    if ft is not None:
        failure_type = ChoiceJudgment(
            id="failure_type",
            choice=str(getattr(ft, "choice", ft.get("choice") if isinstance(ft, dict) else "unknown")),
            probabilities=dict(getattr(ft, "probabilities", ft.get("probabilities") if isinstance(ft, dict) else {}) or {}),
            confidence=_opt_float(getattr(ft, "confidence", ft.get("confidence") if isinstance(ft, dict) else None)),
        )

    failure_stage = None
    if fs is not None:
        failure_stage = ChoiceJudgment(
            id="failure_stage",
            choice=str(getattr(fs, "choice", fs.get("choice") if isinstance(fs, dict) else "unknown")),
            probabilities=dict(getattr(fs, "probabilities", fs.get("probabilities") if isinstance(fs, dict) else {}) or {}),
            confidence=_opt_float(getattr(fs, "confidence", fs.get("confidence") if isinstance(fs, dict) else None)),
        )

    severity = None
    if sev is not None:
        legend_raw = getattr(sev, "legend", sev.get("legend") if isinstance(sev, dict) else {}) or {}
        legend = {str(k): str(v) for k, v in dict(legend_raw).items()}
        severity = ScoreJudgment(
            id="severity",
            score=float(getattr(sev, "score", sev.get("score") if isinstance(sev, dict) else 0.0)),
            legend=legend,
            probabilities={str(k): float(v) for k, v in dict(getattr(sev, "probabilities", sev.get("probabilities") if isinstance(sev, dict) else {}) or {}).items()},
            confidence=_opt_float(getattr(sev, "confidence", sev.get("confidence") if isinstance(sev, dict) else None)),
        )

    metrics = combine_metrics(nouls, failure_type, failure_stage, severity, trace)
    stream_line = format_stream_line(trace.get("id", "?"), nouls, failure_type)

    return TraceAnalysis(
        trace_id=str(trace.get("id", "")),
        agent_name=str(trace.get("agent_name", "")),
        mode=mode,
        nouls=nouls,
        failure_type=failure_type,
        failure_stage=failure_stage,
        severity=severity,
        metrics=metrics,
        usage=usage,
        jev_model=jev_model,
        demo_data=(mode == "demo"),
        stream_line=stream_line,
    )


def _opt_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def combine_metrics(
    nouls: dict[str, NoulJudgment],
    failure_type: Optional[ChoiceJudgment],
    failure_stage: Optional[ChoiceJudgment],
    severity: Optional[ScoreJudgment],
    trace: dict[str, Any],
) -> dict[str, Any]:
    """Combine JEV answers into derived metrics in Python (not invented by the model)."""
    def n(key: str) -> float:
        j = nouls.get(key)
        return float(j.noul) if j else 0.0

    avoidable = max(n("unnecessary_retry"), n("unnecessary_tool_call"), n("avoidable_cost"), n("excessive_retry_loop"))
    failed = 1.0 if (
        n("tool_failure") >= 0.5
        or n("premature_stop") >= 0.5
        or n("permission_failure") >= 0.5
        or (failure_type and failure_type.choice not in ("none",))
        or str(trace.get("status", "")).lower() in ("failure", "error")
    ) else 0.0

    cost = float(trace.get("estimated_cost_usd") or 0.0)
    wasted = round(cost * min(1.0, avoidable) * 0.85, 6) if avoidable >= 0.4 else 0.0

    return {
        "task_completed_prob": n("task_completed"),
        "avoidable_score": round(avoidable, 4),
        "is_failed_run": failed >= 0.5,
        "is_avoidable": avoidable >= 0.55,
        "wasted_cost_usd": wasted,
        "primary_failure": failure_type.choice if failure_type else "unknown",
        "primary_stage": failure_stage.choice if failure_stage else "unknown",
        "severity_score": severity.score if severity else 0.0,
        "safe_to_retry": n("safe_to_retry") >= 0.6,
        "needs_human": n("human_approval_needed") >= 0.6,
    }


def format_stream_line(
    trace_id: str,
    nouls: dict[str, NoulJudgment],
    failure_type: Optional[ChoiceJudgment],
) -> str:
    parts = [trace_id]
    highlight = [
        "unnecessary_retry",
        "tool_failure",
        "wrong_tool",
        "missing_context",
        "excessive_retry_loop",
        "avoidable_cost",
        "permission_failure",
        "premature_stop",
    ]
    for key in highlight:
        j = nouls.get(key)
        if j and j.noul >= 0.45:
            parts.append(f"{key}={j.noul:.2f}")
    if failure_type and failure_type.choice != "none":
        conf = f" conf={failure_type.confidence:.2f}" if failure_type.confidence is not None else ""
        parts.append(f"failure_type={failure_type.choice}{conf}")
    if len(parts) == 1:
        tc = nouls.get("task_completed")
        if tc:
            parts.append(f"task_completed={tc.noul:.2f}")
    return "  ".join(parts)




class JevRateLimitError(RuntimeError):
    """TypeSafe/JEV API rate limit (HTTP 429), distinct from agent-trace 429s."""

    def __init__(self, message: str, *, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


def _is_rate_limit_exc(exc: BaseException) -> tuple[bool, float | None]:
    """Detect HTTP 429 / rate-limit from SDK or HTTP libs. Never treat agent-trace text as API 429."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    retry_after: float | None = None

    # Explicit status attributes common on HTTP errors
    for attr in ("status_code", "status", "code", "http_status"):
        val = getattr(exc, attr, None)
        if val == 429 or str(val) == "429":
            ra = getattr(exc, "retry_after", None) or getattr(exc, "Retry-After", None)
            if ra is None:
                response = getattr(exc, "response", None)
                headers = getattr(response, "headers", None) or {} if response is not None else {}
                try:
                    ra = headers.get("Retry-After") or headers.get("retry-after")
                except Exception:
                    ra = None
            try:
                retry_after = float(ra) if ra is not None else None
            except (TypeError, ValueError):
                retry_after = None
            return True, retry_after

    response = getattr(exc, "response", None)
    if response is not None:
        sc = getattr(response, "status_code", None)
        if sc == 429:
            headers = getattr(response, "headers", None) or {}
            ra = None
            try:
                ra = headers.get("Retry-After") or headers.get("retry-after")
            except Exception:
                ra = None
            try:
                retry_after = float(ra) if ra is not None else None
            except (TypeError, ValueError):
                retry_after = None
            return True, retry_after

    # Message heuristics for API rate limits only (not agent tool errors in traces)
    if "429" in msg or "rate limit" in msg or "too many requests" in msg or "ratelimit" in name:
        # Prefer phrases that look like HTTP/API, not "status: 429" inside a fake agent error
        if any(k in msg for k in ("http", "api", "request", "quota", "throttle", "typesafe", "system_one", "status code", "status_code")):
            return True, None
        if "429" in msg and ("error" in name or "http" in name or "api" in name):
            return True, None
    return False, None


class JevClient:
    """Thin wrapper around TypeSafeClient. Never logs the API key."""

    def __init__(self, api_key: Optional[str] = None, timeout: float = 60.0):
        self._api_key = api_key or os.environ.get("TYPESAFE_API_KEY") or ""
        self._timeout = timeout
        self._client = None

    @property
    def available(self) -> bool:
        return bool(self._api_key.strip())

    def _get_client(self):
        if self._client is None:
            if not self.available:
                raise RuntimeError(
                    "TYPESAFE_API_KEY is not set. Use demo mode or set the key in .env."
                )
            from typesafe_sdk import TypeSafeClient

            # TypeSafeClient reads TYPESAFE_API_KEY from env by default
            os.environ.setdefault("TYPESAFE_API_KEY", self._api_key)
            self._client = TypeSafeClient()
        return self._client

    def analyze_trace(
        self,
        trace: dict[str, Any],
        *,
        max_retries: int = 5,
        on_rate_limit=None,
    ) -> TraceAnalysis:
        """Call JEV system_one. Retries API 429 with Retry-After / exponential backoff.

        on_rate_limit: optional callback(attempt, wait_seconds) for UI phase updates.
        Agent-level 429s inside a trace are data for JEV — not raised here.
        """
        client = self._get_client()
        state = trace_to_state(trace)
        questions = build_questions()
        last_exc: BaseException | None = None

        for attempt in range(max_retries + 1):
            try:
                response = client.system_one(
                    state=state,
                    model="jev-latest",
                    questions=questions,
                )
            except Exception as exc:
                is_rl, retry_after = _is_rate_limit_exc(exc)
                if is_rl and attempt < max_retries:
                    base = retry_after if retry_after and retry_after > 0 else (2 ** attempt)
                    wait = min(60.0, float(base) + random.uniform(0, 0.5))
                    if callable(on_rate_limit):
                        try:
                            on_rate_limit(attempt + 1, wait)
                        except Exception:
                            pass
                    time.sleep(wait)
                    last_exc = exc
                    continue
                if is_rl:
                    raise JevRateLimitError(
                        f"JEV API rate limited after {max_retries + 1} attempts",
                        retry_after=retry_after,
                    ) from exc
                # Re-raise with safe message (no key leakage)
                raise RuntimeError(f"JEV system_one failed: {type(exc).__name__}: {exc}") from exc

            usage = None
            if getattr(response, "usage", None) is not None:
                u = response.usage
                usage = {
                    "input_tokens": int(getattr(u, "input_tokens", 0) or 0),
                    "output_tokens": int(getattr(u, "output_tokens", 0) or 0),
                }
            answers = dict(response.answers)
            model_name = getattr(response, "model", None) or "jev-latest"
            return normalize_response(
                trace, answers, usage=usage, mode="live", jev_model=str(model_name)
            )

        raise RuntimeError(f"JEV system_one failed after retries: {last_exc}")
