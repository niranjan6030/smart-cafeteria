# Smart Cafeteria — Project Summary

Christ University's campus food-ordering platform. Three portals — Student/Faculty, Kitchen Staff, Admin — sharing one Firebase backend plus a small Express API on Vercel for anything that needs elevated trust (payments, staff/admin provisioning).

**Stack:** React + Vite, Tailwind CSS, Firebase Auth + Firestore, Express backend (`canteen-backend/index.js`, deployed to Vercel project `index-js`), Razorpay payments.

---

## 1. Architecture

```
React app (Vite, HashRouter)
   │
   ├─ Firebase Auth (Google sign-in) + Firestore (all data)
   │
   └─ Express backend (canteen-backend/index.js → index-js-lovat.vercel.app)
         │  Firebase Admin SDK — does what Firestore rules alone can't
         └─ Razorpay (order creation, signature verification, webhook)
```

The backend is separate from Firestore rules on purpose: rules gate *who reads/writes what*, but can't verify a Razorpay signature or safely grant a role. Only the backend holds the Razorpay secret key and Admin SDK credentials.

---

## 2. Features by role

### Student / Faculty (`UserMenu.jsx`)
- Browse live menu across all 6 stalls (Falcon Veg, Fresheteria, Mingos, Break Time, Surf & Turf, Bakery)
- Cart, checkout, Razorpay payment
- Bulk/institutional department orders
- Quick reorder
- Meal-pass subscriptions (2-day / 3-day / weekly / monthly)
- **My Orders** — full order history, all statuses, live
- Spend Wallet — paid-order spend tracking + receipts
- Live Status sidebar — active orders only, with pickup token
- Order-ready notification pill
- Discovery hero, category strip, stall carousel with real wait-time estimates
- Search overlay, dark/light theme
- **Footer** — brand, nav, all 6 stalls, hours, support, socials

### Kitchen Staff (`KitchenLiveBoard.jsx` → `StallTerminal.jsx`)
- Google sign-in; stall resolved server-side by registered email, auto-routed — no picker *(replaced the earlier OTP flow)*
- Single-occupancy lock — one operator per stall
- Kanban fulfillment board (Pending → Preparing → Ready)
- Stall Menu Manager (add/edit/price items)
- Financial Dashboard (order history, ledger)
- Prep-capacity control, pause incoming orders
- Queue Analytics — M/M/c queueing model, Erlang-C wait probability
- Demand Forecast — seasonal EWMA + trend, 1–3h horizon
- Request Logout → goes to admin for approval

### Admin (`AdminPanel.jsx`)
- Single fixed bootstrap account; all further admins promoted from inside the panel
- **Stalls tab:** live occupancy, open/close, pause toggle, Force Release, registered email per stall (save/remove — remove now fully de-provisions the account)
- **Users & Roles tab:** promote/demote/reassign any account
- **Logout Requests tab:** approve/deny staff sign-out
- **Overview tab:** cross-stall activity at a glance

---

## 3. Data model (Firestore)

| Collection | Purpose |
|---|---|
| `users/{uid}` | Role, assigned stall, profile — source of truth for access |
| `orders/{id}` | Full order docs — owner + staff read only |
| `order_signals/{id}` | Non-PII mirror (stall/status/timestamps) — feeds queue & demand models |
| `subscriptions/{id}` | Meal-pass purchases |
| `products/{id}` | Menu items per stall |
| `shop_status/{stall}` | Open/closed, busy/paused, prep capacity |
| `stall_sessions/{stall}` | Single-occupancy lock |
| `stall_email_registry/{stall}` | Admin-managed email → stall mapping |
| `logout_requests/{uid}` | Staff sign-out approval queue |

---

## 4. Backend routes (`canteen-backend/index.js`)

Bare paths, no `/api` prefix.

| Route | Does | Status |
|---|---|---|
| `POST /create-order` | Creates the Razorpay order | Live |
| `POST /verify-payment` | Verifies signature, marks order paid | Live |
| `POST /webhook` | Razorpay's payment callback | Live |
| `POST /staff-login` | Resolves stall by email, grants staff role + lock | Live |
| `POST /claim-admin-seat` | Grants admin to the bootstrap account | Live, hardened |
| `POST /admin-set-role` | Promote/demote/reassign | Needs the same hardening |
| `POST /admin-approve-logout` | Resolve a staff logout request | Needs the same hardening |
| `POST /send-` / `verify-staff-verification-code` | Legacy emailed-OTP staff login | Unused, superseded |
| `POST /seed-demo` | Temporary demo-data generator | **Removed** (used once, cleared, deleted) |

---

## 5. Build log, in order

1. **Diagnosed the Admin Panel 404** — the live backend was a stale, hand-deployed Express app missing every admin/staff route; frontend was also calling the wrong URL prefix.
2. **Rebuilt and redeployed the backend** — ported missing routes in, fixed URL prefixes, deployed from outside the git tree to dodge Vercel's Git Author Verification block.
3. **Published the Firestore rules** — they existed in the repo but had never actually been deployed, causing "insufficient permissions" everywhere in the Admin Panel.
4. **Fixed stall-email autofill** — browser was cross-filling one saved address into all six stalls' registered-email fields.
5. **Replaced OTP staff login with direct login** — the emailed code depended on an unconfigured email service; since Google sign-in already proves email ownership, staff now go straight to their stall via `/staff-login`.
6. **Traced the "broken" analytics** — My Orders, Spend Wallet, Queue Analysis, Demand Forecast were all correctly built, just data-starved because payments and staff login had been broken. Verified with seed data, then fully cleared it.
7. **Built My Orders** — new order-history view; also fixed a dead `/dashboard` route that white-screened on subdomain emails.
8. **Scoped Live Status to active orders only** — it was showing completed orders as clutter.
9. **Fixed stall de-provisioning** — a real incident (a removed staff member got stuck, then locked out of the whole app). Fixed at three points: access revocation on removal, immediate terminal sign-out, and a safe fallback for an orphaned staff role.
10. **Closed an admin-takeover exploit** — `/claim-admin-seat` trusted a client-supplied uid/email; anyone could forge the known bootstrap email and become admin. Now verifies a real Firebase ID token. Verified live: the attack now returns 401.
11. **Built the footer** — brand, nav, all 6 stalls, hours, support, socials, payment trust — in the app's own navy/gold identity.

## 5b. The 97-section spec redesign (DISCOVER → ORDER → TRACK → RETURN)

Front-of-house overhaul on top of the existing business logic — every real data flow (Firestore, cart, Razorpay, voice, meal passes, wallet, kitchen, admin) preserved, no fake data, no new dependencies.

- **Design tokens** in `src/index.css` (`:root` warm off-white + `html.dark` navy/gold); theme now toggles `dark` on both `<html>` and `<body>` (UserMenu effect), persists `localStorage.kitchenDarkMode`.
- **Persistent chrome**: `AppHeader` (top bar with tabs/search/cart/theme/account) + `BottomNav` (phone tab rail) share `APP_TABS` from `src/components/appTabs.js` (extracted so AppHeader stays HMR-clean). Replaces the old hero navbar + mini-header.
- **New HOME tab** (default tab now "home"): `HomeHero` (time-aware greeting + signed-in name), `OpenNowStalls`, `HomeCategories` (real distinct category chips → Menu with filter applied), `HomeCombos` (real co-purchase pairs via `computePopularPairs`, "Add both" → cart), `HomeRecommendations` (split into "Your usuals" / "You might like these next" / "Popular across every stall" + honest no-history empty state), `StallCarousel` (full stall directory), `EditorialFeature`; `handleSelectStallFromHome`/`handleCategoryFromHome` jump into ordering.
- **Order pipeline**: `CheckoutSheet` (review step before Razorpay — real cart total, live wait pill, pass note, §35-41) → existing `handleOrder(cart)` → new `OrderConfirmation` (real order snapshot: token, items, total, wait; stays open until dismissed/tracked) → `MyOrders` live `onSnapshot` with `OrderStatusSteps` (pending→preparing→ready→completed), itemized receipts, and "Order again" (`handleReorder` rebuilds the cart, opens the drawer).
- **Restyled, `darkMode` prop removed** (CSS variables instead): LiveStatusSidebar (real status/token/delay chips), OrderReadyPill, Footer, LoginModal, GuestFallbackCard (builds on EmptyState), SpendWallet, MealPassesTabContent, SuccessCheckOverlay, VoiceOrderingPanel, CartBar/CartDrawer/MenuGrid/CategoryStrip/MenuItemCard/MenuItemSkeleton/QuantityControl/QuickReorders/RatingStars/ShopSelector/ShopSpotlight/StallCarousel/ChefSpecials/Recommendations/PromotionsCarousel/MealPassCallout.
- **StallDiscoverySearch** rebuilt as a search command center: empty-query "start here" view (recent searches in `localStorage`, your usuals, popular right now), dish quick-add steppers straight from results, autofocus, Escape close, stall/dish tabs, top-match hero; global ⌘K/Ctrl+K opens it from anywhere.
- **Recommender**: `computePopularPairs` added (real lift-scored co-purchase pairs both resolved against the live catalogue); `useRecommendations` now returns `pairs` and 8 picks.
- **Dead code removed**: four legacy, unimported components — `HeroBanner`, `MiniHeader`, `CanteenMenu`, `StallSearchResults` — deleted.
- **Verification**: `npm run build` passes (152 modules). All 240 unit tests pass across 15 files. Lint is clean on every file touched by the redesign; the remaining lint errors in `UserMenu.jsx` are the pre-existing baseline (legacy setState-in-effect patterns plus a `performance.now()` purity error, confirmed unchanged vs HEAD). The project is 100% JavaScript.

---

## 6. Security posture

**Holding up well:**
- Razorpay publishable key in the browser — correct, it's meant to be public
- Razorpay secret + webhook secret — server-only, never shipped to the client
- Payment signatures verified with HMAC + constant-time comparison
- Firestore rules block clients from setting `payment_status` themselves

**Fixed:**
- Admin takeover hole (forged identity → instant admin) — closed via Firebase ID token verification
- Stall de-provisioning (removed staff could loop back in, or get fully locked out) — closed at three points

**Still open:**
- `/admin-set-role` and `/admin-approve-logout` still trust a client-supplied uid — same fix as `/claim-admin-seat`, not yet applied
- Payment amount tampering — client supplies both the Firestore price and the Razorpay amount; server doesn't cross-check against the real menu price yet
- Stall write-scoping (staff should only be able to modify their own stall's orders/menu/status server-side) — design spec approved, not yet implemented
- Footer support email / social links are placeholders — need real contact details
- `KitchenDashboard.jsx` and the legacy OTP routes are now dead code
