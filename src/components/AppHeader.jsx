import { money } from "./UserMenu/helpers";
import { APP_TABS } from "./appTabs";

// ─── AppHeader — the single persistent top bar (spec §11-14) ─────────────────
// Replaces the old hero-embedded navbar + mini-header: always visible, so the
// search / cart / theme / account actions stay reachable no matter how far the
// user scrolls. Tab navigation lives here on ≥sm and in BottomNav on phones.
// Theme-aware via CSS variables; backdrop-blur keeps content legible while it
// scrolls underneath.

function SearchIcon({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CartIcon({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l3-8H5.4M7 13 5.4 5M7 13l-2.3 4.6A1 1 0 0 0 5.6 19H17M17 19a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM9 21a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
    </svg>
  );
}

export default function AppHeader({
  user,
  activeTab,
  onTabChange,
  onOpenSearch,
  onOpenCart,
  cartCount,
  cartTotal,
  isStaffAccount,
  onShowLogin,
  onLogout,
  darkMode,
  onToggleDark,
}) {
  return (
    <header
      className="sticky top-0 z-[140] border-b"
      style={{
        background: "color-mix(in srgb, var(--color-bg) 82%, transparent)",
        borderColor: "var(--color-border)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <div className="mx-auto flex h-16 max-w-[1220px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <button
          type="button"
          onClick={() => onTabChange("home")}
          className="flex shrink-0 items-center gap-2.5"
          aria-label="Christ University Cafeteria home"
        >
          <img
            src="/logo.png"
            alt=""
            className="h-9 w-auto"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <span
            className="font-display hidden text-xl font-bold leading-none md:block"
            style={{ color: "var(--color-text)" }}
          >
            Christ Canteen
          </span>
        </button>

        {/* Tab nav (desktop/tablet) — editorial underline sweep, no box hover */}
        <nav className="ml-2 hidden min-w-0 items-center gap-1 md:flex" aria-label="Main">
          {APP_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`group relative shrink-0 px-3.5 py-2 text-[13px] font-bold transition-colors duration-200 ${
                  active ? "text-[var(--color-text)]" : "cc-muted hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 bottom-0.5 h-[2px] origin-center rounded-full transition-transform duration-200 ease-out ${
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                  }`}
                  style={{ background: "var(--color-primary-strong)" }}
                />
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Search trigger */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search stalls and dishes"
            className="grid h-10 w-10 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: "var(--color-text)" }}
          >
            <SearchIcon />
          </button>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={onToggleDark}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            className="grid h-10 w-10 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: "var(--color-text)" }}
          >
            {darkMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <circle cx="12" cy="12" r="4" />
                <path strokeLinecap="round" d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>

          {/* Cart pill */}
          {cartCount > 0 && (
            <button
              type="button"
              onClick={onOpenCart}
              aria-label={`View cart, ${cartCount} items`}
              className="cc-btn-primary !px-4 !py-2.5 text-xs font-extrabold uppercase tracking-wider"
            >
              <CartIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{cartCount} · {money(cartTotal)}</span>
              <span className="sm:hidden">{cartCount}</span>
            </button>
          )}

          {/* Account */}
          {user ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              className="ml-1 h-10 w-10 overflow-hidden rounded-full border transition hover:opacity-80"
              style={{ borderColor: "var(--color-border-strong)" }}
            >
              <img src={user.photoURL} alt={user.displayName || "You"} className="h-full w-full object-cover" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onShowLogin}
              className="cc-btn-primary !px-4 !py-2.5 text-xs font-extrabold uppercase tracking-wider"
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Staff shortcut strip */}
      {isStaffAccount && (
        <div
          className="border-t px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest"
          style={{ borderColor: "var(--color-border)", color: "var(--color-primary-strong)" }}
        >
          <a href="#/live">Kitchen Live Board →</a>
        </div>
      )}
    </header>
  );
}
