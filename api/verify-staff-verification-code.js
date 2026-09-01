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

const MAX_ATTEMPTS = 5;

// The uid being verified is derived from the caller's own ID token, so one account can never
// submit guesses against another account's code record.
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

// The only path that may grant `role: "staff"` + claim a stall's occupancy lock — the client
// never self-reports success, it only submits a guess here. The stall itself is never trusted
// from the client either: it's read back from the staff_verification_codes record that
// api/send-staff-verification-code.js wrote (already resolved server-side from
// stall_email_registry), so there's no way to request a code for one stall and then claim a
// different one at verify time. Re-checks occupancy immediately before claiming the lock to close
// the race between two people verifying for the same stall at nearly the same time.
export default async function handler(req, res) {
  if (!setCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ verified: false, error: "Method not allowed." });

  let body;
  try {
    body = getBody(req);
  } catch {
    return res.status(400).json({ verified: false, error: "Invalid JSON body." });
  }

  const decoded = await verifyIdToken(req.headers.authorization);
  if (!decoded) {
    return res.status(401).json({ verified: false, error: "Not signed in. Please sign in again." });
  }

  const uid = decoded.uid;
  const submittedCode = String(body.code || "").trim();
  const email = String(decoded.email || "").trim().toLowerCase();
  const displayName = String(decoded.name || "");

  if (!submittedCode) {
    return res.status(400).json({ verified: false, error: "Missing verification code." });
  }

  const db = getAdminDb();
  const codeRef = db.collection("staff_verification_codes").doc(uid);
  const codeSnap = await codeRef.get();

  if (!codeSnap.exists) {
    return res.status(400).json({ verified: false, error: "No pending verification code. Please request a new one." });
  }

  const record = codeSnap.data();
  const stall = record.stall;

  if (Date.now() > record.expiresAt) {
    await codeRef.delete().catch(() => {});
    return res.status(400).json({ verified: false, error: "This code has expired. Please request a new one." });
  }

  if ((record.attempts || 0) >= MAX_ATTEMPTS) {
    await codeRef.delete().catch(() => {});
    return res.status(429).json({ verified: false, error: "Too many incorrect attempts. Please request a new code." });
  }

  if (record.code !== submittedCode) {
    await codeRef.update({ attempts: admin.firestore.FieldValue.increment(1) }).catch(() => {});
    return res.status(400).json({ verified: false, error: "Incorrect code." });
  }

  const sessionRef = db.collection("stall_sessions").doc(stall);
  const sessionSnap = await sessionRef.get();
  if (sessionSnap.exists && sessionSnap.data()?.uid !== uid) {
    return res.status(409).json({
      verified: false,
      error: `${stall} is currently in use by another staff member. Contact the admin to release it.`,
    });
  }

  try {
    await sessionRef.set({
      uid,
      email,
      displayName,
      loginAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("users").doc(uid).set(
      {
        role: "staff",
        assignedStall: stall,
        email,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await codeRef.delete();
  } catch (error) {
    console.error("Failed to finalize staff verification:", error);
    return res.status(500).json({ verified: false, error: "Verification succeeded, but saving your session failed. Please try again." });
  }

  return res.status(200).json({ verified: true, stall });
}
