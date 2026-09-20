import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentTrace, Insights, TraceAnalysis } from "../types";
import { FINAL_PATTERNS, PREVIEW_STATS } from "../lib/demoPreview";
import { buildDiagnosticReport, classificationDistribution } from "../lib/diagnosticReport";
import {
  buildCodingPrompt,
  buildFixPackMarkdown,
  copyTextToClipboard,
  downloadTextFile,
  fixPackFilename,
} from "../lib/fixPack";

interface Props {
  insights: Insights | null;
  show: boolean;
  reducedMotion: boolean;
  demoData: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  analyses?: TraceAnalysis[];
  traces?: AgentTrace[];
  jobId?: string | null;
  jevModel?: string | null;
  stats?: {
    runs: number;
    judgments: number;
    failed: number;
    avoidable: number;
    elapsedMs: number;
    throughput: number;
    wasted: number;
  };
}

const easeOut = [0.22, 1, 0.36, 1] as const;

export function InsightsPanel({
  insights,
  show,
  reducedMotion,
  demoData,
  onClose,
  returnFocusRef,
  analyses = [],
  traces = [],
  jobId = null,
  jevModel = null,
  stats,
}: Props) {
  const s = stats || PREVIEW_STATS;
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  const report = useMemo(() => {
    if (!insights) return null;
    return buildDiagnosticReport(
      insights,
      analyses,
      traces,
      {
        runs: s.runs,
        judgments: s.judgments,
        failed: s.failed,
        avoidable: s.avoidable,
        wasted: s.wasted,
      },
    );
  }, [insights, analyses, traces, s.runs, s.judgments, s.failed, s.avoidable, s.wasted]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!show) setCopied(false);
  }, [show]);

  const packInput = useCallback(() => {
    if (!insights) return null;
    return {
      insights,
      analyses,
      traces,
      stats: {
        runs: s.runs,
        judgments: s.judgments,
        failed: s.failed,
        avoidable: s.avoidable,
        wasted: s.wasted,
      },
      demoData,
      jevModel,
      jobId,
    };
  }, [insights, analyses, traces, s.runs, s.judgments, s.failed, s.avoidable, s.wasted, demoData, jevModel, jobId]);

  const onCopyPrompt = useCallback(async () => {
    const input = packInput();
    if (!input) return;
    const prompt = buildCodingPrompt(input);
    try {
      await copyTextToClipboard(prompt);
      setCopied(true);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [packInput]);

  const onDownloadPack = useCallback(() => {
    const input = packInput();
    if (!input) return;
    const md = buildFixPackMarkdown(input);
    downloadTextFile(fixPackFilename(new Date()), md);
  }, [packInput]);

  useEffect(() => {
    if (!show || !insights) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      const target = returnFocusRef?.current || previouslyFocused;
      if (target && typeof target.focus === "function") {
        window.setTimeout(() => target.focus(), 0);
      }
    };
  }, [show, insights, onClose, returnFocusRef]);

  const rm = reducedMotion;
  const stagger = (i: number, base = 0.12) => (rm ? 0 : base + i * 0.1);

  return (
    <AnimatePresence>
      {show && insights && report ? (
        <motion.div
          initial={rm ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-40 flex items-center justify-center bg-page/85 p-3 md:p-4"
          onClick={onClose}
          aria-hidden={false}
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={rm ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: easeOut }}
            className="bg-surface border-2 border-ink rounded-sm w-full max-w-[1180px] max-h-[min(960px,calc(100vh-24px))] flex flex-col overflow-hidden shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            {/* scroll only inside modal on smaller viewports */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              <div className="p-4 md:p-5 flex flex-col gap-3">
                {/* 1. Header */}
                <motion.div
                  initial={rm ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: stagger(0, 0), ease: easeOut }}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="label-caps text-jev-ink mb-1">Final diagnostic</div>
                    <h2
                      id={titleId}
                      className="text-[22px] md:text-[26px] font-bold tracking-tight text-ink leading-tight"
                    >
                      {report.headline}
                    </h2>
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    {demoData ? (
                      <span className="mono px-2 py-1 border border-jev bg-jev-pale text-jev-ink font-semibold">
                        DEMO DATA
                      </span>
                    ) : (
                      <span className="mono px-2 py-1 border border-electric bg-electric/10 text-electric font-semibold">
                        LIVE JEV
                      </span>
                    )}
                    <button
                      ref={closeBtnRef}
                      type="button"
                      className="btn h-8 w-8 !px-0 flex items-center justify-center text-lg leading-none"
                      aria-label="Close final insight"
                      onClick={onClose}
                    >
                      ×
                    </button>
                  </div>
                </motion.div>

                {/* 2. Risk summary */}
                <motion.div
                  initial={rm ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: stagger(0, 0.08), ease: easeOut }}
                  className="border border-ink rounded-sm bg-page/70 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="label-caps">Risk summary</div>
                    <div className="mono text-ink-mute">
                      Highest severity: <span className="text-fail font-semibold">{report.highestSeverity}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    <RiskChip label="Confirmed failed runs" value={report.confirmed} tone="fail" />
                    <RiskChip label="Near misses" value={report.nearMisses} tone="warn" />
                    <RiskChip label="Successful controls" value={report.controls} tone="ok" />
                    <RiskChip label="Severity rank" value={`${report.severityRank}/4`} tone="jev" />
                  </div>
                  <ClassificationBar
                    confirmed={report.confirmed}
                    nearMisses={report.nearMisses}
                    controls={report.controls}
                    totalRuns={report.metrics.runs}
                    reducedMotion={rm}
                  />
                </motion.div>

                {/* 3. Impact metrics */}
                <motion.div
                  initial={rm ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: stagger(1, 0.18), ease: easeOut }}
                  className="grid grid-cols-4 gap-2"
                >
                  <MetricCard
                    label="Runs analyzed"
                    value={report.metrics.runs}
                    format={(n) => String(Math.round(n))}
                    accent="border-t-ink"
                    reducedMotion={rm}
                    delay={0.18}
                  />
                  <MetricCard
                    label="Avoidable failures"
                    value={report.metrics.avoidable}
                    format={(n) => String(Math.round(n))}
                    accent="border-t-fail"
                    reducedMotion={rm}
                    delay={0.26}
                  />
                  <MetricCard
                    label="Wasted cost"
                    value={report.metrics.wasted}
                    format={(n) => `$${n.toFixed(3)}`}
                    accent="border-t-warn"
                    reducedMotion={rm}
                    delay={0.34}
                  />
                  <MetricCard
                    label="Typed judgments"
                    value={report.metrics.judgments}
                    format={(n) => String(Math.round(n))}
                    accent="border-t-electric"
                    reducedMotion={rm}
                    delay={0.42}
                  />
                </motion.div>

                {/* 4. Root-cause cards */}
                <div className="grid grid-cols-3 gap-2">
                  {report.rootCauses.length === 0 ? (
                    <div className="col-span-3 border border-line-soft rounded-sm px-3 py-4 text-[12px] text-ink-mute">
                      No confirmed failure patterns in this run.
                    </div>
                  ) : (
                    report.rootCauses.map((card, i) => (
                      <motion.div
                        key={`${card.n}-${card.pattern}`}
                        initial={rm ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: stagger(i, 0.48), ease: easeOut }}
                        className={`border rounded-sm bg-surface p-3 relative overflow-hidden ${
                          card.klass === "confirmed_failure" ? "border-ink border-2" : "border-line-soft"
                        }`}
                      >
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                            card.accent === "fail"
                              ? "bg-fail"
                              : card.accent === "warn"
                                ? "bg-warn"
                                : "bg-jev"
                          }`}
                        />
                        <div className="pl-2">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span
                              className={`mono font-bold text-base ${
                                card.klass === "confirmed_failure" ? "text-fail" : "text-warn"
                              }`}
                            >
                              {card.n}
                            </span>
                            <span
                              className={`mono px-1.5 py-0.5 border font-semibold ${
                                card.klass === "confirmed_failure"
                                  ? "border-fail text-fail bg-fail/5"
                                  : "border-warn text-warn bg-warn/5"
                              }`}
                            >
                              {card.severity}
                            </span>
                          </div>
                          <div className="text-[13px] font-bold text-ink leading-snug mb-1.5 break-words">
                            {card.pattern.replace(/_/g, " ")}
                          </div>
                          <div className="mono text-ink-mute mb-1">
                            agent <span className="text-ink font-semibold">{card.agent}</span>
                          </div>
                          <div className="mono text-ink-faint mb-1.5">
                            confidence{" "}
                            <span className="text-ink">
                              {card.confidence == null ? "n/a" : card.confidence.toFixed(2)}
                              {card.confidence != null && card.confidence < 0.55
                                ? " · low-confidence signal"
                                : ""}
                            </span>
                          </div>
                          <div className="text-[11px] text-ink-soft leading-snug border-t border-line-faint pt-1.5 mb-1.5 line-clamp-2">
                            {card.evidence}
                          </div>
                          <div className="mono text-ink-mute">
                            {card.traceCount} trace{card.traceCount === 1 ? "" : "s"} ·{" "}
                            {card.klass === "confirmed_failure" ? "confirmed" : "near miss"}
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>

                {/* 5. Failure flow */}
                {report.flow ? (
                  <motion.div
                    initial={rm ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, delay: stagger(0, 0.72), ease: easeOut }}
                    className="border border-ink rounded-sm px-3 py-2.5 bg-page/50"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="label-caps">Failure flow</div>
                      <div className="mono text-ink-mute truncate">
                        {report.flow.pattern.replace(/_/g, " ")}
                        {report.flow.stage !== "n/a" ? ` · stage ${report.flow.stage}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {report.flow.steps.map((step, i) => {
                        const fail = i === report.flow!.failIndex;
                        return (
                          <div key={`${step}-${i}`} className="flex items-center gap-1.5">
                            <span
                              className={`mono px-2 py-1 border font-semibold ${
                                fail
                                  ? "border-fail bg-fail text-white"
                                  : "border-ink bg-surface text-ink"
                              }`}
                            >
                              {step}
                            </span>
                            {i < report.flow!.steps.length - 1 ? (
                              <span className={`mono font-bold ${fail ? "text-fail" : "text-ink-faint"}`}>
                                →
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : null}

                {/* 6. Recommended actions */}
                <motion.div
                  initial={rm ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: stagger(0, 0.92), ease: easeOut }}
                  className="grid grid-cols-3 gap-2"
                >
                  {report.actions.map((a) => (
                    <div
                      key={a.id}
                      className="border border-electric/40 rounded-sm bg-electric-pale/40 p-2.5"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="mono px-1.5 py-0.5 bg-electric text-white font-bold border border-electric">
                          {a.id}
                        </span>
                        <span className="label-caps text-electric !normal-case tracking-normal">
                          {a.label}
                        </span>
                      </div>
                      <div className="text-[12px] font-semibold text-ink leading-snug mb-1">{a.action}</div>
                      <div className="text-[11px] text-ink-mute leading-snug">→ {a.result}</div>
                    </div>
                  ))}
                </motion.div>
              </div>
            </div>

            {/* 7. Fix Pack action bar */}
            <motion.div
              initial={rm ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: rm ? 0 : 1.05 }}
              className="shrink-0 border-t-2 border-ink bg-page px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                <span className="mono px-2 py-1 border border-ink bg-surface font-bold tracking-[0.14em] text-ink">
                  FIX PACK READY
                </span>
                <span className="mono text-ink-faint hidden sm:inline">
                  Deterministic from current JEV results
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-electric"
                  onClick={() => void onCopyPrompt()}
                  disabled={!insights || analyses.length === 0}
                >
                  {copied ? "Copied" : "Copy Fix Prompt"}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onDownloadPack}
                  disabled={!insights || analyses.length === 0}
                >
                  Download Fix Pack
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  Back to dashboard
                </button>
              </div>
            </motion.div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function RiskChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "fail" | "warn" | "ok" | "jev";
}) {
  const color =
    tone === "fail"
      ? "text-fail border-fail/40"
      : tone === "warn"
        ? "text-warn border-warn/40"
        : tone === "ok"
          ? "text-ok border-ok/40"
          : "text-jev-ink border-jev/40";
  return (
    <div className={`border rounded-sm bg-surface px-2 py-1.5 ${color}`}>
      <div className="label-caps !text-[8px]">{label}</div>
      <div className="font-mono text-sm font-bold tabular-nums leading-none mt-0.5">{value}</div>
    </div>
  );
}

function ClassificationBar({
  confirmed,
  nearMisses,
  controls,
  totalRuns,
  reducedMotion,
}: {
  confirmed: number;
  nearMisses: number;
  controls: number;
  totalRuns: number;
  reducedMotion: boolean;
}) {
  const { confirmedPct, nearPct, controlPct, segments } = classificationDistribution(
    confirmed,
    nearMisses,
    controls,
    totalRuns,
  );
  const total = Math.max(0, totalRuns);

  const fmtPct = (v: number) => {
    if (total <= 0) return "0%";
    if (v > 0 && v < 0.1) return "<0.1%";
    return `${v.toFixed(1)}%`;
  };

  return (
    <div className="space-y-1.5">
      <div
        className="h-2.5 w-full border border-ink rounded-sm bg-surface overflow-hidden flex"
        role="img"
        aria-label={`Classification distribution: ${confirmed} confirmed failed runs (${fmtPct(confirmedPct)}), ${nearMisses} near misses (${fmtPct(nearPct)}), ${controls} successful controls (${fmtPct(controlPct)})`}
      >
        {total <= 0 || segments.length === 0 ? (
          <div className="w-full h-full bg-page" aria-hidden />
        ) : (
          segments.map((s, i) => (
            <motion.div
              key={s.key}
              className={`h-full ${s.className} ${i > 0 ? "border-l border-ink/20" : ""}`}
              title={`${s.label}: ${s.count} (${fmtPct(s.pct)})`}
              initial={reducedMotion ? false : { width: 0 }}
              animate={{ width: `${s.pct}%` }}
              transition={{ duration: 0.35, delay: reducedMotion ? 0 : 0.1 + i * 0.04, ease: easeOut }}
              style={{ width: `${s.pct}%`, minWidth: s.pct > 0 ? 2 : 0 }}
            />
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mono text-[9px] text-ink-faint">
        <span>
          <i className="inline-block h-1.5 w-1.5 rounded-sm bg-fail mr-1 align-middle" />
          Confirmed failed runs {confirmed} · {fmtPct(confirmedPct)}
        </span>
        <span>
          <i className="inline-block h-1.5 w-1.5 rounded-sm bg-warn mr-1 align-middle" />
          Near misses {nearMisses} · {fmtPct(nearPct)}
        </span>
        <span>
          <i className="inline-block h-1.5 w-1.5 rounded-sm bg-ok mr-1 align-middle" />
          Successful controls {controls} · {fmtPct(controlPct)}
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  format,
  accent,
  reducedMotion,
  delay,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  accent: string;
  reducedMotion: boolean;
  delay: number;
}) {
  const mv = useMotionValue(reducedMotion ? value : 0);
  const display = useTransform(mv, (v) => format(v));
  const [text, setText] = useState(format(reducedMotion ? value : 0));

  useEffect(() => {
    if (reducedMotion) {
      setText(format(value));
      return;
    }
    const controls = animate(mv, value, {
      duration: 0.55,
      delay,
      ease: easeOut,
    });
    const unsub = display.on("change", (v) => setText(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value, reducedMotion, delay, mv, display, format]);

  return (
    <div className={`border border-ink rounded-sm bg-surface px-2.5 py-2 border-t-[3px] ${accent}`}>
      <div className="label-caps mb-1">{label}</div>
      <div className="font-mono text-[17px] font-bold tabular-nums text-ink leading-none">{text}</div>
    </div>
  );
}

/** Compact inline insight strip for the right column (pre-overlay / always visible summary). */
export function CompactInsight({
  insights,
  demoData,
}: {
  insights: Insights | null;
  demoData: boolean;
}) {
  const patterns = FINAL_PATTERNS;
  return (
    <div className="panel-soft p-2 shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="label-caps">Insight preview</div>
        {demoData ? (
          <span className="mono text-jev-ink font-semibold">DEMO DATA</span>
        ) : (
          <span className="mono text-electric font-semibold">LIVE JEV</span>
        )}
      </div>
      <div className="text-[12px] font-semibold text-ink mb-1.5 leading-snug">
        {insights?.top_pattern
          ? `Top pattern: ${insights.top_pattern}`
          : "3 patterns cause most agent failures"}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {patterns.map((p) => (
          <div key={p.n} className="border border-line-soft rounded-sm px-1.5 py-1 bg-page/50">
            <div className="mono text-jev font-bold text-[10px]">{p.n}</div>
            <div className="text-[9px] text-ink-soft leading-tight">{p.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
