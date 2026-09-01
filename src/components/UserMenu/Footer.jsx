import { SHOPS, stallDisplayName } from "./helpers";

// ─── Site footer — bookends the page, themed by the design-token variables. ──
// Grounded in THIS cafeteria: the real six stalls and campus serving hours are the
// content, not filler. All icons are inline SVG so nothing hits the network.

const SOCIALS = [
  {
    label: "Instagram",
    href: "https://instagram.com",
    path: "M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s0-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2Zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4Zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3Zm6.85-11.15a1.54 1.54 0 1 1-1.54-1.54 1.54 1.54 0 0 1 1.54 1.54Z",
  },
  {
    label: "X",
    href: "https://x.com",
    path: "M17.53 3H20.5l-6.49 7.41L21.75 21h-5.98l-4.68-6.12L5.7 21H2.72l6.94-7.93L2.5 3h6.13l4.23 5.6L17.53 3Zm-1.05 16.2h1.65L7.6 4.71H5.83L16.48 19.2Z",
  },
  {
    label: "Facebook",
    href: "https://facebook.com",
    path: "M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z",
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com",
    path: "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.8 0 0 .78 0 1.74v20.51C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.74C24 .78 23.2 0 22.22 0Z",
  },
];

function TabLink({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cc-link text-left text-sm font-medium"
    >
      {children}
    </button>
  );
}

export default function Footer({ setActiveTab, setShowSearchOverlay }) {
  const year = new Date().getFullYear();

  const goToTab = (tab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const heading = "cc-kicker";
  const muted = "cc-muted";

  return (
    <footer className="relative left-1/2 right-1/2 -mx-[50vw] mt-8 w-screen overflow-hidden" style={{ background: "var(--color-surface)", color: "var(--color-text)" }}>
      {/* Soft ambient wash so the surface never reads as flat — theme-aware (deep red in night mode) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64"
        style={{ background: `radial-gradient(60% 120% at 50% 0%, var(--color-footer-wash), transparent 70%)` }}
      />
      {/* Signature: a single gold hairline along the top edge. */}
      <div className="cc-gold-gradient h-[3px] w-full" />

      <div className="relative mx-auto grid w-full max-w-[1220px] grid-cols-1 gap-12 px-6 py-16 sm:grid-cols-2 sm:px-10 lg:grid-cols-12">
        {/* Brand */}
        <div className="lg:col-span-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Christ University Cafeteria"
              className="h-11 w-auto"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <div>
              <p className="text-base font-extrabold uppercase tracking-tight">Christ University Cafeteria</p>
              <p className={`${muted} text-[10px] font-bold uppercase tracking-[0.2em]`}>Christ University</p>
            </div>
          </div>
          <p className={`${muted} mt-5 max-w-xs text-sm leading-relaxed`}>
            Order ahead across six campus stalls, skip the counter queue, and pick up the moment it's
            ready. One canteen, one login.
          </p>
          <p className={`${muted} mt-5 text-xs font-semibold`}>
            Christ (Deemed to be University)
            <br />
            Hosur Road, Bangalore 560029
          </p>
        </div>

        {/* Explore */}
        <nav className="lg:col-span-2" aria-label="Explore">
          <p className={heading}>Explore</p>
          <div className="mt-5 flex flex-col gap-3">
            <TabLink onClick={() => goToTab("menu")}>Menu</TabLink>
            <TabLink onClick={() => goToTab("my-orders")}>My Orders</TabLink>
            <TabLink onClick={() => goToTab("meal-passes")}>Meal Passes</TabLink>
            <TabLink onClick={() => goToTab("spend-wallet")}>Spend Wallet</TabLink>
            <TabLink onClick={() => setShowSearchOverlay(true)}>Search dishes</TabLink>
          </div>
        </nav>

        {/* Our Stalls — the real six, not filler */}
        <nav className="lg:col-span-3" aria-label="Our stalls">
          <p className={heading}>Our Stalls</p>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
            {SHOPS.map((shop) => (
              <button
                key={shop}
                type="button"
                onClick={() => goToTab("menu")}
                className="cc-link flex items-center gap-2 text-left text-sm font-medium"
              >
                <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-primary)" }} />
                {stallDisplayName(shop)}
              </button>
            ))}
          </div>
        </nav>

        {/* Hours & support */}
        <div className="lg:col-span-3">
          <p className={heading}>Serving Hours</p>
          <div className={`${muted} mt-5 space-y-2 text-sm`}>
            <p className="flex justify-between gap-4">
              <span>Mon – Sat</span>
              <span className="font-semibold">8:00 AM – 9:00 PM</span>
            </p>
            <p className="flex justify-between gap-4">
              <span>Sunday</span>
              <span className="font-semibold">8:00 AM – 8:15 PM</span>
            </p>
          </div>
          <p className={`${heading} mt-8`}>Support</p>
          <a
            href="mailto:cafeteria@christuniversity.in"
            className="cc-link mt-4 inline-block text-sm font-semibold"
          >
            cafeteria@christuniversity.in
          </a>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative border-t" style={{ borderColor: "var(--color-border)" }}>
        <div className="mx-auto flex w-full max-w-[1220px] flex-col items-center justify-between gap-6 px-6 pb-24 pt-6 sm:px-10 md:flex-row md:pb-6">
          <div className="flex flex-col items-center gap-3 md:items-start">
            <p className={`${muted} text-xs`}>© {year} Christ University Cafeteria · Built for campus</p>

            <div className="flex items-center gap-2">
              {/* Payment trust */}
              {["UPI", "Cards"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  {label}
                </span>
              ))}
              <span className="cc-muted flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3 w-3">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path strokeLinecap="round" d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                Razorpay Secured
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            {/* Social */}
            <div className="flex items-center gap-2.5">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={s.label}
                  className="cc-muted grid h-9 w-9 place-items-center rounded-full border transition hover:scale-105 hover:text-[color:var(--color-primary)] active:scale-95"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                    <path d={s.path} />
                  </svg>
                </a>
              ))}
            </div>

            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="cc-link flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest"
              title="Back to top"
            >
              Back to top
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
