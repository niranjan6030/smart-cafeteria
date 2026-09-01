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

// This route reads no body fields — identity comes exclusively from the verified ID token.

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Identity comes from the caller's verified Firebase ID token, so the emailed code always goes
// to the Google account that actually signed in — never to an arbitrary body-supplied address.
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

// Sends a fresh 6-digit code to a staff member's own (Google-verified) email address before they
// can claim a stall terminal. Which stall (if any) is entirely derived server-side from
// stall_email_registry — the client never gets to pick a stall, since real canteens have one
// dedicated email per stall, not a self-service picker. Blocks entirely (no code sent) if the
// email isn't registered to any stall, or if its stall is already occupied by someone else.
export default async function handler(req, res) {
  if (!setCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(500).json({ error: "Email service is not configured." });
  }

  const decoded = await verifyIdToken(req.headers.authorization);
  if (!decoded) {
    return res.status(401).json({ error: "Not signed in. Please sign in again." });
  }

  const uid = decoded.uid;
  const email = String(decoded.email || "").trim().toLowerCase();

  if (!email || decoded.email_verified === false) {
    return res.status(403).json({ error: "Your account needs a verified email address." });
  }

  const db = getAdminDb();

  const registrySnap = await db
    .collection("stall_email_registry")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (registrySnap.empty) {
    return res.status(403).json({
      error: "This email is not registered to any stall. Contact the admin to be assigned one.",
    });
  }

  const stall = registrySnap.docs[0].id;

  const sessionSnap = await db.collection("stall_sessions").doc(stall).get();
  if (sessionSnap.exists && sessionSnap.data()?.uid !== uid) {
    return res.status(409).json({
      error: `${stall} is currently in use by another staff member. Contact the admin to release it.`,
    });
  }

  const code = generateCode();
  const now = Date.now();

  try {
    await db.collection("staff_verification_codes").doc(uid).set({
      code,
      stall,
      email,
      createdAt: now,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    });
  } catch (error) {
    console.error("Failed to store verification code:", error);
    return res.status(500).json({ error: "Could not generate a verification code. Please try again." });
  }

  try {
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "Christ University Cafeteria <onboarding@resend.dev>",
        to: [email],
        subject: `Your ${stall} kitchen terminal code: ${code}`,
        html: `<p>Your verification code for the <strong>${stall}</strong> kitchen terminal is:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      console.error("Resend send failed:", errorData);
      return res.status(502).json({ error: errorData.message || "Could not send the verification email." });
    }
  } catch (error) {
    console.error("Resend request failed:", error);
    return res.status(502).json({ error: "Could not reach the email service." });
  }

  return res.status(200).json({ sent: true, stall });
}
