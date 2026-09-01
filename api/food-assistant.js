// POST /api/food-assistant — controlled backend seam for the Food Assistant.
//
// The assistant is NOT an autonomous LLM agent: every turn is parsed by the deterministic NLU in
// src/assistant, executed against REAL Firestore data, and every cart write comes back as a
// ProposedAction for the client to apply through the app's existing command engine. This function
// only assembles the snapshot (products + shop status + order signals + the caller's own orders)
// and validates the request. Authorization is optional: guests get menu-level answers; signed-in
// users additionally get personalization (usuals, recent orders, recommendations) from their OWN
// order history only.

import { getAdminAuth, getAdminDb } from "./_firebaseAdmin.js";
import { handleAssistantTurn } from "../src/assistant/engine.js";
import { createGeminiTurnInterpreter } from "../src/assistant/llmInterpreter.js";

const MAX_MESSAGES = 24;
const MAX_MESSAGE_LENGTH = 400;
const MAX_CART_LINES = 30;
const MAX_ORDERS = 200;
const MAX_SIGNALS = 300;

// Best-effort per-instance brake against scripted spam of this endpoint (each turn costs several
// Firestore reads). Serverless instances are short-lived, so this is not a global quota.
const rateBuckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    rateBuckets.set(ip, bucket);
    if (rateBuckets.size > 5000) {
      for (const [key, value] of rateBuckets) {
        if (now > value.resetAt) rateBuckets.delete(key);
      }
    }
  }
  bucket.count += 1;
  return bucket.count > 30;
}

function setCors(req, res) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req.headers.origin || "";

  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigins[0] || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  return true;
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const entry of raw) {
    if (!entry) continue;
    if (entry.role === "user") {
      const content = String(entry.content || "").trim();
      if (!content || content.length > MAX_MESSAGE_LENGTH) continue;
      messages.push({
        role: "user",
        content,
        kind: entry.kind === "pick" ? "pick" : undefined,
        data: entry.kind === "pick" ? { productId: String(entry.data?.productId || "") } : undefined,
      });
    } else if (entry.role === "assistant") {
      // Preserve enough of the assistant's prior structured response for conversational memory
      // (follow-up refinements like "Vegetarian only" merge against the last food response).
      messages.push({
        role: "assistant",
        content: String(entry.content || "").slice(0, MAX_MESSAGE_LENGTH),
        type: String(entry.type || "TEXT").slice(0, 30),
        data: entry.data && typeof entry.data === "object" ? { items: Array.isArray(entry.data.items) ? entry.data.items.slice(0, 10) : undefined } : undefined,
        constraints: entry.constraints && typeof entry.constraints === "object" ? entry.constraints : undefined,
      });
    }
  }
  return messages.length > 0 ? messages : null;
}

function sanitizeCart(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((line) => line && line.id)
    .slice(0, MAX_CART_LINES)
    .map((line) => ({
      id: String(line.id),
      quantity: Math.max(1, Math.min(50, Math.round(Number(line.quantity) || 1))),
    }));
}

async function verifyIdToken(authorization) {
  const header = String(authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { token: null };
  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    return { token: decoded };
  } catch {
    return { token: "invalid" };
  }
}

async function safeSnapshot(db) {
  const out = { products: [], shopStatus: {}, orderSignals: [] };
  try {
    const productsSnap = await db.collection("products").get();
    productsSnap.forEach((doc) => out.products.push({ id: doc.id, ...doc.data() }));
  } catch {
    out.products = [];
  }
  try {
    const shopSnap = await db.collection("shop_status").get();
    shopSnap.forEach((doc) => {
      out.shopStatus[doc.id] = doc.data() || {};
    });
  } catch {
    out.shopStatus = {};
  }
  try {
    const signalsSnap = await db
      .collection("order_signals")
      .orderBy("created_at", "desc")
      .limit(MAX_SIGNALS)
      .get();
    signalsSnap.forEach((doc) => out.orderSignals.push(doc.data() || {}));
  } catch {
    out.orderSignals = [];
  }
  return out;
}

async function userOrdersSnapshot(db, uid) {
  if (!uid) return null;
  try {
    const snap = await db
      .collection("orders")
      .where("student_uid", "==", uid)
      .orderBy("created_at", "desc")
      .limit(MAX_ORDERS)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch {
    // Fall back to an unordered read if the composite index is missing.
    try {
      const snap = await db.collection("orders").where("student_uid", "==", uid).limit(MAX_ORDERS).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch {
      return [];
    }
  }
}

export default async function handler(req, res) {
  if (!setCors(req, res)) return res.status(403).json({ error: "Origin is not allowed." });
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please slow down for a moment." });
  }

  let body;
  try {
    body = getBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return res.status(400).json({ error: "messages must be a non-empty array of user messages." });
  }

  let auth;
  try {
    auth = await verifyIdToken(req.headers.authorization);
  } catch {
    return res.status(401).json({ error: "Invalid authentication token." });
  }
  if (auth.token === "invalid") return res.status(401).json({ error: "Invalid authentication token." });

  const context = {
    activeShop: typeof body.context?.activeShop === "string" ? body.context.activeShop.slice(0, 60) : null,
    activeTab: typeof body.context?.activeTab === "string" ? body.context.activeTab.slice(0, 40) : null,
    cart: sanitizeCart(body.context?.cart),
  };

  let db;
  try {
    db = getAdminDb();
  } catch (error) {
    console.error("getAdminDb failed:", error?.message);
    return res.status(500).json({ error: "Assistant backend is not configured." });
  }

  const [snapshot, orders] = await Promise.all([
    safeSnapshot(db),
    userOrdersSnapshot(db, auth.token?.uid || null),
  ]);

  let reply;
  try {
    reply = await handleAssistantTurn({
      messages,
      context,
      interpreter: createGeminiTurnInterpreter(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL),
      snapshot: {
        ...snapshot,
        userOrders: auth.token ? orders : null,
        signedIn: Boolean(auth.token),
        now: new Date(),
      },
    });
  } catch (error) {
    console.error("food-assistant:", error);
    return res.status(500).json({ error: "The assistant hit a snag. Try again." });
  }

  return res.status(200).json(reply);
}
