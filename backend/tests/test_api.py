import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure demo traces exist
ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "data" / "demo_traces.jsonl"


@pytest.fixture(scope="module")
def client():
    if not DEMO.exists() or sum(1 for _ in DEMO.open()) < 10:
        from scripts.generate_demo_traces import main as gen

        # run generator via import path
        import runpy

        runpy.run_path(str(ROOT / "scripts" / "generate_demo_traces.py"), run_name="__main__")
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "demo" in body["mode_available"]


def test_demo_traces(client):
    r = client.get("/api/demo/traces?limit=10")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 10
    assert body["demo_data"] is True
    assert body["traces"][0]["id"]


def test_analyze_demo_sse(client):
    start = client.post("/api/analyze/start", json={"mode": "demo", "demo_count": 5, "speed": 8.0})
    assert start.status_code == 200
    job_id = start.json()["job_id"]
    # poll results until complete (SSE in TestClient is awkward; use results)
    import time

    for _ in range(50):
        res = client.get(f"/api/results/{job_id}")
        assert res.status_code == 200
        data = res.json()
        if data["status"] in ("complete", "error"):
            break
        time.sleep(0.1)
    assert data["status"] == "complete"
    assert data["demo_data"] is True
    assert data["completed"] == 5
    assert data["typed_judgments"] == 5 * 17
    assert data["insights"] is not None


def test_get_trace(client):
    r = client.get("/api/demo/traces?limit=1")
    tid = r.json()["traces"][0]["id"]
    tr = client.get(f"/api/traces/{tid}")
    assert tr.status_code == 200
    assert tr.json()["id"] == tid


def test_upload_json(client):
    payload = json.dumps(
        [
            {
                "id": "upload_1",
                "agent_name": "u",
                "status": "failure",
                "started_at": "2026-09-01T00:00:00Z",
                "duration_ms": 100,
                "estimated_cost_usd": 0.01,
                "user_request": "test",
                "steps": [],
                "metadata": {"failure_pattern": "tool_timeout"},
            }
        ]
    )
    r = client.post(
        "/api/upload",
        files={"file": ("t.json", payload.encode(), "application/json")},
    )
    assert r.status_code == 200
    assert r.json()["uploaded"] == 1


def test_upload_filename_cannot_escape_upload_dir(client, tmp_path, monkeypatch):
    from app import main

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    payload = json.dumps(
        {
            "id": "safe_upload",
            "agent_name": "u",
            "status": "success",
            "user_request": "test",
            "steps": [],
            "metadata": {},
        }
    )

    r = client.post(
        "/api/upload",
        files={"file": ("../../escaped.json", payload.encode(), "application/json")},
    )

    assert r.status_code == 200
    assert not (tmp_path / "escaped.json").exists()
    saved = list(upload_dir.glob("escaped-*.json"))
    assert len(saved) == 1


def test_upload_rejects_unsupported_extension(client):
    r = client.post(
        "/api/upload",
        files={"file": ("trace.txt", b"{}", "text/plain")},
    )
    assert r.status_code == 400
    assert "Unsupported file type" in r.json()["detail"]


def test_cors_rejects_unknown_origin(client):
    r = client.options(
        "/api/upload",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers
