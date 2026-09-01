import { toTitleCase } from "../UserMenu/helpers";

// ─── HomeHero — the DISCOVER step of the ordering loop (spec §2, §20-23) ─────
// Sits directly under the sticky header. Two-column layout: copy + live stats on
// the left, the clean tilted food shot anchored to the container's right edge.
// Everything rendered is real live data: open-stall count, average queueing-model
// wait, and dish count. The greeting is time-of-day aware and names the
// signed-in student; the search bar is the hero and quick actions drop straight
// into ordering.

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Late night";
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}

export default function HomeHero({
  user,
  onOpenSearch,
  stallLiveStats,
  allProductsRaw,
  onBrowseMenu,
  onOpenMealPass,
}) {
  const openStalls = stallLiveStats.filter((stall) => stall.isOpen);
  const openCount = openStalls.length;
  const waits = openStalls.map((stall) => Math.max(1, Math.round(stall.queueMetrics.estimatedWaitMin)));
  const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;

  const firstName = toTitleCase(user?.displayName?.split(" ")[0] || user?.email?.split("@")[0] || "");
  const greeting = greetingFor(new Date().getHours());

  return (
    <section
      className="relative mb-6 overflow-hidden rounded-[24px] border lg:mb-6"
      style={{
        borderColor: "var(--color-feature-border)",
        background: "var(--color-feature-surface)",
      }}
      aria-labelledby="home-hero-title"
    >
      {/* ─── Two-column hero: copy left, the clean tilted shot anchored to the
          container's RIGHT edge. The section is sized to sit a little inside the
          viewport fold (below sticky header + bottom rail), with the margin under
          it absorbing the slack — so the whole card fits on screen while the rest
          of the home feed stays fully below the fold until the user scrolls. The
          image column stretches to absorb the remaining height so nothing bleeds
          out of the card. ───── */}
      <div className="grid min-h-[calc(100dvh-9.5rem)] grid-rows-1 items-center gap-6 p-5 sm:p-7 lg:min-h-[calc(100dvh-6.5rem)] lg:grid-cols-2 lg:items-stretch lg:gap-8 lg:p-8">
        <div className="relative z-10 lg:self-center">
          <p className="cc-kicker mb-3">Order ahead · Skip the queue</p>
          <h1 id="home-hero-title" className="max-w-xl">
            {firstName ? (
              <>
                {/* The personal greeting leads in the display serif (Athelas); the question
                    shares the same stack — serif for the emotional beat, serif display for
                    the functional ask. */}
                <span
                  className="font-display block text-[clamp(2.5rem,5.5vw,3.9rem)] font-bold leading-[1.02]"
                  style={{ color: "var(--color-primary)" }}
                >
                  {greeting}, {firstName}.
                </span>
                <span className="font-display mt-1.5 block text-[clamp(1.3rem,2.6vw,2rem)] font-bold leading-[1.2] tracking-tight">
                  What's cooking across campus today?
                </span>
              </>
            ) : (
              <span className="font-display block text-[clamp(2rem,4.5vw,3.25rem)] font-bold leading-[1.04] tracking-tight">
                What's cooking across campus today?
              </span>
            )}
          </h1>
          <p className="cc-muted mt-4 max-w-md text-[15px] leading-relaxed">
            Live menus from all six stalls. Order ahead, know your wait before you walk over, and pick up the moment it's ready.
          </p>

          {/* The hero search — one tap to the command center */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="mt-6 flex w-full max-w-md items-center gap-3 rounded-2xl px-5 py-4 text-left shadow-sm transition active:scale-[0.99]"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border-strong)",
              color: "var(--color-text)",
            }}
          >
            <SearchIcon />
            <span className="cc-muted flex-1 text-sm font-medium">Search stalls, dishes, or cravings…</span>
            <kbd
              className="hidden rounded-md px-2 py-1 text-[10px] font-bold uppercase sm:block"
              style={{ background: "color-mix(in srgb, var(--color-text-muted) 14%, transparent)", color: "var(--color-text-muted)" }}
            >
              ⌘K
            </kbd>
          </button>

          {/* Live snapshot — all real, from the queueing model */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5 text-xs font-bold">
            <span
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-2"
              style={{ background: "color-mix(in srgb, var(--color-success) 12%, transparent)", color: "var(--color-success)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
              {openCount} {openCount === 1 ? "stall" : "stalls"} open now
            </span>
            {avgWait != null && (
              <span
                className="rounded-full px-3.5 py-2"
                style={{ background: "color-mix(in srgb, var(--color-text-muted) 10%, transparent)", color: "var(--color-text-muted)" }}
              >
                ~{avgWait} min average wait
              </span>
            )}
            {allProductsRaw.length > 0 && (
              <span
                className="rounded-full px-3.5 py-2"
                style={{ background: "color-mix(in srgb, var(--color-text-muted) 10%, transparent)", color: "var(--color-text-muted)" }}
              >
                {allProductsRaw.length} dishes live
              </span>
            )}
          </div>

          {/* Quick actions */}
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={onBrowseMenu} className="cc-btn cc-btn-primary">
              Start an order
            </button>
            <button type="button" onClick={onOpenMealPass} className="cc-btn cc-btn-outline">
              Save with a meal pass
            </button>
          </div>
        </div>

        {/* Real food photography — desktop-only (hidden below lg) so the mobile
            hero stays a single, compact "order ahead" panel. Full-bleed cover
            filling its column: the frame is exactly the grid cell (absolute
            inset-0), so the shot never spills out of the container; object-cover
            + a compensating scale keep the editorial tilt while every edge stays
            inside the frame. No text overlay. */}
        <div className="relative hidden min-h-0 lg:block">
          <div className="absolute inset-0 overflow-hidden rounded-[20px] shadow-[0_30px_70px_-28px_rgba(74,53,37,0.6)]">
            <img
              src="/images/chicken-hyderabadi-biryani-01.jpg"
              alt="Chicken roll fresh from the campus kitchen"
              className="h-full w-full rotate-[2.5deg] scale-[1.12] object-cover object-center"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
