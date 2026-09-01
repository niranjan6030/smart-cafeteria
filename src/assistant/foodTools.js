// Food Assistant — controlled data tools. Pure functions over a real cafeteria snapshot
// (products, shop status, order signals, the user's own orders). These are the ONLY way the
// assistant touches data: every intent maps to one of these tools; no arbitrary queries.
//
// Reuses the app's existing intelligence where it exists:
//   - entity resolution   → src/core/menu/entityResolver.js (same fuzzy matcher as voice)
//   - recommendations     → src/recommender/recommenderEngine.js (the one real engine)
//   - similarity          → src/recommender/foodMetadata.js
//   - popularity          → src/components/home/rankPopularity.js (cross-stall "most loved")
//   - nutrition estimates → src/recommender/nutrition.js

import { resolveMenuEntity } from "../core/menu/entityResolver.js";
import { computeRecommendations } from "../recommender/recommenderEngine.js";
import { findSimilarItems } from "../recommender/foodMetadata.js";
import { estimateNutrition, sumNutrition } from "../recommender/nutrition.js";
import { rankPopularity } from "../components/home/rankPopularity.js";

const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Map a raw product doc → the enriched FoodItemData the UI renders. */
export function foodItemToData(item, { reason } = {}) {
  const nutrition = estimateNutrition(item);
  return {
    id: item.id,
    name: item.name,
    price: toNum(item.price),
    originalPrice: item.originalPrice != null ? toNum(item.originalPrice) : undefined,
    shop: item.shop === "Fresh Time" ? "Break Time" : item.shop,
    category: item.category,
    image: item.image || null,
    emoji: item.emoji || null,
    rating: item.rating != null ? Number(item.rating) : null,
    reviewCount: item.reviewCount != null ? Number(item.reviewCount) : null,
    isMostSold: Boolean(item.isMostSold),
    available: item.available !== false,
    nutrition,
    reason: reason || null,
  };
}

export const foodData = (item, opts) => foodItemToData(item, opts);

// ─── Filtering / ranking (spec §4C/4D) ─────────────────────────────────────────

function isAvailable(item) {
  return item.available !== false;
}

/**
 * Apply extracted constraints to the live catalogue.
 * @param {Array} products
 * @param {object} c — the constraints object from the intent parser
 * @param {{ includeUnavailable?: boolean, excludeIds?: string[] }} [opts]
 */
export function applyConstraints(products, c, opts = {}) {
  const { includeUnavailable = false, excludeIds = [] } = opts;
  const excluded = new Set(excludeIds);
  return products.filter((item) => {
    if (excluded.has(item.id)) return false;
    if (!includeUnavailable && !isAvailable(item)) return false;
    if (c.available && !isAvailable(item)) return false;

    if (c.vegetarian) {
      const nutrition = estimateNutrition(item);
      if (!nutrition.vegetarian) return false;
    }
    if (c.vegan) {
      const nutrition = estimateNutrition(item);
      if (!nutrition.vegan) return false;
    }
    if (c.nonVeg) {
      const nutrition = estimateNutrition(item);
      if (nutrition.vegetarian) return false;
    }
    if (c.containsEgg) {
      const nutrition = estimateNutrition(item);
      if (!nutrition.containsEgg) return false;
    }
    if (c.containsDairy) {
      const nutrition = estimateNutrition(item);
      if (!nutrition.containsDairy) return false;
    }
    if (c.containsNuts) {
      const nutrition = estimateNutrition(item);
      if (!nutrition.containsNuts) return false;
    }

    if (c.budget != null && toNum(item.price) > c.budget) return false;
    if (c.stall && item.shop !== c.stall) return false;
    if (c.category && item.category && String(item.category).toLowerCase() !== String(c.category).toLowerCase()) return false;
    return true;
  });
}

const proteinScore = (item) => estimateNutrition(item).protein;

/** Rank a filtered set by the user's stated focus (protein/calorie/price/filling/popular). */
export function rankByFocus(items, { focus, c = {} } = {}) {
  const ranked = [...items];
  const toRank = (item) => {
    const nutrition = estimateNutrition(item);
    switch (focus) {
      case "protein":
        return nutrition.protein;
      case "calories":
        return c.calories === "low" ? -nutrition.calories : nutrition.calories;
      case "price":
        return c.affordable ? -toNum(item.price) : toNum(item.price);
      case "popular":
        return Number(item.reviewCount || 0);
      case "filling":
        return nutrition.calories + nutrition.protein * 2;
      default:
        return toNum(item.reviewCount || 0) + toNum(item.rating || 0) * 2;
    }
  };
  ranked.sort((a, b) => toRank(b) - toRank(a));
  return ranked;
}

// ─── Entity resolution (spec §8: ambiguity → clarify) ──────────────────────────

/**
 * Resolve a food phrase against the live catalogue, scoped to the active stall when sensible.
 * Returns ambiguity info so the engine can ask "which one?" (spec §8) instead of guessing.
 * @returns {{ match: object|null, candidates: Array, confidence: number, ambiguous: boolean }}
 */
export function resolveFood(phrase, products, { activeShop = null } = {}) {
  if (!phrase) return { match: null, candidates: [], confidence: 0, ambiguous: false };
  const needle = String(phrase).trim().replace(/^(?:the|a|an)\s+/, "");

  // Prefer the active stall, but never let it hide items the user explicitly names elsewhere
  // ("compare chicken roll and egg sandwich" while browsing Falcon Veg must still resolve).
  const scoped = resolveMenuEntity(needle, products, { activeShop, minScore: 0.4, maxResults: 5 });
  const scopedOk = scoped.match || scoped.candidates.length > 0;
  const resolved = scopedOk ? scoped : resolveMenuEntity(needle, products, { minScore: 0.4, maxResults: 5 });

  // Never resolve to an unavailable item without flagging it — availability must come from data.
  const availableCandidates = resolved.candidates.filter((entry) => entry.product.available !== false);
  const candidates = availableCandidates.length > 0 ? availableCandidates : resolved.candidates;

  const topScore = candidates[0]?.score || 0;
  // Ambiguous when several items tie closely and none is an exact-name match.
  const ambiguous =
    candidates.length > 1 &&
    topScore < 1 &&
    candidates.filter((entry) => topScore - entry.score < 0.18).length > 1;

  const match = !ambiguous && resolved.match && resolved.match.available !== false
    ? resolved.match
    : (!ambiguous ? (candidates[0]?.product || null) : null);

  return {
    match,
    candidates,
    confidence: match ? resolved.confidence : 0,
    ambiguous,
  };
}

// ─── Search (spec §4A) ──────────────────────────────────────────────────────────

/**
 * Primary food search: resolve a phrase, then filter/rank by constraints.
 * Returns a FOOD_LIST-style payload.
 */
export function searchFoods(products, constraints, { phrase = null, focus = null, maxResults = 4, activeShop = null } = {}) {
  let items = applyConstraints(products, constraints, { includeUnavailable: constraints.available });

  if (phrase) {
    const { match, candidates } = resolveFood(phrase, items, { activeShop });
    if (match) {
      items = [match];
    } else if (candidates.length > 0) {
      items = candidates.map((entry) => entry.product);
    } else if (items.length === 0) {
      items = applyConstraints(products, constraints, { includeUnavailable: true });
      const loose = resolveFood(phrase, products, {});
      if (loose.match) {
        return {
          items: [foodData(loose.match, { reason: "Currently unavailable — here's the closest match." })],
          unavailable: true,
        };
      }
      return { items: [], unavailable: false };
    }
  }

  const ranked = rankByFocus(items, { focus, c: constraints });
  return { items: ranked.slice(0, maxResults).map(foodData), unavailable: false };
}

// ─── Nutrition (spec §4B) ──────────────────────────────────────────────────────

export function getFoodNutrition(products, phrase, { activeShop = null } = {}) {
  const { match, candidates, confidence } = resolveFood(phrase, products, { activeShop });
  if (!match) {
    return { item: null, candidates: candidates.map((entry) => entry.product) };
  }
  return {
    item: foodData(match),
    candidates: [],
    unique: candidates.length === 0 || (candidates.length === 1 && candidates[0].product.id === match.id) || confidence >= 0.92,
  };
}

// ─── Comparison (spec §4G) ─────────────────────────────────────────────────────

/**
 * Compare up to three food items.
 * @returns {{ items: Array, byProtein: string|null, byCalories: string|null, cheapest: string|null }}
 */
export function compareFoods(products, phrases, { activeShop = null } = {}) {
  const resolved = [];
  const failed = [];
  (phrases || []).forEach((phrase) => {
    const { match } = resolveFood(phrase, products, { activeShop });
    if (match) resolved.push(foodData(match));
    else failed.push(phrase);
  });

  if (resolved.length === 0) {
    return { items: [], failed, summary: null };
  }

  let byProtein = null;
  let byCalories = null;
  let cheapest = null;
  if (resolved.length > 1) {
    byProtein = [...resolved].sort((a, b) => b.nutrition.protein - a.nutrition.protein)[0].name;
    byCalories = [...resolved].sort((a, b) => a.nutrition.calories - b.nutrition.calories)[0].name;
    cheapest = [...resolved].sort((a, b) => a.price - b.price)[0].name;
  }

  return { items: resolved, failed, summary: { byProtein, byCalories, cheapest } };
}

// ─── Recommendations (spec §4E) — ONE engine, reused ───────────────────────────

/**
 * Personalized picks via the real recommender engine. Falls back to honest cold-start
 * popularity for guests/users without history.
 */
export function recommendFoods({
  products,
  userOrders = [],
  cooccurrenceOrders = [],
  cart = [],
  now = new Date(),
  maxResults = 4,
  activeShop = "",
}) {
  const result = computeRecommendations({
    orders: userOrders,
    catalog: products.filter((item) => item.available !== false),
    activeShop,
    cart,
    cooccurrenceOrders,
    now,
    maxResults,
  });

  return {
    items: result.recommendations.map((rec) => foodData(rec.item, { reason: rec.reason })),
    hasHistory: result.hasHistory,
    coldStart: result.coldStart,
    modelSummary: result.modelSummary,
  };
}

/** Frequencies from the user's OWN orders — "your usuals" (spec §4F). */
export function getUsuals(userOrders, products, { maxResults = 4 } = {}) {
  const counts = new Map();
  const recency = new Map();
  (userOrders || []).forEach((order) => {
    const ts = order?.created_at;
    const ms = ts ? (typeof ts.toMillis === "function" ? ts.toMillis() : ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : null) : null;
    (order?.items || []).forEach((line) => {
      const id = line?.id || line;
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + (line?.quantity || 1));
      if (ms != null && !recency.has(id)) recency.set(id, ms);
    });
  });

  const ranked = [...counts.entries()]
    .map(([id, count]) => ({
      id,
      count,
      last: recency.get(id) || 0,
    }))
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, maxResults);

  const byId = new Map(products.map((item) => [item.id, item]));
  return ranked
    .filter((entry) => byId.has(entry.id))
    .map((entry) =>
      foodData(byId.get(entry.id), {
        reason: `You've ordered this ${entry.count} ${entry.count === 1 ? "time" : "times"}.`,
      })
    );
}

/** The user's most recent orders (their own data only, spec §4F). */
export function getRecentOrders(userOrders, { maxResults = 5 } = {}) {
  return (userOrders || [])
    .filter((order) => order && !order.deleted)
    .map((order) => ({
      id: order.id,
      shop: order.shop_name || order.shop || "Cafeteria",
      status: order.status,
      paymentStatus: order.payment_status,
      createdAt: order.created_at || null,
      total: toNum(order.total_price ?? order.totalAmount ?? order.total),
      items: (order.items || []).map((line) => ({
        id: line?.id || line,
        name: typeof line === "string" ? line : line?.name,
        quantity: line?.quantity || 1,
      })),
    }))
    .sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt))
    .slice(0, maxResults);
}

function msOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}

/** Similar dishes to a seed item (reuses the profile-similarity engine). */
export function similarFoods(products, itemId, { maxResults = 4 } = {}) {
  const similar = findSimilarItems(itemId, products.filter((item) => item.available !== false), { topN: maxResults, minScore: 0.25 });
  return similar.map(({ item }) => foodData(item, { reason: "Similar to your pick." }));
}

/** "Popular today" — the existing cross-stall ranking, filtered to what's available. */
export function popularToday(products, { maxResults = 4 } = {}) {
  return rankPopularity(products.filter((item) => item.available !== false))
    .slice(0, maxResults)
    .map((item) => foodData(item, { reason: "Popular on campus right now." }));
}

// ─── Meal builder (spec §4H) — honest best-protein-within-budget ───────────────

/**
 * Search item combinations (1–3 items, up to 2 of the same) that satisfy constraints and
 * maximize protein within a budget. Prunes to strong protein-per-rupee candidates first, then
 * does a bounded exhaustive sweep so the "best" claim is real — over the items actually
 * considered, not over the whole menu.
 */
export function buildMealPlan(products, constraints) {
  const budget = constraints.budget;
  const minProtein = constraints.minProtein ?? 0;
  const maxCalories = constraints.maxCalories ?? null;

  if (budget == null) return { items: [], total: 0, totalProtein: 0, budget: null, note: "Tell me your budget and I'll build the best combo." };

  const pool = applyConstraints(products, constraints, { includeUnavailable: true })
    .filter((item) => toNum(item.price) > 0 && toNum(item.price) <= budget);

  // Prune to strong protein-per-rupee + calorie-budget candidates.
  const candidates = pool
    .map((item) => ({ item, pp: proteinScore(item) / toNum(item.price) }))
    .sort((a, b) => b.pp - a.pp || toNum(b.item.price) - toNum(a.item.price))
    .slice(0, 10);

  let best = null;

  const tryCombo = (combo) => {
    const seen = new Set();
    for (const { item } of combo) {
      if (seen.has(item.id)) return; // a meal should be varied — no duplicate dishes
      seen.add(item.id);
    }
    const total = combo.reduce((sum, { item, qty }) => sum + toNum(item.price) * qty, 0);
    if (total > budget) return;
    const nutrition = sumNutrition(combo.map(({ item, qty }) => ({ item, quantity: qty })));
    if (minProtein > 0 && nutrition.protein < minProtein) return;
    if (maxCalories != null && nutrition.calories > maxCalories) return;
    if (!best || nutrition.protein > best.nutrition.protein) {
      best = { combo: combo.map(({ item, qty }) => ({ item, qty })), total, nutrition };
    }
  };

  // 1-item combos
  candidates.forEach(({ item }) => tryCombo([{ item, qty: 1 }]));
  // 2-item combos (i < j — distinct items)
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      tryCombo([{ item: candidates[i].item, qty: 1 }, { item: candidates[j].item, qty: 1 }]);
    }
  }
  // 3-item combos (i < j < k — distinct items)
  const n = candidates.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        tryCombo([{ item: candidates[i].item, qty: 1 }, { item: candidates[j].item, qty: 1 }, { item: candidates[k].item, qty: 1 }]);
      }
    }
  }

  if (!best) return { items: [], total: 0, totalProtein: 0, budget, note: `No combination fits your budget of ₹${budget}. Try a bigger budget or looser filters.` };

  const items = best.combo.map(({ item, qty }) => ({ ...foodData(item), quantity: qty }));
  return {
    items,
    total: best.total,
    totalProtein: best.nutrition.protein,
    totalCalories: best.nutrition.calories,
    budget,
    note: null,
    minProtein,
  };
}

// ─── Cart intelligence (spec §4I) — reads client-provided cart against real data ──

/** Resolve client cart line items against the live catalogue (ids → full product data). */
export function resolveCart(cartLines, products) {
  const byId = new Map(products.map((item) => [item.id, item]));
  return (cartLines || [])
    .map((line) => {
      const product = byId.get(line.id);
      if (!product) return null;
      return { product, quantity: Math.max(1, Math.round(Number(line.quantity) || 1)) };
    })
    .filter(Boolean);
}

export function cartSummary(cartLines, products) {
  const resolved = resolveCart(cartLines, products);
  const nutrition = sumNutrition(resolved.map(({ product, quantity }) => ({ item: product, quantity })));
  const total = resolved.reduce((sum, { product, quantity }) => sum + toNum(product.price) * quantity, 0);
  return {
    lines: resolved.map(({ product, quantity }) => ({ ...foodData(product), quantity })),
    nutrition,
    total,
    itemCount: resolved.reduce((sum, { quantity }) => sum + quantity, 0),
  };
}

/**
 * Suggest a cheaper cart: swap the priciest item(s) for the best similar-but-cheaper option
 * from the same stall. Returns a proposed replacement the user confirms (never auto-applied).
 */
export function suggestCheaperCart(cartLines, products, { activeShop = null } = {}) {
  const resolved = resolveCart(cartLines, products);
  if (resolved.length === 0) return null;

  const target = [...resolved].sort((a, b) => toNum(b.product.price) * b.quantity - toNum(a.product.price) * a.quantity)[0];
  const savingsTotal = toNum(target.product.price) * target.quantity;
  const targetProtein = estimateNutrition(target.product).protein;

  const alternatives = products
    .filter((item) => item.available !== false && item.id !== target.product.id)
    .filter((item) => item.shop === target.product.shop || activeShop == null)
    .map((item) => ({ item, nutrition: estimateNutrition(item) }))
    // A cheaper swap should still be a decent meal — not a packet of coffee.
    .filter((entry) => entry.item.price != null && toNum(entry.item.price) < toNum(target.product.price))
    .filter((entry) => entry.nutrition.protein >= Math.max(6, targetProtein * 0.5))
    .sort((a, b) => (toNum(a.item.price) - toNum(b.item.price)) || (b.nutrition.protein - a.nutrition.protein))
    .slice(0, 3);

  return {
    target: foodData(target.product),
    quantity: target.quantity,
    alternatives: alternatives.map(({ item }) => foodData(item)),
    currentSpend: savingsTotal,
  };
}

// ─── Availability (spec §4A / context) ─────────────────────────────────────────

export function openStalls(shopStatus = {}) {
  return Object.entries(shopStatus)
    .filter(([, status]) => status?.is_open !== false)
    .map(([name]) => name);
}

export const availableToday = (products) => products.filter(isAvailable);
