import crypto from "node:crypto";
import { getAdminAuth, getAdminDb, markDocumentPaid } from "./_firebaseAdmin.js";

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

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getCollectionForType(type) {
  return type === "meal_pass" || type === "subscription" ? "subscriptions" : "orders";
}

// The checkout signature only proves "this id pair was signed by Razorpay" — it does NOT prove
// the right Firestore document got paid the right amount. Before marking anything paid we
// re-fetch the payment from Razorpay's API (server-to-server) and assert:
//   1. payment.order_id matches the claimed razorpay_order_id (blocks replaying one payment's
//      signature triple against a different document),
//   2. the money actually settled (status captured/authorized),
//   3. the paid paise equal the SERVER-STAMPED amount_expected_paise (falling back to the
//      document's stored total for records created before that stamp existed),
//   4. the caller owns the document,
//   5. no OTHER document has already been confirmed by this same payment id (cross-doc replay).
async function loadPaymentContext({ db, firebaseDocId, type, orderId, paymentId, keyId, keySecret, callerUid }) {
  if (!firebaseDocId) return { ok: false, code: 400, error: "Missing firebase_doc_id." };

  const collectionName = getCollectionForType(type);

  let payment = null;
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
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

  let docSnap;
  try {
    docSnap = await db.collection(collectionName).doc(firebaseDocId).get();
  } catch (error) {
    console.error("Firestore read failed during verification:", error);
    return { ok: false, code: 500, error: "Could not look up the order to verify." };
  }
  if (!docSnap.exists) {
    return { ok: false, code: 404, error: "Order record not found for this payment." };
  }

  const data = docSnap.data();

  // Ownership: a signed-in caller may only verify their own order/pass.
  if (data.student_uid && callerUid && data.student_uid !== callerUid) {
    return { ok: false, code: 403, error: "This order belongs to a different account." };
  }

  // Amount integrity: prefer the Admin-SDK-stamped expectation; fall back to legacy fields.
  const expectedPaise = Number.isFinite(Number(data.amount_expected_paise)) && data.amount_expected_paise != null
    ? Math.round(Number(data.amount_expected_paise))
    : Math.round(Number(collectionName === "subscriptions" ? data.total_paid : data.price) * 100);
  if (!Number.isFinite(expectedPaise) || Number(payment.amount) !== expectedPaise) {
    console.error("Amount mismatch:", { firebaseDocId, expectedPaise, paid: payment.amount });
    return { ok: false, code: 402, error: "Paid amount does not match this order." };
  }

  // Replay/idempotency guard (same document): an already-paid document may only be re-confirmed
  // by the SAME payment (e.g. a retried verify call), never by a second/different one.
  if (data.payment_status === "paid" && data.razorpay_payment_id && data.razorpay_payment_id !== paymentId) {
    return { ok: false, code: 409, error: "This order is already confirmed by another payment." };
  }

  // Replay/idempotency guard (cross document): one Razorpay payment must never activate two
  // cafeteria orders — kept in sync with canteen-backend/index.js.
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

  // Verification is bound to the paying account: the caller must present a valid Firebase ID
  // token (kept in sync with canteen-backend/index.js).
  let decoded = null;
  try {
    const header = String(req.headers.authorization || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) {
      decoded = await getAdminAuth().verifyIdToken(match[1].trim());
    }
  } catch (error) {
    console.error("ID token verification failed:", error.message);
    return res.status(401).json({ verified: false, error: "Not signed in. Please sign in again." });
  }
  if (!decoded) {
    return res.status(401).json({ verified: false, error: "Not signed in. Please sign in again." });
  }

  const orderId = String(body.razorpay_order_id || "");
  const paymentId = String(body.razorpay_payment_id || "");
  const signature = String(body.razorpay_signature || "");

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: "Missing Razorpay verification fields." });
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const verified = timingSafeEqualText(expectedSignature, signature);

  if (!verified) {
    return res.status(400).json({ verified: false, error: "Payment signature did not match." });
  }

  let context;
  try {
    context = await loadPaymentContext({
      db: getAdminDb(),
      firebaseDocId: body.firebase_doc_id,
      type: body.type,
      orderId,
      paymentId,
      keyId,
      keySecret,
      callerUid: decoded.uid,
    });
  } catch (error) {
    console.error("Payment context check failed:", error);
    return res.status(500).json({ verified: false, error: "Could not verify the payment. Please try again." });
  }
  if (!context.ok) {
    return res.status(context.code).json({ verified: false, error: context.error });
  }

  // This is the only place a client-triggered request may cause payment_status to become "paid" —
  // it uses the Admin SDK, which bypasses Firestore rules that otherwise forbid clients from
  // writing that field directly. If this write fails, we still report verified:true (the payment
  // itself did succeed) but flag firestore_updated:false so the client can surface a "processing"
  // message instead of pretending the order is confirmed.
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
    firestoreError = "Firestore update failed.";
    console.error("Verified payment, but Firestore Admin update failed:", error);
  }

  return res.status(200).json({
    verified: true,
    firestore_updated: updateResult.updated,
    collection: updateResult.collection || null,
    firestore_error: firestoreError || null,
  });
}
