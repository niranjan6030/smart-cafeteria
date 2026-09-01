import { itemImage, itemEmoji, money, toTitleCase } from "./helpers";
import QuantityControl from "./QuantityControl";
import RatingStars from "./RatingStars";

// ─── MenuItemCard — the one food card used across menu + recommendations ──────
// Compact food-first card (spec §9): the photo floats as a rounded "plate"
// inset 8px above the card with its own soft shadow, badges are white pills
// with colored text sitting on the photo, and the body is dense — Poppins name,
// real rating + review count, real price, and a quiet Add/stepper on the price
// row. Theme-aware via CSS variables. Real rating/reviewCount from the products
// doc, real price from applySpecialPricing; a description line renders only when
// the doc actually carries one. Unavailable items show a disabled state instead
// of disappearing entirely.
export default function MenuItemCard({ item, quantity, onAdd, onRemove, onRate }) {
  const rating = Number(item.rating) || 0;
  const reviewCount = Number(item.reviewCount) || 0;
  const unavailable = item.available === false;

  return (
    <article className="cc-card cc-card-hover group flex h-full flex-col overflow-hidden">
      {/* Floating image "plate": inset 8px, rounded, soft shadow, hover zoom */}
      <div className="p-2 pb-0">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1rem] shadow-[0_10px_24px_-14px_rgba(74,53,37,0.45)]">
          {itemImage(item) ? (
            <img
              src={itemImage(item)}
              alt={item.name}
              className="h-full w-full object-cover transition-transform duration-[450ms] ease-out group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div
              className="grid h-full w-full place-items-center text-4xl"
              style={{ background: "color-mix(in srgb, var(--color-text-muted) 10%, transparent)" }}
            >
              {itemEmoji(item)}
            </div>
          )}

          {/* Badges — white pills with colored text, on the photo */}
          {item.isSpecial && (
            <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#C9501F] shadow-sm">
              Special
            </span>
          )}
          {item.isMostSold && (
            <span className="absolute bottom-2 left-2 rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#B03535] shadow-sm">
              Best seller
            </span>
          )}

          {unavailable && (
            <div className="absolute inset-0 grid place-items-center rounded-[1rem] bg-black/55 backdrop-blur-[1px]">
              <span className="rounded-full bg-black/70 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-widest text-white">
                Sold out
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-1 p-3 pt-2.5">
        <h3 className="font-display line-clamp-2 text-[13.5px] font-semibold leading-snug">{toTitleCase(item.name)}</h3>

        <RatingStars rating={rating} reviewCount={reviewCount} onRate={onRate} />

        {item.description ? (
          <p className="cc-muted line-clamp-2 text-[11.5px] leading-snug">{item.description}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex shrink-0 items-baseline gap-0.5 rounded-full px-2.5 py-1 text-[13px] font-extrabold leading-none shadow-sm"
              style={{ background: "var(--color-primary)", color: "var(--color-bg-deep)" }}
            >
              {money(item.price)}
            </span>
            {item.originalPrice > item.price && (
              <p className="cc-muted text-[10.5px] font-bold line-through">{money(item.originalPrice)}</p>
            )}
          </div>

          {unavailable ? (
            <span
              className="rounded-xl border px-2.5 py-2 text-[10px] font-extrabold uppercase tracking-widest"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
            >
              Sold out
            </span>
          ) : (
            <QuantityControl quantity={quantity} onAdd={onAdd} onRemove={onRemove} compact />
          )}
        </div>
      </div>
    </article>
  );
}
