import { describe, it, expect } from "vitest";
import {
  buildCatalogIndex,
  buildEventSequence,
  buildTokens,
  computeAddOnSuggestions,
  computePopularPairs,
  computeRecommendations,
} from "./recommenderEngine";

const NOW = new Date("2026-07-23T13:00:00"); // a Thursday, 1 PM

const makeOrder = ({ shop = "Falcon Veg", at, items }) => ({
  id: `order_${Math.random().toString(36).slice(2, 8)}`,
  shop_name: shop,
  created_at: new Date(at),
  items: items.map((line) => (typeof line === "string" ? { id: line, name: line, quantity: 1 } : line)),
});

const dayAgo = (days) => new Date(NOW.getTime() - days * 86400000);

const CATALOG = [
  { id: "a", name: "Paneer Wrap", price: 60, rating: 4.2, reviewCount: 30, category: "Wrap" },
  { id: "b", name: "Veg Burger", price: 55, rating: 4.8, reviewCount: 90, category: "Burger", isMostSold: true },
  { id: "c", name: "Falafel Plate", price: 90, rating: 4.5, reviewCount: 12, category: "Meal" },
  { id: "d", name: "Cold Coffee", price: 45, rating: 3.1, reviewCount: 5, category: "Beverage" },
];

describe("buildCatalogIndex", () => {
  it("assigns slots starting at 1 and leaves slot 0 for UNK", () => {
    const { indexById, idByIndex, vocabSize } = buildCatalogIndex(CATALOG);
    expect(indexById.get("a")).toBe(1);
    expect(indexById.get("d")).toBe(4);
    expect(idByIndex).toEqual(["a", "b", "c", "d"]);
    expect(vocabSize).toBe(96);
  });

  it("caps the vocabulary at the effective max and flags overflow items", () => {
    const { unknownIds } = buildCatalogIndex(CATALOG, 3);
    expect(unknownIds).toEqual(["c", "d"]);
  });

  it("deduplicates repeated ids and skips id-less items", () => {
    const { indexById, idByIndex } = buildCatalogIndex([{ id: "a" }, { id: "a" }, { name: "no id" }]);
    expect(idByIndex).toEqual(["a"]);
    expect(indexById.size).toBe(1);
  });
});

describe("buildEventSequence", () => {
  it("flattens item lines into a chronological stream", () => {
    const orders = [
      makeOrder({ at: dayAgo(2), items: ["a", { id: "b", quantity: 2 }] }),
      makeOrder({ at: dayAgo(1), items: ["c"] }),
    ];
    const events = buildEventSequence(orders, { now: NOW });
    expect(events).toHaveLength(3);
    expect(events[0].itemId).toBe("a");
    expect(events[1].itemId).toBe("b");
    expect(events[2].itemId).toBe("c");
    expect(events[0].createdAtMs).toBeLessThanOrEqual(events[1].createdAtMs);
    expect(events[2].createdAtMs).toBeGreaterThan(events[0].createdAtMs);
    expect(events[1].quantity).toBe(2);
  });

  it("applies exponential recency decay (recent > old)", () => {
    const orders = [
      makeOrder({ at: dayAgo(14), items: ["a"] }),
      makeOrder({ at: dayAgo(1), items: ["b"] }),
    ];
    const [oldEvent, recentEvent] = buildEventSequence(orders, { now: NOW });
    expect(recentEvent.recency).toBeGreaterThan(oldEvent.recency);
  });

  it("maps Fresh Time to Break Time and ignores future/unparseable timestamps", () => {
    const orders = [
      makeOrder({ shop: "Fresh Time", at: dayAgo(1), items: ["a"] }),
      { id: "future", shop_name: "Mingos", created_at: new Date(NOW.getTime() + 86400000), items: [{ id: "b", quantity: 1 }] },
      { id: "nulldate", shop_name: "Mingos", created_at: null, items: [{ id: "c", quantity: 1 }] },
    ];
    const events = buildEventSequence(orders, { now: NOW });
    expect(events).toHaveLength(1);
    expect(events[0].shop).toBe("Break Time");
  });

  it("caps the stream at maxEvents and keeps the most recent", () => {
    const orders = Array.from({ length: 12 }, (_, i) => makeOrder({ at: dayAgo(i), items: ["a"] }));
    const events = buildEventSequence(orders, { now: NOW, maxEvents: 5 });
    expect(events).toHaveLength(5);
    expect(events[0].daysAgo).toBeGreaterThan(events[4].daysAgo);
  });
});

describe("buildTokens", () => {
  it("produces at most SEQ_LEN tokens with 4-context feature vectors", () => {
    const orders = Array.from({ length: 20 }, (_, i) => makeOrder({ at: dayAgo(i), items: ["a"] }));
    const { indexById } = buildCatalogIndex(CATALOG);
    const tokens = buildTokens(buildEventSequence(orders, { now: NOW }), indexById);
    expect(tokens).toHaveLength(8);
    tokens.forEach((token) => {
      expect(token.context).toHaveLength(4);
      expect(token.context[1]).toBeGreaterThanOrEqual(0);
      expect(token.context[1]).toBeLessThanOrEqual(1);
    });
  });

  it("maps unknown history items to the UNK slot instead of crashing", () => {
    const orders = [makeOrder({ at: dayAgo(1), items: ["ghost-item"] })];
    const { indexById } = buildCatalogIndex(CATALOG);
    const [token] = buildTokens(buildEventSequence(orders, { now: NOW }), indexById);
    expect(token.index).toBe(0);
  });
});

describe("computeRecommendations", () => {
  it("returns an empty result when the catalogue is empty", () => {
    const result = computeRecommendations({ orders: [], catalog: [], activeShop: "Falcon Veg", now: NOW });
    expect(result.recommendations).toEqual([]);
    expect(result.coldStart).toBe(true);
  });

  it("cold-starts on popularity when the user has no history", () => {
    const result = computeRecommendations({ orders: [], catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    expect(result.coldStart).toBe(true);
    expect(result.hasHistory).toBe(false);
    expect(result.recommendations).not.toHaveLength(0);
    expect(result.recommendations[0].itemId).toBe("b"); // highest rating + Most Sold
    result.recommendations.forEach((rec) => {
      expect(rec.reason).toBe("Popular choice at Falcon Veg");
      expect(rec.confidence).toBeGreaterThanOrEqual(55);
      expect(rec.confidence).toBeLessThanOrEqual(95);
    });
  });

  it("only ever recommends items that exist in the active shop catalogue", () => {
    const orders = [
      makeOrder({ shop: "Mingos", at: dayAgo(1), items: ["m"] }),
      makeOrder({ shop: "Bakery", at: dayAgo(2), items: ["x", "y"] }),
    ];
    const result = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    const catalogIds = new Set(CATALOG.map((item) => item.id));
    result.recommendations.forEach((rec) => expect(catalogIds.has(rec.itemId)).toBe(true));
  });

  it("ranks a recently-ordered item above one ordered long ago", () => {
    const orders = [
      makeOrder({ at: dayAgo(30), items: ["a"] }),
      makeOrder({ at: dayAgo(1), items: ["c"] }),
    ];
    const result = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    expect(result.hasHistory).toBe(true);
    const rankOf = (id) => result.recommendations.findIndex((rec) => rec.itemId === id);
    expect(rankOf("c")).toBeGreaterThanOrEqual(0);
    expect(rankOf("c")).toBeLessThan(rankOf("a"));
  });

  it("prefers items the user orders at the same time of day", () => {
    // Same recent history frequency for both — only the hour differs. 'c' was ordered at 1 PM
    // (within the ±2h daypart window of NOW=13:00), 'a' at 8 AM.
    const at13 = new Date("2026-07-23T13:00:00");
    const at8 = new Date("2026-07-23T08:00:00");
    const orders = [
      makeOrder({ at: new Date(at8.getTime() - 5 * 86400000), items: ["a"] }),
      makeOrder({ at: new Date(at13.getTime() - 5 * 86400000), items: ["c"] }),
    ];
    const result = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    const rankOf = (id) => result.recommendations.findIndex((rec) => rec.itemId === id);
    expect(rankOf("c")).toBeLessThan(rankOf("a"));
  });

  it("attaches an interpretable reason and correct order count for a repeat favourite", () => {
    const orders = [
      makeOrder({ at: dayAgo(2), items: ["c"] }),
      makeOrder({ at: dayAgo(1), items: ["c"] }),
    ];
    const result = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    const top = result.recommendations[0];
    expect(top.timesOrdered).toBe(2);
    expect(top.reason).toMatch(/ordered this 2×/);
  });

  it("flags special-of-the-day items regardless of their driver", () => {
    const specialCatalog = CATALOG.map((item) =>
      item.id === "a" ? { ...item, isSpecial: true } : item
    );
    const result = computeRecommendations({ orders: [], catalog: specialCatalog, activeShop: "Falcon Veg", now: NOW });
    const special = result.recommendations.find((rec) => rec.itemId === "a");
    expect(special.reason).toBe("Special of the day");
  });

  it("handles history with no parseable item lines without crashing", () => {
    const orders = [
      { id: "legacy", shop_name: "Falcon Veg", created_at: dayAgo(1), item_name: "Paneer Wrap (x1)" },
    ];
    const result = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    expect(result.hasHistory).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("is deterministic for identical inputs", () => {
    const orders = [makeOrder({ at: dayAgo(1), items: ["a", "b"] })];
    const first = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    const second = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    expect(first).toEqual(second);
  });

  it("respects maxResults", () => {
    const result = computeRecommendations({ orders: [], catalog: CATALOG, activeShop: "Falcon Veg", now: NOW, maxResults: 2 });
    expect(result.recommendations).toHaveLength(2);
  });

  it("exposes a badge and reasonType for every pick", () => {
    const orders = [
      makeOrder({ at: dayAgo(2), items: ["c"] }),
      makeOrder({ at: dayAgo(1), items: ["c"] }),
    ];
    const result = computeRecommendations({ orders, catalog: CATALOG, activeShop: "Falcon Veg", now: NOW });
    const top = result.recommendations[0];
    expect(top.reasonType).toBe("frequent");
    expect(top.badge).toMatchObject({ emoji: "⭐", label: "Frequently Ordered" });
    result.recommendations.forEach((rec) => {
      expect(typeof rec.badge.emoji).toBe("string");
      expect(typeof rec.badge.label).toBe("string");
      expect(typeof rec.reasonType).toBe("string");
    });
  });

  it("surfaces a similar dish when the user's favourite is unavailable at the active stall", () => {
    // User loves Masala Dosa (ordered repeatedly at another stall) but the active stall only
    // carries the dosa family + unrelated items. The similarity signal must lift a sibling dosa
    // above the unrelated catalogue.
    const dosaCatalog = [
      { id: "plain", name: "Plain Dosa", price: 50, rating: 4.0, reviewCount: 40 },
      { id: "rava", name: "Rava Dosa", price: 60, rating: 4.1, reviewCount: 20 },
      { id: "coffee", name: "Coffee", price: 20, rating: 4.9, reviewCount: 200 },
    ];
    const orders = [
      makeOrder({ shop: "Mingos", at: dayAgo(3), items: [{ id: "masala", name: "Masala Dosa", quantity: 1 }] }),
      makeOrder({ shop: "Mingos", at: dayAgo(1), items: [{ id: "masala", name: "Masala Dosa", quantity: 1 }] }),
    ];
    const result = computeRecommendations({ orders, catalog: dosaCatalog, activeShop: "Falcon Veg", now: NOW, maxResults: 3 });
    const dosaPicks = result.recommendations.filter((rec) => rec.reasonType === "similar" && rec.item.name.endsWith("Dosa"));
    expect(dosaPicks.length).toBeGreaterThan(0);
    expect(dosaPicks[0].badge.emoji).toBe("🔥");
  });

  it("boosts an item frequently bought together with the user's usual picks", () => {
    // Coffee is the student's favourite and cookies co-occur with coffee in the cross-user
    // transaction stream. Cookie must be recommended (co-occurrence) over the equally-popular
    // unrelated burger, even though burger has the better rating.
    const catalog = [
      { id: "coffee", name: "Coffee", price: 20, rating: 4.5, reviewCount: 50 },
      { id: "cookie", name: "Cookie", price: 25, rating: 4.5, reviewCount: 50 },
      { id: "burger", name: "Veg Burger", price: 55, rating: 4.9, reviewCount: 100 },
    ];
    const cooccurrenceOrders = [
      { id: "x1", shop_name: "Falcon Veg", created_at: dayAgo(1), item_ids: ["coffee", "cookie"] },
      { id: "x2", shop_name: "Falcon Veg", created_at: dayAgo(2), item_ids: ["coffee", "cookie"] },
      { id: "x3", shop_name: "Falcon Veg", created_at: dayAgo(3), item_ids: ["coffee", "cookie"] },
      { id: "x4", shop_name: "Falcon Veg", created_at: dayAgo(4), item_ids: ["coffee", "cookie"] },
      { id: "x5", shop_name: "Falcon Veg", created_at: dayAgo(5), item_ids: ["coffee"] },
      { id: "x6", shop_name: "Falcon Veg", created_at: dayAgo(6), item_ids: ["coffee"] },
      { id: "x7", shop_name: "Falcon Veg", created_at: dayAgo(1), item_ids: ["burger"] },
      { id: "x8", shop_name: "Falcon Veg", created_at: dayAgo(2), item_ids: ["burger"] },
    ];
    const result = computeRecommendations({
      orders: [makeOrder({ at: dayAgo(1), items: ["coffee"] })],
      cart: [{ id: "coffee", name: "Coffee", quantity: 1 }],
      catalog,
      cooccurrenceOrders,
      activeShop: "Falcon Veg",
      now: NOW,
      maxResults: 3,
    });
    const cookieRec = result.recommendations.find((rec) => rec.itemId === "cookie");
    const burgerRec = result.recommendations.find((rec) => rec.itemId === "burger");
    expect(cookieRec).toBeTruthy();
    expect(burgerRec).toBeTruthy();
    expect(cookieRec.reasonType).toBe("cooccurrence");
    expect(cookieRec.badge.emoji).toBe("🍽");
    expect(cookieRec.confidence).toBeGreaterThan(burgerRec.confidence);
  });

  it("cold-start picks a lunch item for the lunch hour when meal metadata is available", () => {
    // At 1 PM (lunch), a Lunch-tagged item should outrank a Breakfast-tagged item when both have
    // comparable popularity.
    const lunchCatalog = [
      { id: "meal", name: "Veg Meals", price: 80, rating: 4.5, reviewCount: 80 },
      { id: "dosa", name: "Plain Dosa", price: 50, rating: 4.5, reviewCount: 80 },
    ];
    const result = computeRecommendations({ orders: [], catalog: lunchCatalog, activeShop: "Falcon Veg", now: NOW });
    expect(result.recommendations[0].itemId).toBe("meal");
  });
});

describe("computeAddOnSuggestions", () => {
  it("suggests the strongest co-purchased add-on and never repeats a cart item", () => {
    const catalog = [
      { id: "coffee", name: "Coffee", price: 20 },
      { id: "cookie", name: "Cookie", price: 25 },
      { id: "samosa", name: "Samosa", price: 15 },
    ];
    const cooccurrenceOrders = [
      { id: "x1", shop_name: "Falcon Veg", created_at: dayAgo(1), item_ids: ["coffee", "cookie"] },
      { id: "x2", shop_name: "Falcon Veg", created_at: dayAgo(2), item_ids: ["coffee", "cookie"] },
      { id: "x3", shop_name: "Falcon Veg", created_at: dayAgo(3), item_ids: ["coffee", "cookie"] },
      { id: "x4", shop_name: "Falcon Veg", created_at: dayAgo(4), item_ids: ["coffee", "cookie"] },
      { id: "x5", shop_name: "Falcon Veg", created_at: dayAgo(5), item_ids: ["coffee"] },
      { id: "x6", shop_name: "Falcon Veg", created_at: dayAgo(6), item_ids: ["coffee"] },
    ];
    const addOns = computeAddOnSuggestions({
      cart: [{ id: "coffee", name: "Coffee", quantity: 1 }],
      catalog,
      cooccurrenceOrders,
      activeShop: "Falcon Veg",
      now: NOW,
    });
    expect(addOns).toHaveLength(1);
    expect(addOns[0].itemId).toBe("cookie");
    expect(addOns[0].reason).toMatch(/Frequently ordered together with Coffee/);
    expect(addOns[0].badge.emoji).toBe("🍽");
  });

  it("falls back to the user's history seeds when the cart is empty", () => {
    const catalog = [
      { id: "coffee", name: "Coffee", price: 20 },
      { id: "cookie", name: "Cookie", price: 25 },
    ];
    const orders = [
      makeOrder({ at: dayAgo(1), items: ["coffee"] }),
      makeOrder({ at: dayAgo(2), items: ["coffee"] }),
    ];
    const cooccurrenceOrders = [
      { id: "x1", shop_name: "Falcon Veg", created_at: dayAgo(1), item_ids: ["coffee", "cookie"] },
      { id: "x2", shop_name: "Falcon Veg", created_at: dayAgo(2), item_ids: ["coffee", "cookie"] },
      { id: "x3", shop_name: "Falcon Veg", created_at: dayAgo(3), item_ids: ["coffee"] },
      { id: "x4", shop_name: "Falcon Veg", created_at: dayAgo(4), item_ids: ["coffee"] },
    ];
    const addOns = computeAddOnSuggestions({ cart: [], catalog, orders, cooccurrenceOrders, activeShop: "Falcon Veg", now: NOW });
    expect(addOns[0].itemId).toBe("cookie");
  });

  it("returns an empty list for an empty catalogue", () => {
    expect(computeAddOnSuggestions({ catalog: [], cart: [{ id: "x" }], activeShop: "Falcon Veg", now: NOW })).toEqual([]);
  });
});

describe("computePopularPairs", () => {
  it("returns the genuine co-purchased pairing with both catalogue items and a total", () => {
    const catalog = [
      { id: "coffee", name: "Coffee", price: 20 },
      { id: "cookie", name: "Cookie", price: 25 },
      { id: "wrap", name: "Paneer Wrap", price: 60 },
    ];
    const cooccurrenceOrders = [
      { id: "x1", shop_name: "Falcon Veg", created_at: dayAgo(1), item_ids: ["coffee", "cookie"] },
      { id: "x2", shop_name: "Falcon Veg", created_at: dayAgo(2), item_ids: ["coffee", "cookie"] },
      { id: "x3", shop_name: "Falcon Veg", created_at: dayAgo(3), item_ids: ["coffee", "cookie"] },
      { id: "x4", shop_name: "Falcon Veg", created_at: dayAgo(4), item_ids: ["wrap"] },
    ];
    const pairs = computePopularPairs({ catalog, cooccurrenceOrders, activeShop: "Falcon Veg" });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).toBe("coffee");
    expect(pairs[0].b.id).toBe("cookie");
    expect(pairs[0].count).toBe(3);
    expect(pairs[0].lift).toBeGreaterThan(1);
    expect(pairs[0].total).toBe(45);
    expect(pairs[0].reason).toMatch(/Popular pairing at Falcon Veg/);
  });

  it("respects the support floor and lift cutoff — no chance pairings", () => {
    const catalog = [
      { id: "a", name: "A", price: 10 },
      { id: "b", name: "B", price: 10 },
    ];
    const cooccurrenceOrders = [
      { id: "x1", shop_name: "Falcon Veg", created_at: dayAgo(1), item_ids: ["a"] },
      { id: "x2", shop_name: "Falcon Veg", created_at: dayAgo(2), item_ids: ["b"] },
    ];
    expect(computePopularPairs({ catalog, cooccurrenceOrders, activeShop: "Falcon Veg" })).toEqual([]);
  });

  it("returns an empty list when the catalogue is empty or the data stream is empty", () => {
    expect(computePopularPairs({ catalog: [], cooccurrenceOrders: [{ item_ids: ["a"] }], activeShop: "Falcon Veg" })).toEqual([]);
    expect(computePopularPairs({ catalog: [{ id: "a", name: "A", price: 1 }], cooccurrenceOrders: [], activeShop: "Falcon Veg" })).toEqual([]);
  });
});
