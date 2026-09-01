import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { computeAddOnSuggestions, computePopularPairs, computeRecommendations } from "../recommender/recommenderEngine";

// ─── useRecommendations ─────────────────────────────────────────────────────────
// Owns the only piece of non-local data the recommender needs that UserMenu does not already
// hold: the signed-in student's FULL order history (UserMenu's myRecentOrders is deliberately
// live-orders-only). It subscribes once per user and re-runs the pure engine whenever the
// history, the active-shop menu, the cross-user co-occurrence stream, the cart, or the "now"
// evaluation time changes.
//
// Guests get cold-start (popularity) picks with no extra Firestore read. It also computes the
// cart's add-on suggestions ("Complete Your Order") from the same data sources, so manual and
// voice ordering both update them through the shared cart.
export default function useRecommendations({
  user,
  activeShop,
  menuItems,
  cooccurrenceOrders = [],
  cart = [],
  enabled = true,
}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const hasAccount = Boolean(user?.uid);

  useEffect(() => {
    if (!hasAccount || !enabled) return undefined;
    const q = query(collection(db, "orders"), where("student_uid", "==", user.uid));
    return onSnapshot(
      q,
      (snapshot) => {
        // Only PAID orders count as purchase history — failed/cancelled checkout attempts must
        // not train the recommender. (Client-side filter keeps this a single-field query.)
        setOrders(
          snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((order) => order.payment_status === "paid")
        );
        setLoading(false);
      },
      (error) => {
        console.error("Recommendation order-history listener failed:", error);
        setLoading(false);
      }
    );
  }, [hasAccount, enabled, user?.uid]);

  // Derived loading/orders so the no-account / disabled branches never need a setState in the
  // effect body (a logged-out user simply ignores the (empty) stored orders).
  const effectiveLoading = hasAccount && enabled && loading;

  const result = useMemo(() => {
    if (!enabled) return { recommendations: [], coldStart: true, hasHistory: false, addOns: [], pairs: [] };
    const effectiveOrders = hasAccount ? orders : [];
    // Recommendations are additive: any failure must degrade to an empty section rather than
    // ever blocking the ordering flow, so the engine calls are sandboxed here.
    try {
      const recommendations = computeRecommendations({
        orders: effectiveOrders,
        catalog: menuItems,
        activeShop,
        cart,
        cooccurrenceOrders,
        now,
        maxResults: 8,
      });
      const addOns = computeAddOnSuggestions({
        cart,
        catalog: menuItems,
        orders: effectiveOrders,
        cooccurrenceOrders,
        now,
        activeShop,
        maxResults: 3,
      });
      const pairs = computePopularPairs({
        catalog: menuItems,
        cooccurrenceOrders,
        activeShop,
        maxPairs: 3,
      });
      return { ...recommendations, addOns, pairs };
    } catch (error) {
      console.error("Recommendation engine failed; falling back to empty:", error);
      return { recommendations: [], coldStart: true, hasHistory: false, addOns: [], pairs: [] };
    }
  }, [enabled, hasAccount, orders, menuItems, activeShop, cart, cooccurrenceOrders, now]);

  const refresh = () => setNow(new Date());

  return {
    recommendations: result.recommendations,
    coldStart: result.coldStart,
    hasHistory: result.hasHistory,
    modelSummary: result.modelSummary,
    addOns: result.addOns,
    pairs: result.pairs,
    loading: effectiveLoading,
    refresh,
    // Raw inputs the Food Assistant reuses for its own snapshot (user's OWN order history,
    // non-PII cross-user signals, and the current evaluation time).
    orders: hasAccount ? orders : [],
    now,
  };
}
