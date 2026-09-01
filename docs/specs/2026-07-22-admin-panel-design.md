# Admin Panel — Design

**Sub-project 3 of 3.** The oversight layer for both `UserMenu.jsx` and `KitchenLiveBoard.jsx`: fixed-role access control ("who can access what"), and the two pieces of infrastructure the first two sub-projects deliberately left unfinished — releasing a stuck stall, and actually approving a staff logout (the button was removed in sub-project 2, but nothing was ever built to replace it).

## Confirmed decisions

- **Admin identity: first-login-claims-it, not hardcoded.** A dedicated `/admin` login page. A new serverless function checks, inside a Firestore transaction, whether any user already has `role: "admin"`. If not, the signed-in account claims it. If one already exists, everyone else is denied with "an admin is already provisioned — ask them to add you." After that, only an existing admin can promote another user to admin, from inside the panel. No email is ever written into source code.
- **Access control depth: fixed roles**, not custom IAM policies. Four roles — `student`, `staff`, `faculty_admin`, `admin` — each with a hardcoded, clearly-displayed permission set. The panel can change which role a user holds and show what that role grants; it does not let anyone construct arbitrary custom policies. Matches the actual scale of a 6-stall app.
- **Theme: reuses `getTheme()` from `components/KitchenLiveBoard/helpers.js` directly** (dark teal/orange ops look) — not forked, not duplicated.

## What this sub-project actually builds

1. **Admin login + bootstrap** — `/admin` route, its own gated login page (separate from `MainContainer.jsx`'s student/staff gateway), the claim-seat serverless function.
2. **Roles & user management** — a table of every user (email, current role, assigned stall if staff), with the ability to change a user's role (including promoting a new admin) and reassign/clear a staff member's stall. This is the "IAM-lite" screen: a static reference of what each role can do, plus the actual controls to change who holds which role.
3. **Stall occupancy control** — live view of all 6 stalls' `stall_sessions` docs (who's logged in, since when), with a **Force Release** action that deletes the lock outright (for a stall that's stuck with no one actually there to request logout — e.g. a crashed browser).
4. **Logout request / approval loop** — the piece that makes "staff can't log out without admin permission" real:
   - New "Request Logout" button in `StallTerminal.jsx` (replaces the void left by sub-project 2's removed self-logout) — writes `logout_requests/{uid}` with `status: "pending"`.
   - `StallTerminal.jsx` subscribes to its own `logout_requests/{uid}` doc; when status flips to `"approved"`, it signs itself out and redirects, automatically, no user action needed.
   - Admin Panel shows all pending requests with stall/staff identity and a timestamp; **Approve** (releases the stall lock + marks the request approved, one atomic server-side operation) or **Deny** (staff stays logged in, sees why).
5. **Cross-stall live monitoring** — a single dashboard row per stall: open/closed, busy/paused, current occupant (or "unattended"), pending order count. The "watchman" view over both surfaces at a glance.
6. **Shop status master override** — from the panel, an admin can directly toggle any stall's open/closed and busy state without needing to be logged into that stall's terminal (today only the occupying staff member can do this from inside `StallTerminal`).

## Data model additions

- `logout_requests/{uid}` — `{ uid, stall, email, displayName, requestedAt, status: "pending" | "approved" | "denied" }`.
- No new fields needed on `users/{uid}` beyond the existing `role`/`assignedStall` — `role` now also accepts `"admin"`.

## New serverless functions

- `api/claim-admin-seat.js` — `{ uid, email, displayName }`. Firestore transaction: query `users` for any existing `role == "admin"`; if none, set this uid's role to `"admin"`; else return a clear denial.
- `api/admin-approve-logout.js` — `{ requesterUid, targetUid, stall, approve: boolean }`. Verifies `requesterUid` actually has `role: "admin"` server-side (defense in depth, not just trusting the client), then atomically updates `logout_requests/{targetUid}` and, on approval, deletes `stall_sessions/{stall}`.
- `api/admin-set-role.js` — `{ requesterUid, targetUid, role, assignedStall }`. Same admin-verification pattern; the one path (besides the staff-verification flow) allowed to write another user's `role`.
- Stall force-release and shop-status overrides can go through Firestore rules directly (`allow write: if isAdmin()`) rather than needing dedicated functions, since those are simple same-collection writes an admin rule can safely gate.

## Firestore rules changes (tightening, not just additions)

The current rules still let a client `create` their own `users/{uid}` doc with `role in ['student', 'staff']` — that path is now stale, since real staff provisioning happens exclusively through `api/verify-staff-verification-code.js` (Admin SDK) as of sub-project 2. This sub-project tightens that: client-writable self-registration is restricted to `role: "student"` only; `staff`/`admin`/`faculty_admin` can only ever be set by the Admin SDK paths (verify-code function, claim-admin-seat function, admin-set-role function) or by an existing admin's own rule-gated write. Also adds an `isAdmin()` rule helper and admin-gated rules for `stall_sessions` (read: staff+admin, write: admin-only for force-release) and `logout_requests` (staff can create/read their own; admin can read/update all).

## Verification plan

Same bar as the first two sub-projects: `vite build` + `eslint` clean. Live-browser testing this time is actually more feasible than the last sub-project — the admin bootstrap flow, role table, and stall dashboard don't require a second real Google account the way staff-email-verification did, so I should be able to exercise more of this end-to-end.
