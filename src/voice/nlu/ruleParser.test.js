import { describe, expect, it } from "vitest";
import { parseVoiceIntent } from "./ruleParser.js";

describe("parseVoiceIntent", () => {
  it("parses add with quantity", () => {
    expect(parseVoiceIntent("Add two masala dosas")).toEqual({
      intent: "ADD_ITEM",
      quantity: 2,
      itemPhrase: "masala dosas",
    });
  });

  it("supports natural add phrasing", () => {
    expect(parseVoiceIntent("I'd like a burger")).toEqual({ intent: "ADD_ITEM", quantity: 1, itemPhrase: "burger" });
    expect(parseVoiceIntent("Give me two burgers")).toEqual({ intent: "ADD_ITEM", quantity: 2, itemPhrase: "burgers" });
    expect(parseVoiceIntent("Can I have one coffee?")).toEqual({ intent: "ADD_ITEM", quantity: 1, itemPhrase: "coffee" });
    expect(parseVoiceIntent("I want three pizzas")).toEqual({ intent: "ADD_ITEM", quantity: 3, itemPhrase: "pizzas" });
    expect(parseVoiceIntent("Get me two samosas please")).toEqual({ intent: "ADD_ITEM", quantity: 2, itemPhrase: "samosas" });
  });

  it("parses remove with natural phrasing", () => {
    expect(parseVoiceIntent("Remove one coffee")).toEqual({ intent: "REMOVE_ITEM", quantity: 1, itemPhrase: "coffee" });
    expect(parseVoiceIntent("Delete biryani")).toEqual({ intent: "REMOVE_ITEM", quantity: 1, itemPhrase: "biryani" });
    expect(parseVoiceIntent("Get rid of the pasta")).toEqual({ intent: "REMOVE_ITEM", quantity: 1, itemPhrase: "the pasta" });
  });

  it("parses increase/decrease", () => {
    expect(parseVoiceIntent("Increase pizza quantity")).toEqual({ intent: "INCREASE_ITEM", quantity: 1, itemPhrase: "pizza quantity" });
    expect(parseVoiceIntent("Add more dosa")).toEqual({ intent: "INCREASE_ITEM", quantity: 1, itemPhrase: "dosa" });
    expect(parseVoiceIntent("Decrease dosa quantity")).toEqual({ intent: "DECREASE_ITEM", quantity: 1, itemPhrase: "dosa quantity" });
  });

  it("parses open category without colliding with stall switching", () => {
    expect(parseVoiceIntent("Open desserts")).toEqual({ intent: "SHOW_CATEGORY", category: "desserts" });
    expect(parseVoiceIntent("Browse beverages")).toEqual({ intent: "SHOW_CATEGORY", category: "beverages" });
    expect(parseVoiceIntent("Go to Mingos")).toEqual({ intent: "SELECT_STALL", stallPhrase: "mingos" });
  });

  it("parses checkout", () => {
    expect(parseVoiceIntent("Checkout")).toEqual({ intent: "CHECKOUT" });
  });

  it("parses search", () => {
    expect(parseVoiceIntent("Search for desserts")).toEqual({
      intent: "SEARCH",
      query: "desserts",
    });
  });

  it("parses vegetarian filter", () => {
    expect(parseVoiceIntent("Show vegetarian food")).toEqual({ intent: "SHOW_VEGETARIAN" });
  });

  it("parses stall switch", () => {
    expect(parseVoiceIntent("Switch to Falcon Veg")).toEqual({
      intent: "SELECT_STALL",
      stallPhrase: "falcon veg",
    });
  });

  it("parses undo", () => {
    expect(parseVoiceIntent("Cancel my last item")).toEqual({ intent: "UNDO_LAST" });
  });

  it("parses help", () => {
    expect(parseVoiceIntent("What can I say")).toEqual({ intent: "HELP" });
    expect(parseVoiceIntent("help")).toEqual({ intent: "HELP" });
    expect(parseVoiceIntent("How do I order")).toEqual({ intent: "HELP" });
  });
});
