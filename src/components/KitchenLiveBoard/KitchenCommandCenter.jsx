import { money, orderCreatedMs } from "./helpers";
import CommandOrderCard from "./CommandOrderCard";

// ─── Kitchen Command Center — the "board" view of the stall terminal ───────
// Designed around the three operational layers a kitchen actually works in:
//
//   LAYER 1 · NOW   → big color-coded counts (to make / making / ready) + wait time
//   LAYER 2 · NEXT  → active order cards with one obvious action per card
//   LAYER 3 · INSIGHT → decision cards (next 30 min, busy time, kitchen load,
//                       "what should I prepare?") + today's orders-over-time chart
//
// Every number here is derived from real Firestore orders via the analytics engine —
// staff see the decision, not the algorithm. The deep ML/statistical panels live on
// the dedicated "Kitchen Analytics" tab.

const TONES = {
  green: {
    pill: (t) => (t.dark ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"),
    bar: "bg-emerald-500",
    text: (t) => (t.dark ? "text-emerald-300" : "text-emerald-600"),
  },
  amber: {
    pill: (t) => (t.dark ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-amber-500/40 bg-amber-500/10 text-amber-600"),
    bar: "bg-amber-500",
    text: (t) => (t.dark ? "text-amber-300" : "text-amber-600"),
  },
  orange: {
    pill: (t) => (t.dark ? "border-orange-400/40 bg-orange-400/10 text-orange-300" : "border-orange-500/40 bg-orange-500/10 text-orange-600"),
    bar: "bg-orange-500",
    text: (t) => (t.dark ? "text-orange-300" : "text-orange-600"),
  },
  red: {
    pill: (t) => (t.dark ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-red-500/40 bg-red-500/10 text-red-600"),
    bar: "bg-red-500",
    text: (t) => (t.dark ? "text-red-300" : "text-red-600"),
  },
  accent: {
    pill: (t) => (t.dark ? "border-[#37c8be]/40 bg-[#37c8be]/10 text-[#37c8be]" : "border-[#ef6f2e]/40 bg-[#ef6f2e]/10 text-[#ef6f2e]"),
    bar: (t) => (t.dark ? "bg-[#37c8be]" : "bg-[#ef6f2e]"),
    text: (t) => (t.dark ? "text-[#37c8be]" : "text-[#ef6f2e]"),
  },
};

function loadBand(pct) {
  if (pct < 40) return { label: "NORMAL", tone: "green", ...TONES.green };
  if (pct < 70) return { label: "BUSY", tone: "amber", ...TONES.amber };
  if (pct < 90) return { label: "VERY BUSY", tone: "orange", ...TONES.orange };
  return { label: "HIGH LOAD", tone: "red", ...TONES.red };
}

const fmt12 = (hour) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour >= 12 ? "PM" : "AM"}`;
const peakRangeLabel = (hour) => `${fmt12(hour)} – ${fmt12((hour + 1) % 24)}`;

function ZoneTitle({ t, children, right }) {
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3 ${t.divider}`}>
      <p className={`text-[10px] font-bold uppercase tracking-[0.3em] ${t.labelStrong}`}>{children}</p>
      {right}
    </div>
  );
}

function toneBar(t, tone) {
  return typeof tone.bar === "function" ? tone.bar(t) : tone.bar;
}

function StatusZone({ t, pending, preparing, ready, waitMin, load, isPaused }) {
  const stats = [
    { label: "To Make", value: pending, tone: TONES.red },
    { label: "Making", value: preparing, tone: TONES.amber },
    { label: "Ready", value: ready, tone: TONES.green },
    { label: "Avg Wait", value: waitMin != null ? `~${waitMin}m` : "--", tone: TONES.accent },
  ];
  return (
    <section className={`border p-5 ${t.panelElevated}`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className={`text-[11px] font-bold uppercase tracking-[0.35em] ${t.heading}`}>Kitchen Status</p>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${load.pill(t)}`}>
            <span className={`h-2 w-2 rounded-full ${load.bar} ${load.tone === "red" ? "animate-pulse" : ""}`} />
            {load.label}
          </span>
          {isPaused ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Paused
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${t.dark ? "text-emerald-300" : "text-emerald-600"}`}>
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Open
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className={`relative overflow-hidden border p-4 ${t.panel}`}>
            <div className={`absolute inset-x-0 top-0 h-0.5 ${toneBar(t, stat.tone)}`} />
            <p className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${toneBar(t, stat.tone)}`} />
              {stat.label}
            </p>
            <p className={`mt-2 text-4xl font-bold leading-none tracking-tight ${stat.tone.text(t)}`}>{stat.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActiveOrdersZone({ t, orders, now, onAdvance, updatingOrderId }) {
  const ranked = [...orders].sort((a, b) => {
    const prio = { pending: 0, preparing: 1, ready: 2 };
    const diff = (prio[a.status] ?? 3) - (prio[b.status] ?? 3);
    return diff !== 0 ? diff : orderCreatedMs(a) - orderCreatedMs(b);
  });

  return (
    <section className="mt-8">
      <ZoneTitle t={t}>
        Active Orders <span className={t.label}>({orders.length})</span>
      </ZoneTitle>
      {orders.length === 0 ? (
        <div className={`border py-16 text-center text-[10px] uppercase tracking-[0.35em] ${t.panelAlt} ${t.label}`}>
          No active orders — the kitchen is clear
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {ranked.map((order) => (
            <CommandOrderCard
              key={order.id}
              t={t}
              order={order}
              now={now}
              onAdvance={onAdvance}
              isUpdating={updatingOrderId === order.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KitchenLoadCard({ t, loadPct, band, prepCapacity, onPrepCapacityChange, isSavingCapacity }) {
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Kitchen Load</p>
      <div className="mt-3">
        <div className={`relative h-3 w-full overflow-hidden rounded-sm ${t.dark ? "bg-white/10" : "bg-black/10"}`}>
          <div
            className={`absolute inset-y-0 left-0 ${band.bar}`}
            style={{ width: `${Math.min(100, loadPct)}%` }}
          />
        </div>
        <div className="mt-2 flex items-end justify-between">
          <span className={`text-2xl font-bold leading-none ${band.text(t)}`}>{loadPct}%</span>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${band.pill(t)} rounded-full border px-2 py-0.5`}>
            {band.label}
          </span>
        </div>
      </div>
      <div className={`mt-4 flex items-center justify-between gap-2 border-t pt-3 ${t.divider}`}>
        <label className={`text-[9px] uppercase tracking-widest ${t.labelStrong}`}>Prep Slots</label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPrepCapacityChange(Math.max(1, prepCapacity - 1))}
            disabled={isSavingCapacity || prepCapacity <= 1}
            className={`border px-2 py-0.5 text-xs font-bold disabled:opacity-30 ${t.headerBorder} ${t.body}`}
          >
            −
          </button>
          <span className={`w-8 text-center text-sm font-bold ${t.heading}`}>{prepCapacity}</span>
          <button
            onClick={() => onPrepCapacityChange(prepCapacity + 1)}
            disabled={isSavingCapacity || prepCapacity >= 10}
            className={`border px-2 py-0.5 text-xs font-bold disabled:opacity-30 ${t.headerBorder} ${t.body}`}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function Next30MinCard({ t, next30min }) {
  const high = Boolean(next30min?.highDemand);
  const enabled = Boolean(next30min?.enabled);
  const orders = next30min?.orders ?? 0;
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Next 30 Min</p>
      <p className={`mt-3 text-2xl font-bold leading-none ${t.heading}`}>~{orders} orders</p>
      <p className={`mt-2 text-[10px] ${t.label}`}>expected in the next half hour</p>
      <span
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
          high ? (t.dark ? "border-orange-400/40 bg-orange-400/10 text-orange-300" : "border-orange-500/40 bg-orange-500/10 text-orange-600") : TONES.green.pill(t)
        }`}
      >
        {high ? "🔥 High Demand" : enabled ? "Quiet" : "Estimating"}
      </span>
    </div>
  );
}

function BusyTimeCard({ t, busyLabel }) {
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Busy Time</p>
      {busyLabel ? (
        <>
          <p className={`mt-3 text-2xl font-bold leading-none ${t.heading}`}>{busyLabel}</p>
          <p className={`mt-2 text-[10px] ${t.label}`}>prepare extra food before the rush</p>
        </>
      ) : (
        <p className={`mt-3 text-sm ${t.label}`}>No peak data yet</p>
      )}
    </div>
  );
}

function ComingUpCard({ t, prepareMore }) {
  const { items, enabled, totalRecent } = prepareMore || { items: [], enabled: false, totalRecent: 0 };
  return (
    <div className={`border p-4 ${t.panel}`}>
      <p className={`text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Prepare More</p>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-2">
              <span className={`truncate text-sm font-semibold ${t.heading}`}>{item.name}</span>
              <span className={`shrink-0 text-xs font-bold ${t.accent}`}>
                {item.expected != null ? `~${item.expected}` : `${item.recentCount}`}
                {item.expected != null ? " in 30m" : " recent"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`mt-3 text-[10px] uppercase tracking-widest ${t.label}`}>
          {enabled ? "No recent orders yet" : "Insufficient data for a forecast"}
        </p>
      )}
      {totalRecent > 0 && (
        <p className={`mt-3 border-t pt-2 text-[9px] ${t.label} ${t.divider}`}>
          Based on the {totalRecent} most recent orders
        </p>
      )}
    </div>
  );
}

function TodayZone({ t, today, peakHour, now }) {
  const { orderCount, sales, avgWaitMin, hourlyCounts } = today;
  const currentHour = now.getHours();
  const bars = hourlyCounts.filter((cell) => cell.hour >= 7 && cell.hour <= Math.max(7, currentHour));
  const maxCount = Math.max(1, ...bars.map((cell) => cell.count));
  const peak = bars.reduce((best, cell) => (cell.count > (best?.count ?? -1) ? cell : best), null);

  const stats = [
    { label: "Orders", value: orderCount },
    { label: "Sales", value: money(sales) },
    { label: "Avg Wait", value: avgWaitMin != null ? `${Math.round(avgWaitMin)} min` : "--" },
  ];

  return (
    <section className={`mt-8 border p-5 ${t.panelElevated}`}>
      <ZoneTitle
        t={t}
        right={
          peakHour ? (
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${t.accent}`}>
              🔥 Peak {peakHour}
            </span>
          ) : null
        }
      >
        Today
      </ZoneTitle>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className={`border p-3 ${t.panel}`}>
            <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>{stat.label}</p>
            <p className={`mt-1 text-2xl font-bold leading-none ${t.heading}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <p className={`mb-2 text-[9px] font-bold uppercase tracking-widest ${t.labelStrong}`}>Orders Today</p>
        <div className="flex h-32 items-end gap-1">
          {bars.map((cell) => {
            const isPeak = peak && cell.hour === peak.hour;
            const pct = Math.max(cell.count > 0 ? 8 : 3, (cell.count / maxCount) * 100);
            return (
              <div key={cell.hour} className="flex min-w-0 flex-1 flex-col justify-end self-stretch" title={`${peakRangeLabel(cell.hour)} — ${cell.count} orders`}>
                {isPeak && <span className="mb-0.5 text-center text-[9px]">🔥</span>}
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full ${cell.count > 0 ? TONES.accent.bar(t) : `${t.dark ? "bg-white/5" : "bg-black/5"} border ${t.headerBorder}`}`}
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <p className={`mt-1 w-full text-center text-[8px] uppercase tracking-wider ${t.label}`}>
                  {cell.hour % 3 === 0 ? peakRangeLabel(cell.hour).split(" – ")[0] : " "}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────
export default function KitchenCommandCenter({
  t,
  now,
  orders,
  onAdvance,
  updatingOrderId,
  queueMetrics,
  analytics,
  prepCapacity,
  onPrepCapacityChange,
  isSavingCapacity,
  isPaused,
}) {
  const pending = orders.filter((o) => o.status === "pending").length;
  const preparing = orders.filter((o) => o.status === "preparing").length;
  const ready = orders.filter((o) => o.status === "ready").length;

  const waitMin = queueMetrics ? Math.round(queueMetrics.estimatedWaitMin ?? 0) : null;
  const loadPct = queueMetrics ? Math.round((queueMetrics.utilization ?? 0) * 100) : 0;
  const band = loadBand(loadPct);

  const today = analytics?.today || { orderCount: 0, sales: 0, avgWaitMin: null, hourlyCounts: [] };
  const next30min = analytics?.next30min || { enabled: false, orders: 0, highDemand: false };
  const prepareMore = analytics?.prepareMore || { items: [], enabled: false, totalRecent: 0 };

  // Busy time: today's real busiest hour if there's live data, else today's predicted peak,
  // else the historical typical peak for this weekday.
  const livePeakHour = today.hourlyCounts.reduce((best, cell) => (cell.count > (best?.count ?? -1) ? cell : best), null);
  const busyLabel = livePeakHour?.count > 0
    ? peakRangeLabel(livePeakHour.hour)
    : analytics?.forecast?.expectedPeakToday?.label
    ? analytics.forecast.expectedPeakToday.label
    : analytics?.historical?.peakHourByAvg?.label
    ? analytics.historical.peakHourByAvg.label
    : null;

  return (
    <>
      {/* ─── LAYER 1 · NOW ─────────────────────────────────────────────── */}
      <StatusZone t={t} pending={pending} preparing={preparing} ready={ready} waitMin={waitMin} load={band} isPaused={isPaused} />

      {/* ─── LAYER 2 · NEXT (active order board dominates) ─────────────── */}
      <ActiveOrdersZone t={t} orders={orders} now={now} onAdvance={onAdvance} updatingOrderId={updatingOrderId} />

      {/* ─── LAYER 3 · INSIGHT (decision cards) ────────────────────────── */}
      <section className="mt-8">
        <ZoneTitle t={t}>Coming Up</ZoneTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KitchenLoadCard
            t={t}
            loadPct={loadPct}
            band={band}
            prepCapacity={prepCapacity}
            onPrepCapacityChange={onPrepCapacityChange}
            isSavingCapacity={isSavingCapacity}
          />
          <Next30MinCard t={t} next30min={next30min} />
          <BusyTimeCard t={t} busyLabel={busyLabel} />
          <ComingUpCard t={t} prepareMore={prepareMore} />
        </div>
      </section>

      {/* ─── TODAY (summary + orders-over-time) ────────────────────────── */}
      <TodayZone t={t} today={today} peakHour={busyLabel} now={now} />
    </>
  );
}
