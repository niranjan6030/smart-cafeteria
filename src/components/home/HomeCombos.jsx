import RevealOnScroll from "../UserMenu/RevealOnScroll";
import SectionHeader from "../ui/SectionHeader";
import { itemEmoji, itemImage, money } from "../UserMenu/helpers";

// ─── HomeCombos — "Frequently ordered together" (spec §25, §23) ──────────────
// Real item↔item pairs mined from cross-user order transactions via the
// recommender's co-occurrence model (lift > 1, minimum support). Each card shows
// both dishes and their real combined price; "Add both" drops them straight into
// the cart. If no genuine pairing has been learned yet the section simply doesn't
// render — we never fabricate a combo.
export default function HomeCombos({ pairs, updateQuantity }) {
  if (pairs.length === 0) return null;

  const renderMiniItem = (item, side) => (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <div
        className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg text-lg"
        style={{ background: "color-mix(in srgb, var(--color-text-muted) 10%, transparent)" }}
      >
        {itemImage(item) ? (
          <img src={itemImage(item)} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          itemEmoji(item)
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-bold">{item.name}</p>
        <p className="cc-muted text-[11px] font-semibold">{money(item.price)}</p>
      </div>
      <span className="cc-muted ml-auto pr-1 text-[10px] font-extrabold uppercase">{side}</span>
    </div>
  );

  return (
    <RevealOnScroll as="section" className="cc-fade-in-up mb-16" aria-label="Frequently ordered together">
      <SectionHeader
        kicker="Frequently bought together"
        title="Campus-favourite combos"
        subtitle="Learned from real co-purchases across every stall."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pairs.map((pair) => (
          <article key={`${pair.a.id}__${pair.b.id}`} className="cc-card cc-card-hover flex flex-col p-5">
            <div className="flex items-center gap-2">
              {renderMiniItem(pair.a, "1")}
              <span className="cc-gold-gradient grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold text-[#2E2016]">+</span>
              {renderMiniItem(pair.b, "2")}
            </div>

            <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
              <div>
                <p className="text-sm font-extrabold" style={{ color: "var(--color-primary-strong)" }}>
                  {money(pair.total)}
                </p>
                <p className="cc-muted text-[11px] font-semibold">
                  {pair.count}× together · {pair.reason}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  updateQuantity(pair.a, 1);
                  updateQuantity(pair.b, 1);
                }}
                className="cc-btn cc-btn-primary !px-4 !py-2 text-xs"
              >
                Add both
              </button>
            </div>
          </article>
        ))}
      </div>
    </RevealOnScroll>
  );
}
