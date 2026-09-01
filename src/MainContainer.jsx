import { signInWithGoogle, auth } from './firebase';
import { useState } from 'react';

// Same Vercel deployment the Razorpay functions already live on. That deployment is a plain
// Express app with routes at their bare names (no /api/ prefix).
const API_BASE_URL = (import.meta.env?.VITE_PAYMENT_API_BASE_URL || "").replace(/\/$/, "");
const STAFF_LOGIN_URL = `${API_BASE_URL}/staff-login`;

// Forces a full reload into /live so useAuthSession.js re-initializes from scratch and reads the
// Firestore doc /staff-login just wrote — same hard-reload pattern StallTerminal.jsx's
// handleReturnToGateway already uses after an auth-state change.
function redirectToLiveTerminal() {
  window.location.hash = '/live';
  window.location.reload();
}

async function postJson(url, payload, idToken) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The server identifies the caller from this verified token alone — nothing in the body
        // is trusted for identity (a body-supplied uid/email would let anyone claim a stall).
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not reach the sign-in service. Check your connection.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || `Sign-in service returned ${response.status}`);
  }
  return data;
}

function MainContainer({ authError = null }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(authError);

  // Dedicated state for portal context isolation — 'student' | 'staff' | 'admin'
  const [portalMode, setPortalMode] = useState('student');

  const handleTabSwitch = (mode) => {
    setPortalMode(mode);
    setError(null);
  };

  const handleGoToAdminPanel = () => {
    // Admin has its own dedicated gateway (AdminLogin.jsx) — this just links there rather than
    // duplicating that flow here.
    window.location.hash = '/admin';
  };

  const handleGoogleLogin = async () => {
    const isStaffMode = portalMode === 'staff';

    setIsLoading(true);
    setError(null);

    if (isStaffMode) {
      // Tells useAuthSession.js not to finalize a role (or kick out a non-university email) for
      // this uid while the server-side /staff-login check is still in flight — see
      // App.jsx/useAuthSession.js.
      sessionStorage.setItem('staff_onboarding_pending', 'true');
    }

    try {
      const result = await signInWithGoogle();
      const signedInUser = result?.user || auth.currentUser;

      if (!signedInUser) return;

      if (isStaffMode) {
        // Which stall (if any) this email maps to is resolved entirely server-side from
        // stall_email_registry — the client never picks one. The Firebase ID token (not a
        // body-asserted uid/email) is what the server verifies, so only the real Google sign-in
        // for a registered stall email can be granted role:staff + its stall and the
        // single-occupancy lock in one call (api /staff-login, via the Admin SDK); an
        // unregistered email is turned away.
        const idToken = await signedInUser.getIdToken();
        const loginResult = await postJson(STAFF_LOGIN_URL, {}, idToken);
        sessionStorage.removeItem('staff_onboarding_pending');
        localStorage.setItem('assignedStall', loginResult.stall || '');
        localStorage.setItem('userRole', 'staff');
        redirectToLiveTerminal();
      }
      // Non-staff (student) sign-ins need no further action here — useAuthSession.js resolves
      // their role from the Christ University email-domain check on its own.
    } catch (err) {
      console.error("Login error:", err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled. Please try again.');
      } else if (isStaffMode) {
        setError(err.message || 'Could not sign in to your stall. Please try again.');
      } else {
        setError('Login failed. Please try again.');
      }
      if (isStaffMode) {
        sessionStorage.removeItem('staff_onboarding_pending');
        // The email wasn't registered to any stall (or the stall's occupied) — sign back out
        // rather than leaving a half-authenticated, role-less session sitting around.
        await auth.signOut().catch(() => {});
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-white px-6">
      <div className="max-w-[450px] w-full border-[0.5px] border-gray-200 p-12 md:p-16 flex flex-col items-center text-center relative">

        {/* ─── PORTAL NAVIGATION TABS ─── */}
        <div className="flex w-full border-b border-gray-100 mb-8">
          <button
            type="button"
            onClick={() => handleTabSwitch('student')}
            className={`w-1/3 pb-3 text-[9px] uppercase tracking-[0.2em] font-bold border-b transition-all duration-200 ${
              portalMode === 'student'
                ? 'border-black text-black'
                : 'border-transparent text-gray-300 hover:text-gray-500'
            }`}
          >
            Student / Faculty
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('staff')}
            className={`w-1/3 pb-3 text-[9px] uppercase tracking-[0.2em] font-bold border-b transition-all duration-200 ${
              portalMode === 'staff'
                ? 'border-black text-black'
                : 'border-transparent text-gray-300 hover:text-gray-500'
            }`}
          >
            Kitchen Staff
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('admin')}
            className={`w-1/3 pb-3 text-[9px] uppercase tracking-[0.2em] font-bold border-b transition-all duration-200 ${
              portalMode === 'admin'
                ? 'border-black text-black'
                : 'border-transparent text-gray-300 hover:text-gray-500'
            }`}
          >
            Admin
          </button>
        </div>

        {/* ─── BRANDING SYSTEM ─── */}
        <div className="mb-8">
          <img src="logo.png" alt="Christ University Cafeteria" className="h-16 w-auto object-contain mx-auto" />
        </div>

        <div className="mb-10">
          <h2 className="text-3xl font-light tracking-tighter text-black mb-2 uppercase">
            Christ University <span className="font-bold">CAFETERIA</span>
          </h2>
          <p className="text-gray-400 text-[10px] font-bold uppercase tracking-[0.3em]">
            {portalMode === 'staff'
              ? "Vendor Fulfillment Portal"
              : portalMode === 'admin'
                ? "Administrative Access Portal"
                : "University Cafeteria Service"}
          </p>
        </div>

        {/* ─── DYNAMIC ERROR CHASSIS ─── */}
        {error && (
          <div className="w-full mb-6 p-4 bg-red-50 border border-red-100">
            <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">{error}</p>
          </div>
        )}

        {/* ─── INTERACTIVE PORTAL FLOW ROUTING ─── */}
        {portalMode === 'admin' ? (
          /* BRANCH C: ADMIN ROUTE — links out to the dedicated Admin Panel gateway
              (AdminLogin.jsx) rather than duplicating its sign-in logic here. */
          <div className="w-full flex flex-col gap-4">
            <p className="text-xs leading-relaxed text-gray-500">
              Admin access uses its own dedicated sign-in, kept separate from student and staff
              accounts.
            </p>
            <button
              type="button"
              onClick={handleGoToAdminPanel}
              className="w-full flex items-center justify-center gap-4 bg-black text-white py-4 px-6 rounded-none font-bold text-[10px] uppercase tracking-[0.2em] transition-all hover:bg-neutral-800 active:scale-[0.98]"
            >
              Go to Admin Panel
            </button>
          </div>
        ) : portalMode === 'staff' ? (
          /* BRANCH A: KITCHEN STAFF ROUTE — no stall picker, no emailed code. Real canteens have
              one dedicated email per stall (registered by the admin in stall_email_registry), so
              which stall a sign-in belongs to is resolved entirely server-side from that registry.
              A registered email goes straight to its own board after Google sign-in. */
          <div className="w-full flex flex-col gap-4">
            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-4 bg-black text-white py-4 px-6 rounded-none font-bold text-[10px] uppercase tracking-[0.2em] transition-all hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <img src="google_icon.png" alt="" className="w-4 h-4 invert" />
                  <span>Staff Google Authentication</span>
                </>
              )}
            </button>
            <p className="text-[9px] uppercase tracking-widest text-gray-300">
              Your stall is determined by your registered email — sign in with the Google account
              the admin registered for your stall. Not registered to a stall yet? Contact the admin.
            </p>
          </div>
        ) : (
          /* BRANCH B: STUDENT / FACULTY ROUTE */
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-4 bg-black text-white py-4 px-6 rounded-none font-bold text-[10px] uppercase tracking-[0.2em] transition-all hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />
                <span>Signing In...</span>
              </>
            ) : (
              <>
                <img src="google_icon.png" alt="" className="w-4 h-4 invert" />
                <span>Continue with Google</span>
              </>
            )}
          </button>
        )}

        {/* ─── HARDWARE / AUDIT FOOTER ─── */}
        <div className="mt-12 pt-8 border-t-[0.5px] border-gray-100 w-full">
          <p className="text-[8px] text-gray-300 leading-relaxed uppercase font-black tracking-[0.5em]">
            {portalMode === 'staff'
              ? "Authorized Personnel Only"
              : portalMode === 'admin'
                ? "Administrator Access Only"
                : "Christ University Accounts Only"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default MainContainer;
