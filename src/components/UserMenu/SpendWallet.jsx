import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { createdAtMillis, money, sortByNewest } from "./helpers";
import SectionHeader from "../ui/SectionHeader";
import EmptyState from "../ui/EmptyState";

// ─── Feature 5: Spend Wallet Tab — real paid-order analytics ────────────────
export default function SpendWallet({ user }) {
  const [allOrders, setAllOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return undefined; }
    const q = query(
      collection(db, "orders"),
      where("student_uid", "==", user.uid),
      where("payment_status", "==", "paid")
    );
    return onSnapshot(
      q,
      (snapshot) => {
        setAllOrders(sortByNewest(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))));
        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("Spend wallet listener failed:", err);
        setError("Could not load spend history. Check Firestore rules for orders.");
        setLoading(false);
      }
    );
  }, [user?.uid]);

  const analytics = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthOrders = allOrders.filter((o) => createdAtMillis(o.created_at) >= startOfMonth.getTime());
    const monthSpend = monthOrders.reduce((s, o) => s + Number(o.price || 0), 0);
    const totalCount = allOrders.length;

    // Most ordered item via map-reduce
    const itemCount = {};
    allOrders.forEach((o) => {
      const items = Array.isArray(o.items) ? o.items : [{ name: o.item_name, quantity: 1 }];
      items.forEach((i) => {
        const name = i.name || o.item_name;
        itemCount[name] = (itemCount[name] || 0) + Number(i.quantity || 1);
      });
    });
    const topItem = Object.entries(itemCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return { monthSpend, totalCount, topItem };
  }, [allOrders]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <p className="cc-kicker opacity-60">Loading spend history…</p>
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
        kicker="Spend wallet"
        title={allOrders.length ? `₹ spent this month` : "Spend Wallet"}
        subtitle="A real record of every paid order you've placed."
      />

      {/* Summary cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="cc-card p-5">
          <p className="cc-kicker !text-[9px]">This Month</p>
          <p className="mt-2 text-3xl font-extrabold" style={{ color: "var(--color-primary-strong)" }}>{money(analytics.monthSpend)}</p>
          <p className="cc-muted mt-1 text-[10px]">Total spent in INR</p>
        </div>
        <div className="cc-card p-5">
          <p className="cc-kicker !text-[9px]">Top Order</p>
          <p className="mt-2 truncate text-lg font-extrabold" style={{ color: "var(--color-primary-strong)" }}>{analytics.topItem || "—"}</p>
          <p className="cc-muted mt-1 text-[10px]">Most ordered item</p>
        </div>
        <div className="cc-card p-5">
          <p className="cc-kicker !text-[9px]">Transactions</p>
          <p className="mt-2 text-3xl font-extrabold">{analytics.totalCount}</p>
          <p className="cc-muted mt-1 text-[10px]">All paid orders</p>
        </div>
      </div>

      {/* Receipts archive */}
      <div>
        <p className="cc-kicker mb-4">Digital Receipts</p>
        <div className="space-y-3">
          {allOrders.map((order) => {
            const date = order.created_at?.toDate?.();
            const dateLabel = date
              ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
                " · " +
                date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "—";
            const items = Array.isArray(order.items) ? order.items : null;

            return (
              <article key={order.id} className="cc-card cc-card-hover p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{order.item_name}</p>
                    <p className="cc-muted mt-1 text-[11px]">{dateLabel}</p>

                    {items && items.length > 1 && (
                      <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                        {items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-[11px] font-bold">
                            <span className="pr-3">{item.name} × {item.quantity}</span>
                            <span>{money(Number(item.price || 0) * Number(item.quantity || 1))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-lg font-extrabold" style={{ color: "var(--color-primary-strong)" }}>{money(order.price)}</span>
                    {order.razorpay_payment_id ? (
                      <span className="cc-muted rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest" style={{ background: "var(--color-surface)" }}>
                        #{String(order.razorpay_payment_id).slice(-8).toUpperCase()}
                      </span>
                    ) : (
                      <span className="cc-muted rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest" style={{ background: "var(--color-surface)" }}>
                        #{order.id.slice(-8).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {allOrders.length === 0 && (
            <EmptyState
              icon={<span className="text-2xl">💳</span>}
              title="No paid orders yet"
              subtitle="Once you place and pay for an order, its receipt and spend analytics appear here."
            />
          )}
        </div>
      </div>
    </div>
  );
}
