import crypto from "node:crypto";
import { getAdminDb, markDocumentPaid } from "./_firebaseAdmin.js";

// Defense-in-depth: if a client's browser closes/crashes right after Razorpay checkout succeeds
// but before it calls /verify-payment, this webhook is the only remaining path that confirms the
// payment server-side. Configure this URL in the Razorpay Dashboard (Webhooks) with a secret,
// and set that same secret as RAZORPAY_WEBHOOK_SECRET here.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const receivedBuf = Buffer.from(String(signature || ""));
  const expectedBuf = Buffer.from(expected);
  return receivedBuf.length === expectedBuf.length && crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: "RAZORPAY_WEBHOOK_SECRET is missing." });

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-razorpay-signature"];

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return res.status(400).send("Invalid signature");
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return res.status(400).send("Invalid JSON body");
  }

  const event = body.event;
  const payment = body.payload?.payment?.entity;
  const order = body.payload?.order?.entity;
  const notes = payment?.notes || order?.notes || {};

  if (event === "payment.captured" || event === "order.paid") {
    try {
      // Amount integrity for the fallback path too (kept in sync with canteen-backend): when
      // the doc carries a server-stamped expectation, a webhook whose paid amount disagrees
      // must NOT mark it paid.
      const collectionName = notes.type === "meal_pass" || notes.type === "subscription" ? "subscriptions" : "orders";
      const docId = notes.firebase_doc_id || notes.order_id;
      if (docId) {
        const docSnap = await getAdminDb().collection(collectionName).doc(String(docId)).get();
        if (docSnap.exists) {
          const expectedPaise = Number(docSnap.data().amount_expected_paise);
          const paidPaise = Number(payment?.amount ?? order?.amount ?? NaN);
          if (Number.isFinite(expectedPaise) && Number.isFinite(paidPaise) && paidPaise !== expectedPaise) {
            console.error("Webhook amount mismatch — refusing to mark paid:", { docId, expectedPaise, paidPaise });
            return res.status(200).send("Amount mismatch flagged");
          }
        }
      }

      await markDocumentPaid({
        firebaseDocId: docId,
        type: notes.type || "order",
        paymentId: payment?.id || "",
        orderId: payment?.order_id || order?.id || "",
        source: "razorpay_webhook",
      });
    } catch (error) {
      console.error("Webhook Firestore update failed:", error);
    }
  }

  return res.status(200).send("ok");
}
