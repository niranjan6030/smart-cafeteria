import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useState } from 'react';
import { useAuthSession } from './hooks/useAuthSession';

// Route-level code splitting — each of these is a large, role-specific bundle (UserMenu and
// KitchenLiveBoard alone are 1,500-2,900 lines). Without this every visitor downloaded all four
// regardless of which single route they'd land on.
const MainContainer = lazy(() => import('./MainContainer'));
const KitchenLiveBoard = lazy(() => import('./KitchenLiveBoard'));
const UserMenu = lazy(() => import('./UserMenu'));
const AdminLogin = lazy(() => import('./AdminLogin'));
const AdminPanel = lazy(() => import('./AdminPanel'));

// ─── UTILITY: SCROLL RESTORATION ──────────────────────────────────────────────
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// ─── ROUTE GUARD: STAFF ONLY ──────────────────────────────────────────────────
function StaffRoute({ user, userRole, children }) {
  if (!user) return <Navigate to="/login" replace />;
  if (userRole !== 'staff') return <Navigate to="/" replace />;
  return children;
}

// ─── ROUTE GUARD: STUDENT EXCLUSIVE (Redirects Staff to Live Board) ───────────
function StudentRoute({ user, userRole, children }) {
  if (user && userRole === 'staff') return <Navigate to="/live" replace />;
  return children;
}

// ─── FULL SCREEN LOADING CHASSIS ──────────────────────────────────────────────
// Shared by both the auth-bootstrap wait and the lazy-route Suspense fallback, so the visual
// language of "the app is loading" stays identical everywhere it appears. Uses the brand tokens
// from tailwind.config.js (navy/gold) instead of one-off inline hex, and announces itself to
// screen readers via role="status". Instead of a dead spinner, a navy "plate" cycles food icons
// while the message sits below — visible progress keeps the wait feeling shorter (loading-states
// must give feedback). The emoji rotation is decorative; the interval is cleared on unmount.
const LOADER_FOODS = ["🍔", "🍕", "🍜", "🍛", "🥪", "🍟", "🍩", "🧋"];

function LoadingChassis({ message = 'Loading…' }) {
  const [foodIndex, setFoodIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFoodIndex((index) => (index + 1) % LOADER_FOODS.length), 620);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-navy-900 flex h-screen flex-col items-center justify-center px-6 text-center"
    >
      <div className="cc-loader-plate" aria-hidden="true">
        <span key={foodIndex} className="cc-loader-food">{LOADER_FOODS[foodIndex]}</span>
      </div>
      <p className="mt-9 text-lg font-bold tracking-[0.3em] text-gold-400 font-sans">{message}</p>
      <div className="mt-6 h-1 w-44 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className="cc-loader-bar" />
      </div>
    </div>
  );
}

function App() {
  const { user, userRole, loading, authError, abGroup } = useAuthSession();

  if (loading) return <LoadingChassis message="Securing your spot in the cafeteria queue..." />;

  // ─── MAIN APPLICATION ROUTER ────────────────────────────────────────────────
  // overflow-x-clip (not hidden): clips horizontal overflow but does NOT create a
  // scroll container, so the sticky AppHeader keeps sticking while scrolling.
  return (
    <div className="bg-[#FDF8F5] min-h-screen text-[#4A3525] selection:bg-black selection:text-white overflow-x-clip">
      <Router>
        <ScrollToTop />
        <Suspense fallback={<LoadingChassis />}>
          <Routes>

            {/* 1. LOGIN GATEWAY. `userRole == null` keeps MainContainer mounted even once `user`
                is truthy — Google sign-in completes before a staff member's emailed code is
                verified, and MainContainer needs to stay on-screen to show that code-entry step
                instead of being redirected away the instant auth resolves. */}
            <Route
              path="/login"
              element={
                !user || userRole == null
                  ? <MainContainer authError={authError} />
                  : userRole === 'staff'
                    ? <Navigate to="/live" replace />
                    : <Navigate to="/" replace />
              }
            />

            {/* 2. ROOT — Student Menu (Staff redirected away) */}
            <Route
              path="/"
              element={
                <StudentRoute user={user} userRole={userRole}>
                  {!user && abGroup === 'GroupA'
                    ? <Navigate to="/login" replace />
                    : <UserMenu user={user} abGroup={abGroup} />
                  }
                </StudentRoute>
              }
            />

            {/* 3. KITCHEN LIVE BOARD — Staff Only. Bare /live redirects to the signed-in staff
                member's own stall page; /live/:stallSlug renders that specific stall's terminal.
                KitchenLiveBoard.jsx owns the redirect/ownership logic for both. */}
            <Route
              path="/live"
              element={
                <StaffRoute user={user} userRole={userRole}>
                  <KitchenLiveBoard />
                </StaffRoute>
              }
            />
            <Route
              path="/live/:stallSlug"
              element={
                <StaffRoute user={user} userRole={userRole}>
                  <KitchenLiveBoard />
                </StaffRoute>
              }
            />

            {/* 4. ADMIN PANEL — its own gateway, entirely separate from MainContainer's
                student/staff tabs. `userRole == null` keeps AdminLogin mounted through the same
                mid-verification window as /login (see AdminLogin.jsx + useAuthSession.js's
                admin_claim_pending flag). Anyone signed in without role:"admin" sees a clear
                denial rather than a silent redirect. */}
            <Route
              path="/admin"
              element={
                !user || userRole == null
                  ? <AdminLogin />
                  : userRole === 'admin'
                    ? <AdminPanel user={user} />
                    : <AdminLogin deniedMessage="Access denied: your account does not have admin access." />
              }
            />

            {/* 5. MY ORDERS — full order history. Renders UserMenu with the My Orders tab
                pre-selected, replacing the old KitchenDashboard which white-screened for
                subdomain emails (its endsWith('@christuniversity.in') check failed on
                addresses like name@bcah.christuniversity.in). */}
            <Route
              path="/dashboard"
              element={
                <StudentRoute user={user} userRole={userRole}>
                  {!user
                    ? <Navigate to="/login" replace />
                    : <UserMenu user={user} abGroup={abGroup} initialTab="my-orders" />}
                </StudentRoute>
              }
            />

            {/* 6. FALLBACK WILDCARD */}
            <Route path="*" element={<Navigate to="/" replace />} />

          </Routes>
        </Suspense>
      </Router>
    </div>
  );
}

export default App;
