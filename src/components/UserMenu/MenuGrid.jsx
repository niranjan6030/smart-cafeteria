import MenuItemCard from "./MenuItemCard";
import MenuItemSkeleton from "./MenuItemSkeleton";
import RevealOnScroll from "./RevealOnScroll";
import SectionHeader from "../ui/SectionHeader";
import EmptyState from "../ui/EmptyState";
import { stallDisplayName } from "./helpers";

// ─── MenuGrid — full searchable menu for the active stall ─────────────────────
export default function MenuGrid({
  activeShop,
  browseChips = [],
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  isShopBusy,
  isShopOpen,
  shopResumingAt,
  menuLoading,
  filteredItems,
  cart,
  updateQuantity,
  rateMenuItem,
}) {
  const activeFilterLabel = browseChips.find((chip) => chip.id === categoryFilter)?.label || categoryFilter;
  return (
    <section id="menu">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader kicker="Menu" title={stallDisplayName(activeShop)} className="!mb-0" />
        <input
          type="text"
          placeholder={`Search ${stallDisplayName(activeShop)}…`}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="cc-input sm:!w-[340px]"
          aria-label={`Search ${stallDisplayName(activeShop)} menu`}
        />
      </div>

      {browseChips.length > 0 && (
        <div className="cc-no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Quick filters">
          {browseChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setCategoryFilter(categoryFilter === chip.id ? "" : chip.id)}
              className={`cc-chip shrink-0 ${categoryFilter === chip.id ? "cc-chip-active" : ""}`}
              aria-pressed={categoryFilter === chip.id}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <RevealOnScroll className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isShopBusy && isShopOpen && (
          <div className="absolute inset-0 z-20 grid place-items-center rounded-[24px] bg-black/60 p-6">
            <div
              className="w-full max-w-md rounded-2xl border px-6 py-5 text-center"
              style={{ borderColor: "color-mix(in srgb, var(--color-warning) 50%, transparent)", background: "color-mix(in srgb, var(--color-warning) 14%, transparent)" }}
            >
              <p className="text-sm font-extrabold leading-6" style={{ color: "var(--color-warning)" }}>
                ⚠️ Kitchen is temporarily overwhelmed. Orders are pausing to clear the queue
                {shopResumingAt ? `, resuming at ${shopResumingAt}` : ""}.
              </p>
            </div>
          </div>
        )}

        {!isShopOpen && !isShopBusy && (
          <div className="absolute inset-0 z-20 grid place-items-center rounded-[24px] bg-black/70">
            <div className="rounded-2xl bg-red-600 px-8 py-4 text-xs font-extrabold uppercase tracking-[0.28em] text-white">
              Kitchen Closed
            </div>
          </div>
        )}

        {menuLoading ? (
                Array.from({ length: 6 }).map((_, index) => <MenuItemSkeleton key={index} />)
        ) : (
          <>
            {filteredItems.map((item) => {
              const quantity = cart.find((entry) => entry.id === item.id)?.quantity || 0;
              return (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  quantity={quantity}
                  onAdd={() => updateQuantity(item, 1)}
                  onRemove={() => updateQuantity(item, -1)}
                  onRate={(stars) => rateMenuItem(item, stars)}
                />
              );
            })}

            {filteredItems.length === 0 && (
              <div className="col-span-full">
                <EmptyState
                  icon={<span className="text-2xl">🍽️</span>}
                  title="No menu items found"
                  subtitle={`Nothing in ${stallDisplayName(activeShop)} matches that search${activeFilterLabel ? ` in ${activeFilterLabel}` : ""}. Try a different dish or clear the filter.`}
                  action={
                    <button type="button" onClick={() => { setSearchQuery(""); setCategoryFilter(""); }} className="cc-btn cc-btn-outline text-sm">
                      Clear search & filters
                    </button>
                  }
                />
              </div>
            )}
          </>
        )}
      </RevealOnScroll>
    </section>
  );
}
