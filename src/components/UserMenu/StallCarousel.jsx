import RevealOnScroll from "./RevealOnScroll";
import SectionHeader from "../ui/SectionHeader";
import Badge from "../ui/Badge";
import { useHorizontalWheelScroll } from "../../hooks/useHorizontalWheelScroll";
import { stallDisplayName } from "./helpers";

// ─── StallCarousel — "Browse all stalls" directory (real live data) ───────────
// Reused both on the Menu tab and as the full directory on Home. Cards carry the
// queueing-model wait, real open/busy state, and real product counts/imagery.
export default function StallCarousel({
  stallLiveStats,
  stallSliderRef,
  handleStallSliderScroll,
  stallSlideIndex,
  scrollStallSliderTo,
  handleSelectStallFromDiscovery,
}) {
  // Mouse wheel scrolls the row horizontally (desktop friendliness); the dots still
  // derive from the SAME deduped list that renders the cards below.
  useHorizontalWheelScroll(stallSliderRef);
  // One dot per stall card — derived from the SAME deduped list that renders the cards, so the
  // dot count can never drift from the card count (dedupe guards against duplicate entries).
  const stalls = stallLiveStats.filter((s, index, all) => all.findIndex((x) => x.name === s.name) === index);
  const dotCount = stalls.length;
  const activeDot = Math.max(0, Math.min(stallSlideIndex, dotCount - 1));

  return (
    <RevealOnScroll as="section" className="cc-fade-in-up mb-10">
      <SectionHeader
        kicker="Browse the stalls"
        title="Discover stalls on campus"
        subtitle="Live status, real waits, and real menus — all six in one place."
      />
      <div
        ref={stallSliderRef}
        onScroll={handleStallSliderScroll}
        className="cc-no-scrollbar cc-snap-x flex gap-4 overflow-x-auto pb-2"
      >
        {stalls.map((stall) => {
          const wait = Math.max(1, Math.round(stall.queueMetrics.estimatedWaitMin));
          return (
            <div
              key={stall.name}
              className="cc-card cc-snap-start relative w-72 shrink-0 overflow-hidden p-5"
              style={{ minHeight: 210 }}
            >
              <Badge tone={stall.isOpen ? (stall.isBusy ? "warning" : "success") : "error"} dot>
                {stall.isOpen ? (stall.isBusy ? "Busy" : "Open now") : "Closed"}
              </Badge>

              <h3 className="font-display mt-3 max-w-[65%] text-xl font-bold leading-tight tracking-tight">{stallDisplayName(stall.name)}</h3>
              {stall.categories.length > 0 && (
                <p className="cc-muted mt-1 max-w-[65%] truncate text-xs font-medium">{stall.categories.join(", ")}</p>
              )}

              <span
                className="mt-4 inline-block rounded-full px-3 py-1.5 text-xs font-extrabold"
                style={{ background: "color-mix(in srgb, var(--color-primary) 16%, transparent)", color: "var(--color-primary-strong)" }}
              >
                ~{wait} min wait
              </span>

              {stall.image && (
                <img
                  src={stall.image}
                  alt=""
                  aria-hidden="true"
                  className="absolute -bottom-3 -right-3 h-28 w-28 rotate-3 rounded-xl border-4 object-cover shadow-lg"
                  style={{ borderColor: "var(--color-bg)" }}
                />
              )}

              <button
                onClick={() => handleSelectStallFromDiscovery(stall.name)}
                aria-label={`Browse ${stallDisplayName(stall.name)}`}
                className="absolute bottom-4 left-4 grid h-8 w-8 place-items-center rounded-full text-sm transition-transform hover:scale-105 active:scale-95"
                style={{ background: "var(--color-primary)", color: "var(--color-bg-deep)" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      {dotCount > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {stalls.map((stall, dotIndex) => (
            <button
              key={stall.name}
              onClick={() => scrollStallSliderTo(dotIndex)}
              aria-label={`Go to ${stallDisplayName(stall.name)}`}
              aria-current={dotIndex === activeDot ? "true" : undefined}
              className={`h-1.5 rounded-full transition-all duration-200 ease-out ${
                dotIndex === activeDot ? "w-6" : "w-1.5"
              }`}
              style={{
                background: dotIndex === activeDot ? "var(--color-primary)" : "var(--color-border-strong)",
              }}
            />
          ))}
        </div>
      )}
    </RevealOnScroll>
  );
}
