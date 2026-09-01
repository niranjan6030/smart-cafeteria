// Food knowledge base + similarity engine (Recommendation Priority 2: "similar to your favourites").
//
// Every menu item is projected onto a lightweight *food profile* — cuisine, meal type, dish
// family, veg/non-veg, spice and ingredient keywords — derived from the item's name/category
// with a curated canteen-dish knowledge base, and optionally overridden by explicit metadata a
// stall could attach to its products later (item.cuisine / item.mealType / item.vegetarian /
// item.spice). Similarity between two dishes is then a transparent, deterministic weighted sum
// of shared profile dimensions instead of a black-box embedding, so the engine can say *why* two
// dishes are alike ("both South Indian breakfast staples") and stay fully unit-testable.
//
// Mirrors the repo convention (queueingModel.js / demandForecast.js / lstm.js): hand-written,
// dependency-free statistics rather than an ML library.

const NON_VEG_MARKERS = [
  "chicken", "mutton", "egg", "fish", "prawn", "shrimp", "crab", "lobster",
  "beef", "pork", "sausage", "bacon", "kebab", "seekh", "shawarma", "tandoori",
];

// `stem` is the canonical dish family used for the strongest similarity signal
// (Masala Dosa -> Plain Dosa etc.). `mealType` drives the Priority-4 timing signal.
const FAMILY_KNOWLEDGE = {
  dosa: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  idli: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  vada: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  poori: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  puri: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  upma: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  pongal: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  uttapam: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  uthappam: { cuisine: "South Indian", mealType: "Breakfast", category: "South Indian" },
  omelette: { cuisine: "Continental", mealType: "Breakfast", category: "Breakfast" },
  paratha: { cuisine: "North Indian", mealType: "Breakfast", category: "North Indian" },
  parotta: { cuisine: "South Indian", mealType: "Lunch", category: "South Indian" },
  naan: { cuisine: "North Indian", mealType: "Dinner", category: "North Indian" },
  roti: { cuisine: "North Indian", mealType: "Dinner", category: "North Indian" },
  chapati: { cuisine: "North Indian", mealType: "Lunch", category: "North Indian" },
  biryani: { cuisine: "North Indian", mealType: "Lunch", category: "Biryani" },
  pulao: { cuisine: "North Indian", mealType: "Lunch", category: "Rice" },
  pulav: { cuisine: "North Indian", mealType: "Lunch", category: "Rice" },
  meals: { cuisine: "South Indian", mealType: "Lunch", category: "Meals" },
  thali: { cuisine: "North Indian", mealType: "Lunch", category: "Meals" },
  rice: { cuisine: "South Indian", mealType: "Lunch", category: "Rice" },
  friedrice: { cuisine: "Chinese", mealType: "Lunch", category: "Chinese" },
  noodles: { cuisine: "Chinese", mealType: "Lunch", category: "Chinese" },
  chowmein: { cuisine: "Chinese", mealType: "Lunch", category: "Chinese" },
  manchurian: { cuisine: "Chinese", mealType: "Snack", category: "Chinese" },
  momos: { cuisine: "Chinese", mealType: "Snack", category: "Chinese" },
  springroll: { cuisine: "Chinese", mealType: "Snack", category: "Chinese" },
  pizza: { cuisine: "Fast Food", mealType: "Snack", category: "Pizza" },
  burger: { cuisine: "Fast Food", mealType: "Snack", category: "Burger" },
  fries: { cuisine: "Fast Food", mealType: "Snack", category: "Fast Food" },
  wedges: { cuisine: "Fast Food", mealType: "Snack", category: "Fast Food" },
  sandwich: { cuisine: "Fast Food", mealType: "Snack", category: "Sandwich" },
  toast: { cuisine: "Continental", mealType: "Breakfast", category: "Breakfast" },
  pasta: { cuisine: "Italian", mealType: "Lunch", category: "Pasta" },
  wrap: { cuisine: "Fast Food", mealType: "Snack", category: "Wrap" },
  roll: { cuisine: "Fast Food", mealType: "Snack", category: "Wrap" },
  kathi: { cuisine: "Fast Food", mealType: "Snack", category: "Wrap" },
  samosa: { cuisine: "North Indian", mealType: "Snack", category: "Snacks" },
  puff: { cuisine: "Bakery", mealType: "Snack", category: "Bakery" },
  patty: { cuisine: "Bakery", mealType: "Snack", category: "Bakery" },
  cookie: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  brownie: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  muffin: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  pastry: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  cake: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  donut: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  doughnut: { cuisine: "Bakery", mealType: "Snack", category: "Dessert" },
  bread: { cuisine: "Bakery", mealType: "Breakfast", category: "Bakery" },
  bun: { cuisine: "Bakery", mealType: "Snack", category: "Bakery" },
  croissant: { cuisine: "Bakery", mealType: "Breakfast", category: "Bakery" },
  coffee: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  cappuccino: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  latte: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  tea: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  chai: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  shake: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  smoothie: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  lassi: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  juice: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  lemonade: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  cola: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
  soda: { cuisine: "Beverage", mealType: "Snack", category: "Beverage" },
};

// Category keyword → fallback cuisine/mealType used when no family matched (e.g. an item the
// knowledge base has never seen). This keeps similarity working on any catalogue, not just the
// curated one.
const CATEGORY_HINTS = {
  Beverage: { cuisine: "Beverage", mealType: "Snack" },
  Juice: { cuisine: "Beverage", mealType: "Snack" },
  Shake: { cuisine: "Beverage", mealType: "Snack" },
  Dessert: { cuisine: "Bakery", mealType: "Snack" },
  Bakery: { cuisine: "Bakery", mealType: "Snack" },
  Breakfast: { cuisine: "Continental", mealType: "Breakfast" },
  "South Indian": { cuisine: "South Indian", mealType: "Breakfast" },
  "North Indian": { cuisine: "North Indian", mealType: "Lunch" },
  Chinese: { cuisine: "Chinese", mealType: "Lunch" },
  Italian: { cuisine: "Italian", mealType: "Lunch" },
  Burger: { cuisine: "Fast Food", mealType: "Snack" },
  Pizza: { cuisine: "Fast Food", mealType: "Snack" },
  Wrap: { cuisine: "Fast Food", mealType: "Snack" },
  Sandwich: { cuisine: "Fast Food", mealType: "Snack" },
  Meals: { cuisine: "South Indian", mealType: "Lunch" },
  Rice: { cuisine: "South Indian", mealType: "Lunch" },
  Biryani: { cuisine: "North Indian", mealType: "Lunch" },
  Snacks: { cuisine: "Fast Food", mealType: "Snack" },
  Soup: { cuisine: "Continental", mealType: "Snack" },
  Salad: { cuisine: "Continental", mealType: "Snack" },
  Pasta: { cuisine: "Italian", mealType: "Lunch" },
};

const STOPWORDS = new Set([
  "the", "with", "and", "special", "combo", "regular", "large", "small", "plate", "full", "half",
]);

const FAMILY_ALIASES = {
  "french fries": "fries",
  "fried rice": "friedrice",
  "rice bowl": "rice",
  "veg meals": "meals",
  "kathi roll": "roll",
  "parotta": "parotta",
  "masala dosa": "dosa",
};

// Ordered list of family stem → synonyms used to resolve `stem` from a name.
const FAMILY_MATCHERS = [
  ["spring roll", "springroll"],
  ["fried rice", "friedrice"],
  ["veg puff", "puff"],
  ["masala dosa", "dosa"],
  ["mushroom dosa", "dosa"],
];

function toTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Resolves the dish family stem ("dosa", "burger", "biryani", ...) from a dish name.
 * @param {string} name
 * @returns {string | null}
 */
export function dishFamilyOf(name) {
  const tokens = toTokens(name);
  if (tokens.length === 0) return null;

  for (const [phrase, stem] of FAMILY_MATCHERS) {
    if (name.toLowerCase().includes(phrase)) return stem;
  }

  // Longest matching family keyword wins (so "Mysore Masala Dosa" -> dosa, not masala).
  let best = null;
  let bestLength = 0;
  for (const token of tokens) {
    const familyKey = Object.keys(FAMILY_KNOWLEDGE).find(
      (key) => token === key || token.includes(key) || key.includes(token)
    );
    if (familyKey && familyKey.length > bestLength) {
      best = familyKey;
      bestLength = familyKey.length;
    }
  }
  return best;
}

/**
 * Whether a dish name looks non-vegetarian.
 * @param {string} name
 * @returns {boolean}
 */
export function isLikelyNonVeg(name) {
  const lower = String(name || "").toLowerCase();
  return NON_VEG_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Infers a food profile for a catalogue item.
 * @param {{ id?: string, name?: string, category?: string, cuisine?: string, mealType?: string,
 *           vegetarian?: boolean, spice?: string }} item
 * @returns {{
 *   category: string | null, cuisine: string | null, mealType: string | null,
 *   vegetarian: boolean, spice: string, stem: string | null, keywords: string[]
 * }}
 */
export function inferFoodProfile(item = {}) {
  const name = item.name || "";
  const stem = dishFamilyOf(name);
  const family = stem ? FAMILY_KNOWLEDGE[stem] : null;

  const categoryHint = item.category ? CATEGORY_HINTS[item.category] : null;
  const cuisine = item.cuisine || family?.cuisine || categoryHint?.cuisine || null;
  const mealType = item.mealType || family?.mealType || categoryHint?.mealType || null;
  const category = item.category || family?.category || null;

  // Vegetarian unless explicit metadata says otherwise OR the name clearly says otherwise.
  const vegetarian =
    typeof item.vegetarian === "boolean" ? item.vegetarian : !isLikelyNonVeg(name);

  const keywords = [...new Set(toTokens(name))]
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && token !== stem)
    .slice(0, 8);

  return { category, cuisine, mealType, vegetarian, spice: item.spice || "medium", stem, keywords };
}

/**
 * Similarity score in [0, 1] between two food profiles. Weighted, transparent, deterministic:
 *   +0.50 same dish family     (Masala Dosa vs Plain Dosa)
 *   +0.20 same cuisine         (both South Indian)
 *   +0.10 same category        (both under "South Indian")
 *   +0.10 same meal type       (both breakfast staples)
 *   +0.10 × keyword Jaccard    (shared ingredients / descriptors)
 *   -0.35 veg/non-veg mismatch (never drift across the dietary boundary)
 * @param {ReturnType<typeof inferFoodProfile>} a
 * @param {ReturnType<typeof inferFoodProfile>} b
 * @returns {number}
 */
export function profileSimilarity(a, b) {
  if (!a || !b) return 0;
  let score = 0;

  if (a.stem && a.stem === b.stem) score += 0.5;
  if (a.cuisine && a.cuisine === b.cuisine) score += 0.2;
  if (a.category && a.category === b.category) score += 0.1;
  if (a.mealType && a.mealType === b.mealType) score += 0.1;

  const setA = new Set(a.keywords);
  const setB = new Set(b.keywords);
  if (setA.size && setB.size) {
    let intersection = 0;
    setA.forEach((k) => { if (setB.has(k)) intersection += 1; });
    const union = new Set([...setA, ...setB]).size;
    if (union > 0) score += 0.1 * (intersection / union);
  }

  if (a.vegetarian !== b.vegetarian) score -= 0.35;

  return Math.min(1, Math.max(0, score));
}

/**
 * Convenience wrapper scoring two raw catalogue items.
 * @param {object} itemA
 * @param {object} itemB
 * @param {Map<string, ReturnType<typeof inferFoodProfile>>} [profileById]
 * @returns {number}
 */
export function similarityBetween(itemA, itemB, profileById = null) {
  const pa = profileById?.get(itemA?.id) || inferFoodProfile(itemA);
  const pb = profileById?.get(itemB?.id) || inferFoodProfile(itemB);
  return profileSimilarity(pa, pb);
}

/**
 * Top-N similar dishes for a target item, mirroring the spec's substitution/exploration
 * behaviour ("Masala Dosa -> Plain Dosa, Rava Dosa, ..."). Skips the target itself and any
 * veg/non-veg mismatch below the similarity floor.
 * @param {string} itemId
 * @param {Array<object>} catalog
 * @param {{ topN?: number, minScore?: number, profileById?: Map }} [options]
 * @returns {Array<{ item: object, score: number }>}
 */
export function findSimilarItems(itemId, catalog = [], { topN = 5, minScore = 0.25, profileById = null } = {}) {
  const target = catalog.find((item) => item?.id === itemId);
  if (!target) return [];
  const profiles = profileById || new Map(catalog.map((item) => [item.id, inferFoodProfile(item)]));
  return catalog
    .filter((item) => item?.id && item.id !== itemId)
    .map((item) => ({ item, score: profileSimilarity(profiles.get(item.id), profiles.get(itemId)) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ─── Meal-session mapping (Recommendation Priority 4) ─────────────────────────
export const MEAL_SESSIONS = ["Breakfast", "Lunch", "Snacks", "Dinner"];

export const MEAL_SESSION_HOURS = { Breakfast: [5, 10], Lunch: [11, 15], Snacks: [16, 18], Dinner: [19, 22] };

/**
 * Maps an hour-of-day to the current meal session.
 * @param {number} hour
 * @returns {string}
 */
export function mealSessionFor(hour) {
  if (hour >= 5 && hour < 10) return "Breakfast";
  if (hour >= 11 && hour < 15) return "Lunch";
  if (hour >= 19 && hour < 22) return "Dinner";
  return "Snacks";
}

/**
 * How well a food profile fits a meal session. Items without an inferred meal type stay neutral
 * (0.5) so unknown dishes neither win nor lose purely because of timing.
 * @param {ReturnType<typeof inferFoodProfile>} profile
 * @param {string} session
 * @returns {number}
 */
export function mealTypeMatch(profile, session) {
  if (!profile?.mealType) return 0.5;
  return profile.mealType === session ? 1 : 0.15;
}
