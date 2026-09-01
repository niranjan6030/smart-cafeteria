import { useState } from "react";
import { BULK_EVENT_TYPES, money, stallDisplayName } from "./helpers";

// ─── Feature 1: BulkOrderModal ────────────────────────────────────────────────
export default function BulkOrderModal({ user, activeShop, cart, darkMode, onClose, onSubmit }) {
  const studentName = user?.displayName || user?.email?.split("@")[0] || "Requester";
  const [form, setForm] = useState({
    department_name: "",
    event_type: BULK_EVENT_TYPES[0],
    scheduled_delivery_timestamp: "",
    poc_phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const cartTotal = cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const handleSubmit = async () => {
    if (!form.department_name.trim()) return alert("Enter the department name.");
    if (!form.scheduled_delivery_timestamp) return alert("Select a delivery date and time.");
    if (!form.poc_phone.trim()) return alert("Enter an alternate point-of-contact phone number.");
    if (!cart.length) return alert("Add items to cart before placing a bulk order.");
    setSubmitting(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (error) {
      alert(error.message || "Bulk order submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <button aria-label="Close bulk order modal" className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <section className={`relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl ${darkMode ? "bg-[#141414] border-white/10 text-white" : "bg-[#FDF8F5] border-gold-100 text-[#4A3525]"}`}>
        <div className={`sticky top-0 z-10 flex items-center justify-between gap-4 border-b p-6 ${darkMode ? "bg-[#141414] border-white/10" : "bg-[#FDF8F5] border-gold-100"}`}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#E06A3B]">Institutional Order</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Place Bulk Order</h2>
            <p className={`mt-1 text-xs ${darkMode ? "text-white/55" : "text-stone-500"}`}>{stallDisplayName(activeShop)} — {cartCount} items — {money(cartTotal)}</p>
          </div>
          <button onClick={onClose} className={`grid h-11 w-11 place-items-center rounded-2xl border text-xl font-bold transition active:scale-95 ${darkMode ? "border-white/10 hover:bg-white/10" : "border-gold-100 hover:bg-gold-50"}`}>×</button>
        </div>

        <div className="space-y-5 p-6">
          {cart.length === 0 && (
            <div className={`rounded-2xl border border-dashed p-5 text-center text-xs font-semibold ${darkMode ? "border-white/15 text-white/50" : "border-gold-200 text-stone-500"}`}>
              Add items to your cart first, then open this form.
            </div>
          )}

          <div>
            <label className={`mb-2 block text-[10px] font-black uppercase tracking-[0.24em] ${darkMode ? "text-white/45" : "text-stone-500"}`}>Department / Organisation</label>
            <input
              value={form.department_name}
              onChange={(e) => setForm({ ...form, department_name: e.target.value })}
              placeholder="e.g. Dept. of Computer Science"
              className={bulkInputClass(darkMode)}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[10px] font-black uppercase tracking-[0.24em] ${darkMode ? "text-white/45" : "text-stone-500"}`}>Event Type</label>
            <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className={bulkInputClass(darkMode)}>
              {BULK_EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className={`mb-2 block text-[10px] font-black uppercase tracking-[0.24em] ${darkMode ? "text-white/45" : "text-stone-500"}`}>Scheduled Delivery Time</label>
            <input
              type="datetime-local"
              value={form.scheduled_delivery_timestamp}
              onChange={(e) => setForm({ ...form, scheduled_delivery_timestamp: e.target.value })}
              className={bulkInputClass(darkMode)}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[10px] font-black uppercase tracking-[0.24em] ${darkMode ? "text-white/45" : "text-stone-500"}`}>Alternate Point-of-Contact Phone</label>
            <input
              type="tel"
              value={form.poc_phone}
              onChange={(e) => setForm({ ...form, poc_phone: e.target.value })}
              placeholder="+91 98765 43210"
              className={bulkInputClass(darkMode)}
            />
          </div>

          {/* Cart summary */}
          {cart.length > 0 && (
            <div className={`rounded-2xl border p-4 ${darkMode ? "bg-white/5 border-white/10" : "bg-gold-50/70 border-gold-100"}`}>
              <p className={`mb-3 text-[10px] font-black uppercase tracking-widest ${darkMode ? "text-white/55" : "text-stone-500"}`}>Order Summary</p>
              <div className="space-y-2">
                {cart.map((item) => (
                  <div key={item.id} className="flex justify-between text-xs font-bold">
                    <span>{item.name} × {item.quantity}</span>
                    <span>{money(Number(item.price) * item.quantity)}</span>
                  </div>
                ))}
                <div className={`mt-3 flex justify-between border-t pt-3 text-sm font-black ${darkMode ? "border-white/10" : "border-gold-100"}`}>
                  <span>Total</span>
                  <span className="text-[#E06A3B]">{money(cartTotal)}</span>
                </div>
              </div>
            </div>
          )}

          <button
            disabled={submitting || cart.length === 0}
            onClick={handleSubmit}
            className="w-full rounded-2xl bg-[color:var(--color-primary)] px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-[color:var(--color-bg-deep)] shadow-lg transition hover:bg-[color:var(--color-primary-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Processing..." : `Confirm Bulk Order — ${money(cartTotal)}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function bulkInputClass(darkMode) {
  return `w-full rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition ${darkMode ? "border-white/10 bg-black/20 text-white placeholder:text-white/30 focus:border-[#E06A3B]" : "border-gold-100 bg-gold-50 focus:border-[#E06A3B]"}`;
}
