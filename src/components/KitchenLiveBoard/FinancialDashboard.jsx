import { useMemo, useState } from "react";
import { money, orderCreatedMs, PAGE_SIZE } from "./helpers";

// ─── MODULE 3: Financial Analytics & Historical Sales Ledger ──────────────
export default function FinancialDashboard({ t, stallOrderHistory }) {
  const [page, setPage] = useState(0);

  const stats = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const paidOrders = stallOrderHistory.filter((o) => o.payment_status === "paid");

    const todaysOrders = paidOrders.filter((o) => {
      const d = o.created_at?.toDate?.();
      if (!d) return false;
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayKey;
    });

    const todayRevenue = todaysOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);

    const completedToday = todaysOrders.filter((o) => o.status === "completed" && o.completed_at?.toDate);
    const avgFulfillmentMin = completedToday.length
      ? completedToday.reduce((sum, o) => sum + (o.completed_at.toDate().getTime() - orderCreatedMs(o)) / 60000, 0) /
        completedToday.length
      : null;

    const itemCounts = {};
    todaysOrders.forEach((o) => {
      if (o.items?.length) {
        o.items.forEach((item) => {
          itemCounts[item.name] = (itemCounts[item.name] || 0) + (item.quantity || 1);
        });
      } else if (o.item_name) {
        itemCounts[o.item_name] = (itemCounts[o.item_name] || 0) + 1;
      }
    });
    const topItem = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    const historicalLedger = paidOrders
      .filter((o) => o.status === "completed")
      .sort((a, b) => orderCreatedMs(b) - orderCreatedMs(a));

    return { todayRevenue, todayOrderCount: todaysOrders.length, avgFulfillmentMin, topItem, historicalLedger };
  }, [stallOrderHistory]);

  const totalPages = Math.max(1, Math.ceil(stats.historicalLedger.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedLedger = stats.historicalLedger.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <section className={`border p-5 ${t.panel}`}>
      <p className={`mb-4 text-[10px] uppercase tracking-[0.3em] ${t.label}`}>Executive Financial Dashboard</p>

      <div className={`mb-6 border p-6 text-center ${t.panelAlt}`}>
        <p className={`text-[10px] uppercase tracking-[0.35em] ${t.label}`}>Today's Collection</p>
        <p className={`mt-2 text-4xl font-bold ${t.heading}`}>{money(stats.todayRevenue)}</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`border p-4 text-center ${t.divider}`}>
          <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Orders Today</p>
          <p className={`mt-1 text-xl font-bold ${t.heading}`}>{stats.todayOrderCount}</p>
        </div>
        <div className={`border p-4 text-center ${t.divider}`}>
          <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Avg Fulfillment</p>
          <p className={`mt-1 text-xl font-bold ${t.heading}`}>
            {stats.avgFulfillmentMin != null ? `${stats.avgFulfillmentMin.toFixed(1)} min` : "—"}
          </p>
        </div>
        <div className={`border p-4 text-center ${t.divider}`}>
          <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Top Seller Today</p>
          <p className={`mt-1 truncate text-xl font-bold ${t.heading}`}>{stats.topItem}</p>
        </div>
      </div>

      <p className={`mb-3 text-[10px] uppercase tracking-[0.3em] ${t.label}`}>Historical Audit Log</p>
      {pagedLedger.length === 0 ? (
        <p className={`py-10 text-center text-[10px] uppercase tracking-widest ${t.label}`}>No completed transactions yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className={`border-b text-[9px] uppercase tracking-widest ${t.headerBorder} ${t.label}`}>
                  <th className="py-2 pr-3">Order ID</th>
                  <th className="py-2 pr-3">Timestamp</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Items</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Payment</th>
                </tr>
              </thead>
              <tbody>
                {pagedLedger.map((order) => (
                  <tr key={order.id} className={`border-b ${t.divider}`}>
                    <td className={`py-2 pr-3 ${t.accent}`}>#{order.id.slice(-6).toUpperCase()}</td>
                    <td className={`py-2 pr-3 ${t.body}`}>
                      {order.created_at?.toDate?.().toLocaleString([], { dateStyle: "short", timeStyle: "short" }) || "—"}
                    </td>
                    <td className={`py-2 pr-3 ${t.heading}`}>{order.student_name || order.studentName || "—"}</td>
                    <td className={`py-2 pr-3 max-w-[220px] truncate ${t.body}`}>{order.item_name || order.itemName || "—"}</td>
                    <td className={`py-2 pr-3 font-bold ${t.heading}`}>{money(order.price)}</td>
                    <td className={`py-2 pr-3 uppercase ${t.body}`}>{order.payment_status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`mt-4 flex items-center justify-between text-[10px] uppercase tracking-widest ${t.label}`}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className={`border px-3 py-1.5 disabled:opacity-30 ${t.accentBorder}`}
            >
              Prev
            </button>
            <span>Page {safePage + 1} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className={`border px-3 py-1.5 disabled:opacity-30 ${t.accentBorder}`}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
