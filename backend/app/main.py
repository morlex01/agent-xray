"""Agent X-Ray FastAPI application."""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .jobs import job_manager
from .jev_client import JevClient
from .schemas import (
    AnalyzeStartRequest,
    AnalyzeStartResponse,
    HealthResponse,
    UploadResponse,
)
from .trace_parser import load_jsonl_path, parse_file, traces_to_dicts

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")
load_dotenv(ROOT / ".env")  # optional fallback
DATA_DIR = ROOT / "data"
DEMO_TRACES = DATA_DIR / "demo_traces.jsonl"
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
]
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_CORS_ORIGINS
ALLOWED_UPLOAD_SUFFIXES = {".json", ".jsonl", ".csv"}

# In-memory store of uploaded / loaded traces
_TRACE_STORE: dict[str, dict[str, Any]] = {}


def _load_demo_into_store() -> list[dict[str, Any]]:
    if not DEMO_TRACES.exists():
        return []
    traces = traces_to_dicts(load_jsonl_path(DEMO_TRACES))
    for t in traces:
        _TRACE_STORE[t["id"]] = t
    return traces


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _load_demo_into_store()
    yield


app = FastAPI(
    title="Agent X-Ray",
    description="Find out why your AI agents fail — powered by TypeSafe JEV",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    has_key = JevClient().available
    modes = ["demo"]
    if has_key:
        modes.append("live")
    return HealthResponse(status="ok", has_api_key=has_key, mode_available=modes)


@app.get("/api/demo/traces")
def get_demo_traces(limit: int = Query(default=48, ge=1, le=500)) -> dict[str, Any]:
    traces = _load_demo_into_store()
    subset = traces[:limit]
    return {
        "count": len(subset),
        "total_available": len(traces),
        "demo_data": True,
        "traces": subset,
    }


@app.post("/api/upload", response_model=UploadResponse)
async def upload_traces(file: UploadFile = File(...)) -> UploadResponse:
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 20MB)")

    # Treat the client-provided filename as display text only. Never allow it
    # to select a path on the server, and use a unique name to avoid clobbering.
    original_name = (file.filename or "upload.jsonl").replace("\\", "/").split("/")[-1]
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(400, "Unsupported file type. Use .json, .jsonl, or .csv")
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._")
    safe_stem = (safe_stem or "upload")[:80]
    dest = UPLOAD_DIR / f"{safe_stem}-{uuid.uuid4().hex[:8]}{suffix}"
    dest.write_bytes(raw)
    try:
        parsed = parse_file(dest, content=raw)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"Parse error: {exc}") from exc
    ids: list[str] = []
    dumped: list[dict[str, Any]] = []
    for t in parsed:
        d = t.model_dump()
        _TRACE_STORE[d["id"]] = d
        ids.append(d["id"])
        dumped.append(d)
    return UploadResponse(
        uploaded=len(ids),
        trace_ids=ids,
        message=f"Parsed {len(ids)} traces from {original_name}",
        traces=dumped,
    )


@app.post("/api/analyze/start", response_model=AnalyzeStartResponse)
async def analyze_start(body: AnalyzeStartRequest) -> AnalyzeStartResponse:
    mode = body.mode
    if mode == "auto":
        mode = "live" if JevClient().available else "demo"
    if mode == "live" and not JevClient().available:
        raise HTTPException(
            400,
            "Live mode requires TYPESAFE_API_KEY. Use mode=demo or set the key server-side.",
        )

    traces: list[dict[str, Any]] = []
    if body.trace_ids:
        for tid in body.trace_ids:
            t = _TRACE_STORE.get(tid)
            if t:
                traces.append(t)
        if not traces:
            raise HTTPException(404, "No matching traces in store. Upload or load demo first.")
    else:
        all_demo = _load_demo_into_store()
        if not all_demo and not _TRACE_STORE:
            raise HTTPException(404, "No traces available. Run scripts/generate_demo_traces.py first.")
        if mode == "demo":
            traces = all_demo[: body.demo_count] if all_demo else list(_TRACE_STORE.values())[: body.demo_count]
        else:
            # live: prefer uploaded, else demo subset (smaller default)
            uploaded = [t for t in _TRACE_STORE.values() if not (t.get("metadata") or {}).get("synthetic")]
            pool = uploaded or all_demo
            traces = pool[: min(body.demo_count, 32)]

    job = job_manager.create(traces, mode=mode, speed=body.speed)
    await job_manager.start(job)
    return AnalyzeStartResponse(
        job_id=job.id,
        mode=mode,
        total_traces=len(traces),
        message=("DEMO DATA — deterministic simulation" if mode == "demo" else "Live JEV analysis started"),
    )


@app.get("/api/analyze/events/{job_id}")
async def analyze_events(job_id: str) -> StreamingResponse:
    job = job_manager.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job_id")

    async def event_gen():
        while True:
            try:
                item = await asyncio.wait_for(job.events.get(), timeout=30.0)
            except asyncio.TimeoutError:
                yield "event: ping\ndata: {}\n\n"
                if job.status in ("complete", "error", "cancelled"):
                    break
                continue
            evt = item.get("event", "message")
            data = json.dumps(item.get("data", {}), default=str)
            yield f"event: {evt}\ndata: {data}\n\n"
            if evt in ("end", "error"):
                break

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@app.get("/api/results/{job_id}")
def get_results(job_id: str) -> dict[str, Any]:
    job = job_manager.get(job_id)
    if not job:
        # try disk
        path = ROOT / "data" / "results" / f"{job_id}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        raise HTTPException(404, "Unknown job_id")
    return job.result().model_dump()


@app.get("/api/traces/{trace_id}")
def get_trace(trace_id: str) -> dict[str, Any]:
    t = _TRACE_STORE.get(trace_id)
    if not t:
        # search demo file
        _load_demo_into_store()
        t = _TRACE_STORE.get(trace_id)
    if not t:
        raise HTTPException(404, "Trace not found")
    return t


@app.get("/api/store/stats")
def store_stats() -> dict[str, Any]:
    return {"stored_traces": len(_TRACE_STORE), "has_api_key": JevClient().available}


# Optional: serve production frontend from the same origin as the API
FRONTEND_DIST = ROOT / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/")
    def spa_index():
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(404, "Frontend not built. Run: npm run build --prefix frontend")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Do not swallow API routes (already registered above)
        if full_path.startswith("api") or full_path.startswith("health") or full_path.startswith("docs") or full_path.startswith("openapi"):
            raise HTTPException(404, "Not found")
        dist_root = FRONTEND_DIST.resolve()
        candidate = (FRONTEND_DIST / full_path).resolve()
        if candidate.is_relative_to(dist_root) and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(404, "Not found")
