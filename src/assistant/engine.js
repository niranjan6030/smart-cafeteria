// Food Assistant — turn orchestrator.
//
// Pipeline (spec §3): CONVERSATION → UNDERSTAND INTENT → QUERY REAL DATA → APPLY CONSTRAINTS
// → USE PERSONALIZATION → RANK RESULTS → RESPOND NATURALLY → ALLOW USER ACTION.
//
// This module is the single seam the backend calls. It owns conversational memory (merging
// follow-up constraints), intent dispatch, and structured-response assembly. Every write intent
// (add/remove/update cart) is returned as a ProposedAction the CLIENT applies through the app's
// existing command engine — the assistant never mutates data itself.

import { parseTurn } from "./intentParser.js";
import { RESPONSE_TYPE, ACTION_TYPE } from "./types.js";
import {
  buildMealPlan,
  cartSummary,
  compareFoods,
  foodItemToData,
  getRecentOrders,
  getUsuals,
  popularToday,
  recommendFoods,
  resolveFood,
  searchFoods,
  similarFoods,
  suggestCheaperCart,
} from "./foodTools.js";

const MAX_RESULTS = 4;

// ─── helpers ───────────────────────────────────────────────────────────────────

const money = (value) => `₹${Math.round(Number(value) || 0)}`;

const QUICK_ACTIONS = [
  "High protein",
  "Under ₹100",
  "Low calorie",
  "Vegetarian",
  "Popular today",
  "My usuals",
  "What's available?",
  "Nutrition info",
];

function recentlyOrderedIds(userOrders, now, days = 14) {
  const cutoff = now.getTime() - days * 86400000;
  const ids = new Set();
  (userOrders || []).forEach((order) => {
    const ts = order?.created_at;
    const ms = ts ? (typeof ts.toMillis === "function" ? ts.toMillis() : ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : null) : null;
    if (ms == null || ms < cutoff) return;
    (order?.items || []).forEach((line) => {
      const id = line?.id || line;
      if (id) ids.add(id);
    });
  });
  return [...ids];
}

function lastFoodContext(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant" && ["FOOD_LIST", "RECOMMENDATION_LIST", "MEAL_PLAN", "CART_SUMMARY", "NUTRITION_RESULT"].includes(msg.type) && msg.constraints) {
      return msg;
    }
  }
  return null;
}

function lastClarification(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.type === "CLARIFICATION" && msg.data?.pending) return msg;
  }
  return null;
}

function mergeConstraints(base, next) {
  const merged = { ...(base || {}) };
  ["budget", "minProtein", "maxCalories", "vegetarian", "vegan", "nonVeg", "protein", "calories", "filling", "light", "affordable", "meal", "stall", "category", "available", "excludeRecent", "containsEgg", "containsDairy", "containsNuts"].forEach((key) => {
    if (next?.[key]) merged[key] = next[key];
  });
  return merged;
}

// ─── handlers ──────────────────────────────────────────────────────────────────

function respond(items, reply, extra = {}) {
  return { type: RESPONSE_TYPE.FOOD_LIST, reply, data: { items }, actions: [], ...extra };
}

function noFoodsFound(constraints) {
  const hints = [];
  if (constraints.budget != null) hints.push("raising your budget");
  if (constraints.vegetarian) hints.push("loosening the veg filter");
  if (constraints.available) hints.push("checking back later");
  const hintText = hints.length > 0 ? ` Try ${hints.join(" or ")}.` : "";
  return {
    type: RESPONSE_TYPE.ERROR,
    reply: `No matching foods found right now${hintText}`,
    data: { empty: true, suggestions: ["Show me the menu", "Popular today", "What's available?"] },
    actions: [],
  };
}

function handleFoodSearch({ turn, constraints, snapshot, context, activeConstraints }) {
  const merged = mergeConstraints(activeConstraints, constraints);
  const excludeIds = merged.excludeRecent ? recentlyOrderedIds(snapshot.userOrders, snapshot.now) : [];
  const search = searchFoods(snapshot.products, merged, {
    focus: turn.focus,
    maxResults: MAX_RESULTS,
    activeShop: context.activeShop,
    excludeIds,
  });

  if (search.items.length === 0) return noFoodsFound(merged);

  const top = search.items[0];
  const explain = [];
  if (merged.budget != null) explain.push(`fits your ${money(merged.budget)} budget`);
  if (merged.protein === "high" || turn.focus === "protein") explain.push("highest protein");
  if (merged.vegetarian) explain.push("vegetarian");
  if (merged.available) explain.push("available today");
  if (merged.excludeRecent) explain.push("you haven't ordered recently");

  const reply = `Here are strong matches${explain.length ? ` — ${explain.join(", ")}` : ""}. ${top.name} — ${money(top.price)} · ${top.nutrition.protein}g protein${top.nutrition.estimated ? " (estimated)" : ""}.`;

  const suggestions = [`Add ${top.name}`, "Higher protein", merged.budget != null ? `Under ₹${merged.budget}` : "Under ₹100"];
  return respond(search.items, reply, {
    constraints: { ...merged, focus: turn.focus || null },
    data: { items: search.items },
    suggestions,
  });
}

function handleNutrition({ turn, snapshot, context }) {
  const phrase = turn.itemPhrase;
  const result = resolveFood(phrase, snapshot.products, { activeShop: context.activeShop });

  if (!result.match) {
    if (result.candidates.length > 0) {
      return {
        type: RESPONSE_TYPE.CLARIFICATION,
        reply: "Which one did you mean?",
        data: { options: result.candidates.map(({ product }) => foodItemToData(product)), pending: { intent: "nutrition", itemPhrase: phrase } },
        actions: [],
      };
    }
    return { type: RESPONSE_TYPE.ERROR, reply: `I couldn't find "${phrase}" on today's menu. Try searching the menu or asking for something similar.`, data: { empty: true, suggestions: ["Show me the menu", "Popular today"] }, actions: [] };
  }

  const item = foodItemToData(result.match);
  const macro = item.nutrition;
  const focus = turn.focus || (/(calorie|calories)/.test(turn.raw) ? "calories" : /protein/.test(turn.raw) ? "protein" : null);

  let reply = `${item.name} — ${money(item.price)}.`;
  if (macro.estimated) reply += " Estimated nutrition: ";
  else reply += " Nutrition: ";
  reply += `${Math.round(macro.calories)} kcal · ${Math.round(macro.protein)}g protein · ${Math.round(macro.carbs)}g carbs · ${Math.round(macro.fat)}g fat`;
  if (focus === "calories") reply = `${item.name} is around ${Math.round(macro.calories)} kcal${macro.estimated ? " (estimated)" : ""}. ${Math.round(macro.protein)}g protein · ${Math.round(macro.carbs)}g carbs · ${Math.round(macro.fat)}g fat.`;
  if (focus === "protein") reply = `${item.name} has around ${Math.round(macro.protein)}g protein${macro.estimated ? " (estimated)" : ""} — ${Math.round(macro.calories)} kcal, ${Math.round(macro.carbs)}g carbs, ${Math.round(macro.fat)}g fat.`;
  if (macro.vegetarian && macro.vegan) reply += " It's vegan.";
  else if (macro.vegetarian) reply += " It's vegetarian.";

  return {
    type: RESPONSE_TYPE.NUTRITION_RESULT,
    reply,
    data: { item, focus, estimated: macro.estimated },
    actions: [{ type: ACTION_TYPE.ADD_ITEM, productId: item.id, quantity: 1, product: { ...item }, label: `Add ${item.name}` }],
    constraints: {},
  };
}

function handleCompare({ turn, snapshot, context }) {
  const phrases = turn.itemPhrases || [];
  const result = compareFoods(snapshot.products, phrases, { activeShop: context.activeShop });

  if (result.items.length < 2) {
    const known = result.items[0]?.name || null;
    const missing = result.failed.join(", ");
    const reply = known
      ? `I found ${known}, but couldn't match "${missing}". Want me to compare ${known} with a similar item instead?`
      : "I couldn't match those foods. Try naming two items, like “compare dosa and sandwich”.";
    return { type: RESPONSE_TYPE.ERROR, reply, data: { items: result.items, failed: result.failed }, actions: [] };
  }

  let reply = "Here's the comparison:";
  if (result.summary.byProtein) reply += ` Highest protein — ${result.summary.byProtein}.`;
  if (result.summary.byCalories) reply += ` Lowest calories — ${result.summary.byCalories}.`;
  if (result.summary.cheapest) reply += ` Cheapest — ${result.summary.cheapest}.`;

  return {
    type: RESPONSE_TYPE.FOOD_COMPARISON,
    reply,
    data: { items: result.items, summary: result.summary },
    actions: result.items.map((item) => ({ type: ACTION_TYPE.ADD_ITEM, productId: item.id, quantity: 1, product: { ...item }, label: `Add ${item.name}` })),
    constraints: {},
  };
}

function handleRecommend({ turn, snapshot, context, constraints, activeConstraints }) {
  // "What's the best vegetarian option today?" carries hard filters — those belong to the
  // search/rank pipeline, not the personalization engine.
  const hard = constraints.vegetarian || constraints.vegan || constraints.nonVeg ||
    constraints.budget != null || constraints.stall || constraints.meal ||
    constraints.available || constraints.protein || constraints.calories || constraints.light;
  if (hard) return handleFoodSearch({ turn, constraints, snapshot, context, activeConstraints });

  const result = recommendFoods({
    products: snapshot.products,
    userOrders: snapshot.userOrders || [],
    cooccurrenceOrders: snapshot.orderSignals || [],
    cart: snapshot.cart || [],
    now: snapshot.now,
    maxResults: MAX_RESULTS,
    activeShop: context.activeShop,
  });

  if (result.items.length === 0) return noFoodsFound({});

  const reply = result.hasHistory
    ? "Here's what I'd go for, based on what you usually order:"
    : "Here are popular picks for right now:";

  return {
    type: RESPONSE_TYPE.RECOMMENDATION_LIST,
    reply,
    data: { items: result.items, hasHistory: result.hasHistory },
    actions: [],
    constraints: {},
    suggestions: [`Add ${result.items[0]?.name}`, "Show me my usuals"],
  };
}

function handleUsuals({ snapshot }) {
  if (!snapshot.signedIn) {
    return { type: RESPONSE_TYPE.ERROR, reply: "Sign in to see your usuals — I'll only use your own order history.", data: { signInRequired: true, suggestions: ["Popular today"] }, actions: [] };
  }
  const items = getUsuals(snapshot.userOrders, snapshot.products);
  if (items.length === 0) return { type: RESPONSE_TYPE.ERROR, reply: "You don't have any order history yet — try something from today's menu.", data: { empty: true, suggestions: ["Show me the menu", "Popular today"] }, actions: [] };
  return respond(items, "Your usuals — based on what you actually order:", { type: RESPONSE_TYPE.RECOMMENDATION_LIST, data: { items, hasHistory: true } });
}

function handleRecentOrders({ snapshot }) {
  if (!snapshot.signedIn) return { type: RESPONSE_TYPE.ERROR, reply: "Sign in to see your order history.", data: { signInRequired: true }, actions: [] };
  const orders = getRecentOrders(snapshot.userOrders);
  if (orders.length === 0) return { type: RESPONSE_TYPE.ERROR, reply: "You haven't placed an order yet. Want me to suggest something?", data: { empty: true, suggestions: ["Popular today", "What's available?"] }, actions: [] };

  const latest = orders[0];
  const names = (latest.items || []).map((line) => line.name).filter(Boolean);
  const reply = `Your most recent order (${latest.shop})${names.length ? `: ${names.join(", ")}` : ""}. Want me to reorder it?`;

  return {
    type: RESPONSE_TYPE.TEXT,
    reply,
    data: { orders: orders.slice(0, 3), latest },
    actions: latest.items?.length ? [{ type: ACTION_TYPE.OPEN_CART, label: "Open cart" }] : [],
    suggestions: ["Reorder my usual", "What did I order yesterday?"],
  };
}

function handleReorderUsuals({ snapshot }) {
  if (!snapshot.signedIn) return { type: RESPONSE_TYPE.ERROR, reply: "Sign in first and I'll bring back your usual order.", data: { signInRequired: true }, actions: [] };
  const usuals = getUsuals(snapshot.userOrders, snapshot.products, { maxResults: 3 });
  if (usuals.length === 0) return { type: RESPONSE_TYPE.ERROR, reply: "No usuals yet — order something first and it'll show up here.", data: { empty: true }, actions: [] };

  const items = usuals.map((item) => ({ productId: item.id, quantity: 1, product: { ...item } }));
  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply: `Add your usuals to the cart? ${usuals.map((item) => item.name).join(", ")}`,
    data: { items: usuals, summary: usuals.map((item) => `${item.name} — ${money(item.price)}`).join(" · ") },
    actions: [{ type: ACTION_TYPE.ADD_ITEMS, items, label: `Add your usuals` }],
  };
}

function handleSimilar({ turn, snapshot, context }) {
  if (!turn.itemPhrase) return { type: RESPONSE_TYPE.ERROR, reply: "Similar to what? Name a dish and I'll find its closest matches.", data: { suggestions: ["Similar to dosa", "What's available?"] }, actions: [] };
  const seed = resolveFood(turn.itemPhrase, snapshot.products, { activeShop: context.activeShop });
  const seedItem = seed.match || seed.candidates[0]?.product || null;
  if (!seedItem) {
    return { type: RESPONSE_TYPE.ERROR, reply: `I couldn't find "${turn.itemPhrase}" on today's menu.`, data: { suggestions: ["Show me the menu"] }, actions: [] };
  }
  const items = similarFoods(snapshot.products, seedItem.id);
  if (items.length === 0) return noFoodsFound({});
  return respond(items, `Similar to ${seedItem.name}:`, { type: RESPONSE_TYPE.RECOMMENDATION_LIST, data: { items, hasHistory: false }, constraints: {} });
}

function handlePopular({ snapshot }) {
  const items = popularToday(snapshot.products, { maxResults: MAX_RESULTS });
  if (items.length === 0) return noFoodsFound({});
  return respond(items, "Popular right now:", { type: RESPONSE_TYPE.RECOMMENDATION_LIST, data: { items, hasHistory: false }, constraints: { available: true } });
}

function handleAvailability({ snapshot }) {
  const items = searchFoods(snapshot.products, { available: true }, { maxResults: MAX_RESULTS, focus: "popular" });
  if (items.items.length === 0) return noFoodsFound({ available: true });
  return respond(items.items, "Available right now — here are the most popular options:", { data: { items: items.items }, constraints: { available: true } });
}

function handleStall({ turn, snapshot }) {
  const constraints = { stall: turn.constraints.stall || turn.stallPhrase, available: true };
  const items = searchFoods(snapshot.products, constraints, { maxResults: MAX_RESULTS, focus: "popular" });
  if (items.items.length === 0) return noFoodsFound(constraints);
  const stall = turn.constraints.stall || turn.stallPhrase;
  return respond(items.items, `Here's what ${stall} has right now:`, { constraints: { ...constraints } });
}

function handlePrice({ turn, snapshot, context }) {
  const result = resolveFood(turn.itemPhrase, snapshot.products, { activeShop: context.activeShop });
  if (!result.match) return { type: RESPONSE_TYPE.ERROR, reply: `I couldn't find "${turn.itemPhrase}" on the menu.`, data: { empty: true }, actions: [] };
  const item = foodItemToData(result.match);
  const serving = item.nutrition.estimated ? " (~" + item.nutrition.protein + "g protein)" : "";
  return respond([item], `${item.name} — ${money(item.price)}${serving}. It's available at ${item.shop}.`, { constraints: {} });
}

function handleMealBuilder({ turn, snapshot, activeConstraints }) {
  const constraints = mergeConstraints(activeConstraints, turn.constraints);
  const plan = buildMealPlan(snapshot.products, { ...constraints, minProtein: constraints.minProtein ?? null });

  if (plan.items.length === 0) {
    if (plan.budget == null) {
      return { type: RESPONSE_TYPE.CLARIFICATION, reply: "What's your budget? I'll build the best protein combo I can find under it.", data: { pending: { intent: "meal_builder" }, suggestions: ["Under ₹150", "Under ₹200"] }, actions: [] };
    }
    return { type: RESPONSE_TYPE.ERROR, reply: plan.note || "Couldn't build a meal with those constraints.", data: { empty: true, suggestions: ["Under ₹150", "Under ₹200"] }, actions: [] };
  }

  const actions = [{
    type: ACTION_TYPE.ADD_ITEMS,
    items: plan.items.map((item) => ({ productId: item.id, quantity: item.quantity, product: { ...item } })),
    label: "Add all to cart",
  }];

  const reply = `Best combo I found${plan.budget != null ? ` under ${money(plan.budget)}` : ""}: ${plan.items.map((item) => `${item.quantity}× ${item.name}`).join(" + ")} — ${money(plan.total)}, ~${plan.totalProtein}g protein.`;
  return {
    type: RESPONSE_TYPE.MEAL_PLAN,
    reply,
    data: { items: plan.items, total: plan.total, totalProtein: plan.totalProtein, totalCalories: plan.totalCalories, budget: plan.budget },
    actions,
    constraints,
  };
}

function handleCartQuery({ snapshot, context }) {
  const summary = cartSummary(context.cart, snapshot.products);
  if (summary.lines.length === 0) {
    return { type: RESPONSE_TYPE.CART_SUMMARY, reply: "Your cart is empty. Ask me for suggestions or add something you like.", data: { ...summary, empty: true }, actions: [], suggestions: ["High protein", "Under ₹100", "Popular today"] };
  }
  const reply = `Your cart: ${summary.itemCount} item${summary.itemCount === 1 ? "" : "s"} — ${money(summary.total)}, ~${summary.nutrition.calories} kcal, ${summary.nutrition.protein}g protein.`;
  return { type: RESPONSE_TYPE.CART_SUMMARY, reply, data: summary, actions: [{ type: ACTION_TYPE.OPEN_CART, label: "Open cart" }] };
}

function handleCartCheaper({ snapshot, context }) {
  const suggestion = suggestCheaperCart(context.cart, snapshot.products, { activeShop: context.activeShop });
  if (!suggestion) {
    return { type: RESPONSE_TYPE.ERROR, reply: "Your cart is empty — there's nothing to trim.", data: { empty: true, suggestions: ["What's in my cart?"] }, actions: [] };
  }
  if (suggestion.alternatives.length === 0) {
    return { type: RESPONSE_TYPE.ERROR, reply: `Nothing cheaper is available to replace ${suggestion.target.name} right now.`, data: { empty: true }, actions: [] };
  }
  const alt = suggestion.alternatives[0];
  const saving = suggestion.currentSpend - alt.price * suggestion.quantity;
  const reply = `Swap ${suggestion.target.name} for ${alt.name} and save about ${money(Math.max(0, saving))}.`;

  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply,
    data: { target: suggestion.target, alternatives: suggestion.alternatives, saving: Math.max(0, saving) },
    actions: [
      { type: ACTION_TYPE.REMOVE_ITEM, productId: suggestion.target.id, label: `Remove ${suggestion.target.name}` },
      { type: ACTION_TYPE.ADD_ITEM, productId: alt.id, quantity: suggestion.quantity, product: { ...alt }, label: `Add ${alt.name}` },
    ],
  };
}

function resolveForCart(turn, snapshot, context) {
  return resolveFood(turn.itemPhrase, snapshot.products, { activeShop: context.activeShop });
}

function handleCartAdd({ turn, snapshot, context }) {
  const result = resolveForCart(turn, snapshot, context);
  const quantity = turn.quantity || 1;

  if (!result.match && result.candidates.length > 0) {
    return {
      type: RESPONSE_TYPE.CLARIFICATION,
      reply: "Which one would you like?",
      data: { options: result.candidates.map(({ product }) => foodItemToData(product)), pending: { intent: "cart_add", itemPhrase: turn.itemPhrase, quantity } },
      actions: [],
    };
  }
  if (!result.match) {
    return {
      type: RESPONSE_TYPE.ERROR,
      reply: `I couldn't find "${turn.itemPhrase}" on today's menu.`,
      data: { empty: true, suggestions: ["Show me the menu", "Popular today"] },
      actions: [],
    };
  }

  const item = foodItemToData(result.match);
  const alreadyInCart = (context.cart || []).some((line) => line.id === item.id);
  const reply = alreadyInCart
    ? `That's already in your cart. Add another ${quantity > 1 ? `${quantity} more ` : ""}${item.name}?`
    : `Add ${quantity > 1 ? `${quantity}× ` : ""}${item.name}${quantity > 1 ? "s" : ""} to your cart?`;

  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply,
    data: { item, quantity, summary: `${quantity}× ${item.name} — ${money(item.price * quantity)}` },
    actions: [{ type: ACTION_TYPE.ADD_ITEM, productId: item.id, quantity, product: { ...item }, label: `Add ${item.name}` }],
  };
}

// Resolves an action phrase against the user's CURRENT cart first (the item must be in it), so
// "remove the dosa" works even when several dosas exist. Returns { item, quantity, ambiguous }.
function resolveInCart(turn, snapshot, context) {
  const result = resolveFood(turn.itemPhrase, snapshot.products, { activeShop: context.activeShop });
  const candidateIds = new Set((result.candidates || []).map((entry) => entry.product.id));
  if (result.match) candidateIds.add(result.match.id);
  const inCartLines = (context.cart || []).filter((line) => candidateIds.has(line.id));
  if (inCartLines.length === 1) {
    const line = inCartLines[0];
    const product = snapshot.products.find((item) => item.id === line.id);
    return { item: foodItemToData(product), quantity: line.quantity, ambiguous: false };
  }
  return { item: null, quantity: 0, ambiguous: inCartLines.length > 1 };
}

function handleCartRemove({ turn, snapshot, context }) {
  const { item, ambiguous } = resolveInCart(turn, snapshot, context);
  if (ambiguous) {
    return {
      type: RESPONSE_TYPE.CLARIFICATION,
      reply: "Which one would you like to remove?",
      data: {
        options: (context.cart || [])
          .map((line) => snapshot.products.find((p) => p.id === line.id))
          .filter(Boolean)
          .map(foodItemToData),
        pending: { intent: "cart_remove", itemPhrase: turn.itemPhrase },
      },
      actions: [],
    };
  }
  if (!item) {
    return { type: RESPONSE_TYPE.ERROR, reply: `I couldn't find "${turn.itemPhrase}" in your cart.`, data: { empty: true }, actions: [] };
  }
  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply: `Remove ${item.name} from your cart?`,
    data: { item, summary: item.name },
    actions: [{ type: ACTION_TYPE.REMOVE_ITEM, productId: item.id, label: `Remove ${item.name}` }],
  };
}

function handleCartUpdate({ turn, snapshot, context }) {
  const { item, ambiguous } = resolveInCart(turn, snapshot, context);
  const quantity = turn.quantity || 1;
  if (ambiguous) {
    return {
      type: RESPONSE_TYPE.CLARIFICATION,
      reply: "Which item did you mean?",
      data: {
        options: (context.cart || [])
          .map((line) => snapshot.products.find((p) => p.id === line.id))
          .filter(Boolean)
          .map(foodItemToData),
        pending: { intent: "cart_update", itemPhrase: turn.itemPhrase, quantity },
      },
      actions: [],
    };
  }
  if (!item) return { type: RESPONSE_TYPE.ERROR, reply: `I couldn't find "${turn.itemPhrase}" in your cart.`, data: { empty: true }, actions: [] };

  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply: `Set ${item.name} quantity to ${quantity}?`,
    data: { item, quantity, summary: `${quantity}× ${item.name}` },
    actions: [{ type: ACTION_TYPE.UPDATE_QUANTITY, productId: item.id, quantity, product: { ...item }, label: `Update ${item.name}` }],
  };
}

function handleCartClear() {
  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply: "Clear your cart?",
    data: { summary: "All items will be removed" },
    actions: [{ type: ACTION_TYPE.REPLACE_CART, items: [], label: "Clear cart" }],
  };
}

// LLM-only intent: a single confirmation covering several resolved items at once.
function handleCartAddMulti({ turn, snapshot, context }) {
  const lines = [];
  const missing = [];
  for (const wanted of (turn.items || []).slice(0, 8)) {
    const result = resolveFood(wanted?.name, snapshot.products, { activeShop: context.activeShop });
    if (result.match) {
      lines.push({ item: foodItemToData(result.match), quantity: Math.max(1, Math.min(20, Math.round(Number(wanted.quantity)) || 1)) });
    } else {
      missing.push(String(wanted?.name || "an item"));
    }
  }

  if (lines.length === 0) {
    return {
      type: RESPONSE_TYPE.ERROR,
      reply: `I couldn't find ${missing.join(" or ")} on today's menu.`,
      data: { empty: true, suggestions: ["Show me the menu", "Popular today"] },
      actions: [],
    };
  }

  const summary = lines.map((line) => `${line.quantity}× ${line.item.name}`).join(" + ");
  const total = lines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const note = missing.length > 0 ? ` (${missing.join(", ")} isn't on the menu today)` : "";

  return {
    type: RESPONSE_TYPE.CONFIRMATION,
    reply: `Add ${summary} to your cart?${note}`,
    data: { items: lines.map((line) => line.item), summary: `${summary} — ${money(total)}` },
    actions: [{
      type: ACTION_TYPE.ADD_ITEMS,
      items: lines.map((line) => ({ productId: line.item.id, quantity: line.quantity, product: { ...line.item } })),
      label: "Add all to cart",
    }],
  };
}

function handleClarify({ turn }) {
  return {
    type: RESPONSE_TYPE.CLARIFICATION,
    reply: String(turn.question || "Could you clarify that?"),
    data: {},
    actions: [],
  };
}

function handleProteinBoost({ snapshot, context }) {
  const inCartIds = new Set((context.cart || []).map((line) => line.id));
  const result = searchFoods(snapshot.products, { available: true, protein: "high" }, { focus: "protein", maxResults: 6 })
    .items
    .filter((item) => !inCartIds.has(item.id))
    .slice(0, 3);

  const top = result[0];
  const reply = result.length === 0
    ? "Everything high-protein is already in your cart."
    : `To bump up the protein, add something like ${top?.name} (${top?.nutrition.protein}g protein).`;

  return {
    type: RESPONSE_TYPE.RECOMMENDATION_LIST,
    reply,
    data: { items: result, hasHistory: false },
    actions: result.length ? [{ type: ACTION_TYPE.ADD_ITEM, productId: result[0].id, quantity: 1, product: { ...result[0] }, label: `Add ${result[0].name}` }] : [],
    constraints: {},
  };
}

// ─── Greetings / meta ──────────────────────────────────────────────────────────

function handleGreeting() {
  return {
    type: RESPONSE_TYPE.TEXT,
    reply: "Hi — I'm the Food Assistant. Ask me about food, nutrition, budgets, or your usuals. For example: “high protein under ₹150”, “compare dosa and sandwich”, or “what's available today?”",
    data: {},
    actions: [],
    suggestions: QUICK_ACTIONS,
  };
}

function handleHelp() {
  return {
    type: RESPONSE_TYPE.TEXT,
    reply: "I can help you discover food, understand nutrition, compare dishes, build a meal on a budget, check your cart, and reorder your usuals. Try asking:",
    data: {},
    actions: [],
    suggestions: QUICK_ACTIONS,
  };
}

function handleUnknown() {
  return {
    type: RESPONSE_TYPE.TEXT,
    reply: "I didn't quite get that. Try something like “high protein under ₹150”, “what's in my cart?”, or “similar to dosa”.",
    data: {},
    actions: [],
    suggestions: QUICK_ACTIONS,
  };
}

// ─── turn dispatch ─────────────────────────────────────────────────────────────

function resolvePendingPick(turn, messages) {
  const clarification = lastClarification(messages);
  if (!clarification) return null;
  const pending = clarification.data?.pending;
  if (!pending) return null;
  const pickedId = turn.data?.productId;
  return { pending, pickedId };
}

const HANDLERS = {
  greeting: handleGreeting,
  thanks: () => ({ type: RESPONSE_TYPE.TEXT, reply: "Happy to help! Anything else you're craving?", data: {}, actions: [], suggestions: QUICK_ACTIONS }),
  help: handleHelp,
  food_search: handleFoodSearch,
  nutrition: handleNutrition,
  compare: handleCompare,
  recommend: handleRecommend,
  usuals: handleUsuals,
  recent_orders: handleRecentOrders,
  reorder_usuals: handleReorderUsuals,
  similar: handleSimilar,
  popular: handlePopular,
  availability: handleAvailability,
  stall: handleStall,
  price: handlePrice,
  meal_builder: handleMealBuilder,
  cart_query: handleCartQuery,
  cart_cheaper: handleCartCheaper,
  cart_clear: handleCartClear,
  cart_add: handleCartAdd,
  cart_add_multi: handleCartAddMulti,
  cart_remove: handleCartRemove,
  cart_update: handleCartUpdate,
  protein_boost: handleProteinBoost,
  clarify: handleClarify,
  open_cart: () => ({
    type: RESPONSE_TYPE.TEXT,
    reply: "Opening your cart…",
    data: {},
    actions: [{ type: ACTION_TYPE.OPEN_CART, label: "Open cart" }],
  }),
  checkout: () => ({
    type: RESPONSE_TYPE.TEXT,
    reply: "Review your cart, then tap Checkout to pay when you're ready.",
    data: {},
    actions: [{ type: ACTION_TYPE.OPEN_CART, label: "Open cart" }],
  }),
  modifier: (args) => handleFoodSearch({ ...args, turn: { ...args.turn, focus: args.turn.focus } }),
  unknown: handleUnknown,
};

/**
 * Handle one assistant turn.
 * @param {object} params
 * @param {Array} params.messages — [{ role, content, type?, data?, constraints? }]
 * @param {object} params.context — { activeShop, activeTab, cart }
 * @param {object} params.snapshot — { products, shopStatus, orderSignals, userOrders, cart, signedIn, now }
 * @param {((raw: string) => Promise<import("./types.js").AssistantTurn | null>)?} params.interpreter — optional async LLM-backed interpreter (server-side only). Returns null to fall back to the deterministic parser.
 * @returns {Promise<import("./types.js").AssistantResponse>}
 */
export async function handleAssistantTurn({ messages, context = {}, snapshot = {}, interpreter }) {
  const now = snapshot.now instanceof Date ? snapshot.now : new Date();
  const cart = context.cart || snapshot.cart || [];
  const safeContext = { activeShop: context.activeShop || null, activeTab: context.activeTab || null, cart };
  const safeSnapshot = {
    ...snapshot,
    products: snapshot.products || [],
    shopStatus: snapshot.shopStatus || {},
    orderSignals: snapshot.orderSignals || [],
    userOrders: snapshot.userOrders || [],
    cart,
    signedIn: Boolean(snapshot.signedIn) && snapshot.userOrders != null,
    now,
  };

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return { type: RESPONSE_TYPE.ERROR, reply: "Ask me something about the food here.", data: {}, actions: [], suggestions: QUICK_ACTIONS };
  }

  // Picked clarification option → resume the pending intent with the chosen product.
  if (lastMessage.kind === "pick" && lastMessage.data?.productId) {
    const resolved = resolvePendingPick(lastMessage, messages);
    if (resolved?.pending) {
      const product = safeSnapshot.products.find((item) => item.id === resolved.pickedId);
      if (product) {
        const item = foodItemToData(product);
        const pending = resolved.pending;
        if (pending.intent === "cart_add") {
          const quantity = pending.quantity || 1;
          return {
            type: RESPONSE_TYPE.CONFIRMATION,
            reply: `Add ${quantity > 1 ? `${quantity}× ` : ""}${item.name} to your cart?`,
            data: { item, quantity, summary: `${quantity}× ${item.name} — ${money(item.price * quantity)}` },
            actions: [{ type: ACTION_TYPE.ADD_ITEM, productId: item.id, quantity, product: { ...item }, label: `Add ${item.name}` }],
          };
        }
        if (pending.intent === "nutrition") {
          return handleNutrition({ turn: { ...lastMessage, itemPhrase: item.name }, snapshot: safeSnapshot, context: safeContext });
        }
        if (pending.intent === "cart_remove") {
          return {
            type: RESPONSE_TYPE.CONFIRMATION,
            reply: `Remove ${item.name} from your cart?`,
            data: { item, summary: item.name },
            actions: [{ type: ACTION_TYPE.REMOVE_ITEM, productId: item.id, label: `Remove ${item.name}` }],
          };
        }
        if (pending.intent === "cart_update") {
          const quantity = pending.quantity || 1;
          return {
            type: RESPONSE_TYPE.CONFIRMATION,
            reply: `Set ${item.name} quantity to ${quantity}?`,
            data: { item, quantity, summary: `${quantity}× ${item.name}` },
            actions: [{ type: ACTION_TYPE.UPDATE_QUANTITY, productId: item.id, quantity, product: { ...item }, label: `Update ${item.name}` }],
          };
        }
      }
    }
  }

  // LLM-backed interpretation first (server-side only); any miss falls back to the
  // deterministic NLU so the assistant degrades gracefully instead of erroring.
  let turn = null;
  if (typeof interpreter === "function") {
    try {
      const candidate = await interpreter(lastMessage.content);
      if (candidate && typeof candidate.intent === "string" && HANDLERS[candidate.intent]) {
        turn = { constraints: {}, quantity: 1, itemPhrase: null, itemPhrases: null, isModifier: false, focus: null, ...candidate, raw: lastMessage.content };
      }
    } catch {
      turn = null;
    }
  }
  if (!turn) turn = parseTurn(lastMessage.content);
  const previous = lastFoodContext(messages);
  const activeConstraints = previous?.constraints ? { ...previous.constraints } : {};
  const base = { turn, constraints: turn.constraints, snapshot: safeSnapshot, context: safeContext, activeConstraints };

  // Bare refinement ("vegetarian only", "under ₹120") merges with the last food response.
  if (turn.isModifier && previous) {
    const mergedTurn = { ...turn, intent: "food_search", focus: previous.constraints?.focus || null };
    return HANDLERS.food_search({ ...base, turn: mergedTurn, constraints: turn.constraints });
  }

  // "higher protein" refinements on top of a meal/cart → protein boost suggestion.
  if (/(higher protein|more protein|add.*protein|protein boost)/.test(turn.raw) && !/show|find|food/.test(turn.raw)) {
    return HANDLERS.protein_boost({ ...base, turn });
  }

  const handler = HANDLERS[turn.intent] || handleUnknown;
  return handler(base);
}
