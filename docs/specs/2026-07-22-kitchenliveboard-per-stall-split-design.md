# KitchenLiveBoard Per-Stall Split — Design

**Sub-project 1 of 3** (agreed order: split → email-verified staff login → Admin Panel). This spec covers only the split. Auth changes (MainContainer.jsx, email verification codes) and the Admin Panel are out of scope here and land in later specs.

## Goal

Break the 1524-line `src/KitchenLiveBoard.jsx` into one file per concern (mirroring the `src/components/UserMenu/` split already done), and give each of the 6 stalls its own component file *and* its own route/page, so a staff member logged into "Falcon Veg" only ever renders the Falcon Veg component — never a shared component that happens to filter by stall internally.

## Current state (verified against the live file)

- `KitchenLiveBoard()` reads `assignedStall` once from `localStorage` on mount and scopes every Firestore query (`orders`, `shop_status`, `products`) to that one value.
- Three views live behind an `activeView` tab inside the same component: Fulfillment Board (Kanban), Stall Menu Manager, Financial Dashboard.
- Orders are matched by querying three legacy field names (`stallName`, `shop_name`, `shop`) all equal to `assignedStall` and merging the results — this already exists and is preserved as-is.
- `assignedStall` itself is set today by `MainContainer.jsx`'s stall dropdown + shared demo passcode (`"1234"`) flow, then written to both `localStorage` and the `users/{uid}` Firestore doc. **Not changed in this sub-project.**
- Staff logout today (`handleReturnToGateway`) immediately clears local state and calls `signOut()` — no approval gate. **Not changed in this sub-project** (that's sub-project 3).

## Architecture

**A. Thin per-stall wrapper + one shared parameterized terminal** (approved). Extract every reusable piece into `src/components/KitchenLiveBoard/`:

- `helpers.js` — `STALLS`, `CATEGORIES`, `PAGE_SIZE`, `money`, `orderCreatedMs`, `formatTime`, `generateMockOtp`, `compressImageToDataUri`, `getTheme`, `playOrderAlertTone`, `printOrderTicket`, image-size constants
- `icons.jsx` — `PrintIcon`, `PencilIcon`, `TrashIcon`, `StarIcon`, `FlameIcon`, `ImageIcon`, `SunIcon`, `MoonIcon`
- `ResetStallModal.jsx`, `OrderCard.jsx`, `KanbanColumn.jsx`, `UnassignedScreen.jsx`, `StallMenuManager.jsx`, `FinancialDashboard.jsx` — unchanged bodies, moved verbatim
- `StallTerminal.jsx` — today's `KitchenLiveBoard()` function body, parameterized: takes `stallName` as a prop instead of reading `assignedStall` from `localStorage` itself. All internal logic (Kanban, tabs, dark mode, pause/capacity, reset modal, KOT printing) is otherwise unchanged.
- `stalls/FalconVeg.jsx`, `Fresheteria.jsx`, `Mingos.jsx`, `BreakTime.jsx`, `SurfTurf.jsx`, `Bakery.jsx` — one-line files, each rendering `<StallTerminal stallName="…" />`
- `stalls/index.js` — the single lookup table mapping stall name → component and stall name → URL slug (`"Falcon Veg" → "falcon-veg"`, etc., hardcoded — not a generic slugifier, since "Surf & Turf" needs an explicit mapping anyway)

`src/KitchenLiveBoard.jsx` becomes a thin router: resolves the signed-in staff member's assigned stall (same `localStorage` read as today), looks it up in `stalls/index.js`, and renders that one wrapper — or `UnassignedScreen` if it's missing/invalid.

Rejected: fully duplicating the ~1500 lines six times (six-way maintenance cost for identical behavior), and keeping one file with conditional rendering (doesn't satisfy "separate component file per stall").

## Routing — "each stall has its own window and file page"

Add nested routes in `App.jsx`:

- `/live/:stallSlug` — renders the matching stall wrapper. Guarded by the existing `StaffRoute`, plus a new check: if `stallSlug` doesn't match the signed-in staff member's own `assignedStall`, redirect to their own stall's URL. This means typing another stall's URL directly does not leak that board.
- `/live` (no slug) — becomes a pure redirect: compute the current staff member's slug and `<Navigate to={"/live/" + slug} replace />`. `UnassignedScreen` renders here if there's no valid assignment.

This makes each stall's terminal independently bookmarkable/linkable — a real "own page," not just conditional UI — without touching `MainContainer.jsx`.

## Data flow (unchanged)

Order/product/shop_status queries, the Kanban columns, SLA timers, financial ledger, menu CRUD, dark mode, KOT printing, pause/capacity controls — all identical logic, just relocated and parameterized by a prop instead of a module-level localStorage read.

## Verification plan

1. `vite build` + `eslint` clean (same bar as the UserMenu split; pre-existing lint findings from that pass are expected and not regressions to fix here).
2. Live browser check: sign in as staff for two different stalls (e.g. Falcon Veg and Mingos) in two sessions, confirm each only ever renders its own board.
3. **Explicit cross-check requested by the user**: place a real order from `UserMenu` against a specific stall (e.g. "Mingos"), and confirm it appears in the Mingos stall terminal's Pending column — and does *not* appear in another stall's terminal. This validates the split didn't break the existing `stallName`/`shop_name`/`shop` order-matching logic.
4. Confirm `/live/mingos` and `/live/falcon-veg` are independently reachable, and that a staff member assigned to one is redirected away from the other's URL.

## Explicitly deferred (later sub-projects / later cleanup)

- Real per-person email verification code, replacing the shared `"1234"` passcode — sub-project 2, touches `MainContainer.jsx`.
- Admin Panel + logout-approval gate (staff can't sign out without admin permission) — sub-project 3. Note: `ResetStallModal`'s "Reset Stall Assignment" (mock-OTP, logs the code to the console) is currently a way to leave a stall without going through real logout — this is a loophole against the "no self-logout" goal and needs to be addressed in sub-project 3, not this one.
- Deleting old/unused files (mentioned: possibly-stale `UserMenu.jsx`/`KitchenLiveBoard.jsx` copies, and `KitchenDashboard.jsx`) — deferred at the user's request. Note: `KitchenDashboard.jsx` is **currently wired into a live route** (`/dashboard`, student order history) — it is not dead code today, so this claim needs to be revisited with the user before anything is deleted.
