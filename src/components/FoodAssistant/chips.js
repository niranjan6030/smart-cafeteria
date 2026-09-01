/** Home-state quick actions for the Food Assistant (spec §15). */
export function getInitialChips(signedIn, cartLength) {
  const chips = [
    { label: "High protein", hint: "Show me high-protein options" },
    { label: "Under ₹100", hint: "Show me something under ₹100" },
    { label: "Low calorie", hint: "Show me low-calorie options" },
    { label: "Vegetarian", hint: "Show me vegetarian options" },
    { label: "Popular today", hint: "What's popular today?" },
    { label: "What's available?", hint: "What's available right now?" },
  ];
  if (signedIn) chips.push({ label: "My usuals", hint: "What do I usually order?" });
  if (cartLength > 0) chips.push({ label: "My cart", hint: "What's in my cart?" });
  return chips;
}
