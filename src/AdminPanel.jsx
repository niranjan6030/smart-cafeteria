import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "./firebase";
import { STALLS, getTheme } from "./components/KitchenLiveBoard/helpers";
import { APPROVE_LOGOUT_URL, SET_ROLE_URL, postJson } from "./components/AdminPanel/helpers";
import Overview from "./components/AdminPanel/Overview";
import Stalls from "./components/AdminPanel/Stalls";
import LogoutRequests from "./components/AdminPanel/LogoutRequests";
import UsersAndRoles from "./components/AdminPanel/UsersAndRoles";

const shopKeyOf = (shopName) => (shopName === "Fresh Time" ? "Break Time" : shopName);

// ─── Admin Panel — the oversight layer over both UserMenu.jsx and KitchenLiveBoard.jsx.
// Everything here is read from live Firestore listeners centralized in this container, with
// each tab a plain presentational consumer — same split pattern as UserMenu/KitchenLiveBoard.
function AdminPanel({ user }) {
  const t = getTheme(true);
  const [activeTab, setActiveTab] = useState("overview"); // overview | stalls | logout-requests | users

  const [shopStatusByStall, setShopStatusByStall] = useState({});
  const [sessionsByStall, setSessionsByStall] = useState({});
  const [orderSignals, setOrderSignals] = useState([]);
  const [users, setUsers] = useState([]);
  const [logoutRequests, setLogoutRequests] = useState([]);
  const [stallEmails, setStallEmails] = useState({});

  const [busyStall, setBusyStall] = useState("");
  const [resolvingUid, setResolvingUid] = useState("");
  const [savingUid, setSavingUid] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "shop_status"),
      (snapshot) => {
        const map = {};
        snapshot.docs.forEach((docSnap) => { map[docSnap.id] = docSnap.data(); });
        setShopStatusByStall(map);
      },
      (error) => console.error("[AdminPanel] shop_status listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "stall_sessions"),
      (snapshot) => {
        const map = {};
        snapshot.docs.forEach((docSnap) => { map[docSnap.id] = { id: docSnap.id, ...docSnap.data() }; });
        setSessionsByStall(map);
      },
      (error) => console.error("[AdminPanel] stall_sessions listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "stall_email_registry"),
      (snapshot) => {
        const map = {};
        snapshot.docs.forEach((docSnap) => { map[docSnap.id] = docSnap.data()?.email || ""; });
        setStallEmails(map);
      },
      (error) => console.error("[AdminPanel] stall_email_registry listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "order_signals"),
      (snapshot) => setOrderSignals(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (error) => console.error("[AdminPanel] order_signals listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => setUsers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (error) => console.error("[AdminPanel] users listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "logout_requests"),
      (snapshot) =>
        setLogoutRequests(
          snapshot.docs
            .map((d) => ({ id: d.id, uid: d.id, ...d.data() }))
            .filter((r) => r.status === "pending")
        ),
      (error) => console.error("[AdminPanel] logout_requests listener failed:", error)
    );
    return () => unsubscribe();
  }, []);

  const stallLiveData = useMemo(() => {
    const pendingCounts = {};
    orderSignals.forEach((order) => {
      if (!["pending", "preparing", "ready"].includes(order.status)) return;
      const key = shopKeyOf(order.shop_name);
      pendingCounts[key] = (pendingCounts[key] || 0) + 1;
    });

    return STALLS.map((stall) => {
      const status = shopStatusByStall[stall] || shopStatusByStall[stall === "Break Time" ? "Fresh Time" : stall];
      return {
        name: stall,
        isOpen: status?.is_open !== false,
        isBusy: Boolean(status?.is_busy),
        occupant: sessionsByStall[stall] || null,
        pendingOrderCount: pendingCounts[stall] || 0,
      };
    });
  }, [shopStatusByStall, sessionsByStall, orderSignals]);

  const handleForceRelease = async (stallName) => {
    if (!window.confirm(`Force-release ${stallName}? The current session will be logged out immediately.`)) return;
    setBusyStall(stallName);
    setActionError("");
    try {
      await deleteDoc(doc(db, "stall_sessions", stallName));
    } catch (error) {
      console.error("[AdminPanel] Force release failed:", error);
      setActionError(`Could not release ${stallName}. Please try again.`);
    } finally {
      setBusyStall("");
    }
  };

  const handleToggleOpen = async (stallName, nextOpen) => {
    setBusyStall(stallName);
    setActionError("");
    try {
      await setDoc(doc(db, "shop_status", stallName), { is_open: nextOpen, updatedAt: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error("[AdminPanel] Toggle open failed:", error);
      setActionError(`Could not update ${stallName}'s open status.`);
    } finally {
      setBusyStall("");
    }
  };

  const handleTogglePause = async (stallName, nextPaused) => {
    setBusyStall(stallName);
    setActionError("");
    try {
      await setDoc(
        doc(db, "shop_status", stallName),
        {
          is_busy: nextPaused,
          message: nextPaused ? "Kitchen is at capacity — new orders are temporarily paused." : "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("[AdminPanel] Toggle pause failed:", error);
      setActionError(`Could not update ${stallName}'s pause status.`);
    } finally {
      setBusyStall("");
    }
  };

  const handleSaveStallEmail = async (stallName, email) => {
    setBusyStall(`email:${stallName}`);
    setActionError("");
    try {
      await setDoc(
        doc(db, "stall_email_registry", stallName),
        { email: email.toLowerCase(), updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      console.error("[AdminPanel] Save stall email failed:", error);
      setActionError(`Could not save the registered email for ${stallName}.`);
    } finally {
      setBusyStall("");
    }
  };

  // Removes a stall's registered email, REVOKES staff access for whoever was provisioned to it,
  // and force-releases the occupancy lock — so the account is fully de-provisioned rather than
  // merely unregistered.
  //
  // Deleting the registry entry alone was not enough: users/{uid} kept role:"staff" with
  // assignedStall still set, so useAuthSession resolved that account as staff on its next
  // sign-in and App.jsx routed it straight back into the stall terminal — bypassing
  // /staff-login entirely (which would otherwise have turned it away, since its email is no
  // longer in the registry). That left removed staff stuck in a stall they could not leave.
  const handleRemoveStallEmail = async (stallName) => {
    const currentEmail = stallEmails[stallName];
    if (
      !window.confirm(
        `Remove the registered email${currentEmail ? ` (${currentEmail})` : ""} for ${stallName}? ` +
          `Their staff access will be revoked, they'll be signed out of the terminal, and this email ` +
          `won't be able to log in again until it's re-registered.`
      )
    ) {
      return;
    }
    setBusyStall(`email-remove:${stallName}`);
    setActionError("");
    try {
      // Every account provisioned to this stall — matched either by its current assignment or by
      // the registry email being removed. admin-set-role verifies the caller is an admin
      // server-side, resets role/assignedStall, and releases any stall_sessions lock it holds.
      const affected = users.filter(
        (candidate) =>
          candidate.assignedStall === stallName ||
          (currentEmail && candidate.email && candidate.email.toLowerCase() === currentEmail.toLowerCase())
      );

      for (const target of affected) {
        await postJson(SET_ROLE_URL, {
          targetUid: target.id,
          role: "student",
          assignedStall: null,
        }, await auth.currentUser.getIdToken());
        // Drop any stale logout request so the de-provisioned account starts clean.
        await deleteDoc(doc(db, "logout_requests", target.id)).catch(() => {});
      }

      await deleteDoc(doc(db, "stall_email_registry", stallName));
      await deleteDoc(doc(db, "stall_sessions", stallName));
    } catch (error) {
      console.error("[AdminPanel] Remove stall email failed:", error);
      setActionError(`Could not fully remove access for ${stallName}. Please try again.`);
    } finally {
      setBusyStall("");
    }
  };

  const handleResolveLogoutRequest = async (request, approve) => {
    setResolvingUid(request.uid);
    setActionError("");
    try {
      await postJson(APPROVE_LOGOUT_URL, {
        targetUid: request.uid,
        stall: request.stall,
        approve,
      }, await auth.currentUser.getIdToken());
    } catch (error) {
      console.error("[AdminPanel] Resolve logout request failed:", error);
      setActionError(error.message || "Could not resolve the logout request.");
    } finally {
      setResolvingUid("");
    }
  };

  const handleSetRole = async (targetUid, role, assignedStall) => {
    setSavingUid(targetUid);
    setActionError("");
    try {
      await postJson(SET_ROLE_URL, {
        targetUid,
        role,
        assignedStall,
      }, await auth.currentUser.getIdToken());
    } catch (error) {
      console.error("[AdminPanel] Set role failed:", error);
      setActionError(error.message || "Could not update the user's role.");
    } finally {
      setSavingUid("");
    }
  };

  const handleSignOut = async () => {
    await signOut(auth).catch(() => {});
    window.location.hash = "/";
    window.location.reload();
  };

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "stalls", label: "Stalls" },
    { key: "logout-requests", label: `Logout Requests${logoutRequests.length ? ` (${logoutRequests.length})` : ""}` },
    { key: "users", label: "Users & Roles" },
  ];

  return (
    <div className={`min-h-screen font-mono antialiased ${t.page}`}>
      <header className={`sticky top-0 z-[100] border-b ${t.headerBorder} ${t.headerBg}`}>
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className={`text-[10px] uppercase tracking-[0.4em] ${t.label}`}>Christ University Cafeteria</p>
            <h1 className={`mt-1 text-2xl font-bold uppercase tracking-wide ${t.heading}`}>
              Admin <span className={t.accent}>Control Panel</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <p className={`text-xs ${t.body}`}>{user?.displayName || user?.email}</p>
            <button
              onClick={handleSignOut}
              className="border border-white/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-red-400 transition hover:bg-red-500/10"
            >
              Sign Out
            </button>
          </div>
        </div>
        <div className={`mx-auto flex max-w-[1400px] flex-wrap gap-2 border-t px-6 py-3 ${t.divider}`}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ease-out ${t.focusRing} ${
                activeTab === tab.key
                  ? `${t.accentBorder} ${t.dark ? "bg-[#37c8be]/10" : "bg-orange-50"} ${t.accent}`
                  : `${t.headerBorder} ${t.label} ${t.labelHover}`
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {actionError && (
          <div className="mb-6 border border-red-400/30 bg-red-500/5 p-4 text-xs text-red-500">{actionError}</div>
        )}

        {activeTab === "overview" && <Overview t={t} stallLiveData={stallLiveData} />}

        {activeTab === "stalls" && (
          <Stalls
            t={t}
            stallLiveData={stallLiveData}
            stallEmails={stallEmails}
            onSaveEmail={handleSaveStallEmail}
            onRemoveEmail={handleRemoveStallEmail}
            onForceRelease={handleForceRelease}
            onToggleOpen={handleToggleOpen}
            onTogglePause={handleTogglePause}
            busyStall={busyStall}
          />
        )}

        {activeTab === "logout-requests" && (
          <LogoutRequests
            t={t}
            pendingRequests={logoutRequests}
            onResolve={handleResolveLogoutRequest}
            resolvingUid={resolvingUid}
          />
        )}

        {activeTab === "users" && (
          <UsersAndRoles
            t={t}
            users={users}
            onSetRole={handleSetRole}
            currentUid={user?.uid}
            savingUid={savingUid}
          />
        )}
      </main>
    </div>
  );
}

export default AdminPanel;
