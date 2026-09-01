/**
 * Pure cart mutation — shared by manual UI and voice command engine.
 * @param {Array} cart
 * @param {object} item
 * @param {number} delta
 * @param {string} activeShop
 */
export function applyCartDelta(cart, item, delta, activeShop) {
  const existing = cart.find((cartItem) => cartItem.id === item.id);
  if (existing) {
    const quantity = existing.quantity + delta;
    if (quantity <= 0) return cart.filter((cartItem) => cartItem.id !== item.id);
    return cart.map((cartItem) => (cartItem.id === item.id ? { ...cartItem, quantity } : cartItem));
  }
  const resolvedShop = item.shop === "Fresh Time" ? "Break Time" : (item.shop || activeShop);
  if (delta > 0) return [...cart, { ...item, quantity: 1, shop: resolvedShop }];
  return cart;
}

/**
 * @param {Array} cart
 * @param {object} item
 * @param {number} quantity
 * @param {string} activeShop
 */
export function setCartItemQuantity(cart, item, quantity, activeShop) {
  if (quantity <= 0) return cart.filter((cartItem) => cartItem.id !== item.id);
  const existing = cart.find((cartItem) => cartItem.id === item.id);
  const resolvedShop = item.shop === "Fresh Time" ? "Break Time" : (item.shop || activeShop);
  if (existing) {
    return cart.map((cartItem) => (cartItem.id === item.id ? { ...cartItem, quantity } : cartItem));
  }
  return [...cart, { ...item, quantity, shop: resolvedShop }];
}

/**
 * @param {Array} catalog
 * @param {string} productId
 */
export function findProductById(catalog, productId) {
  return catalog.find((item) => item.id === productId) || null;
}
