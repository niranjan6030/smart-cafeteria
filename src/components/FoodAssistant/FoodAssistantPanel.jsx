import { useEffect, useRef, useState } from "react";
import AssistantMessages from "./AssistantMessages.jsx";
import SuggestionChips from "./SuggestionChips.jsx";
import { getInitialChips } from "./chips.js";
import { useAssistantVoice } from "./useAssistantVoice.js";

function AssistantVoiceButton({ voice, listening, onToggle }) {
  if (!voice.supported) return null;
  return (
    <button
      type="button"
      className={`fa-mic ${listening ? "fa-mic-active" : ""}`}
      onClick={onToggle}
      aria-label={listening ? "Stop speaking" : "Speak to the assistant"}
      title={listening ? "Stop listening" : "Speak your request"}
    >
      <span className="fa-mic-icon" aria-hidden="true">{listening ? "■" : "🎙️"}</span>
    </button>
  );
}

/**
 * Food Assistant sheet — a bottom drawer on mobile, side panel on desktop. The assistant is a
 * rule-based conversational layer over the REAL menu; it only ever proposes cart actions, which
 * the user confirms before the app's command engine applies them. The shell stays mounted while
 * the menu tab is active and animates via CSS visibility/transform (no exit-animation state).
 */
export default function FoodAssistantPanel({
  open,
  onClose,
  messages,
  busy,
  error,
  interactive,
  signedIn,
  cartLength,
  onSend,
  onConfirm,
  onCancel,
  onPick,
  onAdd,
  onOpenCart,
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);
  const voice = useAssistantVoice({ onFinal: (text) => onSend(text) });

  useEffect(() => {
    if (open && !busy) inputRef.current?.focus();
  }, [open, busy]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    onSend(text);
  };

  const chips = getInitialChips(signedIn, cartLength);

  return (
    <div className={`fa-sheet ${open ? "fa-sheet-open" : ""}`} role="dialog" aria-modal="true" aria-label="Food assistant">
      <div className="fa-sheet-overlay" onClick={onClose} aria-hidden="true" />
      <section className="fa-sheet-panel" aria-hidden={!open}>
        <header className="fa-sheet-head">
          <div>
            <p className="cc-kicker">Food Assistant</p>
            <h3 className="fa-sheet-title">
              What are you in the mood for?
              <span className="fa-live-dot" title="Answers use live menu data">live</span>
            </h3>
          </div>
          <button type="button" className="fa-sheet-close" onClick={onClose} aria-label="Close assistant">
            ✕
          </button>
        </header>

        <AssistantMessages
          messages={messages}
          busy={busy}
          error={error}
          interactive={interactive}
          onSend={onSend}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onPick={onPick}
          onAdd={onAdd}
          onOpenCart={onOpenCart}
        />

        <footer className="fa-sheet-foot">
          {voice.error && <p className="fa-mic-error" role="alert">{voice.error}</p>}
          {!busy && (
            <div className="fa-persistent-chips" aria-label="Suggested questions">
              <SuggestionChips chips={chips} onPick={(text) => onSend(text)} />
            </div>
          )}
          <form
            className="fa-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <AssistantVoiceButton voice={voice} listening={voice.listening} onToggle={voice.toggle} />
            <input
              ref={inputRef}
              className="fa-input"
              type="text"
              placeholder={voice.supported ? "Ask anything or tap the mic…" : "Ask about food, nutrition or the menu…"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="Ask the food assistant"
              enterKeyHint="send"
            />
            <button type="submit" className="fa-btn fa-btn-primary fa-send" disabled={!input.trim() || busy}>
              {busy ? "…" : "Send"}
            </button>
          </form>
          <p className="fa-footnote">
            Recommendations use live menu data and estimated nutrition. Nothing is added to your
            cart without your confirmation.
          </p>
        </footer>
      </section>
    </div>
  );
}
