# Architecture

Developer notes for working in this repository — the things that are not
obvious from reading one file, and the invariants that are easy to break by
accident. For what the project *is*, see [README.md](README.md).

## Commands

```bash
npm run dev       # Vite dev server
npm test          # Vitest — 240 tests across 15 files
npm run build     # production build to dist/
npm run lint      # ESLint (flat config, eslint.config.js)
npm run preview   # preview a production build
```

Tests cover the pure-logic modules only — the statistical models, the
recommender, the voice NLU and command engine, the assistant. Anything touching
Firebase or React components is untested; doing it honestly needs the Firebase
emulator rather than a wall of mocks.

The codebase is entirely JavaScript — plain `.js` and `.jsx`, no build step
beyond Vite.

Firebase Hosting deploy is driven by `firebase.json` (`public: dist`, SPA
rewrite to `index.html`) against project `canteen-christ` (`.firebaserc`).
Firestore rules live in `firestore.rules` and deploy via
`firebase deploy --only firestore:rules` — they do nothing sitting in the repo.

## Shape of the system

A single-page React 19 app (Vite, `HashRouter`) plus a set of Node payment and
provisioning functions. There is **no unified backend for app data** — Firestore
is the database and the React client talks to it directly through the client
SDK. Server-side code exists only where a secret is required: Razorpay
signature verification and role provisioning, both trust boundaries a browser
cannot be allowed to cross.

### Role-based routing (`src/App.jsx`)

A single `onAuthStateChanged` listener is the source of truth for auth and role
state. On sign-in it reads or creates `users/{uid}`, resolves `role`
(`student` | `staff`) and `assignedStall`, and caches both to `localStorage` for
fast reads elsewhere. Route guards (`StaffRoute`, `StudentRoute`) branch on it:

| Route | Component |
|---|---|
| `/login` | `MainContainer` — Google sign-in gateway |
| `/` | `UserMenu` — student ordering and discovery home |
| `/live` | `KitchenLiveBoard` — staff Kanban board, menu manager, financials |
| `/dashboard` | `KitchenDashboard` — legacy, superseded by My Orders |

An A/B bucket (`ab_testing_group`, `GroupA`/`GroupB`) is assigned once per
browser and persisted to the user document; `GroupA` forces unauthenticated
visitors through `/login` first.

**Canonical stall names are defined redundantly** — `MainContainer.jsx`'s
`CANTEEN_STALLS`, `helpers.js`' `SHOPS`, and `firestore.rules`' `validStall()`.
They must match the Firestore `stallName`/`assignedStall` values exactly. Keep
all three in sync when adding or renaming a stall. Note that `SHOP_DISPLAY` maps
only what the UI *renders* (Bakery → Cake Boutique); the canonical value stays
load-bearing for queries and rules.

### Firestore as the integration point

Client SDK init is `src/firebase.js` (`db`, `auth`, `storage`, `googleProvider`,
`signInWithGoogle`, `signOutUser`).

`firestore.rules` is the real security boundary, not the client code. Staff
writes are gated by a `myRole()` helper reading `users/{uid}.role` per rule
evaluation, and **`payment_status` can only ever be set to `"paid"` by the Admin
SDK** — never by an authenticated client.

The phase timestamps on an order — `created_at`, `preparing_started_at`,
`ready_at` — are load-bearing. Both statistical models read them. Dropping one
from an order write breaks no screen; it quietly degrades the wait-time
estimate, which is harder to notice and worse.

### Payment flow — three implementations, one deployed

Three independent implementations of the same routes exist. **Know which one is
live before editing** — `vercel.json` is the answer:

- `api/` — Vercel serverless functions, ESM, one file per route.
  `api/_firebaseAdmin.js` holds the shared `markDocumentPaid()` used by both
  `verify_payment.js` and `webhook.js`.
- `canteen-backend/` — the Express monolith the bare paths route to.
- `razorpay-backend/` — an earlier standalone variant, kept for the record.

All converge on the same invariant: Razorpay HMAC signatures are verified
server-side with `crypto.timingSafeEqual` before any Firestore write. The
webhook is defence in depth for the browser-closed-mid-checkout case, not the
primary path. `type` (`meal_pass`/`subscription` vs. default `order`) decides
whether the write targets `subscriptions` (`status: 'active'`) or `orders`
(`status: 'pending'` + `paid_at`).

### The models (`src/queueingModel.js`, `src/demandForecast.js`, `src/kitchenAnalytics.js`)

Dependency-free statistics, deliberately not ML services.

- `computeQueueMetrics()` — M/M/c per stall. A backlog-based `estimatedWaitMin`
  for the student-facing number, and separate Erlang-C steady-state
  diagnostics (`erlangCExpectedWaitMin`, `utilization`) for staff. **These
  answer different questions — do not substitute one for the other.**
- `computeDemandForecast()` — seasonal EWMA over (day-type × hour-of-day)
  buckets, α = 0.35, with a trend adjustment clamped to ×0.5–×2.0, falling back
  to a generic `MEAL_CURVE` for cold-start buckets.
- `kitchenAnalytics.js` — walk-forward validation picking between the EWMA and a
  plain running-mean baseline by MAE, and reporting which one won.

When touching any of them, hand-verify the math against synthetic data before
wiring changes into the UI.

### Voice and the command engine

`src/core/commands/commandEngine.js` is the single pipeline. Voice
(`src/voice/`) and manual UI taps both reduce to the same typed `AppCommand`, so
the two modalities are identical by construction. **Do not add a UI action that
bypasses the command engine** — that is what keeps them from drifting.

### The assistant (`src/assistant/`)

Deterministic NLU (`intentParser.js`) over a fixed tool set (`foodTools.js`).
Cart writes come back as `ProposedAction`s the client applies through the
command engine; the assistant never mutates data itself. The optional Gemini
interpreter runs server-side only and returns `null` on every failure path, so
the deterministic parser is always the floor.

### Native shell

`capacitor.config.json` plus `android/` and `ios/` wrap the built `dist/` as
`com.christ.canteen`.
