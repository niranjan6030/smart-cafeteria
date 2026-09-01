import { describe, it, expect } from "vitest";
import {
  dishFamilyOf,
  findSimilarItems,
  inferFoodProfile,
  isLikelyNonVeg,
  mealSessionFor,
  mealTypeMatch,
  profileSimilarity,
  similarityBetween,
} from "./foodMetadata";

describe("dishFamilyOf", () => {
  it("resolves canonical stems for the spec's examples", () => {
    expect(dishFamilyOf("Masala Dosa")).toBe("dosa");
    expect(dishFamilyOf("Plain Dosa")).toBe("dosa");
    expect(dishFamilyOf("Veg Burger")).toBe("burger");
    expect(dishFamilyOf("Chicken Biryani")).toBe("biryani");
    expect(dishFamilyOf("Filter Coffee")).toBe("coffee");
    expect(dishFamilyOf("Idli")).toBe("idli");
  });

  it("returns null for unrecognised names", () => {
    expect(dishFamilyOf("XYZ Whimsy Plate")).toBeNull();
  });
});

describe("inferFoodProfile", () => {
  it("derives cuisine/meal-type/veg from a dosa name", () => {
    const profile = inferFoodProfile({ id: "1", name: "Masala Dosa", category: "South Indian" });
    expect(profile.stem).toBe("dosa");
    expect(profile.cuisine).toBe("South Indian");
    expect(profile.mealType).toBe("Breakfast");
    expect(profile.vegetarian).toBe(true);
  });

  it("flags non-vegetarian items and honours explicit metadata", () => {
    expect(isLikelyNonVeg("Chicken Biryani")).toBe(true);
    expect(isLikelyNonVeg("Masala Dosa")).toBe(false);
    const profile = inferFoodProfile({ name: "Chicken Fried Rice" });
    expect(profile.vegetarian).toBe(false);
    expect(inferFoodProfile({ name: "Falafel Plate", vegetarian: true }).vegetarian).toBe(true);
  });
});

describe("profileSimilarity", () => {
  it("scores the dosa family as highly similar", () => {
    const masala = inferFoodProfile({ name: "Masala Dosa" });
    const plain = inferFoodProfile({ name: "Plain Dosa" });
    const rava = inferFoodProfile({ name: "Rava Dosa" });
    expect(profileSimilarity(masala, plain)).toBeGreaterThan(0.7);
    expect(profileSimilarity(masala, rava)).toBeGreaterThan(0.7);
  });

  it("scores burgers as more similar to burgers than to coffee", () => {
    const burger = inferFoodProfile({ name: "Veg Burger", category: "Burger" });
    const cheese = inferFoodProfile({ name: "Cheese Burger", category: "Burger" });
    const coffee = inferFoodProfile({ name: "Coffee" });
    expect(similarityBetween({ name: "Veg Burger", category: "Burger" }, { name: "Cheese Burger", category: "Burger" }))
      .toBeGreaterThan(similarityBetween({ name: "Veg Burger", category: "Burger" }, { name: "Coffee" }));
    expect(profileSimilarity(burger, coffee)).toBeLessThan(0.5);
  });

  it("penalises veg/non-veg cross-recommendations", () => {
    const veg = inferFoodProfile({ name: "Veg Biryani" });
    const chicken = inferFoodProfile({ name: "Chicken Biryani" });
    const paneer = inferFoodProfile({ name: "Paneer Biryani" });
    // Chicken (non-veg) vs veg biryani absorbs the -0.35 dietary penalty, so the same-family
    // pair with the matching dietary profile scores clearly higher.
    expect(profileSimilarity(veg, chicken)).toBeLessThan(profileSimilarity(veg, paneer));
    expect(profileSimilarity(veg, chicken)).toBeLessThan(0.7);
  });
});

describe("findSimilarItems", () => {
  it("returns the substitution family for a dosa favourite", () => {
    const catalog = [
      { id: "d1", name: "Masala Dosa" },
      { id: "d2", name: "Plain Dosa" },
      { id: "d3", name: "Rava Dosa" },
      { id: "d4", name: "Set Dosa" },
      { id: "d5", name: "Onion Dosa" },
      { id: "c1", name: "Coffee" },
      { id: "b1", name: "Veg Burger" },
    ];
    const similar = findSimilarItems("d1", catalog, { topN: 4 });
    expect(similar).toHaveLength(4);
    similar.forEach(({ item }) => {
      expect(item.name).toMatch(/Dosa/);
    });
    expect(similar[0].score).toBeGreaterThan(0.5);
  });

  it("skips the target itself and unknown-id items", () => {
    const similar = findSimilarItems("x", [{ id: "x", name: "Plain Dosa" }, { name: "no id" }]);
    expect(similar).toEqual([]);
  });
});

describe("mealSessionFor / mealTypeMatch", () => {
  it("maps hours to breakfast/lunch/snacks/dinner", () => {
    expect(mealSessionFor(8)).toBe("Breakfast");
    expect(mealSessionFor(13)).toBe("Lunch");
    expect(mealSessionFor(17)).toBe("Snacks");
    expect(mealSessionFor(20)).toBe("Dinner");
  });

  it("gives a 1.0 match for the right session and stays neutral on unknown dishes", () => {
    const dosa = inferFoodProfile({ name: "Masala Dosa" });
    expect(mealTypeMatch(dosa, "Breakfast")).toBe(1);
    expect(mealTypeMatch(dosa, "Dinner")).toBe(0.15);
    expect(mealTypeMatch(inferFoodProfile({ name: "Uncharted Plate" }), "Lunch")).toBe(0.5);
  });
});
