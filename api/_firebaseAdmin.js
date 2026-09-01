import admin from "firebase-admin";

const ORDER_COLLECTION = "orders";
const PASS_COLLECTION = "subscriptions";

export function getAdminApp() {
  if (!admin.apps.length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
    } else {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (!projectId || !clientEmail || !privateKey) {
        throw new Error("Firebase Admin environment variables are missing.");
      }

      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    }
  }

  return admin.app();
}

export function getAdminDb() {
  return getAdminApp().firestore();
}

export function getAdminAuth() {
  return getAdminApp().auth();
}

function getCollectionForType(type) {
  return type === "meal_pass" || type === "subscription" ? PASS_COLLECTION : ORDER_COLLECTION;
}

// The only trusted path that may ever set payment_status to "paid" — the client-side Firestore
// rules explicitly forbid clients from writing this field. Called after Razorpay signature
// verification (checkout handler) or from the webhook, whichever fires first.
export async function markDocumentPaid({ firebaseDocId, type, paymentId, orderId, signature, source }) {
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
    update.paid_at = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection(collectionName).doc(firebaseDocId).set(update, { merge: true });

  // The non-PII order_signals mirror is created ONLY at payment-verified time (kept in sync
  // with canteen-backend/index.js) so unpaid checkout attempts never enter the queue-depth /
  // demand-forecast aggregates.
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
