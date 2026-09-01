const crypto = require("crypto");
const admin = require("firebase-admin");

const ORDER_COLLECTION = "orders";
const PASS_COLLECTION = "subscriptions";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Razorpay-Signature");
  return true;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString("utf8"));
    if (typeof req.body === "string") return resolve(req.body);
    if (req.body && typeof req.body === "object") return resolve(JSON.stringify(req.body));

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const rawBody = await readRawBody(req);
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

function getRazorpayAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing.");
  }

  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

function getAdminDb() {
  if (!admin.apps.length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      });
    } else {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (!projectId || !clientEmail || !privateKey) {
        throw new Error("Firebase Admin environment variables are missing.");
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }
  }

  return admin.firestore();
}

// Identity: the ONLY trustworthy answer to "who is calling". Verifies the caller's Firebase ID
// token (Authorization: Bearer <token>) — kept in sync with canteen-backend/index.js.
async function verifyAuth(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    if (!admin.apps.length) getAdminDb(); // ensure app initialized before auth calls
    return await admin.auth().verifyIdToken(match[1].trim());
  } catch (error) {
    console.error("ID token verification failed:", error.message);
    return null;
  }
}

function getCollectionForType(type) {
  return type === "meal_pass" || type === "subscription" ? PASS_COLLECTION : ORDER_COLLECTION;
}

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET is missing.");

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const received = Buffer.from(String(signature || ""));
  const expected = Buffer.from(expectedSignature);

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is missing.");

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const received = Buffer.from(String(signature || ""));
  const expected = Buffer.from(expectedSignature);

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function markDocumentPaid({ firebaseDocId, type, paymentId, orderId, signature, source }) {
  if (!firebaseDocId) return { updated: false };

  const db = getAdminDb();
  const collectionName = getCollectionForType(type);
  const update = {
    payment_status: "paid",
    razorpay_order_id: orderId || "",
    razorpay_payment_id: paymentId || "",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    payment_verified_by: source,
  };

  if (signature) update.razorpay_signature = signature;

  if (collectionName === PASS_COLLECTION) {
    update.status = "active";
    update.activated_at = admin.firestore.FieldValue.serverTimestamp();
  } else {
    update.status = "pending";
    update.paid_at = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection(collectionName).doc(firebaseDocId).set(update, { merge: true });

  // Non-PII mirror created ONLY at payment-verified time (kept in sync with
  // canteen-backend/index.js) so unpaid attempts never enter queue/demand aggregates.
  if (collectionName === ORDER_COLLECTION) {
    try {
      const snap = await db.collection(ORDER_COLLECTION).doc(firebaseDocId).get();
      if (snap.exists) {
        const data = snap.data();
        await db.collection("order_signals").doc(firebaseDocId).set({
          student_uid: data.student_uid || "",
          shop_name: data.shop_name || data.stallName || data.shop || "",
          status: data.status || "pending",
          created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
          item_ids: Array.isArray(data.items) ? data.items.map((item) => String(item?.id || "")).filter(Boolean) : [],
        }, { merge: true });
      }
    } catch (error) {
      console.error("order_signals mirror write failed:", error.message);
    }
  }

  return { updated: true, collection: collectionName };
}

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

// Amount + ownership + replay checks shared by the checkout verify path — kept in sync with
// canteen-backend/index.js's loadPaymentContext.
async function loadPaymentContext({ firebaseDocId, type, orderId, paymentId, callerUid }) {
  const collectionName = getCollectionForType(type);
  if (!firebaseDocId) return { ok: false, code: 400, error: "Missing firebase_doc_id." };

  let payment = null;
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: getRazorpayAuthHeader() },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Razorpay payments.fetch rejected:", data?.error || data);
      return { ok: false, code: 502, error: "Could not confirm the payment with Razorpay." };
    }
    payment = data;
  } catch (error) {
    console.error("Razorpay payments.fetch failed:", error);
    return { ok: false, code: 502, error: "Could not confirm the payment with Razorpay." };
  }

  if (!payment || payment.order_id !== orderId) {
    return { ok: false, code: 400, error: "Payment does not belong to this order." };
  }
  if (!["captured", "authorized"].includes(payment.status)) {
    return { ok: false, code: 402, error: `Payment is not settled (status: ${payment.status}).` };
  }

  const db = getAdminDb();
  const docSnap = await db.collection(collectionName).doc(firebaseDocId).get();
  if (!docSnap.exists) {
    return { ok: false, code: 404, error: "Order record not found for this payment." };
  }

  const data = docSnap.data();

  if (data.student_uid && callerUid && data.student_uid !== callerUid) {
    return { ok: false, code: 403, error: "This order belongs to a different account." };
  }

  const expectedPaise = Number.isFinite(Number(data.amount_expected_paise)) && data.amount_expected_paise != null
    ? Math.round(Number(data.amount_expected_paise))
    : Math.round(Number(collectionName === PASS_COLLECTION ? data.total_paid : data.price) * 100);
  if (!Number.isFinite(expectedPaise) || Number(payment.amount) !== expectedPaise) {
    console.error("Amount mismatch:", { firebaseDocId, expectedPaise, paid: payment.amount });
    return { ok: false, code: 402, error: "Paid amount does not match this order." };
  }

  if (data.payment_status === "paid" && data.razorpay_payment_id && data.razorpay_payment_id !== paymentId) {
    return { ok: false, code: 409, error: "This order is already confirmed by another payment." };
  }

  try {
    const dupes = await db.collection(collectionName)
      .where("razorpay_payment_id", "==", paymentId)
      .limit(2)
      .get();
    const foreignDupe = dupes.docs.find((docRef) => docRef.id !== firebaseDocId);
    if (foreignDupe) {
      console.error("Cross-document payment replay blocked:", {
        paymentId,
        requestedDoc: firebaseDocId,
        existingDoc: foreignDupe.id,
      });
      return { ok: false, code: 409, error: "This payment has already been applied to an order." };
    }
  } catch (error) {
    console.error("Replay lookup failed:", error.message);
    return { ok: false, code: 500, error: "Could not validate payment uniqueness. Please retry." };
  }

  return { ok: true };
}

async function handleCreateOrder(req, res) {
  // Requires a signed-in caller; the amount is anchored server-side to the Firestore document.
  const decoded = await verifyAuth(req);
  if (!decoded) {
    return res.status(401).json({ error: "Not signed in. Please sign in again." });
  }

  const body = await readJson(req);

  const firebaseDocId = String(body.orderId || "").trim();
  const type = String(body.type || "order");
  const collectionName = getCollectionForType(type);
  if (!firebaseDocId) {
    return res.status(400).json({ error: "Missing order reference." });
  }

  const db = getAdminDb();
  const docSnap = await db.collection(collectionName).doc(firebaseDocId).get();
  if (!docSnap.exists) {
    return res.status(404).json({ error: "Order record not found. Please start a new order." });
  }
  const docData = docSnap.data();

  if (docData.payment_status === "paid") {
    return res.status(409).json({ error: "This order is already paid." });
  }
  if (docData.student_uid && docData.student_uid !== decoded.uid) {
    return res.status(403).json({ error: "You can only pay for your own orders." });
  }

  let expectedPaise;
  if (collectionName === PASS_COLLECTION) {
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
  if (expectedPaise > 500000 * 100) {
    return res.status(400).json({ error: "Amount exceeds the maximum allowed for a single order." });
  }

  const receipt = firebaseDocId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-40);

  const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: getRazorpayAuthHeader(),
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
    return res.status(razorpayResponse.status).json({
      error: data.error?.description || data.error?.reason || "Razorpay order creation failed.",
    });
  }

  await db.collection(collectionName).doc(firebaseDocId).set({
    amount_expected_paise: expectedPaise,
    pricing_verified_at: admin.firestore.FieldValue.serverTimestamp(),
    razorpay_order_id: data.id,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return res.status(200).json({
    id: data.id,
    amount: data.amount,
    currency: data.currency,
    receipt: data.receipt,
  });
}

async function handleVerifyPayment(req, res) {
  const decoded = await verifyAuth(req);
  if (!decoded) {
    return res.status(401).json({ verified: false, error: "Not signed in. Please sign in again." });
  }

  const body = await readJson(req);
  const orderId = String(body.razorpay_order_id || "");
  const paymentId = String(body.razorpay_payment_id || "");
  const signature = String(body.razorpay_signature || "");

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: "Missing Razorpay verification fields." });
  }

  if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
    return res.status(400).json({ verified: false, error: "Payment signature did not match." });
  }

  const context = await loadPaymentContext({
    firebaseDocId: body.firebase_doc_id,
    type: body.type,
    orderId,
    paymentId,
    callerUid: decoded.uid,
  });
  if (!context.ok) {
    return res.status(context.code).json({ verified: false, error: context.error });
  }

  let updateResult = { updated: false, collection: null };
  let firestoreError = "";

  try {
    updateResult = await markDocumentPaid({
      firebaseDocId: body.firebase_doc_id,
      type: body.type,
      paymentId,
      orderId,
      signature,
      source: "checkout_handler",
    });
  } catch (error) {
    firestoreError = error.message || "Firestore Admin update failed.";
    console.error("Verified payment, but Firestore Admin update failed:", error);
  }

  return res.status(200).json({
    verified: true,
    firestore_updated: updateResult.updated,
    collection: updateResult.collection || null,
    firestore_error: firestoreError || null,
  });
}

async function handleWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const signature = req.headers["x-razorpay-signature"];

  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).send("Invalid signature");
  }

  const body = JSON.parse(rawBody || "{}");
  const event = body.event;
  const payment = body.payload?.payment?.entity;
  const order = body.payload?.order?.entity;
  const notes = payment?.notes || order?.notes || {};

  if (event === "payment.captured" || event === "order.paid") {
    const firebaseDocId = notes.firebase_doc_id || notes.order_id;
    if (firebaseDocId) {
      try {
        // Amount integrity for the fallback path too (kept in sync with canteen-backend).
        const collectionName = getCollectionForType(notes.type || "order");
        const docSnap = await getAdminDb().collection(collectionName).doc(String(firebaseDocId)).get();
        if (docSnap.exists) {
          const expectedPaise = Number(docSnap.data().amount_expected_paise);
          const paidPaise = Number(payment?.amount ?? order?.amount ?? NaN);
          if (Number.isFinite(expectedPaise) && Number.isFinite(paidPaise) && paidPaise !== expectedPaise) {
            console.error("Webhook amount mismatch — refusing to mark paid:", { firebaseDocId, expectedPaise, paidPaise });
            return res.status(200).send("Amount mismatch flagged");
          }
        }

        await markDocumentPaid({
          firebaseDocId,
          type: notes.type || "order",
          paymentId: payment?.id || "",
          orderId: payment?.order_id || order?.id || "",
          source: "razorpay_webhook",
        });
      } catch (error) {
        console.error("Webhook Firestore update failed:", error.message);
      }
    }
  }

  return res.status(200).send("ok");
}

module.exports = async function handler(req, res) {
  if (!setCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();

  const pathname = new URL(req.url, "https://index-js.vercel.app").pathname;

  try {
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        service: "christ-canteen-payments",
        routes: ["/create-order", "/verify-payment", "/webhook"],
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed." });
    }

    if (pathname === "/create-order") return await handleCreateOrder(req, res);
    if (pathname === "/verify-payment") return await handleVerifyPayment(req, res);
    if (pathname === "/webhook") return await handleWebhook(req, res);

    return res.status(404).json({ error: "Route not found." });
  } catch (error) {
    console.error("Payment API error:", error);
    return res.status(500).json({ error: error.message || "Payment API failed." });
  }
};
