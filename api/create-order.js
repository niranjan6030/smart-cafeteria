import { getAdminAuth, getAdminDb } from "./_firebaseAdmin.js";

function setCors(req, res) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req.headers.origin || "";

  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: "Origin is not allowed for payments." });
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

const MAX_ORDER_AMOUNT_INR = 500000; // sanity cap for bulk orders; well above any real cart

// Server-side cart pricing — mirrors canteen-backend/index.js (and the frontend's
// applySpecialPricing). The Razorpay amount is anchored to the catalog, never to body.amount.
function effectiveUnitPrice(product) {
  const basePrice = Number(product?.price || 0);
  const discountPercent = product?.isSpecial ? Number(product.specialDiscountPercent || 0) : 0;
  return discountPercent > 0 ? Math.round(basePrice * (1 - discountPercent / 100)) : basePrice;
}

async function computeOrderTotalFromCatalog(db, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Order items are required." };
  }
  let totalRupees = 0;
  for (const item of items.slice(0, 100)) {
    const productId = String(item?.id || "");
    const quantity = Math.floor(Number(item?.quantity));
    if (!productId || !Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
      return { ok: false, error: "Invalid cart item." };
    }
    let productSnap;
    try {
      productSnap = await db.collection("products").doc(productId).get();
    } catch {
      return { ok: false, error: "Could not look up menu prices. Please try again." };
    }
    if (!productSnap.exists || productSnap.data()?.available === false) {
      return { ok: false, error: "An item in your cart is no longer available. Please review your cart." };
    }
    totalRupees += effectiveUnitPrice(productSnap.data()) * quantity;
  }
  return { ok: true, paise: Math.round(totalRupees * 100), rupees: totalRupees };
}

// Requires a signed-in caller: opening a Razorpay order is only meaningful for a Firestore
// order/pass the signed-in user just created. The amount is re-checked against the Firestore
// document at verify-payment time, so an underpaid order can never be confirmed.
async function verifyIdToken(authorization, adminAuth) {
  const header = String(authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await adminAuth.verifyIdToken(match[1]);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!setCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: "Payment service is not configured." });
  }

  let body;
  try {
    body = getBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  let decoded = null;
  try {
    decoded = await verifyIdToken(req.headers.authorization, getAdminAuth());
  } catch {
    return res.status(500).json({ error: "Authentication service is unavailable." });
  }
  if (!decoded) {
    return res.status(401).json({ error: "Not signed in. Please sign in again." });
  }

  const firebaseDocId = String(body.orderId || "").trim();
  const type = String(body.type || "order");
  const collectionName = type === "meal_pass" || type === "subscription" ? "subscriptions" : "orders";

  if (!firebaseDocId) {
    return res.status(400).json({ error: "Missing order reference." });
  }

  const db = getAdminDb();

  let docSnap;
  try {
    docSnap = await db.collection(collectionName).doc(firebaseDocId).get();
  } catch {
    return res.status(500).json({ error: "Could not look up your order. Please try again." });
  }
  if (!docSnap.exists) {
    return res.status(404).json({ error: "Order record not found. Please start a new order." });
  }
  const docData = docSnap.data();

  // Idempotency: an already-paid record must never open a second Razorpay session.
  if (docData.payment_status === "paid") {
    return res.status(409).json({ error: "This order is already paid." });
  }

  // Ownership: only the document's own student may open a payment session for it.
  if (docData.student_uid && docData.student_uid !== decoded.uid) {
    return res.status(403).json({ error: "You can only pay for your own orders." });
  }

  let expectedPaise;
  if (collectionName === "subscriptions") {
    expectedPaise = Math.round(Number(docData.total_paid) * 100);
  } else {
    const priced = await computeOrderTotalFromCatalog(db, body.items);
    if (!priced.ok) {
      return res.status(400).json({ error: priced.error });
    }
    const declaredPaise = Math.round(Number(docData.price) * 100);
    if (!Number.isFinite(declaredPaise) || declaredPaise !== priced.paise) {
      return res.status(400).json({
        error: "Cart total does not match current menu prices. Please review your cart and try again.",
      });
    }
    expectedPaise = priced.paise;
  }

  if (!Number.isFinite(expectedPaise) || expectedPaise < 100) {
    return res.status(400).json({ error: "Amount must be at least INR 1." });
  }
  if (expectedPaise > MAX_ORDER_AMOUNT_INR * 100) {
    return res.status(400).json({ error: "Amount exceeds the maximum allowed for a single order." });
  }

  const receipt = firebaseDocId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-40);

  try {
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: expectedPaise,
        currency: "INR",
        receipt,
        notes: {
          firebase_doc_id: firebaseDocId,
          type,
        },
      }),
    });

    const data = await razorpayResponse.json().catch(() => ({}));

    if (!razorpayResponse.ok) {
      console.error("Razorpay create-order rejected:", data?.error || data);
      return res.status(502).json({
        error: data.error?.description || "Could not initiate the payment. Please try again.",
      });
    }

    // Stamp the authoritative expectation + razorpay order id via the Admin SDK — clients can
    // never write these fields (firestore.rules reject them), so /verify-payment can trust them.
    await db.collection(collectionName).doc(firebaseDocId).set({
      amount_expected_paise: expectedPaise,
      pricing_verified_at: new Date(),
      razorpay_order_id: data.id,
      updated_at: new Date(),
    }, { merge: true });

    return res.status(200).json({
      id: data.id,
      amount: data.amount,
      currency: data.currency,
      receipt: data.receipt,
    });
  } catch (error) {
    console.error("Razorpay create-order failed:", error);
    return res.status(500).json({ error: "Could not reach the payment service. Please try again." });
  }
}
