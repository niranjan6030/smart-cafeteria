// ─── OrderStatusSteps — the TRACK step of the loop (spec §44-46) ──────────────
// A truthful 4-stage pipeline for real order statuses: pending → preparing →
// ready → completed. `status` is the raw Firestore field; each stage is labeled
// and the active one is emphasized in gold.
const STEPS = [
  { key: "pending", label: "Placed" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Collected" },
];

const STATUS_INDEX = { pending: 0, preparing: 1, ready: 2, completed: 3 };

export default function OrderStatusSteps({ status = "pending", compact = false, delayMessage }) {
  const currentIndex = STATUS_INDEX[status] ?? 0;
  const dim = compact ? "h-1.5" : "h-2";

  return (
    <div aria-label={`Order status: ${STEPS[currentIndex].label}`}>
      <div className="flex items-center">
        {STEPS.map((step, index) => {
          const reached = index <= currentIndex;
          return (
            <div key={step.key} className={`flex items-center ${index < STEPS.length - 1 ? "flex-1" : ""}`}>
              <span
                className={`grid shrink-0 place-items-center rounded-full font-extrabold ${
                  compact ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-xs"
                }`}
                style={
                  reached
                    ? { background: "var(--color-primary)", color: "var(--color-bg-deep)" }
                    : { background: "color-mix(in srgb, var(--color-text-muted) 14%, transparent)", color: "var(--color-text-muted)" }
                }
              >
                {reached ? (compact ? "•" : "✓") : index + 1}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  className={`mx-1.5 flex-1 rounded-full ${dim}`}
                  style={{
                    background: index < currentIndex ? "var(--color-primary)" : "color-mix(in srgb, var(--color-text-muted) 16%, transparent)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className={`mt-2 flex ${compact ? "text-[9px]" : "text-[11px]"}`}>
        {STEPS.map((step, index) => (
          <span
            key={step.key}
            className={`${index < STEPS.length - 1 ? "flex-1" : ""} font-bold uppercase tracking-wide`}
            style={{
              color: index === currentIndex ? "var(--color-primary-strong)" : index < currentIndex ? "var(--color-text)" : "var(--color-text-muted)",
              opacity: index <= currentIndex ? 1 : 0.75,
            }}
          >
            {step.label}
          </span>
        ))}
      </div>
      {delayMessage && status === "preparing" && (
        <p className="mt-2 text-xs font-bold" style={{ color: "var(--color-warning)" }} role="status" aria-live="polite">
          {delayMessage}
        </p>
      )}
    </div>
  );
}
