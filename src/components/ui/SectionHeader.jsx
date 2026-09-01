// ─── SectionHeader — kicker + title + subtitle + optional action ─────────────
// The editorial voice of the app (spec §28): a terracotta micro-kicker, a Poppins
// headline, and a muted one-liner. `action` is rendered right-aligned on larger
// screens so section CTAs never fight the heading.
export default function SectionHeader({ kicker, title, subtitle, action, className = "" }) {
  return (
    <div className={`mb-6 flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0 max-w-2xl">
        {kicker && <p className="cc-kicker mb-2">{kicker}</p>}
        {title && (
          <h2 className="font-display text-2xl font-bold leading-tight tracking-tight sm:text-[1.75rem]">{title}</h2>
        )}
        {subtitle && <p className="cc-muted mt-2 text-sm leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
