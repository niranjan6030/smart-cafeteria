/**
 * Fuzzy menu item resolution for voice (and future search). Matches utterance fragments
 * against the live product catalog scoped to a stall when possible.
 */

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** @param {string} a @param {string} b */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Score how well `needle` matches a product name (0–1, higher is better).
 * @param {string} needle
 * @param {{ name?: string; category?: string }} product
 */
function scoreProduct(needle, product) {
  const name = normalize(product.name);
  const category = normalize(product.category);
  if (!name) return 0;

  if (name === needle) return 1;
  if (name.includes(needle) || needle.includes(name)) return 0.92;
  if (category && (category.includes(needle) || needle.includes(category))) return 0.75;

  const dist = levenshtein(needle, name);
  const maxLen = Math.max(needle.length, name.length, 1);
  const similarity = 1 - dist / maxLen;
  if (similarity >= 0.55) return similarity * 0.85;

  // Token overlap — "masala dosa" vs "paper masala dosa"
  const needleTokens = needle.split(" ").filter(Boolean);
  const nameTokens = name.split(" ").filter(Boolean);
  if (needleTokens.length > 0) {
    const overlap = needleTokens.filter((t) => nameTokens.some((nt) => nt.includes(t) || t.includes(nt))).length;
    const tokenScore = overlap / needleTokens.length;
    if (tokenScore >= 0.5) return 0.5 + tokenScore * 0.35;
  }

  return 0;
}

/**
 * @param {string} phrase — raw food name from NLU
 * @param {Array<{ id: string; name?: string; category?: string; shop?: string }>} catalog
 * @param {{ activeShop?: string; minScore?: number; maxResults?: number }} [options]
 * @returns {{ match: object | null; candidates: Array<{ product: object; score: number }>; confidence: number }}
 */
export function resolveMenuEntity(phrase, catalog, options = {}) {
  const { activeShop = null, minScore = 0.45, maxResults = 5 } = options;
  const needle = normalize(phrase);
  if (!needle || !catalog?.length) {
    return { match: null, candidates: [], confidence: 0 };
  }

  const scoped =
    activeShop != null
      ? catalog.filter((item) => {
          const shop = item.shop === "Fresh Time" ? "Break Time" : item.shop;
          const target = activeShop === "Fresh Time" ? "Break Time" : activeShop;
          return shop === target;
        })
      : catalog;

  const pool = scoped.length > 0 ? scoped : catalog;

  const ranked = pool
    .map((product) => ({ product, score: scoreProduct(needle, product) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (ranked.length === 0) {
    return { match: null, candidates: [], confidence: 0 };
  }

  const top = ranked[0];
  const runnerUp = ranked[1];
  const scoreGap = runnerUp ? top.score - runnerUp.score : 1;
  const ambiguous = runnerUp && scoreGap < 0.08 && top.score < 0.99;

  return {
    match: ambiguous ? null : top.product,
    candidates: ranked,
    confidence: top.score,
  };
}

/**
 * Resolve stall name from speech (e.g. "falcon veg", "mingo's").
 * @param {string} phrase
 * @param {string[]} stallNames
 */
export function resolveStallName(phrase, stallNames) {
  const needle = normalize(phrase).replace(/s$/i, "");
  if (!needle) return null;

  let best = null;
  let bestScore = 0;
  for (const stall of stallNames) {
    const normalized = normalize(stall);
    let score = 0;
    if (normalized === needle) score = 1;
    else if (normalized.includes(needle) || needle.includes(normalized.replace(/\s/g, ""))) score = 0.9;
    else {
      const dist = levenshtein(needle, normalized.replace(/\s/g, ""));
      score = 1 - dist / Math.max(needle.length, normalized.length, 1);
    }
    if (score > bestScore) {
      bestScore = score;
      best = stall;
    }
  }
  return bestScore >= 0.55 ? best : null;
}
