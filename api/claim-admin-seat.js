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

// The one initial admin account. Further admins are added from inside the panel itself
// (api/admin-set-role.js), by this account — this fixed check only covers first-time bootstrap.
const BOOTSTRAP_ADMIN_EMAIL = "aadi.r.santhosh2006@gmail.com";

// Identity comes from the caller's verified Firebase ID token — never the request body. The
// original version trusted body uid/email, so anyone could POST the (publicly known) bootstrap
// email with their own uid and be handed role:"admin" in one request.
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
    return res.status(401).json({ granted: false, error: "Not signed in. Please sign in again." });
  }

  const uid = decoded.uid;
  const email = String(decoded.email || "").trim().toLowerCase();
  const displayName = String(decoded.name || body.displayName || "");

  if (!uid || !email) {
    return res.status(400).json({ error: "Missing uid or email." });
  }

  if (decoded.email_verified === false) {
    return res.status(403).json({ granted: false, error: "Your account needs a verified email address." });
  }

  if (email !== BOOTSTRAP_ADMIN_EMAIL) {
    return res.status(403).json({
      granted: false,
      error: "This account is not authorized for admin access.",
    });
  }

  const db = getAdminDb();

  try {
    await db.collection("users").doc(uid).set(
      {
        role: "admin",
        email,
        displayName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return res.status(200).json({ granted: true });
  } catch (error) {
    console.error("Admin seat claim failed:", error);
    return res.status(500).json({ granted: false, error: "Could not process the admin claim. Please try again." });
  }
}
