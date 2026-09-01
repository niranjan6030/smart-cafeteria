import { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';

// Resolves the signed-in user's role/stall against Firestore on every auth state change,
// hydrating localStorage for fast reads elsewhere (see firebase.js). Isolated from App.jsx's
// render tree so routing stays purely presentational.
export function useAuthSession() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const [abGroup] = useState(() => {
    const stored = localStorage.getItem('ab_testing_group');
    if (stored === 'GroupA' || stored === 'GroupB') return stored;
    const assigned = Math.random() < 0.5 ? 'GroupA' : 'GroupB';
    localStorage.setItem('ab_testing_group', assigned);
    return assigned;
  });

  const cleanupSession = () => {
    setUser(null);
    setUserRole(null);
    localStorage.removeItem('userRole');
    localStorage.removeItem('assignedStall');
    sessionStorage.removeItem('staff_onboarding_pending');
    sessionStorage.removeItem('admin_claim_pending');
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        const email = currentUser.email.toLowerCase();
        const userRef = doc(db, 'users', currentUser.uid);

        try {
          const existingSnap = await getDoc(userRef);
          const onboardingPending = sessionStorage.getItem('staff_onboarding_pending') === 'true';
          const adminClaimPending = sessionStorage.getItem('admin_claim_pending') === 'true';

          let resolvedRole;
          let resolvedStall = null;

          if (existingSnap.exists()) {
            // A) EXISTING USER: Trust Firestore as absolute source of truth
            const data = existingSnap.data();
            resolvedRole = data.role || 'student';
            resolvedStall = data.assignedStall ?? null;

            // A "staff" account with no stall assigned can't operate any terminal — that state is
            // produced whenever an admin removes a stall's registered email or reassigns its
            // operator. Without this fallback the account is locked out of the app entirely:
            // App.jsx's StudentRoute bounces role:"staff" to /live, KitchenLiveBoard finds no
            // stall, signs them out, and the next sign-in repeats the loop forever. Treat them as
            // a student instead, so they keep normal access to the ordering app. (The client
            // cannot repair the Firestore role itself — the rules forbid a user changing their own
            // role — so an admin still demotes them properly via Users & Roles / admin-set-role.)
            if (resolvedRole === 'staff' && !resolvedStall) {
              resolvedRole = 'student';
            }

            await setDoc(userRef, {
              displayName: currentUser.displayName,
              email: email,
              photoURL: currentUser.photoURL,
              lastLogin: new Date().toISOString(),
              abGroup: abGroup,
            }, { merge: true });

          } else if (onboardingPending || adminClaimPending) {
            // B) MID STAFF VERIFICATION OR MID ADMIN-SEAT CLAIM: MainContainer.jsx (staff) or
            // AdminLogin.jsx (admin bootstrap) just signed this uid in with Google and is waiting
            // on a server-side check — api/verify-staff-verification-code.js or
            // api/claim-admin-seat.js, both via the Admin SDK. Hold here with no role and no
            // redirect either way until that finishes (or the attempt is cancelled).
            setUserRole(null);
            setUser(currentUser);
            setAuthError(null);
            setLoading(false);
            return;

          } else {
            // C) FIRST TIME LOGIN, STUDENT TAB
            if (email.includes('christuniversity.in')) {
              resolvedRole = 'student';
            } else {
              // DOMAIN FIREWALL VIOLATION
              await signOut(auth);
              cleanupSession();
              setAuthError('Access Denied: Only Christ University or provisioned Staff accounts allowed.');
              setLoading(false);
              return;
            }

            await setDoc(userRef, {
              displayName: currentUser.displayName,
              email: email,
              photoURL: currentUser.photoURL,
              role: resolvedRole,
              assignedStall: resolvedStall,
              lastLogin: new Date().toISOString(),
              abGroup: abGroup,
            });
          }

          localStorage.setItem('userRole', resolvedRole);
          localStorage.setItem('assignedStall', resolvedStall || '');
          setAuthError(null);
          setUserRole(resolvedRole);
          setUser(currentUser);

        } catch (e) {
          console.error('Failed to sync user with Firestore:', e);
          setUserRole(localStorage.getItem('userRole') || 'student');
          setUser(currentUser);
        }
      } else {
        cleanupSession();
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [abGroup]);

  return { user, userRole, loading, authError, abGroup };
}
