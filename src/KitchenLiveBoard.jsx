import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { stallRouteByName } from "./components/KitchenLiveBoard/stalls";

// ─── Kitchen terminal entry point / router ─────────────────────────────────
// Mounted at both "/live" and "/live/:stallSlug" (see App.jsx). Resolves the signed-in staff
// member's own assignedStall and always lands them on that stall's own URL + component — typing
// another stall's URL directly redirects back to your own, so one staff account can never render
// another stall's board. The actual per-stall UI lives in one file per stall under
// src/components/KitchenLiveBoard/stalls/; this file only decides which one to render.
function KitchenLiveBoard() {
  const { stallSlug } = useParams();
  const assignedStall = localStorage.getItem("assignedStall") || "";
  const ownRoute = stallRouteByName(assignedStall);

  // No valid stall on record for this session — this shouldn't happen in normal operation, since
  // role:"staff" is only ever granted alongside a real assignedStall by
  // api/verify-staff-verification-code.js. If it ever does (stale/cleared local state), silently
  // clear and bounce back to the gateway instead of showing a dead-end error page.
  useEffect(() => {
    if (ownRoute) return undefined;
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
  }, [ownRoute]);

  if (!ownRoute) return null;

  // Bare "/live", or a URL for a stall that isn't this staff member's own — always redirect to
  // their own stall's page.
  if (!stallSlug || stallSlug !== ownRoute.slug) {
    return <Navigate to={`/live/${ownRoute.slug}`} replace />;
  }

  const { Component } = ownRoute;
  return <Component />;
}

export default KitchenLiveBoard;
