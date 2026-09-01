/**
 * Docked Food Assistant trigger. Parks bottom-left so it never collides with the voice mic FAB
 * (bottom-right); lifts clear of the cart bar when the cart is non-empty, matching the mic's
 * safe-area handling. Hidden while the sheet is open.
 */
export default function FoodAssistantTrigger({ onOpen, cartBarActive = false, hasPending }) {
  const anchorClass = cartBarActive ? "fa-trigger-anchor fa-trigger-anchor-cart" : "fa-trigger-anchor";
  return (
    <button
      type="button"
      className={anchorClass}
      onClick={onOpen}
      aria-label="Open food assistant"
      aria-haspopup="dialog"
    >
      <span className="fa-trigger-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="fa-trigger-svg">
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5c-1 0-2-.17-2.9-.5L4 21l1.5-5.6A8.38 8.38 0 1 1 21 11.5z" />
          <path d="M12 7.5v5" />
          <path d="M9.5 10h5" />
        </svg>
      </span>
      <span className="fa-trigger-label">Ask</span>
      {hasPending && <span className="fa-trigger-dot" aria-label="Pending suggestions" />}
    </button>
  );
}
