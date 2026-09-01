import { money, orderCreatedMs, formatTime, printOrderTicket } from "./helpers";
import { PrintIcon } from "./icons";

// ─── Color-coded active order card for the Kitchen Command Center ──────────
// One universal operational color language per status:
//   🔴 NEW      → action required now (start preparing)
//   🟡 MAKING   → being handled (mark ready)
//   🟢 READY    → done, waiting for pickup (mark collected)
// The dot + text both carry the status so a staff member never needs to decode
// a color on its own. Class strings are kept full/literal so Tailwind's JIT can
// find them (same rule as the rest of the terminal's `t`-token theming).

const STATUS_STYLES = {
  pending: {
    label: "NEW",
    dot: "bg-red-500",
    pill: (t) =>
      t.dark
        ? "border-red-400/40 bg-red-400/10 text-red-300"
        : "border-red-500/40 bg-red-500/10 text-red-600",
    topBar: "bg-red-500",
    button: (t) =>
      t.dark
        ? "bg-red-500 hover:bg-red-400 focus-visible:ring-red-400/50"
        : "bg-red-600 hover:bg-red-500 focus-visible:ring-red-500/50",
    ring: "focus-visible:outline-none focus-visible:ring-2",
    pulse: "animate-pulse",
  },
  preparing: {
    label: "MAKING",
    dot: "bg-amber-500",
    pill: (t) =>
      t.dark
        ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
        : "border-amber-500/40 bg-amber-500/10 text-amber-600",
    topBar: "bg-amber-500",
    button: (t) =>
      t.dark
        ? "bg-amber-500 hover:bg-amber-400 focus-visible:ring-amber-400/50"
        : "bg-amber-500 hover:bg-amber-400 focus-visible:ring-amber-500/50",
    ring: "focus-visible:outline-none focus-visible:ring-2",
    pulse: "",
  },
  ready: {
    label: "READY",
    dot: "bg-emerald-500",
    pill: (t) =>
      t.dark
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    topBar: "bg-emerald-500",
    button: (t) =>
      t.dark
        ? "bg-emerald-500 hover:bg-emerald-400 focus-visible:ring-emerald-400/50"
        : "bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-500/50",
    ring: "focus-visible:outline-none focus-visible:ring-2",
    pulse: "",
  },
};

const NEXT_STATUS = { pending: "preparing", preparing: "ready", ready: "completed" };
const ACTION_LABEL = { pending: "Start", preparing: "Ready", ready: "Collected" };

function orderItemLines(order) {
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.map((item) => `${item.quantity || 1} × ${item.name || "Item"}`);
  }
  return [order.itemName || order.item_name || "Item"];
}

export default function CommandOrderCard({ t, order, now, onAdvance, isUpdating }) {
  const status = order.status === "ready" ? "ready" : order.status === "preparing" ? "preparing" : "pending";
  const style = STATUS_STYLES[status];

  const createdMs = orderCreatedMs(order);
  const elapsedMinutes = createdMs ? (now.getTime() - createdMs) / 60000 : 0;
  const sla = elapsedMinutes >= 10 ? "critical" : elapsedMinutes >= 5 ? "warning" : "normal";
  const elapsedLabel = !createdMs ? "--" : elapsedMinutes < 1 ? "just now" : `${Math.floor(elapsedMinutes)}m`;

  const nextStatus = NEXT_STATUS[status];
  const actionLabel = ACTION_LABEL[status];

  return (
    <article className={`relative flex flex-col overflow-hidden border ${t.panel}`}>
      <div className={`h-1 w-full shrink-0 ${style.topBar}`} />
      <div className="flex flex-1 flex-col p-4">
        {/* Pickup OTP — matches the token_pin shown to the student after payment; staff
            read it aloud / compare before handing over the order. */}
        {order.token_pin && (
          <div className={`mb-3 flex items-center justify-between border-b pb-2 ${t.divider}`}>
            <span className={`text-[9px] font-bold uppercase tracking-widest ${t.label}`}>Pickup OTP</span>
            <span className={`font-kds text-lg font-bold leading-none tracking-[0.35em] ${t.heading}`}>
              {order.token_pin}
            </span>
          </div>
        )}
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>
              #{order.id.slice(-6).toUpperCase()} &middot; {formatTime(order.created_at)}
            </p>
            <h3 className={`mt-1 truncate text-base font-bold tracking-tight uppercase ${t.heading}`}>
              {order.studentName || order.student_name || "Unknown customer"}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => printOrderTicket(order)}
              title="Print KOT"
              aria-label="Print kitchen order ticket"
              className={`border p-1.5 transition-all duration-200 ease-out hover:bg-current/10 ${t.accentBorder} ${t.body} ${t.focusRing}`}
            >
              <PrintIcon />
            </button>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${style.pill(t)}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${style.pulse}`} />
              {style.label}
            </span>
          </div>
        </div>

        <ul className="mb-3 space-y-1">
          {orderItemLines(order).map((line, i) => (
            <li key={i} className={`text-sm font-semibold ${t.body}`}>
              {line}
            </li>
          ))}
        </ul>

        <div className={`mb-4 flex items-center justify-between border-t pt-2 text-[11px] font-bold ${t.divider} ${t.labelStrong}`}>
          <span className={sla === "critical" ? "text-red-500" : sla === "warning" ? "text-amber-500" : "text-emerald-500"}>
            {elapsedLabel} elapsed
          </span>
          <span>{money(order.price)}</span>
        </div>

        <button
          onClick={() => onAdvance(order.id, nextStatus)}
          disabled={isUpdating}
          className={`mt-auto min-h-[48px] w-full px-3 py-3 text-sm font-bold uppercase tracking-widest text-white transition-all duration-200 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${style.button(t)} ${style.ring}`}
        >
          {isUpdating ? "Updating..." : actionLabel}
        </button>
      </div>
    </article>
  );
}
