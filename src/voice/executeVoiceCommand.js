import { resolveMenuEntity, resolveStallName } from "../core/menu/entityResolver.js";
import { parseVoiceIntent } from "./nlu/ruleParser.js";
import { speakFeedback } from "./tts/speakFeedback.js";

/**
 * @typedef {Object} VoiceExecutionContext
 * @property {string} activeShop
 * @property {string[]} stallNames
 * @property {string[]} productCategories
 * @property {Array<{ id: string; name?: string; category?: string; shop?: string; price?: number }>} catalog
 * @property {(command: import("../core/commands/types.js").AppCommand, meta?: object) => import("../core/commands/commandEngine.js").CommandResult} dispatch
 *   — the single command pipeline (shared with the manual UI). Both input modalities reduce to
 *   the same typed AppCommand, so outputs are identical by construction.
 */

/**
 * @typedef {Object} VoiceExecutionResult
 * @property {boolean} success
 * @property {string} message
 * @property {'info' | 'success' | 'error' | 'confirm'} tone
 * @property {string} commandType — the executed command type, for telemetry attribution
 * @property {string} [suggestion] — a recoverable next-utterance hint shown on failure
 * @property {Array<{ product: object; score: number }>} [disambiguationCandidates]
 * @property {string} [pendingIntent]
 * @property {string} [pendingItemPhrase]
 * @property {number} [pendingQuantity]
 */

/**
 * Resolve category name fuzzily against live categories.
 * @param {string} phrase
 * @param {string[]} categories
 */
function resolveCategory(phrase, categories) {
  const needle = phrase.toLowerCase().trim();
  const exact = categories.find((c) => c.toLowerCase() === needle);
  if (exact) return exact;
  const partial = categories.find((c) => c.toLowerCase().includes(needle) || needle.includes(c.toLowerCase()));
  return partial || null;
}

/**
 * Map a parsed utterance to semantic AppCommand(s) and dispatch them through the shared command
 * engine. NLU (ruleParser) + entity resolution stay here; ALL state mutation happens in the
 * engine via ctx.dispatch, which is the exact same function the manual UI uses.
 *
 * @param {string} transcript
 * @param {VoiceExecutionContext} ctx
 * @param {{ skipTts?: boolean }} [options]
 * @returns {VoiceExecutionResult}
 */
export function executeVoiceTranscript(transcript, ctx, options = {}) {
  const parsed = parseVoiceIntent(transcript);

  const finish = (result) => {
    if (!options.skipTts && result.message) {
      speakFeedback(result.message);
    }
    // Keep the engine's commandType when relaying its result; fall back to the parsed intent.
    return { commandType: parsed.intent, ...result };
  };

  switch (parsed.intent) {
    case "CHECKOUT":
      return finish(ctx.dispatch({ type: "CHECKOUT", modality: "voice" }));

    case "OPEN_CART":
      return finish(ctx.dispatch({ type: "OPEN_CART", modality: "voice" }));

    case "SHOW_MENU": {
      ctx.dispatch({ type: "SCROLL_TO_MENU", modality: "voice" });
      return finish({ success: true, message: "Here is the menu.", tone: "info" });
    }

    case "HELP":
      return finish(ctx.dispatch({ type: "HELP", modality: "voice" }));

    case "UNDO_LAST":
      return finish(ctx.dispatch({ type: "UNDO_LAST", modality: "voice" }));

    case "SEARCH": {
      ctx.dispatch({ type: "SET_SEARCH", query: parsed.query, modality: "voice" });
      ctx.dispatch({ type: "SCROLL_TO_MENU", modality: "voice" });
      return finish({ success: true, message: `Searching for ${parsed.query}.`, tone: "info" });
    }

    case "SHOW_VEGETARIAN": {
      const vegCategory =
        resolveCategory("vegetarian", ctx.productCategories) ||
        resolveCategory("veg", ctx.productCategories);
      ctx.dispatch(
        vegCategory
          ? { type: "SET_CATEGORY", category: vegCategory, modality: "voice" }
          : { type: "SET_SEARCH", query: "veg", modality: "voice" }
      );
      ctx.dispatch({ type: "SCROLL_TO_MENU", modality: "voice" });
      return finish({
        success: true,
        message: vegCategory ? `Showing ${vegCategory} items.` : "Showing vegetarian options.",
        tone: "info",
      });
    }

    case "SHOW_CATEGORY": {
      const category = resolveCategory(parsed.category, ctx.productCategories);
      ctx.dispatch(
        category
          ? { type: "SET_CATEGORY", category, modality: "voice" }
          : { type: "SET_SEARCH", query: parsed.category, modality: "voice" }
      );
      ctx.dispatch({ type: "SCROLL_TO_MENU", modality: "voice" });
      return finish({
        success: true,
        message: category ? `Showing ${category}.` : `Searching for ${parsed.category}.`,
        tone: "info",
      });
    }

    case "SELECT_STALL": {
      const stall = resolveStallName(parsed.stallPhrase, ctx.stallNames);
      if (!stall) {
        ctx.dispatch?.({ type: "NOOP", reason: `Unrecognized stall: ${parsed.stallPhrase}`, modality: "voice" });
        return finish({
          success: false,
          message: `I couldn't find stall ${parsed.stallPhrase}.`,
          tone: "error",
          suggestion: 'Try the name on the stall card, like "go to Mingos".',
        });
      }
      ctx.dispatch({ type: "SELECT_STALL", stallName: stall, modality: "voice" });
      ctx.dispatch({ type: "SCROLL_TO_MENU", modality: "voice" });
      return finish({ success: true, message: `Switched to ${stall}.`, tone: "success" });
    }

    case "ADD_ITEM":
    case "INCREASE_ITEM": {
      const quantity = parsed.quantity;
      const { match, candidates } = resolveMenuEntity(parsed.itemPhrase, ctx.catalog, {
        activeShop: ctx.activeShop,
      });
      if (!match) {
        if (candidates.length >= 2) {
          const names = candidates.slice(0, 3).map((c) => c.product.name).join(", or ");
          return finish({
            success: false,
            message: `Did you mean ${names}? Tap a choice below.`,
            tone: "confirm",
            disambiguationCandidates: candidates,
            pendingIntent: parsed.intent,
            pendingItemPhrase: parsed.itemPhrase,
            pendingQuantity: quantity,
          });
        }
        // Failed entity resolution must still land in telemetry (error-rate data), so report it
        // as a NOOP through the shared pipeline.
        ctx.dispatch?.({ type: "NOOP", reason: `Unrecognized item: ${parsed.itemPhrase}`, modality: "voice" });
        return finish({
          success: false,
          message: `I couldn't find ${parsed.itemPhrase} at ${ctx.activeShop}.`,
          tone: "error",
          suggestion: 'Say "show menu" to browse, or try a dish name on this stall.',
        });
      }
      return finish(ctx.dispatch({ type: "ADD_ITEM", productId: match.id, quantity, modality: "voice" }));
    }

    case "REMOVE_ITEM":
    case "DECREASE_ITEM": {
      const quantity = parsed.quantity;
      const { match, candidates } = resolveMenuEntity(parsed.itemPhrase, ctx.catalog, {
        activeShop: ctx.activeShop,
      });
      if (!match) {
        if (candidates.length >= 2) {
          return finish({
            success: false,
            message: "Which item should I remove? Choose below.",
            tone: "confirm",
            disambiguationCandidates: candidates,
            pendingIntent: parsed.intent,
            pendingItemPhrase: parsed.itemPhrase,
            pendingQuantity: quantity,
          });
        }
        ctx.dispatch?.({ type: "NOOP", reason: `Unrecognized item: ${parsed.itemPhrase}`, modality: "voice" });
        return finish({
          success: false,
          message: `I couldn't find ${parsed.itemPhrase} in your menu.`,
          tone: "error",
          suggestion: 'Say "show menu" to browse, or check the dish name first.',
        });
      }
      return finish(ctx.dispatch({ type: "REMOVE_ITEM", productId: match.id, quantity, modality: "voice" }));
    }

    default:
      ctx.dispatch?.({ type: "NOOP", reason: `Unrecognized: ${transcript}`, modality: "voice" });
      return finish({
        success: false,
        message: "Sorry, I didn't understand that.",
        tone: "error",
        suggestion: 'Try "add two masala dosa", "go to mingos", or say "help".',
      });
  }
}

/**
 * Apply a disambiguation pick (user tapped a candidate). Emits the same semantic command the
 * original utterance would have produced, so the result is identical to manual selection.
 *
 * @param {{ product: object }} candidate
 * @param {{ pendingIntent?: string; pendingQuantity?: number }} pending
 * @param {VoiceExecutionContext} ctx
 */
export function executeDisambiguationChoice(candidate, pending, ctx) {
  const product = candidate.product;
  const qty = pending.pendingQuantity || 1;
  const intent = pending.pendingIntent || "ADD_ITEM";
  const isRemoval = intent === "REMOVE_ITEM" || intent === "DECREASE_ITEM";
  return ctx.dispatch({
    type: isRemoval ? "REMOVE_ITEM" : "ADD_ITEM",
    productId: product.id,
    quantity: qty,
    modality: "voice",
  });
}
