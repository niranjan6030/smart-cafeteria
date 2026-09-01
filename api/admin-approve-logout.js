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

async function requireAdmin(db, requesterUid) {
  const requesterSnap = await db.collection("users").doc(requesterUid).get();
  return requesterSnap.exists && requesterSnap.data()?.role === "admin";
}

// The acting admin is derived from the caller's verified Firebase ID token — never the body.
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

// The only path that resolves a staff member's logout_requests doc. Verifies the caller is
// actually an admin server-side (never just trusts the client) before doing anything.
// On approval: releases the stall_sessions lock in the same operation, so the staff member's own
// client (watching its own logout_requests/{uid} doc) can auto-sign-out the instant this commits.
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
  const stall = String(body.stall || "");
  const approve = Boolean(body.approve);

  if (!targetUid || !stall) {
    return res.status(400).json({ error: "Missing targetUid or stall." });
  }

  const db = getAdminDb();

  const isAdminCaller = await requireAdmin(db, requesterUid);
  if (!isAdminCaller) {
    return res.status(403).json({ error: "Only an admin may resolve logout requests." });
  }

  try {
    const requestRef = db.collection("logout_requests").doc(targetUid);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      return res.status(404).json({ error: "No pending logout request for this staff member." });
    }

    await requestRef.update({
      status: approve ? "approved" : "denied",
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolvedBy: requesterUid,
    });

    if (approve) {
      await db.collection("stall_sessions").doc(stall).delete();
    }

    return res.status(200).json({ resolved: true, approved: approve });
  } catch (error) {
    console.error("Failed to resolve logout request:", error);
    return res.status(500).json({ error: "Could not resolve the logout request. Please try again." });
  }
}
