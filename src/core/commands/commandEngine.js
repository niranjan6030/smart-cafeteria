import { applyCartDelta, findProductById, setCartItemQuantity } from "../cart/cartLogic.js";

/** @typedef {'manual' | 'voice' | 'hybrid'} InputModality */

/**
 * @typedef {Object} CommandContext
 * @property {Array} cart
 * @property {string} activeShop
 * @property {Array} catalog
 * @property {boolean} isInteractive
 * @property {string[]} productCategories
 * @property {object | null} [lastActionProduct]
 */

/**
 * @typedef {Object} CommandEffects
 * @property {Array} [cart]
 * @property {string} [activeShop]
 * @property {string} [searchQuery]
 * @property {string | null} [categoryFilter]
 * @property {boolean} [openCart]
 * @property {boolean} [checkout]
 * @property {boolean} [showLoginModal]
 * @property {boolean} [scrollToMenu]
 * @property {object | null} [lastActionProduct]
 * @property {string} [preferredShop]
 * @property {boolean} [clearCart]
 */

/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {string} [message]
 * @property {'info' | 'success' | 'error' | 'confirm'} [tone]
 * @property {CommandEffects} effects
 * @property {string} [commandType]
 * @property {object} [meta]
 */

/**
 * Resolve category name fuzzily against live categories.
 * @param {string} phrase
 * @param {string[]} categories
 */
function resolveCategory(phrase, categories) {
  const needle = phrase.toLowerCase().trim();
  const exact = categories.find((c) => c.toLowerCase() === needle);
  if (exact) return exact;
  return categories.find((c) => c.toLowerCase().includes(needle) || needle.includes(c.toLowerCase())) || null;
}

/**
 * @param {import("./types.js").AppCommand} command
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
export function executeCommand(command, ctx) {
  // Browsing/navigation stays possible while a stall is closed or busy; cart mutations,
  // checkout, and undo are the only things blocked. SELECT_STALL is allowed so a user can move
  // to an open stall from a closed one (manual and voice must agree — the old voice path blocked
  // this and the manual path did not). NOOP is a reporting-only no-op (e.g. STT failures) and is
  // never a real mutation.
  const blocked =
    !ctx.isInteractive &&
    !["OPEN_CART", "SCROLL_TO_MENU", "SET_SEARCH", "SET_CATEGORY", "SELECT_STALL", "NOOP", "HELP"].includes(command.type);

  if (blocked) {
    return {
      success: false,
      message: "This stall is closed or busy right now.",
      tone: "error",
      commandType: command.type,
      effects: {},
    };
  }

  switch (command.type) {
    case "SELECT_STALL":
      return {
        success: true,
        message: `Switched to ${command.stallName}.`,
        tone: "success",
        commandType: command.type,
        effects: {
          activeShop: command.stallName,
          preferredShop: command.stallName,
          clearCart: true,
          categoryFilter: null,
          searchQuery: "",
        },
      };

    case "SET_SEARCH":
      return {
        success: true,
        message: command.query ? `Searching for ${command.query}.` : "Search cleared.",
        tone: "info",
        commandType: command.type,
        effects: {
          searchQuery: command.query,
          categoryFilter: null,
        },
      };

    case "SET_CATEGORY": {
      const category = command.category;
      return {
        success: true,
        message: category ? `Showing ${category}.` : "Showing all categories.",
        tone: "info",
        commandType: command.type,
        effects: {
          categoryFilter: category,
          searchQuery: category ? "" : undefined,
        },
      };
    }

    case "SHOW_VEGETARIAN": {
      const vegCategory =
        resolveCategory("vegetarian", ctx.productCategories) ||
        resolveCategory("veg", ctx.productCategories);
      return {
        success: true,
        message: vegCategory ? `Showing ${vegCategory}.` : "Showing vegetarian options.",
        tone: "info",
        commandType: command.type,
        effects: vegCategory
          ? { categoryFilter: vegCategory, searchQuery: "" }
          : { searchQuery: "veg", categoryFilter: null },
      };
    }

    case "UPDATE_QUANTITY": {
      const product = command.product || findProductById(ctx.catalog, command.productId);
      if (!product) {
        return {
          success: false,
          message: "Item not found on the menu.",
          tone: "error",
          commandType: command.type,
          effects: {},
        };
      }
      const nextCart = applyCartDelta(ctx.cart, product, command.delta, ctx.activeShop);
      const added = command.delta > 0;
      return {
        success: true,
        message: added ? `Added ${product.name}.` : `Updated ${product.name}.`,
        tone: "success",
        commandType: command.type,
        effects: {
          cart: nextCart,
          lastActionProduct: added ? product : ctx.lastActionProduct,
        },
        meta: { productId: product.id, productName: product.name, delta: command.delta },
      };
    }

    case "ADD_ITEM": {
      const product = command.product || findProductById(ctx.catalog, command.productId);
      if (!product) {
        return {
          success: false,
          message: "Item not found on the menu.",
          tone: "error",
          commandType: command.type,
          effects: {},
        };
      }
      const existing = ctx.cart.find((entry) => entry.id === product.id);
      const currentQty = existing?.quantity || 0;
      const nextCart = setCartItemQuantity(ctx.cart, product, currentQty + command.quantity, ctx.activeShop);
      return {
        success: true,
        message: `Added ${command.quantity} ${product.name}.`,
        tone: "success",
        commandType: command.type,
        effects: {
          cart: nextCart,
          lastActionProduct: product,
        },
        meta: { productId: product.id, productName: product.name, quantity: command.quantity },
      };
    }

    case "REMOVE_ITEM": {
      const product = command.product || findProductById(ctx.catalog, command.productId);
      if (!product) {
        return {
          success: false,
          message: "Item not found in cart.",
          tone: "error",
          commandType: command.type,
          effects: {},
        };
      }
      const qty = command.quantity ?? 1;
      const nextCart = applyCartDelta(ctx.cart, product, -qty, ctx.activeShop);
      return {
        success: true,
        message: `Removed ${qty} ${product.name}.`,
        tone: "success",
        commandType: command.type,
        effects: { cart: nextCart },
        meta: { productId: product.id, productName: product.name, quantity: qty },
      };
    }

    case "UNDO_LAST": {
      const last = ctx.lastActionProduct;
      if (!last) {
        return {
          success: false,
          message: "Nothing to undo.",
          tone: "error",
          commandType: command.type,
          effects: {},
        };
      }
      const nextCart = applyCartDelta(ctx.cart, last, -1, ctx.activeShop);
      return {
        success: true,
        message: `Removed ${last.name} from your cart.`,
        tone: "success",
        commandType: command.type,
        effects: { cart: nextCart, lastActionProduct: null },
        meta: { productId: last.id, productName: last.name },
      };
    }

    case "OPEN_CART":
      return {
        success: true,
        message: "Showing your cart.",
        tone: "info",
        commandType: command.type,
        effects: { openCart: true },
      };

    case "CHECKOUT":
      return {
        success: true,
        message: "Opening checkout.",
        tone: "success",
        commandType: command.type,
        effects: { checkout: true },
      };

    case "SCROLL_TO_MENU":
      return {
        success: true,
        tone: "info",
        commandType: command.type,
        effects: { scrollToMenu: true, searchQuery: "", categoryFilter: null },
      };

    case "NOOP":
      return {
        success: false,
        message: command.reason,
        tone: "error",
        commandType: command.type,
        effects: {},
      };

    case "HELP":
      return {
        success: true,
        message:
          "You can say: add two masala dosa, show vegetarian food, go to mingos, or checkout.",
        tone: "info",
        commandType: command.type,
        effects: {},
      };

    default:
      return {
        success: false,
        message: "Unknown command.",
        tone: "error",
        commandType: "UNKNOWN",
        effects: {},
      };
  }
}
