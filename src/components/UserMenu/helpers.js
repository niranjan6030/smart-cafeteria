export const INR = "₹";

export const SHOPS = ["Falcon Veg", "Fresheteria", "Mingos", "Break Time", "Surf & Turf", "Bakery"];

// ─── Stall display-name mapping ────────────────────────────────────────────────
// The canonical stall name in Firestore stays "Bakery" (products.shop, shop_status doc id,
// users.assignedStall, order signals) — those values are load-bearing for queries and rules.
// This maps only what the UI DISPLAYS, so renaming never breaks data lookups. Always use
// stallDisplayName() at render sites and keep the canonical value for data operations.
export const SHOP_DISPLAY = { Bakery: "Cake Boutique" };
export const stallDisplayName = (shop) => SHOP_DISPLAY[shop] || shop;

// Tier colors form a cohesive warm food-family (terracotta/caramel/clay/bronze) instead of an
// arbitrary spread — distinct enough to tell the 4 plan cards apart at a glance while still
// reading as "one café brand," not four unrelated colors.
export const MEAL_PASS_PLANS = [
  { id: "pass_2day", label: "2-Day Pass", days: 2, meals: 2, priceMultiplier: 1, badge: "Try It", color: "#E06A3B" },
  { id: "pass_3day", label: "3-Day Pass", days: 3, meals: 3, priceMultiplier: 0.97, badge: "3% Off", color: "#B0784A" },
  { id: "pass_weekly", label: "Weekly Pass", days: 7, meals: 7, priceMultiplier: 0.92, badge: "8% Off", color: "#A34A3A" },
  { id: "pass_monthly", label: "Monthly Pass", days: 30, meals: 30, priceMultiplier: 0.85, badge: "15% Off", color: "#8A5A2F" },
];

// ─── Feature 1: Event types for bulk orders ────────────────────────────────────
export const BULK_EVENT_TYPES = ["Seminar", "Department Meeting", "Cultural Festival", "Workshop", "Orientation", "Board Meeting", "Other"];

// Razorpay publishable key id. Public by design (it cannot move money on its own), but it is
// read from the environment rather than hardcoded so a clone of this repo never opens a checkout
// against someone else's merchant account. Empty means payments are switched off, and the UI says so.
export const RAZORPAY_KEY_ID = import.meta.env?.VITE_RAZORPAY_KEY_ID || "";
export const PAYMENT_API_BASE_URL = (import.meta.env?.VITE_PAYMENT_API_BASE_URL || "").replace(/\/$/, "");
export const ORDER_API_URL = paymentEndpoint(import.meta.env?.VITE_RAZORPAY_ORDER_API_URL, "create-order");
export const VERIFY_API_URL = paymentEndpoint(import.meta.env?.VITE_RAZORPAY_VERIFY_API_URL, "verify-payment");

export const createdAtMillis = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;
export const sortByNewest = (items) => [...items].sort((a, b) => createdAtMillis(b.created_at) - createdAtMillis(a.created_at));
export const money = (amount) => `${INR}${Number(amount || 0).toLocaleString("en-IN")}`;
export const itemImage = (item) => item?.image || item?.imageUrl || item?.photoUrl || "";
// "Special of the Day" pricing set by staff in the Stall Menu Manager (KitchenLiveBoard.jsx) —
// bakes the discount into `price` here so cart/checkout/Razorpay all use the discounted amount
// without needing to touch every downstream calculation site.
export const applySpecialPricing = (item) => {
  const originalPrice = Number(item.price || 0);
  const discountPercent = item.isSpecial ? Number(item.specialDiscountPercent || 0) : 0;
  const effectivePrice = discountPercent > 0 ? Math.round(originalPrice * (1 - discountPercent / 100)) : originalPrice;
  return { ...item, price: effectivePrice, originalPrice };
};
export const itemEmoji = (item) => item?.emoji || "Food";

// ─── Display polish helpers ───────────────────────────────────────────────────
// toTitleCase standardizes item/category labels for display only ("TEa" → "Tea",
// "Hyderabadi chicken Biriyani" → "Hyderabadi Chicken Biriyani"). Small words stay
// lowercase except at the start/end; words with no letters (sizes like "500ml",
// symbols) pass through untouched.
export const toTitleCase = (value = "") => {
  const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "off", "on", "or", "the", "to", "with"]);
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word, index, words) => {
      const lower = word.toLowerCase();
      if (SMALL_WORDS.has(lower) && index !== 0 && index !== words.length - 1) return lower;
      if (!/[a-z]/i.test(word)) return lower;
      // Units/sizes like "500ml", "400g" stay lowercase; only capitalize word-initial letters.
      if (/^\d+[a-z]+$/.test(lower)) return lower;
      const firstLetterIndex = word.search(/[a-z]/i);
      return word.slice(0, firstLetterIndex) + word[firstLetterIndex].toUpperCase() + word.slice(firstLetterIndex + 1).toLowerCase();
    })
    .join(" ");
};

// Veg/Non-Veg heuristic for quick filters — protein keywords in the item name or
// category (egg counts as non-veg per Indian canteen convention). Explicit doc
// flags (isVeg/isNonVeg) win when present.
const NON_VEG_PATTERN = /\b(chicken|mutton|lamb|beef|pork|fish|prawn|shrimp|crab|keema|ham|turkey|sausage|bacon|salmon|tuna|kebab|shawarma|egg)\b/i;
export const isNonVeg = (item) => {
  if (item?.isVeg === true) return false;
  if (item?.isNonVeg === true || item?.nonVeg === true) return true;
  return NON_VEG_PATTERN.test(`${item?.name || ""} ${item?.category || ""}`);
};

const DRINKS_PATTERN = /drink|juice|shake|smoothie|cold\s?coffee|coffee|tea|milk|lassi|soda|mocktail|slush|cola|fizz|\bwater\b|beverage/i;
const SNACKS_PATTERN = /snack|fries|french\s?fries|\broll\b|puff|samosa|patty|wrap|sandwich|momo|nuggets|toast|pakora|vada|cutlet|chaat|pizza|burger|spring\s?roll/i;
const BIRYANI_PATTERN = /biryani|biriyani/i;

// Curated "craving" quick filters shown under the search bar and in Browse-by-
// craving. Each maps to real item attributes via keyword matching (categories in
// the live data can be coarse — e.g. everything tagged "Food"). Only chips that
// actually match at least one live product are surfaced by the caller.
export const CRAVING_FILTERS = [
  { id: "__veg", label: "Veg", match: (item) => !isNonVeg(item) },
  { id: "__nonveg", label: "Non-Veg", match: (item) => isNonVeg(item) },
  { id: "__biryani", label: "Biryani", match: (item) => BIRYANI_PATTERN.test(`${item?.name || ""} ${item?.category || ""}`) },
  { id: "__drinks", label: "Drinks", match: (item) => DRINKS_PATTERN.test(`${item?.name || ""} ${item?.category || ""}`) },
  { id: "__snacks", label: "Snacks", match: (item) => SNACKS_PATTERN.test(`${item?.name || ""} ${item?.category || ""}`) },
];

// The live backend (canteen-backend/index.js, hand-copied into the Vercel project named
// "index-js" — see canteen-backend/README.md) is a plain Express app with routes mounted at
// their bare names (e.g. POST /create-order), not under an /api/ prefix — confirmed by curling
// the deployment directly: /api/create-order 404s while /create-order hits real logic. A
// previous version of this helper assumed Vercel's zero-config /api/*.js convention applied here
// and added a /api/ prefix, which is what was actually causing verify-payment (and everything
// else routed through this helper) to 404 in production.
export function paymentEndpoint(configuredUrl, route) {
  if (configuredUrl && /^https?:\/\//i.test(configuredUrl)) return configuredUrl;
  const cleanRoute = (configuredUrl || route).replace(/^\/?(api\/)?/, "");
  return `${PAYMENT_API_BASE_URL}/${cleanRoute}`;
}

export async function postJson(url, payload, idToken) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Payment endpoints now require a signed-in caller; the server verifies this token
        // rather than trusting any body field.
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Payment server is unreachable. Check the Vercel API deployment and environment variables.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    // paymentEndpoint() always returns a full https:// URL, so a leading-"/api/" check here never
    // matched anything — this now checks the actual route names it can produce.
    if (response.status === 404 && /\/(create-order|verify-payment)$/.test(url)) {
      throw new Error("Payment API route was not found on the Vercel backend.");
    }
    throw new Error(data.error || data.message || `Payment server returned ${response.status}`);
  }
  return data;
}

export function ensureRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

export function safeDate(value, fallback = "Soon") {
  const date = value?.toDate?.();
  if (!date) return fallback;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function playNotificationTone() {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);
    oscillator.onended = () => context.close();
  } catch (error) {
    console.log("Notification sound blocked:", error);
  }
}
