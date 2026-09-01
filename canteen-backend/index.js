const express = require('express');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// CORS: when ALLOWED_ORIGINS is configured, only those origins may call this API. When it is
// not set we keep the historical allow-all behavior so the existing cross-origin frontend
// deployment keeps working — auth is enforced per-request via Bearer ID tokens (never cookies),
// so an unauthenticated CORS policy is a convenience guard, not the security boundary.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length > 0) {
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ error: 'Origin is not allowed.' });
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Capture the exact bytes Razorpay signed so webhook HMAC verification is done over the raw
// payload instead of a re-serialized object (key order/whitespace differences would break it).
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ─── Best-effort in-memory rate limiting ─────────────────────────────────────
// Serverless instances are short-lived, so this is a per-instance brake (raises the bar against
// brute-force/spam bursts) rather than a global quota — a persistent store would be needed for
// that. Applied only to sensitive/expensive routes.
const rateBuckets = new Map();

function rateLimit({ windowMs, max, key }) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  // Opportunistic cleanup so the map can't grow without bound.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (now > v.resetAt) rateBuckets.delete(k);
    }
  }
  return bucket.count <= max;
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function limited(req, res, { windowMs, max, scope }) {
  if (rateLimit({ windowMs, max, key: `${scope}:${clientKey(req)}` })) return false;
  res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
  return true;
}

// 1. Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
});

const db = admin.firestore();

// 2. Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const ORDER_COLLECTION = 'orders';
const PASS_COLLECTION = 'subscriptions';
// The one initial admin account. Further admins are added from inside the panel itself
// (POST /admin-set-role), by this account — this fixed check only covers first-time bootstrap.
const BOOTSTRAP_ADMIN_EMAIL = 'aadi.r.santhosh2006@gmail.com';
const VALID_ROLES = ['student', 'staff', 'faculty_admin', 'admin'];
const VALID_STALLS = ['Falcon Veg', 'Fresheteria', 'Mingos', 'Break Time', 'Surf & Turf', 'Bakery'];
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CODE_ATTEMPTS = 5;

function getCollectionForType(type) {
  return type === 'meal_pass' || type === 'subscription' ? PASS_COLLECTION : ORDER_COLLECTION;
}

// ─── Server-side cart pricing ────────────────────────────────────────────────
// A client-declared `price` on the Firestore order doc is NOT trustworthy (any signed-in user
// can write their own order doc). The authoritative amount is therefore recomputed from the
// products catalog at create-order time and stamped onto the document as
// amount_expected_paise; /verify-payment then only accepts payments matching THAT value.
// effectiveUnitPrice mirrors the frontend's applySpecialPricing() exactly so a legitimate
// client's total always agrees with the recomputation.
function effectiveUnitPrice(product) {
  const basePrice = Number(product?.price || 0);
  const discountPercent = product?.isSpecial ? Number(product.specialDiscountPercent || 0) : 0;
  return discountPercent > 0 ? Math.round(basePrice * (1 - discountPercent / 100)) : basePrice;
}

async function computeOrderTotalFromCatalog(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Order items are required.' };
  }
  let totalRupees = 0;
  for (const item of items.slice(0, 100)) {
    const productId = String(item?.id || '');
    const quantity = Math.floor(Number(item?.quantity));
    if (!productId || !Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
      return { ok: false, error: 'Invalid cart item.' };
    }
    let productSnap;
    try {
      productSnap = await db.collection('products').doc(productId).get();
    } catch (error) {
      console.error('Product lookup failed during pricing:', error.message);
      return { ok: false, error: 'Could not look up menu prices. Please try again.' };
    }
    if (!productSnap.exists || productSnap.data()?.available === false) {
      return { ok: false, error: 'An item in your cart is no longer available. Please review your cart.' };
    }
    totalRupees += effectiveUnitPrice(productSnap.data()) * quantity;
  }
  return { ok: true, paise: Math.round(totalRupees * 100), rupees: totalRupees };
}

// The only path that may set payment_status/status to "paid" — Firestore rules forbid clients
// from writing it themselves. Called after checkout-side signature verification below.
async function markDocumentPaid({ firebaseDocId, type, paymentId, orderId, signature, source }) {
  if (!firebaseDocId) return { updated: false };

  const collectionName = getCollectionForType(type);
  const update = {
    payment_status: 'paid',
    razorpay_order_id: orderId || '',
    razorpay_payment_id: paymentId || '',
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    payment_verified_by: source,
  };

  if (signature) update.razorpay_signature = signature;

  if (collectionName === PASS_COLLECTION) {
    update.status = 'active';
    update.activated_at = admin.firestore.FieldValue.serverTimestamp();
  } else {
    update.paid_at = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection(collectionName).doc(firebaseDocId).set(update, { merge: true });

  // The non-PII order_signals mirror is created ONLY now — at payment-verified time. Checkout
  // attempts that never complete must never pollute the queue-depth/demand-forecast aggregates
  // (previously the client wrote this mirror before Razorpay even opened).
  if (collectionName === ORDER_COLLECTION) {
    try {
      const snap = await db.collection(ORDER_COLLECTION).doc(firebaseDocId).get();
      if (snap.exists) {
        const data = snap.data();
        await db.collection('order_signals').doc(firebaseDocId).set({
          student_uid: data.student_uid || '',
          shop_name: data.shop_name || data.stallName || data.shop || '',
          status: data.status || 'pending',
          created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
          item_ids: Array.isArray(data.items) ? data.items.map((item) => String(item?.id || '')).filter(Boolean) : [],
        }, { merge: true });
      }
    } catch (error) {
      // Non-fatal: the paid order itself is already recorded.
      console.error('order_signals mirror write failed:', error.message);
    }
  }

  return { updated: true, collection: collectionName };
}

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const received = Buffer.from(String(signature || ''));
  const expected = Buffer.from(expectedSignature);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function requireAdmin(requesterUid) {
  const requesterSnap = await db.collection('users').doc(requesterUid).get();
  return requesterSnap.exists && requesterSnap.data()?.role === 'admin';
}

// ─── Identity: the ONLY trustworthy answer to "who is calling". Verifies the caller's Firebase
// ID token (sent as `Authorization: Bearer <token>`) and returns its decoded claims, or null if
// the token is missing/invalid/expired. Privileged routes MUST derive uid/email from this and
// never from the request body — the body is entirely client-controlled, so trusting it allowed
// anyone to pass someone else's uid/email and be treated as that person.
async function verifyAuth(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await admin.auth().verifyIdToken(match[1].trim());
  } catch (error) {
    console.error('ID token verification failed:', error.message);
    return null;
  }
}

// ROUTE 1: Home Route
app.get('/', (req, res) => {
  res.send('Christ Canteen Server is Online 🚀');
});

// ROUTE 2: Create Order — opens a Razorpay order for a Firestore order/pass the caller already
// created. Requires a signed-in caller. The Razorpay amount is NEVER taken from the request
// body: it is recomputed server-side (catalog prices for orders, stored total_paid for meal
// passes) and stamped onto the Firestore document as amount_expected_paise — the only value
// /verify-payment will later accept.
const MAX_ORDER_AMOUNT_INR = 500000; // sanity cap for bulk orders; well above any real cart

app.post('/create-order', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 60_000, max: 30, scope: 'create-order' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Not signed in. Please sign in again.' });
    }

    const firebaseDocId = String(req.body.orderId || '').trim();
    const type = String(req.body.type || 'order');
    const collectionName = getCollectionForType(type);

    if (!firebaseDocId) {
      return res.status(400).json({ error: 'Missing order reference.' });
    }

    let docSnap;
    try {
      docSnap = await db.collection(collectionName).doc(firebaseDocId).get();
    } catch (error) {
      console.error('Firestore read failed during create-order:', error);
      return res.status(500).json({ error: 'Could not look up your order. Please try again.' });
    }
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Order record not found. Please start a new order.' });
    }
    const docData = docSnap.data();

    // Idempotency: an already-paid record must never open a second Razorpay session.
    if (docData.payment_status === 'paid') {
      return res.status(409).json({ error: 'This order is already paid.' });
    }

    // Ownership: only the document's own student may open a payment session for it.
    if (docData.student_uid && docData.student_uid !== decoded.uid) {
      return res.status(403).json({ error: 'You can only pay for your own orders.' });
    }

    let expectedPaise;
    if (collectionName === PASS_COLLECTION) {
      expectedPaise = Math.round(Number(docData.total_paid) * 100);
    } else {
      // Recompute from the live catalog and require agreement with what the client displayed.
      const priced = await computeOrderTotalFromCatalog(req.body.items);
      if (!priced.ok) {
        return res.status(400).json({ error: priced.error });
      }
      const declaredPaise = Math.round(Number(docData.price) * 100);
      if (!Number.isFinite(declaredPaise) || declaredPaise !== priced.paise) {
        return res.status(400).json({
          error: 'Cart total does not match current menu prices. Please review your cart and try again.',
        });
      }
      expectedPaise = priced.paise;
    }

    if (!Number.isFinite(expectedPaise) || expectedPaise < 100) {
      return res.status(400).json({ error: 'Amount must be at least INR 1.' });
    }
    if (expectedPaise > MAX_ORDER_AMOUNT_INR * 100) {
      return res.status(400).json({ error: 'Amount exceeds the maximum allowed for a single order.' });
    }

    const receipt = firebaseDocId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-40);

    const order = await razorpay.orders.create({
      amount: expectedPaise,
      currency: 'INR',
      receipt,
      notes: {
        firebase_doc_id: firebaseDocId,
        type,
      },
    });

    // Stamp the authoritative expectation + razorpay order id via the Admin SDK. Clients can
    // never write these fields (Firestore rules reject them on create/update), so they are a
    // trustworthy anchor for /verify-payment and webhook reconciliation.
    await db.collection(collectionName).doc(firebaseDocId).set({
      amount_expected_paise: expectedPaise,
      pricing_verified_at: admin.firestore.FieldValue.serverTimestamp(),
      razorpay_order_id: order.id,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (error) {
    console.error('Order Creation Error:', error);
    res.status(500).json({ error: 'Could not initiate the payment. Please try again.' });
  }
});

// The checkout signature only proves "this pair of ids was signed by Razorpay" — it does NOT
// prove the right Firestore document got paid the right amount. Before marking anything paid we
// re-fetch the payment from Razorpay's API (server-to-server, authenticated) and assert:
//   1. payment.order_id matches the claimed razorpay_order_id (blocks replaying one payment's
//      signature triple against a different document),
//   2. the money actually settled (status captured/authorized),
//   3. the paid paise equal the SERVER-STAMPED amount_expected_paise (falling back to the doc's
//      own stored total for records created before that stamp existed),
//   4. the caller owns the document (blocks verifying/paying for someone else's order),
//   5. no OTHER document has already been confirmed by this same payment id (cross-doc replay).
async function loadPaymentContext({ firebaseDocId, type, orderId, paymentId, callerUid }) {
  const collectionName = getCollectionForType(type);
  if (!firebaseDocId) {
    return { ok: false, code: 400, error: 'Missing firebase_doc_id.' };
  }

  let payment;
  try {
    payment = await razorpay.payments.fetch(paymentId);
  } catch (error) {
    console.error('Razorpay payments.fetch failed:', error?.message || error);
    return { ok: false, code: 502, error: 'Could not confirm the payment with Razorpay.' };
  }

  if (!payment || payment.order_id !== orderId) {
    return { ok: false, code: 400, error: 'Payment does not belong to this order.' };
  }
  if (!['captured', 'authorized'].includes(payment.status)) {
    return { ok: false, code: 402, error: `Payment is not settled (status: ${payment.status}).` };
  }

  let docSnap;
  try {
    docSnap = await db.collection(collectionName).doc(firebaseDocId).get();
  } catch (error) {
    console.error('Firestore read failed during verification:', error);
    return { ok: false, code: 500, error: 'Could not look up the order to verify.' };
  }
  if (!docSnap.exists) {
    return { ok: false, code: 404, error: 'Order record not found for this payment.' };
  }

  const data = docSnap.data();

  // Ownership: a signed-in caller may only verify their own order/pass.
  if (data.student_uid && callerUid && data.student_uid !== callerUid) {
    return { ok: false, code: 403, error: 'This order belongs to a different account.' };
  }

  // Amount integrity: prefer the Admin-SDK-stamped expectation; legacy pending docs (created
  // before amount_expected_paise existed) fall back to their own stored total.
  const expectedPaise = Number.isFinite(Number(data.amount_expected_paise)) && data.amount_expected_paise != null
    ? Math.round(Number(data.amount_expected_paise))
    : Math.round(Number(collectionName === PASS_COLLECTION ? data.total_paid : data.price) * 100);
  if (!Number.isFinite(expectedPaise) || Number(payment.amount) !== expectedPaise) {
    console.error('Amount mismatch:', { firebaseDocId, expectedPaise, paid: payment.amount });
    return { ok: false, code: 402, error: 'Paid amount does not match this order.' };
  }

  // Replay/idempotency guard (same document): an already-paid document may only be re-confirmed
  // by the SAME payment (e.g. a retried verify call), never by a second/different one.
  if (data.payment_status === 'paid' && data.razorpay_payment_id && data.razorpay_payment_id !== paymentId) {
    return { ok: false, code: 409, error: 'This order is already confirmed by another payment.' };
  }

  // Replay/idempotency guard (cross document): one Razorpay payment must never be able to
  // activate two cafeteria orders — e.g. a user re-checking-out after a network blip.
  try {
    const dupes = await db.collection(collectionName)
      .where('razorpay_payment_id', '==', paymentId)
      .limit(2)
      .get();
    const foreignDupe = dupes.docs.find((docRef) => docRef.id !== firebaseDocId);
    if (foreignDupe) {
      console.error('Cross-document payment replay blocked:', {
        paymentId,
        requestedDoc: firebaseDocId,
        existingDoc: foreignDupe.id,
      });
      return { ok: false, code: 409, error: 'This payment has already been applied to an order.' };
    }
  } catch (error) {
    console.error('Replay lookup failed:', error.message);
    // Fail closed — without the uniqueness check we refuse to mark paid.
    return { ok: false, code: 500, error: 'Could not validate payment uniqueness. Please retry.' };
  }

  return { ok: true, collectionName };
}

// ROUTE 3: Verify Payment (checkout handler) — signs off the Razorpay checkout signature and
// writes payment_status/status via the Admin SDK. Requires the caller's Firebase ID token so
// verification is bound to the paying account, not to whoever holds the payload.
app.post('/verify-payment', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 60_000, max: 60, scope: 'verify-payment' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ verified: false, error: 'Not signed in. Please sign in again.' });
    }

    const orderId = String(req.body.razorpay_order_id || '');
    const paymentId = String(req.body.razorpay_payment_id || '');
    const signature = String(req.body.razorpay_signature || '');

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'Missing Razorpay verification fields.' });
    }

    if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ verified: false, error: 'Payment signature did not match.' });
    }

    const context = await loadPaymentContext({
      firebaseDocId: req.body.firebase_doc_id,
      type: req.body.type,
      orderId,
      paymentId,
      callerUid: decoded.uid,
    });
    if (!context.ok) {
      return res.status(context.code).json({ verified: false, error: context.error });
    }

    let updateResult = { updated: false, collection: null };
    let firestoreError = '';

    try {
      updateResult = await markDocumentPaid({
        firebaseDocId: req.body.firebase_doc_id,
        type: req.body.type,
        paymentId,
        orderId,
        signature,
        source: 'checkout_handler',
      });
    } catch (error) {
      firestoreError = 'Firestore update failed.';
      console.error('Verified payment, but Firestore Admin update failed:', error);
    }

    res.status(200).json({
      verified: true,
      firestore_updated: updateResult.updated,
      collection: updateResult.collection || null,
      firestore_error: firestoreError || null,
    });
  } catch (error) {
    console.error('Verify Payment Error:', error);
    res.status(500).json({ error: 'Payment verification failed. Please try again.' });
  }
});

// ROUTE 4: Webhook — defense-in-depth confirmation if the browser closed before
// /verify-payment ran. HMAC is verified over the RAW request bytes (captured by the express.json
// verify hook) with a timing-safe comparison, and meal-pass payments are written to their own
// collection instead of polluting `orders`.
app.post('/webhook', async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];

  if (!secret || !signature || !req.rawBody) {
    console.error('Webhook missing secret, signature, or raw body');
    return res.status(400).send('Configuration Error');
  }

  try {
    const expectedSignature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const received = Buffer.from(String(signature));
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      console.error('Webhook signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body;
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = payload?.payment?.entity;
      const orderEntity = payload?.order?.entity;
      const notes = payment?.notes || orderEntity?.notes || {};
      const firebaseDocId = notes.firebase_doc_id || notes.order_id;

      if (firebaseDocId) {
        try {
          // Amount integrity for the fallback path too: when the doc carries a server-stamped
          // expectation, a webhook whose paid amount disagrees must NOT mark it paid.
          const collectionName = getCollectionForType(notes.type || 'order');
          const docSnap = await db.collection(collectionName).doc(String(firebaseDocId)).get();
          if (docSnap.exists) {
            const expectedPaise = Number(docSnap.data().amount_expected_paise);
            const paidPaise = Number(payment?.amount ?? orderEntity?.amount ?? NaN);
            if (Number.isFinite(expectedPaise) && Number.isFinite(paidPaise) && paidPaise !== expectedPaise) {
              console.error('Webhook amount mismatch — refusing to mark paid:', {
                firebaseDocId, expectedPaise, paidPaise,
              });
              return res.status(200).send('Amount mismatch flagged');
            }
          }

          await markDocumentPaid({
            firebaseDocId,
            type: notes.type || 'order',
            paymentId: payment?.id || '',
            orderId: payment?.order_id || orderEntity?.id || '',
            source: 'razorpay_webhook',
          });
        } catch (dbError) {
          console.error('Webhook Firestore update failed:', dbError.message);
          // Acknowledge anyway so Razorpay stops retrying a permanently-broken update.
          return res.status(200).send('Database Error but acknowledged');
        }
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Global Webhook Error:', err.message);
    res.status(200).send('Caught Error'); // Forcing 200 to see logs without 500 status
  }
});

// ROUTE 5: Send staff verification code — which stall (if any) is resolved server-side from
// stall_email_registry; the client never picks one. Blocks entirely if the email isn't
// registered, or if its stall is already occupied by someone else. Identity comes from the
// verified ID token — the emailed code always goes to the Google account that actually signed in.
app.post('/send-staff-verification-code', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 10 * 60_000, max: 5, scope: 'send-staff-code' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Not signed in. Please sign in again.' });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return res.status(500).json({ error: 'Email service is not configured.' });
    }

    const uid = decoded.uid;
    const email = String(decoded.email || '').trim().toLowerCase();
    if (!email || decoded.email_verified === false) {
      return res.status(403).json({ error: 'Your account needs a verified email address.' });
    }

    const registrySnap = await db.collection('stall_email_registry').where('email', '==', email).limit(1).get();
    if (registrySnap.empty) {
      return res.status(403).json({ error: 'This email is not registered to any stall. Contact the admin to be assigned one.' });
    }

    const stall = registrySnap.docs[0].id;

    const sessionSnap = await db.collection('stall_sessions').doc(stall).get();
    if (sessionSnap.exists && sessionSnap.data()?.uid !== uid) {
      return res.status(409).json({ error: `${stall} is currently in use by another staff member. Contact the admin to release it.` });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();

    try {
      await db.collection('staff_verification_codes').doc(uid).set({
        code, stall, email, createdAt: now, expiresAt: now + CODE_TTL_MS, attempts: 0,
      });
    } catch (error) {
      console.error('Failed to store verification code:', error);
      return res.status(500).json({ error: 'Could not generate a verification code. Please try again.' });
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'Christ University Cafeteria <onboarding@resend.dev>',
        to: [email],
        subject: `Your ${stall} kitchen terminal code`,
        html: `<p>Your verification code for the <strong>${stall}</strong> kitchen terminal is:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      console.error('Resend send failed:', errorData);
      return res.status(502).json({ error: 'Could not send the verification email.' });
    }

    res.status(200).json({ sent: true, stall });
  } catch (error) {
    console.error('Send Staff Verification Code Error:', error);
    res.status(500).json({ error: 'Could not send the verification code. Please try again.' });
  }
});

// ROUTE 6: Verify staff verification code — the stall is read back from the code record the
// send-step already resolved, never trusted from the client, so there's no way to request a code
// for one stall and claim a different one at verify time. The uid being verified is derived from
// the caller's own ID token, so one account can never submit guesses against another account's
// code record.
app.post('/verify-staff-verification-code', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 60_000, max: 20, scope: 'verify-staff-code' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ verified: false, error: 'Not signed in. Please sign in again.' });
    }

    const uid = decoded.uid;
    const submittedCode = String(req.body.code || '').trim();
    const email = String(decoded.email || '').trim().toLowerCase();
    const displayName = String(decoded.name || '');

    if (!submittedCode) {
      return res.status(400).json({ verified: false, error: 'Missing verification code.' });
    }

    const codeRef = db.collection('staff_verification_codes').doc(uid);
    const codeSnap = await codeRef.get();

    if (!codeSnap.exists) {
      return res.status(400).json({ verified: false, error: 'No pending verification code. Please request a new one.' });
    }

    const record = codeSnap.data();
    const stall = record.stall;

    if (Date.now() > record.expiresAt) {
      await codeRef.delete().catch(() => {});
      return res.status(400).json({ verified: false, error: 'This code has expired. Please request a new one.' });
    }

    if ((record.attempts || 0) >= MAX_CODE_ATTEMPTS) {
      await codeRef.delete().catch(() => {});
      return res.status(429).json({ verified: false, error: 'Too many incorrect attempts. Please request a new code.' });
    }

    if (record.code !== submittedCode) {
      await codeRef.update({ attempts: admin.firestore.FieldValue.increment(1) }).catch(() => {});
      return res.status(400).json({ verified: false, error: 'Incorrect code.' });
    }

    const sessionRef = db.collection('stall_sessions').doc(stall);
    const sessionSnap = await sessionRef.get();
    if (sessionSnap.exists && sessionSnap.data()?.uid !== uid) {
      return res.status(409).json({ verified: false, error: `${stall} is currently in use by another staff member. Contact the admin to release it.` });
    }

    await sessionRef.set({ uid, email, displayName, loginAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection('users').doc(uid).set({
      role: 'staff', assignedStall: stall, email, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await codeRef.delete();

    res.status(200).json({ verified: true, stall });
  } catch (error) {
    console.error('Verify Staff Verification Code Error:', error);
    res.status(500).json({ verified: false, error: 'Verification failed. Please try again.' });
  }
});

// ROUTE 7: Claim admin seat — grants admin to the single fixed bootstrap account.
//
// Identity comes from the verified Firebase ID token, NEVER the request body. The previous
// version read uid/email straight out of req.body, so anyone could POST their own uid together
// with the (publicly known) bootstrap email and have role:"admin" written onto their own
// account — a one-request full takeover of the Admin Panel. Now the email is whatever Google
// actually authenticated, so only a real sign-in as the bootstrap account can claim the seat.
//
// Every other account is turned away unless that admin has since promoted them from inside the
// panel (POST /admin-set-role).
app.post('/claim-admin-seat', async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ granted: false, error: 'Not signed in. Please sign in again.' });
    }

    const uid = decoded.uid;
    const email = String(decoded.email || '').trim().toLowerCase();
    const displayName = String(decoded.name || req.body.displayName || '');

    if (!email || decoded.email_verified === false) {
      return res.status(403).json({ granted: false, error: 'Your account needs a verified email address.' });
    }

    if (email !== BOOTSTRAP_ADMIN_EMAIL) {
      return res.status(403).json({ granted: false, error: 'This account is not authorized for admin access.' });
    }

    await db.collection('users').doc(uid).set({
      role: 'admin', email, displayName, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ granted: true });
  } catch (error) {
    console.error('Admin seat claim failed:', error);
    res.status(500).json({ granted: false, error: 'Could not process the admin claim. Please try again.' });
  }
});

// ROUTE 8: Admin set role — verifies the caller is an admin server-side. The acting admin is
// derived from the caller's verified ID token (never the body — a client-supplied requesterUid
// let anyone pass a real admin's uid and grant themselves any role). Assigning anything other
// than "staff" clears assignedStall and releases any stall_sessions lock the target currently
// holds, so a demoted/reassigned account can never keep squatting on a stall.
app.post('/admin-set-role', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 60_000, max: 30, scope: 'admin-set-role' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Not signed in. Please sign in again.' });
    }
    const requesterUid = decoded.uid;

    const targetUid = String(req.body.targetUid || '');
    const role = String(req.body.role || '');
    const assignedStallInput = req.body.assignedStall != null ? String(req.body.assignedStall) : null;

    if (!targetUid || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Missing or invalid targetUid or role.' });
    }
    if (role === 'staff' && assignedStallInput && !VALID_STALLS.includes(assignedStallInput)) {
      return res.status(400).json({ error: 'Invalid stall name.' });
    }

    if (!(await requireAdmin(requesterUid))) {
      return res.status(403).json({ error: 'Only an admin may change user roles.' });
    }

    const finalAssignedStall = role === 'staff' ? assignedStallInput || null : null;

    await db.collection('users').doc(targetUid).set({
      role, assignedStall: finalAssignedStall, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const heldSessions = await db.collection('stall_sessions').where('uid', '==', targetUid).get();
    await Promise.all(
      heldSessions.docs.filter((doc) => doc.id !== finalAssignedStall).map((doc) => doc.ref.delete())
    );

    res.status(200).json({ updated: true });
  } catch (error) {
    console.error('Failed to update user role:', error);
    res.status(500).json({ error: 'Could not update the user. Please try again.' });
  }
});

// ROUTE 9: Admin approve/deny logout — verifies the caller is actually an admin server-side
// (identity from the verified ID token, never the body). On approval, releases the stall_sessions
// lock in the same operation, so the staff member's own client (watching its own
// logout_requests/{uid} doc) can auto-sign-out the instant this commits.
app.post('/admin-approve-logout', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 60_000, max: 30, scope: 'admin-approve-logout' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Not signed in. Please sign in again.' });
    }
    const requesterUid = decoded.uid;

    const targetUid = String(req.body.targetUid || '');
    const stall = String(req.body.stall || '');
    const approve = Boolean(req.body.approve);

    if (!targetUid || !stall) {
      return res.status(400).json({ error: 'Missing targetUid or stall.' });
    }

    if (!(await requireAdmin(requesterUid))) {
      return res.status(403).json({ error: 'Only an admin may resolve logout requests.' });
    }

    const requestRef = db.collection('logout_requests').doc(targetUid);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      return res.status(404).json({ error: 'No pending logout request for this staff member.' });
    }

    await requestRef.update({
      status: approve ? 'approved' : 'denied',
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolvedBy: requesterUid,
    });

    if (approve) {
      await db.collection('stall_sessions').doc(stall).delete();
    }

    res.status(200).json({ resolved: true, approved: approve });
  } catch (error) {
    console.error('Failed to resolve logout request:', error);
    res.status(500).json({ error: 'Could not resolve the logout request. Please try again.' });
  }
});

// ROUTE 10: Staff login (no OTP) — resolves the stall from stall_email_registry by the signed-in
// email, claims the single-occupancy lock, and grants role:staff + assignedStall in one step.
// Identity comes exclusively from the verified Firebase ID token: the email that decides which
// stall (if any) opens is whatever Google actually authenticated — never a body field. The
// previous version trusted req.body.uid/email, which let anyone become staff for any registered
// stall with a single forged POST.
app.post('/staff-login', async (req, res) => {
  try {
    if (limited(req, res, { windowMs: 60_000, max: 10, scope: 'staff-login' })) return;

    const decoded = await verifyAuth(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Not signed in. Please sign in again.' });
    }

    const uid = decoded.uid;
    const email = String(decoded.email || '').trim().toLowerCase();
    const displayName = String(decoded.name || '');

    if (!email || decoded.email_verified === false) {
      return res.status(403).json({ error: 'Your account needs a verified email address.' });
    }

    const registrySnap = await db.collection('stall_email_registry').where('email', '==', email).limit(1).get();
    if (registrySnap.empty) {
      return res.status(403).json({ error: 'This email is not registered to any stall. Contact the admin to be assigned one.' });
    }

    const stall = registrySnap.docs[0].id;

    const sessionRef = db.collection('stall_sessions').doc(stall);
    const sessionSnap = await sessionRef.get();
    if (sessionSnap.exists && sessionSnap.data()?.uid !== uid) {
      return res.status(409).json({ error: `${stall} is currently in use by another staff member. Contact the admin to release it.` });
    }

    await sessionRef.set({ uid, email, displayName, loginAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection('users').doc(uid).set({
      role: 'staff', assignedStall: stall, email, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ stall });
  } catch (error) {
    console.error('Staff Login Error:', error);
    res.status(500).json({ error: 'Could not sign in to the stall. Please try again.' });
  }
});

module.exports = app;