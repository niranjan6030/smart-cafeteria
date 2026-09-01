// Frequently-bought-together engine (Recommendation Priority 3).
//
// Learns pairwise purchase relationships from historical *transactions* (orders). Two dishes are
// "associated" when they co-occur in the same order more often than chance would predict — scored
// with lift (how much more likely item B is bought when A is already in the cart). The input is
// the non-PII `order_signals` mirror (each order carrying only `item_ids`, no prices/names/owner),
// so cross-user purchase patterns are learnable in-browser without leaking anyone's personal data.
//
// Pure functions, dependency-free, deterministic — unit-testable exactly like the rest of the
// recommender stack.

/**
 * Counts per-item frequency and pairwise co-occurrence across transactions.
 * @param {Array<{ items?: Array<{ id?: string } | string>, item_ids?: string[] }>} orders
 * @param {{ maxOrders?: number, minSupport?: number }} [options]
 * @returns {{ itemCounts: Map<string, number>, pairCounts: Map<string, number>, orderCount: number }}
 */
export function buildCooccurrence(orders = [], { maxOrders = 500 } = {}) {
  const itemCounts = new Map();
  const pairCounts = new Map();
  let orderCount = 0;

  orders.slice(-maxOrders).forEach((order) => {
    const ids = extractItemIds(order);
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;
    orderCount += 1;
    unique.forEach((id) => itemCounts.set(id, (itemCounts.get(id) || 0) + 1));
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const key = pairKey(unique[i], unique[j]);
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  });

  return { itemCounts, pairCounts, orderCount };
}

/**
 * Extracts the deduplicated item ids an order carries, tolerating both the `items` shape used by
 * the full orders collection and the lightweight `item_ids` shape used by the order_signals
 * mirror.
 * @param {object} order
 * @returns {string[]}
 */
export function extractItemIds(order) {
  if (Array.isArray(order?.item_ids)) return order.item_ids.filter(Boolean);
  if (Array.isArray(order?.items)) {
    return order.items
      .map((line) => (typeof line === "string" ? line : line?.id))
      .filter(Boolean);
  }
  return [];
}

export function pairKey(a, b) {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

/**
 * Lift of item `b` given `a` in the cart: P(b|a) / P(b) = (pair·N) / (countA·countB). Values > 1
 * mean "more likely together than alone"; < 1 means they actively avoid each other. The
 * `minSupport` cutoff already guards against sparse-noise pairings, so lift is left un-smoothed
 * (any pseudo-count would distort the ratio for very common items).
 * @param {string} a
 * @param {string} b
 * @param {ReturnType<typeof buildCooccurrence>} stats
 * @param {{ minSupport?: number }} [options]
 * @returns {number}
 */
export function pairLift(a, b, stats, { minSupport = 2 } = {}) {
  if (!stats || stats.orderCount === 0) return 0;
  const pair = stats.pairCounts.get(pairKey(a, b)) || 0;
  if (pair < minSupport) return 0;

  const countA = stats.itemCounts.get(a) || 0;
  const countB = stats.itemCounts.get(b) || 0;
  if (countA <= 0 || countB <= 0) return 0;

  return (pair * stats.orderCount) / (countA * countB);
}

/**
 * Co-occurrence score of a candidate item against a set of seed items (e.g. cart contents):
 * the strongest lift pairing with any seed, scaled by how often the pair occurs (support) so a
 * rare-but-extreme lift doesn't outrank an everyday pairing.
 * @param {string} candidateId
 * @param {string[]} seedIds
 * @param {ReturnType<typeof buildCooccurrence>} stats
 * @param {{ minSupport?: number }} [options]
 * @returns {{ score: number, pairedWith: string | null, count: number }}
 */
export function cooccurrenceScore(candidateId, seedIds, stats, { minSupport = 2 } = {}) {
  if (!seedIds.length || !stats || stats.orderCount === 0) {
    return { score: 0, pairedWith: null, count: 0 };
  }
  let best = { score: 0, pairedWith: null, count: 0 };
  seedIds.forEach((seed) => {
    if (!seed || seed === candidateId) return;
    const key = pairKey(candidateId, seed);
    const count = stats.pairCounts.get(key) || 0;
    if (count < minSupport) return;
    const lift = pairLift(candidateId, seed, stats, { minSupport });
    if (lift > best.score) best = { score: lift, pairedWith: seed, count };
  });
  return best;
}

/**
 * Ranks the catalogue's add-on candidates for a set of seeds (cart items / a just-ordered dish).
 * @param {string[]} seedIds
 * @param {Array<{ id: string }>} candidates
 * @param {ReturnType<typeof buildCooccurrence>} stats
 * @param {{ maxResults?: number, minSupport?: number }} [options]
 * @returns {Array<{ item: object, score: number, pairedWith: string | null, count: number }>}
 */
export function recommendCooccurrence(seedIds, candidates = [], stats, { maxResults = 4, minSupport = 2 } = {}) {
  if (!seedIds.length) return [];
  const seedSet = new Set(seedIds);
  return candidates
    .filter((item) => item?.id && !seedSet.has(item.id))
    .map((item) => ({ item, ...cooccurrenceScore(item.id, seedIds, stats, { minSupport }) }))
    .filter((entry) => entry.score > 1)
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, maxResults);
}
