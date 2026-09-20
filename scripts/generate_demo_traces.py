#!/usr/bin/env python3
"""Generate ≥250 deterministic synthetic agent traces for Agent X-Ray demo mode."""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "demo_traces.jsonl"

AGENTS = [
    "browser-navigator",
    "api-orchestrator",
    "research-scout",
    "ops-runner",
    "support-triage",
    "code-fixer",
    "data-pipeline",
    "checkout-agent",
]

PATTERNS = [
    "rate_limit_retry_loop",
    "wrong_browser_action",
    "wrong_api",
    "missing_auth",
    "missing_context",
    "tool_timeout",
    "duplicate_search",
    "hallucinated_tool",
    "permission_denied",
    "premature_stop",
    "continued_after_success",
    "invalid_json",
    "wrong_arguments",
    "repeated_query",
    "missing_human_approval",
    "successful_run",
    "external_api",
]

REQUESTS = [
    "Book a flight to Berlin for next Tuesday under $400",
    "Summarize the latest quarterly revenue from the finance API",
    "Find competing products and compare pricing",
    "Deploy the staging build and verify health checks",
    "Refund order ORD-1042 and notify the customer",
    "Extract invoice totals from the uploaded PDF",
    "Create a GitHub issue for the flaky test suite",
    "Search docs for rate-limit handling patterns",
    "Update the CRM contact with the new email",
    "Run a browser checkout flow and capture the confirmation",
    "List open PRs older than 14 days",
    "Query inventory for SKU-8891 across warehouses",
    "Send a Slack summary of overnight incidents",
    "Generate a weekly KPI digest from the metrics API",
    "Authenticate and pull the user's subscription status",
]


def ts(base: datetime, offset_ms: int) -> str:
    return (base + timedelta(milliseconds=offset_ms)).isoformat().replace("+00:00", "Z")


def build_steps(pattern: str, rng: random.Random, base: datetime) -> list[dict]:
    steps: list[dict] = []
    t = 0

    def add(role, action, tool=None, inp=None, out=None, status="ok", error=None, dt=400):
        nonlocal t
        steps.append(
            {
                "timestamp": ts(base, t),
                "role": role,
                "action": action,
                "tool_name": tool,
                "input": inp,
                "output": out,
                "status": status,
                "error": error,
            }
        )
        t += dt + rng.randint(50, 300)

    add("user", "request", inp="user_request")

    if pattern == "rate_limit_retry_loop":
        for i in range(5):
            add(
                "assistant",
                "call_api",
                "http_request",
                {"url": "/v1/search", "attempt": i + 1},
                None,
                "error" if i < 4 else "error",
                "429 Too Many Requests: rate limit exceeded",
                800,
            )
            add("assistant", "retry_wait", None, {"backoff_ms": 200 * (i + 1)}, {"waited": True}, "retry")
    elif pattern == "wrong_browser_action":
        add("assistant", "navigate", "browser_goto", {"url": "https://shop.example/cart"}, {"title": "Cart"}, "ok")
        add("assistant", "click", "browser_click", {"selector": "#promo-banner"}, {"clicked": True}, "ok")
        add("assistant", "click", "browser_click", {"selector": "#logout"}, {"clicked": True}, "error", "Session ended — wrong element")
    elif pattern == "wrong_api":
        add("assistant", "call", "stripe_charges_list", {"customer": "cus_1"}, {"error": "wrong resource"}, "error", "404 Not Found")
        add("assistant", "call", "stripe_customers_retrieve", {"id": "cus_1"}, {"id": "cus_1"}, "ok")
    elif pattern == "missing_auth":
        add("assistant", "call", "crm_update", {"email": "a@b.com"}, None, "error", "401 Unauthorized: missing API token")
        add("assistant", "retry", "crm_update", {"email": "a@b.com"}, None, "error", "401 Unauthorized")
    elif pattern == "missing_context":
        add("assistant", "plan", None, {"need": "order_id"}, {"note": "order_id not in state"}, "ok")
        add("assistant", "call", "orders_get", {"order_id": None}, None, "error", "ValidationError: order_id required")
    elif pattern == "tool_timeout":
        add("assistant", "call", "slow_report", {"period": "Q3"}, None, "error", "TimeoutError after 30000ms")
        add("assistant", "retry", "slow_report", {"period": "Q3"}, None, "error", "TimeoutError after 30000ms")
    elif pattern == "duplicate_search":
        q = {"query": "rate limit best practices"}
        add("assistant", "search", "web_search", q, {"hits": 10}, "ok")
        add("assistant", "search", "web_search", q, {"hits": 10}, "ok")
        add("assistant", "search", "web_search", q, {"hits": 10}, "ok")
        add("assistant", "answer", None, None, {"summary": "Use exponential backoff"}, "ok")
    elif pattern == "hallucinated_tool":
        add("assistant", "call", "quantum_db_lookup", {"key": "x"}, None, "error", "Unknown tool: quantum_db_lookup")
        add("assistant", "call", "sql_query", {"sql": "SELECT 1"}, {"rows": [[1]]}, "ok")
    elif pattern == "permission_denied":
        add("assistant", "call", "fs_write", {"path": "/etc/hosts", "data": "..."}, None, "error", "PermissionError: denied")
    elif pattern == "premature_stop":
        add("assistant", "search", "web_search", {"query": "competitors"}, {"hits": 3}, "ok")
        add("assistant", "stop", None, None, {"reason": "done"}, "ok")
    elif pattern == "continued_after_success":
        add("assistant", "call", "refund_create", {"order": "ORD-1042"}, {"status": "refunded"}, "ok")
        add("assistant", "notify", "email_send", {"to": "user@ex.com", "body": "Refunded"}, {"sent": True}, "ok")
        add("assistant", "call", "refund_create", {"order": "ORD-1042"}, {"status": "already_refunded"}, "error", "Duplicate refund")
        add("assistant", "call", "refund_create", {"order": "ORD-1042"}, None, "error", "Duplicate refund")
    elif pattern == "invalid_json":
        add("assistant", "call", "http_request", {"body": "{bad json"}, None, "error", "JSONDecodeError: Expecting property name")
    elif pattern == "wrong_arguments":
        add("assistant", "call", "calendar_create", {"date": "tomorrowish", "title": 123}, None, "error", "ValidationError: date must be ISO-8601")
    elif pattern == "repeated_query":
        for _ in range(4):
            add("assistant", "query", "metrics_query", {"metric": "latency_p99"}, {"value": 120}, "ok")
        add("assistant", "answer", None, None, {"p99": 120}, "ok")
    elif pattern == "missing_human_approval":
        add("assistant", "call", "wire_transfer", {"amount_usd": 50000, "to": "acct_9"}, {"status": "submitted"}, "ok")
        add("assistant", "note", None, None, {"warning": "no human approval"}, "ok")
    elif pattern == "external_api":
        add("assistant", "call", "partner_api", {"op": "sync"}, None, "error", "502 Bad Gateway from partner")
        add("assistant", "retry", "partner_api", {"op": "sync"}, None, "error", "503 Service Unavailable")
    else:  # successful_run
        add("assistant", "plan", None, {"steps": 2}, {"ok": True}, "ok")
        add("assistant", "call", "http_request", {"url": "/v1/ok"}, {"status": 200, "data": {"ok": True}}, "ok")
        add("assistant", "answer", None, None, {"result": "completed successfully"}, "ok")

    return steps


def status_for(pattern: str) -> str:
    if pattern == "successful_run":
        return "success"
    if pattern in ("duplicate_search", "repeated_query", "continued_after_success", "missing_human_approval"):
        return "partial"
    return "failure"


def cost_for(pattern: str, rng: random.Random) -> float:
    base = {
        "rate_limit_retry_loop": 0.42,
        "duplicate_search": 0.28,
        "repeated_query": 0.31,
        "continued_after_success": 0.35,
        "successful_run": 0.06,
        "missing_human_approval": 0.18,
    }.get(pattern, 0.14)
    return round(base + rng.random() * 0.08, 4)


def main() -> None:
    rng = random.Random(42)
    base_time = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
    traces = []
    # ≥250 traces: ~15 per pattern + extras
    target = 272
    for i in range(target):
        pattern = PATTERNS[i % len(PATTERNS)]
        agent = AGENTS[i % len(AGENTS)]
        req = REQUESTS[i % len(REQUESTS)]
        started = base_time + timedelta(minutes=i * 3)
        steps = build_steps(pattern, rng, started)
        duration = max(800, len(steps) * 700 + rng.randint(0, 2000))
        tid = f"trace_{i:04d}"
        traces.append(
            {
                "id": tid,
                "agent_name": agent,
                "status": status_for(pattern),
                "started_at": started.isoformat().replace("+00:00", "Z"),
                "duration_ms": duration,
                "estimated_cost_usd": cost_for(pattern, rng),
                "user_request": req,
                "steps": steps,
                "metadata": {
                    "synthetic": True,
                    "failure_pattern": pattern,
                    "seed": 42,
                    "demo": True,
                },
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for t in traces:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    print(f"Wrote {len(traces)} traces → {OUT}")


if __name__ == "__main__":
    main()
