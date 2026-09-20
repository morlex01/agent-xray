"""In-memory analysis jobs with SSE event queues."""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .analyzer import analyze_one, build_charts, build_insights
from .jev_client import JevClient, JevRateLimitError
from .schemas import JobResult, JobStatus, TraceAnalysis

ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = ROOT / "data" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Job:
    id: str
    mode: str
    traces: list[dict[str, Any]]
    status: str = JobStatus.pending.value
    analyses: list[TraceAnalysis] = field(default_factory=list)
    events: asyncio.Queue = field(default_factory=asyncio.Queue)
    started_at: float = 0.0
    finished_at: float = 0.0
    error: Optional[str] = None
    speed: float = 1.0
    api_usage: dict[str, int] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})
    _task: Optional[asyncio.Task] = None

    def result(self) -> JobResult:
        elapsed_ms = int(((self.finished_at or time.time()) - (self.started_at or time.time())) * 1000) if self.started_at else 0
        completed = len(self.analyses)
        failed_runs = sum(1 for a in self.analyses if (a.metrics or {}).get("is_failed_run"))
        avoidable = sum(1 for a in self.analyses if (a.metrics or {}).get("is_avoidable"))
        wasted = sum(float((a.metrics or {}).get("wasted_cost_usd") or 0) for a in self.analyses)
        typed = completed * 17
        throughput = (completed / max(elapsed_ms / 1000.0, 0.001)) if completed else 0.0
        traces_by_id = {t["id"]: t for t in self.traces}
        insights = build_insights(self.analyses, traces_by_id) if self.analyses else None
        charts = build_charts(self.analyses) if self.analyses else {}
        usage = self.api_usage if self.mode == "live" and any(self.api_usage.values()) else None
        jev_model = next((a.jev_model for a in self.analyses if a.jev_model), None)
        return JobResult(
            job_id=self.id,
            status=self.status,
            mode=self.mode,
            demo_data=(self.mode == "demo"),
            total=len(self.traces),
            completed=completed,
            failed_runs=failed_runs,
            avoidable_failures=avoidable,
            elapsed_ms=elapsed_ms,
            throughput=round(throughput, 2),
            wasted_cost_usd=round(wasted, 4),
            typed_judgments=typed,
            api_usage=usage,
            jev_model=jev_model,
            analyses=self.analyses,
            insights=insights,
            charts=charts,
            error=self.error,
        )


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._sem = asyncio.Semaphore(int(os.environ.get("JEV_CONCURRENCY", "3")))

    def create(self, traces: list[dict[str, Any]], mode: str, speed: float = 1.0) -> Job:
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        job = Job(id=job_id, mode=mode, traces=traces, speed=max(0.25, min(speed, 4.0)))
        self.jobs[job_id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)

    async def start(self, job: Job) -> None:
        job.status = JobStatus.running.value
        job.started_at = time.time()
        await job.events.put({"event": "status", "data": {"status": "running", "mode": job.mode, "total": len(job.traces)}})
        job._task = asyncio.create_task(self._run(job))

    async def _run(self, job: Job) -> None:
        try:
            if job.mode == "demo":
                await self._run_demo(job)
            else:
                await self._run_live(job)
            job.status = JobStatus.complete.value
            job.finished_at = time.time()
            result = job.result()
            self._persist(job, result)
            await job.events.put({"event": "complete", "data": result.model_dump()})
        except Exception as exc:
            job.status = JobStatus.error.value
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = time.time()
            await job.events.put({"event": "job_error", "data": {"error": job.error}})
        finally:
            await job.events.put({"event": "end", "data": {}})

    async def _run_demo(self, job: Job) -> None:
        """~20–24s timeline at speed=1 for screen recording."""
        total = len(job.traces)
        # Phase timings (seconds) scaled by speed
        s = 1.0 / job.speed
        await job.events.put({"event": "phase", "data": {"phase": "init", "message": "Initializing Agent X-Ray…", "demo_data": True}})
        await asyncio.sleep(1.2 * s)
        await job.events.put({"event": "phase", "data": {"phase": "intake", "message": f"Intake {total} traces (DEMO DATA)", "demo_data": True}})
        await asyncio.sleep(1.5 * s)

        # Spread analysis across ~14s of the demo
        per = max(0.05, (14.0 * s) / max(total, 1))
        for i, trace in enumerate(job.traces):
            analysis = analyze_one(trace, "demo")
            job.analyses.append(analysis)
            await job.events.put(
                {
                    "event": "trace_result",
                    "data": {
                        "index": i,
                        "total": total,
                        "analysis": analysis.model_dump(),
                        "trace": {
                            "id": trace.get("id"),
                            "agent_name": trace.get("agent_name"),
                            "user_request": trace.get("user_request"),
                            "status": trace.get("status"),
                            "steps": trace.get("steps"),
                            "duration_ms": trace.get("duration_ms"),
                            "estimated_cost_usd": trace.get("estimated_cost_usd"),
                        },
                        "demo_data": True,
                    },
                }
            )
            if (i + 1) % max(1, total // 8) == 0 or i == total - 1:
                partial = job.result()
                await job.events.put(
                    {
                        "event": "progress",
                        "data": {
                            "completed": i + 1,
                            "total": total,
                            "charts": partial.charts,
                            "failed_runs": partial.failed_runs,
                            "avoidable_failures": partial.avoidable_failures,
                            "wasted_cost_usd": partial.wasted_cost_usd,
                            "typed_judgments": partial.typed_judgments,
                            "demo_data": True,
                        },
                    }
                )
            await asyncio.sleep(per)

        await job.events.put({"event": "phase", "data": {"phase": "insights", "message": "Composing insights…", "demo_data": True}})
        await asyncio.sleep(2.0 * s)
        await job.events.put({"event": "phase", "data": {"phase": "summary", "message": "Demo analysis complete (DEMO DATA)", "demo_data": True}})
        await asyncio.sleep(1.0 * s)

    async def _run_live(self, job: Job) -> None:
        """Sequential Live analysis — one trace at a time with gentle pacing.

        Agent failures inside a trace are normal JEV input and must not abort the job.
        Only true system failures (missing key, unrecoverable JEV outage) raise job_error.
        """
        jev = JevClient(timeout=float(os.environ.get("JEV_TIMEOUT_SECONDS", "60")))
        if not jev.available:
            raise RuntimeError("TYPESAFE_API_KEY not set — switch to demo mode or configure the key.")

        total = len(job.traces)
        pace = float(os.environ.get("JEV_LIVE_PACE_SECONDS", "0.35"))
        await job.events.put(
            {
                "event": "phase",
                "data": {
                    "phase": "init",
                    "message": "Connecting to TypeSafe JEV…",
                    "demo_data": False,
                },
            }
        )
        await job.events.put(
            {
                "event": "phase",
                "data": {
                    "phase": "intake",
                    "message": f"Live queue: {total} traces (sequential)",
                    "demo_data": False,
                },
            }
        )

        for i, trace in enumerate(job.traces):
            await job.events.put(
                {
                    "event": "trace_start",
                    "data": {
                        "index": i,
                        "trace_id": trace.get("id"),
                        "agent_name": trace.get("agent_name"),
                    },
                }
            )

            loop = asyncio.get_running_loop()

            def _on_rate_limit(attempt: int, wait: float) -> None:
                # Bridge sync callback → async event (fire-and-forget from worker thread)
                asyncio.run_coroutine_threadsafe(
                    job.events.put(
                        {
                            "event": "phase",
                            "data": {
                                "phase": "checks",
                                "message": "JEV rate limited, retrying",
                                "attempt": attempt,
                                "wait_seconds": wait,
                                "demo_data": False,
                            },
                        }
                    ),
                    loop,
                )

            try:
                analysis = await asyncio.to_thread(
                    analyze_one,
                    trace,
                    "live",
                    jev,
                    on_rate_limit=_on_rate_limit,
                )
            except JevRateLimitError as exc:
                await job.events.put(
                    {
                        "event": "trace_error",
                        "data": {
                            "index": i,
                            "trace_id": trace.get("id"),
                            "error": f"JEV rate limited: {exc}",
                        },
                    }
                )
                await asyncio.sleep(max(pace, 1.0))
                continue
            except Exception as exc:
                await job.events.put(
                    {
                        "event": "trace_error",
                        "data": {
                            "index": i,
                            "trace_id": trace.get("id"),
                            "error": f"{type(exc).__name__}: {exc}",
                        },
                    }
                )
                await asyncio.sleep(pace)
                continue

            if analysis.usage:
                job.api_usage["input_tokens"] += int(analysis.usage.get("input_tokens") or 0)
                job.api_usage["output_tokens"] += int(analysis.usage.get("output_tokens") or 0)
            job.analyses.append(analysis)
            await job.events.put(
                {
                    "event": "trace_result",
                    "data": {
                        "index": i,
                        "total": total,
                        "analysis": analysis.model_dump(),
                        "trace": {
                            "id": trace.get("id"),
                            "agent_name": trace.get("agent_name"),
                            "user_request": trace.get("user_request"),
                            "status": trace.get("status"),
                            "steps": trace.get("steps"),
                            "duration_ms": trace.get("duration_ms"),
                            "estimated_cost_usd": trace.get("estimated_cost_usd"),
                        },
                        "demo_data": False,
                    },
                }
            )
            partial = job.result()
            await job.events.put(
                {
                    "event": "progress",
                    "data": {
                        "completed": len(job.analyses),
                        "total": total,
                        "charts": partial.charts,
                        "failed_runs": partial.failed_runs,
                        "avoidable_failures": partial.avoidable_failures,
                        "wasted_cost_usd": partial.wasted_cost_usd,
                        "typed_judgments": partial.typed_judgments,
                        "api_usage": job.api_usage,
                        "demo_data": False,
                    },
                }
            )
            if i < total - 1 and pace > 0:
                await asyncio.sleep(pace)

        await job.events.put(
            {
                "event": "phase",
                "data": {
                    "phase": "summary",
                    "message": f"Live analysis finished ({len(job.analyses)}/{total})",
                    "demo_data": False,
                },
            }
        )

    def _persist(self, job: Job, result: JobResult) -> None:
        out = RESULTS_DIR / f"{job.id}.json"
        out.write_text(result.model_dump_json(indent=2), encoding="utf-8")


job_manager = JobManager()
