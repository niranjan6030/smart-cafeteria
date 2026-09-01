# Staff Email-Verified, Single-Occupancy Login — Design

**Sub-project 2 of 3.** Replaces the shared demo passcode (`"1234"` in `MainContainer.jsx`) with a real per-person emailed code, and adds a "one stall, one active session" lock that only the (not-yet-built) Admin Panel can release. Sub-project 3 builds that Admin Panel; this spec only builds what it needs to plug into.

## Confirmed decisions

- **Email delivery: Resend.** New Vercel function(s) will call the Resend API. Needs `RESEND_API_KEY` added to Vercel env vars. **Caveat to flag now**: on Resend's free tier without a verified sending domain, you can only send *to* the email address on your own Resend account — sending to arbitrary staff emails requires verifying a domain in Resend first. Worth doing before testing with real staff addresses.
- **Shared passcode: removed entirely.** The emailed code becomes the only gate into the stall picker's Google sign-in.
- **Login model: single-occupancy per stall, admin-released.** Once a staff member successfully verifies into a stall, that stall is locked to them. Anyone else attempting to log into that same stall (including the same person from a different device) is blocked with a "this stall is in use — contact the admin" message. Nothing in the UI can release the lock — that requires the Admin Panel (sub-project 3). Every successful login is a fresh email-code check, since a login only ever happens when a stall is currently free.

## What's genuinely new vs. what's deferred

This sub-project builds: the email code send/verify endpoints, the occupancy lock, and the "blocked, contact admin" UI. It does **not** build any way to release a lock or approve a logout — that's the Admin Panel itself. Until sub-project 3 ships, freeing a stuck stall means manually deleting its `stall_sessions/{stallName}` Firestore document (I'll document the exact steps when this is built). The existing self-service "Reset Stall Assignment" button (`ResetStallModal`, mock-OTP-to-console) is removed from the staff terminal in this sub-project, since it's a self-logout path that directly contradicts "only the admin can release a stall."

## New data

- `staff_verification_codes/{uid}` — `{ code, stall, email, createdAt, expiresAt, attempts }`. Written by the send-code function, checked and deleted by the verify-code function. 10-minute expiry, max 5 attempts before requiring a fresh code.
- `stall_sessions/{stallName}` — `{ uid, email, displayName, loginAt }`. Created by the verify-code function on successful verification (the occupancy lock). Checked before a code is even sent — if a stall is already occupied by a different `uid`, no code is sent at all.

## New serverless functions (mirroring the existing `api/*.js` + `_firebaseAdmin.js` pattern)

- `api/send-staff-verification-code.js` — input `{ uid, email, stall }`. Checks `stall_sessions/{stall}` first; if occupied by someone else, returns an error instead of sending anything. Otherwise generates a 6-digit code, writes `staff_verification_codes/{uid}`, emails it via Resend.
- `api/verify-staff-verification-code.js` — input `{ uid, code, stall }`. Validates the code (matches, not expired, attempts under limit), and on success: writes `stall_sessions/{stall}` (claims the lock) and `users/{uid}` (`{ role: "staff", assignedStall: stall }`) via the Admin SDK — the client never gets to self-report "verified," only the server's own check can grant the role/lock.

## Flow changes in `MainContainer.jsx`

Stall picker (unchanged) → "Continue with Google" → `signInWithGoogle()` → call send-code → show a 6-digit code entry screen (replaces the old passcode form) → call verify-code → on success, reload into `/live` (same pattern `KitchenLiveBoard.jsx` already uses elsewhere). A "Cancel" option signs back out and clears the in-progress state rather than leaving a half-authenticated session hanging.

## Why `App.jsx`/`useAuthSession.js` need a small change

Right now `/login`'s route element redirects away from `MainContainer` the instant `user` becomes truthy — but Google sign-in completes *before* the email code is verified, so without a fix `MainContainer` would vanish mid-flow, before it can even show the code-entry screen. Fix: only redirect away once `userRole` has actually resolved (`!user || userRole == null` keeps rendering `MainContainer`); `useAuthSession.js` gets a small addition so a first-time sign-in with no Firestore doc yet, mid-verification, doesn't get misclassified or kicked out for failing the student email-domain check.

## Verification plan

Same bar as the previous two sub-projects: `vite build` + `eslint` clean, and as much live-browser testing as is possible without real staff Google/Resend credentials (I'll be explicit about what I can't verify end-to-end, same as last time).
