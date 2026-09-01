// ─── EditorialFeature — a hero-as-editorial moment (spec §29) ─────────────────
// The meal-pass value proposition, wrapped in the app's editorial voice with a
// real kitchen photograph behind it. No mock numbers: the savings claims come
// straight from the actual MEAL_PASS_PLANS multiplier table in helpers.js.
import { MEAL_PASS_PLANS } from "../UserMenu/helpers";

export default function EditorialFeature({ onOpenMealPass, onBrowseMenu, isFacultyAdmin, onOpenBulk }) {
  const best = MEAL_PASS_PLANS.reduce((a, b) => (a.priceMultiplier < b.priceMultiplier ? a : b));
  const savings = Math.round((1 - best.priceMultiplier) * 100);

  return (
    <section className="mb-16" aria-label="Meal passes">
      <div className="cc-feature-panel relative overflow-hidden rounded-[24px] p-8 sm:p-10">
        <img
          src="/images/kerala_meals.jpg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-1/2 hidden h-[115%] -translate-y-1/2 rotate-6 rounded-2xl object-cover opacity-40 sm:block sm:w-[46%]"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        <div className="relative z-10 max-w-xl">
          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.24em]" style={{ color: "var(--color-primary)" }}>
            Meal Pass
          </p>
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            <span className="font-display">Eat daily on campus,</span>{" "}
            <span className="font-display" style={{ color: "var(--color-primary)" }}>
              for up to {savings}% less.
            </span>
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed" style={{ color: "rgba(253,248,245,0.72)" }}>
            A 2-day pass through a full monthly plan covers your daily order across every stall. Buy once, collect with a pass code, and never queue for a reorder again.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onOpenMealPass}
              className="rounded-full px-6 py-3.5 text-sm font-extrabold"
              style={{ background: "var(--color-primary)", color: "#2E2016" }}
            >
              Explore meal passes
            </button>
            <button
              type="button"
              onClick={onBrowseMenu}
              className="rounded-full border px-6 py-3.5 text-sm font-bold transition"
              style={{ borderColor: "rgba(253,248,245,0.25)", color: "#FDF8F5" }}
            >
              Order from the Menu
            </button>
          </div>
          {isFacultyAdmin && (
            <button
              type="button"
              onClick={onOpenBulk}
              className="mt-4 block text-xs font-bold uppercase tracking-widest underline-offset-4 hover:underline"
              style={{ color: "var(--color-primary)" }}
            >
              Place an institutional bulk order →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
