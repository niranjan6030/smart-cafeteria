import { useState } from 'react';
import { auth, signInWithGoogle } from './firebase';
import { getTheme } from './components/KitchenLiveBoard/helpers';

// Same Vercel deployment the Razorpay/staff-verification functions already live on. That
// deployment is a plain Express app (canteen-backend/index.js) with routes at their bare names,
// no /api/ prefix — confirmed by curling it directly.
const API_BASE_URL = (import.meta.env?.VITE_PAYMENT_API_BASE_URL || "").replace(/\/$/, "");
const CLAIM_ADMIN_SEAT_URL = `${API_BASE_URL}/claim-admin-seat`;

async function postJson(url, payload, idToken) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The server identifies the caller from this token alone (see verifyAuth() in
        // canteen-backend/index.js) — nothing in the body is trusted for identity.
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not reach the admin service. Check your connection.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || `Admin service returned ${response.status}`);
  }
  return data;
}

function redirectToAdminPanel() {
  window.location.hash = '/admin';
  window.location.reload();
}

// Dedicated gateway for the Admin Panel — deliberately separate from MainContainer.jsx's
// student/staff tabs. api/claim-admin-seat.js checks the signed-in email against a single fixed
// bootstrap admin account; every other account is turned away unless that admin has since
// promoted them from inside the panel (api/admin-set-role.js).
function AdminLogin({ deniedMessage = null }) {
  const t = getTheme(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(deniedMessage);

  const handleClaimOrSignIn = async () => {
    setIsLoading(true);
    setError(null);
    sessionStorage.setItem('admin_claim_pending', 'true');
    try {
      const result = await signInWithGoogle();
      const signedInUser = result?.user || auth.currentUser;
      if (!signedInUser) return;

      // Send the Firebase ID token instead of a client-asserted uid/email: the server derives
      // both from the verified token, so a forged body can no longer claim the admin seat.
      const idToken = await signedInUser.getIdToken();
      await postJson(CLAIM_ADMIN_SEAT_URL, {
        displayName: signedInUser.displayName || '',
      }, idToken);

      sessionStorage.removeItem('admin_claim_pending');
      redirectToAdminPanel();
    } catch (err) {
      console.error("Admin claim error:", err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled. Please try again.');
      } else {
        setError(err.message || 'Could not access the Admin Panel.');
      }
      sessionStorage.removeItem('admin_claim_pending');
      await auth.signOut().catch(() => {});
      setIsLoading(false);
    }
  };

  return (
    <div className={`flex min-h-screen items-center justify-center px-6 font-mono ${t.page}`}>
      <div className={`w-full max-w-md border p-10 text-center ${t.panelElevated}`}>
        <p className={`text-[10px] uppercase tracking-[0.4em] ${t.label}`}>Christ University Cafeteria</p>
        <h1 className={`mt-3 text-2xl font-bold uppercase tracking-wide ${t.heading}`}>
          Admin <span className={t.accent}>Control Panel</span>
        </h1>
        <p className={`mt-4 text-xs leading-relaxed ${t.body}`}>
          Oversees both the student ordering app and every kitchen terminal — stall occupancy,
          staff logout approvals, and role management.
        </p>

        {error && (
          <div className="mt-6 border border-red-400/30 bg-red-500/5 p-4 text-left text-xs text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleClaimOrSignIn}
          disabled={isLoading}
          className={`mt-8 flex w-full items-center justify-center gap-3 px-5 py-4 text-[10px] font-bold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-50 ${t.accentBg} ${t.accentText} ${t.accentBgHover}`}
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>Checking Admin Access...</span>
            </>
          ) : (
            <>
              <img src="google_icon.png" alt="" className="h-4 w-4" />
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <p className={`mt-6 text-[9px] uppercase tracking-widest ${t.label}`}>
          Only the registered administrator account may access this panel. Everyone else is
          denied unless that admin adds them from inside it.
        </p>
      </div>
    </div>
  );
}

export default AdminLogin;
