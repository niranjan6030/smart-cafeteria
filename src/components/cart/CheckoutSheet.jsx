import { money, stallDisplayName } from "../UserMenu/helpers";

// ─── CheckoutSheet — the order review step before Razorpay (spec §35-41) ──────
// All numbers are the real cart total and the live queueing-model wait. Pickup
// is walk-in counter (token-based), so the sheet surfaces the token flow and the
// active meal pass as honest information — a pass is redeemed at the counter,
// not deducted here.
export default function CheckoutSheet({
  cart,
  cartTotal,
  cartCount,
  activeShop,
  activePassForShop,
  estimatedWaitMin,
  isOrdering,
  onClose,
  onConfirm,
}) {
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Review your order">
      <button aria-label="Close review" className="absolute inset-0 backdrop-blur-md" style={{ background: "var(--color-overlay)" }} onClick={onClose} />
      <section
        className="cc-card relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[24px] sm:rounded-[24px]"
        style={{ background: "var(--color-bg)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-4 border-b p-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <div>
            <p className="cc-kicker mb-1">
              {cartCount} {cartCount === 1 ? "item" : "items"} · {stallDisplayName(activeShop)}
            </p>
            <h2 className="font-display text-xl font-bold leading-tight tracking-tight">Review your order</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Back to cart"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-xl font-bold transition active:scale-95"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Stall + ETA */}
          <div
            className="mb-5 flex items-center justify-between gap-3 rounded-2xl border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div>
              <p className="text-sm font-extrabold">{stallDisplayName(activeShop)}</p>
              <p className="cc-muted mt-0.5 text-xs">Walk-in counter pickup · token number at the stall</p>
            </div>
            {estimatedWaitMin != null && (
              <span
                className="rounded-full px-3 py-1.5 text-xs font-extrabold"
                style={{ background: "color-mix(in srgb, var(--color-primary) 16%, transparent)", color: "var(--color-primary-strong)" }}
              >
                ~{Math.max(1, Math.round(estimatedWaitMin))} min
              </span>
            )}
          </div>

          {/* Items */}
          <ul className="space-y-2.5">
            {cart.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 truncate font-semibold">
                  {item.name} <span className="cc-muted font-medium">× {item.quantity}</span>
                </span>
                <span className="shrink-0 font-bold">{money(Number(item.price || 0) * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <hr className="cc-hairline my-5" />

          {/* Totals */}
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="cc-muted">Subtotal ({cartCount} {cartCount === 1 ? "item" : "items"})</span>
              <span className="font-semibold">{money(cartTotal)}</span>
            </div>
            {cart.some((item) => Number(item.originalPrice) > Number(item.price)) && (
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: "var(--color-success)" }}>
                <span>Deals &amp; savings</span>
                <span>
                  −{" "}
                  {money(
                    cart.reduce(
                      (sum, item) =>
                        sum +
                        Math.max(0, (Number(item.originalPrice) || 0) - (Number(item.price) || 0)) * item.quantity,
                      0
                    )
                  )}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="cc-muted">Platform fee</span>
              <span className="font-semibold" style={{ color: "var(--color-success)" }}>Free</span>
            </div>
            <div className="flex items-center justify-between pt-2 text-base">
              <span className="font-extrabold">To pay</span>
              <span className="text-2xl font-extrabold">{money(cartTotal)}</span>
            </div>
          </div>

          {/* Active pass note */}
          {activePassForShop && (
            <div
              className="mt-5 rounded-2xl border p-4 text-xs leading-relaxed"
              style={{
                borderColor: "color-mix(in srgb, var(--color-primary) 35%, transparent)",
                background: "color-mix(in srgb, var(--color-primary) 9%, transparent)",
                color: "var(--color-primary-strong)",
              }}
            >
              You have an active meal pass at {stallDisplayName(activeShop)} with {activePassForShop.meals_remaining} meals left. Pass meals are claimed at the counter — you can still pay for this order or show your pass code to collect it free.
            </div>
          )}
        </div>

        {/* Confirm */}
        <div className="border-t p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
          <button
            disabled={isOrdering}
            onClick={onConfirm}
            className="cc-btn cc-btn-primary flex w-full items-center justify-center gap-2.5 !py-4 text-sm uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isOrdering && <span className="cc-spinner" aria-hidden="true" />}
            {isOrdering ? "Opening secure checkout…" : `Place order & pay ${money(cartTotal)}`}
          </button>
          <p className="cc-muted mt-3 text-center text-[11px] leading-relaxed">
            You'll pay securely via Razorpay — UPI, cards, or netbanking. Payments are verified by the university's payment server.
          </p>
        </div>
      </section>
    </div>
  );
}
