// ─── Kitchen Analytics — the ML/statistical analytics tab for the stall terminal.
// Pure consumer of `computeKitchenAnalytics()` (src/kitchenAnalytics.js). Every number rendered
// here is derived from real Firestore order history; forecasts are labeled as predictions and
// never presented as fact. Uses the same `t` theme tokens as the rest of the terminal.
//
// UX rules this page follows:
//   · Decision layer first — the "what do I do with this" cards come before the raw numbers.
//   · Big numbers, small labels — a staff member reads the summary from across the room.
//   · Plain language over math — "Very Busy" instead of "P90 percentile", "Next 30 min"
//     instead of "EWMA forecast". Model names live only in the collapsed Methodology section.
//   · Progressive disclosure — deep analysis (heatmap, methodology) is collapsed until asked.
//   · Every chart carries visible value labels or a title tooltip (never color-only).
//   · Color always reinforced by words + icons (WCAG, and readability for color-blind staff).
import { Fragment } from "react";
import { money } from "./helpers";
import { FlameIcon } from "./icons";

// ─── Status pills (light/dark) ───────────────────────────────────────────────
const STATUS_PILL = {
  ready: (t) =>
    t.dark ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-emerald-600/40 bg-emerald-600/10 text-emerald-700",
  insufficient_data: (t) =>
    t.dark ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-amber-600/40 bg-amber-600/10 text-amber-700",
  no_data: (t) =>
    t.dark ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-red-600/40 bg-red-600/10 text-red-700",
};

// ─── Semantic tones (shared by stat cards, bands, accents) ──────────────────
const TONES = {
  green: { text: (t) => (t.dark ? "text-emerald-300" : "text-emerald-600"), bar: "bg-emerald-500" },
  amber: { text: (t) => (t.dark ? "text-amber-300" : "text-amber-600"), bar: "bg-amber-500" },
  orange: { text: (t) => (t.dark ? "text-orange-300" : "text-orange-600"), bar: "bg-orange-500" },
  red: { text: (t) => (t.dark ? "text-red-300" : "text-red-600"), bar: "bg-red-500" },
  accent: {
    text: (t) => (t.dark ? "text-[#37c8be]" : "text-[#ef6f2e]"),
    bar: (t) => (t.dark ? "bg-[#37c8be]" : "bg-[#ef6f2e]"),
  },
};

const toneBar = (t, tone) => (typeof tone.bar === "function" ? tone.bar(t) : tone.bar);
const fmtNum = (v) => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmt12 = (hour) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour >= 12 ? "PM" : "AM"}`;
const peakRangeLabel = (hour) => `${fmt12(hour)} – ${fmt12((hour + 1) % 24)}`;

// ─── Minimal stroke icons (match ./icons.jsx style) ─────────────────────────
const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
    {children}
  </svg>
);
const TrendIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l5-6 4 3 6-8M14 6h5v5" />
  </Icon>
);
const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
  </Icon>
);
const StackIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4" />
  </Icon>
);
const TargetIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
  </Icon>
);
const CalendarIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="1" />
    <path strokeLinecap="round" d="M8 3v4M16 3v4M3 10h18" />
  </Icon>
);
const FlaskIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18L14 9V3" />
  </Icon>
);
const ListIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

// ─── Panel shell with section header ────────────────────────────────────────
function Panel({ t, icon, title, right, hint, children }) {
  return (
    <section className={`border p-5 ${t.panel}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 ${t.accent}`}>{icon}</span>
          <div>
            <h3 className={`text-[10px] font-bold uppercase tracking-[0.3em] ${t.labelStrong}`}>{title}</h3>
            {hint && <p className={`mt-1 text-[10px] leading-snug ${t.label}`}>{hint}</p>}
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      {children}
    </section>
  );
}

// ─── Big-number stat card ────────────────────────────────────────────────────
function StatCard({ t, label, value, sub, tone }) {
  return (
    <div className={`relative overflow-hidden border p-3 ${t.panel}`}>
      <div className={`absolute inset-x-0 top-0 h-0.5 ${tone ? toneBar(t, tone) : "bg-transparent"}`} />
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>{label}</p>
      <p className={`mt-1.5 text-2xl font-bold leading-none tracking-tight ${tone ? tone.text(t) : t.heading}`}>{value}</p>
      {sub && <p className={`mt-1 text-[9px] uppercase tracking-wider ${t.label}`}>{sub}</p>}
    </div>
  );
}

// ─── Column chart with visible value labels (AAA) ───────────────────────────
function ColumnChart({ t, data, valueOf, labelOf, formatOf }) {
  if (!data.length) return <EmptyNote t={t} text="No data yet" />;
  const max = Math.max(1, ...data.map((d) => valueOf(d)));
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5">
        {data.map((d, i) => {
          const value = valueOf(d);
          const isZero = value <= 0;
          const pct = Math.max(isZero ? 4 : 10, (value / max) * 100);
          return (
            <div key={i} className="group flex min-w-0 flex-1 flex-col items-center justify-end self-stretch">
              <span className={`mb-0.5 text-[8px] font-bold tabular-nums ${isZero ? t.label : t.heading}`}>
                {isZero ? "" : formatOf(value)}
              </span>
              <div
                title={`${labelOf(d)} — ${formatOf(value)}`}
                className={`w-full ${isZero ? `${t.dark ? "bg-white/5" : "bg-black/5"} border ${t.headerBorder}` : toneBar(t, TONES.accent)} transition-colors duration-150 group-hover:opacity-80`}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <span key={i} className={`min-w-0 flex-1 text-center text-[8px] uppercase tracking-wider ${t.label}`}>
            {labelOf(d)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Horizontal ranking bars (always-sorted, value labels) ─────────────────
function RankBars({ t, items }) {
  if (!items.length) return <EmptyNote t={t} text="No recent orders yet" />;
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="space-y-4">
      {items.map((item, idx) => (
        <div key={item.name}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className={`flex min-w-0 items-baseline gap-2 truncate text-sm font-semibold ${t.heading}`}>
              <span className={`text-[9px] font-bold tabular-nums ${idx === 0 ? t.accent : t.label}`}>{idx + 1}</span>
              <span className="truncate">{item.name}</span>
            </span>
            <span className={`shrink-0 text-sm font-bold tabular-nums ${item.emphasis ? t.accent : t.heading}`}>{item.value}</span>
          </div>
          <div className={`relative h-2.5 w-full overflow-hidden rounded-sm ${t.dark ? "bg-white/10" : "bg-black/10"}`}>
            <div
              className={`absolute inset-y-0 left-0 ${item.tone ? toneBar(t, item.tone) : toneBar(t, TONES.accent)}`}
              style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
              title={item.title || item.name}
            />
          </div>
          {item.caption && <p className={`mt-1 text-[9px] uppercase tracking-wider ${t.label}`}>{item.caption}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Decision cards (the "what should I do" layer) ──────────────────────────
function LoadCard({ t, loadPct }) {
  const band = loadPct < 40 ? TONES.green : loadPct < 70 ? TONES.amber : loadPct < 90 ? TONES.orange : TONES.red;
  const label = loadPct < 40 ? "Normal" : loadPct < 70 ? "Getting Busy" : loadPct < 90 ? "Very Busy" : "High Load";
  return (
    <div className={`border p-4 ${t.panel}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Kitchen Load</p>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${band.text(t)}`}>
          <span className={`h-2 w-2 rounded-full ${band.bar}`} /> {label}
        </span>
      </div>
      <p className={`mt-3 text-3xl font-bold leading-none tabular-nums ${band.text(t)}`}>{loadPct}%</p>
      <p className={`mt-1 text-[9px] uppercase tracking-wider ${t.label}`}>capacity in use right now</p>
      <div className={`mt-3 h-2 w-full overflow-hidden rounded-sm ${t.dark ? "bg-white/10" : "bg-black/10"}`}>
        <div className={`h-full ${band.bar}`} style={{ width: `${Math.min(100, loadPct)}%` }} />
      </div>
    </div>
  );
}

function Next30Card({ t, next30min }) {
  const high = Boolean(next30min?.highDemand);
  const enabled = Boolean(next30min?.enabled);
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Next 30 Min</p>
      <p className={`mt-3 text-3xl font-bold leading-none tabular-nums ${t.heading}`}>~{next30min?.orders ?? 0}</p>
      <p className={`mt-1 text-[9px] uppercase tracking-wider ${t.label}`}>orders expected</p>
      <span
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
          high ? TONES.orange.text(t) + " border-current/30 bg-current/10" : enabled ? TONES.green.text(t) + " border-current/30 bg-current/10" : `${t.label} border-current/30 bg-current/10`
        }`}
      >
        {high ? "🔥 High demand — prep now" : enabled ? "Quiet ahead" : "Estimating"}
      </span>
    </div>
  );
}

function BusyCard({ t, busyLabel }) {
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Busy Time</p>
      {busyLabel ? (
        <>
          <p className={`mt-3 text-2xl font-bold leading-none tabular-nums ${t.heading}`}>{busyLabel}</p>
          <p className={`mt-1 text-[9px] uppercase tracking-wider ${t.label}`}>peak rush today</p>
          <p className={`mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest ${t.accent}`}>
            <FlameIcon filled /> prepare extra food
          </p>
        </>
      ) : (
        <EmptyNote t={t} text="No peak data yet" />
      )}
    </div>
  );
}

function PrepareCard({ t, prepareMore }) {
  const { items = [], enabled = false, totalRecent = 0 } = prepareMore || {};
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Prepare More</p>
      {items.length ? (
        <ul className="mt-3 space-y-2.5">
          {items.map((item, idx) => (
            <li key={item.name} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={`text-[9px] font-bold tabular-nums ${idx === 0 ? t.accent : t.label}`}>{idx + 1}</span>
                <span className={`truncate text-sm font-semibold ${t.heading}`}>{item.name}</span>
              </span>
              <span className={`shrink-0 text-xs font-bold tabular-nums ${t.accent}`}>
                {item.expected != null ? `~${item.expected} in 30m` : `${item.recentCount} recent`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote t={t} text={enabled ? "No recent orders yet" : "Insufficient data for a forecast"} />
      )}
      {totalRecent > 0 && (
        <p className={`mt-3 border-t pt-2 text-[9px] uppercase tracking-wider ${t.divider} ${t.label}`}>based on the last {totalRecent} orders</p>
      )}
    </div>
  );
}

// ─── Orders today chart with peak annotation ────────────────────────────────
function TodayChart({ t, hourlyCounts, now, busyLabel }) {
  const currentHour = now.getHours();
  const bars = hourlyCounts.filter((cell) => cell.hour >= 7 && cell.hour <= Math.max(7, currentHour));
  const max = Math.max(1, ...bars.map((cell) => cell.count));
  const peak = bars.reduce((best, cell) => (cell.count > (best?.count ?? -1) ? cell : best), null);
  const total = bars.reduce((sum, cell) => sum + cell.count, 0);

  if (!total) {
    return <EmptyNote t={t} text="No orders placed yet today — the chart fills in as orders come in" />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm font-bold tabular-nums ${t.heading}`}>
          {total} <span className={`text-[10px] font-normal uppercase tracking-wider ${t.labelStrong}`}>orders so far</span>
        </p>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${t.accent}`}>
          <FlameIcon filled />
          {busyLabel || "Peak not yet clear"}
        </div>
      </div>
      <div className="flex h-40 items-end gap-1.5">
        {bars.map((cell) => {
          const isPeak = peak && cell.hour === peak.hour;
          const pct = Math.max(cell.count > 0 ? 12 : 5, (cell.count / max) * 100);
          return (
            <div key={cell.hour} className="group flex min-w-0 flex-1 flex-col items-center justify-end self-stretch">
              {isPeak && <FlameIcon filled />}
              <span className={`mb-0.5 text-[8px] font-bold tabular-nums ${cell.count ? t.heading : t.label}`}>
                {cell.count ? cell.count : ""}
              </span>
              <div
                title={`${peakRangeLabel(cell.hour)} — ${cell.count} orders`}
                className={`w-full ${cell.count ? toneBar(t, TONES.accent) : `${t.dark ? "bg-white/5" : "bg-black/5"} border ${t.headerBorder}`}`}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {bars.map((cell) => (
          <span key={cell.hour} className={`min-w-0 flex-1 text-center text-[8px] uppercase tracking-wider ${t.label}`}>
            {cell.hour % 3 === 0 ? peakRangeLabel(cell.hour).split(" – ")[0] : " "}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Forecast: actual vs predicted ──────────────────────────────────────────
function ForecastChart({ t, nextHours }) {
  const { actuals, predictions } = nextHours;
  const actualByHour = new Map(actuals.map((a) => [a.hour, a.actual]));
  const predByHour = new Map(predictions.map((p) => [p.hour, p]));
  const histByHour = new Map(predictions.map((p) => [p.hour, p.historicalAvg]));

  const startHour = 7;
  const endHour = 21;
  const series = [];
  for (let h = startHour; h <= endHour; h++) {
    series.push({ hour: h, actual: actualByHour.get(h) ?? null, predicted: predByHour.get(h) ?? null, historicalAvg: histByHour.get(h) ?? null });
  }

  const allValues = series.flatMap((s) => [s.actual, s.predicted, s.historicalAvg]).filter((v) => v != null);
  if (!allValues.length) return <EmptyNote t={t} text="Not enough history for a forecast yet" />;

  const maxVal = Math.max(1, ...allValues);
  const W = 100;
  const H = 40;
  const x = (hour) => ((hour - startHour) / (endHour - startHour)) * W;
  const y = (v) => H - (v / maxVal) * (H - 6) - 2;

  const actualPoints = series.filter((s) => s.actual != null).map((s) => `${x(s.hour)},${y(s.actual)}`).join(" ");
  const predPoints = series.filter((s) => s.predicted != null).map((s) => `${x(s.hour)},${y(s.predicted)}`).join(" ");
  const histPoints = series.filter((s) => s.historicalAvg != null).map((s) => `${x(s.hour)},${y(s.historicalAvg)}`).join(" ");

  const solid = t.dark ? "#37c8be" : "#ef6f2e";
  const dashed = t.dark ? "#8ab4c4" : "#8a6d5c";
  const dotted = t.dark ? "#37c8be55" : "#ef6f2e55";

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Forecast: actual vs predicted orders by hour" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line key={frac} x1="0" x2={W} y1={y(maxVal * frac)} y2={y(maxVal * frac)} stroke={t.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"} strokeWidth="0.3" />
        ))}
        {histPoints && <polyline points={histPoints} fill="none" stroke={dotted} strokeWidth="1" strokeDasharray="1.5 1.5" />}
        {actualPoints && <polyline points={actualPoints} fill="none" stroke={solid} strokeWidth="1.6" />}
        {predPoints && <polyline points={predPoints} fill="none" stroke={dashed} strokeWidth="1.6" strokeDasharray="3 2" />}
      </svg>
      <div className={`mt-1 flex items-center justify-between text-[8px] uppercase tracking-wider ${t.label}`}>
        <span>7:00 AM</span>
        <span>12:00 PM</span>
        <span>10:00 PM</span>
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] uppercase tracking-wider ${t.labelStrong}`}>
        <span className="flex items-center gap-1.5"><span className={`inline-block h-0.5 w-5 ${toneBar(t, TONES.accent)}`} /> Today (actual)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: dashed }} /> Forecast</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ borderTop: `1px dashed ${dotted}` }} /> Typical day</span>
      </div>
    </div>
  );
}

// ─── Workload this hour (bullet scale, plain-language bands) ────────────────
function WorkloadPanel({ t, workload }) {
  const current = workload.current;
  const next = workload.expectedNextHour;
  const thresholds = current.thresholds || { p50: 0, p75: 0, p90: 0 };
  const max = Math.max(1, thresholds.p90, current.ordersThisHour);

  const bands = [
    { label: "Quiet", low: 0, high: thresholds.p50, tone: TONES.green },
    { label: "Typical", low: thresholds.p50, high: thresholds.p75, tone: TONES.amber },
    { label: "Busy", low: thresholds.p75, high: thresholds.p90, tone: TONES.orange },
    { label: "Very Busy", low: thresholds.p90, high: max, tone: TONES.red },
  ];
  const markerLeft = `${(current.ordersThisHour / max) * 100}%`;

  const delta = current.deltaPct;
  const deltaTone = delta != null ? (delta >= 0 ? TONES.orange : TONES.green) : null;

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-4">
        <div>
          <p className={`text-[9px] uppercase tracking-widest ${t.labelStrong}`}>Orders this hour</p>
          <p className={`mt-1 text-3xl font-bold leading-none tabular-nums ${t.heading}`}>{current.ordersThisHour}</p>
        </div>
        <div>
          <p className={`text-[9px] uppercase tracking-widest ${t.labelStrong}`}>Typical by now</p>
          <p className={`mt-1 text-2xl font-bold leading-none tabular-nums ${t.labelStrong}`}>~{fmtNum(current.expectedSoFar)}</p>
        </div>
        <div>
          <p className={`text-[9px] uppercase tracking-widest ${t.labelStrong}`}>Pace vs typical</p>
          <p className={`mt-1 text-2xl font-bold leading-none tabular-nums ${deltaTone ? deltaTone.text(t) : t.label}`}>
            {delta != null ? `${delta >= 0 ? "+" : ""}${Math.round(delta)}%` : "—"}
          </p>
        </div>
        <div>
          <p className={`text-[9px] uppercase tracking-widest ${t.labelStrong}`}>Next hour</p>
          <p className={`mt-1 flex items-baseline gap-2 text-2xl font-bold leading-none tabular-nums ${t.heading}`}>
            ~{next.predicted}
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                current.level === "VERY_HIGH" ? TONES.red.text(t) + " border-current/30 bg-current/10" : current.level === "HIGH" ? TONES.orange.text(t) + " border-current/30 bg-current/10" : current.level === "MODERATE" ? TONES.amber.text(t) + " border-current/30 bg-current/10" : TONES.green.text(t) + " border-current/30 bg-current/10"
              }`}
            >
              {next.levelLabel}
            </span>
          </p>
        </div>
      </div>

      <div className={`relative h-4 w-full overflow-hidden rounded-sm ${t.dark ? "bg-white/10" : "bg-black/10"}`}>
        <div className="absolute inset-0 flex">
          {bands.map((band) => (
            <div
              key={band.label}
              className={`${band.tone.bar} opacity-40`}
              style={{ width: `${((band.high - band.low) / max) * 100}%` }}
              title={`${band.label}: ${band.low.toFixed(0)}–${band.high.toFixed(0)} orders`}
            />
          ))}
        </div>
        <div className={`absolute inset-y-0 w-[3px] ${t.accentBg}`} style={{ left: markerLeft }} title={`Now: ${current.ordersThisHour} orders this hour`} />
      </div>
      <div className="mt-1.5 flex">
        {bands.map((band) => (
          <span key={band.label} className={`truncate text-[8px] uppercase tracking-wider ${t.label}`} style={{ width: `${((band.high - band.low) / max) * 100}%` }}>
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Heatmap: average orders per weekday × hour ─────────────────────────────
function Heatmap({ t, heatmap }) {
  const allAvgs = heatmap.flatMap((day) => day.hours.map((h) => h.avg));
  const max = Math.max(1, ...allAvgs);
  const accent = t.dark ? "55,200,190" : "239,111,46";
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[70px_repeat(24,1fr)] gap-px">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className={`text-center text-[7px] uppercase ${t.label}`}>
              {h % 3 === 0 ? (h >= 12 ? `${h % 12 || 12}p` : `${h % 12 || 12}a`) : ""}
            </div>
          ))}
          {heatmap.map((day) => (
            <Fragment key={day.day}>
              <div className={`flex items-center pr-1 text-[8px] uppercase tracking-wide ${t.labelStrong}`}>
                {day.label.slice(0, 3)}
              </div>
              {day.hours.map((cell) => {
                const intensity = cell.avg / max;
                return (
                  <div
                    key={cell.hour}
                    title={`${day.label} ${cell.hour}:00 — avg ${cell.avg.toFixed(1)} orders`}
                    className="h-4"
                    style={{
                      backgroundColor: cell.avg > 0 ? `rgba(${accent},${0.08 + intensity * 0.82})` : "transparent",
                      border: `1px solid ${t.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}`,
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        <p className={`mt-2 text-[9px] uppercase tracking-wider ${t.label}`}>
          Shading = average orders for that weekday + hour. Hover any cell for the number.
        </p>
      </div>
    </div>
  );
}

// ─── Reusable empty state ────────────────────────────────────────────────────
function EmptyNote({ t, text }) {
  return (
    <p className={`border py-8 text-center text-[10px] uppercase tracking-widest ${t.panelAlt} ${t.label}`}>{text}</p>
  );
}

// ─── Collapsible section (progressive disclosure) ───────────────────────────
function Disclosure({ t, icon, title, children, defaultOpen = false }) {
  return (
    <details open={defaultOpen} className="group">
      <summary className={`flex cursor-pointer list-none items-center gap-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.3em] ${t.labelStrong} [&::-webkit-details-marker]:hidden`}>
        <span className={t.accent}>{icon}</span>
        <span>{title}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="ml-auto h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className={`mt-3 border-t pt-4 ${t.divider}`}>{children}</div>
    </details>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────
export default function KitchenAnalytics({ t, analytics, now, boardCount, queueMetrics }) {
  const { status, statusMessage, dataSufficiency, historical, workload, forecast, next30min, today, prepareMore } = analytics;
  const statusLabel =
    status === "ready" ? "Forecast on" : status === "insufficient_data" ? "Insufficient data" : "No data yet";

  const todaySafe = today || { orderCount: 0, sales: 0, avgWaitMin: null, waitSamples: 0, hourlyCounts: [] };
  const nextSafe = next30min || { enabled: false, orders: 0, highDemand: false };

  const livePeakHour = todaySafe.hourlyCounts.reduce((best, cell) => (cell.count > (best?.count ?? -1) ? cell : best), null);
  const busyLabel =
    livePeakHour?.count > 0
      ? peakRangeLabel(livePeakHour.hour)
      : forecast.expectedPeakToday?.label || historical.peakHourByAvg?.label || null;

  const loadPct = Math.min(100, Math.round((queueMetrics?.utilization ?? 0) * 100));

  const rankItems = (prepareMore?.items || []).map((item, idx) => ({
    name: item.name,
    value: item.recentCount,
    caption: item.expected != null ? `~${item.expected} more expected in the next 30 min` : "ordered in the last 90 min",
    tone: idx === 0 ? TONES.accent : null,
    title: `${item.name} — ${item.recentCount} recent orders${item.expected != null ? `, ~${item.expected} expected next` : ""}`,
  }));

  const hourItems = historical.ordersByHour.map((d) => ({
    name: d.label.split(" – ")[0],
    value: d.avg,
    title: `${d.label} — ${fmtNum(d.avg)} orders/hour avg`,
  }));
  const dayItems = historical.ordersByWeekday.map((d) => ({
    name: d.label.slice(0, 3),
    value: d.avg,
    title: `${d.label} — ${fmtNum(d.avg)} orders/day avg across ${d.days} weeks`,
  }));

  const hasHistory = dataSufficiency.historicalOrders > 0;

  return (
    <div className="space-y-6">
      {/* ─── Page header + summary strip (decision layer) ─────────────────── */}
      <section className={`border p-5 ${t.panelElevated}`}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={`text-xs font-bold uppercase tracking-[0.35em] ${t.heading}`}>Kitchen Analytics</h2>
            <p className={`mt-1 text-[10px] ${t.label}`}>
              Real numbers from this stall's order history — what today looks like, and what's coming next.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1.5 text-[9px] uppercase tracking-widest ${t.label}`}>
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${t.accentBg}`} />
              Live &middot; {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest ${STATUS_PILL[status](t)}`}>
              {statusLabel}
            </span>
          </div>
        </header>

        {(status === "no_data" || status === "insufficient_data") && (
          <div className={`mb-5 border p-3 text-xs ${t.dark ? "border-amber-400/30 bg-amber-400/5 text-amber-300" : "border-amber-500/30 bg-amber-500/5 text-amber-700"}`}>
            {statusMessage}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard t={t} label="Orders Today" value={todaySafe.orderCount} sub="live so far" />
          <StatCard t={t} label="Sales Today" value={money(todaySafe.sales)} sub="this stall" tone={TONES.accent} />
          <StatCard t={t} label="Avg Wait" value={todaySafe.avgWaitMin != null ? `~${Math.round(todaySafe.avgWaitMin)} min` : "--"} sub={`${todaySafe.waitSamples} orders measured`} />
          <StatCard t={t} label="Busy Time" value={busyLabel ? busyLabel.replace(" – ", "–") : "--"} sub="peak rush today" tone={TONES.orange} />
          <StatCard t={t} label="Next 30 Min" value={`~${nextSafe.orders}`} sub={nextSafe.highDemand ? "🔥 high demand" : "orders expected"} tone={nextSafe.highDemand ? TONES.red : TONES.green} />
          <StatCard t={t} label="On Board" value={boardCount} sub="active right now" />
        </div>
      </section>

      {/* ─── Decision cards ───────────────────────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <LoadCard t={t} loadPct={loadPct} />
        <Next30Card t={t} next30min={nextSafe} />
        <BusyCard t={t} busyLabel={busyLabel} />
        <PrepareCard t={t} prepareMore={prepareMore} />
      </section>

      {/* ─── Today's trend + top items ────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Panel
          t={t}
          icon={<TrendIcon />}
          title="Orders Today"
          hint="One glance at the rush — the flame marks the busiest hour."
        >
          <TodayChart t={t} hourlyCounts={todaySafe.hourlyCounts} now={now} busyLabel={busyLabel} />
        </Panel>

        <Panel
          t={t}
          icon={<StackIcon />}
          title="Top Items — Last 90 Min"
          hint="What's selling right now. The next-30-min expectation helps you prep ahead."
        >
          <RankBars t={t} items={rankItems} />
        </Panel>
      </section>

      {/* ─── Forecast + workload ──────────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Panel
          t={t}
          icon={<TrendIcon />}
          title="Forecast — Next Hours"
          hint="Dashed line = model prediction. Compare it against today's actuals."
          right={
            forecast.enabled ? (
              <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest ${t.dark ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-emerald-600/40 bg-emerald-600/10 text-emerald-700"}`}>
                {forecast.confidenceLabel}
              </span>
            ) : null
          }
        >
          <ForecastChart t={t} nextHours={forecast.nextHours} />
        </Panel>

        <Panel
          t={t}
          icon={<TargetIcon />}
          title="Workload This Hour"
          hint="How this hour compares to a typical one — the marker shows where you are now."
        >
          {hasHistory ? (
            <WorkloadPanel t={t} workload={workload} />
          ) : (
            <EmptyNote t={t} text="Gathering history before this comparison is available" />
          )}
        </Panel>
      </section>

      {/* ─── Historical trends (deep dive) ────────────────────────────────── */}
      {hasHistory && (
        <section className={`border p-5 ${t.panel}`}>
          <header className="mb-4 flex items-center gap-2.5">
            <span className={t.accent}>
              <ClockIcon />
            </span>
            <div>
              <h3 className={`text-[10px] font-bold uppercase tracking-[0.3em] ${t.labelStrong}`}>Typical Pattern</h3>
              <p className={`mt-1 text-[10px] ${t.label}`}>
                Averages across {dataSufficiency.daysCovered} days of history ({dataSufficiency.historicalOrders} orders).
              </p>
            </div>
          </header>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className={`mb-2 text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Orders by Hour</p>
              <ColumnChart t={t} data={hourItems} valueOf={(d) => d.value} labelOf={(d) => d.name} formatOf={fmtNum} />
            </div>
            <div>
              <p className={`mb-2 text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Orders by Day</p>
              <ColumnChart t={t} data={dayItems} valueOf={(d) => d.value} labelOf={(d) => d.name} formatOf={fmtNum} />
            </div>
            <div className="md:col-span-2 xl:col-span-1">
              <p className={`mb-3 text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Meal Periods</p>
              <RankBars
                t={t}
                items={historical.ordersByMealPeriod.map((p, idx) => ({
                  name: `${p.label} (${p.rangeLabel})`,
                  value: p.avgPerDay,
                  caption: `avg ${p.avgPerDay.toFixed(1)} orders/day`,
                  tone: idx === 0 ? TONES.accent : null,
                  title: `${p.rangeLabel} — avg ${p.avgPerDay.toFixed(1)} orders/day`,
                }))}
              />
            </div>
          </div>
        </section>
      )}

      {/* ─── Progressive disclosure: heatmap + methodology ────────────────── */}
      <section className={`border p-5 ${t.panel}`}>
        <div className="space-y-2">
          <Disclosure t={t} icon={<CalendarIcon />} title="Week × Hour Activity">
            <Heatmap t={t} heatmap={historical.heatmap} />
          </Disclosure>
          <Disclosure t={t} icon={<FlaskIcon />} title="How this is calculated">
            <div className={`max-w-3xl space-y-2 text-[11px] leading-relaxed ${t.body}`}>
              <p>
                Everything above comes from this stall's real Firestore order history. Orders from the
                current day are treated as <strong>live</strong>; everything older is <strong>history</strong>,
                so a half-finished day never skews the averages.
              </p>
              <p>
                <strong>Peak &amp; patterns</strong> — plain averages grouped by hour, weekday and meal
                period, zero-filled so quiet hours count as real zeros.
              </p>
              <p>
                <strong>Workload</strong> — each hour's order volume is compared against its own historical
                range. "Quiet / Typical / Busy / Very Busy" are the lower half, middle, upper-middle and top
                of that range. The current hour is scaled by how much of it has elapsed, so you see whether
                you're on pace — not a misleading partial-hour count.
              </p>
              <p>
                <strong>Forecast</strong> — a seasonal exponential smoothing model (EWMA) that remembers the
                pattern for this day type and hour, with a trend adjustment, validated by walking forward
                through history. Reported accuracy:{" "}
                {forecast.modelMae != null ? `MAE ${forecast.modelMae.toFixed(1)} orders/hour (${forecast.method === "seasonal-ewma" ? "exponential smoothing won" : "simple average baseline kept"})` : "not yet available"}. Never treated as fact — it's a guide.
              </p>
              <p>
                <strong>Prepare More</strong> — items ranked by real order frequency over the last 90
                minutes, then the next-30-min forecast is shared across them proportionally.
              </p>
            </div>
          </Disclosure>
        </div>
      </section>
    </div>
  );
}
