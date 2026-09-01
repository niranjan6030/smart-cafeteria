import admin from "firebase-admin";
import { getAdminAuth, getAdminDb } from "./_firebaseAdmin.js";

function setCors(req, res) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req.headers.origin || "";

  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: "Origin is not allowed." });
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigins[0] || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

const VALID_ROLES = ["student", "staff", "faculty_admin", "admin"];
const VALID_STALLS = ["Falcon Veg", "Fresheteria", "Mingos", "Break Time", "Surf & Turf", "Bakery"];

async function requireAdmin(db, requesterUid) {
  const requesterSnap = await db.collection("users").doc(requesterUid).get();
  return requesterSnap.exists && requesterSnap.data()?.role === "admin";
}

// The acting admin is derived from the caller's verified Firebase ID token — never the body. A
// client-supplied requesterUid would let anyone pass a real admin's uid and grant themselves any
// role.
async function verifyIdToken(authorization) {
  const header = String(authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return null;
  }
}

// The only path (besides email-verified stall login and the first-login admin bootstrap) that
// may change a user's role — used by the Users & Roles screen in the Admin Panel. Verifies the
// caller is an admin server-side. Assigning anything other than "staff" clears assignedStall and
// releases any stall_sessions lock the target currently holds, so a demoted/reassigned account
// can never keep squatting on a stall's occupancy.
export default async function handler(req, res) {
  if (!setCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let body;
  try {
    body = getBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  const decoded = await verifyIdToken(req.headers.authorization);
  if (!decoded) {
    return res.status(401).json({ error: "Not signed in. Please sign in again." });
  }
  const requesterUid = decoded.uid;

  const targetUid = String(body.targetUid || "");
  const role = String(body.role || "");
  const assignedStallInput = body.assignedStall != null ? String(body.assignedStall) : null;

  if (!targetUid || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Missing or invalid targetUid or role." });
  }
  if (role === "staff" && assignedStallInput && !VALID_STALLS.includes(assignedStallInput)) {
    return res.status(400).json({ error: "Invalid stall name." });
  }

  const db = getAdminDb();

  const isAdminCaller = await requireAdmin(db, requesterUid);
  if (!isAdminCaller) {
    return res.status(403).json({ error: "Only an admin may change user roles." });
  }

  const finalAssignedStall = role === "staff" ? assignedStallInput || null : null;

  try {
    await db.collection("users").doc(targetUid).set(
      {
        role,
        assignedStall: finalAssignedStall,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Release any stall this account currently occupies if it's no longer staff there — a role
    // change or reassignment should never leave a stale occupancy lock behind.
    const heldSessions = await db.collection("stall_sessions").where("uid", "==", targetUid).get();
    await Promise.all(
      heldSessions.docs
        .filter((doc) => doc.id !== finalAssignedStall)
        .map((doc) => doc.ref.delete())
    );

    return res.status(200).json({ updated: true });
  } catch (error) {
    console.error("Failed to update user role:", error);
    return res.status(500).json({ error: "Could not update the user. Please try again." });
  }
}
