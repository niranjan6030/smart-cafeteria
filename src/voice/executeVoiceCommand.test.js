import { describe, expect, it } from "vitest";
import { executeCommand } from "../core/commands/commandEngine.js";
import { executeDisambiguationChoice, executeVoiceTranscript } from "./executeVoiceCommand.js";

const catalog = [
  { id: "1", name: "Masala Dosa", category: "South Indian", shop: "Falcon Veg", price: 80 },
  { id: "2", name: "Paneer Fried Rice", category: "North Indian", shop: "Falcon Veg", price: 120 },
  { id: "3", name: "Coffee", category: "Beverages", shop: "Break Time", price: 25 },
];

const stallNames = ["Falcon Veg", "Break Time", "Mingos"];
const productCategories = ["South Indian", "North Indian", "Beverages", "Desserts", "Vegetarian"];

const engineCtx = (cart = [], overrides = {}) => ({
  cart,
  activeShop: "Falcon Veg",
  catalog,
  productCategories,
  isInteractive: true,
  lastActionProduct: null,
  ...overrides,
});

/**
 * Build a voice context whose dispatch records every command and executes it through the real
 * command engine (mirroring how dispatchCommand works in the app).
 */
function makeCtx() {
  const dispatched = [];
  const ctx = {
    activeShop: "Falcon Veg",
    stallNames,
    productCategories,
    catalog,
    dispatch: (command) => {
      dispatched.push(command);
      return executeCommand(command, engineCtx());
    },
  };
  return { dispatched, ctx };
}

describe("executeVoiceTranscript — the voice pipeline emits shared AppCommands", () => {
  it("'add two masala dosas' dispatches ADD_ITEM with the same result as two manual + taps", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("Add two masala dosas", ctx, { skipTts: true });

    expect(result.success).toBe(true);
    expect(dispatched).toEqual([{ type: "ADD_ITEM", productId: "1", quantity: 2, modality: "voice" }]);

    const voiceCart = executeCommand(dispatched[0], engineCtx()).effects.cart;
    const manualCart = [
      { type: "UPDATE_QUANTITY", productId: "1", delta: 1, modality: "manual" },
      { type: "UPDATE_QUANTITY", productId: "1", delta: 1, modality: "manual" },
    ].reduce((cart, cmd) => executeCommand(cmd, engineCtx(cart)).effects.cart, []);

    expect(voiceCart).toEqual(manualCart);
    expect(voiceCart).toEqual([{ id: "1", name: "Masala Dosa", category: "South Indian", shop: "Falcon Veg", price: 80, quantity: 2 }]);
  });

  it("'checkout' dispatches CHECKOUT and relays the engine message", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("Checkout", ctx, { skipTts: true });
    expect(dispatched).toEqual([{ type: "CHECKOUT", modality: "voice" }]);
    expect(result.message).toBe("Opening checkout.");
  });

  it("'show vegetarian food' dispatches the same SET_CATEGORY a category chip sends", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("Show vegetarian food", ctx, { skipTts: true });
    expect(result.success).toBe(true);
    expect(dispatched[0]).toEqual({ type: "SET_CATEGORY", category: "Vegetarian", modality: "voice" });
    expect(dispatched[1]).toEqual({ type: "SCROLL_TO_MENU", modality: "voice" });
  });

  it("'switch to falcon veg' dispatches SELECT_STALL + SCROLL_TO_MENU", () => {
    const { dispatched, ctx } = makeCtx();
    executeVoiceTranscript("Switch to Falcon Veg", ctx, { skipTts: true });
    expect(dispatched[0]).toEqual({ type: "SELECT_STALL", stallName: "Falcon Veg", modality: "voice" });
    expect(dispatched[1]).toEqual({ type: "SCROLL_TO_MENU", modality: "voice" });
  });

  it("'remove one masala dosa' dispatches REMOVE_ITEM", () => {
    const { dispatched, ctx } = makeCtx();
    executeVoiceTranscript("Remove one masala dosa", ctx, { skipTts: true });
    expect(dispatched[0]).toEqual({ type: "REMOVE_ITEM", productId: "1", quantity: 1, modality: "voice" });
  });

  it("'cancel my last item' dispatches UNDO_LAST and relays the engine's feedback", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("Cancel my last item", ctx, { skipTts: true });
    expect(dispatched[0]).toEqual({ type: "UNDO_LAST", modality: "voice" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Nothing to undo.");
  });

  it("an utterance that fails entity resolution dispatches NOOP so error-rate data lands in telemetry", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("purple monkey dishwasher", ctx, { skipTts: true });
    expect(result.success).toBe(false);
    expect(dispatched).toEqual([{ type: "NOOP", reason: "Unrecognized item: purple monkey dishwasher", modality: "voice" }]);
  });

  it("'what can I say' dispatches HELP and relays the example commands", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("What can I say", ctx, { skipTts: true });
    expect(dispatched).toEqual([{ type: "HELP", modality: "voice" }]);
    expect(result.success).toBe(true);
    expect(result.message).toContain("add two masala dosa");
  });

  it("a genuinely unparseable utterance dispatches NOOP from the default branch", () => {
    const { dispatched, ctx } = makeCtx();
    const result = executeVoiceTranscript("okay", ctx, { skipTts: true });
    expect(result.success).toBe(false);
    expect(dispatched[0]).toEqual({ type: "NOOP", reason: "Unrecognized: okay", modality: "voice" });
    expect(result.suggestion).toBeTruthy();
  });

  it("failed entity resolution carries a recovery suggestion", () => {
    const { ctx } = makeCtx();
    const result = executeVoiceTranscript("purple monkey dishwasher", ctx, { skipTts: true });
    expect(result.success).toBe(false);
    expect(result.suggestion).toContain("show menu");
  });

  it("an ambiguous utterance yields candidates and picking one dispatches ADD_ITEM", () => {
    const extendedCatalog = [
      ...catalog,
      { id: "4", name: "Mysore Dosa", category: "South Indian", shop: "Falcon Veg", price: 90 },
    ];
    const dispatched = [];
    const ctx = {
      activeShop: "Falcon Veg",
      stallNames,
      productCategories,
      catalog: extendedCatalog,
      dispatch: (command) => {
        dispatched.push(command);
        return executeCommand(command, { ...engineCtx(), catalog: extendedCatalog });
      },
    };

    const result = executeVoiceTranscript("Add dosa", ctx, { skipTts: true });
    expect(result.success).toBe(false);
    expect(result.disambiguationCandidates.length).toBeGreaterThanOrEqual(2);

    const choice = executeDisambiguationChoice(
      result.disambiguationCandidates[0],
      { pendingIntent: result.pendingIntent, pendingQuantity: result.pendingQuantity },
      ctx
    );
    expect(dispatched[0]).toEqual({
      type: "ADD_ITEM",
      productId: result.disambiguationCandidates[0].product.id,
      quantity: 1,
      modality: "voice",
    });
    expect(choice.success).toBe(true);
  });
});
