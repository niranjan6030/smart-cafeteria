import { useState } from "react";

// ─── RatingStars — tap-to-rate, real aggregate from the products doc ──────────
// Compact single-line row: 5 star icons + the real rating + the real review
// count (e.g. "4.7 (128)"). The count is hidden when the doc carries no
// reviews, and unrated dishes render stars alone — no "New" label (a badge on
// every card carries no signal) and never a fabricated score or count.
export default function RatingStars({ rating, reviewCount, onRate }) {
  const [hovered, setHovered] = useState(0);
  const [justRated, setJustRated] = useState(false);
  const displayValue = hovered || rating;

  const handleRate = (star) => {
    if (typeof onRate !== "function") return;
    onRate(star);
    setJustRated(true);
    setTimeout(() => setJustRated(false), 1500);
  };

  return (
    <div className="flex items-center gap-1">
      <div className="-ml-0.5 flex items-center" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHovered(star)}
            onClick={(e) => {
              e.stopPropagation();
              handleRate(star);
            }}
            className="p-0.5"
            aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill={displayValue >= star ? "var(--color-primary)" : "none"}
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              className="h-3 w-3"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6Z" />
            </svg>
          </button>
        ))}
      </div>
      {justRated ? (
        <span className="text-[10px] font-bold" style={{ color: "var(--color-success)" }}>Thanks!</span>
      ) : rating > 0 ? (
        <span className="flex items-center gap-1.5 leading-none">
          <span className="text-[11px] font-bold" style={{ color: "var(--color-text)" }}>
            {rating.toFixed(1)}
          </span>
          {reviewCount > 0 && (
            <span
              className="rounded px-1 py-0.5 text-[9.5px] font-bold leading-none"
              style={{
                background: "color-mix(in srgb, var(--color-success) 14%, transparent)",
                color: "var(--color-success)",
              }}
            >
              {reviewCount}
            </span>
          )}
        </span>
      ) : null}
    </div>
  );
}
