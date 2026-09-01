import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDlzgprnC7qqDyUp-8jFlaRrlDCcEuYjm4",
  authDomain: "canteen-christ.firebaseapp.com",
  projectId: "canteen-christ",
  storageBucket: "canteen-christ.firebasestorage.app",
  messagingSenderId: "789574017471",
  appId: "1:789574017471:web:cae6e55125e4602692410a",
  measurementId: "G-J1HLWL9DGQ",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });

/**
 * Signs in with Google, then immediately reads the Firestore users/{uid} document
 * to determine role and assignedStall. Caches both in localStorage for fast
 * frontend evaluation without an extra async fetch on every page render.
 *
 * Role schema in Firestore users collection:
 *   students  → { role: "student", assignedStall: null }
 *   staff     → { role: "staff",   assignedStall: "Mingos" | "Falcon Veg" | ... }
 */
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const { role, assignedStall } = userSnap.data();
      localStorage.setItem("userRole", role ?? "student");
      localStorage.setItem("assignedStall", assignedStall ?? "");
    } else {
      // First sign-in: provision a default student profile
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: "student",
        assignedStall: null,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem("userRole", "student");
      localStorage.setItem("assignedStall", "");
    }

    return user;
  } catch (error) {
    console.error("Sign-in error:", error.code, error.message);
    throw error;
  }
};

export const signOutUser = () => {
  localStorage.removeItem("userRole");
  localStorage.removeItem("assignedStall");
  localStorage.removeItem("assignedShop");
  return signOut(auth);
};

export default app;