import { normalizeTranscript } from "./normalizeTranscript.js";

/**
 * Rule-based NLU: maps normalized transcript → structured intent + slots.
 * Deterministic and testable — no ML dependency for MVP.
 *
 * @typedef {(
 *   | { intent: 'ADD_ITEM'; itemPhrase: string; quantity: number }
 *   | { intent: 'REMOVE_ITEM'; itemPhrase: string; quantity: number }
 *   | { intent: 'INCREASE_ITEM'; itemPhrase: string; quantity: number }
 *   | { intent: 'DECREASE_ITEM'; itemPhrase: string; quantity: number }
 *   | { intent: 'SEARCH'; query: string }
 *   | { intent: 'SHOW_CATEGORY'; category: string }
 *   | { intent: 'SHOW_VEGETARIAN' }
 *   | { intent: 'SELECT_STALL'; stallPhrase: string }
 *   | { intent: 'OPEN_CART' }
 *   | { intent: 'CHECKOUT' }
 *   | { intent: 'UNDO_LAST' }
 *   | { intent: 'SHOW_MENU' }
 *   | { intent: 'HELP' }
 *   | { intent: 'UNKNOWN'; raw: string }
 * )} ParsedIntent
 */

const CHECKOUT_RE = /^(checkout|check out|place order|place my order|pay now|complete order|proceed to payment|finish order)$/;
const OPEN_CART_RE = /^(open cart|show cart|view cart|my cart|see cart|show my cart)$/;
const UNDO_RE = /^(undo|cancel last|cancel my last item|remove last item|take back last|oops)$/;
const SHOW_MENU_RE = /^(show menu|browse menu|open menu|see menu)$/;
const HELP_RE = /^(help|help me|what can i say|what can i do|how do i order|how to use|show help|show commands|what can i order)$/;
const VEG_RE = /(show|find|filter|display).*(vegetarian|veg food|veg items|veg dishes)|^(vegetarian|veg food|veg items)$/;

/**
 * Extract a leading quantity from a normalized phrase. normalizeTranscript already expands number
 * words to digits, so the digit branch covers "2 burgers" / "1 coffee"; the word branch is a
 * defensive fallback if normalization ever changes.
 * @param {string} text
 * @returns {{ quantity: number; rest: string }}
 */
function parseLeadingQuantity(text) {
  const match = text.match(/^(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten|a|an))\s+(.*)$/);
  if (!match) return { quantity: 1, rest: text };
  const quantity = match[1] ? parseInt(match[1], 10) : ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 })[match[2]];
  return { quantity: Math.max(1, quantity || 1), rest: match[3].trim() };
}

/**
 * @param {string} rawTranscript
 * @returns {ParsedIntent}
 */
export function parseVoiceIntent(rawTranscript) {
  const text = normalizeTranscript(rawTranscript);
  if (!text) return { intent: "UNKNOWN", raw: rawTranscript };

  if (CHECKOUT_RE.test(text)) return { intent: "CHECKOUT" };
  if (OPEN_CART_RE.test(text)) return { intent: "OPEN_CART" };
  if (UNDO_RE.test(text)) return { intent: "UNDO_LAST" };
  if (SHOW_MENU_RE.test(text)) return { intent: "SHOW_MENU" };
  if (HELP_RE.test(text)) return { intent: "HELP" };
  if (VEG_RE.test(text)) return { intent: "SHOW_VEGETARIAN" };

  let match;

  match = text.match(/^(?:search for|search|find)\s+(.+)$/);
  if (match) return { intent: "SEARCH", query: match[1].trim() };

  match = text.match(/^(?:show|filter|display|open|browse)\s+(?:the\s+)?(.+?)(?:\s+food|\s+items|\s+dishes)?$/);
  if (match && !/vegetarian|veg\b/.test(match[1])) {
    return { intent: "SHOW_CATEGORY", category: match[1].trim() };
  }

  match = text.match(/^(?:switch to|go to|select|change to|move to)\s+(.+)$/);
  if (match) return { intent: "SELECT_STALL", stallPhrase: match[1].trim() };

  // Quantity modifiers first so "add more dosa" is INCREASE, not ADD with itemPhrase "more dosa".
  match = text.match(/^(?:increase|add more|more|add another|another)\s+(.+)$/);
  if (match) {
    const { quantity, rest } = parseLeadingQuantity(match[1].trim());
    return { intent: "INCREASE_ITEM", quantity, itemPhrase: rest };
  }

  // REMOVE before ADD so "get rid of the pasta" isn't captured by the "get" ADD alias.
  match = text.match(/^(?:remove|delete|take off|take out|drop|get rid of)\s+(.+?)(?:\s+from cart|from my cart)?$/);
  if (match) {
    const { quantity, rest } = parseLeadingQuantity(match[1].trim());
    return { intent: "REMOVE_ITEM", quantity, itemPhrase: rest };
  }

  match = text.match(/^(?:add|order|get me|get|give me|i want|i need|id like|can i have|make it)\s+(.+?)(?:\s+please)?$/);
  if (match) {
    const { quantity, rest } = parseLeadingQuantity(match[1].trim());
    return { intent: "ADD_ITEM", quantity, itemPhrase: rest };
  }

  match = text.match(/^(?:decrease|reduce|less|minus)\s+(.+)$/);
  if (match) {
    const { quantity, rest } = parseLeadingQuantity(match[1].trim());
    return { intent: "DECREASE_ITEM", quantity, itemPhrase: rest };
  }

  // Bare item name → treat as add one
  if (text.length >= 2 && !/^(yes|no|ok|okay|thanks|thank you|stop|cancel)$/.test(text)) {
    const { quantity, rest } = parseLeadingQuantity(text);
    return { intent: "ADD_ITEM", quantity, itemPhrase: rest };
  }

  return { intent: "UNKNOWN", raw: rawTranscript };
}
