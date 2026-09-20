import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { JobResult } from "../types";

const COLORS = ["#e11d7a", "#2563eb", "#d97706", "#dc2626", "#16a34a", "#0a0a0a", "#6b6b6b", "#f472b6"];

interface Props {
  charts: JobResult["charts"];
  compact?: boolean;
}

/** Shorten category labels so they stay inside the card. */
function shortLabel(name: string, max = 12): string {
  const n = String(name || "").replace(/_/g, " ");
  if (n.length <= max) return n;
  // Prefer first token(s)
  const parts = n.split(/\s+/);
  let out = parts[0] || n;
  for (let i = 1; i < parts.length; i++) {
    const next = `${out} ${parts[i]}`;
    if (next.length > max) break;
    out = next;
  }
  if (out.length <= max) return out;
  return out.slice(0, max - 1) + "…";
}

function withLabels<T extends { name: string; value: number }>(rows: T[], max = 12) {
  return (rows || []).map((d) => ({ ...d, label: shortLabel(d.name, max) }));
}

export function ChartsPanel({ charts }: Props) {
  const ft = withLabels(charts.failure_types || [], 11);
  const sev = charts.severity || [];
  const agents = withLabels(charts.by_agent || [], 11);
  const retries = charts.retries || [];
  const waste = withLabels((charts.waste || []).slice(0, 4), 10);

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-x-1.5 gap-y-3 h-full min-h-0">
      <ChartCard title="Failure distribution">
        {ft.length ? (
          <div className="w-full h-full min-h-[120px] relative">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ft}
                  margin={{ top: 8, right: 8, left: 4, bottom: 8 }}
                >
                  <XAxis
                    dataKey="label"
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={42}
                    tick={{ fill: "#3d3d3d", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={{ stroke: "#cfcbc4" }}
                    tickLine={false}
                  />
                  <YAxis
                    width={28}
                    tick={{ fill: "#6b6b6b", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={tipStyle} />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive animationDuration={600}>
                    {ft.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </ChartCard>

      <ChartCard title="Severity">
        {sev.length ? (
          <div className="w-full h-full min-h-[120px] flex items-center gap-2 px-1">
            <div className="relative flex-[1.1] h-full min-h-[100px]">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <Pie
                      data={sev}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="34%"
                      outerRadius="68%"
                      paddingAngle={2}
                      isAnimationActive
                      animationDuration={600}
                    >
                      {sev.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="flex-1 space-y-1 pr-1 min-w-0">
              {sev.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="mono text-[10px] text-ink-mute">S{d.name}</span>
                  <span className="ml-auto mono text-[11px] font-semibold text-ink">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </ChartCard>

      <ChartCard title="Failures by agent">
        {agents.length ? (
          <div className="w-full h-full min-h-[120px] relative">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={agents}
                  layout="vertical"
                  margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fill: "#6b6b6b", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={78}
                    tick={{ fill: "#3d3d3d", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <Tooltip contentStyle={tipStyle} />
                  <Bar dataKey="value" fill="#2563eb" radius={[0, 2, 2, 0]} isAnimationActive animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </ChartCard>

      <ChartCard title="Retry / waste">
        <div className="grid grid-cols-2 gap-1 h-full min-h-[120px]">
          {retries.length ? (
            <div className="relative h-full min-h-[110px]">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                    <Pie
                      data={retries}
                      dataKey="value"
                      nameKey="name"
                      outerRadius="70%"
                      isAnimationActive
                      animationDuration={600}
                    >
                      {retries.map((_, i) => (
                        <Cell key={i} fill={COLORS[(i + 1) % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <Empty />
          )}
          {waste.length ? (
            <div className="relative h-full min-h-[110px]">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={waste}
                    layout="vertical"
                    margin={{ top: 4, right: 10, left: 2, bottom: 4 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={70}
                      tick={{ fill: "#3d3d3d", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <Tooltip contentStyle={tipStyle} />
                    <Bar dataKey="value" fill="#e11d7a" radius={[0, 2, 2, 0]} isAnimationActive animationDuration={600} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <Empty />
          )}
        </div>
      </ChartCard>
    </div>
  );
}

const tipStyle = {
  background: "#ffffff",
  border: "1px solid #0a0a0a",
  fontSize: 11,
  borderRadius: 2,
  color: "#0a0a0a",
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line-soft rounded-sm bg-surface p-2 min-h-0 flex flex-col overflow-hidden h-full">
      <div className="label-caps mb-1 shrink-0">{title}</div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full min-h-[100px] flex items-center justify-center text-[10px] text-ink-faint border border-dashed border-line-soft rounded-sm">
      seeding…
    </div>
  );
}
