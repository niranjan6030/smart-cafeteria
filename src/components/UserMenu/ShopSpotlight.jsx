import { waitLabel } from "../../queueingModel";
import { formatHourLabel } from "../../demandForecast";
import { itemImage, stallDisplayName } from "./helpers";
import RevealOnScroll from "./RevealOnScroll";

// ─── ShopSpotlight — the active stall's hero card (menu tab) ──────────────────
// All operational numbers come from the real queueing model + demand forecast;
// the "good time to order" nudge only appears when utilization is genuinely low.
export default function ShopSpotlight({
  activeShop,
  queueMetrics,
  demandForecast,
  setShowMealPassModal,
  isFacultyAdmin,
  setShowBulkModal,
  shopBroadcast,
  featuredItems,
}) {
  const quiet = !queueMetrics.isColdStart && waitLabel(queueMetrics.utilization) === "Quiet";
  return (
    <RevealOnScroll as="section" className="cc-card cc-card-hover cc-fade-in-up mb-10 overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_.9fr]">
        <div className="p-6 sm:p-8 lg:p-10">
          <p className="cc-kicker mb-3">Christ University Cafeteria</p>
          <h1 className="max-w-2xl">
            <span className="font-display block text-[clamp(1.1rem,1rem+0.6vw,1.35rem)] font-bold leading-tight tracking-tight">
              Order hot food from
            </span>
            <span
              className="font-display mt-1 block text-[clamp(2.5rem,2.1rem+2.4vw,3.7rem)] font-bold leading-[1.02]"
              style={{ color: "var(--color-primary)" }}
            >
              {stallDisplayName(activeShop)}
            </span>
          </h1>
          <p className="cc-muted mt-4 max-w-xl text-sm leading-relaxed">
            Live menu, quick checkout, meal passes, and kitchen status in one place.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="cc-chip !cursor-default">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: quiet ? "var(--color-success)" : queueMetrics.utilization < 0.75 ? "var(--color-warning)" : "var(--color-error)" }}
              />
              Estimated wait: ~{Math.max(1, Math.round(queueMetrics.estimatedWaitMin))} min
              <span className="cc-muted text-[10px] font-extrabold uppercase tracking-widest">
                {waitLabel(queueMetrics.utilization)}{queueMetrics.isColdStart ? " · estimating" : ""}
              </span>
            </span>
            <span className="cc-chip !cursor-default">
              <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-primary)" }} />
              Quietest time: ~{formatHourLabel(demandForecast.quietestHour.hour)}
              {demandForecast.quietestHour.isTomorrow ? " (tomorrow)" : ""}
            </span>
          </div>
          {quiet && (
            <p className="mt-2 text-xs font-bold" style={{ color: "var(--color-success)" }}>
              — good time to order
            </p>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => setShowMealPassModal(true)} className="cc-btn cc-btn-primary !py-3 text-xs uppercase tracking-widest">
              Meal Pass
            </button>
            <a href="#menu" className="cc-btn cc-btn-outline !py-3 text-xs uppercase tracking-widest">
              Browse Menu
            </a>
            {isFacultyAdmin && (
              <button onClick={() => setShowBulkModal(true)} className="cc-btn cc-btn-outline !py-3 text-xs uppercase tracking-widest">
                Place Institutional Bulk Order
              </button>
            )}
          </div>

          {shopBroadcast && (
            <div
              className="mt-7 rounded-2xl border p-4 text-sm font-semibold"
              style={{
                borderColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)",
                background: "color-mix(in srgb, var(--color-primary) 10%, transparent)",
                color: "var(--color-primary-strong)",
              }}
            >
              {shopBroadcast}
            </div>
          )}
        </div>

        <div className="relative aspect-[4/3] w-full overflow-hidden sm:aspect-[16/11] lg:aspect-auto lg:h-full lg:min-h-[320px]">
          {featuredItems[0] && itemImage(featuredItems[0]) ? (
            <img src={itemImage(featuredItems[0])} alt={featuredItems[0].name} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-5xl font-extrabold" style={{ background: "var(--color-primary)", color: "#2E2016" }}>
              Fresh Food
            </div>
          )}
          <div className="cc-food-overlay absolute inset-0" />
          <div className="absolute bottom-6 left-6 right-6">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.28em]" style={{ color: "var(--color-primary)" }}>
              Today in focus
            </p>
            <p className="font-display mt-2 text-3xl font-bold text-white">{featuredItems[0]?.name || "Fresh specials"}</p>
          </div>
        </div>
      </div>
    </RevealOnScroll>
  );
}
