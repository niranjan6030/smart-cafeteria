import { describe, it, expect } from "vitest";
import {
  buildCooccurrence,
  cooccurrenceScore,
  extractItemIds,
  pairKey,
  pairLift,
  recommendCooccurrence,
} from "./cooccurrence";

const orders = [
  // Coffee goes with cookies almost every time; samosa appears with tea.
  { id: "o1", item_ids: ["coffee", "cookie"] },
  { id: "o2", item_ids: ["coffee", "cookie"] },
  { id: "o3", item_ids: ["coffee", "cookie"] },
  { id: "o4", item_ids: ["coffee", "sandwich"] },
  { id: "o5", item_ids: ["tea", "samosa"] },
  { id: "o6", item_ids: ["tea", "samosa"] },
  { id: "o7", item_ids: ["tea", "cookie"] },
  { id: "o8", item_ids: ["water"] },
];

describe("extractItemIds", () => {
  it("handles the order_signals item_ids shape and the full items shape", () => {
    expect(extractItemIds({ item_ids: ["a", "b"] })).toEqual(["a", "b"]);
    expect(extractItemIds({ items: [{ id: "a", name: "A" }, { id: "b", name: "B" }, "c"] })).toEqual(["a", "b", "c"]);
    expect(extractItemIds({})).toEqual([]);
  });
});

describe("buildCooccurrence", () => {
  it("counts item frequency and pairwise co-occurrence", () => {
    const stats = buildCooccurrence(orders);
    expect(stats.orderCount).toBe(8);
    expect(stats.itemCounts.get("coffee")).toBe(4);
    expect(stats.pairCounts.get(pairKey("coffee", "cookie"))).toBe(3);
    expect(stats.pairCounts.get(pairKey("tea", "samosa"))).toBe(2);
  });

  it("dedupes repeated lines inside a single order", () => {
    const stats = buildCooccurrence([{ id: "x", item_ids: ["a", "a", "b"] }]);
    expect(stats.itemCounts.get("a")).toBe(1);
  });
});

describe("pairLift", () => {
  it("gives a lift above 1 to items bought together more than chance", () => {
    const stats = buildCooccurrence(orders);
    // P(cookie|coffee) = 3/4 vs P(cookie) = 4/8 = 0.5 -> lift ~1.5
    expect(pairLift("coffee", "cookie", stats)).toBeGreaterThan(1);
    // coffee & water never co-occur -> below minSupport -> 0
    expect(pairLift("coffee", "water", stats)).toBe(0);
  });

  it("returns 0 on empty statistics", () => {
    expect(pairLift("a", "b", buildCooccurrence([]))).toBe(0);
  });
});

describe("cooccurrenceScore / recommendCooccurrence", () => {
  it("recommends the strongest co-purchased item for a seed", () => {
    const stats = buildCooccurrence(orders);
    const { score, pairedWith } = cooccurrenceScore("cookie", ["coffee"], stats);
    expect(score).toBeGreaterThan(1);
    expect(pairedWith).toBe("coffee");
  });

  it("returns zero when there are no seeds or no statistics", () => {
    expect(cooccurrenceScore("cookie", [], buildCooccurrence(orders)).score).toBe(0);
    expect(cooccurrenceScore("cookie", ["coffee"], buildCooccurrence([])).score).toBe(0);
  });

  it("ranks co-purchased add-ons and excludes cart contents", () => {
    const catalog = [
      { id: "coffee" }, { id: "cookie" }, { id: "sandwich" }, { id: "water" }, { id: "samosa" },
    ];
    const stats = buildCooccurrence(orders);
    const picks = recommendCooccurrence(["coffee"], catalog, stats, { maxResults: 2 });
    expect(picks[0].item.id).toBe("cookie");
    expect(picks[0].score).toBeGreaterThan(1);
    expect(picks.every((pick) => pick.item.id !== "coffee")).toBe(true);
  });
});
