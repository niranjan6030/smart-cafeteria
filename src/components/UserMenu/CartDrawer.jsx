import { itemImage, itemEmoji, money, stallDisplayName } from "./helpers";
import QuantityControl from "./QuantityControl";

// ─── CartDrawer — itemized, editable cart (spec §10) ──────────────────────────
// Bottom sheet on mobile, centered dialog on desktop. Desktop splits into two
// balanced columns — scrollable items (left) + an always-visible order summary
// (right) that never scrolls away (spec §24); mobile keeps a compact single
// column with a sticky bottom checkout (spec §25). Item cards carry category,
// name, real rating, unit price with an honest strikethrough when discounted, a
// real customization summary (only when the doc has one), a line-item total,
// stepper, remove and availability state. Add-on suggestions carry their real
// recommender reason.
export default function CartDrawer({ cart, cartTotal, cartCount, activeShop, estimatedWaitMin, isOrdering, isFacultyAdmin, addOns = [], onClose, onIncrement, onDecrement, onRemove, onCheckout, onAddAddOn, onOpenBulk, onBrowseMenu }) {
  const wait = estimatedWaitMin != null ? Math.max(1, Math.round(estimatedWaitMin)) : null;

  const totalSavings = cart.reduce((sum, item) => {
    const original = Number(item.originalPrice) || 0;
    const price = Number(item.price) || 0;
    return sum + Math.max(0, original - price) * item.quantity;
  }, 0);

  const categoryLabel = (item) => {
    if (item.category) {
      return typeof item.category === "string" ? item.category.toUpperCase() : String(item.category).toUpperCase();
    }
    return null;
  };

  const isUnavailable = (item) => item.available === false;
  const isLowStock = (item) => Number.isFinite(Number(item.stock)) && Number(item.stock) > 0 && Number(item.stock) <= 5;

  const renderSummaryBody = () => (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="cc-muted">{cartCount} {cartCount === 1 ? "item" : "items"} subtotal</span>
          <span className="text-xl font-extrabold">{money(cartTotal)}</span>
        </div>
        {totalSavings > 0 && (
          <div className="flex items-center justify-between text-xs font-bold" style={{ color: "var(--color-success)" }}>
            <span>Deals &amp; savings</span>
            <span>− {money(totalSavings)}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t pt-3 text-[11px] font-bold" style={{ borderColor: "var(--color-border)" }}>
          <span className="cc-muted">
            {wait != null ? `~${wait} min estimated wait` : "Walk-in counter pickup"}
          </span>
          <span style={{ color: "var(--color-success)" }}>Platform fee: Free</span>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        {isFacultyAdmin && (
          <button
            disabled={isOrdering}
            onClick={onOpenBulk}
            className="cc-btn cc-btn-outline !px-4 !py-4 text-xs uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
          >
            Bulk
          </button>
        )}
        <button
          disabled={isOrdering}
          onClick={onCheckout}
          className="cc-btn cc-btn-primary flex-1 !py-4 text-xs uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isOrdering ? "Opening…" : `Checkout — ${money(cartTotal)}`}
        </button>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Your cart">
      <button aria-label="Close cart" className="absolute inset-0 backdrop-blur-md" style={{ background: "var(--color-overlay)" }} onClick={onClose} />
      <section
        className="cc-card relative flex w-full max-w-4xl flex-col overflow-hidden rounded-t-[24px] sm:max-h-[85vh] sm:rounded-[24px]"
        style={{ maxHeight: "85vh", background: "var(--color-bg)" }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b p-5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <div>
            <p className="cc-kicker mb-1">{stallDisplayName(activeShop)}</p>
            <h2 className="font-display text-xl font-bold leading-tight tracking-tight">
              Your Cart {cartCount > 0 && <span style={{ color: "var(--color-primary-strong)" }}>({cartCount})</span>}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close cart"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-xl font-bold transition active:scale-95"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
          >
            ×
          </button>
        </div>

        {/* Itemized list */}
        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div
              className="grid h-14 w-14 place-items-center rounded-2xl"
              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary-strong)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 3h2l.4 2M7 13h10l3-8H5.4M7 13 5.4 5M7 13l-2.3 4.6A1 1 0 0 0 5.6 19H17M17 19a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM9 21a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
              </svg>
            </div>
            <div>
              <p className="font-display text-lg font-bold">Your cart is waiting</p>
              <p className="cc-muted mt-1 text-xs leading-relaxed">Explore today's menu and find something you'll enjoy.</p>
            </div>
            <button onClick={onBrowseMenu} className="cc-btn cc-btn-primary text-xs uppercase tracking-widest">
              Browse Menu
            </button>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              {/* Left column — items + add-ons, scrollable */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {cart.map((item) => {
                    const rating = Number(item.rating) || 0;
                    const reviewCount = Number(item.reviewCount) || 0;
                    const original = Number(item.originalPrice) || 0;
                    const price = Number(item.price) || 0;
                    const isDiscounted = original > price;
                    const unavailable = isUnavailable(item);
                    const lowStock = isLowStock(item);
                    return (
                      <div key={item.id} className="cc-card flex items-center gap-3 p-3 sm:p-3.5">
                        <div className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl sm:h-20 sm:w-20 ${unavailable ? "opacity-50" : ""}`}>
                          {itemImage(item) ? (
                            <img src={itemImage(item)} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <div
                              className="grid h-full w-full place-items-center text-base sm:text-lg"
                              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)" }}
                            >
                              {itemEmoji(item)}
                            </div>
                          )}
                          {isDiscounted && (
                            <span
                              className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide"
                              style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
                            >
                              Save {money(Math.max(0, original - price))}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          {categoryLabel(item) && (
                            <p className="cc-kicker mb-0.5 text-[9px]">{categoryLabel(item)}</p>
                          )}
                          <p className="line-clamp-2 font-display text-[13px] font-semibold leading-snug">{item.name}</p>
                          {rating > 0 && (
                            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--color-text-secondary)" }}>
                              <span style={{ color: "var(--color-primary)" }}>★</span>
                              <span>{rating.toFixed(1)}</span>
                              {reviewCount > 0 && (
                                <span
                                  className="rounded px-1 py-0.5 text-[9.5px] font-bold leading-none"
                                  style={{
                                    background: "color-mix(in srgb, var(--color-success) 14%, transparent)",
                                    color: "var(--color-success)",
                                  }}
                                >
                                  {reviewCount}
                                </span>
                              )}
                            </p>
                          )}
                          {Array.isArray(item.customizations) && item.customizations.length > 0 && (
                            <p className="cc-muted mt-0.5 truncate text-[10px] font-medium">
                              {item.customizations.join(" · ")}
                            </p>
                          )}
                          <p className="mt-1 flex items-baseline gap-1.5 text-[12px] font-bold" style={{ color: "var(--color-primary-strong)" }}>
                            {isDiscounted && (
                              <span className="text-[11px] font-semibold" style={{ color: "var(--color-text-muted)", textDecoration: "line-through" }}>
                                {money(original)}
                              </span>
                            )}
                            <span>{money(price)}</span>
                            <span className="cc-muted text-[10px] font-medium">/ each</span>
                          </p>
                          {(unavailable || lowStock) && (
                            <p
                              className="mt-1 w-fit rounded-full px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                background: unavailable
                                  ? "color-mix(in srgb, var(--color-danger) 12%, transparent)"
                                  : "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                                color: unavailable ? "var(--color-danger)" : "var(--color-primary-strong)",
                              }}
                            >
                              {unavailable ? "Unavailable" : `Only ${Math.floor(Number(item.stock))} left`}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <p className="text-[13px] font-extrabold">{money(price * item.quantity)}</p>
                          <QuantityControl quantity={item.quantity} onAdd={() => onIncrement(item)} onRemove={() => onDecrement(item)} variant="solid" compact />
                          <button
                            onClick={() => onRemove(item)}
                            aria-label={`Remove ${item.name} from cart`}
                            className="px-1 py-0.5 text-[11px] font-semibold transition hover:text-red-500"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Complete Your Order — real recommender add-ons */}
                {addOns.length > 0 && (
                  <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
                    <p className="cc-kicker mb-0.5">Complete your order</p>
                    <p className="cc-muted mb-3 text-xs">Often ordered with your items</p>
                    <div className="space-y-2">
                      {addOns.map((suggestion) => (
                        <div key={suggestion.itemId} className="cc-card flex items-center gap-3 px-3 py-2.5">
                          <div
                            className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg text-sm"
                            style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)" }}
                          >
                            {itemEmoji(suggestion.item)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold leading-snug">{suggestion.item.name}</p>
                            <p className="cc-muted mt-0.5 truncate text-[11px]">
                              {suggestion.reason || money(suggestion.item.price)}
                            </p>
                          </div>
                          <button
                            onClick={() => onAddAddOn(suggestion.item)}
                            aria-label={`Add ${suggestion.item.name}`}
                            className="cc-btn cc-btn-primary !px-4 !py-2 text-[10px] uppercase tracking-widest"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right column — always-visible order summary (desktop) */}
              <aside
                className="hidden w-80 shrink-0 flex-col justify-between border-l p-5 sm:flex"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                aria-label="Order summary"
              >
                {renderSummaryBody()}
              </aside>
            </div>

            {/* Mobile — sticky checkout footer */}
            <div className="border-t p-5 sm:hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
              {renderSummaryBody()}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
