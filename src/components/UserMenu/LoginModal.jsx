import { signInWithGoogle } from "../../firebase";
import { money } from "./helpers";

// ─── Guest-Browsing-First: premium frosted-glass auth modal ──────────────────
export default function LoginModal({ cart, cartCount, cartTotal, loginError, isLoggingIn, setShowLoginModal, setLoginError, setIsLoggingIn }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Sign in">
      <button
        aria-label="Close login modal"
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: "var(--color-overlay)" }}
        onClick={() => { setShowLoginModal(false); setLoginError(""); }}
      />
      <section className="cc-card cc-pop-in relative max-w-md w-full rounded-[24px] border p-8" style={{ background: "var(--color-bg)" }}>
        {/* Close button */}
        <button
          onClick={() => { setShowLoginModal(false); setLoginError(""); }}
          aria-label="Close"
          className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-xl border text-lg font-bold transition active:scale-95"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          ×
        </button>

        {/* Header */}
        <div className="mb-8 pr-10">
          <p className="cc-kicker mb-2">Secure Authentication</p>
          <h2 className="text-2xl font-extrabold tracking-tight">Authenticate & Place Order</h2>
          <p className="cc-muted mt-2 text-sm leading-6">
            Sign in with your Christ University Google account to complete checkout. Your cart items are safe.
          </p>
        </div>

        {/* Cart preview badge */}
        {cart.length > 0 && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border px-5 py-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div>
              <p className="cc-kicker !text-[9px]">Your cart is waiting</p>
              <p className="mt-1 text-sm font-extrabold">
                {cartCount} {cartCount === 1 ? "item" : "items"} · {money(cartTotal)}
              </p>
            </div>
            <span className="text-2xl">🛒</span>
          </div>
        )}

        {/* Error display */}
        {loginError && (
          <div
            className="mb-5 rounded-2xl border p-4 text-xs font-semibold"
            style={{ borderColor: "color-mix(in srgb, var(--color-error) 40%, transparent)", background: "color-mix(in srgb, var(--color-error) 8%, transparent)", color: "var(--color-error)" }}
          >
            {loginError}
          </div>
        )}

        {/* Google Sign-In button */}
        <div className="flex w-full flex-col gap-3">
          <button
            disabled={isLoggingIn}
            onClick={async () => {
              setIsLoggingIn(true);
              setLoginError("");
              try {
                await signInWithGoogle();
                setShowLoginModal(false);
              } catch (err) {
                console.error("Login modal error:", err);
                if (err.code === "auth/popup-closed-by-user") {
                  setLoginError("Sign-in cancelled. Please try again.");
                } else if (err.code === "auth/network-request-failed") {
                  setLoginError("Network error. Check your connection.");
                } else if (err.code === "auth/popup-blocked") {
                  setLoginError("Popup was blocked. Please allow popups.");
                } else {
                  setLoginError("Login failed. Please try again.");
                }
              } finally {
                setIsLoggingIn(false);
              }
            }}
            className="cc-btn cc-btn-primary w-full !py-4 text-xs uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoggingIn ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "currentColor", borderTopColor: "transparent" }} />
                <span>Signing In…</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowLoginModal(false);
              window.location.hash = "/login";
            }}
            className="cc-btn cc-btn-outline w-full !py-3.5 text-[10px] uppercase tracking-[0.15em]"
          >
            Kitchen Staff / Vendor Portal
          </button>
        </div>

        <p className="cc-muted mt-5 text-center text-[10px] font-semibold">
          Only Christ University (@christuniversity.in) accounts are accepted.
        </p>
      </section>
    </div>
  );
}
