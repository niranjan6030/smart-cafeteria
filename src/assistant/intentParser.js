// Food Assistant — deterministic NLU (intent + constraint extraction).
//
// Same philosophy as the voice rule parser (src/voice/nlu/ruleParser.js): dependency-free,
// unit-testable, no LLM in the loop. It turns a free-form utterance into a structured turn that
// the tool layer can execute against REAL cafeteria data. The output is intentionally a data
// object, so a future LLM-based interpreter can be swapped in behind the same seam without
// touching the tools or the UI.

const STALL_NAMES = ["Falcon Veg", "Fresheteria", "Mingos", "Break Time", "Surf & Turf", "Bakery"];

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
};

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[''’]/g, "")
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    // Common cafeteria-English misspellings — real users typo, the intent layer shouldn't care.
    .replace(/\bprotien\b|\bprotiend\b|\bprotiens\b|\bprotiends\b/g, "protein")
    .replace(/\bavai?able\b|\bavaible\b/g, "available")
    .replace(/\bcaloires?\b/g, "calorie")
    .replace(/\bvegitarian\b/g, "vegetarian")
    .replace(/\bchep\b|\bchepa\b/g, "cheap")
    .trim();

// ─── Constraint extraction ─────────────────────────────────────────────────────

function extractBudget(text) {
  const budgetPatterns = [
    /(?:under|below|within|less than|less|at most|max(?:imum)?|up to|upto|around|about|my budget (?:is|of)|i have|only have|have)(?:\s*)₹?\s*(\d{2,6})/,
    /₹\s*(\d{2,6})/,
    /(\d{2,6})\s*(?:rupees|rs\.?|bucks|inr)/,
    /budget(?: of)? (?:is|of)?\s*₹?\s*(\d{2,6})/,
  ];
  for (const re of budgetPatterns) {
    const match = text.match(re);
    if (match) return Math.max(10, Math.round(Number(match[1])));
  }
  return null;
}

function extractQuantity(text) {
  const digit = text.match(/(?:^|\s)(\d{1,2})(?=\s*[a-z])/);
  if (digit) return Math.max(1, Math.min(12, Number(digit[1])));
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return 1;
}

// Detects whether the phrase is a *specific* product mention rather than a generic request.
// Generic words ("something", "anything", "options", "food", "meal", "dishes") signal discovery.
function isGenericPhrase(phrase) {
  const p = normalize(phrase);
  if (!p) return true;
  if (/^(a |an |some |the )/.test(p)) {
    const rest = p.replace(/^(a |an |some |the )/, "");
    if (isGenericPhrase(rest)) return true;
  }
  return /^(something|anything|some|options|dishes|items|meal|snack|lunch|breakfast|dinner|what|it|that|this|all|one)$/.test(p);
}

// Discovery-style phrasing ("what's high in protein", "best veg option") — a menu search,
// never a nutrition lookup of one dish.
function isDiscoveryQuery(text) {
  return /what'?s (?:the )?(best|good|high|low|most)|high in|low in|something|options|dishes|items|menu|food\b|what has|which food|what'?s? on|show me/.test(text);
}

function extractConstraints(text) {
  const constraints = {
    budget: null,
    minProtein: null,
    maxCalories: null,
    vegetarian: false,
    vegan: false,
    nonVeg: false,
    protein: null,
    calories: null,
    filling: false,
    light: false,
    affordable: false,
    meal: null,
    stall: null,
    category: null,
    available: false,
    excludeRecent: false,
    containsEgg: false,
    containsDairy: false,
    containsNuts: false,
  };

  constraints.budget = extractBudget(text);

  const minProtein = text.match(/(?:at least|minimum|min(?:imum)?|≥|>)\s*(\d{1,3})\s*g(?:rams?)?(?: of)? protein|(\d{1,3})\s*g(?:ram)?s?\s*(?:of\s+)?protein/i);
  if (minProtein) constraints.minProtein = Math.max(1, Math.round(Number(minProtein[1] || minProtein[2])));
  const maxCalories = text.match(/(?:below|under|less than|at most|max(?:imum)?)\s*(\d{2,4})\s*(?:kcal|calories?|cal\b)/i);
  if (maxCalories) constraints.maxCalories = Math.round(Number(maxCalories[1]));

  if (/(vegetarian|veg\b|pure veg|no meat|no chicken|no egg\b)/.test(text)) constraints.vegetarian = true;
  if (/\bvegan\b/.test(text)) { constraints.vegan = true; constraints.vegetarian = true; }
  if (/non[ -]?veg\b|meat|chicken|mutton|fish\b|prawn|egg\b/.test(text) && !/no (meat|chicken|egg)\b/.test(text)) constraints.nonVeg = true;

  if (/high protein|protein rich|high in protein|rich in protein|protein packed|protein heavy|most protein|more protein|good protein|max protein/.test(text)) constraints.protein = "high";
  if (/low calorie|low cal|lowest calorie|fewer calories|less calorie|calorie conscious|diet food/.test(text)) constraints.calories = "low";
  if (/high calorie|most calorie/.test(text)) constraints.calories = "high";

  if (/\bfilling\b|hearty|substantial|something filling|filling food|hungry/.test(text)) constraints.filling = true;
  if (/not too heavy|light(?: food)?\b|something light|low fat|easy on the stomach|not heavy/.test(text)) constraints.light = true;
  if (/\bcheap\b|affordable|budget friendly|economical|low price|lower price|cheapest/.test(text)) constraints.affordable = true;

  const mealMatch = text.match(/\b(breakfast|lunch|dinner|supper|brunch|snack|mid[ -]day meal|afternoon meal)\b/);
  if (mealMatch) {
    const raw = mealMatch[1].replace(/[ -]/g, "");
    constraints.meal = raw === "midday" || raw === "afternoon" ? "lunch" : raw === "supper" ? "dinner" : raw;
  }

  for (const stall of STALL_NAMES) {
    if (text.includes(stall.toLowerCase())) {
      constraints.stall = stall;
      break;
    }
  }

  if (/(right now|currently available|available today|available right now|what.*available|today\b.*available)/.test(text) || /\bavailable\b/.test(text)) {
    constraints.available = true;
  }
  if (/haven'?t ordered|not ordered|haven'?t had|not had|haven'?t tried|new to me|something new|haven'?t tried before|recently (?:ordered|had)/.test(text) && /not|haven|new|haven/.test(text)) {
    constraints.excludeRecent = true;
  }

  if (/\bcontains? egg\b|with egg\b|\begg\b/.test(text) && !constraints.vegetarian && !constraints.nonVeg) constraints.containsEgg = true;
  if (/\b(cheese|paneer|dairy|milk)\b/.test(text) && /contains?|with |no |without|avoid/.test(text)) constraints.containsDairy = true;
  if (/\b(nuts?|peanut|almond)\b/.test(text) && /contains?|with |no |without|avoid/.test(text)) constraints.containsNuts = true;

  return constraints;
}

// ─── Intent classification ─────────────────────────────────────────────────────

const GREETING_RE = /^(hi|hello|hey|yo|namaste|good (morning|afternoon|evening))(\s|!|$)/;
const THANKS_RE = /^(thanks|thank you|thx|ty|awesome|great|perfect|nice|ok|okay)(\s|!|$)/;
const HELP_RE = /(how (do|can|should) i use|what can you do|what can i ask|how does this work|help me use)/;

const CART_QUERY_RE = /what'?s? (?:in|inside) my cart|what do i have in my cart|my cart|show (?:me )?my cart|in my cart/i;
const CART_NUTRITION_RE = /(calories|protein|nutrition|calorie).*(cart)|cart.*(calories|protein)/i;
const CART_CHEAPER_RE = /(make|is|can|could).*(cart).*(cheap|less|lower|reduce)|(cheap|less|lower|reduce).*(cart)/i;
const CART_CLEAR_RE = /(clear|empty).*(cart)|(cart).*(clear|empty)/i;
const CART_REMOVE_RE = /remove|take out|take off|delete|drop the|minus the/i;
const CART_UPDATE_RE = /change|set|make it|quantity to|qty to/i;
const CART_ADD_RE = /add to cart|add |put |i'?d like|i want|i will have|give me|can i get|order me|throw in|get me/i;

const COMPARE_RE = /compare|versus| vs |which (?:one )?has (?:more|less|higher|lower)|which is (?:more|less|cheaper|expensive|healthier)/i;
const NUTRITION_ITEM_RE = /how (?:many|much)|calorie|calories|protein|carbs|carbohydrates|fat content|nutrition|nutritional|healthier|healthy/i;
const SIMILAR_RE = /similar to|like (?:my|the|that)|something like|same as|similar (?:items|options|food|dishes)|close to/i;
const MEAL_BUILDER_RE = /build|create|make me|plan|construct|put together|assemble/i;
const RECOMMEND_RE = /recommend|suggest|what should i (eat|order|get|try)|what'?s (?:the )?best|what'?s good|what do you suggest|what would you (?:recommend|suggest)|what should i have|pick for me|what do i feel like/i;
const USUALS_RE = /usual|my regular|normally get|usually order|regular order|go to order|go-to/i;
const RECENT_RE = /did i order|recently ordered|ordered (?:recently|yesterday|last|today)|my (?:last|recent) (?:order|orders)|recent order|yesterday/i;
const AVAILABILITY_RE = /available right now|available today|currently available|is it available|is that available|what'?s available|what is available|open right now|open now|is the (?:stall|shop)/i;
const PRICE_RE = /how much (?:is|does|do)|price of|cost of|how much does|prices?|cheapest|what'?s (?:the )?price/i;
const STALL_RE = /from (falcon veg|fresheteria|mingos|break time|surf & turf|bakery)|at (falcon veg|fresheteria|mingos|break time|surf & turf|bakery)|(falcon veg|fresheteria|mingos|break time|surf & turf|bakery) (menu|food|items|dishes|stall|shop)/i;
const OPEN_CART_RE = /open (?:my )?cart|take me to (?:my )?cart|go to (?:my )?cart|show (?:me )?cart/i;
const CHECKOUT_RE = /checkout|check out|place (?:my )?order|pay now|proceed to (?:payment|checkout)/i;

const SEARCH_VERB_RE = /show|find|what|which|something|anything|options|dishes|items|menu|food|eat|recommend|build|get me|give me|try|pick|available|have\b/i;

const MEAL_GOAL_WORDS = new Set(["breakfast", "lunch", "dinner", "supper", "brunch", "snack"]);

function hasCompareCandidates(text) {
  // At least two clearly delimited product mentions: "A and B", "A vs B", "A or B".
  return /\b(?:and|vs\.?|versus|or)\b/.test(text);
}

function extractCompareTargets(text) {
  const cleaned = normalize(text);
  const trimmed = cleaned
    .replace(/^(?:compare|comparing)\s*/, "")
    .replace(/^(?:which (?:one )?has (?:more|less|higher|lower|better) (?:protein|calories?|price|nutrition|carbs|fat|fiber)|which (?:one )?is (?:more|less|cheaper|expensive|healthier|better|higher in))\s*/i, "")
    .replace(/\?$/, "");

  const parts = trimmed
    .split(/\s*(?:versus| vs | vs\. | and | or )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.slice(0, 3).map((part) => part.replace(/^(?:the|a|an)\s+/, ""));
}

function extractSinglePhrase(text) {
  let t = normalize(text);
  t = t
    .replace(/^how (?:many|much).*\b(?:in|does|is)\b\s*/, "")
    .replace(/^(?:what'?s|what is|tell me)\s*(?:the|about)?\s*/, "")
    .replace(/^(?:is|are)\s*/, "")
    .replace(/\?$/, "");
  return t.trim();
}

/**
 * Parse a single user message into a structured turn.
 * @param {string} raw
 * @returns {import("./types.js").AssistantTurn}
 */
export function parseTurn(raw) {
  const text = normalize(raw);
  const constraints = extractConstraints(text);
  const quantity = extractQuantity(text);

  let intent = "unknown";
  let itemPhrase = null;
  let itemPhrases = null;
  let stallPhrase = null;
  let isModifier = false;
  let focus = null;

  if (!text) return { intent: "unknown", constraints, isModifier, raw: text, focus: null };

  if (GREETING_RE.test(text)) intent = "greeting";
  else if (THANKS_RE.test(text)) intent = "thanks";
  else if (HELP_RE.test(text)) intent = "help";
  else if (CHECKOUT_RE.test(text)) intent = "checkout";
  else if (OPEN_CART_RE.test(text)) intent = "open_cart";
  else if (CART_CLEAR_RE.test(text)) intent = "cart_clear";
  else if (CART_CHEAPER_RE.test(text)) intent = "cart_cheaper";
  else if (CART_NUTRITION_RE.test(text)) intent = "cart_query";
  else if (CART_QUERY_RE.test(text)) intent = "cart_query";
  else if (/(reorder|order|get me|bring back|rebuy).*(usual|regular|go[ -]?to|usual order)/.test(text)) intent = "reorder_usuals";
  else if (USUALS_RE.test(text)) intent = "usuals";
  else if (RECENT_RE.test(text) && !/haven'?t (?:ordered|had)|(?:haven|not|never).*(?:ordered|had)|new to me|haven'?t tried/.test(text)) intent = "recent_orders";
  else if (CART_REMOVE_RE.test(text) && hasProductMention(text)) intent = "cart_remove";
  else if (CART_UPDATE_RE.test(text) && /quantity|qty|amount|\bto\b/.test(text)) intent = "cart_update";
  else if (CART_ADD_RE.test(text) && hasSpecificEntity(text)) intent = "cart_add";
  else if (COMPARE_RE.test(text) && hasCompareCandidates(text)) {
    intent = "compare";
    itemPhrases = extractCompareTargets(text);
  }
  else if (SIMILAR_RE.test(text)) {
    intent = "similar";
    itemPhrase = extractSimilarTarget(text);
  }
  else if (MEAL_BUILDER_RE.test(text) || (constraints.meal && constraints.budget) || (/meal\b/.test(text) && /\b(under|below|within|₹|budget|protein|calorie)/.test(text))) {
    intent = "meal_builder";
  }
  else if (NUTRITION_ITEM_RE.test(text) && hasSpecificEntity(text) && !isDiscoveryQuery(text)) {
    intent = "nutrition";
    itemPhrase = extractSinglePhrase(text);
  }
  else if (PRICE_RE.test(text) && hasSpecificEntity(text)) intent = "price";
  else if (AVAILABILITY_RE.test(text)) intent = "availability";
  else if (STALL_RE.test(text)) intent = "stall";
  else if (/(?:what'?s|what is|which is) (?:the )?best|the best|best .*(food|option|item|dish|eat|order|vegetarian|veg)/.test(text) && /food|option|item|dish|eat|order|vegetarian|veg/.test(text)) intent = "food_search";
  else if (RECOMMEND_RE.test(text)) intent = "recommend";
  else if (/popular|trending|most (ordered|bought)|what'?s hot|best sellers?/.test(text)) {
    intent = "popular";
    constraints.available = constraints.available || true;
  }
  else if (/what can i eat|what'?s? (?:on )?the menu|show me (?:the )?menu|what do you (?:have|serve)|browse/.test(text)) intent = "food_search";
  else if (SEARCH_VERB_RE.test(text) || MEAL_GOAL_WORDS.has(text)) intent = "food_search";
  else {
    // Pure constraint refinement with no new search verb → conversational memory modifier.
    const hasConstraints =
      constraints.budget != null || constraints.minProtein != null || constraints.maxCalories != null ||
      constraints.vegetarian || constraints.vegan ||
      constraints.nonVeg || constraints.protein || constraints.calories || constraints.filling ||
      constraints.light || constraints.affordable || constraints.meal || constraints.excludeRecent;
    if (hasConstraints) {
      intent = "modifier";
      isModifier = true;
    } else if (text.includes("cart")) intent = "cart_query";
  }

  // Focus hints that alter ranking (protein/calorie/price/popularity).
  if (/most protein|best protein|protein rich|high in protein|rich in protein|highest protein|max protein|protein packed|high[ -]?protein/.test(text)) focus = "protein";
  else if (/most calorie|highest calorie|lowest calorie|fewest calorie|low calorie|lowest cal|light/.test(text)) focus = "calories";
  else if (/cheapest|cheap|affordable|best (?:protein )?for|under .*budget/.test(text)) focus = "price";
  else if (/popular|trending|most (?:ordered|bought)/.test(text)) focus = "popular";

  // Item phrase for add/remove/update/nutrition/price intents.
  if ((intent === "cart_add" || intent === "cart_remove" || intent === "cart_update") && !itemPhrase) {
    itemPhrase = extractActionItem(text);
  }
  if (intent === "nutrition" && !itemPhrase) itemPhrase = extractSinglePhrase(text);
  if (intent === "price" && !itemPhrase) itemPhrase = extractSinglePhrase(text);

  if (intent === "stall") {
    const match = text.match(/(falcon veg|fresheteria|mingos|break time|surf & turf|bakery)/);
    stallPhrase = match ? match[1] : null;
  }

  return { intent, constraints, quantity, itemPhrase, itemPhrases, stallPhrase, isModifier, focus, raw: text };
}

// ─── Entity-phrase helpers ─────────────────────────────────────────────────────

function hasProductMention(text) {
  const t = normalize(text)
    .replace(/^(remove|take out|take off|delete|drop)\s*/, "")
    .replace(/^(?:the|a|an)\s+/, "");
  if (!t) return false;
  if (/^(something|anything|it|that|this|items|food|dish|all|one)$/.test(t)) return false;
  return !/(my|the) (cart|order|meal|usual)/.test(t);
}

function hasSpecificEntity(text) {
  const t = normalize(text);
  if (isGenericPhrase(t)) return false;
  if (/something|anything|options|dishes|items|food\b/.test(t)) return false;
  const stripped = t
    .replace(/^(?:i'?d like|i want|i will have|give me|can i get|add|put|throw in)\s+(?:\d+\s+)?/, "")
    .trim();
  if (!stripped) return false;
  if (/^(?:breakfast|lunch|dinner|supper|brunch|snack|a meal|meal)$/.test(stripped)) return false;
  if (/(meal|budget|under|below|₹)/.test(stripped)) return false;
  return true;
}

function extractActionItem(text) {
  let t = normalize(text);
  const removeAction = /^(remove|take out|take off|delete|drop)\s+/.exec(t);
  if (removeAction) return t.slice(removeAction[0].length).trim();

  const updateMatch = /^(?:change|set|make)\s+(?:the\s+)?/.exec(t);
  if (updateMatch) {
    let rest = t.slice(updateMatch[0].length).replace(/^(?:the\s+)?/, "");
    rest = rest
      .replace(/\s+(?:quantity|qty|amount)\s+(?:to\s+)?.*$/, "")
      .replace(/\s+to\s+\d+$/, "")
      .replace(/\s+\d+$/, "")
      .trim();
    return rest;
  }

  const addPatterns = [
    /^(?:add|add to cart|put|get me|give me|throw in)\s+(?:\d+\s+)?/,
    /^i'?d like\s+(?:\d+\s+)?/,
    /^i want\s+(?:\d+\s+)?/,
    /^i will have\s+(?:\d+\s+)?/,
    /^can i get\s+(?:\d+\s+)?/,
  ];
  for (const re of addPatterns) {
    const match = re.exec(t);
    if (match) {
      const rest = t.slice(match[0].length);
      return rest.replace(/\s+\d+$/g, "").trim();
    }
  }
  return t.replace(/^(?:a|an|some|the)\s+/, "").trim();
}

function extractSimilarTarget(text) {
  let t = normalize(text);
  const re = /(?:similar to|like|something like|same as|similar)\s+(?:my|the|that|this)?\s*(.+)$/;
  const match = re.exec(t);
  const phrase = match ? match[1] : null;
  if (!phrase) return null;
  return phrase.replace(/^(?:my usual|usual|favourite|favorite|regular)\s+/, "").trim();
}

// Re-export the stall list so the engine and tools share one source of truth.
export const ASSISTANT_STALL_NAMES = STALL_NAMES;
