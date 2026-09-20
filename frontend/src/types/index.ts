export interface TraceStep {
  timestamp: string;
  role: string;
  action: string;
  tool_name?: string | null;
  input?: unknown;
  output?: unknown;
  status: string;
  error?: string | null;
}

export interface AgentTrace {
  id: string;
  agent_name: string;
  status: string;
  started_at: string;
  duration_ms: number;
  estimated_cost_usd: number;
  user_request: string;
  steps: TraceStep[];
  metadata?: Record<string, unknown>;
}

export interface NoulJudgment {
  id: string;
  noul: number;
  label?: string;
}

export interface ChoiceJudgment {
  id: string;
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number | null;
}

export interface ScoreJudgment {
  id: string;
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence?: number | null;
}

export interface TraceAnalysis {
  trace_id: string;
  agent_name: string;
  mode: string;
  nouls: Record<string, NoulJudgment>;
  failure_type?: ChoiceJudgment | null;
  failure_stage?: ChoiceJudgment | null;
  severity?: ScoreJudgment | null;
  metrics: Record<string, unknown>;
  usage?: { input_tokens: number; output_tokens: number } | null;
  jev_model?: string | null;
  demo_data: boolean;
  stream_line: string;
}

export interface Insights {
  top_pattern: string;
  most_expensive_agent: string;
  common_retry_loop: string;
  avoidable_pct: number;
  by_agent: Record<string, { failures: number; cost_usd: number; waste_usd: number }>;
  wasted_cost_usd: number;
  recommendations: string[];
}

export interface ChartPoint {
  name: string;
  value: number;
}

export interface JobResult {
  job_id: string;
  status: string;
  mode: string;
  demo_data: boolean;
  total: number;
  completed: number;
  failed_runs: number;
  avoidable_failures: number;
  elapsed_ms: number;
  throughput: number;
  wasted_cost_usd: number;
  typed_judgments: number;
  api_usage?: { input_tokens: number; output_tokens: number } | null;
  jev_model?: string | null;
  analyses: TraceAnalysis[];
  insights?: Insights | null;
  charts: {
    failure_types?: ChartPoint[];
    severity?: ChartPoint[];
    by_agent?: ChartPoint[];
    retries?: ChartPoint[];
    waste?: ChartPoint[];
  };
  error?: string | null;
}

export type RunPhase = "idle" | "init" | "intake" | "checks" | "charts" | "insights" | "summary" | "complete" | "error";

export interface AppState {
  mode: "demo" | "live";
  phase: RunPhase;
  running: boolean;
  paused: boolean;
  jobId: string | null;
  traces: AgentTrace[];
  selectedTraceId: string | null;
  activeAnalysis: TraceAnalysis | null;
  streamLines: string[];
  stats: {
    runs: number;
    judgments: number;
    failed: number;
    avoidable: number;
    elapsedMs: number;
    throughput: number;
    wasted: number;
    apiUsage?: { input_tokens: number; output_tokens: number } | null;
  };
  charts: JobResult["charts"];
  insights: Insights | null;
  demoData: boolean;
  hasApiKey: boolean;
  error: string | null;
  notice: string | null;
  revealedChecks: number;
  analysesVersion: number;
}
