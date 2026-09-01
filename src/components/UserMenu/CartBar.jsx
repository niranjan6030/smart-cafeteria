import { money, stallDisplayName } from "./helpers";

// ─── CartBar — the sticky bottom cart pill (spec §31-33) ─────────────────────
// Appears once the cart has items. Left side: item count + live wait + total;
// right side: "View Cart" (opens the drawer) and the accent "Checkout" CTA (goes
// straight to the review sheet). Busy/closed states replace the pill with a
// status toast. The total carries aria-live so screen-reader users hear cart
// updates without the whole bar being re-announced.
export default function CartBar({
  cart,
  isShopOpen,
  isShopBusy,
  isFacultyAdmin,
  isOrdering,
  setShowCartDrawer,
  setShowBulkModal,
  user,
  setShowLoginModal,
  handleOrder,
  shopResumingAt,
  cartCount,
  cartTotal,
  onCheckout,
  activeShop,
  estimatedWaitMin,
}) {
  const canOrder = isShopOpen && !isShopBusy;
  const wait = estimatedWaitMin != null ? Math.max(1, Math.round(estimatedWaitMin)) : null;

  return (
    <>
      {cart.length > 0 && canOrder && (
        <div className="bottom-anchor-cart fixed left-1/2 z-[120] w-[94%] max-w-[520px] -translate-x-1/2 rounded-[20px]">
          <div
            className="cc-card flex items-center justify-between gap-3 p-3 pl-5 shadow-float"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            <button
              onClick={() => setShowCartDrawer(true)}
              aria-label="View cart details"
              className="min-w-0 rounded-xl text-left transition active:scale-[0.98]"
            >
              <p className="cc-kicker flex items-center gap-1.5 !text-[10px]">
                {cartCount} {cartCount === 1 ? "item" : "items"}
                <span className="cc-muted normal-case tracking-normal">· {stallDisplayName(activeShop)}</span>
                {wait != null && <span className="cc-muted normal-case tracking-normal">· ~{wait} min</span>}
              </p>
              <p className="truncate text-2xl font-extrabold leading-tight" role="status" aria-live="polite">
                {money(cartTotal)}
              </p>
            </button>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setShowCartDrawer(true)}
                className="cc-btn cc-btn-outline !px-4 !py-3.5 text-xs uppercase tracking-widest"
              >
                View Cart
              </button>
              {isFacultyAdmin && (
                <button
                  disabled={isOrdering}
                  onClick={() => setShowBulkModal(true)}
                  className="cc-btn cc-btn-outline !px-4 !py-3.5 text-xs uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Bulk
                </button>
              )}
              <button
                disabled={isOrdering}
                onClick={() => {
                  if (!user) { setShowLoginModal(true); return; }
                  onCheckout ? onCheckout() : handleOrder(cart);
                }}
                className="cc-btn cc-btn-primary !px-7 !py-3.5 text-xs uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isOrdering ? "Opening…" : "Checkout"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cart.length > 0 && isShopBusy && (
        <div
          className="bottom-anchor-cart fixed left-1/2 z-[120] w-[94%] max-w-[520px] -translate-x-1/2 rounded-2xl border p-4 text-center"
          style={{
            borderColor: "color-mix(in srgb, var(--color-warning) 50%, transparent)",
            background: "var(--color-surface-elevated)",
          }}
        >
          <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: "var(--color-warning)" }}>
            ⚠ Orders paused — resuming at {shopResumingAt || "soon"}
          </p>
        </div>
      )}
    </>
  );
}
