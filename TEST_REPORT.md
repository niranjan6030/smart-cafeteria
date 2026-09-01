# Smart Cafeteria — Test Report

Six-category pass: unit, integration, E2E, security, load, UAT. Live load testing was explicitly skipped (real Razorpay keys in production — see §5). Everything else was actually executed, not just planned.

**Bottom line:** 1 functional bug found and fixed live (My Orders tab silently vanished from the hero nav). 1 real security gap confirmed on 2 more routes (same class already fixed on `/claim-admin-seat`). 1 real scaling risk (unbounded live listeners). Nothing found that's broken for users *today* at current traffic — the security and scaling items are about *staying* safe as usage grows.

---

## 1. Unit testing

No test framework existed. Installed **Vitest**, added `npm test`, wrote real tests for the two pure-logic modules (queueing model, demand forecast) — these are the only modules with no Firebase/network dependency, so they can be tested honestly without mocking.

```
Test Files  2 passed (2)
     Tests  17 passed (17)
```

Covers: cold-start defaults, real service-time averaging, utilization clamping (≤0.98), non-negative wait times, minimum-concurrency enforcement, sample-window expiry, wait-label thresholds, cold-start meal-curve shape, non-negative predictions, `next3h` sum consistency, malformed-input resilience, hour-label formatting.

**Not covered:** anything touching Firebase/React components — would need a proper mocking setup (Firebase emulator or mocked SDK), which doesn't exist yet. Recommend as a follow-up, not done here.

Run it yourself any time: `npm test`

---

## 2. Integration testing

Live requests against the deployed backend, restricted to validation/negative-auth paths — nothing that spends money or grants real access.

| Route | Test | Result |
|---|---|---|
| `/create-order` | missing amount | **500** — should be 400 (see finding below) |
| `/create-order` | amount ₹0 | **500** — same issue |
| `/verify-payment` | missing fields | 400, correct |
| `/webhook` | no signature header | 400 "Configuration Error", correct |
| `/admin-set-role` | missing fields | 400, correct |
| `/admin-set-role` | forged non-admin requester | 403, correctly denied |
| `/admin-approve-logout` | missing fields | 400, correct |
| `/staff-login` | missing fields | 400, correct |
| `/staff-login` | unregistered email | 403, correct |
| `GET /` | health check | 200 "Christ Canteen Server is Online" |

**Finding:** `/create-order` returns **HTTP 500 for ordinary bad input** (missing/zero amount) instead of 400. Razorpay's own validation error is being relayed correctly in the *body*, but the *status code* is wrong — the route's catch-all always sends 500 regardless of whether it's a client mistake or a real server fault. Low severity, but it means any uptime/error monitoring watching for 500s will false-alarm on normal user mistakes.

---

## 3. End-to-end testing

Drove real flows through a live browser against the dev build.

**Tested and passing:**
- Route guards: `/live`, `/dashboard` correctly redirect unauthenticated visitors to `/login`; `/admin` correctly shows the admin gateway instead of bouncing
- Portal tab switching (Student / Kitchen Staff / Admin) — correct copy per tab, no OTP UI (matches the current no-code staff login)
- Guest student menu: hero, menu grid, footer all render; My Orders tab shows the correct "log in to continue" fallback for guests
- No unexpected console errors (the only console noise is guest visitors being denied `order_signals` reads, which is correct/expected rules behavior, not a bug)

**Bug found and fixed live:** the **My Orders tab was missing from the hero navigation** — [HeroBanner.jsx:291](src/components/UserMenu/HeroBanner.jsx#L291) had a bare `,` where the tab's `{ id: "my-orders", ... }` object should be. That makes a *sparse array*, and `.map()` silently skips sparse slots — no crash, no warning, the tab just never rendered. Confirmed in the browser, fixed, re-verified the fix live, lint + build clean.

**Not tested (needs a real account, can't be scripted headlessly):** actual Google OAuth sign-in, a real staff member's board, a real admin session's actions (promote/demote, force-release, remove-email), and the live Razorpay checkout. These need your eyes — see the UAT script in §6.

---

## 4. Security testing

**Systematic pass across every backend route**, extending the exploit found and fixed on `/claim-admin-seat`.

**Confirmed vulnerable — same class, not yet fixed:**
- **`/staff-login`** — trusts `req.body.uid` / `req.body.email` with no identity verification. Anyone can claim staff role + a stall's occupancy lock for any registered stall email, without ever proving they control that email, as long as the stall isn't already occupied.
- **`/admin-set-role`** and **`/admin-approve-logout`** — trust `req.body.requesterUid`; knowing an admin's uid (not authenticating as them) is enough to pass the admin check.

**Verified clean:**
- No `.env` files or secrets tracked in git
- No hardcoded API keys/credentials in source
- No `dangerouslySetInnerHTML` anywhere — no obvious XSS injection surface
- Razorpay publishable key public (correct, by design); secret + webhook secret server-only (correct)
- Payment signature verification uses proper HMAC + constant-time comparison
- `/claim-admin-seat` — the one route already hardened — correctly rejects a forged identity with 401

**Lower-severity:**
- CORS is fully open (`cors()` with no origin restriction) on the whole backend. Not exploitable today since nothing relies on cookies, but worth tightening once every route is token-verified.

**Not tested:** the *live* `/staff-login` exploit itself wasn't executed — proving it would require hijacking a real stall's occupancy lock, which would kick out any staff member currently on it. This is a code-review-confirmed finding, not a live-fired one, deliberately to avoid disrupting anything real.

---

## 5. Load testing — **not performed live, by design**

Your backend holds live Razorpay keys and moves real money. Firing concurrent load at it risks real cost, Razorpay fraud-detection flags, or a Vercel rate-limit/suspension — for a canteen this size, that risk isn't worth the data. Per your instruction, this was a **code review for scaling issues** instead:

- **`order_signals` is a live, unbounded, whole-collection subscription** ([UserMenu.jsx:274](src/UserMenu.jsx#L274)) — fired on *every* student menu page load, including guests. No `where`, no `limit`. As the canteen operates over months, every single visitor downloads and stays live-subscribed to the *entire* historical order collection just to compute a wait-time estimate. This is exactly what ballooned when 1,142 orders were seeded earlier — real usage will do the same, just slower.
- **`StallTerminal`'s three per-stall order queries** are `where`-scoped but still unbounded — a stall's terminal re-downloads its entire lifetime order history on every load, forever growing.
- **`MyOrders`** is unbounded too, though lower risk since it's scoped to one student.
- **`limit()` is used nowhere in the codebase.**

None of this breaks anything *today* — it's a "gets slower and more expensive as history accumulates" risk, not a live bug. The fix, when you want it, is straightforward: bound these queries to a rolling time window (e.g. last 14–30 days), since that's already enough data for the queueing/demand models to work well.

---

## 6. User acceptance testing — **your turn**

Acceptance is a judgment call only you can make. Here's a concrete script — go through each portal and confirm it does what you'd expect as a real user:

### Student
- [ ] Sign in, browse all 6 stalls, add items to cart, complete a real checkout
- [ ] Order appears immediately in **My Orders** with the correct status
- [ ] Once staff mark it paid/complete, **Spend Wallet** reflects it
- [ ] **Live Status** only ever shows active orders, never old completed ones
- [ ] Meal pass purchase and redemption works end to end
- [ ] Footer links (My Orders, Menu, stalls) actually jump to the right tab

### Kitchen Staff
- [ ] Sign in with a registered stall email → lands directly on that stall's board, no picker
- [ ] Signing in with an *unregistered* email is correctly turned away
- [ ] New orders appear on the board in real time; advancing Pending → Preparing → Ready → Completed works
- [ ] Queue Analytics and Demand Forecast show real numbers once there's order history (not stuck on "estimating")
- [ ] Request Logout → shows up in the Admin Panel → approving it signs the staff member out

### Admin
- [ ] Sign in with the bootstrap account → lands in the panel; any other account is denied
- [ ] Stalls tab: Force Release, open/close, pause all work; registering/removing a stall email works
- [ ] **Removing a stall's email fully revokes that staff member** — they can't log back into that stall, and if they were mid-session, they're kicked out immediately
- [ ] Users & Roles: promote/demote/reassign takes effect immediately
- [ ] Logout Requests: approve/deny both work correctly

Once you've run through this and it matches what you expect, that's your sign-off — I can't do that step for you.
