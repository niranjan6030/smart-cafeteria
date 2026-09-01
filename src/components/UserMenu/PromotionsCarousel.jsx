import { useRef } from "react";
import SectionHeader from "../ui/SectionHeader";
import { useHorizontalWheelScroll } from "../../hooks/useHorizontalWheelScroll";
import { stallDisplayName } from "./helpers";

// ─── PromotionsCarousel — live broadcasts from staff ──────────────────────────
// Horizontal snap row; mouse wheel scrolls it sideways on desktop.
export default function PromotionsCarousel({ broadcasts, activeShop }) {
  const sliderRef = useRef(null);
  useHorizontalWheelScroll(sliderRef);

  return (
    <section className="mb-16">
      <SectionHeader
        kicker="Live promotions"
        title={`Fresh updates from ${activeShop}`}
        subtitle="Posted by the kitchen — prices and dishes as announced."
      />
      <div ref={sliderRef} className="cc-no-scrollbar flex gap-4 overflow-x-auto pb-2 pt-1">
        {broadcasts.map((broadcast) => (
          <article key={broadcast.id} className="cc-card w-[300px] shrink-0 overflow-hidden">
            {(broadcast.image || broadcast.imageUrl) && (
              <img src={broadcast.image || broadcast.imageUrl} alt="" aria-hidden="true" className="h-44 w-full object-cover" />
            )}
            <div className="p-5">
              <p className="cc-kicker mb-1">{stallDisplayName(broadcast.shop || activeShop)}</p>
              <p className="text-sm font-semibold leading-6">{broadcast.message || broadcast.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
