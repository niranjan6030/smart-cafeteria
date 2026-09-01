import { describe, expect, it } from "vitest";
import { handleAssistantTurn } from "./engine.js";
import { parseTurn } from "./intentParser.js";
import { estimateNutrition, sumNutrition, formatCalories } from "../recommender/nutrition.js";
import { RESPONSE_TYPE } from "./types.js";

// ─── Real-shaped catalogue (mirrors products docs) ──────────────────────────────
const PRODUCTS = [
  { id: "p1", name: "Masala Dosa", category: "South Indian", shop: "Falcon Veg", price: 80, available: true, rating: 4.6, reviewCount: 120 },
  { id: "p2", name: "Chicken Roll", category: "Snacks", shop: "Break Time", price: 90, available: true, rating: 4.5, reviewCount: 90 },
  { id: "p3", name: "Egg Sandwich", category: "Sandwich", shop: "Break Time", price: 70, available: true, rating: 4.4, reviewCount: 80 },
  { id: "p4", name: "French Fries", category: "Snacks", shop: "Surf & Turf", price: 60, available: true, rating: 4.2, reviewCount: 60 },
  { id: "p5", name: "Cold Coffee", category: "Beverages", shop: "Break Time", price: 80, available: true, rating: 4.1, reviewCount: 40 },
  { id: "p6", name: "Hot Coffee", category: "Beverages", shop: "Break Time", price: 30, available: true, rating: 4.0, reviewCount: 50 },
  { id: "p7", name: "Veg Biryani", category: "Biryani", shop: "Fresheteria", price: 140, available: true, rating: 4.7, reviewCount: 200 },
  { id: "p8", name: "Paneer Fried Rice", category: "Chinese", shop: "Mingos", price: 120, available: true, rating: 4.3, reviewCount: 70 },
  { id: "p9", name: "Mushroom Dosa", category: "South Indian", shop: "Falcon Veg", price: 95, available: true, rating: 4.5, reviewCount: 65 },
  { id: "p10", name: "Chicken Biryani", category: "Biryani", shop: "Fresheteria", price: 150, available: true, rating: 4.8, reviewCount: 300 },
  { id: "p11", name: "Gulab Jamun", category: "Dessert", shop: "Bakery", price: 40, available: true, rating: 4.2, reviewCount: 55 },
  { id: "p12", name: "Veg Noodles", category: "Chinese", shop: "Mingos", price: 100, available: true, rating: 4.4, reviewCount: 85 },
  { id: "p13", name: "Chicken Sandwich", category: "Sandwich", shop: "Break Time", price: 85, available: true, rating: 4.3, reviewCount: 45 },
];

const TWO_DAYS = 2 * 86400000;

function makeSnapshot({ userOrders = [], cart = [], signedIn = true } = {}) {
  const now = new Date("2026-08-13T12:30:00.000Z");
  return {
    products: PRODUCTS,
    shopStatus: { "Falcon Veg": { is_open: true }, "Break Time": { is_open: true }, Mingos: { is_open: true } },
    orderSignals: [],
    userOrders: signedIn ? userOrders : null,
    cart,
    signedIn,
    now,
  };
}

const context = { activeShop: "Falcon Veg", activeTab: "menu" };

async function ask(text, { messages = [], snapshot } = {}) {
  const s = snapshot || makeSnapshot();
  const full = [...messages, { role: "user", content: text }];
  return handleAssistantTurn({ messages: full, context, snapshot: s });
}

const usualOrders = [
  { id: "o1", items: [{ id: "p1", name: "Masala Dosa", quantity: 2 }, { id: "p3", name: "Egg Sandwich", quantity: 1 }], shop_name: "Falcon Veg", status: "completed", created_at: new Date(Date.now() - 10 * 86400000) },
  { id: "o2", items: [{ id: "p1", name: "Masala Dosa", quantity: 1 }], shop_name: "Falcon Veg", status: "completed", created_at: new Date(Date.now() - 5 * 86400000) },
];

const recentOrders = [
  { id: "o3", items: [{ id: "p4", name: "French Fries", quantity: 1 }], shop_name: "Surf & Turf", status: "completed", created_at: new Date(Date.now() - 86400000) },
  { id: "o4", items: [{ id: "p5", name: "Cold Coffee", quantity: 1 }], shop_name: "Break Time", status: "completed", created_at: new Date(Date.now() - 2 * 86400000) },
];

// ─── Intent parser unit checks ─────────────────────────────────────────────────

describe("parseTurn — intent classification", () => {
  it("extracts budget from various phrasings", () => {
    expect(parseTurn("I want something under ₹100.").constraints.budget).toBe(100);
    expect(parseTurn("Show me foods below 150 rupees").constraints.budget).toBe(150);
    expect(parseTurn("I have ₹200, build me lunch.").constraints.budget).toBe(200);
    expect(parseTurn("Something affordable").constraints.affordable).toBe(true);
  });

  it("extracts dietary + macro constraints", () => {
    const veg = parseTurn("vegetarian only").constraints;
    expect(veg.vegetarian).toBe(true);

    const rich = parseTurn("protein rich food").constraints;
    expect(rich.protein).toBe("high");

    const light = parseTurn("something light, not too heavy").constraints;
    expect(light.light).toBe(true);

    const filling = parseTurn("I'm hungry and want something filling").constraints;
    expect(filling.filling).toBe(true);

    const protein = parseTurn("a meal with at least 25g protein under ₹180").constraints;
    expect(protein.minProtein).toBe(25);
    expect(protein.budget).toBe(180);
  });

  it("classifies cart operations", () => {
    expect(parseTurn("Add two masala dosas").intent).toBe("cart_add");
    expect(parseTurn("Add coffee").intent).toBe("cart_add");
    expect(parseTurn("remove the fries").intent).toBe("cart_remove");
    expect(parseTurn("Change the dosa quantity to three").intent).toBe("cart_update");
    expect(parseTurn("What's in my cart?").intent).toBe("cart_query");
    expect(parseTurn("How much protein is in my cart?").intent).toBe("cart_query");
    expect(parseTurn("Make my cart cheaper").intent).toBe("cart_cheaper");
    expect(parseTurn("clear my cart").intent).toBe("cart_clear");
  });

  it("classifies discovery vs specific-nutrition", () => {
    expect(parseTurn("What's high in protein?").intent).toBe("food_search");
    expect(parseTurn("Show me vegetarian foods under ₹150.").intent).toBe("food_search");
    expect(parseTurn("How much protein does the chicken roll have?").intent).toBe("nutrition");
    expect(parseTurn("How many calories in a dosa?").intent).toBe("nutrition");
    expect(parseTurn("What's the best vegetarian option today?").intent).toBe("food_search");
  });

  it("classifies comparison, meal builder, recommendations, usuals, similar", () => {
    expect(parseTurn("Compare chicken roll and egg sandwich.").intent).toBe("compare");
    expect(parseTurn("Build me a meal with at least 25g protein under ₹180.").intent).toBe("meal_builder");
    expect(parseTurn("I have ₹200. Build me lunch.").intent).toBe("meal_builder");
    expect(parseTurn("What should I eat today?").intent).toBe("recommend");
    expect(parseTurn("What do I usually order?").intent).toBe("usuals");
    expect(parseTurn("Order my usual.").intent).toBe("reorder_usuals");
    expect(parseTurn("Show me something similar to dosa.").intent).toBe("similar");
    expect(parseTurn("What's available right now?").intent).toBe("availability");
    expect(parseTurn("Show me foods from Mingos").intent).toBe("stall");
  });

  it("marks bare constraint refinements as modifiers", () => {
    const turn = parseTurn("Vegetarian only.");
    expect(turn.intent).toBe("modifier");
    expect(turn.isModifier).toBe(true);
    expect(parseTurn("Under ₹120").intent).toBe("modifier");
  });

  it("survives real-world typos and 'high in protein' phrasing", () => {
    const typo = parseTurn("which are the high protiend food avaiable");
    expect(typo.constraints.protein).toBe("high");
    expect(typo.constraints.available).toBe(true);
    expect(typo.focus).toBe("protein");

    const rich = parseTurn("what's high in protein");
    expect(rich.constraints.protein).toBe("high");
    expect(rich.focus).toBe("protein");

    const richPhrase = parseTurn("show me something rich in protein under ₹150");
    expect(richPhrase.constraints.protein).toBe("high");
    expect(richPhrase.constraints.budget).toBe(150);
  });
});

// ─── Nutrition estimates ───────────────────────────────────────────────────────

describe("estimateNutrition — honest estimates, never fake precision", () => {
  it("labels values as estimated and rounds cleanly", () => {
    const dosa = estimateNutrition({ name: "Masala Dosa" });
    expect(dosa.estimated).toBe(true);
    expect(Number.isInteger(dosa.calories)).toBe(true);
    expect(dosa.vegetarian).toBe(true);
    expect(formatCalories(dosa.calories)).toMatch(/^~\d+ kcal$/);
  });

  it("detects non-veg and egg/dairy markers", () => {
    expect(estimateNutrition({ name: "Chicken Roll" }).vegetarian).toBe(false);
    expect(estimateNutrition({ name: "Egg Sandwich" }).containsEgg).toBe(true);
    expect(estimateNutrition({ name: "Paneer Fried Rice" }).containsDairy).toBe(true);
  });

  it("uses explicit product nutrition when present and labels it verified", () => {
    const verified = estimateNutrition({ name: "Masala Dosa", nutrition: { calories: 417, protein: 7.4, carbs: 40, fat: 13, fiber: 2 } });
    expect(verified.calories).toBe(417);
    expect(verified.estimated).toBe(false);
    expect(verified.source).toBe("product");
  });

  it("sums cart macros", () => {
    const total = sumNutrition([
      { item: { name: "Chicken Roll" }, quantity: 1 },
      { item: { name: "French Fries" }, quantity: 2 },
    ]);
    expect(total.calories).toBeGreaterThan(0);
    expect(total.items).toBe(3);
  });
});

// ─── Engine — the spec §18 scenarios, end to end ───────────────────────────────

describe("handleAssistantTurn — real-data answers", () => {
  it("1: 'I want something under ₹100.' returns only budget-eligible items", async () => {
    const res = await ask("I want something under ₹100.");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    expect(res.data.items.length).toBeGreaterThan(0);
    res.data.items.forEach((item) => expect(item.price).toBeLessThanOrEqual(100));
  });

  it("2: 'What's high in protein?' ranks by protein", async () => {
    const res = await ask("What's high in protein?");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    const proteins = res.data.items.map((item) => item.nutrition.protein);
    expect(proteins[0]).toBeGreaterThanOrEqual(proteins[1]);
  });

  it("2b: typo'd 'which are the high protiend food avaiable' still ranks by protein", async () => {
    const res = await ask("which are the high protiend food avaiable");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    const proteins = res.data.items.map((item) => item.nutrition.protein);
    expect(proteins[0]).toBeGreaterThanOrEqual(proteins[1]);
    expect(res.data.items[0].nutrition.protein).toBeGreaterThanOrEqual(proteins[1]);
  });

  it("2c: never throws on messy real-world product documents", async () => {
    const messy = {
      products: [
        { id: "m1", name: "Special Combo", price: null, isSpecial: true, specialDiscountPercent: 10 },
        { id: "m2", name: "A", category: "Beverages", available: true },
        { id: "m3", name: "Chicken Biryani", price: 150, available: false, shop: "Fresheteria" },
        { id: "m4", name: "Masala Dosa", price: 80, available: true, shop: "Falcon Veg", nutrition: { calories: 300, protein: 8 } },
        {},
      ],
      shopStatus: { "Falcon Veg": { is_open: true } },
      orderSignals: [{ items: [] }, { items: [{ id: "m4" }] }],
      userOrders: [
        { id: "o", items: [{ id: "m4", quantity: 1 }], created_at: new Date(Date.now() - 3600000) },
        { items: null },
      ],
      signedIn: true,
      now: new Date(),
    };
    for (const q of ["what's high in protein", "show me something under ₹100", "what's available right now", "compare dosa and biryani", "build me a meal under ₹150", "what do i usually order"]) {
      const res = await handleAssistantTurn({ messages: [{ role: "user", content: q }], context: { activeShop: null, activeTab: "menu", cart: [] }, snapshot: messy });
      expect(res).toHaveProperty("type");
      expect(res).toHaveProperty("reply");
    }
  });

  it("3: 'Show me vegetarian foods under ₹150.' filters veg + budget", async () => {
    const res = await ask("Show me vegetarian foods under ₹150.");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    res.data.items.forEach((item) => {
      expect(item.nutrition.vegetarian).toBe(true);
      expect(item.price).toBeLessThanOrEqual(150);
    });
  });

  it("4: 'I have ₹200. Build me lunch.' returns a plan within budget", async () => {
    const res = await ask("I have ₹200. Build me lunch.");
    expect(res.type).toBe(RESPONSE_TYPE.MEAL_PLAN);
    expect(res.data.total).toBeLessThanOrEqual(200);
    expect(res.data.items.length).toBeGreaterThan(0);
    expect(res.actions[0].type).toBe("ADD_ITEMS");
  });

  it("5: 'What has the most protein today?' picks the highest-protein item", async () => {
    const res = await ask("What has the most protein today?");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    const maxProtein = Math.max(...PRODUCTS.map((p) => estimateNutrition(p).protein));
    expect(res.data.items[0].nutrition.protein).toBe(maxProtein);
  });

  it("6: 'Compare chicken roll and egg sandwich.' builds a real comparison", async () => {
    const res = await ask("Compare chicken roll and egg sandwich.");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_COMPARISON);
    const names = res.data.items.map((i) => i.name);
    expect(names).toContain("Chicken Roll");
    expect(names).toContain("Egg Sandwich");
    expect(res.data.summary.byProtein).toBe("Chicken Roll");
  });

  it("7: 'How many calories are in my cart?' summarizes the real cart", async () => {
    const snapshot = makeSnapshot({ cart: [{ id: "p2", quantity: 1 }, { id: "p4", quantity: 2 }] });
    const res = await ask("How many calories are in my cart?", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.CART_SUMMARY);
    expect(res.data.total).toBe(90 + 60 * 2);
    expect(res.data.itemCount).toBe(3);
    expect(res.data.nutrition.calories).toBeGreaterThan(0);
  });

  it("8: 'Make my cart cheaper.' proposes a swap, not a direct mutation", async () => {
    const snapshot = makeSnapshot({ cart: [{ id: "p2", quantity: 1 }, { id: "p4", quantity: 1 }] });
    const res = await ask("Make my cart cheaper.", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.CONFIRMATION);
    expect(res.actions.map((a) => a.type)).toEqual(["REMOVE_ITEM", "ADD_ITEM"]);
    expect(res.actions[0].productId).toBe("p2");
    expect(res.actions[1].productId).toBe("p3");
  });

  it("9: 'What do I usually order?' uses the user's OWN history", async () => {
    const snapshot = makeSnapshot({ userOrders: usualOrders });
    const res = await ask("What do I usually order?", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.RECOMMENDATION_LIST);
    expect(res.data.items[0].name).toBe("Masala Dosa");
  });

  it("10: 'Order my usual.' proposes adding the usuals with confirmation", async () => {
    const snapshot = makeSnapshot({ userOrders: usualOrders });
    const res = await ask("Order my usual.", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.CONFIRMATION);
    expect(res.actions[0].type).toBe("ADD_ITEMS");
    expect(res.actions[0].items.length).toBeGreaterThan(0);
  });

  it("11: 'Show me something similar to dosa.' uses the similarity engine", async () => {
    const res = await ask("Show me something similar to dosa.");
    expect(res.type).toBe(RESPONSE_TYPE.RECOMMENDATION_LIST);
    const names = res.data.items.map((i) => i.name);
    expect(names.some((n) => n.toLowerCase().includes("dosa"))).toBe(true);
  });

  it("12: 'What should I eat today?' returns personalized picks", async () => {
    const snapshot = makeSnapshot({ userOrders: usualOrders });
    const res = await ask("What should I eat today?", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.RECOMMENDATION_LIST);
    expect(res.data.items.length).toBeGreaterThan(0);
  });

  it("13: 'What's available right now?' returns only available food", async () => {
    const res = await ask("What's available right now?");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    res.data.items.forEach((item) => expect(item.available).toBe(true));
  });

  it("14: 'Add two masala dosas.' proposes a quantity-2 add with confirmation", async () => {
    const res = await ask("Add two masala dosas.");
    expect(res.type).toBe(RESPONSE_TYPE.CONFIRMATION);
    expect(res.actions[0]).toMatchObject({ type: "ADD_ITEM", productId: "p1", quantity: 2 });
  });

  it("15: 'Add coffee.' is ambiguous → asks which one", async () => {
    const res = await ask("Add coffee.");
    expect(res.type).toBe(RESPONSE_TYPE.CLARIFICATION);
    expect(res.data.options.map((o) => o.name)).toEqual(["Cold Coffee", "Hot Coffee"]);
  });

  it("15b: picking a clarification option resumes the add", async () => {
    const snapshot = makeSnapshot();
    const first = await ask("Add coffee.", { snapshot });
    const res = await handleAssistantTurn({
      messages: [
        { role: "user", content: "Add coffee." },
        { role: "assistant", content: first.reply, type: first.type, data: first.data },
        { role: "user", content: "the hot coffee", kind: "pick", data: { productId: "p6" } },
      ],
      context,
      snapshot,
    });
    expect(res.type).toBe(RESPONSE_TYPE.CONFIRMATION);
    expect(res.actions[0]).toMatchObject({ type: "ADD_ITEM", productId: "p6", quantity: 1 });
  });

  it("16: 'Remove the fries.' proposes removal of the cart item", async () => {
    const snapshot = makeSnapshot({ cart: [{ id: "p4", quantity: 1 }] });
    const res = await ask("Remove the fries.", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.CONFIRMATION);
    expect(res.actions[0]).toMatchObject({ type: "REMOVE_ITEM", productId: "p4" });
  });

  it("17: 'Build me a meal with at least 25g protein under ₹180.'", async () => {
    const res = await ask("Build me a meal with at least 25g protein under ₹180.");
    expect(res.type).toBe(RESPONSE_TYPE.MEAL_PLAN);
    expect(res.data.total).toBeLessThanOrEqual(180);
    expect(res.data.totalProtein).toBeGreaterThanOrEqual(25);
  });

  it("18: 'I'm hungry, but I don't want something too heavy.' returns food", async () => {
    const res = await ask("I'm hungry, but I don't want something too heavy.");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    expect(res.data.items.length).toBeGreaterThan(0);
  });

  it("19: 'What's the best vegetarian option today?' returns only veg", async () => {
    const res = await ask("What's the best vegetarian option today?");
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    res.data.items.forEach((item) => expect(item.nutrition.vegetarian).toBe(true));
  });

  it("20: 'I want something high protein that I haven't ordered recently.' excludes recent orders", async () => {
    const snapshot = makeSnapshot({ userOrders: recentOrders });
    const res = await ask("I want something high protein that I haven't ordered recently.", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    const ids = new Set(res.data.items.map((i) => i.id));
    expect(ids.has("p4")).toBe(false); // French Fries — ordered yesterday
    expect(ids.has("p5")).toBe(false); // Cold Coffee — ordered 2 days ago
    expect(res.data.items[0].name).toBe("Chicken Biryani");
  });

  it("handles unavailable-food and no-results gracefully", async () => {
    const res = await ask("Show me something under ₹10.");
    expect(res.type).toBe(RESPONSE_TYPE.ERROR);
    expect(res.reply).toMatch(/No matching foods/);
  });

  it("never mutates data — every write comes back as a ProposedAction", async () => {
    const snapshot = makeSnapshot();
    const res = await ask("Add two masala dosas.", { snapshot });
    expect(res.actions.length).toBe(1);
    expect(res.actions[0]).toMatchObject({ type: "ADD_ITEM", productId: "p1" });
  });
});

// ─── Conversational memory (spec §6) ───────────────────────────────────────────

describe("handleAssistantTurn — conversational memory", () => {
  it("merges follow-up modifiers into the running search", async () => {
    const snapshot = makeSnapshot();
    const first = await ask("Show me high-protein foods.", { snapshot });

    const second = await handleAssistantTurn({
      messages: [
        { role: "user", content: "Show me high-protein foods." },
        { role: "assistant", content: first.reply, type: first.type, data: first.data, constraints: first.constraints },
        { role: "user", content: "Vegetarian only." },
      ],
      context,
      snapshot,
    });
    expect(second.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    second.data.items.forEach((item) => {
      expect(item.nutrition.vegetarian).toBe(true);
      expect(item.nutrition.protein).toBeGreaterThanOrEqual(second.data.items[second.data.items.length - 1].nutrition.protein);
    });
    // The very first turn was protein-ranked too.
    expect(first.data.items[0].nutrition.protein).toBeGreaterThanOrEqual(first.data.items[1].nutrition.protein);

    const third = await handleAssistantTurn({
      messages: [
        { role: "user", content: "Show me high-protein foods." },
        { role: "assistant", content: first.reply, type: first.type, data: first.data, constraints: first.constraints },
        { role: "user", content: "Vegetarian only." },
        { role: "assistant", content: second.reply, type: second.type, data: second.data, constraints: second.constraints },
        { role: "user", content: "Under ₹120." },
      ],
      context,
      snapshot,
    });
    expect(third.type).toBe(RESPONSE_TYPE.FOOD_LIST);
    third.data.items.forEach((item) => {
      expect(item.nutrition.vegetarian).toBe(true);
      expect(item.price).toBeLessThanOrEqual(120);
    });
  });

  it("guest (signed out) is told to sign in for personalization", async () => {
    const snapshot = makeSnapshot({ signedIn: false });
    const res = await ask("What do I usually order?", { snapshot });
    expect(res.type).toBe(RESPONSE_TYPE.ERROR);
    expect(res.data.signInRequired).toBe(true);
  });
});

// ─── LLM interpreter seam ───────────────────────────────────────────────────────

describe("handleAssistantTurn — interpreter seam", () => {
  it("uses the async interpreter's turn when it maps to a known intent", async () => {
    const snapshot = makeSnapshot();
    const res = await handleAssistantTurn({
      messages: [{ role: "user", content: "get me two dosas and fries" }],
      context,
      snapshot,
      interpreter: async () => ({
        intent: "cart_add_multi",
        items: [{ name: "Masala Dosa", quantity: 2 }, { name: "French Fries", quantity: 1 }],
      }),
    });
    expect(res.type).toBe(RESPONSE_TYPE.CONFIRMATION);
    expect(res.actions[0].type).toBe("ADD_ITEMS");
    const ids = res.actions[0].items.map((line) => line.productId);
    expect(ids).toEqual(["p1", "p4"]);
    expect(res.actions[0].items[0].quantity).toBe(2);
  });

  it("falls back to the deterministic parser when the interpreter returns null", async () => {
    const snapshot = makeSnapshot({ cart: [{ id: "p1", quantity: 2 }] });
    const res = await handleAssistantTurn({
      messages: [{ role: "user", content: "what's in my cart?" }],
      context,
      snapshot,
      interpreter: async () => null,
    });
    expect(res.type).toBe(RESPONSE_TYPE.CART_SUMMARY);
  });

  it("renders a clarify turn as a clarification response", async () => {
    const res = await handleAssistantTurn({
      messages: [{ role: "user", content: "add pizza" }],
      context,
      snapshot: makeSnapshot(),
      interpreter: async () => ({ intent: "clarify", question: "Which pizza would you like?" }),
    });
    expect(res.type).toBe(RESPONSE_TYPE.CLARIFICATION);
    expect(res.reply).toBe("Which pizza would you like?");
  });

  it("ignores an interpreter that throws or returns an unknown intent", async () => {
    const snapshot = makeSnapshot();
    const throwing = await handleAssistantTurn({
      messages: [{ role: "user", content: "what's available?" }],
      context,
      snapshot,
      interpreter: async () => {
        throw new Error("boom");
      },
    });
    expect(throwing.type).not.toBe(RESPONSE_TYPE.ERROR);

    const unknownIntent = await handleAssistantTurn({
      messages: [{ role: "user", content: "what's available?" }],
      context,
      snapshot,
      interpreter: async () => ({ intent: "self_destruct" }),
    });
    expect(unknownIntent.type).not.toBe(RESPONSE_TYPE.ERROR);
  });
});
