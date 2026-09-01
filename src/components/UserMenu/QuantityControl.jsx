import { useState } from "react";

// ─── QuantityControl — +/- stepper on the food card ───────────────────────────
// Theme-aware via CSS variables. `variant="solid"` is for the cart drawer rows,
// `variant="floating"` (default) for use directly over a photo. The +/- is the
// single canonical "add to cart" gesture across the app.
export default function QuantityControl({ quantity, onAdd, onRemove, compact = false, variant = "floating" }) {
  const isSolid = variant === "solid";
  const [justAdded, setJustAdded] = useState(false);

  const containerStyle = isSolid
    ? { borderColor: "var(--color-border)" }
    : { borderColor: "rgba(255,255,255,0.35)", background: "rgba(46,32,22,0.6)" };

  const textColor = isSolid ? "var(--color-text)" : "#FFFFFF";

  return (
    <div
      className={`flex items-center overflow-hidden rounded-xl border ${compact ? "h-11" : "h-12"} ${
        isSolid ? "" : "backdrop-blur-sm"
      }`}
      style={containerStyle}
    >
      {quantity > 0 && (
        <>
          <button
            onClick={onRemove}
            aria-label="Decrease quantity"
            className={`grid h-full w-11 place-items-center text-base font-extrabold transition-all duration-200 ease-out ${
              isSolid ? "hover:bg-red-500/10 hover:text-red-500" : "text-white hover:bg-red-500"
            }`}
            style={isSolid ? { color: textColor } : undefined}
          >
            −
          </button>
          <span
            key={quantity}
            className="cc-qty-roll-in min-w-8 text-center text-sm font-extrabold"
            style={isSolid ? { color: textColor } : { color: "#FFFFFF" }}
          >
            {quantity}
          </span>
        </>
      )}
      <button
        onClick={() => {
          onAdd();
          setJustAdded(true);
          setTimeout(() => setJustAdded(false), 280);
        }}
        aria-label="Increase quantity"
        className={`relative grid h-full w-11 place-items-center text-base font-extrabold transition-all duration-200 ease-out active:brightness-95 ${
          isSolid ? "text-[color:var(--color-text)] hover:bg-[color:var(--color-text-muted)]/10" : "text-white hover:bg-white/10"
        }`}
      >
        {/* Brief + → ✓ confirmation on add; rolls back to + after 280ms so rapid clicks stay usable */}
        <span className={`relative z-10 ${justAdded ? "cc-qty-roll-in" : ""}`}>{justAdded ? "✓" : "+"}</span>
      </button>
    </div>
  );
}
