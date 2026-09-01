import { money, stallDisplayName } from "../UserMenu/helpers";
import OrderStatusSteps from "./OrderStatusSteps";

// ─── OrderConfirmation — post-payment success screen (spec §42-43) ────────────
// Replaces the old bare check overlay with a real receipt: order id, pickup
// token, itemized total, live wait estimate, and a path back into tracking.
export default function OrderConfirmation({ order, onClose, onTrackOrder }) {
  if (!order) return null;
  const wait = Math.max(1, Math.round(Number(order.estimatedWaitMin) || 1));

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Order confirmed">
      <button aria-label="Close" className="absolute inset-0 backdrop-blur-md" style={{ background: "var(--color-overlay)" }} onClick={onClose} />
      <section className="cc-card cc-pop-in relative w-full max-w-md overflow-hidden rounded-[24px] p-8 text-center" style={{ background: "var(--color-bg)" }}>
        <div
          className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full"
          style={{ background: "var(--color-primary)", color: "var(--color-bg-deep)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-9 w-9">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
        </div>

        <p className="cc-kicker mb-2">Order confirmed</p>
        <h2 className="font-display text-3xl font-bold tracking-tight">Thanks, {order.studentName}!</h2>
        <p className="cc-muted mt-2 text-sm leading-relaxed">
          {stallDisplayName(order.shop)} is on it. Track the live status on your orders tab.
        </p>

        {/* Pickup token — the physical handoff code */}
        <div
          className="mt-6 rounded-2xl border border-dashed p-5"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-surface)" }}
        >
          <p className="cc-kicker !text-[10px]">Pickup token</p>
          <p className="mt-1 text-4xl font-extrabold tracking-[0.2em]" style={{ color: "var(--color-primary-strong)" }}>
            {order.tokenPin}
          </p>
          <p className="cc-muted mt-1 text-[11px]">Share this with the counter to collect your order.</p>
        </div>

        {/* Summary */}
        <div className="mt-5 space-y-1.5 rounded-2xl border p-5 text-left text-sm" style={{ borderColor: "var(--color-border)" }}>
          <p className="cc-muted text-[11px] uppercase tracking-widest">{order.itemNames}</p>
          <div className="flex items-baseline justify-between pt-2">
            <span className="font-bold">Paid</span>
            <span className="text-lg font-extrabold">{money(order.total)}</span>
          </div>
          <p className="cc-muted text-[11px]">Estimated wait ~{wait} min · Order #{order.shortId}</p>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button onClick={onTrackOrder} className="cc-btn cc-btn-primary w-full">
            Track my order
          </button>
          <button onClick={onClose} className="cc-btn cc-btn-ghost w-full">
            Keep browsing
          </button>
        </div>

        <OrderStatusSteps status="pending" className="mt-6" />
      </section>
    </div>
  );
}
