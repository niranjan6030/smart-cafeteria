import { useEffect, useRef } from "react";
import { AssistantResponseCard } from "./AssistantCards.jsx";
import SuggestionChips from "./SuggestionChips.jsx";

function UserBubble({ message }) {
  if (message.kind === "pick") {
    const picked = message.data?.productId;
    return <p className="fa-pick-note">You picked {picked ? "an item" : ""}…</p>;
  }
  return (
    <div className="fa-row fa-row-user">
      <p className="fa-user-bubble">{message.content}</p>
    </div>
  );
}

export default function AssistantMessages({
  messages,
  busy,
  error,
  interactive,
  onSend,
  onConfirm,
  onCancel,
  onPick,
  onAdd,
  onOpenCart,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, busy, error]);

  if (messages.length === 0 && !busy) {
    return (
      <div className="fa-empty">
        <span className="fa-empty-icon" role="img" aria-hidden="true">🍽️</span>
        <p>Ask me about the food here.</p>
        <p className="fa-empty-sub">Try “high protein under ₹150”, “compare dosa and sandwich”, or “what's in my cart?”</p>
      </div>
    );
  }

  return (
    <div className="fa-messages">
      {messages.map((message) => (
        <div key={message.id} className={`fa-msg ${message.role === "assistant" ? "fa-msg-assistant" : "fa-msg-user"}`}>
          {message.role === "user" ? (
            <UserBubble message={message} />
          ) : (
            <div className="fa-assistant-bubble">
              {message.content && <p className="fa-reply">{message.content}</p>}
              <AssistantResponseCard
                message={message}
                interactive={interactive}
                onConfirm={(action) => onConfirm(action, message.id)}
                onCancel={() => onCancel(message.id)}
                onPick={onPick}
                onAdd={(item) => onAdd(item, message.id)}
                onOpenCart={onOpenCart}
              />
              {message.suggestions?.length > 0 && (
                <SuggestionChips chips={message.suggestions} onPick={onSend} />
              )}
            </div>
          )}
        </div>
      ))}

      {busy && (
        <div className="fa-msg fa-msg-assistant">
          <div className="fa-assistant-bubble">
            <p className="fa-typing" role="status">
              <span className="cc-spinner" aria-hidden="true" />
              Thinking…
            </p>
          </div>
        </div>
      )}

      {error && !busy && (
        <div className="fa-msg fa-msg-assistant">
          <div className="fa-assistant-bubble fa-error-bubble" role="alert">
            <p>{error}</p>
            <button type="button" className="fa-btn fa-btn-ghost" onClick={() => onSend("What's available right now?")}>
              Ask about available food
            </button>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
