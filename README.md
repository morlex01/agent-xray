# Agent X-Ray

**Find out why your AI agents fail.** Powered by [TypeSafe JEV](https://docs.typesafe.ai).

Agent X-Ray is a local-first mini product that accepts AI agent execution traces, runs TypeSafe JEV judgments, and turns the results into a dense **Final Diagnostic** report plus a ready-to-use **Fix Pack** for coding agents (Grok, Codex, Claude, and others).

> **Demo mode needs no API key.** Live mode uses `TYPESAFE_API_KEY` on the **server only**.

Built by [Morlex](https://x.com/0xMorlex) ([@0xMorlex](https://x.com/0xMorlex)).

---

## What it does

1. Load built-in demo traces or **upload** your own (`JSON` / `JSONL` / `CSV`).
2. Run analysis in **Demo** (deterministic, labeled **DEMO DATA**) or **Live JEV** (real TypeSafe `system_one`).
3. Inspect the dashboard: trace viewer, JEV checks, charts, typed output stream, trace strip.
4. Open the **Final Diagnostic** report when a run completes.
5. **Copy Fix Prompt** or **Download Fix Pack** — deterministic Markdown/prompt built from current JEV results (no extra AI call).

---

## How JEV is used

For each trace in Live mode, the backend builds a compact state object and calls TypeSafe:

```text
TypeSafeClient.system_one(state=..., model="jev-latest", questions={...17...})
```

**17 typed judgments in one call:**

| Count | Type | Role |
|------:|------|------|
| 14 | Noul | Atomic failure / quality signals (retries, wrong tool, missing context, …) |
| 1 | Choice | `failure_type` |
| 1 | Choice | `failure_stage` |
| 1 | Score | `severity` |

Python then derives metrics (avoidable cost, charts, insights). The Fix Pack classifies runs as **confirmed failures**, **near misses**, and **successful controls**.

Demo mode uses the same UI/API schema with a deterministic local engine — never present DEMO DATA as a real JEV benchmark.

---

## Project structure

```text
agent-x-ray/
  frontend/           React + Vite + Tailwind + Framer Motion + Recharts
  backend/app/        FastAPI + JEV client + jobs/SSE
  backend/tests/      pytest
  data/demo_traces.jsonl
  data/results/       runtime job outputs (gitignored contents)
  sample-data/        small upload samples
  scripts/generate_demo_traces.py
  .env.example
  package.json        root scripts (concurrently)
```

---

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** and npm
- (Optional for Live) TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai)

---

## Setup

```bash
cd agent-x-ray

# Root tooling (concurrently) + frontend deps
npm install
npm install --prefix frontend

# Backend virtualenv + Python deps
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# Ensure demo dataset exists (safe to re-run)
backend/.venv/bin/python scripts/generate_demo_traces.py
```

### Environment variables

```bash
cp .env.example backend/.env
# edit backend/.env and set:
# TYPESAFE_API_KEY=your_typesafe_api_key_here
```

The backend loads `backend/.env` first, then an optional root `.env`.

| Variable | Required | Purpose |
|----------|----------|---------|
| `TYPESAFE_API_KEY` | Live only | TypeSafe JEV key (server-side) |
| `JEV_CONCURRENCY` | No | Max concurrent Live calls (default `3`) |
| `JEV_TIMEOUT_SECONDS` | No | Per-call timeout (default `60`) |
| `JEV_LIVE_PACE_SECONDS` | No | Pause between sequential Live traces (default `0.35`) |
| `CORS_ORIGINS` | No | Comma-separated allowed browser origins; defaults to local Vite URLs |

Never put the API key in frontend code or `VITE_*` variables.

---

## Run

### Development (API + UI together)

```bash
npm run dev
```

- Frontend: http://127.0.0.1:5173/
- Backend: http://127.0.0.1:8000/
- Health: http://127.0.0.1:8000/health
- OpenAPI: http://127.0.0.1:8000/docs

### Separate terminals

```bash
# terminal 1 — backend
npm run dev:backend

# terminal 2 — frontend
npm run dev:frontend
```

### Production-style local build

```bash
npm run build
npm start
```

- Backend: http://127.0.0.1:8000/
- Frontend preview: http://127.0.0.1:4173/

### Lint / typecheck / tests

```bash
npm run lint --prefix frontend
npm run build
npm test
```

---

## Demo mode

1. Open http://127.0.0.1:5173/
2. Leave mode on **Demo** (default).
3. Click **Run Analysis**.
4. Watch the animated timeline, then the **Final Diagnostic** overlay.
5. Use **Copy Fix Prompt** / **Download Fix Pack**, or **Back to dashboard**.

No API key required. UI is labeled **DEMO DATA**.

---

## Live JEV mode

1. Set `TYPESAFE_API_KEY` in `backend/.env` and restart the backend.
2. Confirm `GET /health` reports `"has_api_key": true`.
3. In the UI, switch to **Live**.
4. Optionally **Upload** traces from `sample-data/`, or use loaded demo traces.
5. Click **Run Analysis**. Live processes the queue **sequentially** with real JEV.

Agent-level failures inside a trace (for example HTTP 429 in tool output) are analyzed as input. True TypeSafe/JEV API rate limits are retried with backoff.

---

## Trace upload format

Upload via the UI **Upload** button: `.json`, `.jsonl`, or `.csv`.

Minimal JSON object:

```json
{
  "id": "trace_0042",
  "agent_name": "api-orchestrator",
  "status": "failure",
  "started_at": "2026-09-01T12:00:00Z",
  "duration_ms": 4200,
  "estimated_cost_usd": 0.18,
  "user_request": "Refund order ORD-1042",
  "steps": [
    {
      "timestamp": "2026-09-01T12:00:01Z",
      "role": "assistant",
      "action": "call",
      "tool_name": "http_request",
      "input": { "url": "/v1/refunds" },
      "output": null,
      "status": "error",
      "error": "429 Too Many Requests"
    }
  ],
  "metadata": {}
}
```

JSONL = one such object per line. See `sample-data/` for ready files.

CSV columns: `id,agent_name,status,started_at,duration_ms,estimated_cost_usd,user_request,steps,metadata` (`steps` / `metadata` as JSON strings).

---

## Final Diagnostic and Fix Pack

When analysis completes, the **Final Diagnostic** modal opens:

- Risk summary (confirmed failed runs / near misses / successful controls)
- Impact metrics, root-cause cards, optional failure flow, P1–P3 actions
- **FIX PACK READY** bar:
  - **Copy Fix Prompt** (primary blue) — clipboard prompt for a coding agent
  - **Download Fix Pack** (primary magenta) — `agent-xray-fix-pack-YYYYMMDD-HHMM.md`
  - **Back to dashboard** — closes overlay only; dashboard state is preserved

Close also works via **×**, **Escape**, and backdrop click. The modal does not reopen until a **new** analysis finishes.

Fix Pack content is built **deterministically** from the current analyses (no extra model call). Evidence is sanitized; do not paste secrets into traces.

---

## Security and privacy

- Keep `TYPESAFE_API_KEY` in `backend/.env` or `.env` only — both are gitignored.
- The key never ships to the browser; Live calls run on the backend.
- Common secret fields and token patterns are redacted before traces are sent to Live JEV.
- Do not commit logs, `data/uploads/`, or `data/results/*`.
- Trace evidence in Fix Packs is redacted for common secret patterns — still avoid uploading real credentials.
- This package is intended for **local** use; review your org’s policies before sharing traces.

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `has_api_key: false` in `/health` | Create `backend/.env` from `.env.example`, set the key, restart backend |
| Live start fails with missing key | Switch to Demo, or set `TYPESAFE_API_KEY` |
| Frontend cannot reach API | Ensure backend is on `:8000`; Vite proxies `/api` and `/health` |
| Port in use | Stop other processes on `8000` / `5173`, or change ports in uvicorn / `vite.config.ts` |
| Empty demo dataset | `backend/.venv/bin/python scripts/generate_demo_traces.py` |
| `typesafe-sdk` install issues | Use Python 3.10+, upgrade pip, re-run `pip install -r backend/requirements.txt` |
| Modal will not close | Use ×, Back to dashboard, Escape, or backdrop; refresh if a stale tab is open |

---

## Attribution

Product UI footer credit: **Morlex** · [@0xMorlex](https://x.com/0xMorlex) · https://x.com/0xMorlex  
Avatar asset: `frontend/public/morlex-avatar.jpg`

---

## License

MIT — see [LICENSE](./LICENSE).
