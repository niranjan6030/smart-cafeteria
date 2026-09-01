// ─── 1.6 Live Status — collapsible sidebar, sits just below the hero ──────────
// The TRACK surface for in-flight orders. Statuses are derived truthfully from the
// real order fields (payment_status / status / token_pin / delay_message).
import Badge from "../ui/Badge";
import { stallDisplayName } from "./helpers";

export default function LiveStatusSidebar({ myRecentOrders, showLiveStatus, setShowLiveStatus, deleteOrder }) {
  return (
    <section id="live-status-section" className="cc-fade-in-up mb-10 flex">
      <div className="cc-card cc-card-shadow w-full overflow-hidden rounded-2xl border sm:w-80">
        <button
          onClick={() => setShowLiveStatus((v) => !v)}
          aria-expanded={showLiveStatus}
          className="flex w-full items-center justify-between gap-3 px-5 py-4"
        >
          <span className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-primary)" }} />
            <span className="cc-kicker">Live Status</span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}>
              {myRecentOrders.length}
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className={`h-4 w-4 shrink-0 transition-transform duration-300 ${showLiveStatus ? "rotate-180" : ""}`}
            style={{ color: "var(--color-text-muted)" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {showLiveStatus && (
          <div className="flex flex-col gap-4 px-5 pb-5">
            {myRecentOrders.map((order) => {
              const isPaid = order.payment_status === "paid";
              const isServed = order.status === "ready";
              const isCompleted = order.status === "completed";
              const isAwaiting = order.status === "pending" && order.payment_status === "pending";
              const chipTone = isCompleted || isServed ? "success" : isPaid ? "warning" : "neutral";

              return (
                <article key={order.id} className="cc-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-extrabold">{order.item_name}</h3>
                        {order.is_bulk_order && (
                          <span className="cc-kicker shrink-0 !text-[8px]" style={{ color: "var(--color-warning)" }}>
                            Bulk
                          </span>
                        )}
                      </div>
                      <p className="cc-muted mt-1 truncate text-[10px] font-bold uppercase tracking-widest">
                        {stallDisplayName(order.shop_name)} - #{order.id.slice(-4)}
                      </p>
                    </div>
                    <Badge tone={chipTone}>{isCompleted ? "Archived" : isServed ? "Ready" : isPaid ? "Kitchen" : "Payment"}</Badge>
                  </div>

                  <div className="my-4 grid grid-cols-3 gap-1.5">
                    <span className="h-1.5 rounded-full" style={{ background: isPaid || isServed || isCompleted ? "var(--color-primary)" : "var(--color-border)" }} />
                    <span className="h-1.5 rounded-full" style={{ background: isPaid || isServed || isCompleted ? "var(--color-primary)" : "var(--color-border)" }} />
                    <span className="h-1.5 rounded-full" style={{ background: isCompleted || isServed ? "var(--color-primary)" : "var(--color-border)" }} />
                  </div>

                  {order.delay_message && !isServed && !isCompleted && (
                    <div
                      className="mb-3 rounded-xl border px-3 py-2.5 text-xs font-semibold"
                      style={{ borderColor: "color-mix(in srgb, var(--color-warning) 45%, transparent)", background: "color-mix(in srgb, var(--color-warning) 9%, transparent)", color: "var(--color-warning)" }}
                    >
                      {order.delay_message}
                    </div>
                  )}

                  {isServed && !isCompleted && (
                    <div
                      className="rounded-2xl p-4 text-center"
                      style={{ background: "var(--color-primary)", color: "var(--color-bg-deep)" }}
                    >
                      <p className="text-[8px] font-black uppercase tracking-[0.28em]">Pickup Token</p>
                      <p className="mt-1 text-2xl font-black tracking-widest">{order.token_pin}</p>
                    </div>
                  )}

                  {(isCompleted || isAwaiting) && (
                    <button
                      onClick={() => deleteOrder(order.id, order.status, order.payment_status)}
                      className="mt-3 text-[9px] font-black uppercase tracking-widest"
                      style={{ color: "var(--color-error)" }}
                    >
                      Dismiss
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
