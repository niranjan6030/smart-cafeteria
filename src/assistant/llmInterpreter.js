// Food Assistant — Gemini-backed turn interpreter (the future swap-in for intentParser).
//
// Runs ONLY server-side (api/food-assistant.js): the API key never reaches the browser bundle.
// Contract: async (rawText) => AssistantTurn | null. Every failure path — missing key, network
// error, timeout, malformed model output, unmappable intent — returns null so the caller falls
// back to the deterministic parser without surfacing an error to the user.

import { FOOD_ASSISTANT_SYSTEM_PROMPT } from "./systemPrompt.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_TEXT_LENGTH = 400;
const MAX_ITEMS = 8;

// The stored prompt allows free-text clarifying questions; JSON mode forbids them, so pin the
// ambiguity escape hatch to a structured shape here.
const OUTPUT_CONTRACT =
  'When the request is ambiguous, respond with exactly {"intent":"CLARIFY","question":"<one short question>"}. ' +
  "Always reply with ONE JSON object and nothing else.";

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      name: String(item?.name || "").trim().slice(0, 80),
      quantity: clampInt(item?.quantity, 1, 20) || 1,
    }))
    .filter((item) => item.name.length > 0);
}

// Only map filters the deterministic tool layer can actually enforce (see foodTools.searchFoods);
// unsupported restrictions like gluten-free are dropped rather than silently misapplied.
function mapFiltersToConstraints(filters) {
  if (!filters || typeof filters !== "object") return {};
  const constraints = {};
  const maxCalories = clampInt(filters.max_calories, 10, 5000);
  if (maxCalories != null) constraints.maxCalories = maxCalories;
  const maxPrice = Math.round(Number(filters.max_price));
  if (Number.isFinite(maxPrice) && maxPrice > 0) constraints.budget = Math.max(10, maxPrice);
  const restrictions = Array.isArray(filters.dietary_restrictions) ? filters.dietary_restrictions : [];
  for (const raw of restrictions) {
    const tag = String(raw || "").toLowerCase();
    if (/vegan/.test(tag)) {
      constraints.vegan = true;
      constraints.vegetarian = true;
    } else if (/vegetarian|\bveg\b/.test(tag)) {
      constraints.vegetarian = true;
    } else if (/non[ -]?veg|meat|chicken|fish/.test(tag)) {
      constraints.nonVeg = true;
    }
  }
  return constraints;
}

function mapPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const intent = String(payload.intent || "").toUpperCase();

  switch (intent) {
    case "ADD_TO_CART": {
      const items = normalizeItems(payload.items);
      if (items.length === 0) return null;
      if (items.length === 1) return { intent: "cart_add", itemPhrase: items[0].name, quantity: items[0].quantity };
      return { intent: "cart_add_multi", items };
    }
    case "REMOVE_FROM_CART": {
      const items = normalizeItems(payload.items);
      if (items.length === 0) return null;
      return { intent: "cart_remove", itemPhrase: items[0].name };
    }
    case "MODIFY_CART": {
      const items = normalizeItems(payload.items);
      if (items.length === 0) return null;
      return { intent: "cart_update", itemPhrase: items[0].name, quantity: items[0].quantity };
    }
    case "VIEW_CART":
      return { intent: "cart_query" };
    case "MENU_SEARCH":
      return { intent: "food_search", constraints: mapFiltersToConstraints(payload.filters) };
    case "CLARIFY":
      return { intent: "clarify", question: String(payload.question || "").trim().slice(0, 200) };
    default:
      return null;
  }
}

function extractJson(data) {
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("") || "";
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Build the async interpreter wired to Gemini, or null when no key is configured.
 * @param {string} apiKey
 * @param {string} [model]
 * @returns {((rawText: string) => Promise<import("./types.js").AssistantTurn | null>) | null}
 */
export function createGeminiTurnInterpreter(apiKey, model = DEFAULT_GEMINI_MODEL) {
  const key = String(apiKey || "").trim();
  if (!key) return null;
  const modelName = String(model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;

  return async function interpret(rawText) {
    const text = String(rawText || "")
      .slice(0, MAX_TEXT_LENGTH)
      .trim();
    if (!text) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let payload;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${FOOD_ASSISTANT_SYSTEM_PROMPT}\n\n${OUTPUT_CONTRACT}` }] },
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 512 },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      payload = extractJson(await response.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    return mapPayload(payload);
  };
}
