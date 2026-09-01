import { useState } from "react";
import { money } from "../UserMenu/helpers";

/**
 * Floating voice ordering panel — mic control, live transcript, feedback, disambiguation.
 * Voice only ever adds to the cart with visible confirmation feedback — it never places
 * an order automatically. Listening is signalled in the interaction accent (var(--color-primary),
 * teal in dark mode — same as other active states) with a subtle pulse instead of an error-red
 * panic light; a "processing" state bridges the gap between stopping and the recogniser returning
 * a result, and the error card can be dismissed with "Continue manually".
 */
export default function VoiceOrderingPanel({
  supported,
  listening,
  transcript,
  interimTranscript,
  feedback,
  disambiguation,
  onToggleListen,
  onPickDisambiguation,
  onDismissDisambiguation,
  cartBarActive = false,
}) {
  // "Continue manually" hides the current feedback card; a new transcript/feedback changes
  // the content key, so the panel naturally reappears on the next voice input.
  const contentKey = [
    transcript,
    listening,
    feedback?.message,
    feedback?.tone,
    disambiguation?.candidates?.[0]?.product?.name,
  ].join("|");
  const [dismissedKey, setDismissedKey] = useState("");
  const hasContent = Boolean(transcript || feedback || disambiguation || listening);
  const hidden = hasContent && dismissedKey === contentKey;

  // Sticky-cart aware anchoring (spec §9-10): the mic never sits inside the cart/checkout bar's
  // zone, and both anchors respect the iOS home-indicator safe area. Without a cart the mic parks
  // just above the mobile tab rail; with a cart it lifts clear of the bar. Desktop (md+) drops the
  // tab rail and the cart bar lowers to the corner, so the mic parks above it there too. All the
  // actual offsets live in index.css's .bottom-anchor-* utilities so nothing is hardcoded per
  // viewport here.
  const anchorClass = cartBarActive
    ? "bottom-anchor-voice-cart fixed right-4"
    : "bottom-anchor-voice fixed right-4";

  if (!supported) {
    return (
      <div
        className={`${anchorClass} z-[250] max-w-[280px] rounded-2xl border px-4 py-3 text-xs shadow-lg`}
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)" }}
        role="status"
      >
        Voice ordering needs Chrome, Edge, or Safari over HTTPS. Your browser doesn&apos;t support
        it — use the buttons instead.
      </div>
    );
  }

  if (hidden) return null;

  const displayTranscript = interimTranscript || transcript;
  // Between "stop listening" and the recogniser returning, the panel reads as "processing".
  const processing = !listening && !feedback && !disambiguation && Boolean(transcript);

  return (
    <div className={`${anchorClass} z-[250] flex max-w-[min(100vw-2rem,360px)] flex-col items-end gap-3`}>
      {(displayTranscript || feedback || disambiguation || processing) && (
        <div
          className="w-full rounded-2xl border p-4 shadow-xl backdrop-blur-md"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
          role="region"
          aria-label="Voice assistant"
          aria-live="polite"
        >
          <p className="cc-kicker">Voice Order</p>

          {processing && !displayTranscript && (
            <p className="mt-2 flex items-center gap-2 text-xs font-bold">
              <span className="cc-spinner" aria-hidden="true" />
              Understanding your order…
            </p>
          )}

          {displayTranscript && (
            <p className={`mt-2 text-sm font-medium ${listening ? "opacity-90" : "opacity-70"}`}>
              {listening ? "Listening: " : "Heard: "}
              <span className="italic">&ldquo;{displayTranscript}&rdquo;</span>
            </p>
          )}

          {feedback && (
            <div className="mt-2 space-y-2">
              <p
                className="rounded-xl border px-3 py-2 text-xs font-semibold"
                style={{
                  borderColor: feedback.tone === "error" ? "color-mix(in srgb, var(--color-error) 45%, transparent)" : "color-mix(in srgb, var(--color-primary) 40%, transparent)",
                  background: feedback.tone === "error" ? "color-mix(in srgb, var(--color-error) 9%, transparent)" : "color-mix(in srgb, var(--color-primary) 10%, transparent)",
                  color: feedback.tone === "error" ? "var(--color-error)" : "var(--color-primary-strong)",
                }}
              >
                {feedback.message}
              </p>
              {feedback.suggestion && (
                <p className="rounded-xl border px-3 py-2 text-[11px] font-medium" style={{ borderColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)", background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", color: "var(--color-primary-strong)" }}>
                  Tip: {feedback.suggestion}
                </p>
              )}
              {!listening && feedback.tone === "confirm" && (
                <button
                  type="button"
                  onClick={onToggleListen}
                  className="cc-btn cc-btn-primary w-full !py-2 text-xs font-bold uppercase tracking-wide"
                >
                  Try again
                </button>
              )}
              {!listening && feedback.tone === "error" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onToggleListen}
                    className="cc-btn cc-btn-outline flex-1 !py-2 text-xs font-bold uppercase tracking-wide"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedKey(contentKey)}
                    className="cc-btn cc-btn-ghost flex-1 !py-2 text-xs font-bold uppercase tracking-wide"
                  >
                    Continue manually
                  </button>
                </div>
              )}
            </div>
          )}

          {disambiguation?.candidates?.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="cc-muted text-[10px] font-bold uppercase tracking-wide">Pick one:</p>
              {disambiguation.candidates.slice(0, 4).map(({ product, score }) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onPickDisambiguation({ product, score })}
                  className="cc-btn cc-btn-outline flex w-full items-center justify-between !px-3 !py-2 text-left text-xs font-semibold transition active:scale-[0.98]"
                >
                  <span>{product.name}</span>
                  <span style={{ color: "var(--color-primary-strong)" }}>{money(product.price)}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={onDismissDisambiguation}
                className="cc-muted text-[10px] font-bold uppercase tracking-wide hover:opacity-80"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {!hasContent && (
        <div
          className="flex items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-semibold shadow-lg"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)" }}
          role="status"
          aria-label="Voice input available"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3" />
          </svg>
          Tap the mic to order by voice
        </div>
      )}

      <button
        type="button"
        onClick={onToggleListen}
        aria-label={listening ? "Stop listening" : "Start voice ordering"}
        aria-pressed={listening}
        className="group relative grid h-14 w-14 place-items-center rounded-full shadow-lg transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 active:scale-95"
        style={
          listening
            ? { background: "var(--color-primary)", color: "var(--color-bg-deep)", animation: "ccPulse 1.8s ease-in-out infinite" }
            : { background: "var(--color-primary)", color: "var(--color-bg-deep)" }
        }
      >
        {listening ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3" />
          </svg>
        )}
        {listening && (
          <span className="absolute -inset-1 animate-ping rounded-full border-2 opacity-40" style={{ borderColor: "var(--color-primary)" }} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
