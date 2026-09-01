import { describe, expect, it } from "vitest";
import { executeCommand } from "./commandEngine.js";

const catalog = [
  { id: "1", name: "Masala Dosa", category: "South Indian", shop: "Falcon Veg", price: 80 },
  { id: "2", name: "Coffee", category: "Beverages", shop: "Break Time", price: 25 },
  { id: "3", name: "Gulab Jamun", category: "Desserts", shop: "Falcon Veg", price: 40 },
];

const productCategories = ["South Indian", "North Indian", "Beverages", "Desserts", "Vegetarian"];

const baseProduct = (id) => catalog.find((p) => p.id === id);
const cartItem = (id, quantity) => ({ ...baseProduct(id), quantity, shop: baseProduct(id).shop });

/** @param {Partial<import("./commandEngine.js").CommandContext>} overrides */
function ctx(overrides = {}) {
  return {
    cart: [],
    activeShop: "Falcon Veg",
    catalog,
    productCategories,
    isInteractive: true,
    lastActionProduct: null,
    ...overrides,
  };
}

describe("commandEngine — SELECT_STALL", () => {
  it("switches stall, clears cart and filters, persists preferred shop", () => {
    const r = executeCommand({ type: "SELECT_STALL", stallName: "Mingos", modality: "manual" }, ctx());
    expect(r.success).toBe(true);
    expect(r.effects).toEqual({
      activeShop: "Mingos",
      preferredShop: "Mingos",
      clearCart: true,
      categoryFilter: null,
      searchQuery: "",
    });
  });
});

describe("commandEngine — SET_SEARCH", () => {
  it("sets the query and clears the category filter", () => {
    const r = executeCommand({ type: "SET_SEARCH", query: "dosa", modality: "manual" }, ctx());
    expect(r.effects).toEqual({ searchQuery: "dosa", categoryFilter: null });
  });

  it("supports clearing the search", () => {
    const r = executeCommand({ type: "SET_SEARCH", query: "", modality: "manual" }, ctx());
    expect(r.effects).toEqual({ searchQuery: "", categoryFilter: null });
  });
});

describe("commandEngine — SET_CATEGORY", () => {
  it("sets the category and clears the search", () => {
    const r = executeCommand({ type: "SET_CATEGORY", category: "Beverages", modality: "voice" }, ctx());
    expect(r.effects).toEqual({ categoryFilter: "Beverages", searchQuery: "" });
  });

  it("clearing the category leaves the search untouched", () => {
    const r = executeCommand({ type: "SET_CATEGORY", category: null, modality: "manual" }, ctx());
    expect(r.effects).toEqual({ categoryFilter: null });
  });
});

describe("commandEngine — SHOW_VEGETARIAN", () => {
  it("resolves the vegetarian category from live categories", () => {
    const r = executeCommand({ type: "SHOW_VEGETARIAN", modality: "voice" }, ctx());
    expect(r.effects).toEqual({ categoryFilter: "Vegetarian", searchQuery: "" });
  });

  it("falls back to a 'veg' search when no vegetarian category exists", () => {
    const r = executeCommand(
      { type: "SHOW_VEGETARIAN", modality: "voice" },
      ctx({ productCategories: ["South Indian", "Beverages"] })
    );
    expect(r.effects).toEqual({ searchQuery: "veg", categoryFilter: null });
  });
});

describe("commandEngine — ADD_ITEM", () => {
  it("adds the requested quantity to an empty cart and records lastActionProduct", () => {
    const r = executeCommand({ type: "ADD_ITEM", productId: "1", quantity: 2, modality: "voice" }, ctx());
    expect(r.success).toBe(true);
    expect(r.message).toBe("Added 2 Masala Dosa.");
    expect(r.effects.cart).toEqual([cartItem("1", 2)]);
    expect(r.effects.lastActionProduct.id).toBe("1");
  });

  it("sums with the existing quantity", () => {
    const r = executeCommand(
      { type: "ADD_ITEM", productId: "1", quantity: 2, modality: "voice" },
      ctx({ cart: [cartItem("1", 1)] })
    );
    expect(r.effects.cart).toEqual([cartItem("1", 3)]);
  });

  it("fails cleanly for an unknown product", () => {
    const r = executeCommand({ type: "ADD_ITEM", productId: "nope", quantity: 1, modality: "voice" }, ctx());
    expect(r.success).toBe(false);
    expect(r.effects.cart).toBeUndefined();
  });
});

describe("commandEngine — REMOVE_ITEM", () => {
  it("decrements the quantity", () => {
    const r = executeCommand(
      { type: "REMOVE_ITEM", productId: "1", quantity: 1, modality: "voice" },
      ctx({ cart: [cartItem("1", 2)] })
    );
    expect(r.effects.cart).toEqual([cartItem("1", 1)]);
  });

  it("removes the entry entirely when quantity reaches zero", () => {
    const r = executeCommand(
      { type: "REMOVE_ITEM", productId: "1", quantity: 2, modality: "voice" },
      ctx({ cart: [cartItem("1", 2)] })
    );
    expect(r.effects.cart).toEqual([]);
  });
});

describe("commandEngine — UPDATE_QUANTITY (manual +/-)", () => {
  it("delta +1 adds one unit to an empty cart", () => {
    const r = executeCommand({ type: "UPDATE_QUANTITY", productId: "1", delta: 1, modality: "manual" }, ctx());
    expect(r.effects.cart).toEqual([cartItem("1", 1)]);
    expect(r.effects.lastActionProduct.id).toBe("1");
  });

  it("delta -1 decrements an existing entry", () => {
    const r = executeCommand(
      { type: "UPDATE_QUANTITY", productId: "1", delta: -1, modality: "manual" },
      ctx({ cart: [cartItem("1", 2)] })
    );
    expect(r.effects.cart).toEqual([cartItem("1", 1)]);
  });

  it("delta -1 does not modify the cart when the item is absent", () => {
    const r = executeCommand({ type: "UPDATE_QUANTITY", productId: "1", delta: -1, modality: "manual" }, ctx());
    expect(r.success).toBe(true);
    expect(r.effects.cart).toEqual([]);
  });
});

describe("commandEngine — UNDO_LAST", () => {
  it("removes one unit of the most recently added product", () => {
    const r = executeCommand(
      { type: "UNDO_LAST", modality: "voice" },
      ctx({ cart: [cartItem("1", 2)], lastActionProduct: baseProduct("1") })
    );
    expect(r.success).toBe(true);
    expect(r.effects.cart).toEqual([cartItem("1", 1)]);
    expect(r.effects.lastActionProduct).toBeNull();
  });

  it("errors when there is nothing to undo", () => {
    const r = executeCommand({ type: "UNDO_LAST", modality: "voice" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toBe("Nothing to undo.");
  });
});

describe("commandEngine — OPEN_CART / CHECKOUT / SCROLL_TO_MENU / NOOP / UNKNOWN", () => {
  it("OPEN_CART requests opening the drawer", () => {
    const r = executeCommand({ type: "OPEN_CART", modality: "voice" }, ctx());
    expect(r.effects).toEqual({ openCart: true });
  });

  it("CHECKOUT requests checkout", () => {
    const r = executeCommand({ type: "CHECKOUT", modality: "voice" }, ctx());
    expect(r.effects).toEqual({ checkout: true });
  });

  it("SCROLL_TO_MENU scrolls and resets filters", () => {
    const r = executeCommand({ type: "SCROLL_TO_MENU", modality: "voice" }, ctx());
    expect(r.effects).toEqual({ scrollToMenu: true, searchQuery: "", categoryFilter: null });
  });

  it("NOOP relays the reason (reporting-only)", () => {
    const r = executeCommand({ type: "NOOP", reason: "no-speech", modality: "voice" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toBe("no-speech");
  });

  it("HELP returns example commands without mutating state", () => {
    const r = executeCommand({ type: "HELP", modality: "voice" }, ctx());
    expect(r.success).toBe(true);
    expect(r.message).toContain("add two masala dosa");
    expect(r.effects).toEqual({});
  });

  it("unknown commands fail with UNKNOWN", () => {
    const r = executeCommand({ type: "FLY_TO_MOON", modality: "manual" }, ctx());
    expect(r.success).toBe(false);
    expect(r.commandType).toBe("UNKNOWN");
  });
});

describe("commandEngine — blocked gate (stall closed/busy)", () => {
  const closed = ctx({ isInteractive: false });

  it("blocks cart mutations and checkout", () => {
    expect(executeCommand({ type: "ADD_ITEM", productId: "1", quantity: 1, modality: "voice" }, closed).success).toBe(false);
    expect(executeCommand({ type: "UPDATE_QUANTITY", productId: "1", delta: 1, modality: "manual" }, closed).success).toBe(false);
    expect(executeCommand({ type: "UNDO_LAST", modality: "voice" }, closed).success).toBe(false);
    expect(executeCommand({ type: "CHECKOUT", modality: "voice" }, closed).success).toBe(false);
  });

  it("allows browsing: OPEN_CART, SCROLL_TO_MENU, SET_SEARCH, SET_CATEGORY", () => {
    expect(executeCommand({ type: "OPEN_CART", modality: "voice" }, closed).success).toBe(true);
    expect(executeCommand({ type: "SCROLL_TO_MENU", modality: "voice" }, closed).success).toBe(true);
    expect(executeCommand({ type: "SET_SEARCH", query: "x", modality: "manual" }, closed).success).toBe(true);
    expect(executeCommand({ type: "SET_CATEGORY", category: "Beverages", modality: "manual" }, closed).success).toBe(true);
  });

  it("allows SELECT_STALL so a user can move to an open stall", () => {
    expect(executeCommand({ type: "SELECT_STALL", stallName: "Mingos", modality: "manual" }, closed).success).toBe(true);
  });

  it("NOOP still relays its reason (not the stall-closed message)", () => {
    const r = executeCommand({ type: "NOOP", reason: "no-speech", modality: "voice" }, closed);
    expect(r.success).toBe(false);
    expect(r.message).toBe("no-speech");
  });

  it("HELP works while the stall is closed", () => {
    const r = executeCommand({ type: "HELP", modality: "voice" }, closed);
    expect(r.success).toBe(true);
    expect(r.effects).toEqual({});
  });
});

describe("commandEngine — modality invariance", () => {
  it("the same semantic command yields identical results for manual and voice", () => {
    const voice = executeCommand({ type: "ADD_ITEM", productId: "1", quantity: 1, modality: "voice" }, ctx());
    const manual = executeCommand({ type: "ADD_ITEM", productId: "1", quantity: 1, modality: "manual" }, ctx());
    expect(manual.effects).toEqual(voice.effects);
    expect(manual.message).toBe(voice.message);
  });
});
