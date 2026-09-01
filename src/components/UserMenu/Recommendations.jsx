import MenuItemCard from "./MenuItemCard";
import MenuItemSkeleton from "./MenuItemSkeleton";
import SectionHeader from "../ui/SectionHeader";
import EmptyState from "../ui/EmptyState";

// ─── Recommendations — personalised picks for the active stall ────────────────
// Reuses the exact engine output + MenuItemCard so the section feels native.
// For students with history the band splits into "Your usuals" (dishes actually
// ordered before) and "You might like these next" (the rest of the blend); for
// everyone else it falls back to popular choices at the active stall. No text
// under the cards — the card carries everything it needs (spec §5).
function Grid({ picks, cart, updateQuantity, rateMenuItem }) {
  if (picks.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {picks.map((rec) => {
        const quantity = cart.find((entry) => entry.id === rec.itemId)?.quantity || 0;
        return (
          <MenuItemCard
            key={rec.itemId}
            item={rec.item}
            quantity={quantity}
            onAdd={() => updateQuantity(rec.item, 1)}
            onRemove={() => updateQuantity(rec.item, -1)}
            onRate={(stars) => rateMenuItem(rec.item, stars)}
          />
        );
      })}
    </div>
  );
}

export default function Recommendations({
  recommendations,
  hasHistory,
  loading,
  cart,
  updateQuantity,
  rateMenuItem,
  activeShop,
  user,
  onLoginClick,
}) {
  const usuals = recommendations.filter((rec) => rec.timesOrdered > 0);
  const nextPicks = recommendations.filter((rec) => rec.timesOrdered === 0);
  const popularSubtitle = `Popular choices at ${activeShop} right now${user ? "" : " — sign in for picks based on your orders"}`;

  return (
    <section className="mb-9" aria-label="Recommended for you">
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <MenuItemSkeleton key={index} />
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <>
          <SectionHeader
            kicker="Recommended for you"
            title="Recommended for You"
            subtitle={user && hasHistory ? "Based on your previous orders" : popularSubtitle}
            action={
              !user && (
                <button type="button" onClick={onLoginClick} className="cc-btn cc-btn-outline !px-4 !py-2 text-xs">
                  Sign in
                </button>
              )
            }
          />
          <EmptyState
            icon={<span className="text-2xl">✨</span>}
            title="Nothing to recommend here yet"
            subtitle="Add a few items and your picks will appear — check back soon."
          />
        </>
      ) : (
        <>
          {usuals.length > 0 && (
            <div className="mb-8">
              <SectionHeader
                kicker="Ordered before"
                title="Your usuals"
                subtitle="Dishes you keep coming back to, ready to reorder."
              />
              <Grid picks={usuals} cart={cart} updateQuantity={updateQuantity} rateMenuItem={rateMenuItem} />
            </div>
          )}

          {nextPicks.length > 0 && (
            <div>
              <SectionHeader
                kicker="Recommended for you"
                title={usuals.length > 0 ? "You might like these next" : "Recommended for You"}
                subtitle={
                  user && hasHistory
                    ? "Based on your previous orders"
                    : `Popular choices at ${activeShop} right now${user ? "" : " — sign in for picks based on your orders"}`
                }
                action={
                  !user && (
                    <button type="button" onClick={onLoginClick} className="cc-btn cc-btn-outline !px-4 !py-2 text-xs">
                      Sign in
                    </button>
                  )
                }
              />
              <Grid picks={nextPicks} cart={cart} updateQuantity={updateQuantity} rateMenuItem={rateMenuItem} />
            </div>
          )}

          {recommendations.length > 0 && usuals.length === 0 && nextPicks.length === 0 && (
            <EmptyState
              icon={<span className="text-2xl">✨</span>}
              title="Nothing to recommend here yet"
              subtitle="Add a few items and your picks will appear — check back soon."
            />
          )}
        </>
      )}
    </section>
  );
}
