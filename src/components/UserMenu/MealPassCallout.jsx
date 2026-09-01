import { safeDate } from "./helpers";

// ─── MealPassCallout — "Active pass" / "Save with a pass" banner ──────────────
export default function MealPassCallout({ activePassForShop, onManage, activeClassName = "" }) {
  if (activePassForShop) {
    return (
      <div
        className={`${activeClassName} flex flex-col justify-between gap-4 rounded-[20px] border p-5 sm:flex-row sm:items-center`}
        style={{
          borderColor: "color-mix(in srgb, var(--color-primary) 35%, transparent)",
          background: "color-mix(in srgb, var(--color-primary) 9%, transparent)",
        }}
      >
        <div>
          <p className="cc-kicker mb-1">Active meal pass</p>
          <p className="text-lg font-extrabold">{activePassForShop.item_name} — {activePassForShop.plan_label}</p>
          <p className="cc-muted mt-1 text-xs">
            {activePassForShop.meals_remaining} meals left · {activePassForShop.meal_type} · expires {safeDate(activePassForShop.expiry)}
          </p>
        </div>
        <button onClick={onManage} className="cc-btn cc-btn-outline !py-2.5 text-xs uppercase tracking-widest">
          Manage
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onManage}
      className="cc-card flex w-full flex-col justify-between gap-3 border-dashed p-5 text-left transition hover:-translate-y-0.5 sm:flex-row sm:items-center"
      style={{ borderStyle: "dashed" }}
    >
      <div>
        <p className="text-sm font-extrabold uppercase tracking-widest">Save with a meal pass</p>
        <p className="cc-muted mt-1 text-xs">2-day, 3-day, weekly, and monthly plans for your daily order.</p>
      </div>
      <span
        className="rounded-xl px-4 py-2 text-xs font-extrabold uppercase tracking-widest"
        style={{ background: "var(--color-primary)", color: "var(--color-bg-deep)" }}
      >
        Get Pass
      </span>
    </button>
  );
}
