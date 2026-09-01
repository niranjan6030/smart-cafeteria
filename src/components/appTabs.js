// ─── Shared tab definitions ──────────────────────────────────────────────────
// Single source of truth for the persistent nav tabs, shared by AppHeader
// (desktop top bar) and BottomNav (phone thumb rail) so the two surfaces can
// never drift apart.
export const APP_TABS = [
  { id: "home", label: "Home" },
  { id: "menu", label: "Menu" },
  { id: "my-orders", label: "My Orders" },
  { id: "meal-passes", label: "Meal Pass" },
  { id: "spend-wallet", label: "Wallet" },
];
