import { describe, expect, it } from "vitest";
import { resolveMenuEntity, resolveStallName } from "./entityResolver.js";

const catalog = [
  { id: "1", name: "Masala Dosa", category: "South Indian", shop: "Falcon Veg", price: 60 },
  { id: "2", name: "Paper Masala Dosa", category: "South Indian", shop: "Falcon Veg", price: 75 },
  { id: "3", name: "Filter Coffee", category: "Beverages", shop: "Falcon Veg", price: 25 },
];

describe("resolveMenuEntity", () => {
  it("exact match", () => {
    const { match, confidence } = resolveMenuEntity("masala dosa", catalog, { activeShop: "Falcon Veg" });
    expect(match?.name).toBe("Masala Dosa");
    expect(confidence).toBeGreaterThan(0.9);
  });

  it("fuzzy match tolerates minor typos", () => {
    const { match } = resolveMenuEntity("masala dose", catalog, { activeShop: "Falcon Veg" });
    expect(match?.name).toBe("Masala Dosa");
  });

  it("returns candidates when ambiguous", () => {
    const { match, candidates } = resolveMenuEntity("dosa", catalog, { activeShop: "Falcon Veg" });
    expect(match).toBeNull();
    expect(candidates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("resolveStallName", () => {
  const stalls = ["Falcon Veg", "Mingos", "Break Time"];

  it("resolves partial stall name", () => {
    expect(resolveStallName("falcon", stalls)).toBe("Falcon Veg");
  });

  it("resolves mingos", () => {
    expect(resolveStallName("mingos", stalls)).toBe("Mingos");
  });
});
