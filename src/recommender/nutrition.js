// Nutrition knowledge base — estimated per-serving macros for the canteen catalogue.
//
// The products collection does not carry measured nutrition values today, so the Food Assistant
// (and any future nutrition surface) must never present fabricated *precise* numbers. Instead this
// module derives clearly-labelled **estimates** from the dish family + ingredient keywords, in the
// same transparent, dependency-free style as foodMetadata.js. The moment a product doc carries an
// explicit `nutrition` object (set by staff from real measurement), those values win and the
// estimate flag flips off — the model never overrides real data.
//
// All values are rounded to clean whole numbers ("~420 kcal", "24g protein"). No false precision.

import { dishFamilyOf, isLikelyNonVeg } from "./foodMetadata.js";

// ─── Base per-serving estimates by dish family (per portion as served on campus) ──
// Values are rough, honest approximations for street-food/canteen portions and are ALWAYS
// surfaced as "estimated" in the UI. Update when real measurements land on products.
const FAMILY_NUTRITION = {
  dosa: { calories: 320, protein: 7, carbs: 42, fat: 13, fiber: 2 },
  idli: { calories: 120, protein: 4, carbs: 24, fat: 1, fiber: 1 },
  vada: { calories: 260, protein: 6, carbs: 24, fat: 15, fiber: 3 },
  poori: { calories: 300, protein: 5, carbs: 38, fat: 14, fiber: 3 },
  puri: { calories: 300, protein: 5, carbs: 38, fat: 14, fiber: 3 },
  upma: { calories: 250, protein: 6, carbs: 36, fat: 9, fiber: 3 },
  pongal: { calories: 290, protein: 7, carbs: 42, fat: 10, fiber: 3 },
  uttapam: { calories: 300, protein: 8, carbs: 40, fat: 11, fiber: 3 },
  uthappam: { calories: 300, protein: 8, carbs: 40, fat: 11, fiber: 3 },
  omelette: { calories: 210, protein: 13, carbs: 2, fat: 16, fiber: 0 },
  paratha: { calories: 310, protein: 7, carbs: 40, fat: 13, fiber: 3 },
  parotta: { calories: 330, protein: 8, carbs: 46, fat: 12, fiber: 2 },
  naan: { calories: 260, protein: 8, carbs: 48, fat: 5, fiber: 3 },
  roti: { calories: 120, protein: 4, carbs: 22, fat: 2, fiber: 3 },
  chapati: { calories: 120, protein: 4, carbs: 22, fat: 2, fiber: 3 },
  biryani: { calories: 480, protein: 18, carbs: 62, fat: 16, fiber: 4 },
  pulao: { calories: 420, protein: 10, carbs: 66, fat: 12, fiber: 4 },
  pulav: { calories: 420, protein: 10, carbs: 66, fat: 12, fiber: 4 },
  meals: { calories: 520, protein: 16, carbs: 66, fat: 18, fiber: 7 },
  thali: { calories: 520, protein: 16, carbs: 66, fat: 18, fiber: 7 },
  rice: { calories: 380, protein: 9, carbs: 66, fat: 8, fiber: 3 },
  friedrice: { calories: 520, protein: 14, carbs: 74, fat: 17, fiber: 3 },
  noodles: { calories: 470, protein: 12, carbs: 72, fat: 14, fiber: 3 },
  chowmein: { calories: 450, protein: 11, carbs: 70, fat: 13, fiber: 3 },
  manchurian: { calories: 320, protein: 9, carbs: 34, fat: 17, fiber: 3 },
  momos: { calories: 280, protein: 10, carbs: 36, fat: 10, fiber: 2 },
  springroll: { calories: 240, protein: 5, carbs: 28, fat: 12, fiber: 2 },
  pizza: { calories: 310, protein: 12, carbs: 36, fat: 13, fiber: 2 },
  burger: { calories: 380, protein: 15, carbs: 40, fat: 18, fiber: 2 },
  fries: { calories: 320, protein: 4, carbs: 42, fat: 16, fiber: 4 },
  wedges: { calories: 280, protein: 4, carbs: 36, fat: 14, fiber: 3 },
  sandwich: { calories: 300, protein: 11, carbs: 34, fat: 12, fiber: 3 },
  toast: { calories: 180, protein: 5, carbs: 24, fat: 7, fiber: 1 },
  pasta: { calories: 420, protein: 14, carbs: 60, fat: 14, fiber: 4 },
  wrap: { calories: 380, protein: 16, carbs: 44, fat: 15, fiber: 3 },
  roll: { calories: 390, protein: 17, carbs: 46, fat: 15, fiber: 3 },
  kathi: { calories: 400, protein: 17, carbs: 46, fat: 16, fiber: 3 },
  samosa: { calories: 250, protein: 4, carbs: 30, fat: 13, fiber: 2 },
  puff: { calories: 270, protein: 6, carbs: 28, fat: 15, fiber: 1 },
  patty: { calories: 260, protein: 6, carbs: 28, fat: 14, fiber: 1 },
  cookie: { calories: 180, protein: 2, carbs: 24, fat: 9, fiber: 1 },
  brownie: { calories: 280, protein: 4, carbs: 36, fat: 14, fiber: 2 },
  muffin: { calories: 320, protein: 5, carbs: 46, fat: 13, fiber: 1 },
  pastry: { calories: 340, protein: 5, carbs: 40, fat: 18, fiber: 1 },
  cake: { calories: 300, protein: 4, carbs: 42, fat: 13, fiber: 1 },
  donut: { calories: 280, protein: 4, carbs: 34, fat: 15, fiber: 1 },
  doughnut: { calories: 280, protein: 4, carbs: 34, fat: 15, fiber: 1 },
  bread: { calories: 130, protein: 4, carbs: 24, fat: 2, fiber: 1 },
  bun: { calories: 150, protein: 4, carbs: 28, fat: 2, fiber: 1 },
  croissant: { calories: 260, protein: 5, carbs: 28, fat: 14, fiber: 1 },
  coffee: { calories: 45, protein: 2, carbs: 6, fat: 1, fiber: 0 },
  cappuccino: { calories: 90, protein: 4, carbs: 10, fat: 4, fiber: 0 },
  latte: { calories: 140, protein: 7, carbs: 12, fat: 7, fiber: 0 },
  tea: { calories: 40, protein: 1, carbs: 8, fat: 1, fiber: 0 },
  chai: { calories: 40, protein: 1, carbs: 8, fat: 1, fiber: 0 },
  shake: { calories: 350, protein: 9, carbs: 60, fat: 9, fiber: 2 },
  smoothie: { calories: 220, protein: 6, carbs: 44, fat: 3, fiber: 4 },
  lassi: { calories: 180, protein: 6, carbs: 28, fat: 5, fiber: 0 },
  juice: { calories: 110, protein: 1, carbs: 26, fat: 0, fiber: 1 },
  lemonade: { calories: 90, protein: 0, carbs: 22, fat: 0, fiber: 0 },
  cola: { calories: 140, protein: 0, carbs: 36, fat: 0, fiber: 0 },
  soda: { calories: 140, protein: 0, carbs: 36, fat: 0, fiber: 0 },
};

// Keyword → macro adjusters for common ingredients/descriptors not covered by family alone.
// Applied additively on top of the family base (e.g. "chicken" adds protein, "chocolate" adds
// calories). One rule per ingredient — each contributes at most once. Purely heuristic;
// still labelled estimated.
const INGREDIENT_ADJUSTERS = [
  { re: /chicken/, protein: 8, calories: 60 },
  { re: /paneer/, protein: 6, calories: 50 },
  { re: /egg/, protein: 6, calories: 50, fat: 4 },
  { re: /cheese/, protein: 3, calories: 70, fat: 6 },
  { re: /tofu|soy/, protein: 8, calories: 40 },
  { re: /chocolate/, calories: 90, fat: 5 },
  { re: /butter/, calories: 60, fat: 7 },
  { re: /fry|fried|crunchy/, calories: 50, fat: 5 },
  { re: /grilled|tandoor|bbq|roast/, calories: -30, fat: -4 },
  { re: /masala|spicy/, calories: 10 },
  { re: /special|loaded|double/, calories: 80, fat: 6, protein: 2 },
];

// ─── Dietary / allergen inference (best-effort, from the item name) ─────────────
// Uses the same non-veg marker list as foodMetadata so the two systems can never disagree.
const EGG_MARKERS = ["egg", "omelette", "omelet", "mayo", "mayonnaise"];
const DAIRY_MARKERS = ["cheese", "paneer", "butter", "milk", "lassi", "shake", "yogurt", "curd", "cream", "buttermilk", "chai", "coffee", "cappuccino", "latte", "paneer", "pudding", "custard"];
const NUT_MARKERS = ["peanut", "almond", "cashew", "walnut", "pistachio", "nut", "pesto"];
const VEGAN_CONTRAS = new Set(["egg", "cheese", "paneer", "butter", "milk", "yogurt", "curd", "cream", "chicken", "mutton", "fish", "prawn", "shrimp", "crab", "beef", "pork"]);

const MULTI_WORD_FAMILIES = [
  ["fried rice", "friedrice"],
  ["spring roll", "springroll"],
  ["masala dosa", "dosa"],
  ["mushroom dosa", "dosa"],
  ["veg puff", "puff"],
];

// More precise than dishFamilyOf for nutrition purposes: exact token match wins, so
// "Chicken Roll" maps to the roll base rather than the substring "roll" inside "springroll".
function resolveFamily(name) {
  const lower = String(name || "").toLowerCase();
  for (const [phrase, stem] of MULTI_WORD_FAMILIES) {
    if (lower.includes(phrase)) return stem;
  }
  const tokens = lower.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let best = null;
  let bestLen = 0;
  for (const token of tokens) {
    for (const key of Object.keys(FAMILY_NUTRITION)) {
      if (token === key && key.length > bestLen) {
        best = key;
        bestLen = key.length;
      }
    }
  }
  if (best) return best;
  return dishFamilyOf(lower);
}

function hasAny(name, markers) {
  const lower = String(name || "").toLowerCase();
  const list = markers instanceof Set ? [...markers] : markers;
  return list.some((marker) => lower.includes(marker));
}

/**
 * Estimate per-serving nutrition for a catalogue item.
 * @param {{ id?: string, name?: string, category?: string, nutrition?: object }} item
 * @returns {{
 *   calories: number, protein: number, carbs: number, fat: number, fiber: number,
 *   estimated: boolean, vegetarian: boolean, vegan: boolean,
 *   containsEgg: boolean, containsDairy: boolean, containsNuts: boolean,
 *   allergens: string[], source: 'product' | 'estimate'
 * }}
 */
export function estimateNutrition(item = {}) {
  const name = item.name || "";
  const explicit = item.nutrition && typeof item.nutrition === "object"
    ? item.nutrition
    : null;

  if (explicit && Number.isFinite(Number(explicit.calories))) {
    const base = {
      calories: Math.round(Number(explicit.calories)),
      protein: Math.round(Number(explicit.protein || 0)),
      carbs: Math.round(Number(explicit.carbs || 0)),
      fat: Math.round(Number(explicit.fat || 0)),
      fiber: Math.round(Number(explicit.fiber || 0)),
    };
    const veg = explicit.vegetarian ?? !isLikelyNonVeg(name);
    return {
      ...base,
      estimated: explicit.estimated === true,
      source: "product",
      vegetarian: Boolean(veg),
      vegan: Boolean(explicit.vegan ?? (veg && !hasAny(name, VEGAN_CONTRAS))),
      containsEgg: Boolean(explicit.containsEgg ?? hasAny(name, EGG_MARKERS)),
      containsDairy: Boolean(explicit.containsDairy ?? hasAny(name, DAIRY_MARKERS)),
      containsNuts: Boolean(explicit.containsNuts ?? hasAny(name, NUT_MARKERS)),
      allergens: (explicit.allergens || []).slice(),
    };
  }

  const family = resolveFamily(name);
  const base = family
    ? { ...(FAMILY_NUTRITION[family] || { calories: 300, protein: 8, carbs: 40, fat: 10, fiber: 2 }) }
    : { calories: 300, protein: 8, carbs: 40, fat: 10, fiber: 2 };

  // Additive ingredient tweaks. First-match-wins per category so "egg sandwich" doesn't stack
  // every egg/cheese/special rule into an absurd number.
  const applied = new Set();
  INGREDIENT_ADJUSTERS.forEach((rule) => {
    if (!rule.re.test(name.toLowerCase())) return;
    const key = rule.re.source;
    if (applied.has(key)) return;
    applied.add(key);
    base.calories += rule.calories || 0;
    base.protein += rule.protein || 0;
    base.carbs += rule.carbs || 0;
    base.fat += rule.fat || 0;
    base.fiber += rule.fiber || 0;
  });

  const vegetarian = !isLikelyNonVeg(name);
  return {
    calories: Math.max(0, Math.round(base.calories)),
    protein: Math.max(0, Math.round(base.protein)),
    carbs: Math.max(0, Math.round(base.carbs)),
    fat: Math.max(0, Math.round(base.fat)),
    fiber: Math.max(0, Math.round(base.fiber)),
    estimated: true,
    source: "estimate",
    vegetarian,
    vegan: vegetarian && !hasAny(name, VEGAN_CONTRAS),
    containsEgg: hasAny(name, EGG_MARKERS),
    containsDairy: hasAny(name, DAIRY_MARKERS),
    containsNuts: hasAny(name, NUT_MARKERS),
    allergens: [],
  };
}

/**
 * Aggregate nutrition for a list of (item, quantity) line items (cart / meal plan).
 * @param {Array<{ item: object, quantity: number }>} lines
 * @returns {{ calories, protein, carbs, fat, fiber, items: number }}
 */
export function sumNutrition(lines = []) {
  const total = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  let count = 0;
  lines.forEach(({ item, quantity = 1 }) => {
    const qty = Math.max(1, Math.round(Number(quantity) || 1));
    const macro = estimateNutrition(item);
    total.calories += macro.calories * qty;
    total.protein += macro.protein * qty;
    total.carbs += macro.carbs * qty;
    total.fat += macro.fat * qty;
    total.fiber += macro.fiber * qty;
    count += qty;
  });
  return {
    calories: Math.round(total.calories),
    protein: Math.round(total.protein),
    carbs: Math.round(total.carbs),
    fat: Math.round(total.fat),
    fiber: Math.round(total.fiber),
    items: count,
    estimated: true,
  };
}

// ─── Human-readable formatting helpers (no false precision) ─────────────────────
export const formatCalories = (kcal) => `~${Math.round(kcal)} kcal`;
export const formatProtein = (grams) => `${Math.round(grams)}g protein`;
export const formatMacroLine = (macro) =>
  `${formatCalories(macro.calories)} · ${formatProtein(macro.protein)}`;
