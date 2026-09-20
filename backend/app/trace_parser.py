"""Parse agent traces from JSON, JSONL, and CSV into AgentTrace models."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any, Iterable

from .schemas import AgentTrace, TraceStep


REQUIRED_HINTS = ("id", "user_request", "steps")


def parse_file(path: Path | str, content: bytes | str | None = None) -> list[AgentTrace]:
    path = Path(path)
    raw = content if content is not None else path.read_bytes()
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    else:
        text = raw
    suffix = path.suffix.lower()
    name = path.name.lower()
    if suffix == ".jsonl" or name.endswith(".jsonl"):
        return parse_jsonl(text)
    if suffix == ".csv" or name.endswith(".csv"):
        return parse_csv(text)
    if suffix == ".json" or name.endswith(".json"):
        return parse_json(text)
    # sniff
    stripped = text.lstrip()
    if stripped.startswith("["):
        return parse_json(text)
    if stripped.startswith("{"):
        # could be single object or JSONL
        try:
            obj = json.loads(text)
            if isinstance(obj, list):
                return [_normalize(t) for t in obj]
            return [_normalize(obj)]
        except json.JSONDecodeError:
            return parse_jsonl(text)
    if "," in text.split("\n", 1)[0]:
        return parse_csv(text)
    return parse_jsonl(text)


def parse_json(text: str) -> list[AgentTrace]:
    data = json.loads(text)
    if isinstance(data, dict) and "traces" in data:
        data = data["traces"]
    if isinstance(data, dict):
        return [_normalize(data)]
    if isinstance(data, list):
        return [_normalize(t) for t in data]
    raise ValueError("JSON must be an object or array of traces")


def parse_jsonl(text: str) -> list[AgentTrace]:
    traces: list[AgentTrace] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSONL at line {line_no}: {exc}") from exc
        traces.append(_normalize(obj))
    return traces


def parse_csv(text: str) -> list[AgentTrace]:
    reader = csv.DictReader(io.StringIO(text))
    traces: list[AgentTrace] = []
    for row in reader:
        steps_raw = row.get("steps") or "[]"
        try:
            steps = json.loads(steps_raw) if steps_raw.strip().startswith("[") else []
        except json.JSONDecodeError:
            steps = []
        meta_raw = row.get("metadata") or "{}"
        try:
            metadata = json.loads(meta_raw) if meta_raw.strip().startswith("{") else {}
        except json.JSONDecodeError:
            metadata = {}
        traces.append(
            _normalize(
                {
                    "id": row.get("id") or row.get("trace_id") or f"csv_{len(traces)}",
                    "agent_name": row.get("agent_name") or "unknown",
                    "status": row.get("status") or "unknown",
                    "started_at": row.get("started_at") or "",
                    "duration_ms": int(float(row.get("duration_ms") or 0)),
                    "estimated_cost_usd": float(row.get("estimated_cost_usd") or 0),
                    "user_request": row.get("user_request") or "",
                    "steps": steps,
                    "metadata": metadata,
                }
            )
        )
    return traces


def _normalize(obj: dict[str, Any]) -> AgentTrace:
    steps_in = obj.get("steps") or []
    steps: list[TraceStep] = []
    for s in steps_in:
        if isinstance(s, TraceStep):
            steps.append(s)
        else:
            steps.append(
                TraceStep(
                    timestamp=str(s.get("timestamp") or ""),
                    role=str(s.get("role") or "assistant"),
                    action=str(s.get("action") or ""),
                    tool_name=s.get("tool_name"),
                    input=s.get("input"),
                    output=s.get("output"),
                    status=str(s.get("status") or "ok"),
                    error=s.get("error"),
                )
            )
    return AgentTrace(
        id=str(obj.get("id") or obj.get("trace_id") or "unknown"),
        agent_name=str(obj.get("agent_name") or "unknown"),
        status=str(obj.get("status") or "unknown"),
        started_at=str(obj.get("started_at") or ""),
        duration_ms=int(obj.get("duration_ms") or 0),
        estimated_cost_usd=float(obj.get("estimated_cost_usd") or 0.0),
        user_request=str(obj.get("user_request") or ""),
        steps=steps,
        metadata=dict(obj.get("metadata") or {}),
    )


def load_jsonl_path(path: Path | str) -> list[AgentTrace]:
    return parse_jsonl(Path(path).read_text(encoding="utf-8"))


def traces_to_dicts(traces: Iterable[AgentTrace]) -> list[dict[str, Any]]:
    return [t.model_dump() for t in traces]
