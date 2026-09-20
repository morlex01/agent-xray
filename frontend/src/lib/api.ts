import type { AgentTrace, JobResult } from "../types";

const BASE = import.meta.env.VITE_API_BASE || "";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function getHealth() {
  return json<{ status: string; has_api_key: boolean; mode_available: string[] }>("/health");
}

export async function getDemoTraces(limit = 48) {
  return json<{ count: number; total_available: number; demo_data: boolean; traces: AgentTrace[] }>(
    `/api/demo/traces?limit=${limit}`,
  );
}

export async function uploadTraces(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return json<{ uploaded: number; trace_ids: string[]; message: string; traces: AgentTrace[] }>("/api/upload", {
    method: "POST",
    body: fd,
  });
}

export async function startAnalysis(body: {
  mode: string;
  demo_count?: number;
  speed?: number;
  trace_ids?: string[];
}) {
  return json<{ job_id: string; mode: string; total_traces: number; message: string }>("/api/analyze/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getResults(jobId: string) {
  return json<JobResult>(`/api/results/${jobId}`);
}

export async function getTrace(traceId: string) {
  return json<AgentTrace>(`/api/traces/${traceId}`);
}

export function subscribeEvents(
  jobId: string,
  handlers: {
    onEvent: (event: string, data: unknown) => void;
    onError?: (err: Error) => void;
  },
): () => void {
  const es = new EventSource(`${BASE}/api/analyze/events/${jobId}`);
  // Do NOT register the bare name "error" — it collides with native EventSource connection errors
  // and falsely marks successful jobs as "Analysis failed" when the stream closes.
  const events = [
    "status",
    "phase",
    "trace_start",
    "trace_result",
    "trace_error",
    "progress",
    "complete",
    "job_error",
    "end",
    "ping",
  ];
  for (const ev of events) {
    es.addEventListener(ev, (e) => {
      try {
        const raw = (e as MessageEvent).data;
        if (raw == null || raw === "") return;
        const data = JSON.parse(raw);
        handlers.onEvent(ev, data);
      } catch (err) {
        handlers.onError?.(err as Error);
      }
    });
  }
  es.onerror = () => {
    // Transient disconnect / normal close after complete — do not surface as analysis failure.
  };
  return () => es.close();
}
