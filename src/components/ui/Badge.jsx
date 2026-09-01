// ─── Badge — the single status/tag chip used across the app (spec §24) ───────
// Tones map to the design-system semantics, not literal colors, and adapt to
// light/dark automatically via CSS variables. `tone="status"` combines a dot +
// label for live kitchen-state readouts (open / busy / closed).
export default function Badge({ tone = "neutral", children, className = "", dot = false }) {
  const tones = {
    neutral: { background: "color-mix(in srgb, var(--color-text-muted) 12%, transparent)", color: "var(--color-text-muted)" },
    gold: { background: "color-mix(in srgb, var(--color-primary) 16%, transparent)", color: "var(--color-primary-strong)" },
    success: { background: "color-mix(in srgb, var(--color-success) 14%, transparent)", color: "var(--color-success)" },
    warning: { background: "color-mix(in srgb, var(--color-warning) 14%, transparent)", color: "var(--color-warning)" },
    error: { background: "color-mix(in srgb, var(--color-error) 14%, transparent)", color: "var(--color-error)" },
    solid: { background: "var(--color-primary)", color: "var(--color-bg-deep)" },
  };
  const dotColors = {
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    error: "var(--color-error)",
    gold: "var(--color-primary)",
    neutral: "var(--color-text-muted)",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${className}`}
      style={tones[tone] || tones.neutral}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: dotColors[tone] || dotColors.neutral }}
        />
      )}
      {children}
    </span>
  );
}
