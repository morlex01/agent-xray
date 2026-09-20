from app.demo_engine import PATTERN_PROFILES, analyze_demo
from app.jev_client import NOUL_QUESTIONS


def test_demo_deterministic():
    trace = {
        "id": "trace_0001",
        "agent_name": "api-orchestrator",
        "status": "failure",
        "estimated_cost_usd": 0.4,
        "user_request": "search",
        "steps": [],
        "metadata": {"failure_pattern": "rate_limit_retry_loop"},
    }
    a1 = analyze_demo(trace)
    a2 = analyze_demo(trace)
    assert a1.demo_data is True
    assert a1.mode == "demo"
    assert a1.nouls["unnecessary_retry"].noul == a2.nouls["unnecessary_retry"].noul
    assert a1.failure_type.choice == "unnecessary_retry"
    assert len(a1.nouls) == len(NOUL_QUESTIONS)
    assert a1.stream_line.startswith("trace_0001")


def test_all_patterns_produce_17_answers():
    for pattern in PATTERN_PROFILES:
        trace = {
            "id": f"t_{pattern}",
            "agent_name": "x",
            "status": "failure",
            "estimated_cost_usd": 0.2,
            "user_request": "x",
            "steps": [],
            "metadata": {"failure_pattern": pattern},
        }
        a = analyze_demo(trace)
        assert len(a.nouls) == 14
        assert a.failure_type is not None
        assert a.failure_stage is not None
        assert a.severity is not None


def test_successful_run_low_severity():
    trace = {
        "id": "ok1",
        "agent_name": "x",
        "status": "success",
        "estimated_cost_usd": 0.05,
        "user_request": "ok",
        "steps": [],
        "metadata": {"failure_pattern": "successful_run"},
    }
    a = analyze_demo(trace)
    assert a.nouls["task_completed"].noul > 0.8
    assert a.failure_type.choice == "none"
    assert a.severity.score < 1.0
