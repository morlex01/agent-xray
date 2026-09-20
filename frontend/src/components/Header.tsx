import { Pause, Play, RotateCcw, Upload } from "lucide-react";
import { useRef } from "react";

interface Props {
  mode: "demo" | "live";
  running: boolean;
  paused: boolean;
  phase: string;
  demoData: boolean;
  jevModel?: string | null;
  hasApiKey: boolean;
  onMode: (m: "demo" | "live") => void;
  onUpload: (f: File) => void;
  onRun: () => void;
  onReset: () => void;
  onPause: () => void;
  onRestartDemo: () => void;
}

export function Header(props: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="panel px-3 py-2 flex items-center gap-3 shrink-0 overflow-hidden">
      <div className="flex items-center gap-2.5 min-w-0 shrink">
        <div className="h-8 w-8 border border-ink bg-jev flex items-center justify-center shrink-0 rounded-sm">
          <span className="text-white font-bold text-xs tracking-tight">AX</span>
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-[15px] font-bold tracking-tight text-ink uppercase">Agent X-Ray</h1>
            <span className="mono text-jev-ink font-semibold uppercase tracking-wider">Powered by JEV</span>
          </div>
          <p className="text-[11px] text-ink-mute truncate">Find out why your AI agents fail.</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5 shrink-0 flex-nowrap">
        <span
          className={`mono px-2 py-1 border rounded-sm font-semibold ${
            props.demoData
              ? "border-jev bg-jev-pale text-jev-ink"
              : "border-electric bg-electric-pale text-electric"
          }`}
        >
          {props.demoData ? "DEMO DATA" : props.jevModel ? `LIVE JEV · ${props.jevModel}` : "LIVE JEV"}
        </span>

        <div className="flex items-center border border-ink rounded-sm overflow-hidden text-[11px] h-[26px]">
          <button
            className={`px-2.5 h-full ${props.mode === "demo" ? "bg-electric text-white" : "bg-surface text-ink-mute hover:bg-page"}`}
            onClick={() => props.onMode("demo")}
            type="button"
          >
            Demo
          </button>
          <button
            className={`px-2.5 h-full border-l border-ink ${props.mode === "live" ? "bg-electric text-white" : "bg-surface text-ink-mute hover:bg-page"}`}
            onClick={() => props.onMode("live")}
            type="button"
            title={props.hasApiKey ? "Live JEV" : "Requires TYPESAFE_API_KEY on server"}
          >
            Live
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.jsonl,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onUpload(f);
            e.target.value = "";
          }}
        />
        <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3 w-3" /> Upload
        </button>
        <button
          className="btn-primary"
          type="button"
          onClick={props.onRun}
          disabled={props.running && !props.paused}
        >
          <Play className="h-3 w-3" /> Run Analysis
        </button>
        <button className="btn" type="button" onClick={props.onPause} disabled={!props.running}>
          {props.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {props.paused ? "Resume" : "Pause"}
        </button>
        <button className="btn" type="button" onClick={props.onRestartDemo}>
          Restart
        </button>
        <button className="btn" type="button" onClick={props.onReset}>
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>
    </header>
  );
}
