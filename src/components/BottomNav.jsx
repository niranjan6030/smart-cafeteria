import { APP_TABS } from "./appTabs";

// ─── BottomNav — mobile-first tab rail (spec §15) ─────────────────────────────
// Mirrors the header's tabs on phones where a top nav is unreachable with one
// thumb. Uses the same APP_TABS definitions so the two surfaces can never drift
// apart. Sits flush to the safe area and recedes when the cart bar is showing so
// they don't collide (UserMenu adjusts bottom padding).
export default function BottomNav({ activeTab, onTabChange }) {
  const ICONS = {
    home: "M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3v-10.5Z",
    menu: "M4 6h16M4 12h16M4 18h10",
    "my-orders": "M3 7h18v13H3zM3 7l2-3h14l2 3M9 11h6",
    "meal-passes": "M9 3v3M15 3v3M4 9h16M5 9v11h14V9",
    "spend-wallet": "M3 6h18v12H3zM3 10h18",
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[120] border-t md:hidden pb-safe"
      style={{
        background: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
        borderColor: "var(--color-border)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
      aria-label="Main"
    >
      <div className="grid grid-cols-5">
        {APP_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className="flex flex-col items-center gap-1 py-2.5"
              style={{ color: active ? "var(--color-primary-strong)" : "var(--color-text-muted)" }}
              aria-current={active ? "page" : undefined}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="h-[22px] w-[22px]">
                <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[tab.id] || ICONS.home} />
              </svg>
              <span className="text-[10px] font-bold" style={active ? { color: "var(--color-primary-strong)" } : undefined}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
