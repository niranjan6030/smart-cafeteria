import { useEffect, useRef, useState } from "react";
import MenuItemCard from "./UserMenu/MenuItemCard";
import { stallDisplayName } from "./UserMenu/helpers";

/**
 * StallDiscoverySearch — full-screen search command center for UserMenu.jsx.
 * Purely presentational: every result it renders is computed from real, already-fetched
 * Firestore data (see stallLiveStats/dishSearchResults in UserMenu.jsx) — no mock data and
 * no Firestore imports of its own. Empty query shows a smart "start here" view: recent
 * searches (localStorage), the student's usuals (recommender frequent picks), and popular
 * dishes now. Search is the primary action: autofocused input, ⌘K/esc handling,
 * stalls/dishes tabs, and a top-match stall card. Every dish card reuses the shared
 * MenuItemCard so search suggestions read exactly like the menu cards they come from.
 */

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0">
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v5l3 2" />
    </svg>
  );
}

function StallCard({ stall, onSelect, size }) {
  const isHero = size === "hero";
  return (
    <button
      onClick={() => onSelect(stall.name)}
      className="cc-card cc-card-hover flex w-full gap-4 rounded-xl p-3 text-left"
    >
      <div className={`relative shrink-0 overflow-hidden rounded-lg ${isHero ? "h-28 w-28" : "h-20 w-20"}`} style={{ background: "var(--color-surface)" }}>
        {stall.image ? (
          <img src={stall.image} alt={stall.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-2xl">🍽️</div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-sm font-extrabold">{stallDisplayName(stall.name)}</h3>
        <p className="text-xs font-bold" style={{ color: stall.isOpen ? "var(--color-success)" : "var(--color-error)" }}>
          {stall.isOpen ? (stall.isBusy ? "Busy" : "Open now") : "Closed"}
        </p>
        {stall.categories.length > 0 && (
          <p className="cc-muted truncate text-xs">{stall.categories.join(", ")}</p>
        )}
        <p className="text-xs font-bold" style={{ color: "var(--color-primary-strong)" }}>
          ~{Math.max(1, Math.round(stall.queueMetrics.estimatedWaitMin))} min wait
        </p>
      </div>
    </button>
  );
}

// Dish suggestions and results reuse the app-wide MenuItemCard (the same card the menu
// grid renders), so tapping "+" here drops the item into the same shared cart.

export default function StallDiscoverySearch({
  query,
  onQueryChange,
  onClose,
  stallResults,
  dishResults,
  onSelectStall,
  onSelectDish,
  usuals = [],
  popularDishes = [],
  cart = [],
  updateQuantity,
}) {
  const [activeResultTab, setActiveResultTab] = useState("stalls");
  const [heroStall, ...otherStalls] = stallResults;
  const inputRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(null);

  // Arrow keys walk the dish results; Enter quick-adds (or jumps to the stall) of the
  // highlighted dish. Stays scoped to the dishes tab so stalls stay mouse-only.
  const handleInputKeyDown = (e) => {
    const dishesVisible = query.trim() !== "" && activeResultTab === "dishes" && dishResults.length > 0;
    if (dishesVisible && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const last = dishResults.length - 1;
      setActiveIndex((idx) => {
        if (e.key === "ArrowDown") return idx === null ? 0 : Math.min(idx + 1, last);
        return idx === null ? last : Math.max(idx - 1, 0);
      });
      return;
    }
    if (dishesVisible && e.key === "Enter" && activeIndex != null && dishResults[activeIndex]) {
      e.preventDefault();
      const item = dishResults[activeIndex];
      if (updateQuantity) updateQuantity(item, 1);
      else pickDish(item);
      return;
    }
    if (e.key === "Enter") submitSearch(query);
  };

  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem("recentSearches") || "[]"); } catch { return []; }
  });
  const saveRecentSearch = (term) => {
    const trimmed = (term || "").trim();
    if (!trimmed) return;
    const next = [trimmed, ...recentSearches.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(0, 5);
    setRecentSearches(next);
    localStorage.setItem("recentSearches", JSON.stringify(next));
  };
  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem("recentSearches");
  };

  // Escape closes the command center; ⌘K focuses the search box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const focusSearch = () => inputRef.current?.focus();

  const submitSearch = (term) => {
    saveRecentSearch(term);
    focusSearch();
  };

  const pickStall = (name) => {
    saveRecentSearch(query);
    onSelectStall(name);
  };

  const pickDish = (item) => {
    saveRecentSearch(query);
    onSelectDish(item);
  };

  const cartQuantity = (id) => cart.find((entry) => entry.id === id)?.quantity || 0;

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto" style={{ background: "var(--color-bg)" }} role="dialog" aria-modal="true" aria-label="Search stalls and dishes">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {/* Command bar */}
        <div
          className="mb-6 flex items-center gap-3 rounded-2xl border px-5 py-4 shadow-lg"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-surface)" }}
        >
          <button onClick={onClose} aria-label="Back" className="cc-muted transition" style={{ color: "var(--color-text)" }}>
            <ChevronLeftIcon />
          </button>
          <SearchIcon />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => { setActiveIndex(null); onQueryChange(e.target.value); }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search for stalls, dishes…"
            className="w-full bg-transparent text-base font-bold outline-none"
            style={{ color: "var(--color-text)" }}
          />
          <button onClick={onClose} aria-label="Close search" className="cc-muted">
            <CloseIcon />
          </button>
        </div>

        {query.trim() !== "" && activeResultTab === "dishes" && dishResults.length > 0 && (
          <p className="cc-muted mb-6 text-center text-[11px] font-bold">
            Use ↑ ↓ to move through dishes · Enter to add
          </p>
        )}

        {query.trim() === "" ? (
          <div>
            {recentSearches.length > 0 && (
              <section className="mb-8" aria-label="Recent searches">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 text-sm font-bold">
                    <span style={{ color: "var(--color-text-muted)" }}><ClockIcon /></span>
                    Recent searches
                  </h2>
                  <button onClick={clearRecentSearches} className="cc-muted text-xs font-bold hover:underline">
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => { onQueryChange(term); submitSearch(term); }}
                      className="cc-chip"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {usuals.length > 0 && (
              <section className="mb-8" aria-label="Your usuals">
                <h2 className="mb-3 text-sm font-bold">Your usuals</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {usuals.slice(0, 4).map((rec) => (
                    <MenuItemCard
                      key={rec.itemId}
                      item={rec.item}
                      quantity={cartQuantity(rec.item.id)}
                      onAdd={updateQuantity ? () => updateQuantity(rec.item, 1) : undefined}
                      onRemove={updateQuantity ? () => updateQuantity(rec.item, -1) : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {popularDishes.length > 0 && (
              <section className="mb-8" aria-label="Popular right now">
                <h2 className="mb-3 text-sm font-bold">Popular right now</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {popularDishes.slice(0, 4).map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      quantity={cartQuantity(item.id)}
                      onAdd={updateQuantity ? () => updateQuantity(item, 1) : undefined}
                      onRemove={updateQuantity ? () => updateQuantity(item, -1) : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {recentSearches.length === 0 && usuals.length === 0 && popularDishes.length === 0 && (
              <p className="cc-muted py-16 text-center text-sm font-semibold">
                Search stalls or dishes to get started.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="mb-6 flex gap-8 border-b px-1" style={{ borderColor: "var(--color-border)" }}>
              {["stalls", "dishes"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveIndex(null); setActiveResultTab(tab); }}
                  className="relative pb-3 text-sm font-bold capitalize transition-colors"
                  style={{ color: activeResultTab === tab ? "var(--color-text)" : "var(--color-text-muted)" }}
                >
                  {tab} {tab === "stalls" ? `(${stallResults.length})` : `(${dishResults.length})`}
                  {activeResultTab === tab && (
                    <span className="cc-gold-gradient absolute inset-x-0 -bottom-px h-[3px] rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {activeResultTab === "stalls" ? (
              stallResults.length === 0 ? (
                <p className="cc-muted py-16 text-center text-sm font-semibold">No stalls match "{query}".</p>
              ) : (
                <>
                  <div className="mb-8">
                    <p className="cc-kicker mb-2">Top match</p>
                    <StallCard stall={heroStall} onSelect={pickStall} size="hero" />
                  </div>
                  {otherStalls.length > 0 && (
                    <>
                      <h2 className="mb-4 text-sm font-bold">More results like this</h2>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {otherStalls.map((stall) => (
                          <StallCard key={stall.name} stall={stall} onSelect={pickStall} size="grid" />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )
            ) : dishResults.length === 0 ? (
              <p className="cc-muted py-16 text-center text-sm font-semibold">No dishes match "{query}".</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {dishResults.map((item, index) => (
                  <div
                    key={item.id}
                    className="rounded-[1.25rem]"
                    style={index === activeIndex ? { outline: "2px solid var(--color-primary)", outlineOffset: "2px" } : undefined}
                  >
                    <MenuItemCard
                      item={item}
                      quantity={cartQuantity(item.id)}
                      onAdd={updateQuantity ? () => updateQuantity(item, 1) : undefined}
                      onRemove={updateQuantity ? () => updateQuantity(item, -1) : undefined}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
