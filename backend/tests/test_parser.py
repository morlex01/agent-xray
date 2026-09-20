import json
from pathlib import Path

import pytest

from app.trace_parser import parse_csv, parse_json, parse_jsonl


SAMPLE = {
    "id": "t1",
    "agent_name": "a1",
    "status": "failure",
    "started_at": "2026-09-01T12:00:00Z",
    "duration_ms": 1200,
    "estimated_cost_usd": 0.1,
    "user_request": "do thing",
    "steps": [
        {
            "timestamp": "2026-09-01T12:00:00Z",
            "role": "assistant",
            "action": "call",
            "tool_name": "http",
            "input": {},
            "output": None,
            "status": "error",
            "error": "boom",
        }
    ],
    "metadata": {"failure_pattern": "tool_timeout"},
}


def test_parse_json_object():
    traces = parse_json(json.dumps(SAMPLE))
    assert len(traces) == 1
    assert traces[0].id == "t1"
    assert traces[0].steps[0].error == "boom"


def test_parse_json_array():
    traces = parse_json(json.dumps([SAMPLE, {**SAMPLE, "id": "t2"}]))
    assert len(traces) == 2


def test_parse_jsonl():
    text = json.dumps(SAMPLE) + "\n" + json.dumps({**SAMPLE, "id": "t2"}) + "\n"
    traces = parse_jsonl(text)
    assert [t.id for t in traces] == ["t1", "t2"]


def test_parse_csv():
    csv_text = (
        "id,agent_name,status,started_at,duration_ms,estimated_cost_usd,user_request,steps,metadata\n"
        't1,a1,failure,2026-09-01T12:00:00Z,100,0.05,hello,"[]","{}"\n'
    )
    traces = parse_csv(csv_text)
    assert len(traces) == 1
    assert traces[0].user_request == "hello"
