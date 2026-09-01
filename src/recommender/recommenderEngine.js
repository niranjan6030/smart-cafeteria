// Food recommendation pipeline. Pure functions (no Firestore/React imports) so the whole model
// is unit-testable and runs deterministically in the browser.
//
// How it works:
//   1. The live menu of the active stall becomes the candidate set.
//   2. The student's full order history is flattened into a chronological event stream
//      (each item line = one event with time-of-day / weekday / recency / quantity features).
//   3. A sequence-aware LSTM (src/lstm.js) CAN be plugged in: when trained weights are supplied
//      via `lstmWeights` (produced offline by src/research/train_lstm.py), its final hidden
//      state is projected to per-item scores — the "you tend to follow X with Y" signal. Until
//      real trained weights exist, the LSTM is simply not part of the blend; we do not ship a
//      pretend model with random weights.
//   4. The active signals are blended in priority order:
//        P1 affinity    — recency-weighted frequency ("you order this all the time")
//        P2 similarity  — dishes similar to the user's favourites (src/foodMetadata.js)
//        P3 cooccurrence— items commonly bought in the same transaction (src/cooccurrence.js)
//        P4 meal time   — the right food for the current meal session (cold-start gated)
//      plus catalogue popularity for cold start / social proof.
//   5. Every pick carries a human-readable *reason*, a badge type, and a 0-100 confidence.

import { DEFAULT_LSTM_CONFIG, forwardLstm } from "../lstm.js";
import { inferFoodProfile, mealSessionFor, mealTypeMatch, profileSimilarity } from "./foodMetadata.js";
import { buildCooccurrence, cooccurrenceScore, pairLift } from "./cooccurrence.js";

const SEQ_LEN = 8; // LSTM sees the most recent 8 item events
const MAX_EVENTS = 40; // flatten at most this many history events into the stream
const RECENCY_HALF_LIFE_DAYS = 7; // exponential recency decay (exp(-days/7))
const DAYPART_WINDOW_HOURS = 2; // same-meal-time affinity window around the current hour
const MAX_ORDER_SIGNALS = 300; // cap on cross-user transactions used for co-occurrence/trending

const RESERVED_VOCAB_SLOT = 1; // slot 0 is UNK; item slots start at 1

const UNK_INDEX = 0;

// Tests can override the model's default vocabulary cap.
export function getEffectiveVocab(maxVocab) {
  const vocab = maxVocab || DEFAULT_LSTM_CONFIG.vocabSize;
  return Math.max(2, Math.min(vocab, DEFAULT_LSTM_CONFIG.vocabSize));
}

function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const resolveShop = (shop) => (shop === "Fresh Time" ? "Break Time" : shop);

// Badge vocabulary — the five badge types the product brief specifies, plus a special-of-the-day
// badge. Every recommendation carries one so the UI can explain itself at a glance.
const BADGES = {
  frequent: { emoji: "⭐", label: "Frequently Ordered" },
  similar: { emoji: "🔥", label: "Similar to Your Favourite" },
  cooccurrence: { emoji: "🍽", label: "Frequently Bought Together" },
  mealTime: { emoji: "⏰", label: "Perfect for This Time" },
  lstm: { emoji: "❤️", label: "Recommended for You" },
  popular: { emoji: "❤️", label: "Recommended for You" },
  recommended: { emoji: "❤️", label: "Recommended for You" },
  special: { emoji: "💛", label: "Special of the Day" },
};

/**
 * Maps the available catalogue items to stable LSTM vocabulary slots.
 * @param {Array<{ id: string }>} catalog
 * @returns {{ indexById: Map<string, number>, idByIndex: string[], vocabSize: number, unknownIds: string[] }}
 */
export function buildCatalogIndex(catalog, maxVocab) {
  const vocabSize = getEffectiveVocab(maxVocab);
  const indexById = new Map();
  const idByIndex = [];
  const unknownIds = [];
  catalog.forEach((item) => {
    if (!item?.id || indexById.has(item.id)) return;
    if (idByIndex.length < vocabSize - RESERVED_VOCAB_SLOT) {
      const index = idByIndex.length + RESERVED_VOCAB_SLOT;
      indexById.set(item.id, index);
      idByIndex.push(item.id);
    } else {
      unknownIds.push(item.id);
    }
  });
  return { indexById, idByIndex, vocabSize, unknownIds };
}

/**
 * Flattens raw order docs into a chronological stream of item-level events.
 * @param {Array} orders - order docs with `items`, `shop_name`, `created_at`
 * @param {{ now?: Date, maxEvents?: number }} options
 * @returns {Array<{
 *   itemId: string|null, shop: string, hour: number, isWeekend: number,
 *   daysAgo: number, recency: number, quantity: number, createdAtMs: number
 * }>}
 */
export function buildEventSequence(orders, { now = new Date(), maxEvents = MAX_EVENTS } = {}) {
  const nowMs = now.getTime();
  const events = [];
  orders.forEach((order) => {
    const createdAtMs = toMs(order?.created_at);
    if (!createdAtMs || createdAtMs > nowMs) return; // ignore unparseable / future timestamps
    const shop = resolveShop(order?.shop_name);
    const date = new Date(createdAtMs);
    const hour = date.getHours();
    const isWeekend = [0, 6].includes(date.getDay()) ? 1 : 0;
    const daysAgo = Math.max(0, (nowMs - createdAtMs) / 86400000);
    const recency = Math.exp(-daysAgo / RECENCY_HALF_LIFE_DAYS);
    const lines = Array.isArray(order.items) && order.items.length > 0 ? order.items : [{ id: null, quantity: 1 }];
    lines.forEach((line) => {
      events.push({
        itemId: line?.id ?? null,
        shop,
        hour,
        isWeekend,
        daysAgo,
        recency,
        quantity: clamp(Number(line?.quantity) || 1, 1, 5),
        createdAtMs,
      });
    });
  });
  return events.sort((a, b) => a.createdAtMs - b.createdAtMs).slice(-maxEvents);
}

/**
 * Builds the LSTM input tokens for the most recent window of the event stream.
 * @returns {Array<{ index: number, context: number[] }>}
 */
export function buildTokens(events, indexById) {
  return events.slice(-SEQ_LEN).map((event) => ({
    index: event.itemId != null ? indexById.get(event.itemId) ?? UNK_INDEX : UNK_INDEX,
    context: [event.hour / 24, event.isWeekend, event.recency, event.quantity / 5],
  }));
}

// Min-max normalises a list of per-item values to [0, 1]; flat inputs stay at a neutral 0.5 so
// no single signal can dominate or vanish just because it happened to be constant.
function normalize(values) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

// A signal is "flat" when every candidate produced the same raw value — i.e. the data (or this
// shop's catalogue) simply doesn't exercise it. Flat signals still contribute a neutral 0.5 to
// the blended *score* (harmless constant), but they must never be credited as the *reason* a
// dish was surfaced; otherwise "popularity at this shop" would explain a pick that actually came
// from dish similarity.
// Accepts either an array or a plain object keyed by item id (affinityRaw, hourAffinityRaw,
// trendingCounts are objects; the rest are arrays).
function isFlat(values) {
  const arr = Array.isArray(values) ? values : Object.values(values);
  if (arr.length === 0) return true;
  return Math.max(...arr) - Math.min(...arr) < 1e-9;
}

const clamp01 = (value) => clamp(value, 0, 1);

// Warm-start blend, ranked by the product brief's priority order. P1 (affinity + lstm) dominates,
// P2 (similarity) and P3 (co-occurrence) shape discovery, P4 (meal time + daypart) stays a
// soft nudge because the user's own history already encodes their meal habits.
const SIGNAL_WEIGHTS = {
  affinity: 0.28,
  lstm: 0.20,
  similarity: 0.14,
  cooccurrence: 0.16,
  hourAffinity: 0.09,
  mealTime: 0.05,
  popularity: 0.08,
};

// Cold start: no personal history yet, so popularity + trending + meal time carry the ranking.
// Co-occurrence with the cart still counts because "what pairs with what" needs no personal data.
const COLD_START_WEIGHTS = {
  affinity: 0,
  lstm: 0,
  similarity: 0,
  cooccurrence: 0.1,
  hourAffinity: 0,
  mealTime: 0.28,
  popularity: 0.5,
  trending: 0.12,
};

function popularityOf(item) {
  const rating = clamp01(Number(item.rating || 0) / 5);
  const reviews = clamp01(Number(item.reviewCount || 0) / 100);
  const flagged = item.isMostSold || item.isSpecial ? 1 : 0;
  return clamp01(0.4 * rating + 0.3 * reviews + 0.3 * flagged);
}

// Builds the id -> name map across both the live catalogue and every order line, so favourites
// ordered at *other* stalls can still drive similarity picks at the active one.
function buildNameById(catalog, orders) {
  const nameById = new Map();
  catalog.forEach((item) => { if (item?.id && item?.name) nameById.set(item.id, item.name); });
  orders.forEach((order) => {
    (order?.items || []).forEach((line) => {
      if (line?.id && line?.name) nameById.set(line.id, line.name);
    });
  });
  return nameById;
}

// Recent cross-user transactions for the active stall, oldest -> newest, capped for speed.
function prepareOrderSignals(orders, shop, maxOrders = MAX_ORDER_SIGNALS) {
  return orders
    .filter((order) => resolveShop(order?.shop_name) === shop)
    .sort((a, b) => (toMs(a?.created_at) || 0) - (toMs(b?.created_at) || 0))
    .slice(-maxOrders);
}

// Item ids ordered within the last `hours` across the active stall (feeds cold-start trending).
function trendingCounts(orders, nowMs, hours = 24, shop) {
  const counts = {};
  orders.forEach((order) => {
    if (resolveShop(order?.shop_name) !== shop) return;
    const ts = toMs(order?.created_at);
    if (!ts || ts > nowMs || nowMs - ts > hours * 3600000) return;
    (order?.item_ids || []).forEach((id) => { if (id) counts[id] = (counts[id] || 0) + 1; });
  });
  return counts;
}

// The user's top favourites by recency-weighted affinity, drawn from the FULL history so a
// favourite unavailable at the active stall still influences similarity picks there.
function favouriteProfilesOf(affinityRaw, nameById, profileById, topN = 5) {
  const maxAffinity = Math.max(0, ...Object.values(affinityRaw));
  return Object.keys(affinityRaw)
    .filter((id) => affinityRaw[id] > 0)
    .sort((a, b) => affinityRaw[b] - affinityRaw[a])
    .slice(0, topN)
    .map((id) => ({
      id,
      name: nameById.get(id) || "",
      profile: profileById.get(id) || inferFoodProfile({ id, name: nameById.get(id) || "" }),
      affinity: affinityRaw[id] / (maxAffinity || 1),
    }));
}

// Human-readable explanation + badge type for a scored pick. Priority order mirrors the product
// brief: specials first (visual anchor), then frequency, then the four personal signals.
function describePick(entry, { activeShop, hasHistory, session, seedNames }) {
  const { item, driver, timesOrdered } = entry;
  if (item.isSpecial) return { reason: "Special of the day", reasonType: "special" };
  if (!hasHistory) return { reason: `Popular choice at ${activeShop}`, reasonType: "popular" };
  if (timesOrdered > 0) {
    return {
      reason: timesOrdered === 1 ? "You've ordered this before" : `You've ordered this ${timesOrdered}×`,
      reasonType: "frequent",
    };
  }
  switch (driver) {
    case "similarity":
      return { reason: "Similar to foods you usually enjoy", reasonType: "similar" };
    case "cooccurrence": {
      const seedName = entry.coPairedWith ? seedNames.get(entry.coPairedWith) : null;
      return {
        reason: seedName ? `Frequently ordered together with ${seedName}` : "A great match for your cart",
        reasonType: "cooccurrence",
      };
    }
    case "mealTime":
      return { reason: `Perfect for ${session.toLowerCase()} time`, reasonType: "mealTime" };
    case "hourAffinity":
      return { reason: "A favourite at this time of day", reasonType: "mealTime" };
    case "lstm":
      return { reason: "Matched to your recent taste", reasonType: "lstm" };
    case "popularity":
      return { reason: `Popular choice at ${activeShop}`, reasonType: "popular" };
    default:
      return { reason: "Recommended for you", reasonType: "recommended" };
  }
}

function rankConfidence(score, best, worst) {
  const spread = Math.max(best - worst, 1e-4);
  const relative = (score - worst) / spread; // 1 for the top pick
  return clamp(Math.round(55 + 40 * Math.pow(relative, 0.6)), 55, 95);
}

/**
 * Core recommender.
 * @param {{
 *   orders: Array,            // the student's own order history
 *   catalog: Array,           // available menu items of the ACTIVE stall (special pricing applied)
 *   activeShop: string,
 *   cart?: Array,             // items currently in the cart (feeds the P3 co-occurrence signal)
 *   cooccurrenceOrders?: Array, // cross-user non-PII transactions (order_signals with item_ids)
 *   lstmWeights?: object,     // OPTIONAL trained LSTM weights from src/lstm.js loadTrainedWeights().
 *                             // When absent the sequence signal is skipped entirely (no fake model).
 *   now?: Date,
 *   maxResults?: number,
 *   maxVocab?: number,
 * }} params
 * @returns {{
 *   recommendations: Array<{
 *     item: object, itemId: string, score: number, confidence: number, reason: string,
 *     reasonType: string, badge: { emoji: string, label: string }, timesOrdered: number,
 *     signal: object
 *   }>,
 *   coldStart: boolean, hasHistory: boolean,
 *   modelSummary: { sequenceLength: number, tokensUsed: number }
 * }}
 */
export function computeRecommendations({
  orders = [],
  catalog = [],
  activeShop = "",
  cart = [],
  cooccurrenceOrders = [],
  lstmWeights = null,
  now = new Date(),
  maxResults = 6,
  maxVocab,
}) {
  const availableItems = (catalog || []).filter((item) => item && item.id);
  const empty = {
    recommendations: [],
    coldStart: true,
    hasHistory: false,
    modelSummary: { sequenceLength: 0, tokensUsed: 0 },
  };
  if (availableItems.length === 0) return empty;

  const resolvedShop = resolveShop(activeShop);
  const nowMs = now.getTime();
  const session = mealSessionFor(now.getHours());
  const profileById = new Map(availableItems.map((item) => [item.id, inferFoodProfile(item)]));
  const nameById = buildNameById(availableItems, orders);

  const { indexById } = buildCatalogIndex(availableItems, maxVocab);
  const candidates = availableItems
    .filter((item) => indexById.has(item.id))
    .map((item) => ({ item, index: indexById.get(item.id) }));

  const events = buildEventSequence(orders, { now });
  const hasHistory = events.length > 0;
  const tokens = buildTokens(events, indexById);

  // ─── Optional Signal 1: LSTM sequence signal ───────────────────────────────
  // Only computed when genuinely trained weights are supplied (see lstm.js loadTrainedWeights).
  // No weights ⇒ the signal is skipped and its weight never enters the blend.
  const hasLstm = Boolean(lstmWeights);
  let lstmRaw = null;
  if (hasLstm) {
    const probabilities = forwardLstm(lstmWeights, tokens).probabilities;
    lstmRaw = candidates.map(({ index }) => probabilities[index]);
  }

  // ─── History signals: recency-weighted affinity + meal-time habit ──────────
  const affinityRaw = {};
  const hourAffinityRaw = {};
  const timesOrdered = {};
  const currentHour = now.getHours();
  events.forEach((event) => {
    if (event.itemId == null) return;
    affinityRaw[event.itemId] = (affinityRaw[event.itemId] || 0) + event.recency;
    timesOrdered[event.itemId] = (timesOrdered[event.itemId] || 0) + 1;
    const hourDelta = Math.min(Math.abs(event.hour - currentHour), 24 - Math.abs(event.hour - currentHour));
    if (hourDelta <= DAYPART_WINDOW_HOURS) {
      hourAffinityRaw[event.itemId] = (hourAffinityRaw[event.itemId] || 0) + 1;
    }
  });

  // ─── P2 similarity: dishes like the user's favourites (any stall) ──────────
  const favourites = favouriteProfilesOf(affinityRaw, nameById, profileById);
  const favouriteIds = new Set(favourites.map((fav) => fav.id));
  const similarityRaw = candidates.map(({ item }) => {
    if (favouriteIds.has(item.id)) return 0; // favourites are already surfaced by affinity
    let best = 0;
    favourites.forEach((fav) => {
      const sim = profileSimilarity(profileById.get(item.id), fav.profile);
      best = Math.max(best, fav.affinity * sim);
    });
    return best;
  });

  // ─── P3 co-occurrence: pairs well with the cart / the user's usual picks ───
  const coStats = buildCooccurrence(prepareOrderSignals(cooccurrenceOrders, resolvedShop), { maxOrders: MAX_ORDER_SIGNALS });
  const coSeeds = cart.length > 0
    ? cart.map((item) => item.id).filter(Boolean)
    : favourites.map((fav) => fav.id);
  const coEntries = candidates.map(({ item }) => cooccurrenceScore(item.id, coSeeds, coStats));
  const coRaw = coEntries.map((entry) => entry.score);
  const coPairedWith = coEntries.map((entry) => entry.pairedWith);

  // ─── P4 meal time + daypart ────────────────────────────────────────────────
  const mealRaw = candidates.map(({ item }) => mealTypeMatch(profileById.get(item.id), session));
  const hourValues = candidates.map(({ item }) => hourAffinityRaw[item.id] || 0);

  // ─── Popularity + cold-start trending ───────────────────────────────────────
  const popularityValues = candidates.map(({ item }) => popularityOf(item));
  const trending = trendingCounts(cooccurrenceOrders, nowMs, 24, resolvedShop);
  const trendingRaw = candidates.map(({ item }) => trending[item.id] || 0);

  // ─── Normalise every signal across the candidate set ───────────────────────
  const affinitySignal = normalize(candidates.map(({ item }) => Math.log1p(affinityRaw[item.id] || 0)));
  const lstmSignal = hasLstm ? normalize(lstmRaw) : null;
  const similaritySignal = normalize(similarityRaw);
  const coSignal = normalize(coRaw);
  const mealSignal = normalize(mealRaw);
  const hourSignal = normalize(hourValues);
  const popSignal = normalize(popularityValues);
  const trendingSignal = normalize(trendingRaw);

  const weights = hasHistory ? SIGNAL_WEIGHTS : COLD_START_WEIGHTS;

  // ─── Blend + rank ─────────────────────────────────────────────────────────
  const seedNames = new Map();
  cart.forEach((item) => { if (item?.id && item?.name) seedNames.set(item.id, item.name); });
  favourites.forEach((fav) => { if (fav.name) seedNames.set(fav.id, fav.name); });

  const scored = candidates.map(({ item }, i) => {
    const weighted = {
      affinity: (weights.affinity || 0) * affinitySignal[i],
      ...(hasLstm ? { lstm: (weights.lstm || 0) * lstmSignal[i] } : {}),
      similarity: (weights.similarity || 0) * similaritySignal[i],
      cooccurrence: (weights.cooccurrence || 0) * coSignal[i],
      hourAffinity: (weights.hourAffinity || 0) * hourSignal[i],
      mealTime: (weights.mealTime || 0) * mealSignal[i],
      popularity: (weights.popularity || 0) * popSignal[i],
      ...(weights.trending ? { trending: weights.trending * trendingSignal[i] } : {}),
    };
    const score = Object.values(weighted).reduce((a, b) => a + b, 0);

    // Credit the reason only to a signal the data actually exercises at this shop, preferring the
    // most *explainable* one (the product brief's P1-P4). The LSTM is a complement — it explains
    // a pick only when trained weights are in play and none of the interpretable signals
    // differentiate the candidates.
    const interpretable = [
      ["affinity", affinityRaw], ["similarity", similarityRaw], ["cooccurrence", coRaw],
      ["hourAffinity", hourValues], ["mealTime", mealRaw], ["popularity", popularityValues],
      ["trending", trendingRaw],
    ];
    const informative = interpretable
      .filter(([key, raw]) => raw && !isFlat(raw) && weighted[key] > 0)
      .map(([key]) => key);

    let driver;
    if (informative.length === 0) {
      driver = hasHistory && hasLstm ? "lstm" : "popularity";
    } else {
      driver = informative.reduce((best, key) => (weighted[key] > weighted[best] ? key : best));
    }

    return {
      item,
      score,
      driver,
      weighted,
      coPairedWith: coPairedWith[i],
      timesOrdered: timesOrdered[item.id] || 0,
    };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, maxResults);
  const best = top[0]?.score || 0;
  const worst = top[top.length - 1]?.score ?? best;

  const recommendations = top.map((entry) => {
    const { reason, reasonType } = describePick(entry, {
      activeShop: resolvedShop,
      hasHistory,
      session,
      seedNames,
    });
    return {
      item: entry.item,
      itemId: entry.item.id,
      score: Number(entry.score.toFixed(4)),
      confidence: rankConfidence(entry.score, best, worst),
      reason,
      reasonType,
      badge: BADGES[reasonType] || BADGES.recommended,
      timesOrdered: entry.timesOrdered,
      signal: entry.weighted,
    };
  });

  return {
    recommendations,
    coldStart: !hasHistory,
    hasHistory,
    modelSummary: { sequenceLength: events.length, tokensUsed: tokens.length },
  };
}

// ─── Cross-sell / add-on API ──────────────────────────────────────────────────
// Shared by the cart drawer ("Frequently bought with your items"), the checkout upsell ("One
// last thing before you pay") and the voice pipeline ("Would you also like to add ...?"). Ranks
// candidates against the current seeds (cart items, or a just-ordered dish, or the user's usual
// picks) using co-occurrence first, then similarity and personal frequency.

const ADDON_SEED_LIMIT = 5;

function countInOrders(itemId, orders) {
  let count = 0;
  orders.forEach((order) => {
    (order?.items || []).forEach((line) => {
      if (line?.id === itemId || (typeof line === "string" && line === itemId)) count += 1;
    });
  });
  return count;
}

function historySeedObjects(orders, now, topN = ADDON_SEED_LIMIT) {
  const affinity = {};
  const names = {};
  orders.forEach((order) => {
    const ts = toMs(order?.created_at);
    if (!ts || ts > now.getTime()) return;
    const recency = Math.exp(-Math.max(0, (now.getTime() - ts) / 86400000) / RECENCY_HALF_LIFE_DAYS);
    (order?.items || []).forEach((line) => {
      if (typeof line === "object" && line?.id) {
        affinity[line.id] = (affinity[line.id] || 0) + recency;
        if (line.name) names[line.id] = line.name;
      } else if (typeof line === "string") {
        affinity[line] = (affinity[line] || 0) + recency;
      }
    });
  });
  return Object.keys(affinity)
    .sort((a, b) => affinity[b] - affinity[a])
    .slice(0, topN)
    .map((id) => ({ id, name: names[id] || "" }));
}

function addonConfidence(raw, best, worst) {
  const spread = Math.max(best - worst, 1e-4);
  const relative = clamp((raw - worst) / spread, 0, 1);
  return clamp(Math.round(55 + 40 * Math.pow(relative, 0.55)), 55, 95);
}

/**
 * Ranks complementary add-on items for a cart (or voice order / checkout upsell).
 * @param {{
 *   cart?: Array,               // items already chosen (seeds)
 *   catalog: Array,
 *   orders?: Array,             // the student's own order history
 *   cooccurrenceOrders?: Array, // cross-user transactions (order_signals with item_ids)
 *   now?: Date,
 *   activeShop?: string,
 *   maxResults?: number,
 *   minSupport?: number,
 * }} params
 * @returns {Array<{
 *   item: object, itemId: string, confidence: number, reason: string, reasonType: string,
 *   badge: { emoji: string, label: string }, pairedWith: string | null
 * }>}
 */
export function computeAddOnSuggestions({
  cart = [],
  catalog = [],
  orders = [],
  cooccurrenceOrders = [],
  now = new Date(),
  activeShop = "",
  maxResults = 3,
  minSupport = 2,
}) {
  const availableItems = (catalog || []).filter((item) => item && item.id);
  if (availableItems.length === 0) return [];

  const resolvedShop = resolveShop(activeShop);
  const profileById = new Map(availableItems.map((item) => [item.id, inferFoodProfile(item)]));

  const seeds = cart.length > 0
    ? cart.map((item) => ({ id: item.id, name: item.name || "" }))
    : historySeedObjects(orders, now);
  const seedIds = seeds.map((seed) => seed.id).filter(Boolean);
  const seedNameById = new Map(seeds.map((seed) => [seed.id, seed.name]));

  // Add-ons are *additional* items: never suggest something already in the cart or that is itself
  // a seed favourite.
  const excluded = new Set(seedIds);
  const candidates = availableItems.filter((item) => item.id && !excluded.has(item.id));

  const coStats = buildCooccurrence(prepareOrderSignals(cooccurrenceOrders, resolvedShop), { maxOrders: MAX_ORDER_SIGNALS });

  const scored = candidates
    .map((item) => {
      const co = cooccurrenceScore(item.id, seedIds, coStats, { minSupport });
      const similarity = seedIds.reduce(
        (best, seedId) => Math.max(best, profileSimilarity(profileById.get(item.id), profileById.get(seedId))),
        0
      );
      const timesOrdered = countInOrders(item.id, orders);
      // A pair that co-occurs at/above minSupport is a genuine association even before its lift
      // climbs past 1 (small in-store samples rarely produce dramatic lift). Scale by lift so the
      // strongest pairings still outrank the merely-common ones.
      const coSignal = co.count >= minSupport ? Math.log1p(Math.max(co.score, 1)) : 0;
      const freqSignal = timesOrdered > 0 ? Math.log1p(timesOrdered) * 0.6 : 0;
      const raw = coSignal * 1.2 + similarity * 0.8 + freqSignal;
      return { item, co, similarity, timesOrdered, raw, coSignal, freqSignal };
    })
    // Only a genuine co-purchase, a clear similarity pair, or a personal repeat earns a slot —
    // otherwise every dish that merely shares a cuisine would crowd the suggestions.
    .filter((entry) => entry.coSignal > 0 || entry.similarity >= 0.4 || entry.freqSignal > 0)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, maxResults);

  const best = scored[0]?.raw || 0;
  const worst = scored[scored.length - 1]?.raw ?? best;

  return scored.map((entry) => {
    const seedName = entry.co.pairedWith ? seedNameById.get(entry.co.pairedWith) : null;
    let reasonType;
    let reason;
    if (entry.coSignal > 0 && entry.co.pairedWith) {
      reasonType = "cooccurrence";
      reason = seedName
        ? `Frequently ordered together with ${seedName}`
        : "Frequently ordered with your items";
    } else if (entry.timesOrdered > 0) {
      reasonType = "frequent";
      reason = entry.timesOrdered === 1 ? "You've ordered this before" : `You've ordered this ${entry.timesOrdered}×`;
    } else if (entry.similarity >= 0.4) {
      reasonType = "similar";
      reason = "Pairs well with what's in your cart";
    } else {
      reasonType = "popular";
      reason = "Popular add-on";
    }
    return {
      item: entry.item,
      itemId: entry.item.id,
      confidence: addonConfidence(entry.raw, best, worst),
      reason,
      reasonType,
      badge: BADGES[reasonType] || BADGES.recommended,
      pairedWith: entry.co.pairedWith,
    };
  });
}

/**
 * Frequently-ordered-together *pairs* (home combo cards). Unlike add-ons — which rank a single
 * candidate against the user's current seeds — this returns genuine item↔item pairings that
 * co-occur in real cross-user transactions at the active stall, with both sides resolved against
 * the live catalogue so the UI can add them both to the cart. Ranked by lift (with a support
 * floor and a log-count tiebreaker) so a rare-but-extreme pairing never outranks a sturdy one.
 * @param {{
 *   catalog?: Array,               // live menu of the active stall (special pricing applied)
 *   cooccurrenceOrders?: Array,    // cross-user non-PII transactions (order_signals)
 *   activeShop?: string,
 *   minSupport?: number,
 *   maxPairs?: number,
 * }} params
 * @returns {Array<{
 *   a: object, b: object, count: number, lift: number, total: number, reason: string
 * }>}
 */
export function computePopularPairs({
  catalog = [],
  cooccurrenceOrders = [],
  activeShop = "",
  minSupport = 2,
  maxPairs = 3,
}) {
  const availableItems = (catalog || []).filter((item) => item && item.id && item.available !== false);
  if (availableItems.length === 0 || (cooccurrenceOrders || []).length === 0) return [];

  const resolvedShop = resolveShop(activeShop);
  const byId = new Map(availableItems.map((item) => [item.id, item]));
  const stats = buildCooccurrence(prepareOrderSignals(cooccurrenceOrders, resolvedShop), { maxOrders: MAX_ORDER_SIGNALS });

  const pairs = [];
  stats.pairCounts.forEach((count, key) => {
    if (count < minSupport) return;
    const [idA, idB] = key.split("__");
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (!a || !b) return;
    const lift = pairLift(idA, idB, stats, { minSupport });
    if (lift <= 1) return; // only genuine associations, never chance pairings
    pairs.push({ a, b, count, lift });
  });
  pairs.sort((x, y) => y.lift * Math.log1p(y.count) - x.lift * Math.log1p(x.count));

  return pairs.slice(0, maxPairs).map(({ a, b, count, lift }) => ({
    a,
    b,
    count,
    lift: Number(lift.toFixed(2)),
    total: Number(a.price || 0) + Number(b.price || 0),
    reason: `Popular pairing at ${resolvedShop}`,
  }));
}

// Convenience used by tests to preview the per-signal breakdown for one item.
export { SIGNAL_WEIGHTS, COLD_START_WEIGHTS };