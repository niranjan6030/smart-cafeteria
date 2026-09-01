import SectionHeader from "../ui/SectionHeader";
import MenuItemCard from "../UserMenu/MenuItemCard";
import MenuItemSkeleton from "../UserMenu/MenuItemSkeleton";
import { rankPopularity } from "./rankPopularity";

// ─── HomeRecommendations — "Your usuals" / "Made for you" / "Popular" ─────────
// The personal bands reuse the SAME recommender engine output that powers the
// Menu tab: "Your usuals" surfaces dishes the student has genuinely ordered
// before (real history), "Made for you" is the rest of the personalised blend
// (similar/co-occurrence/meal-time picks with real reasons). The popularity band
// ranks across ALL stalls from genuinely-social items (items with review counts
// or a best-seller flag); if no item qualifies, that band doesn't render — we
// never fabricate popularity. Cards are self-contained: no text underneath
// (spec §5), the "why" lives in the section label only.

export default function HomeRecommendations({
  user,
  hasHistory,
  recommendations,
  loading,
  allProductsRaw,
  cart,
  updateQuantity,
  onLoginClick,
  onBrowseMenu,
}) {
  const usualsPicks = recommendations.filter((rec) => rec.timesOrdered > 0);
  const similarPicks = recommendations.filter((rec) => rec.timesOrdered === 0 && rec.reasonType === "similar");
  const otherPicks = recommendations.filter((rec) => rec.timesOrdered === 0 && rec.reasonType !== "similar");
  const madeForYou = [...similarPicks, ...otherPicks];
  const popularPicks = rankPopularity(allProductsRaw);

  const renderCard = (rec) => {
    const quantity = cart.find((entry) => entry.id === rec.item.id)?.quantity || 0;
    return (
      <MenuItemCard
        key={rec.itemId}
        item={rec.item}
        quantity={quantity}
        onAdd={() => updateQuantity(rec.item, 1)}
        onRemove={() => updateQuantity(rec.item, -1)}
        onRate={() => onLoginClick?.()}
      />
    );
  };

  const renderGrid = (picks) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {picks.map(renderCard)}
    </div>
  );

  return (
    <div className="mb-16">
      <div className="cc-feature-section rounded-[24px]">
      {/* Signed-in, no history yet — honest empty state, never fabricated picks */}
      {user && !hasHistory && !loading && (
        <section className="mb-12" aria-label="Still learning your taste">
          <SectionHeader
            kicker="Made for you"
            title="We're still learning your taste"
            subtitle="Order a couple of things and your personal picks will show up here."
          />
          <div
            className="cc-card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center"
            style={{ background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}
          >
            <span className="text-3xl">🌱</span>
            <div className="flex-1">
              <p className="text-sm font-bold">Start with a campus favourite</p>
              <p className="cc-muted mt-1 text-xs leading-relaxed">
                The more you order, the smarter these picks get — including the "frequently bought together" combos below.
              </p>
            </div>
            <button type="button" onClick={onBrowseMenu} className="cc-btn cc-btn-primary">
              Browse the menu
            </button>
          </div>
        </section>
      )}

      {/* Personalised bands — only for students with real order history */}
      {usualsPicks.length > 0 && (
        <section className="mb-12" aria-label="Your usuals">
          <SectionHeader
            kicker="Ordered before"
            title="Your usuals"
            subtitle="Dishes you keep coming back to, ready to reorder."
          />
          {renderGrid(usualsPicks)}
        </section>
      )}

      {madeForYou.length > 0 && (
        <section className="mb-12" aria-label="Made for you">
          <SectionHeader
            kicker="Made for you"
            title="You might like these next"
            subtitle="Similar to your favourites and what pairs with them."
          />
          {renderGrid(madeForYou)}
        </section>
      )}

      {/* Loading placeholder only while the personal band is still streaming */}
      {loading && (
        <section className="mb-12">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <MenuItemSkeleton key={index} />
            ))}
          </div>
        </section>
      )}

      {/* Cross-campus popularity */}
      {popularPicks.length > 0 && (
        <section className="mb-12" aria-label="Popular today">
          <SectionHeader
            kicker="Most loved on campus"
            title="Popular today"
            subtitle="Ranked by real student ratings and order volume."
            action={
              !user && (
                <button type="button" onClick={onLoginClick} className="cc-btn cc-btn-outline !px-4 !py-2 text-xs">
                  Sign in for personal picks
                </button>
              )
            }
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {popularPicks.map((item) => {
              const quantity = cart.find((entry) => entry.id === item.id)?.quantity || 0;
              return (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  quantity={quantity}
                  onAdd={() => updateQuantity(item, 1)}
                  onRemove={() => updateQuantity(item, -1)}
                  onRate={() => onLoginClick?.()}
                />
              );
            })}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
