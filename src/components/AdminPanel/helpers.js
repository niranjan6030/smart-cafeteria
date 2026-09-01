// Same Vercel deployment every other serverless function already lives on.
const API_BASE_URL = (import.meta.env?.VITE_PAYMENT_API_BASE_URL || "").replace(/\/$/, "");
export const APPROVE_LOGOUT_URL = `${API_BASE_URL}/admin-approve-logout`;
export const SET_ROLE_URL = `${API_BASE_URL}/admin-set-role`;

export async function postJson(url, payload, idToken) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The server derives the acting admin from this verified token — the body no longer
        // carries identity (a client-supplied requesterUid was an escalation vector).
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not reach the admin service. Check your connection.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || `Admin service returned ${response.status}`);
  }
  return data;
}

// ─── Fixed-role reference — the "who can access what" screen. Deliberately not a custom policy
// builder: four roles, each with a hardcoded permission list, matching the actual scale of a
// 6-stall app rather than an IAM engine nobody would configure differently.
export const ROLE_DEFINITIONS = [
  {
    role: "student",
    label: "Student / Faculty",
    permissions: [
      "Browse menus and place orders across all 6 stalls",
      "View own order history, spend wallet, and meal passes",
      "Rate menu items",
    ],
  },
  {
    role: "faculty_admin",
    label: "Faculty Admin",
    permissions: [
      "Everything a Student can do",
      "Place institutional bulk orders on behalf of a department",
    ],
  },
  {
    role: "staff",
    label: "Kitchen Staff",
    permissions: [
      "Manage one assigned stall's fulfillment board (Pending → Preparing → Ready → Completed)",
      "Manage that stall's menu, pricing, specials, and availability",
      "View that stall's financial dashboard and historical ledger",
      "Pause/resume incoming orders, set prep capacity",
      "Request logout — requires admin approval to actually release the stall",
    ],
  },
  {
    role: "admin",
    label: "Admin",
    permissions: [
      "View and force-release any stall's occupancy",
      "Approve or deny staff logout requests",
      "Override any stall's open/closed and busy status directly",
      "View live activity across all stalls and orders",
      "Change any user's role, including promoting new admins",
    ],
  },
];

export const ROLE_LABELS = ROLE_DEFINITIONS.reduce((acc, r) => ({ ...acc, [r.role]: r.label }), {});
