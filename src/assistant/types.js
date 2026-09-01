// Food Assistant — shared type constants + typedefs (docs only, no runtime logic).

/** Structured response kinds the frontend renders distinctly (spec §17). */
export const RESPONSE_TYPE = {
  TEXT: "TEXT",
  FOOD_LIST: "FOOD_LIST",
  FOOD_COMPARISON: "FOOD_COMPARISON",
  NUTRITION_RESULT: "NUTRITION_RESULT",
  RECOMMENDATION_LIST: "RECOMMENDATION_LIST",
  CART_SUMMARY: "CART_SUMMARY",
  MEAL_PLAN: "MEAL_PLAN",
  CONFIRMATION: "CONFIRMATION",
  CLARIFICATION: "CLARIFICATION",
  ERROR: "ERROR",
};

/** Controlled cart actions a turn may propose (never executed by the model directly). */
export const ACTION_TYPE = {
  ADD_ITEM: "ADD_ITEM",
  REMOVE_ITEM: "REMOVE_ITEM",
  UPDATE_QUANTITY: "UPDATE_QUANTITY",
  ADD_ITEMS: "ADD_ITEMS",
  REPLACE_CART: "REPLACE_CART",
  OPEN_CART: "OPEN_CART",
  CHECKOUT: "CHECKOUT",
};

/**
 * @typedef {Object} NutritionInfo
 * @property {number} calories
 * @property {number} protein
 * @property {number} carbs
 * @property {number} fat
 * @property {number} fiber
 * @property {boolean} estimated — true when values are estimates, never presented as exact
 * @property {boolean} vegetarian
 * @property {boolean} vegan
 * @property {boolean} containsEgg
 * @property {boolean} containsDairy
 * @property {boolean} containsNuts
 * @property {string} source — 'estimate' | 'product'
 */

/**
 * @typedef {Object} FoodItemData
 * @property {string} id
 * @property {string} name
 * @property {number} price
 * @property {string} shop
 * @property {string} [category]
 * @property {string} [image]
 * @property {string} [emoji]
 * @property {number} [rating]
 * @property {number} [reviewCount]
 * @property {boolean} available
 * @property {NutritionInfo} nutrition
 * @property {string} [reason] — short human explanation when recommended
 */

/**
 * @typedef {Object} AssistantTurn
 * @property {string} intent
 * @property {object} constraints
 * @property {number} [quantity]
 * @property {string} [itemPhrase]
 * @property {string[]} [itemPhrases]
 * @property {string} [stallPhrase]
 * @property {boolean} [isModifier]
 * @property {string} [focus]
 * @property {string} raw
 */

/**
 * @typedef {Object} ProposedAction
 * @property {string} type — ACTION_TYPE
 * @property {string} [productId]
 * @property {number} [quantity]
 * @property {object} [product] — full product snapshot needed by the client dispatcher
 * @property {Array} [items] — for ADD_ITEMS / REPLACE_CART
 * @property {string} [label]
 */

/**
 * @typedef {Object} AssistantResponse
 * @property {string} type — RESPONSE_TYPE
 * @property {string} reply — natural-language summary for screen readers / plain-text clients
 * @property {object} [data]
 * @property {ProposedAction[]} [actions]
 * @property {object} [constraints] — constraints applied, for conversational memory
 */
