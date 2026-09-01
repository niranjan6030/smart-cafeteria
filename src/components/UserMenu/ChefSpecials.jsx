import MenuItemCard from "./MenuItemCard";
import RevealOnScroll from "./RevealOnScroll";
import SectionHeader from "../ui/SectionHeader";

// ─── ChefSpecials — featured / special dishes for the active stall ────────────
export default function ChefSpecials({ featuredItems, cart, updateQuantity, rateMenuItem }) {
  return (
    <RevealOnScroll as="section" className="cc-fade-in-up mb-10">
      <SectionHeader kicker="Chef specials" title="Popular right now" subtitle="Staff-picked specials and featured dishes at this stall." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featuredItems.map((item) => {
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
      </div>
    </RevealOnScroll>
  );
}
