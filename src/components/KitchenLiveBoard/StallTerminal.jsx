import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../firebase";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { computeQueueMetrics } from "../../queueingModel";
import { computeKitchenAnalytics } from "../../kitchenAnalytics";
import { STALLS, getTheme, orderCreatedMs, playOrderAlertTone } from "./helpers";
import { SunIcon, MoonIcon } from "./icons";
import KitchenCommandCenter from "./KitchenCommandCenter";
import StallMenuManager from "./StallMenuManager";
import FinancialDashboard from "./FinancialDashboard";
import KitchenAnalytics from "./KitchenAnalytics";

// ─── Stall terminal — the full board/menu/financials experience for one stall.
// Parameterized by `stallName` instead of reading `assignedStall` from localStorage directly, so
// each of the six per-stall wrapper files (see ./stalls/) can render this with their own fixed
// stall name. All internal logic is otherwise identical to the original single-file
// KitchenLiveBoard component.
export default function StallTerminal({ stallName }) {
  const assignedStall = stallName;
  const [orders, setOrders] = useState([]);
  const [stallOrderHistory, setStallOrderHistory] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [now, setNow] = useState(new Date());
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [prepCapacity, setPrepCapacity] = useState(2);
  const [isSavingCapacity, setIsSavingCapacity] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const [activeView, setActiveView] = useState("board"); // 'board' | 'menu' | 'financials'
  // Reuses the same localStorage key UserMenu.jsx/Navbar.jsx already use for dark mode, so the
  // preference is consistent across the app rather than inventing a second, unrelated toggle.
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("kitchenDarkMode") !== "false");
  // ─── Request Logout: the only way out of an occupied stall now that self-service logout is
  // gone. Filing a request just writes logout_requests/{uid}; the Admin Panel is what actually
  // approves (releasing the stall_sessions lock) or denies it — this component only watches its
  // own request doc and reacts once an admin has resolved it.
  const [logoutRequestStatus, setLogoutRequestStatus] = useState("none"); // 'none' | 'pending' | 'denied'
  const [isRequestingLogout, setIsRequestingLogout] = useState(false);

  const t = getTheme(darkMode);

  const setTheme = (nextDark) => {
    setDarkMode(nextDark);
    localStorage.setItem("kitchenDarkMode", String(nextDark));
  };

  const isStallValid = Boolean(assignedStall) && STALLS.includes(assignedStall);

  // Shouldn't happen — the router only ever mounts this with one of the 6 fixed stall names —
  // but if it ever does, silently clear and bounce back to the gateway instead of a dead-end
  // error page.
  useEffect(() => {
    if (isStallValid) return undefined;
    let cancelled = false;
    (async () => {
      localStorage.removeItem("assignedStall");
      localStorage.removeItem("assignedShop");
      localStorage.removeItem("userRole");
      sessionStorage.removeItem("staff_onboarding_pending");
      await signOut(auth).catch(() => {});
      if (!cancelled) {
        window.location.hash = "/";
        window.location.reload();
      }
    })();
    return () => { cancelled = true; };
  }, [isStallValid]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Watches this staff member's own logout request. An "approved" status means an admin already
  // released the stall_sessions lock server-side (api/admin-approve-logout.js) — this just signs
  // the local session out to match. A "denied" status surfaces a message instead of signing out.
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return undefined;
    const requestRef = doc(db, "logout_requests", currentUser.uid);
    const unsubscribe = onSnapshot(
      requestRef,
      async (snapshot) => {
        if (!snapshot.exists()) {
          setLogoutRequestStatus("none");
          return;
        }
        const data = snapshot.data();
        if (data.status === "approved") {
          await deleteDoc(requestRef).catch(() => {});
          localStorage.removeItem("assignedStall");
          localStorage.removeItem("assignedShop");
          localStorage.removeItem("userRole");
          sessionStorage.removeItem("staff_onboarding_pending");
          await signOut(auth).catch(() => {});
          window.location.hash = "/";
          window.location.reload();
        } else if (data.status === "denied") {
          setLogoutRequestStatus("denied");
        } else {
          setLogoutRequestStatus("pending");
        }
      },
      (error) => console.error("[KitchenLiveBoard] Logout request listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  // The stall_sessions lock is the source of truth for "am I still this terminal's operator".
  // An admin releasing it — Force Release, or removing the stall's registered email — deletes
  // this doc, and a different account claiming the stall overwrites its uid. In either case sign
  // out immediately, so a de-provisioned terminal can't be left sitting open on the counter.
  // Cache-only snapshots are ignored: on a cold start Firestore delivers a local "does not
  // exist" before the server responds, which would otherwise sign a legitimate operator straight
  // back out.
  useEffect(() => {
    if (!isStallValid) return undefined;
    const currentUser = auth.currentUser;
    if (!currentUser) return undefined;

    const unsubscribe = onSnapshot(
      doc(db, "stall_sessions", assignedStall),
      async (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        if (snapshot.exists() && snapshot.data()?.uid === currentUser.uid) return;

        localStorage.removeItem("assignedStall");
        localStorage.removeItem("assignedShop");
        localStorage.removeItem("userRole");
        sessionStorage.removeItem("staff_onboarding_pending");
        await signOut(auth).catch(() => {});
        window.location.hash = "/";
        window.location.reload();
      },
      (error) => console.error("[KitchenLiveBoard] Stall session listener failed:", error)
    );
    return () => unsubscribe();
  }, [assignedStall, isStallValid]);

  const handleRequestLogout = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setIsRequestingLogout(true);
    try {
      await setDoc(doc(db, "logout_requests", currentUser.uid), {
        uid: currentUser.uid,
        stall: assignedStall,
        email: currentUser.email || "",
        displayName: currentUser.displayName || "",
        requestedAt: serverTimestamp(),
        status: "pending",
      });
    } catch (error) {
      console.error("[KitchenLiveBoard] Failed to file logout request:", error);
      alert("Could not send the logout request. Please try again.");
    } finally {
      setIsRequestingLogout(false);
    }
  };

  const handleDismissDenial = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    await deleteDoc(doc(db, "logout_requests", currentUser.uid)).catch(() => {});
    setLogoutRequestStatus("none");
  };

  // Order documents have drifted across three different "which stall" field names over the
  // app's history (stallName / shop_name / shop). Rather than pulling the ENTIRE orders
  // collection client-side to filter in memory — which meant every terminal re-downloaded every
  // OTHER stall's full order history on every single write, anywhere in the app — run one scoped
  // equality query per field name and merge the results. Single-field `==` queries need no
  // composite index, so this keeps the original "avoid index requirements" property while
  // actually scoping the listener's bandwidth to this stall's own documents.
  //
  // PAYMENT GATE: every listener ALSO filters payment_status == 'paid'. This is not just UI
  // hygiene — firestore.rules restrict staff reads to PAID orders, so a query without that
  // filter is rejected server-side. An order reaches this board only after Razorpay signature
  // verification succeeded and the Admin SDK marked it paid. (The stall+payment_status compound
  // indexes are declared in firestore.indexes.json.)
  useEffect(() => {
    if (!isStallValid) {
      setIsLoadingOrders(false);
      return;
    }
    setIsLoadingOrders(true);

    const fields = ["stallName", "shop_name", "shop"];
    const buckets = { stallName: new Map(), shop_name: new Map(), shop: new Map() };
    const loadedFields = new Set();

    const recompute = () => {
      const merged = new Map();
      Object.values(buckets).forEach((bucket) => bucket.forEach((order, id) => merged.set(id, order)));
      // Defense-in-depth for any legacy doc that slipped in before the rules change.
      const stallOrders = Array.from(merged.values()).filter((order) => order.payment_status === "paid");

      const processedOrders = stallOrders
        .filter((order) => ["pending", "preparing", "ready"].includes(order.status))
        .sort((a, b) => orderCreatedMs(a) - orderCreatedMs(b)); // Oldest incoming items float to top

      setOrders(processedOrders);
      // Full stall history (incl. completed) feeds the queueing/demand/financial modules —
      // all paid-only by construction now.
      setStallOrderHistory(stallOrders);
      setOrdersError("");
      if (loadedFields.size === fields.length) setIsLoadingOrders(false);
    };

    const unsubscribes = fields.map((field) =>
      onSnapshot(
        query(
          collection(db, "orders"),
          where(field, "==", assignedStall),
          where("payment_status", "==", "paid")
        ),
        (snapshot) => {
          buckets[field] = new Map(snapshot.docs.map((docSnap) => [docSnap.id, { id: docSnap.id, ...docSnap.data() }]));
          loadedFields.add(field);
          recompute();
        },
        (error) => {
          console.error(`[KitchenLiveBoard] Orders stream synchronization failure (${field}):`, error);
          setOrdersError("Could not balance live data connection with database architecture.");
          loadedFields.add(field);
          setIsLoadingOrders(false);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [assignedStall, isStallValid]);

  // Staff-tunable concurrency (c) + rush-hour pause flag — both live on the shop_status doc
  // that UserMenu.jsx already reads for open/busy/broadcast state. Reusing `is_busy` for
  // "Pause Incoming Orders" means the existing student-side checkout gate already enforces it —
  // no changes needed there.
  useEffect(() => {
    if (!isStallValid) return;
    const unsubscribe = onSnapshot(
      doc(db, "shop_status", assignedStall),
      (snapshot) => {
        const data = snapshot.data();
        const capacity = data?.prepCapacity;
        setPrepCapacity(Number.isFinite(capacity) && capacity > 0 ? capacity : 2);
        setIsPaused(Boolean(data?.is_busy));
      },
      (error) => console.error("[KitchenLiveBoard] Shop status listener failed:", error)
    );
    return () => unsubscribe();
  }, [assignedStall, isStallValid]);

  const handlePrepCapacityChange = async (nextCapacity) => {
    setPrepCapacity(nextCapacity);
    setIsSavingCapacity(true);
    try {
      await setDoc(
        doc(db, "shop_status", assignedStall),
        { prepCapacity: nextCapacity, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      console.error("[KitchenLiveBoard] Failed to save prep capacity:", error);
    } finally {
      setIsSavingCapacity(false);
    }
  };

  const togglePauseIncoming = async () => {
    const nextPaused = !isPaused;
    setIsTogglingPause(true);
    try {
      await setDoc(
        doc(db, "shop_status", assignedStall),
        {
          is_busy: nextPaused,
          message: nextPaused ? "Kitchen is at capacity — new orders are temporarily paused." : "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("[KitchenLiveBoard] Failed to toggle pause state:", error);
      alert("Could not update the pause state. Please try again.");
    } finally {
      setIsTogglingPause(false);
    }
  };

  const queueMetrics = useMemo(
    () =>
      computeQueueMetrics({
        queueDepth: orders.length,
        recentOrders: stallOrderHistory,
        concurrency: prepCapacity,
      }),
    [orders.length, stallOrderHistory, prepCapacity]
  );

  // ML-powered kitchen analytics (peaks / workload / forecast / today / next-30-min / prep
  // suggestions) — all derived from real order history (see src/kitchenAnalytics.js).
  // Recomputed at minute granularity (not every second, like the clock) to keep the analytics
  // pass cheap while still tracking live orders.
  const analyticsMinute = Math.floor(now.getTime() / 60000);
  const kitchenAnalytics = useMemo(
    () => computeKitchenAnalytics({ orders: stallOrderHistory, now: new Date(analyticsMinute * 60000) }),
    [stallOrderHistory, analyticsMinute]
  );

  const pendingOrders = useMemo(() => orders.filter((o) => o.status === "pending"), [orders]);
  const preparingOrders = useMemo(
    () => orders.filter((o) => o.status === "preparing").sort((a, b) => orderCreatedMs(a) - orderCreatedMs(b)),
    [orders]
  );
  const readyOrders = useMemo(() => orders.filter((o) => o.status === "ready"), [orders]);

  // ─── MODULE 4: audible ping whenever a genuinely NEW order lands in Pending ──
  const hasLoadedOrdersRef = useRef(false);
  const previousPendingIdsRef = useRef(new Set());
  useEffect(() => {
    const currentIds = new Set(pendingOrders.map((o) => o.id));
    if (hasLoadedOrdersRef.current) {
      const hasNewArrival = pendingOrders.some((o) => !previousPendingIdsRef.current.has(o.id));
      if (hasNewArrival) playOrderAlertTone();
    }
    hasLoadedOrdersRef.current = true;
    previousPendingIdsRef.current = currentIds;
  }, [pendingOrders]);

  const advanceOrder = async (orderId, nextStatus) => {
    setUpdatingOrderId(orderId);
    try {
      const phaseTimestampField =
        nextStatus === "preparing"
          ? "preparing_started_at"
          : nextStatus === "ready"
          ? "ready_at"
          : nextStatus === "completed"
          ? "completed_at"
          : null;

      await updateDoc(doc(db, "orders", orderId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
        ...(phaseTimestampField ? { [phaseTimestampField]: serverTimestamp() } : {}),
      });

      // Mirror into the non-PII companion collection students' aggregate reads rely on.
      await setDoc(
        doc(db, "order_signals", orderId),
        {
          status: nextStatus,
          ...(phaseTimestampField ? { [phaseTimestampField]: serverTimestamp() } : {}),
        },
        { merge: true }
      ).catch((error) => console.error(`[KitchenLiveBoard] Failed to mirror order signal ${orderId}:`, error));
    } catch (error) {
      console.error(`[KitchenLiveBoard] Failed to update order ${orderId}:`, error);
      alert("Could not update the order. Please try again.");
    } finally {
      setUpdatingOrderId("");
    }
  };

  const clearCompletedBoard = async () => {
    if (!readyOrders.length) return;
    if (!window.confirm(`Archive all ${readyOrders.length} order(s) in Ready for Pickup as collected?`)) return;
    await Promise.all(readyOrders.map((order) => advanceOrder(order.id, "completed")));
  };

  if (!isStallValid) {
    return null;
  }

  return (
    <div className={`min-h-screen font-kds antialiased ${t.page}`}>
      <header className={`sticky top-0 z-[100] border-b ${t.headerBorder} ${t.headerBg}`}>
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className={`text-[10px] uppercase tracking-[0.4em] ${t.label}`}>
              Kitchen Terminal — Isolated Session
            </p>
            <h1 className={`mt-1 text-2xl font-bold uppercase tracking-wide ${t.heading}`}>
              {assignedStall} <span className={t.accent}>Live Monitor Terminal</span>
            </h1>
            <p className={`mt-1 text-[11px] uppercase tracking-widest ${t.label}`}>
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className={`flex gap-4 border px-5 py-3 ${t.headerBorder}`}>
              <div className="text-center">
                <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Pending</p>
                <p className={`text-lg font-bold ${t.heading}`}>{pendingOrders.length}</p>
              </div>
              <div className={`w-px ${t.dark ? "bg-[#37c8be]/15" : "bg-orange-200"}`} />
              <div className="text-center">
                <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Preparing</p>
                <p className={`text-lg font-bold ${t.heading}`}>{preparingOrders.length}</p>
              </div>
              <div className={`w-px ${t.dark ? "bg-[#37c8be]/15" : "bg-orange-200"}`} />
              <div className="text-center">
                <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Ready</p>
                <p className={`text-lg font-bold ${t.heading}`}>{readyOrders.length}</p>
              </div>
              <div className={`w-px ${t.dark ? "bg-[#37c8be]/15" : "bg-orange-200"}`} />
              <div className="text-center">
                <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Workload</p>
                <span
                  className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                    kitchenAnalytics.workload.current.level === "VERY_HIGH"
                      ? "border-red-500/40 bg-red-500/10 text-red-500"
                      : kitchenAnalytics.workload.current.level === "HIGH"
                      ? "border-orange-500/40 bg-orange-500/10 text-orange-500"
                      : kitchenAnalytics.workload.current.level === "MODERATE"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                  }`}
                >
                  {kitchenAnalytics.workload.current.levelLabel}
                </span>
              </div>
            </div>
            {/* Segmented control instead of a single toggle button — both states are always
                visible with the active one highlighted, so there's no ambiguity about whether
                the label/icon describes the CURRENT mode or the mode you'd switch TO. */}
            <div className={`flex border ${t.headerBorder}`} role="group" aria-label="Theme">
              <button
                onClick={() => setTheme(false)}
                aria-pressed={!darkMode}
                className={`flex items-center gap-2 px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ease-out ${t.focusRing} ${
                  !darkMode ? `${t.accentBg} ${t.accentText}` : `${t.label} ${t.labelHover}`
                }`}
              >
                <SunIcon /> Light
              </button>
              <button
                onClick={() => setTheme(true)}
                aria-pressed={darkMode}
                className={`flex items-center gap-2 border-l px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ease-out ${t.headerBorder} ${t.focusRing} ${
                  darkMode ? `${t.accentBg} ${t.accentText}` : `${t.label} ${t.labelHover}`
                }`}
              >
                <MoonIcon /> Dark
              </button>
            </div>
            {/* No self-service "leave this stall" control by design — a request goes to the
                Admin Panel instead, which is the only thing that can actually release it. */}
            <button
              onClick={handleRequestLogout}
              disabled={isRequestingLogout || logoutRequestStatus === "pending"}
              className="border border-red-400/30 px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ease-out hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {logoutRequestStatus === "pending"
                ? "Awaiting Admin Approval..."
                : isRequestingLogout
                ? "Sending Request..."
                : "Request Logout"}
            </button>
          </div>
        </div>

        {logoutRequestStatus === "denied" && (
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 border-t border-red-400/30 bg-red-500/5 px-6 py-3 text-xs text-red-500">
            <span>Your logout request was denied by the admin. You remain signed in to this stall.</span>
            <button onClick={handleDismissDenial} className="shrink-0 font-bold uppercase tracking-widest underline">
              Dismiss
            </button>
          </div>
        )}

        {/* ─── MODULE 4: Master rush-hour controls + view tabs ─────────────── */}
        <div className={`mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 border-t px-6 py-3 ${t.divider}`}>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "board", label: "Fulfillment Board" },
              { key: "menu", label: "Stall Menu Manager" },
              { key: "financials", label: "Financial Dashboard" },
              { key: "analytics", label: "Kitchen Analytics" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveView(tab.key)}
                className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ease-out ${t.focusRing} ${
                  activeView === tab.key
                    ? `${t.accentBorder} ${t.dark ? "bg-[#37c8be]/10" : "bg-orange-50"} ${t.accent}`
                    : `${t.headerBorder} ${t.label} ${t.labelHover}`
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={togglePauseIncoming}
              disabled={isTogglingPause}
              className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition disabled:opacity-50 ${
                isPaused
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
                  : `${t.headerBorder} ${t.body} hover:bg-current/10`
              }`}
            >
              {isPaused ? "Resume Incoming Orders" : "Pause Incoming Orders"}
            </button>
            <button
              onClick={clearCompletedBoard}
              disabled={!readyOrders.length}
              className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition disabled:opacity-30 ${t.headerBorder} ${t.body} hover:bg-current/10`}
            >
              Clear Completed Board
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {isPaused && (
          <div className="mb-6 border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-500">
            Incoming orders are currently paused — students cannot check out until you resume.
          </div>
        )}

        {ordersError && (
          <div className="mb-6 border border-red-400/30 bg-red-500/5 p-4 text-xs text-red-500">
            {ordersError}
          </div>
        )}

        {activeView === "board" && (
          <>
            {/* ─── Kitchen Command Center: NOW → NEXT → INSIGHT ─────────────────
                The operational board. Analytics live on the Kitchen Analytics tab; this
                screen only shows decisions (what to make, what's urgent, what's ready). */}
            {isLoadingOrders ? (
              <div className={`py-24 text-center text-[10px] uppercase tracking-[0.35em] ${t.label}`}>
                Connecting to {assignedStall} order stream...
              </div>
            ) : (
              <KitchenCommandCenter
                t={t}
                now={now}
                orders={orders}
                onAdvance={advanceOrder}
                updatingOrderId={updatingOrderId}
                queueMetrics={queueMetrics}
                analytics={kitchenAnalytics}
                prepCapacity={prepCapacity}
                onPrepCapacityChange={handlePrepCapacityChange}
                isSavingCapacity={isSavingCapacity}
                isPaused={isPaused}
              />
            )}
          </>
        )}

        {activeView === "menu" && <StallMenuManager t={t} assignedStall={assignedStall} />}

        {activeView === "financials" && <FinancialDashboard t={t} stallOrderHistory={stallOrderHistory} />}

        {activeView === "analytics" && (
          <KitchenAnalytics t={t} analytics={kitchenAnalytics} now={now} boardCount={orders.length} queueMetrics={queueMetrics} />
        )}
      </main>
    </div>
  );
}
