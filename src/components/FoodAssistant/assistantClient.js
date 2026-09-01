import { RESPONSE_TYPE, ACTION_TYPE } from "../../assistant/types.js";

// Food Assistant backend — a thin snapshot/validation seam over the deterministic engine in
// src/assistant (which runs identically in unit tests). Point this at your own deployment of
// api/food-assistant.js: VITE_FOOD_ASSISTANT_API_URL, or VITE_PAYMENT_API_BASE_URL if the
// serverless functions all live on one Vercel project. Unset means the assistant panel stays
// closed rather than firing requests at a host that is not yours.
const ASSISTANT_API_BASE = (import.meta.env?.VITE_PAYMENT_API_BASE_URL || "").replace(/\/$/, "");
export const FOOD_ASSISTANT_API_URL = (
  import.meta.env?.VITE_FOOD_ASSISTANT_API_URL ||
  (ASSISTANT_API_BASE ? `${ASSISTANT_API_BASE}/api/food-assistant` : "")
).replace(/\/$/, "");

/**
 * @param {object} params
 * @param {Array} params.messages — assistant conversation history, serialized:
 *   user → { role:"user", content, kind?, data? }
 *   assistant → { role:"assistant", content, type, data, constraints }
 * @param {object} params.context — { activeShop, activeTab, cart: [{id, quantity}] }
 * @param {string} [params.idToken] — Firebase ID token (optional; guests allowed)
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<import("../../assistant/types.js").AssistantResponse>}
 */
export async function sendAssistantTurn({ messages, context, idToken, signal }) {
  const response = await fetch(`${FOOD_ASSISTANT_API_URL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ messages, context }),
    signal,
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || "The food assistant couldn't respond right now.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export { RESPONSE_TYPE, ACTION_TYPE };
