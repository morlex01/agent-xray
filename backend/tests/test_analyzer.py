from app.analyzer import build_charts, build_insights
from app.demo_engine import analyze_demo


def _mk(tid, pattern, agent="agent-a", cost=0.2):
    return {
        "id": tid,
        "agent_name": agent,
        "status": "failure",
        "estimated_cost_usd": cost,
        "user_request": "x",
        "steps": [],
        "metadata": {"failure_pattern": pattern},
    }


def test_insights_and_charts():
    traces = [
        _mk("a", "rate_limit_retry_loop", "api-orchestrator", 0.4),
        _mk("b", "wrong_tool" if False else "wrong_api", "browser-navigator", 0.2),
        _mk("c", "successful_run", "ops-runner", 0.05),
        _mk("d", "permission_denied", "ops-runner", 0.15),
    ]
    # fix wrong pattern name
    traces[1]["metadata"]["failure_pattern"] = "wrong_api"
    analyses = [analyze_demo(t) for t in traces]
    by_id = {t["id"]: t for t in traces}
    insights = build_insights(analyses, by_id)
    charts = build_charts(analyses)
    assert insights.recommendations
    assert insights.wasted_cost_usd >= 0
    assert "failure_types" in charts
    assert sum(x["value"] for x in charts["failure_types"]) == len(analyses)
