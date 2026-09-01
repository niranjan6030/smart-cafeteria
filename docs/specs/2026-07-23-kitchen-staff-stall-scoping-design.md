# Kitchen Staff Stall-Scoping — Server-Side Write Hardening

- **Date:** 2026-07-23
- **Status:** Approved design, pending implementation
- **Author:** Project team
- **Approach chosen:** A — Defensive write-scoping, no data migration

## 1. Context

Kitchen-staff role-based login and stall routing are **already fully implemented** and are NOT changed by this work:

- `api/send-staff-verification-code.js` resolves a staff member's stall server-side from the admin-managed `stall_email_registry` (email → stall), with no client-side stall picker.
- `api/verify-staff-verification-code.js` (after email-OTP verification) writes `role: "staff"` and `assignedStall: "<Stall>"` to `users/{uid}`, and claims a single-occupancy `stall_sessions/{stall}` lock.
- `hooks/useAuthSession.js` re-reads `users/{uid}` on every auth-state change (so refresh / new sessions rehydrate correctly).
- `KitchenLiveBoard.jsx` reads `assignedStall`, redirects a staff member to `/live/{ownStallSlug}`, and bounces any attempt to open another stall's URL back to their own.
- `App.jsx` `StaffRoute` guard blocks non-staff from `/live`.

**The gap this design closes:** the "a staff member may only touch their own stall" guarantee is currently enforced **only in the browser**. At the Firestore-rules level, the mutating rules for `orders`, `products`, and `shop_status` say `if isStaff()` with **no per-stall check**. A staff member could therefore, via direct SDK/REST calls (bypassing the UI), modify another stall's orders, menu, or open/busy/capacity status.

## 2. Goals / Non-Goals

**Goals**
- Enforce, server-side, that a `staff` user may only **mutate** documents belonging to their own `assignedStall`.
- Cover the three write surfaces: `orders` (status advance), `products` (menu), `shop_status` (pause/capacity).
- Do so without breaking any legitimate staff, student, or admin flow.
- No production data migration.

**Non-Goals (explicitly out of scope)**
- **Reads are not scoped.** Staff can still *read* other stalls' order/menu data via raw API calls (the UI never surfaces it). Closing this requires either fragile multi-field query rules or a data migration — deferred (that is Approach B/C, a possible follow-up).
- No change to the login, OTP, redirect, or routing code.
- No change to student or admin capabilities.
- No normalization of the historical order stall-field drift (see §4).

## 3. Design

Runtime change surface: **`firestore.rules` only** — no application/runtime code changes. Testing (§5) additionally adds dev-only rules-test files and, if not already present, a minimal Firestore emulator test harness; none of that ships to users.

### 3.1 New helper functions

Added alongside the existing `isSignedIn()` / `isStaff()` / `isAdmin()` helpers:

```
function myStall() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('assignedStall', '');
}

// True when `stall` is the caller's own assigned stall. Handles the historical
// "Fresh Time" <-> "Break Time" display/data alias (see UserMenu.jsx shopKeyOf).
function stallMatches(stall) {
  return stall != '' && (
    stall == myStall()
    || (myStall() == 'Break Time' && stall == 'Fresh Time')
  );
}

// Order docs have drifted across three "which stall" field names over the app's
// history (shop_name is canonical for new orders; stallName / shop are legacy).
// Match the caller's stall against whichever the doc carries.
function staffOwnsOrder() {
  return isStaff() && (
       stallMatches(resource.data.get('shop_name', ''))
    || stallMatches(resource.data.get('stallName', ''))
    || stallMatches(resource.data.get('shop', ''))
  );
}
```

`myStall()` performs one `get()` of the caller's own `users/{uid}` doc. Firestore caches document accesses within a single rule evaluation, so repeated calls in one request cost ~one read.

### 3.2 `orders`

Only the **staff branch of `update`** changes; everything else in the rule is unchanged.

```
match /orders/{orderId} {
  allow read: if isSignedIn() && (resource.data.student_uid == request.auth.uid || isStaff());

  allow create: if isSignedIn()
    && request.resource.data.student_uid == request.auth.uid
    && request.resource.data.status == 'pending'
    && request.resource.data.payment_status == 'pending';

  allow update: if isSignedIn() && (
    // Staff may advance status/phase-timestamps — ONLY for their own stall's orders.
    (staffOwnsOrder()
      && validOrderStatus(request.resource.data.status)
      && onlyChanged(['status', 'updatedAt', 'preparing_started_at', 'ready_at', 'completed_at']))
    ||
    // The order's own student may only self-report pickup: ready -> completed.
    (resource.data.student_uid == request.auth.uid
      && resource.data.status == 'ready'
      && request.resource.data.status == 'completed'
      && onlyChanged(['status', 'updatedAt', 'completed_at']))
  );

  allow delete: if isSignedIn() && resource.data.student_uid == request.auth.uid
    && (resource.data.status == 'completed'
        || (resource.data.status == 'pending' && resource.data.payment_status == 'pending'));
}
```

`delete` is already student-only (staff never delete orders — `clearCompletedBoard` advances to `completed` via `update`), so it needs no stall check.

### 3.3 `products` (menu)

Product docs carry a `shop` field (`StallMenuManager.jsx` writes `shop: assignedStall`). Split the broad `write` into scoped `create` / `update` / `delete` so a product can be neither created for, edited in, nor moved to another stall:

```
match /products/{productId} {
  allow read: if true;
  allow create: if isStaff() && stallMatches(request.resource.data.get('shop', ''));
  allow update: if isStaff()
    && stallMatches(resource.data.get('shop', ''))
    && stallMatches(request.resource.data.get('shop', ''));
  allow delete: if isStaff() && stallMatches(resource.data.get('shop', ''));
}
```

### 3.4 `shop_status`

The `shop_status` document **ID is the stall name** (`StallTerminal.jsx` writes `doc(db, 'shop_status', assignedStall)`), so scope on the wildcard directly. Admin retains full write access (the Admin Panel overrides any stall's status).

```
match /shop_status/{shopId} {
  allow read: if true;
  allow write: if isAdmin() || (isStaff() && stallMatches(shopId));
}
```

## 4. Data-model notes (why the defensiveness)

- **New orders** are created with `shop_name` (`UserMenu.jsx:538`). Legacy orders may instead carry `stallName` or `shop` — `StallTerminal.jsx` runs three parallel equality queries to catch all three. The `staffOwnsOrder()` helper mirrors that reality.
- **`assignedStall`** values (`users/{uid}`) are the canonical display names: `Falcon Veg`, `Fresheteria`, `Mingos`, `Break Time`, `Surf & Turf`, `Bakery` (see `components/KitchenLiveBoard/stalls/index.js`). These equal both `shop_status` doc IDs and `products.shop`, so scoping aligns cleanly there.
- **Fresh Time alias:** `UserMenu.jsx:301` maps `shop_name === "Fresh Time"` to `"Break Time"`. `stallMatches()` therefore treats a `"Fresh Time"` stall value as belonging to a `"Break Time"` staff member, so this hardening can never lock Break Time staff out of a legitimately theirs but differently-labelled order.

## 5. Testing strategy

> **Test-infrastructure note:** the project currently has no automated test setup (see the roadmap's pending "tests/CI" item). If no Firestore emulator / rules-test harness exists yet, the implementation plan's first step is standing up a minimal one — `firebase.json` emulator config, the `@firebase/rules-unit-testing` dev dependency, and an `npm` test script. That setup may be comparable in effort to the rule change itself, but it is the correct way to verify security rules and, critically, guards against a lockout regression (a bad rule silently denying staff their own stall).

Firestore rules unit tests via the emulator (`@firebase/rules-unit-testing`). Seed `users/{uid}` docs (`role: staff`, `assignedStall`) plus fixture docs, then assert:

**orders (update)**
- Mingos staff advancing a `shop_name: "Mingos"` order → **allow**.
- Mingos staff advancing a `shop_name: "Bakery"` order → **deny**.
- Legacy-field parity: Mingos staff advancing a `stallName: "Mingos"` and a `shop: "Mingos"` order → **allow**.
- Alias: Break Time staff advancing a `shop_name: "Fresh Time"` order → **allow**.
- Staff changing a disallowed field (e.g. `price`, `student_uid`) on their own order → **deny** (unchanged `onlyChanged` guard).
- Student self-pickup `ready -> completed` on own order → **allow** (unchanged).

**products (create/update/delete)**
- Mingos staff create/edit/delete a `shop: "Mingos"` product → **allow**.
- Mingos staff touching a `shop: "Bakery"` product → **deny**.
- Mingos staff *moving* their product to `shop: "Bakery"` (update changing shop) → **deny**.

**shop_status (write)**
- Mingos staff writing `shop_status/Mingos` → **allow**; `shop_status/Bakery` → **deny**.
- Admin writing any `shop_status/*` → **allow**.

**Regression**
- Student reads/creates own order, reads products/shop_status → unaffected.
- Admin order/user/registry operations → unaffected.

## 6. Rollout & rollback

1. Back up the currently-live rules (copy from Firebase Console → Firestore → Rules, or `firebase firestore:rules get` if available) into the PR/commit description.
2. Run the emulator rules tests locally; all green.
3. Deploy the new `firestore.rules` — Firebase Console paste (as done 2026-07-23) or `npx firebase-tools deploy --only firestore:rules`. Instant, reversible.
4. Smoke-test live: a signed-in staff member can still advance their own stall's orders, edit their own menu, and toggle their own pause/capacity.
5. **Rollback** if anything misbehaves: re-paste the backed-up previous rules. No data is touched, so rollback is complete and immediate.

## 7. Risks & residual exposure

- **Reads remain open to any staff** (accepted, §2). A follow-up (Approach B: normalize order stall-field, then scope reads) can close this later.
- **`get()` per write** adds ~one document read per staff mutation. Staff writes are low-frequency; negligible cost, well within Firestore's per-request `get()` limits.
- **Data assumption:** the hardening trusts that `users/{uid}.assignedStall` is only ever set by the server (Admin SDK) — which is true (`api/verify-staff-verification-code.js` / `api/admin-set-role.js`), and the `users` update rule already forbids a student from changing their own role/stall.

## 8. Open items to confirm during implementation

- Verify `products`' read/list query in `StallMenuManager.jsx` is not accidentally tightened (we only touch write clauses; read stays `if true`).
- Confirm no other client code writes `orders` / `products` / `shop_status` as a staff user outside `StallTerminal` / `StallMenuManager` (grep during implementation).
