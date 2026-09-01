import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, signOutUser } from "./firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { computeQueueMetrics } from "./queueingModel";
import { computeDemandForecast } from "./demandForecast";
import StallDiscoverySearch from "./components/StallDiscoverySearch";

import {
  applySpecialPricing,
  CRAVING_FILTERS,
  ensureRazorpayScript,
  itemImage,
  ORDER_API_URL,
  playNotificationTone,
  postJson,
  RAZORPAY_KEY_ID,
  SHOPS,
  sortByNewest,
  toTitleCase,
  VERIFY_API_URL,
} from "./components/UserMenu/helpers";
import BulkOrderModal from "./components/UserMenu/BulkOrderModal";
import CartBar from "./components/UserMenu/CartBar";
import CartDrawer from "./components/UserMenu/CartDrawer";
import CategoryStrip from "./components/UserMenu/CategoryStrip";
import ChefSpecials from "./components/UserMenu/ChefSpecials";
import GuestFallbackCard from "./components/UserMenu/GuestFallbackCard";
import LiveStatusSidebar from "./components/UserMenu/LiveStatusSidebar";
import LoginModal from "./components/UserMenu/LoginModal";
import MealPassCallout from "./components/UserMenu/MealPassCallout";
import MealPassesTabContent from "./components/UserMenu/MealPassesTabContent";
import MealPassModal from "./components/UserMenu/MealPassModal";
import MenuGrid from "./components/UserMenu/MenuGrid";
import OrderReadyPill from "./components/UserMenu/OrderReadyPill";
import Footer from "./components/UserMenu/Footer";
import PageStyles from "./components/UserMenu/PageStyles";
import PromotionsCarousel from "./components/UserMenu/PromotionsCarousel";
import Recommendations from "./components/UserMenu/Recommendations";
import ShopSpotlight from "./components/UserMenu/ShopSpotlight";
import SpendWallet from "./components/UserMenu/SpendWallet";
import MyOrders from "./components/UserMenu/MyOrders";
import StallCarousel from "./components/UserMenu/StallCarousel";
import SusAuditModal from "./components/UserMenu/SusAuditModal";
import VoiceOrderingPanel from "./components/Voice/VoiceOrderingPanel";
import AppHeader from "./components/AppHeader";
import BottomNav from "./components/BottomNav";
import HomeHero from "./components/home/HomeHero";
import HomeRecommendations from "./components/home/HomeRecommendations";
import { rankPopularity } from "./components/home/rankPopularity";
import HomeCombos from "./components/home/HomeCombos";
import EditorialFeature from "./components/home/EditorialFeature";
import OrderConfirmation from "./components/orders/OrderConfirmation";
import CheckoutSheet from "./components/cart/CheckoutSheet";
import { useVoiceOrdering } from "./hooks/useVoiceOrdering";
import { executeCommand } from "./core/commands/commandEngine.js";
import { ACTION_TYPE } from "./assistant/types.js";
import { handleAssistantTurn } from "./assistant/engine.js";
import FoodAssistantPanel from "./components/FoodAssistant/FoodAssistantPanel";
import FoodAssistantTrigger from "./components/FoodAssistant/FoodAssistantTrigger";
import { useFoodAssistant } from "./components/FoodAssistant/useFoodAssistant";
import "./components/FoodAssistant/assistant.css";
import useRecommendations from "./hooks/useRecommendations.js";
import { logInteractionEvent, logVoiceSession } from "./research/telemetry.js";
import { appendTraceEntry, createSessionTrace, markCheckoutSucceeded, summarizeSession } from "./research/sessionTrace.js";

function UserMenu({ user, abGroup, initialTab = "home" }) {
  // ─── Feature 4: Role detection ────────────────────────────────────────────
const userRole = localStorage.getItem("userRole") || "student";
const isFacultyAdmin = userRole === "faculty_admin";
  const isStaffAccount = user?.email === "aadi.r.santhosh8863@gmail.com";
  const studentName = user?.displayName || user?.email?.split("@")[0] || "Student";
  const [activeTab, setActiveTab] = useState(initialTab); // "home" | "menu" | "meal-passes" | "spend-wallet" | "my-orders"
  const [isOrdering, setIsOrdering] = useState(false);

  // ─── Guest-Browsing-First: Auth modal state ──────────────────────────────
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLiveStatus, setShowLiveStatus] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [searchQuery, setSearchQueryState] = useState("");
  const [activeShop, setActiveShopState] = useState(() => localStorage.getItem("preferredShop") || "Falcon Veg");
  const [myRecentOrders, setMyRecentOrders] = useState([]);
  const [cart, setCartState] = useState([]);
  // Latest-cart ref so batched dispatches within the same tick (e.g. HomeCombos "Add both",
  // rapid double-taps on a card's "+") each fold into the previous result instead of both
  // computing from the same stale snapshot and clobbering one another's setCartState.
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; });
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("kitchenDarkMode") === "true");
  const [allOrdersRaw, setAllOrdersRaw] = useState([]);
  const [showSuccessCheck, setShowSuccessCheck] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [showCheckoutSheet, setShowCheckoutSheet] = useState(false);
  const [shopBroadcast, setShopBroadcast] = useState("");
  const [isShopOpen, setIsShopOpen] = useState(true);
  // Feature 2: Busy mode state
  const [isShopBusy, setIsShopBusy] = useState(false);
  const [shopResumingAt, setShopResumingAt] = useState("");
  const [shopPrepCapacity, setShopPrepCapacity] = useState(2);
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [broadcasts, setBroadcasts] = useState([]);
  const [myActivePasses, setMyActivePasses] = useState([]);
  const [showMealPassModal, setShowMealPassModal] = useState(false);
  // Feature 1: Bulk order modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [loadError, setLoadError] = useState("");
  // ─── Guard toast: transient "kitchen closed" feedback when an add is blocked ──
  const [blockedToast, setBlockedToast] = useState("");
  const blockedToastTimerRef = useRef(null);

  // ─── Discovery homepage: hero search + category strip + stall carousel ──
  const [allProductsRaw, setAllProductsRaw] = useState([]);
  const [allShopStatusRaw, setAllShopStatusRaw] = useState({});
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilterState] = useState("");
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);

  // ─── Modern UI pass: snap-scroll slider + dot indicators for the stall carousel ──
  const stallSliderRef = useRef(null);
  const [stallSlideIndex, setStallSlideIndex] = useState(0);
  const handleStallSliderScroll = () => {
    const el = stallSliderRef.current;
    if (!el) return;
    const cardWidth = 288 + 16; // w-72 (18rem) + gap-4 (1rem)
    setStallSlideIndex(Math.round(el.scrollLeft / cardWidth));
  };
  const scrollStallSliderTo = (index) => {
    const el = stallSliderRef.current;
    if (!el) return;
    const cardWidth = 288 + 16;
    el.scrollTo({ left: index * cardWidth, behavior: "smooth" });
  };

  // ─── Layer 2: Silent UX Friction Telemetry ──────────────────────────────────
  const uxStartTimeRef = useRef(performance.now());
  const uxClickCountRef = useRef(0);
  const [showSusModal, setShowSusModal] = useState(false);
  const uxFrictionDataRef = useRef(null);

  const lastUpdateRef = useRef({});
  // The product most recently added by EITHER modality — powers the shared UNDO_LAST command
  // (voice "cancel my last item" can now undo a manual add, and vice-versa).
  const lastActionProductRef = useRef(null);
  // Set when CHECKOUT is dispatched through the command engine so handleOrder doesn't double-log
  // direct (non-dispatch) checkouts like Quick Reorders.
  const checkoutViaDispatchRef = useRef(false);
  // Tracks which modality triggered the most recent checkout — lets the post-order SUS audit be
  // attributed to manual vs. voice ordering. Defaults to manual (the overwhelmingly common path).
  const lastCheckoutModalityRef = useRef("manual");
  // ─── Phase 2: in-memory ordering-session trace ─────────────────────────────
  // Every dispatched command folds into the trace; at session end (checkout or pagehide) it is
  // written once to voice_sessions. sessionFlushedRef makes the write idempotent.
  const sessionTraceRef = useRef(createSessionTrace());
  const sessionFlushedRef = useRef(false);

  useEffect(() => {
    if (localStorage.getItem("preferredShop") === "Fresh Time") {
      localStorage.setItem("preferredShop", "Break Time");
      setActiveShopState("Break Time");
    }
  }, []);

  useEffect(() => {
    // Both surfaces are themed by CSS variables; the legacy kitchen toggle writes `dark` to
    // <body>, while the new header toggle drives <html>. Keep them in lockstep so either path
    // yields identical tokens.
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.style.backgroundColor = darkMode ? "#0B0B0B" : "#FDF8F5";
    document.body.classList.toggle("dark", darkMode);
    document.body.style.backgroundColor = darkMode ? "#0B0B0B" : "#FDF8F5";
    localStorage.setItem("kitchenDarkMode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    setMenuLoading(true);
    const shopQueryVal = activeShop === "Break Time" ? ["Break Time", "Fresh Time"] : [activeShop];
    const productQuery = query(collection(db, "products"), where("shop", "in", shopQueryVal));
    return onSnapshot(
      productQuery,
      (snapshot) => {
        const items = sortByNewest(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
          .filter((item) => item.available !== false)
          .map(applySpecialPricing)
          // Stable sort: Special of the Day items bubble to the top, newest-first within each group.
          .sort((a, b) => (b.isSpecial ? 1 : 0) - (a.isSpecial ? 1 : 0));
        setMenuItems(items);
        setLoadError("");
        setMenuLoading(false);
      },
      (error) => {
        console.error("Products listener failed:", error);
        setLoadError("Menu could not load. Check Firestore rules for the products collection.");
        setMenuLoading(false);
      }
    );
  }, [activeShop]);

  useEffect(() => {
    const shopQueryVal = activeShop === "Break Time" ? ["Break Time", "Fresh Time"] : [activeShop];
    const broadcastQuery = query(collection(db, "broadcasts"), where("shop", "in", shopQueryVal));
    return onSnapshot(
      broadcastQuery,
      (snapshot) => {
        const items = sortByNewest(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
          .filter((broadcast) => {
            const isMatchingShop = broadcast.shop === activeShop || (activeShop === "Break Time" && broadcast.shop === "Fresh Time");
            return isMatchingShop && broadcast.active !== false;
          })
          .slice(0, 5);
        setBroadcasts(items);
      },
      (error) => console.error("Broadcast listener failed:", error)
    );
  }, [activeShop]);

  // ─── Feature 2: Shop status listener extended for is_busy ────────────────
  useEffect(() => {
    const statusRef = doc(db, "shop_status", activeShop);
    return onSnapshot(
      statusRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          if (activeShop === "Break Time") {
            const fallbackRef = doc(db, "shop_status", "Fresh Time");
            onSnapshot(fallbackRef, (fallbackSnapshot) => {
              if (fallbackSnapshot.exists()) {
                const data = fallbackSnapshot.data();
                setShopBroadcast(data.message || "");
                setIsShopOpen(data.is_open !== false);
                setIsShopBusy(Boolean(data.is_busy));
                setShopResumingAt(data.resuming_at || "");
                setShopPrepCapacity(Number.isFinite(data.prepCapacity) && data.prepCapacity > 0 ? data.prepCapacity : 2);
              } else {
                setShopBroadcast(""); setIsShopOpen(true); setIsShopBusy(false); setShopResumingAt(""); setShopPrepCapacity(2);
              }
            });
            return;
          }
          setShopBroadcast(""); setIsShopOpen(true); setIsShopBusy(false); setShopResumingAt(""); setShopPrepCapacity(2);
          return;
        }
        const data = snapshot.data();
        setShopBroadcast(data.message || "");
        setIsShopOpen(data.is_open !== false);
        setIsShopBusy(Boolean(data.is_busy));
        setShopResumingAt(data.resuming_at || "");
        setShopPrepCapacity(Number.isFinite(data.prepCapacity) && data.prepCapacity > 0 ? data.prepCapacity : 2);
      },
      (error) => console.error("Shop status listener failed:", error)
    );
  }, [activeShop]);

  useEffect(() => {
    if (!user?.uid) { setMyRecentOrders([]); setMyActivePasses([]); return undefined; }

    const orderQuery = query(collection(db, "orders"), where("student_uid", "==", user.uid));
    const unsubscribeOrders = onSnapshot(
      orderQuery,
      (snapshot) => {
        // "Live Status" is for genuinely in-flight PAID orders only — pending/preparing/ready.
        // The payment_status guard keeps failed/cancelled checkout attempts out of this panel
        // (they stay visible as records in My Orders history). Completed (archived) orders
        // belong in the My Orders history tab, not this live panel. The full history is
        // unaffected.
        const orders = sortByNewest(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
          .filter((order) => ["pending", "preparing", "ready"].includes(order.status))
          .filter((order) => order.payment_status === "paid")
          .slice(0, 5);
        setMyRecentOrders(orders);
      },
      (error) => console.error("Student orders listener failed:", error)
    );

    const passQuery = query(collection(db, "subscriptions"), where("student_uid", "==", user.uid));
    const unsubscribePasses = onSnapshot(
      passQuery,
      (snapshot) => {
        const passes = sortByNewest(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))).filter((pass) => {
          const expiry = pass.expiry?.toDate?.();
          return pass.meals_remaining > 0 && (!expiry || expiry >= new Date()) && ["active", "claimed"].includes(pass.status);
        });
        setMyActivePasses(passes);
      },
      (error) => console.error("Student passes listener failed:", error)
    );

    return () => { unsubscribeOrders(); unsubscribePasses(); };
  }, [user?.uid]);

  // Whole-collection listener (mirrors the pattern KitchenLiveBoard.jsx already uses) —
  // feeds both the per-shop queue-depth badges and the wait-time estimate's service-time samples.
  useEffect(() => {
    // Reads the non-PII order_signals mirror (shop_name/status/timestamps only), not the full
    // orders collection — Firestore rules restrict full order docs to their owner and staff.
    const unsubscribe = onSnapshot(
      collection(db, "order_signals"),
      (snapshot) => setAllOrdersRaw(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => console.error("Order-signals listener failed (queue stats):", error)
    );
    return () => unsubscribe();
  }, []);

  // Unscoped products/shop_status listeners (public read, per Firestore rules) — feed the
  // discovery hero's category strip, stall carousel, and real search, none of which can be
  // scoped to a single activeShop the way the rest of the page's data is.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "products"),
      (snapshot) =>
        setAllProductsRaw(
          snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.available !== false)
        ),
      (error) => console.error("All-products listener failed (discovery):", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "shop_status"),
      (snapshot) => {
        const statusMap = {};
        snapshot.docs.forEach((docSnap) => { statusMap[docSnap.id] = docSnap.data(); });
        setAllShopStatusRaw(statusMap);
      },
      (error) => console.error("All-shop-status listener failed (discovery):", error)
    );
    return () => unsubscribe();
  }, []);

  // Global ⌘K / Ctrl+K opens the search command center from anywhere in the app.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearchOverlay(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shopKeyOf = (order) => (order.shop_name === "Fresh Time" ? "Break Time" : order.shop_name);

  const pendingCounts = useMemo(() => {
    const counts = {};
    allOrdersRaw.forEach((order) => {
      if (!["pending", "preparing", "ready"].includes(order.status)) return;
      const shopKey = shopKeyOf(order);
      counts[shopKey] = (counts[shopKey] || 0) + 1;
    });
    return counts;
  }, [allOrdersRaw]);

  const activeShopOrderHistory = useMemo(
    () => allOrdersRaw.filter((order) => shopKeyOf(order) === activeShop),
    [allOrdersRaw, activeShop]
  );

  const queueMetrics = useMemo(
    () =>
      computeQueueMetrics({
        queueDepth: pendingCounts[activeShop] || 0,
        recentOrders: activeShopOrderHistory,
        concurrency: shopPrepCapacity,
      }),
    [pendingCounts, activeShop, activeShopOrderHistory, shopPrepCapacity]
  );

  const demandForecast = useMemo(
    () => computeDemandForecast({ orders: activeShopOrderHistory, horizonHours: 3 }),
    [activeShopOrderHistory]
  );

  // Distinct categories actually present across the live menu (not a hardcoded list) —
  // powers the "Order our best food options" style category strip.
  const productCategories = useMemo(() => {
    const seen = new Set();
    allProductsRaw.forEach((item) => { if (item.category) seen.add(item.category); });
    return [...seen].sort();
  }, [allProductsRaw]);

  // Quick-filter chips for Browse-by-craving + the menu search bar: curated craving
  // filters (Veg/Non-Veg/Biryani/Drinks/Snacks) that actually match at least one live
  // product, plus every real category from the menu. Categories are title-cased for
  // display; chip ids stay raw so the existing categoryFilter matching keeps working.
  const browseChips = useMemo(() => {
    const chips = [];
    CRAVING_FILTERS.forEach((chip) => {
      if (allProductsRaw.some((item) => chip.match(item))) chips.push({ id: chip.id, label: chip.label });
    });
    productCategories.forEach((cat) => {
      if (!chips.some((c) => c.id === cat || c.label.toLowerCase() === cat.toLowerCase())) {
        chips.push({ id: cat, label: toTitleCase(cat) });
      }
    });
    return chips;
  }, [allProductsRaw, productCategories]);

  // One live-data card per stall for the discovery carousel: real open/closed state, a real
  // wait-time estimate (reusing the same queueing model that powers the per-shop badge above),
  // and real category tags/imagery sourced from that stall's own products — no fabricated
  // ratings or review counts.
  const stallLiveStats = useMemo(() => {
    return SHOPS.map((shop) => {
      const shopProducts = allProductsRaw.filter((item) => (item.shop === "Fresh Time" ? "Break Time" : item.shop) === shop);
      const shopOrderHistory = allOrdersRaw.filter((order) => shopKeyOf(order) === shop);
      const statusDoc = allShopStatusRaw[shop] || allShopStatusRaw[shop === "Break Time" ? "Fresh Time" : shop];
      const isOpen = statusDoc?.is_open !== false;
      const isBusy = Boolean(statusDoc?.is_busy);
      const prepCapacity = Number.isFinite(statusDoc?.prepCapacity) && statusDoc.prepCapacity > 0 ? statusDoc.prepCapacity : 2;
      const metrics = computeQueueMetrics({
        queueDepth: pendingCounts[shop] || 0,
        recentOrders: shopOrderHistory,
        concurrency: prepCapacity,
      });
      const categories = [...new Set(shopProducts.map((item) => item.category).filter(Boolean))].slice(0, 3);
      const representativeImage = itemImage(shopProducts.find((item) => itemImage(item))) || "";
      return { name: shop, isOpen, isBusy, categories, image: representativeImage, queueMetrics: metrics, productCount: shopProducts.length };
    });
  }, [allProductsRaw, allOrdersRaw, allShopStatusRaw, pendingCounts]);

  useEffect(() => {
    myRecentOrders.forEach((order) => {
      const previous = lastUpdateRef.current[order.id] || {};
      const becameReady = order.status === "ready" && previous.status !== "ready";
      const newDelay = order.delay_message && order.delay_message !== previous.delay_message;
      if (becameReady || newDelay) playNotificationTone();
      lastUpdateRef.current[order.id] = { status: order.status, delay_message: order.delay_message };
    });
  }, [myRecentOrders]);

  const filteredItems = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    const activeChip = categoryFilter ? CRAVING_FILTERS.find((chip) => chip.id === categoryFilter) : null;
    const baseItems = menuItems.filter((item) => {
      const matchingShop = item.shop === activeShop || (activeShop === "Break Time" && item.shop === "Fresh Time");
      const matchingCategory = !categoryFilter || (activeChip ? activeChip.match(item) : item.category === categoryFilter);
      return matchingShop && matchingCategory;
    });
    if (!queryText) return baseItems;
    return baseItems.filter((item) => `${item.name || ""} ${item.category || ""}`.toLowerCase().includes(queryText));
  }, [menuItems, searchQuery, activeShop, categoryFilter]);

  const featuredItems = useMemo(() => {
    const chosen = menuItems.filter((item) => {
      const matchingShop = item.shop === activeShop || (activeShop === "Break Time" && item.shop === "Fresh Time");
      return matchingShop && (item.featured === true || item.isFeatured === true);
    });
    const fallbackChosen = chosen.length ? chosen : menuItems.filter((item) => {
      const matchingShop = item.shop === activeShop || (activeShop === "Break Time" && item.shop === "Fresh Time");
      return matchingShop && itemImage(item);
    });
    return fallbackChosen.slice(0, 3);
  }, [menuItems, activeShop]);

  const activePassForShop = myActivePasses.find((pass) => pass.shop === activeShop);
  const cartTotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Effective interactivity gate: blocked when busy OR closed
  const isInteractive = isShopOpen && !isShopBusy;

  const toggleDarkMode = () => setDarkMode((current) => !current);

  // ─── Phase 1: single command pipeline ──────────────────────────────────────
  // dispatchCommand is the ONLY mutator of ordering state. Every interaction — manual buttons,
  // search, stall tabs, voice utterances — reduces to a typed AppCommand executed by the command
  // engine, so manual and voice produce identical outputs by construction. It also emits the
  // interaction_events telemetry for BOTH modalities (single source of truth).
  const dispatchCommand = (command, meta = {}) => {
    // Home-tab quick-adds (Popular Today / combos) surface dishes from ALL stalls, so they must
    // not be blocked by the currently-selected stall being busy/closed — the per-stall gate stays
    // in force on the Menu tab where every card belongs to that stall.
    const isInteractiveNow =
      command.type === "UPDATE_QUANTITY" && activeTab === "home" ? true : isInteractive;
    const result = executeCommand(command, {
      cart: cartRef.current,
      activeShop,
      catalog: menuItems.map(applySpecialPricing),
      productCategories,
      isInteractive: isInteractiveNow,
      lastActionProduct: lastActionProductRef.current,
    });
    const fx = result.effects || {};
    if (fx.cart) {
      cartRef.current = fx.cart;
      setCartState(fx.cart);
    }
    if (fx.activeShop !== undefined) setActiveShopState(fx.activeShop);
    if (fx.searchQuery !== undefined) setSearchQueryState(fx.searchQuery);
    if (fx.categoryFilter !== undefined) setCategoryFilterState(fx.categoryFilter);
    if (fx.lastActionProduct !== undefined) lastActionProductRef.current = fx.lastActionProduct;
    if (fx.preferredShop) localStorage.setItem("preferredShop", fx.preferredShop);
    if (fx.clearCart) {
      cartRef.current = [];
      setCartState([]);
    }
    if (fx.openCart) setShowCartDrawer(true);
    if (fx.scrollToMenu) scrollToMenuSection();
    if (fx.showLoginModal) setShowLoginModal(true);
    if (fx.checkout) {
      lastCheckoutModalityRef.current = command.modality;
      checkoutViaDispatchRef.current = true;
      handleOrder(cartRef.current);
    }
    // Friction metric: one counted interaction per successful manual command (voice commands
    // don't inflate click counts).
    if (command.modality === "manual" && result.success) uxClickCountRef.current += 1;
    if (!meta.silent) {
      // ts is stamped inside the trace reducer (epoch ms) so this render-time function stays pure.
      const entry = {
        modality: command.modality,
        commandType: result.commandType || command.type,
        success: result.success,
        latencyMs: meta.latencyMs ?? null,
      };
      // Fold the command into the session trace; the reducer also classifies the recovery
      // pattern when this command follows a FAILED voice command (manual → fallback, voice →
      // retry) — the study's central friction signal.
      const { trace, signal } = appendTraceEntry(sessionTraceRef.current, entry);
      sessionTraceRef.current = trace;
      if (signal?.type === "voice_to_manual") {
        logInteractionEvent({
          user,
          abGroup,
          modality: "hybrid",
          commandType: "VOICE_FALLBACK",
          success: true,
          activeShop: fx.activeShop || activeShop,
          meta: { from: signal.from, to: signal.to },
        });
      } else if (signal?.type === "voice_retry") {
        logInteractionEvent({
          user,
          abGroup,
          modality: "voice",
          commandType: "VOICE_RETRY",
          success: true,
          activeShop: fx.activeShop || activeShop,
          meta: { from: signal.from, to: signal.to },
        });
      }
      logInteractionEvent({
        user,
        abGroup,
        modality: command.modality,
        commandType: result.commandType || command.type,
        success: result.success,
        message: result.message || "",
        activeShop: fx.activeShop || activeShop,
        meta: { ...(result.meta || {}), ...(meta.meta || {}) },
        transcript: meta.transcript || null,
        latencyMs: meta.latencyMs ?? null,
      });
    }
    return result;
  };

  // Phase 2: write the session summary to voice_sessions exactly once, at the end of a session
  // that included voice ordering. Manual-only sessions stay event-granular in interaction_events.
  const flushSessionSummary = useCallback(() => {
    if (sessionFlushedRef.current) return;
    const trace = sessionTraceRef.current;
    if (!trace.voiceCount || trace.interactionCount === 0) return;
    sessionFlushedRef.current = true;
    logVoiceSession({ user, abGroup, summary: summarizeSession(trace) });
  }, [user, abGroup]);

  // Best-effort flush when the tab goes away (backgrounded or closed) — async Firestore writes
  // during unload are not guaranteed, so checkout-time flushing remains the primary path.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSessionSummary();
    };
    document.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSessionSummary]);

  // Manual adapters — each produces the same AppCommand the voice pipeline emits.
  const changeShop = (shop) => {
    dispatchCommand({ type: "SELECT_STALL", stallName: shop, modality: "manual" });
  };

  // Search input: silent telemetry so per-keystroke typing doesn't flood the dataset, but the
  // state still flows through the engine.
  const setSearchQuery = (query) => {
    dispatchCommand({ type: "SET_SEARCH", query, modality: "manual" }, { silent: true });
  };

  const setCategoryFilter = (category) => {
    dispatchCommand({ type: "SET_CATEGORY", category, modality: "manual" });
  };

  const scrollToMenuSection = () => {
    const element = document.getElementById("menu-ordering-section");
    if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSelectStallFromDiscovery = (shop) => {
    changeShop(shop);
    setGlobalSearchQuery("");
    setShowSearchOverlay(false);
    window.setTimeout(scrollToMenuSection, 50);
  };

  const handleSelectDishFromDiscovery = (item) => {
    const resolvedShop = item.shop === "Fresh Time" ? "Break Time" : item.shop;
    handleSelectStallFromDiscovery(resolvedShop);
  };

  // Real search (not mock): ranks stalls by name/category match, dishes by name match — powers
  // the StallDiscoverySearch overlay opened from the hero search box.
  const stallSearchResults = useMemo(() => {
    const needle = globalSearchQuery.trim().toLowerCase();
    if (!needle) return [];
    return stallLiveStats
      .filter((stall) => `${stall.name} ${stall.categories.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.toLowerCase().indexOf(needle) - b.name.toLowerCase().indexOf(needle));
  }, [globalSearchQuery, stallLiveStats]);

  const dishSearchResults = useMemo(() => {
    const needle = globalSearchQuery.trim().toLowerCase();
    if (!needle) return [];
    return allProductsRaw
      .filter((item) => `${item.name || ""} ${item.category || ""}`.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [globalSearchQuery, allProductsRaw]);

  const updateQuantity = (item, delta) => {
    // Closed-kitchen guard, checked at the point of add so it works on EVERY surface —
    // home-tab recommendations / "Your usuals" / popular picks surface dishes from all six
    // stalls, so a closed stall is only catchable here (the per-tab engine gate is scoped to
    // the active stall and can't see those). Show clear feedback instead of a silent no-op.
    if (delta > 0) {
      const shopKey = item.shop === "Fresh Time" ? "Break Time" : (item.shop || activeShop);
      if (allShopStatusRaw[shopKey]?.is_open === false) {
        showBlockedToast(`${shopKey} is closed right now. Orders reopen soon — try another stall.`);
        return;
      }
    }
    // Pass the full product through so the command engine doesn't need to re-resolve it against
    // the ACTIVE stall's catalog — Popular Today / search surface dishes from ALL stalls, and an
    // item from another shop was previously "not found" (silent no-op). applySpecialPricing keeps
    // the discounted price consistent with in-shop adds; already-priced items pass through as-is.
    const product = typeof item.originalPrice === "number" ? item : applySpecialPricing(item);
    const result = dispatchCommand({ type: "UPDATE_QUANTITY", product, productId: item.id, delta, modality: "manual" });
    // Closed/busy active stall on the Menu tab: the engine blocks the mutation — surface that
    // as visible feedback instead of a silent dead button.
    if (delta > 0 && !result.success && result.message) showBlockedToast(result.message);
  };

  // Transient toast: queues a message and auto-dismisses after a beat (3.4s).
  const showBlockedToast = (message) => {
    setBlockedToast(message);
    clearTimeout(blockedToastTimerRef.current);
    blockedToastTimerRef.current = setTimeout(() => setBlockedToast(""), 3400);
  };

  // ─── Customer reviews: tap-to-rate stars on each menu card update the item's
  // aggregate rating/reviewCount directly (no separate staff step — customers
  // are the ones adding reviews now). Firestore's live listener on `products`
  // reflects the new average back into every open tab automatically.
  const rateMenuItem = async (item, stars) => {
    if (!user) { setShowLoginModal(true); return; }
    const previousCount = Number(item.reviewCount) || 0;
    const previousRating = Number(item.rating) || 0;
    const nextCount = previousCount + 1;
    const nextRating = (previousRating * previousCount + stars) / nextCount;
    try {
      await updateDoc(doc(db, "products", item.id), {
        rating: Number(nextRating.toFixed(2)),
        reviewCount: nextCount,
      });
    } catch (error) {
      console.error("Failed to submit rating:", error);
    }
  };

  // Post-payment confirmation: holds the real order snapshot (id, token, totals, wait) for the
  // OrderConfirmation modal — it stays up until the student dismisses it or taps "Track my order".
  const confirmOrder = (data) => {
    setConfirmedOrder(data);
    setShowSuccessCheck(true);
  };

  // Synchronous reentrancy guard: isOrdering state lags one render, so two rapid taps (or a tap
  // + voice CHECKOUT in the same tick) would both pass the isOrdering check and open TWO
  // Razorpay sessions. The ref closes that gap.
  const orderingRef = useRef(false);

  // Park an unpaid order as failed/cancelled so it can never surface on any active-orders list
  // or kitchen board. Firestore rules allow clients to write ONLY these two values, and only
  // while the order is still pending+unpaid — 'paid' stays Admin-SDK-only.
  const parkUnpaidOrder = async (orderId, paymentStatus, note) => {
    try {
      await updateDoc(doc(db, "orders", orderId), {
        payment_status: paymentStatus,
        payment_note: note,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to record payment state:", error);
    }
  };

  const finishOrdering = () => {
    orderingRef.current = false;
    setIsOrdering(false);
  };

  const handleOrder = async (itemsToOrder, bulkMeta = null) => {
    // Direct (non-dispatch) checkouts log here exactly once; dispatch-triggered checkouts were
    // already logged by dispatchCommand with their modality. The flag is consumed at the very
    // top so early returns can't leave it stale.
    const viaDispatch = checkoutViaDispatchRef.current;
    checkoutViaDispatchRef.current = false;

    if (!user?.uid) { setShowLoginModal(true); return; }
    if (!itemsToOrder.length || !isShopOpen || isOrdering || orderingRef.current) return;
    if (isShopBusy && !bulkMeta) return; // block standard orders when busy

    // Modality attribution for the post-order audit (SUS modal).
    const checkoutModality = lastCheckoutModalityRef.current;
    lastCheckoutModalityRef.current = "manual";
    if (!viaDispatch) {
      logInteractionEvent({ user, abGroup, modality: "manual", commandType: "CHECKOUT", success: true, activeShop, meta: { source: "direct", isBulk: Boolean(bulkMeta) } });
    }

    setIsOrdering(true);
    orderingRef.current = true;
    let orderRef;
    const normalizedItems = itemsToOrder.map((item) => {
      const resolvedShop = item.shop === "Fresh Time" ? "Break Time" : (item.shop || activeShop);
      return { ...item, quantity: item.quantity || 1, shop: resolvedShop };
    });
    const totalPrice = normalizedItems.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
    const itemNames = normalizedItems.map((item) => `${item.name} (x${item.quantity})`).join(", ");
    const tokenPin = Math.floor(1000 + Math.random() * 9000).toString();

    try {
      await ensureRazorpayScript();

      // ─── Feature 1: Build order payload; add bulk metadata if present ────
      const orderPayload = {
        student_name: studentName,
        student_email: user.email || "",
        student_uid: user.uid,
        item_name: itemNames,
        items: normalizedItems.map((item) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price || 0),
          quantity: item.quantity,
        })),
        price: totalPrice,
        shop_name: normalizedItems[0].shop || activeShop,
        status: "pending",
        payment_status: "pending",
        token_pin: tokenPin,
        created_at: serverTimestamp(),
        order_source: "web_app",
      };

      if (bulkMeta) {
        orderPayload.is_bulk_order = true;
        orderPayload.department_name = bulkMeta.department_name;
        orderPayload.event_type = bulkMeta.event_type;
        orderPayload.poc_phone = bulkMeta.poc_phone;
        // Server-side timestamp from datetime-local string
        orderPayload.scheduled_delivery_timestamp = bulkMeta.scheduled_delivery_timestamp
          ? Timestamp.fromDate(new Date(bulkMeta.scheduled_delivery_timestamp))
          : null;
      }

      orderRef = await addDoc(collection(db, "orders"), orderPayload);

      // NOTE: no order_signals write here. That non-PII mirror used to be written BEFORE the
      // payment even opened, polluting queue-depth/demand aggregates with unpaid checkouts.
      // The backend now creates it via the Admin SDK only after signature verification
      // succeeds, so the mirror exists if and only if the order was actually paid.

      // The backend recomputes the total from live menu prices (items below) and anchors the
      // Razorpay order to THAT amount — body.amount is only informational.
      const idToken = await user.getIdToken();
      const razorpayOrder = await postJson(
        ORDER_API_URL,
        {
          orderId: orderRef.id,
          type: "order",
          amount: totalPrice,
          items: normalizedItems.map((item) => ({ id: item.id, quantity: item.quantity })),
        },
        idToken
      );

      let paymentCompleted = false;
      const razorpay = new window.Razorpay({
        key: RAZORPAY_KEY_ID,
        amount: razorpayOrder.amount,
        currency: "INR",
        name: "Christ University Cafeteria",
        description: itemNames,
        order_id: razorpayOrder.id,
        notes: { firebase_doc_id: orderRef.id },
        prefill: { name: studentName, email: user.email || "" },
        theme: { color: "#E06A3B" },
        handler: async (payment) => {
          paymentCompleted = true;
          try {
            const verification = await postJson(VERIFY_API_URL, {
              razorpay_order_id: payment.razorpay_order_id || razorpayOrder.id,
              razorpay_payment_id: payment.razorpay_payment_id || "",
              razorpay_signature: payment.razorpay_signature || "",
              firebase_doc_id: orderRef.id,
              type: "order",
            }, await user.getIdToken());
            if (!verification.verified) throw new Error("Payment signature verification failed.");
            // Only now has the server (Admin SDK) marked payment_status:'paid' and mirrored the
            // order into order_signals — which is the moment the Kitchen Live Board picks it up.
            if (!verification.firestore_updated) {
              alert("Payment verified, but confirmation is still processing — your order will update within a minute.");
            }
            confirmOrder({
              id: orderRef.id,
              shortId: orderRef.id.slice(-6).toUpperCase(),
              tokenPin,
              shop: orderPayload.shop_name,
              itemNames,
              total: totalPrice,
              studentName,
              estimatedWaitMin: queueMetrics.estimatedWaitMin,
            });
            setCartState([]);
            finishOrdering();
            // Phase 2: the task is complete — mark the trace and write the session summary
            // (primary flush point; pagehide is only a fallback for abandoned sessions).
            sessionTraceRef.current = markCheckoutSucceeded(sessionTraceRef.current);
            flushSessionSummary();
            // ─── Layer 2: Compute friction metrics & trigger SUS modal ─────
            const totalTimeSeconds = ((performance.now() - uxStartTimeRef.current) / 1000).toFixed(2);
            uxFrictionDataRef.current = { timeToTaskSeconds: totalTimeSeconds, clickThroughVolume: uxClickCountRef.current, modality: checkoutModality };
            setShowSusModal(true);
            uxStartTimeRef.current = performance.now();
            uxClickCountRef.current = 0;
          } catch (error) {
            console.error("Order payment verification failed:", error);
            // Verification did not complete — explicitly park this order as failed so it can
            // never appear as an active order anywhere. If money actually moved and Razorpay's
            // webhook confirms it afterwards, the Admin SDK overwrites this to paid.
            await parkUnpaidOrder(orderRef.id, "failed", "verification_failed");
            alert("We couldn't confirm your payment automatically. If money was deducted, don't pay again — your order will update within a minute. Contact support if it doesn't.");
            finishOrdering();
          }
        },
        modal: {
          ondismiss: async () => {
            if (!paymentCompleted) {
              // Checkout closed without paying: park as cancelled (kept as an audit trail).
              // Cart contents stay untouched so the student can retry immediately.
              await parkUnpaidOrder(orderRef.id, "cancelled", "checkout_dismissed");
            }
            finishOrdering();
          },
        },
      });
      razorpay.open();
    } catch (error) {
      console.error("Order error:", error);
      // Nothing reached Razorpay yet (script/create-order/open failure): remove the temporary
      // doc entirely — no payment attempt happened, so there is nothing to audit.
      if (orderRef?.id) {
        await deleteDoc(doc(db, "orders", orderRef.id)).catch((cleanupError) => console.error("Order cleanup failed:", cleanupError));
        await deleteDoc(doc(db, "order_signals", orderRef.id)).catch(() => {});
      }
      alert(error.message || "Payment initiation failed. Please try again.");
      finishOrdering();
    }
  };

  const deleteOrder = async (orderId, status, paymentStatus) => {
    const canDelete = status === "completed" || paymentStatus !== "paid";
    if (!canDelete || !window.confirm("Remove this order record?")) return;
    try {
      await deleteDoc(doc(db, "orders", orderId));
      await deleteDoc(doc(db, "order_signals", orderId)).catch(() => {});
      delete lastUpdateRef.current[orderId];
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Could not delete the order.");
    }
  };

  const scrollToLiveStatus = () => {
    setShowLiveStatus(true);
    const element = document.getElementById("live-status-section");
    if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ─── Persistent-chrome helpers (AppHeader / BottomNav / home assembly) ─────
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleBrowseMenu = () => {
    setActiveTab("menu");
    window.scrollTo({ top: 0 });
  };

  const handleOpenMealPass = () => {
    setActiveTab("meal-passes");
    window.scrollTo({ top: 0 });
  };

  // Home cards drop you straight into that stall's menu tab.
  const handleSelectStallFromHome = (shop) => {
    changeShop(shop);
    setActiveTab("menu");
    window.setTimeout(scrollToMenuSection, 120);
  };

  // OrderConfirmation → My Orders (with the confirmation closed).
  const handleTrackOrder = () => {
    setShowSuccessCheck(false);
    setActiveTab("my-orders");
    window.scrollTo({ top: 0 });
  };

  // "Order again" from My Orders history: rebuilds the cart from the items saved at order
  // time (real ids/prices), lands on that stall's menu, and opens the drawer.
  const handleReorder = ({ shop_name, items }) => {
    const resolvedShop = shop_name === "Fresh Time" ? "Break Time" : shop_name;
    changeShop(resolvedShop);
    const rebuiltCart = items.map((entry) => ({
      id: entry.id,
      name: entry.name,
      price: entry.price,
      quantity: entry.quantity || 1,
      shop: resolvedShop,
    }));
    cartRef.current = rebuiltCart;
    setCartState(rebuiltCart);
    setActiveTab("menu");
    window.scrollTo({ top: 0 });
    window.setTimeout(() => setShowCartDrawer(true), 60);
  };

  const handleCheckoutTap = () => {
    if (!user) { setShowLoginModal(true); return; }
    setShowCheckoutSheet(true);
  };

  const handleLogout = async () => {
    await signOutUser();
    window.location.hash = "/login";
  };

  // The voice pipeline reduces to the SAME command dispatch the manual UI uses. All the
  // imperative callbacks (updateQuantity, changeShop, checkout, undoLast, ...) are gone — the
  // voice executor emits AppCommands and dispatchCommand is the single mutator.
  const voiceContext = {
    activeShop,
    stallNames: SHOPS,
    productCategories,
    catalog: menuItems.map(applySpecialPricing),
    dispatch: dispatchCommand,
  };

  const voice = useVoiceOrdering(voiceContext);


  // ─── Food recommendations + cart add-ons ─────────────────────────────────────
  // Subscribes to the signed-in student's full order history and runs the recommender in a memo.
  // Cross-user co-occurrence comes from the already-loaded non-PII order_signals stream; the cart
  // feeds both the personalised picks (pairing signal) and the drawer's "Complete Your Order"
  // add-ons. Manual and voice ordering both mutate the same cart, so both surfaces stay in sync.
  const {
    recommendations: recommendationsData,
    hasHistory: recsHasHistory,
    loading: recsLoading,
    addOns,
    pairs: popularPairs,
    orders: userOrderHistory,
    now: recommendationsNow,
  } = useRecommendations({
    user,
    activeShop,
    menuItems,
    cart,
    cooccurrenceOrders: allOrdersRaw,
  });
  // ─── Food Assistant ─────────────────────────────────────────────────────────
  // The assistant is a deterministic conversational layer over the live menu. It only ever
  // PROPOSES cart actions (ProposedAction), which the user confirms; confirmation flows through
  // the SAME command engine as manual/voice ordering, so telemetry and cart state stay single-
  // sourced. The panel is only rendered on the menu tab, next to the voice control.
  const assistantContext = useMemo(
    () => ({
      activeShop,
      activeTab,
      cart: cart.map((line) => ({ id: line.id, quantity: line.quantity })),
    }),
    [activeShop, activeTab, cart]
  );

  const checkoutTapRef = useRef(handleCheckoutTap);
  useEffect(() => {
    checkoutTapRef.current = handleCheckoutTap;
  }, [handleCheckoutTap]);

  // The assistant runs the SAME deterministic engine client-side, fed from the live app data
  // (the identical logic is what api/food-assistant.js runs server-side). This keeps the feature
  // fully functional with zero network round-trip — and as a resilience bonus, it cannot be
  // blocked by an un-deployed/offline endpoint.
  const assistantSnapshot = useMemo(
    () => ({
      products: allProductsRaw.map(applySpecialPricing),
      shopStatus: allShopStatusRaw,
      orderSignals: allOrdersRaw,
      userOrders: user ? userOrderHistory : null,
      signedIn: Boolean(user),
      now: recommendationsNow,
    }),
    [allProductsRaw, allShopStatusRaw, allOrdersRaw, userOrderHistory, user, recommendationsNow]
  );

  const runAssistantTurn = useCallback(
    async (messages) => {
      try {
        return await handleAssistantTurn({ messages, context: assistantContext, snapshot: assistantSnapshot });
      } catch (error) {
        console.error("Food Assistant engine error:", error);
        return {
          type: "ERROR",
          reply: "Sorry, I hit a snag reading the menu. Try asking again.",
          data: { suggestions: ["High protein", "Under ₹100", "What's available right now?"] },
          actions: [],
        };
      }
    },
    [assistantContext, assistantSnapshot]
  );

  const dispatchAssistantAction = useCallback(
    (action) => {
      if (!action) return;
      switch (action.type) {
        case ACTION_TYPE.ADD_ITEM:
          dispatchCommand({ type: "ADD_ITEM", productId: action.productId, quantity: action.quantity || 1, modality: "assistant" }, { silent: true });
          break;
        case ACTION_TYPE.REMOVE_ITEM:
          dispatchCommand({ type: "REMOVE_ITEM", productId: action.productId, quantity: action.quantity || 1, modality: "assistant" }, { silent: true });
          break;
        case ACTION_TYPE.UPDATE_QUANTITY: {
          const line = cartRef.current.find((entry) => entry.id === action.productId);
          const delta = (action.quantity || 1) - (line?.quantity || 0);
          if (delta !== 0) {
            dispatchCommand({ type: "UPDATE_QUANTITY", productId: action.productId, delta, modality: "assistant" }, { silent: true });
          }
          break;
        }
        case ACTION_TYPE.ADD_ITEMS:
          (action.items || []).forEach((line) =>
            dispatchCommand({ type: "ADD_ITEM", productId: line.productId, quantity: line.quantity || 1, modality: "assistant" }, { silent: true })
          );
          break;
        case ACTION_TYPE.REPLACE_CART:
          cartRef.current.forEach((line) =>
            dispatchCommand({ type: "REMOVE_ITEM", productId: line.id, quantity: line.quantity, modality: "assistant" }, { silent: true })
          );
          break;
        case ACTION_TYPE.OPEN_CART:
          setShowCartDrawer(true);
          break;
        case ACTION_TYPE.CHECKOUT:
          checkoutTapRef.current();
          break;
        default:
          break;
      }
    },
    [dispatchCommand]
  );

  const assistant = useFoodAssistant({
    context: assistantContext,
    runTurn: runAssistantTurn,
    getToken: user ? () => user.getIdToken(true) : null,
    onAction: dispatchAssistantAction,
  });

  // Search overlay's "start here" grid: personal frequent picks + real cross-campus popularity.
  const usualsForSearch = useMemo(
    () => recommendationsData.filter((rec) => rec.timesOrdered > 0),
    [recommendationsData]
  );
  const popularDishesForSearch = useMemo(() => rankPopularity(allProductsRaw), [allProductsRaw]);

  return (
    <div className="min-h-screen font-sans antialiased transition-colors duration-500" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <PageStyles />

      {/* ─── Persistent chrome: sticky header (desktop nav) + mobile tab rail ── */}
      <AppHeader
        user={user}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenSearch={() => setShowSearchOverlay(true)}
        onOpenCart={() => setShowCartDrawer(true)}
        cartCount={cartCount}
        cartTotal={cartTotal}
        isStaffAccount={isStaffAccount}
        onShowLogin={() => setShowLoginModal(true)}
        onLogout={handleLogout}
        darkMode={darkMode}
        onToggleDark={toggleDarkMode}
      />
      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      {showSuccessCheck && confirmedOrder && (
        <OrderConfirmation
          order={confirmedOrder}
          onClose={() => setShowSuccessCheck(false)}
          onTrackOrder={handleTrackOrder}
        />
      )}

      {showMealPassModal && (
        <MealPassModal user={user} activeShop={activeShop} menuItems={menuItems} darkMode={darkMode} onClose={() => setShowMealPassModal(false)} />
      )}

      {showSearchOverlay && (
        <StallDiscoverySearch
          query={globalSearchQuery}
          onQueryChange={setGlobalSearchQuery}
          onClose={() => { setShowSearchOverlay(false); setGlobalSearchQuery(""); }}
          stallResults={stallSearchResults}
          dishResults={dishSearchResults}
          usuals={usualsForSearch}
          popularDishes={popularDishesForSearch}
          cart={cart}
          updateQuantity={updateQuantity}
          onSelectStall={handleSelectStallFromDiscovery}
          onSelectDish={handleSelectDishFromDiscovery}
        />
      )}

      {/* ─── Checkout review sheet (spec §35-41) — replaces the straight-to-Razorpay tap ── */}
      {showCheckoutSheet && (
        <CheckoutSheet
          cart={cart}
          cartTotal={cartTotal}
          cartCount={cartCount}
          activeShop={activeShop}
          activePassForShop={activePassForShop}
          estimatedWaitMin={queueMetrics.estimatedWaitMin}
          isOrdering={isOrdering}
          onClose={() => setShowCheckoutSheet(false)}
          onConfirm={() => {
            setShowCheckoutSheet(false);
            handleOrder(cart);
          }}
        />
      )}

      {/* ─── Cart Drawer: itemized cart view, opened from the header badge
          or the bottom cart bar ──────────────────────────────────────────── */}
      {showCartDrawer && (
        <CartDrawer
          cart={cart}
          cartTotal={cartTotal}
          cartCount={cartCount}
          activeShop={activeShop}
          estimatedWaitMin={queueMetrics.estimatedWaitMin}
          isOrdering={isOrdering}
          isFacultyAdmin={isFacultyAdmin}
          addOns={addOns}
          onClose={() => setShowCartDrawer(false)}
          onIncrement={(item) => updateQuantity(item, 1)}
          onDecrement={(item) => updateQuantity(item, -1)}
          onRemove={(item) => updateQuantity(item, -item.quantity)}
          onAddAddOn={(item) => updateQuantity(item, 1)}
          onCheckout={() => {
            setShowCartDrawer(false);
            handleCheckoutTap();
          }}
          onOpenBulk={() => { setShowCartDrawer(false); setShowBulkModal(true); }}
          onBrowseMenu={() => {
            setShowCartDrawer(false);
            handleBrowseMenu();
          }}
        />
      )}

      {/* ─── Feature 1: Bulk Order Modal ──────────────────────────────────── */}
      {showBulkModal && (
        <BulkOrderModal
          user={user}
          activeShop={activeShop}
          cart={cart}
          darkMode={darkMode}
          onClose={() => setShowBulkModal(false)}
          onSubmit={(meta) => handleOrder(cart, meta)}
        />
      )}

      {/* ─── Layer 3: Post-Order SUS Research Audit Modal ─────────────────── */}
      {showSusModal && (
        <SusAuditModal
          darkMode={darkMode}
          abGroup={abGroup}
          frictionData={uxFrictionDataRef.current}
          user={user}
          onClose={() => setShowSusModal(false)}
        />
      )}

      {/* ─── Guest-Browsing-First: Premium Frosted-Glass Auth Modal ────── */}
      {showLoginModal && (
        <LoginModal
          cart={cart}
          cartCount={cartCount}
          cartTotal={cartTotal}
          loginError={loginError}
          isLoggingIn={isLoggingIn}
          setShowLoginModal={setShowLoginModal}
          setLoginError={setLoginError}
          setIsLoggingIn={setIsLoggingIn}
        />
      )}

      <main className="mx-auto w-full max-w-[1220px] px-4 pb-4 pt-6 sm:px-6 lg:px-8">

        {/* ─── HOME — DISCOVER step (spec §2, §20-29) ────────────────────────── */}
        {activeTab === "home" && (
          <div className="cc-tab-fade">
            <HomeHero
              user={user}
              onOpenSearch={() => setShowSearchOverlay(true)}
              stallLiveStats={stallLiveStats}
              allProductsRaw={allProductsRaw}
              onSelectStall={handleSelectStallFromHome}
              onBrowseMenu={handleBrowseMenu}
              onOpenMealPass={handleOpenMealPass}
            />

            <HomeCombos
              pairs={popularPairs}
              updateQuantity={updateQuantity}
            />

            <HomeRecommendations
              user={user}
              hasHistory={recsHasHistory}
              recommendations={recommendationsData}
              loading={recsLoading}
              allProductsRaw={allProductsRaw}
              cart={cart}
              updateQuantity={updateQuantity}
              onLoginClick={() => setShowLoginModal(true)}
              onBrowseMenu={handleBrowseMenu}
            />

            {broadcasts.length > 0 && (
              <PromotionsCarousel broadcasts={broadcasts} activeShop={activeShop} />
            )}

            <EditorialFeature
              onOpenMealPass={handleOpenMealPass}
              onBrowseMenu={handleBrowseMenu}
              isFacultyAdmin={isFacultyAdmin}
              onOpenBulk={() => setShowBulkModal(true)}
            />
          </div>
        )}

        {/* ─── Feature 5: Spend Wallet Tab ──────────────────────────────────── */}
        {activeTab === "spend-wallet" && (
          <div className="cc-tab-fade">
            {user ? (
              <SpendWallet user={user} />
            ) : (
              <GuestFallbackCard
                title="Unlock Your Personal Digital Wallet"
                subtitle="Log in to track your monthly campus budget spending details, view digital receipts, and analyse your top orders instantly."
                onLoginClick={() => setShowLoginModal(true)}
              />
            )}
          </div>
        )}

        {/* ─── My Orders Tab ─────────────────────────────────────────────────── */}
        {activeTab === "my-orders" && (
          <div className="cc-tab-fade">
            {user ? (
              <MyOrders user={user} onReorder={handleReorder} />
            ) : (
              <GuestFallbackCard
                title="See Every Order You've Placed"
                subtitle="Log in to view your full order history and live order status across all campus stalls."
                onLoginClick={() => setShowLoginModal(true)}
              />
            )}
          </div>
        )}

        {/* ─── Meal Passes Tab ──────────────────────────────────────────────── */}
        {activeTab === "meal-passes" && (
          <div className="cc-tab-fade">
            <MealPassesTabContent
              user={user}
              activeShop={activeShop}
              activePassForShop={activePassForShop}
              setShowMealPassModal={setShowMealPassModal}
              setShowLoginModal={setShowLoginModal}
            />
          </div>
        )}

        {/* ─── Menu Tab — ORDER step ─────────────────────────────────────────── */}
        {activeTab === "menu" && (
          <div id="menu-ordering-section" className="cc-tab-fade">
            {/* ─── 1.6 Live Status — collapsible sidebar, sits just below the header ── */}
            {myRecentOrders.length > 0 && (
              <LiveStatusSidebar
                myRecentOrders={myRecentOrders}
                showLiveStatus={showLiveStatus}
                setShowLiveStatus={setShowLiveStatus}
                deleteOrder={deleteOrder}
              />
            )}

            {browseChips.length > 0 && (
              <CategoryStrip
                browseChips={browseChips}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                scrollToMenuSection={scrollToMenuSection}
              />
            )}

            {/* ─── 2. Shop spotlight (live wait, quietest hour) ──────────────── */}
            <ShopSpotlight
              activeShop={activeShop}
              queueMetrics={queueMetrics}
              demandForecast={demandForecast}
              setShowMealPassModal={setShowMealPassModal}
              isFacultyAdmin={isFacultyAdmin}
              setShowBulkModal={setShowBulkModal}
              shopBroadcast={shopBroadcast}
              featuredItems={featuredItems}
            />

            {loadError && (
              <div
                className="mb-6 rounded-2xl border p-4 text-sm font-semibold"
                style={{ borderColor: "color-mix(in srgb, var(--color-error) 40%, transparent)", background: "color-mix(in srgb, var(--color-error) 8%, transparent)", color: "var(--color-error)" }}
              >
                {loadError}
              </div>
            )}

            {/* ─── 3. Stall directory — all six stalls, right under the spotlight ── */}
            <StallCarousel
              stallLiveStats={stallLiveStats}
              stallSliderRef={stallSliderRef}
              handleStallSliderScroll={handleStallSliderScroll}
              stallSlideIndex={stallSlideIndex}
              scrollStallSliderTo={scrollStallSliderTo}
              handleSelectStallFromDiscovery={handleSelectStallFromDiscovery}
            />

            {/* ─── 3.5 Recommended for you (personalised picks for this stall) ── */}
            <Recommendations
              recommendations={recommendationsData}
              hasHistory={recsHasHistory}
              loading={recsLoading}
              cart={cart}
              updateQuantity={updateQuantity}
              rateMenuItem={rateMenuItem}
              activeShop={activeShop}
              user={user}
              onLoginClick={() => setShowLoginModal(true)}
            />

            {/* ─── 4. Meal pass save-money CTA ─────────────────────────────────── */}
            <section className="mb-8">
              <MealPassCallout activePassForShop={activePassForShop} onManage={() => setShowMealPassModal(true)} />
            </section>

            {/* ─── 5. Chef specials (visual browsing appeal) ───────────────────── */}
            {featuredItems.length > 0 && (
              <ChefSpecials featuredItems={featuredItems} cart={cart} updateQuantity={updateQuantity} rateMenuItem={rateMenuItem} />
            )}

            {/* ─── 6. Full searchable menu grid ─────────────────────────────────── */}
            <MenuGrid
              activeShop={activeShop}
              browseChips={browseChips}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              isShopBusy={isShopBusy}
              isShopOpen={isShopOpen}
              shopResumingAt={shopResumingAt}
              menuLoading={menuLoading}
              filteredItems={filteredItems}
              cart={cart}
              updateQuantity={updateQuantity}
              rateMenuItem={rateMenuItem}
            />
          </div>
        )}
      </main>

      <Footer setActiveTab={setActiveTab} setShowSearchOverlay={setShowSearchOverlay} />

      <CartBar
        cart={cart}
        isShopOpen={isShopOpen}
        isShopBusy={isShopBusy}
        isFacultyAdmin={isFacultyAdmin}
        isOrdering={isOrdering}
        setShowCartDrawer={setShowCartDrawer}
        setShowBulkModal={setShowBulkModal}
        user={user}
        setShowLoginModal={setShowLoginModal}
        handleOrder={handleOrder}
        onCheckout={handleCheckoutTap}
        shopResumingAt={shopResumingAt}
        cartCount={cartCount}
        cartTotal={cartTotal}
        activeShop={activeShop}
        estimatedWaitMin={queueMetrics.estimatedWaitMin}
      />

      {myRecentOrders.length > 0 && (
        <OrderReadyPill
          myRecentOrders={myRecentOrders}
          scrollToLiveStatus={scrollToLiveStatus}
          cartBarActive={cart.length > 0}
        />
      )}

      {activeTab === "menu" && (
        <VoiceOrderingPanel
          supported={voice.supported}
          listening={voice.listening}
          transcript={voice.transcript}
          interimTranscript={voice.interimTranscript}
          feedback={voice.feedback}
          disambiguation={voice.disambiguation}
          onToggleListen={voice.toggleListening}
          onPickDisambiguation={voice.pickDisambiguation}
          onDismissDisambiguation={voice.dismissDisambiguation}
          cartBarActive={cart.length > 0}
        />
      )}

      {activeTab === "menu" && !assistant.isOpen && (
        <FoodAssistantTrigger
          onOpen={assistant.open}
          cartBarActive={cart.length > 0}
          hasPending={assistant.messages.some((m) => m.role === "assistant" && m.status === "pending")}
        />
      )}

      {activeTab === "menu" && (
        <FoodAssistantPanel
          open={assistant.isOpen}
          onClose={assistant.close}
          messages={assistant.messages}
          busy={assistant.busy}
          error={assistant.error}
          interactive={isInteractive}
          signedIn={Boolean(user)}
          cartLength={cartCount}
          onSend={assistant.send}
          onConfirm={assistant.confirmAction}
          onCancel={assistant.cancelAction}
          onPick={assistant.pick}
          onAdd={(item, messageId) =>
            assistant.confirmAction(
              { type: ACTION_TYPE.ADD_ITEM, productId: item.id, quantity: item.quantity || 1, label: `Add ${item.name}` },
              messageId
            )
          }
          onOpenCart={() => setShowCartDrawer(true)}
        />
      )}

      {/* ─── Transient guard toast — "kitchen closed" feedback, auto-dismisses ── */}
      {blockedToast && (
        <div
          role="status"
          aria-live="polite"
          className="cc-toast fixed left-1/2 top-20 z-[160] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold shadow-[0_20px_55px_-14px_rgba(46,32,22,0.5)]"
          style={{
            background: "var(--color-surface)",
            border: "1px solid color-mix(in srgb, var(--color-error) 45%, transparent)",
            color: "var(--color-text)",
          }}
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-error) 14%, transparent)", color: "var(--color-error)" }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
            </svg>
          </span>
          <span className="leading-snug">{blockedToast}</span>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
