import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { money, sortByNewest, stallDisplayName } from "./helpers";
import SectionHeader from "../ui/SectionHeader";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";
import OrderStatusSteps from "../orders/OrderStatusSteps";

// ─── MyOrders — full order history, split into Active / History ───────────────
// Live via onSnapshot so status changes reflect in real time. Active orders show
// the status pipeline; history orders stay a quiet record. Reordering rebuilds
// the cart from the original items (real product ids/prices, saved at order time).
function statusTone(status) {
  if (status === "ready") return "success";
  if (status === "preparing") return "warning";
  if (status === "pending") return "neutral";
  return "neutral";
}

// An order is only genuinely "active" once its payment succeeded — failed/cancelled checkout
// attempts are history records, never live queue entries.
function isActivePaidOrder(order) {
  return ["pending", "preparing", "ready"].includes(order.status) && order.payment_status === "paid";
}

// Payment badge reflects the real payment state, including failure/cancellation outcomes.
function paymentBadge(paymentStatus) {
  if (paymentStatus === "paid") return { tone: "success", label: "Paid" };
  if (paymentStatus === "failed") return { tone: "error", label: "Payment failed" };
  if (paymentStatus === "cancelled") return { tone: "neutral", label: "Checkout cancelled" };
  return { tone: "warning", label: "Payment pending" };
}

function OrderCardSkeleton() {
  return (
    <div className="cc-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="cc-skeleton h-6 w-24 rounded-full" />
        <div className="cc-skeleton h-6 w-20 rounded-full" />
      </div>
      <div className="cc-skeleton h-4 w-3/4 rounded-full" />
      <div className="cc-skeleton mt-2 h-3 w-40 rounded-full" />
      <div className="cc-skeleton mt-4 h-6 w-2/3 rounded-full" />
    </div>
  );
}

export default function MyOrders({ user, onReorder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("active");

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return undefined;
    }
    const q = query(collection(db, "orders"), where("student_uid", "==", user.uid));
    return onSnapshot(
      q,
      (snapshot) => {
        setOrders(sortByNewest(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))));
        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("My Orders listener failed:", err);
        setError("Could not load your orders. Please try again.");
        setLoading(false);
      }
    );
  }, [user?.uid]);

  const activeOrders = useMemo(() => orders.filter(isActivePaidOrder), [orders]);
  const historyOrders = useMemo(() => orders.filter((o) => !isActivePaidOrder(o)), [orders]);
  const shown = tab === "active" ? activeOrders : historyOrders;

  const dateLabel = (order) => {
    const date = order.created_at?.toDate?.();
    return date
      ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
          " · " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—";
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SectionHeader kicker="My orders" title="My Orders" subtitle="Every order you've placed, and where it stands right now." />
        <OrderCardSkeleton />
        <OrderCardSkeleton />
        <OrderCardSkeleton />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div
          className="mb-6 rounded-2xl border p-4 text-sm font-semibold"
          style={{ borderColor: "color-mix(in srgb, var(--color-error) 40%, transparent)", background: "color-mix(in srgb, var(--color-error) 8%, transparent)", color: "var(--color-error)" }}
        >
          {error}
        </div>
      )}

      <SectionHeader
        kicker="My orders"
        title={orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"} · ${activeOrders.length} active` : "My Orders"}
        subtitle="Every order you've placed, and where it stands right now."
      />

      {/* Active / History tabs */}
      {orders.length > 0 && (
        <div className="mb-6 flex gap-2">
          {[
            { id: "active", label: `Active (${activeOrders.length})` },
            { id: "history", label: `History (${historyOrders.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`cc-chip ${tab === t.id ? "cc-chip-active" : ""}`}
              aria-pressed={tab === t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((order) => {
          const isActive = isActivePaidOrder(order);
          const payment = paymentBadge(order.payment_status);
          const items = Array.isArray(order.items) ? order.items : null;

          return (
            <article key={order.id} className="cc-card cc-card-hover p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(order.status)} dot>
                      {order.status === "ready" ? "Ready for pickup" : order.status}
                    </Badge>
                    <Badge tone={payment.tone}>{payment.label}</Badge>
                    {order.shop_name && <span className="cc-muted text-[10px] font-bold uppercase tracking-widest">{stallDisplayName(order.shop_name)}</span>}
                  </div>

                  <p className="truncate text-sm font-extrabold">{order.item_name || "Order"}</p>
                  <p className="cc-muted mt-1 text-[11px]">{dateLabel(order)}</p>

                  {isActive && (
                    <div className="mt-4 max-w-sm">
                      <OrderStatusSteps status={order.status} compact delayMessage={order.delay_message} />
                    </div>
                  )}

                  {items && items.length > 0 && (
                    <div
                      className="mt-3 rounded-xl border p-3"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      {items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-[11px] font-bold">
                          <span className="truncate pr-3">{item.name} × {item.quantity}</span>
                          <span>{money(Number(item.price || 0) * Number(item.quantity || 1))}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reorder the exact same items */}
                  {onReorder && items && items.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onReorder({ shop_name: order.shop_name, items })}
                      className="cc-btn cc-btn-outline mt-3 !px-4 !py-2 text-xs"
                    >
                      Order again
                    </button>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-lg font-extrabold" style={{ color: "var(--color-primary-strong)" }}>
                    {money(order.price)}
                  </span>
                  {isActive && order.estimatedWaitMin != null && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                      style={{ background: "color-mix(in srgb, var(--color-primary) 16%, transparent)", color: "var(--color-primary-strong)" }}
                    >
                      ~{Math.max(1, Math.round(order.estimatedWaitMin))} min
                    </span>
                  )}
                  {order.token_pin && (
                    <span className="cc-kicker !text-[10px]">Token {order.token_pin}</span>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {shown.length === 0 && (
          <EmptyState
            icon={<span className="text-2xl">🧾</span>}
            title={tab === "active" ? "No active orders" : "No past orders yet"}
            subtitle={
              tab === "active"
                ? "Orders you place will appear here live as the kitchen works through them."
                : "Completed orders will be saved here for quick reordering."
            }
          />
        )}
      </div>
    </div>
  );
}
