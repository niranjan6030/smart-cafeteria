# Christ Canteen Razorpay Backend

Copy these files into the root of your Vercel backend project named `index-js`:

```text
index-js/
  index.js
  package.json
  vercel.json
```

Do not put these files inside the React frontend `src/api` folder.

## Required Vercel Environment Variables

Set these in Vercel -> Project Settings -> Environment Variables:

```env
RAZORPAY_KEY_ID=rzp_live_your_key_id
RAZORPAY_KEY_SECRET=your_rotated_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret

FIREBASE_PROJECT_ID=canteen-christ
FIREBASE_CLIENT_EMAIL=your-firebase-admin-client-email
FIREBASE_PRIVATE_KEY=your-firebase-admin-private-key

ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app,http://localhost:5173
```

Alternative Firebase setup:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Use either `FIREBASE_SERVICE_ACCOUNT_JSON` or the three separate Firebase variables.

## Frontend Environment Variables

In the React frontend `.env`:

```env
VITE_RAZORPAY_KEY_ID=rzp_live_your_key_id
VITE_PAYMENT_API_BASE_URL=https://<your-project>.vercel.app
```

Restart Vite after editing `.env`.

## Routes

- `POST /create-order` creates a Razorpay order.
- `POST /verify-payment` verifies the checkout signature and marks Firestore paid.
- `POST /webhook` accepts Razorpay webhooks and marks Firestore paid as a backup.
- `GET /` returns a health check.

## Razorpay Webhook

In Razorpay Dashboard, add:

```text
https://<your-project>.vercel.app/webhook
```

Events:

```text
payment.captured
order.paid
```

Rotate the Razorpay secret key that was pasted into chat earlier. The secret must only live in Vercel environment variables.
