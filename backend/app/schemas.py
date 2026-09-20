"""Pydantic schemas for traces, judgments, jobs, and API payloads."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class TraceStatus(str, Enum):
    success = "success"
    failure = "failure"
    error = "error"
    partial = "partial"
    unknown = "unknown"


class StepStatus(str, Enum):
    ok = "ok"
    error = "error"
    retry = "retry"
    skipped = "skipped"
    pending = "pending"


class TraceStep(BaseModel):
    timestamp: str = ""
    role: str = "assistant"
    action: str = ""
    tool_name: Optional[str] = None
    input: Any = None
    output: Any = None
    status: str = "ok"
    error: Optional[str] = None


class AgentTrace(BaseModel):
    id: str
    agent_name: str = "unknown"
    status: str = "unknown"
    started_at: str = ""
    duration_ms: int = 0
    estimated_cost_usd: float = 0.0
    user_request: str = ""
    steps: list[TraceStep] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class NoulJudgment(BaseModel):
    id: str
    noul: float
    label: str = ""


class ChoiceJudgment(BaseModel):
    id: str
    choice: str
    probabilities: dict[str, float] = Field(default_factory=dict)
    confidence: Optional[float] = None


class ScoreJudgment(BaseModel):
    id: str
    score: float
    legend: dict[str, str] = Field(default_factory=dict)
    probabilities: dict[str, float] = Field(default_factory=dict)
    confidence: Optional[float] = None


class TraceAnalysis(BaseModel):
    trace_id: str
    agent_name: str = ""
    mode: str = "demo"  # demo | live
    nouls: dict[str, NoulJudgment] = Field(default_factory=dict)
    failure_type: Optional[ChoiceJudgment] = None
    failure_stage: Optional[ChoiceJudgment] = None
    severity: Optional[ScoreJudgment] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    usage: Optional[dict[str, int]] = None
    jev_model: Optional[str] = None
    demo_data: bool = True
    stream_line: str = ""


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    error = "error"
    cancelled = "cancelled"


class AnalyzeStartRequest(BaseModel):
    mode: str = "demo"  # demo | live | auto
    trace_ids: Optional[list[str]] = None
    demo_count: int = 48
    speed: float = 1.0


class AnalyzeStartResponse(BaseModel):
    job_id: str
    mode: str
    total_traces: int
    message: str = ""


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    has_api_key: bool = False
    mode_available: list[str] = Field(default_factory=lambda: ["demo"])


class UploadResponse(BaseModel):
    uploaded: int
    trace_ids: list[str]
    message: str = ""
    traces: list[dict[str, Any]] = Field(default_factory=list)


class Insights(BaseModel):
    top_pattern: str = ""
    most_expensive_agent: str = ""
    common_retry_loop: str = ""
    avoidable_pct: float = 0.0
    by_agent: dict[str, Any] = Field(default_factory=dict)
    wasted_cost_usd: float = 0.0
    recommendations: list[str] = Field(default_factory=list)


class JobResult(BaseModel):
    job_id: str
    status: str
    mode: str
    demo_data: bool = True
    total: int = 0
    completed: int = 0
    failed_runs: int = 0
    avoidable_failures: int = 0
    elapsed_ms: int = 0
    throughput: float = 0.0
    wasted_cost_usd: float = 0.0
    typed_judgments: int = 0
    api_usage: Optional[dict[str, int]] = None
    jev_model: Optional[str] = None
    analyses: list[TraceAnalysis] = Field(default_factory=list)
    insights: Optional[Insights] = None
    charts: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
