// ─── EmptyState — calm, on-brand empty/error placeholder ─────────────────────
// Used for "no search results", "no orders yet", and load failures. `icon` is
// any node (inline SVG); `action` is an optional button/CTA.
export default function EmptyState({ icon, title, subtitle, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-16 text-center ${className}`}>
      {icon && (
        <div
          className="mb-5 grid h-16 w-16 place-items-center rounded-2xl"
          style={{
            background: "color-mix(in srgb, var(--color-text-muted) 8%, transparent)",
            color: "var(--color-text-muted)",
          }}
        >
          {icon}
        </div>
      )}
      <h3 className="text-base font-extrabold tracking-tight">{title}</h3>
      {subtitle && <p className="cc-muted mt-2 max-w-md text-sm leading-relaxed">{subtitle}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
