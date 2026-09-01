// ─── Order Ready — floating pill that flies up when an order reaches ready ────
// Parks above the sticky cart bar / voice FAB so a live-order alert never covers the
// checkout or mic controls. Positions come from index.css's .bottom-anchor-pill*
// safe-area-aware utilities.
export default function OrderReadyPill({ myRecentOrders, scrollToLiveStatus, cartBarActive = false }) {
  const hasReady = myRecentOrders.some((order) => order.status === "ready");
  const hasInflight = myRecentOrders.some((order) => ["pending", "preparing"].includes(order.status));

  return (
    <div
      onClick={scrollToLiveStatus}
      className={`${cartBarActive ? "bottom-anchor-pill-lift" : "bottom-anchor-pill"} fixed left-1/2 z-[160] flex -translate-x-1/2 cursor-pointer items-center gap-3 whitespace-nowrap rounded-full border px-5 py-3 shadow-2xl transition-all duration-200 ease-out active:scale-95 cc-fade-up`}
      style={{
        background: hasReady ? "color-mix(in srgb, var(--color-success) 14%, var(--color-bg))" : "var(--color-bg)",
        borderColor: hasReady ? "color-mix(in srgb, var(--color-success) 45%, transparent)" : "var(--color-border)",
        color: "var(--color-text)",
      }}
    >
      {hasReady ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "var(--color-success)" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "var(--color-success)" }} />
          </span>
          <span className="text-xs font-extrabold tracking-wide" style={{ color: "var(--color-success)" }}>
            Order Ready to Claim!
          </span>
        </>
      ) : (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "var(--color-primary)" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "var(--color-primary)" }} />
          </span>
          <span className="text-xs font-extrabold tracking-wide">Kitchen preparing your order</span>
        </>
      )}
      {hasInflight && !hasReady && (
        <span className="cc-muted text-[11px] font-bold">· {myRecentOrders.length} live</span>
      )}
    </div>
  );
}
