# Smart Cafeteria

Campus food ordering for Christ University's six canteen stalls. Three portals
— students, kitchen staff, admin — over one Firestore database, with a small
set of serverless functions holding the only things a browser cannot be trusted
with.

```
src/            React 19 + Vite SPA — all three portals
api/            Vercel serverless functions (payments, roles, assistant)
canteen-backend/  Express app: the same routes, deployed as one function
razorpay-backend/ Standalone Express variant of the payment routes
firestore.rules   The actual authorization boundary
android/ ios/     Capacitor native shells
```

Six stalls: Falcon Veg, Fresheteria, Mingos, Break Time, Surf & Turf, and
Bakery (shown as Cake Boutique).

---

## Run it now

```bash
npm install && npm run dev
```

Open <http://localhost:5173>. Browsing, the cart, search, voice ordering, the
recommender and the food assistant's rule-based path all run against the
Firestore project with no extra configuration.

Payments and the staff/admin routes need a backend. Copy `.env.example` to
`.env.local` and point it at your own deployment:

```bash
VITE_PAYMENT_API_BASE_URL=https://your-project.vercel.app
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
```

Unset, checkout stops and says payments are not connected rather than failing
silently. That is deliberate — see [Honest notes](#honest-notes).

---

## The one idea worth explaining first

**Firestore rules decide who may read and write. They cannot decide anything
that requires a secret.**

A Firestore security rule is an expression evaluated against a document and an
auth token. It is genuinely good at "only this student may read this order" and
"nobody may set `payment_status` to `paid`". It cannot compute an HMAC against
Razorpay's signing secret, and it cannot safely hand out a staff role, because
doing either means holding a secret the client would have to ship.

So the app is split along exactly that line:

| Decision | Where it is made | Why there |
|---|---|---|
| May this user read this order? | `firestore.rules` | Pure authorization over data the client already has |
| Is this payment signature real? | Serverless function | Needs `RAZORPAY_KEY_SECRET`, which never leaves the server |
| Is this person staff, and at which stall? | Serverless function | Grants a role — the client must not be the one asserting it |
| Did the payment actually land? | Razorpay webhook | The browser can be closed mid-checkout |

There is no general-purpose backend for app data. The React client talks to
Firestore directly with the client SDK, and the server exists only where that
table says it must. Adding a server in front of everything else would have
bought latency and no security.

---

## What is actually built

### For students and faculty

Browse the live menu across all six stalls, with a real wait-time estimate per
stall rather than a decorative one. Cart, checkout, Razorpay payment, pickup
token, live order status, order history with itemised receipts, and one-tap
reorder that rebuilds the cart from a past order.

On top of ordinary ordering:

- **Meal passes** — 2-day, 3-day, weekly and monthly subscriptions, priced with
  a real discount ladder (3% / 8% / 15%), paid through the same Razorpay flow
  but written to `subscriptions` rather than `orders`.
- **Bulk institutional orders** — a faculty admin ordering for a seminar,
  department meeting or festival, rather than forcing catering through a
  student cart.
- **Spend wallet** — spend tracking and receipts across paid orders.
- **Search as a command centre** — ⌘K from anywhere; empty-query view shows
  recent searches, your usuals and what is popular right now, and results carry
  quantity steppers so a dish goes into the cart without leaving search.
- **Voice ordering** and a **food assistant**, both described below.

### For kitchen staff

Staff sign in with Google. The stall is resolved server-side from a registered
email in `stall_email_registry` — there is no stall picker, because a picker is
a list of stalls you could claim to work at.

- **Single-occupancy lock.** One operator per stall, held in `stall_sessions`.
  A second terminal is refused, not silently allowed to fight over the same
  board.
- **Kanban fulfilment** — Pending → Preparing → Ready → Completed, one obvious
  action per card.
- **Command centre** built in three layers: *now* (counts and wait time),
  *next* (the order cards), *insight* (what to prepare, when the rush lands).
  Staff see the decision; the algorithm lives on its own tab.
- **Stall menu manager** — add, edit, price, mark specials, toggle
  availability, upload a photo.
- **Financial dashboard** — order history and ledger for that stall.
- **Prep capacity and pause** — the concurrency figure the queueing model uses
  is the same one staff set here, so the wait time students see reflects how
  many hands are actually on the line.
- **Request logout** — releasing a stall goes to an admin for approval, so a
  terminal cannot be abandoned mid-service.

### For admins

A single fixed bootstrap account; every other admin is promoted from inside the
panel. Live stall occupancy with force-release, open/close and pause overrides,
the registered email per stall (adding one provisions an account, removing one
de-provisions it), promote/demote/reassign for any user, the staff logout queue,
and cross-stall activity.

---

## The models

Four pieces of statistics, all hand-written, dependency-free and unit-tested.
None of them call a service. That was a deliberate constraint: a canteen in its
first months has sparse, noisy data, and a model you cannot open and check is a
model you cannot defend.

### Wait times — M/M/c queueing (`src/queueingModel.js`)

Arrival rate λ from `created_at` timestamps, service rate μ from the real gap
between `preparing_started_at` and `ready_at`, and c = the stall's prep
capacity. Little's Law gives the number students actually see — a
backlog-based estimate. Erlang-C gives the steady-state diagnostics
(probability of queueing, utilisation) shown to staff instead.

They are separated on purpose. Erlang-C answers "in the long run, how loaded is
this stall?", which is the operational question. It does not answer "how long
until *my* dosa is ready", which is a backlog question. Reporting one as the
other is the usual way these models get misused.

Under three service samples it falls back to a six-minute default and says it is
cold-starting. Utilisation is clamped at 0.98, because at ρ ≥ 1 the model's wait
is infinite and infinity is not a useful thing to show a hungry student.

### Demand forecast — seasonal EWMA (`src/demandForecast.js`)

Orders are bucketed by (weekday/weekend × hour-of-day), each bucket smoothed
with EWMA at α = 0.35, then adjusted by a linear trend over a 14-day window,
clamped to ×0.5–×2.0 so one abnormal week cannot run away with the forecast.

Full Holt-Winters was the obvious alternative and was rejected: it wants more
history per season than a college canteen has in its first term, and it becomes
unstable exactly where this data is thinnest. Buckets with no history at all
fall back to a generic meal-time curve — lunch peak at noon, dinner peak at
seven — clearly labelled as a cold-start shape rather than a prediction.

### Kitchen analytics — walk-forward validated (`src/kitchenAnalytics.js`)

The part worth arguing for. Two predictors compete for every bucket: a running
mean of that bucket's earlier observations, and the EWMA above. Both are fed
**only data observed before the point being predicted** — strictly time-ordered,
no shuffling, no future leakage — and MAE is accumulated across every
walk-forward step. The lower-MAE predictor wins, and **if smoothing does not
beat the plain baseline, the baseline is used and the dashboard says so.**

Crowd levels are percentiles of that hour's own historical distribution
(P50/P75/P90 → low/moderate/high/very high), not arbitrary bands. The current
hour is still in progress, so those thresholds are scaled by the fraction of the
hour elapsed — the question is "are we on track to be crowded?", not a
misleading raw partial count.

Under three distinct days of history, forecasts and peak claims are suppressed
entirely and the panel says *insufficient historical data*. The current
in-progress day never enters the historical averages.

### Recommendations (`src/recommender/`)

Four signals blended in priority order, each carrying a human-readable reason
and a 0–100 confidence into the UI:

| | Signal | Source |
|---|---|---|
| P1 | Affinity — recency-weighted frequency, 7-day half-life | Your own order history |
| P2 | Similarity — dishes like your favourites | `foodMetadata.js` profiles |
| P3 | Co-occurrence — bought together, scored by lift | `order_signals` across users |
| P4 | Meal time — right food for the current session | Clock + dish meal type |

Similarity runs over an explicit food profile — cuisine, meal type, dish family,
veg/non-veg, spice, ingredient keywords — inferred from the item name against a
curated knowledge base of canteen dishes. A weighted sum over shared dimensions,
not an embedding, so the engine can say *why* ("both South Indian breakfast
staples") instead of asserting a similarity score nobody can check.

Co-occurrence learns from `order_signals`, a non-PII mirror of each order
carrying item ids and status only — no names, prices or owner. Cross-user
purchase patterns are learnable in the browser without any student's history
leaving their own session.

### The LSTM, and why it is not in the blend

`src/lstm.js` is a real LSTM forward pass written from scratch — gates, cell
state, embeddings, a stable softmax, a seeded PRNG so the weights are identical
on every machine. `src/research/train_lstm.py` trains it offline in PyTorch on
next-item prediction and exports to exactly the schema the JS module loads.

The weights shipped in the repo are Xavier initialisations. They are the
*starting point* of an LSTM, not a trained model — so **the LSTM contributes
nothing to the recommendations until real trained weights are loaded**, and the
pipeline is written to leave it out rather than fold in noise dressed up as a
sequence model. Train it on real order data, call `loadTrainedWeights()`, and it
joins the blend.

Shipping random weights and calling it deep learning would have demoed
identically. It would also have been a lie, and the first person to ask what the
model learned would have found out.

---

## Voice ordering

"Add two masala dosas", "show me vegetarian", "open cart", "checkout".

The chain is Web Speech API → transcript normalisation → rule-based NLU →
fuzzy entity resolution → the app's command engine. **Voice and taps reduce to
the same typed `AppCommand` and go through the same `commandEngine`**, so the
two input modes cannot drift apart in behaviour — they are identical by
construction, not by testing.

Entity resolution is Levenshtein-scored against the live catalogue, scoped to
the active stall, and returns disambiguation candidates rather than guessing
when two dishes score closely.

The interesting engineering is in `voiceRecognitionManager.js`. Chrome's speech
service throws a `network` error if you start a session before the previous one
has ended, and fails outright while the microphone permission prompt is still
open — which is what makes naive Web Speech integrations feel broken. The
manager is a strict state machine (idle → starting → listening → stopping),
single-flight, builds a fresh recognizer per session so a poisoned instance is
always discarded, restarts only from `onend` and never from `onerror`, backs off
exponentially, guards every async callback with a session id so a stopped
session can never be resurrected by a stale retry, and — if a session dies while
the permission prompt is pending — waits and auto-resumes the instant the user
clicks Allow. No second tap.

It holds no React state and does no I/O of its own, so all of that is testable
with mocks. It is.

---

## The food assistant

Ask for food in plain language — "something high protein under 100 rupees",
"what's popular today", "compare the biryani and the fried rice" — and it
answers from the real menu, then offers to put it in your cart.

It is **not an autonomous agent**, and the architecture enforces that rather
than asking it nicely:

1. **Deterministic NLU first.** `intentParser.js` extracts intent and
   constraints — budget, macros, veg, spice, stall, meal time — with no model in
   the loop. It handles the misspellings people actually type (*protien*,
   *vegitarian*, *chep*).
2. **A fixed set of tools.** Every intent maps to one of the functions in
   `foodTools.js`. There are no arbitrary queries; the assistant cannot reach
   data no tool exposes.
3. **Real data only.** Live products, shop status, order signals, and — for a
   signed-in user — their own orders. Personalisation never crosses accounts.
4. **Writes are proposals.** Adding to the cart comes back as a
   `ProposedAction` that the *client* applies through the same command engine
   the buttons and voice use. The assistant never mutates anything itself.

An optional Gemini interpreter (`llmInterpreter.js`) sits in front of the parser
and runs **server-side only**, so the API key is never in the browser bundle.
Its contract is `(text) => AssistantTurn | null`: missing key, network error,
timeout, malformed JSON, or an intent that maps to no tool all return `null` and
fall through to the deterministic parser. The model can change what the app
*understands*. It cannot change what the app *can do*.

Nutrition figures are estimates from a dish-family knowledge base, rounded to
whole numbers and always labelled estimated. The moment a product document
carries real measured `nutrition`, those values win and the estimate flag turns
off. No false precision on food.

---

## The research layer

This is a final-year project, so the app instruments itself for the study it
belongs to.

Each browser is bucketed once into `GroupA`/`GroupB` and the assignment is
persisted to the user's document, so the split survives across sessions and
devices. `sessionTrace.js` folds every dispatched command — manual or voice —
into per-session metrics, and its headline signal is the **fallback
classifier**: when a voice command fails, the very next command reveals the
recovery path. Another voice command is a retry; a manual one is a
voice→manual fallback, which is the friction outcome the study is actually
about. That classifier is pure and unit-tested, so it behaves identically at
every call site.

A three-item SUS instrument runs after an order, scored on the standard
alternating-polarity scale and normalised to 0–100.

---

## Data model

| Collection | Holds |
|---|---|
| `users/{uid}` | Role, assigned stall, profile — the source of truth for access |
| `orders/{id}` | Full order documents — owner and stall staff only |
| `order_signals/{id}` | Non-PII mirror (stall, status, item ids, timestamps) — feeds the queue and demand models |
| `subscriptions/{id}` | Meal-pass purchases |
| `products/{id}` | Menu items, per stall |
| `shop_status/{stall}` | Open/closed, busy, paused, prep capacity |
| `stall_sessions/{stall}` | The single-occupancy lock |
| `stall_email_registry/{stall}` | Admin-managed email → stall mapping |
| `logout_requests/{uid}` | Staff sign-out approval queue |

The phase timestamps on an order — `created_at`, `preparing_started_at`,
`ready_at` — are load-bearing. Both statistical models read them. Dropping one
from an order write does not break a screen; it quietly degrades the wait-time
estimate, which is worse.

---

## Payments

```
Student → create-order → Razorpay order id
       → Razorpay checkout (card details never touch this app)
       → verify-payment  → HMAC over (order_id|payment_id), constant-time compare
       → Firestore write via Admin SDK: payment_status = paid
       ↑
       └── webhook — the same write, independently, in case the browser closed
```

Both paths converge on the same invariant: **a signature is verified server-side
with `crypto.timingSafeEqual` before any Firestore write.** A plain `===` on a
signature comparison leaks timing information; `timingSafeEqual` does not.

The webhook is defence in depth, not the primary path. A student who pays and
immediately closes the tab never fires `verify-payment` — the webhook is what
makes their order exist anyway. `type` on the order decides whether the write
lands in `orders` (with `paid_at`) or `subscriptions` (with `status: active`).

The Firestore rules block a client from ever setting `payment_status` to
`"paid"` itself. Only the Admin SDK can.

---

## Setup

### Firebase

1. Create a project, enable **Authentication → Google**.
2. Create **Firestore** in production mode.
3. Deploy the rules — they are the security boundary, and they do nothing
   sitting in the repo:
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **Project settings → Service accounts → Generate new private key.** Paste the
   JSON on one line as `FIREBASE_SERVICE_ACCOUNT` in your Vercel project.

The `NEXT_PUBLIC`-style web config in `src/firebase.js` is public by design —
Firebase's security comes from the rules and the authorised-domain list, not
from hiding an API key.

### Razorpay

Test mode is free and needs no KYC.

1. **Settings → API Keys → Generate Test Key.** The secret is shown once.
2. Server side, in Vercel: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. Browser side, in `.env.local`: `VITE_RAZORPAY_KEY_ID` — the same key *id*,
   never the secret.
4. **Settings → Webhooks** → add `<your-backend>/webhook`, subscribe to
   `payment.captured`, and copy the signing secret to `RAZORPAY_WEBHOOK_SECRET`.

Test card `4111 1111 1111 1111`, any future expiry, any CVV.

### Deploy

```bash
npm run build
firebase deploy --only hosting     # frontend → Firebase Hosting
npx vercel --prod                  # api/ + canteen-backend/ → Vercel
```

`vercel.json` routes the bare paths (`/create-order`, `/staff-login`,
`/admin-set-role`, …) to the Express app and `/api/food-assistant` to its own
function.

### Native

```bash
npm run build && npx cap sync
npx cap open ios       # or: npx cap open android
```

Capacitor wraps the built `dist/` as `com.christ.canteen`. The shells are
scaffolded and configured; neither store build has been submitted.

---

## Honest notes

- **The LSTM ships untrained** — Xavier-initialised weights, so it is
  deliberately excluded from the recommendation blend. Run
  `src/research/train_lstm.py` on real order history and load the export to
  turn it on. Covered above, repeated here because it is the single thing most
  worth being clear about.
- **Nutrition values are estimates**, derived from dish family and ingredient
  keywords, and labelled as such everywhere they appear. Real measured values
  on a product document override them.
- **Three payment backends exist** — `api/` (the deployed one), plus
  `canteen-backend/` and `razorpay-backend/` as an Express monolith and an
  earlier standalone variant of the same routes. They are kept because the
  deployment history is part of the project record, but only one is live. Check
  `vercel.json` before editing.
- **Product photos are base64 data URIs on the product document**, compressed
  to ~480px client-side, not files in Cloud Storage. Provisioning a Storage
  bucket requires Firebase's Blaze billing plan; Firestore's 1MB document limit
  is a real constraint, and the compression keeps typical photos well under it.
  An ugly trade, made knowingly, and documented at the code.
- **`/admin-set-role` and `/admin-approve-logout` still trust a client-supplied
  uid.** The same class of hole was found and closed on `/claim-admin-seat` by
  verifying a real Firebase ID token; this is that fix, not yet applied to these
  two routes. It is in the repo because the test report found it and pretending
  otherwise would defeat the point of having one.
- **Payment amounts are not cross-checked against the menu server-side.** The
  client supplies both the Firestore price and the Razorpay amount. The
  signature verification is sound; the amount is not independently validated.
- **Live listeners are unbounded.** Fine at a six-stall campus, a real cost
  problem at ten times the traffic. Pagination on order history is the fix.
- **Firestore is the only test seam.** The 240 tests cover the pure logic —
  models, recommender, NLU, command engine, assistant, voice manager. Anything
  touching Firebase or React components is untested, and would need the Firebase
  emulator to test honestly rather than a wall of mocks.
- **`KitchenDashboard.jsx` and the emailed-OTP staff routes are dead code**,
  superseded by the Google-sign-in staff flow.
- **`VITE_` variables are compiled into the bundle and are public.** That is why
  the Razorpay *key id* lives there and the *secret* never does.

`TEST_REPORT.md` is the six-category pass — unit, integration, E2E, security,
load, UAT — that found the last three items. `PROJECT_SUMMARY.md` is the
build log.

---

## Commands

```bash
npm run dev       # Vite dev server
npm test          # vitest — 240 tests, 15 files
npm run build     # production build to dist/
npm run lint      # eslint
```

---

## The team

A three-person final-year project. Each of us owned an area end to end.

| | Area |
|---|---|
| **Frontend & user experience** | The React application students use — components, routing, state, cart, checkout UI, order history and tracking, responsive layout, Firebase integration from the client |
| **Backend, database & payments** | The Node serverless functions, Firestore integration and the Razorpay flow — order creation, signature verification, webhook handling, payment status writes |
| **Admin, kitchen & smart features** — *[Niranjan S](https://github.com/niranjan6030)* | The operational and intelligent layer: the admin panel, the kitchen command centre and terminal, order lifecycle and stall management, the queueing and demand models, kitchen analytics, the recommender, voice ordering and the food assistant |
