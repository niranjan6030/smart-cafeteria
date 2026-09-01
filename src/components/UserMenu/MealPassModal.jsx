import { useEffect, useState } from "react";
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
import { db } from "../../firebase";
import {
  ensureRazorpayScript,
  itemEmoji,
  itemImage,
  MEAL_PASS_PLANS,
  money,
  ORDER_API_URL,
  postJson,
  RAZORPAY_KEY_ID,
  safeDate,
  sortByNewest,
  VERIFY_API_URL,
} from "./helpers";
import { stallDisplayName } from "./helpers";
import StepLabel from "./StepLabel";
import SummaryRow from "./SummaryRow";

export default function MealPassModal({ user, activeShop, menuItems, darkMode, onClose }) {
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [mealType, setMealType] = useState("Lunch");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [myPasses, setMyPasses] = useState([]);
  const [errorText, setErrorText] = useState("");

  const studentName = user?.displayName || user?.email?.split("@")[0] || "Student";
  // Only PAID, activated passes count as usable — unpaid/cancelled attempts are never shown.
  const activePasses = myPasses.filter((pass) => {
    const expiry = pass.expiry?.toDate?.();
    return pass.shop === activeShop
      && pass.payment_status === "paid"
      && ["active", "claimed"].includes(pass.status)
      && pass.meals_remaining > 0
      && (!expiry || expiry > new Date());
  });

  useEffect(() => {
    if (!user?.uid) return undefined;
    const passQuery = query(collection(db, "subscriptions"), where("student_uid", "==", user.uid));
    return onSnapshot(
      passQuery,
      (snapshot) => {
        setMyPasses(sortByNewest(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))).slice(0, 8));
        setErrorText("");
      },
      (error) => {
        console.error("Pass listener failed:", error);
        setErrorText("Meal passes could not load. Check Firestore rules for subscriptions.");
      }
    );
  }, [user?.uid]);

  const purchasePlan = MEAL_PASS_PLANS.find((plan) => plan.id === selectedPlan);
  const totalAmount = purchasePlan && selectedItem
    ? Math.round(Number(selectedItem.price || 0) * purchasePlan.meals * purchasePlan.priceMultiplier)
    : 0;

  // Park an unpaid pass as failed/cancelled so it can never be mistaken for a live purchase.
  // Firestore rules allow the owner to write ONLY these values, only while payment is pending.
  const parkUnpaidPass = async (passId, paymentStatus) => {
    try {
      await updateDoc(doc(db, "subscriptions", passId), { payment_status: paymentStatus });
    } catch (error) {
      console.error("Failed to record pass payment state:", error);
    }
  };

  const handlePurchasePass = async () => {
    if (!user?.uid) { alert("Please sign in before buying a meal pass."); return; }
    if (!purchasePlan || !selectedItem) return;
    setIsPurchasing(true);
    let passRef;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + purchasePlan.days);

    try {
      await ensureRazorpayScript();
      passRef = await addDoc(collection(db, "subscriptions"), {
        student_name: studentName,
        student_email: user.email || "",
        student_uid: user.uid,
        shop: activeShop,
        plan_id: purchasePlan.id,
        plan_label: purchasePlan.label,
        meal_type: mealType,
        item_name: selectedItem.name,
        item_id: selectedItem.id,
        meals_total: purchasePlan.meals,
        meals_remaining: purchasePlan.meals,
        price_per_meal: Math.round(Number(selectedItem.price || 0) * purchasePlan.priceMultiplier),
        total_paid: totalAmount,
        status: "pending_payment",
        payment_status: "pending",
        expiry: Timestamp.fromDate(expiryDate),
        created_at: serverTimestamp(),
      });

      const razorpayOrder = await postJson(ORDER_API_URL, { amount: totalAmount, orderId: passRef.id, type: "meal_pass" }, await user.getIdToken());

      let paymentCompleted = false;
      const razorpay = new window.Razorpay({
        key: RAZORPAY_KEY_ID,
        amount: razorpayOrder.amount,
        currency: "INR",
        name: "Christ University Cafeteria Meal Pass",
        description: `${purchasePlan.label} - ${selectedItem.name}`,
        order_id: razorpayOrder.id,
        notes: { firebase_doc_id: passRef.id, type: "meal_pass" },
        prefill: { name: studentName, email: user.email || "" },
        theme: { color: "#E06A3B" },
        handler: async (payment) => {
          paymentCompleted = true;
          try {
            const verification = await postJson(VERIFY_API_URL, {
              razorpay_order_id: payment.razorpay_order_id || razorpayOrder.id,
              razorpay_payment_id: payment.razorpay_payment_id || "",
              razorpay_signature: payment.razorpay_signature || "",
              firebase_doc_id: passRef.id,
              type: "meal_pass",
            }, await user.getIdToken());
            if (!verification.verified) throw new Error("Payment signature verification failed.");
            // The server (Admin SDK) already wrote payment_status/status — Firestore rules forbid
            // the client from doing so itself. The live subscriptions listener reflects it shortly.
            if (!verification.firestore_updated) {
              alert("Payment verified, but confirmation is still processing. Your pass will activate shortly — check My Passes in a minute.");
            }
            setIsPurchasing(false);
            onClose();
          } catch (error) {
            console.error("Pass payment verification failed:", error);
            await parkUnpaidPass(passRef.id, "failed");
            alert("We couldn't confirm your payment automatically. If money was deducted, don't buy again — it will reflect in My Passes shortly. Contact support if it doesn't within a few minutes.");
            setIsPurchasing(false);
            onClose();
          }
        },
        modal: {
          ondismiss: async () => {
            if (!paymentCompleted) {
              // Checkout closed without paying: park as cancelled instead of deleting, so the
              // attempt stays auditable and can never be mistaken for an active pass.
              await parkUnpaidPass(passRef.id, "cancelled");
            }
            setIsPurchasing(false);
          },
        },
      });
      razorpay.open();
    } catch (error) {
      console.error("Pass purchase error:", error);
      if (passRef?.id) {
        // Nothing reached Razorpay yet (create-order/open failure): remove the temp doc.
        await deleteDoc(doc(db, "subscriptions", passRef.id)).catch((cleanupError) => console.error("Pass cleanup failed:", cleanupError));
      }
      alert(error.message || "Could not initiate payment. Please try again.");
      setIsPurchasing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <button aria-label="Close meal pass modal" className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <section className={`relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl ${darkMode ? "bg-[#141414] border-white/10 text-white" : "bg-[#FDF8F5] border-gold-100 text-[#4A1D0A]"}`}>
        <div className={`sticky top-0 z-10 flex items-center justify-between gap-4 border-b p-6 ${darkMode ? "bg-[#141414] border-white/10" : "bg-[#FDF8F5] border-gold-100"}`}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#E06A3B]">Meal Pass</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Prepay, pick up faster</h2>
            <p className={`mt-1 text-xs ${darkMode ? "text-white/55" : "text-stone-500"}`}>{stallDisplayName(activeShop)} - breakfast, lunch, or dinner</p>
          </div>
          <button onClick={onClose} className={`grid h-11 w-11 place-items-center rounded-2xl border text-xl font-bold transition active:scale-95 ${darkMode ? "border-white/10 hover:bg-white/10" : "border-gold-100 hover:bg-gold-50"}`}>×</button>
        </div>

        <div className="space-y-7 p-6">
          {errorText && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">{errorText}</div>}

          {activePasses.length > 0 && (
            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-[#E06A3B]">Your Active Passes</p>
              <div className="grid gap-3">
                {activePasses.map((pass) => (
                  <div key={pass.id} className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${darkMode ? "bg-white/5 border-white/10" : "bg-white border-gold-100"}`}>
                    <div>
                      <p className="text-sm font-black">{pass.plan_label} - {pass.item_name}</p>
                      <p className={`mt-1 text-[11px] ${darkMode ? "text-white/55" : "text-stone-500"}`}>{pass.meals_remaining}/{pass.meals_total} meals left - expires {safeDate(pass.expiry)}</p>
                    </div>
                    <span className="rounded-full bg-[#E06A3B1A] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#E06A3B]">Active</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <StepLabel number="1" label="Choose Daily Item" darkMode={darkMode} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {menuItems.slice(0, 9).map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <button key={item.id} onClick={() => setSelectedItem(item)} className={`overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 active:scale-[0.98] ${isSelected ? "border-[#E06A3B] bg-[#E06A3B1A]" : darkMode ? "border-white/10 bg-white/5" : "border-gold-100 bg-white"}`}>
                    {itemImage(item) ? <img src={itemImage(item)} alt={item.name} className="h-24 w-full object-cover" /> : <div className={`grid h-24 place-items-center text-sm font-bold ${darkMode ? "bg-black/20" : "bg-gold-50"}`}>{itemEmoji(item)}</div>}
                    <div className="p-3">
                      <p className="line-clamp-2 text-xs font-black">{item.name}</p>
                      <p className="mt-1 text-sm font-black text-[#E06A3B]">{money(item.price)}/day</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <StepLabel number="2" label="Meal Time" darkMode={darkMode} />
            {/* Uiverse.io by oneMoreYeti "palette" hover — each segment is flex-1 and grows on
                hover instead of a flat color swap, since these three are a fixed, evenly-sized
                set (a good structural match, unlike a variable-length scrollable chip row). */}
            <div className="flex gap-3 overflow-hidden rounded-2xl">
              {["Breakfast", "Lunch", "Dinner"].map((type) => (
                <button
                  key={type}
                  onClick={() => setMealType(type)}
                  className={`flex-1 rounded-2xl border px-3 py-3 text-[11px] font-black uppercase tracking-wider transition-all duration-300 hover:flex-[1.6] active:scale-95 ${
                    mealType === type ? "border-[#E06A3B] bg-[#E06A3B1A] text-[#E06A3B]" : darkMode ? "border-white/10 text-white/60" : "border-gold-100 text-stone-500"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div>
            <StepLabel number="3" label="Select Plan" darkMode={darkMode} />
            <div className="grid grid-cols-2 gap-3">
              {MEAL_PASS_PLANS.map((plan) => {
                const planTotal = selectedItem ? Math.round(Number(selectedItem.price || 0) * plan.meals * plan.priceMultiplier) : null;
                const savings = selectedItem ? Math.round(Number(selectedItem.price || 0) * plan.meals * (1 - plan.priceMultiplier)) : 0;
                // Not a fabricated "Most Popular" claim — computed from each plan's own real
                // priceMultiplier, so it always correctly points at whichever tier is genuinely
                // the cheapest per meal, even if the plans list changes later.
                const isBestValue = plan.priceMultiplier === Math.min(...MEAL_PASS_PLANS.map((p) => p.priceMultiplier));
                return (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`relative rounded-2xl border p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98] ${
                      selectedPlan === plan.id
                        ? "border-[#E06A3B] bg-[#E06A3B1A] ring-2 ring-[#E06A3B]/30"
                        : isBestValue
                        ? `border-[#E06A3B]/50 ${darkMode ? "bg-white/5" : "bg-white"}`
                        : darkMode ? "border-white/10 bg-white/5" : "border-gold-100 bg-white"
                    }`}
                  >
                    {isBestValue && selectedPlan !== plan.id && (
                      <span className="absolute -top-2 left-3 rounded-full bg-[color:var(--color-primary)] px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-[color:var(--color-bg-deep)]">Best Value</span>
                    )}
                    <span className="absolute right-3 top-3 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest" style={{ backgroundColor: `${plan.color}20`, color: plan.color }}>{plan.badge}</span>
                    <p className="pr-16 text-sm font-black">{plan.label}</p>
                    <p className={`mt-1 text-[11px] ${darkMode ? "text-white/55" : "text-stone-500"}`}>{plan.meals} meals - {plan.days} days</p>
                    <p className="mt-4 text-2xl font-black" style={{ color: plan.color }}>{planTotal ? money(planTotal) : "Pick item"}</p>
                    {savings > 0 && <p className="mt-1 text-[10px] font-black text-[#E06A3B]">Save {money(savings)}</p>}
                  </button>
                );
              })}
            </div>
          </div>

          {purchasePlan && selectedItem && (
            <div className={`rounded-3xl border p-5 ${darkMode ? "bg-white/5 border-white/10" : "bg-gold-50/70 border-gold-100"}`}>
              <div className="mb-4 grid gap-2 text-sm">
                <SummaryRow label="Item" value={selectedItem.name} darkMode={darkMode} />
                <SummaryRow label="Plan" value={purchasePlan.label} darkMode={darkMode} />
                <SummaryRow label="Meal Time" value={mealType} darkMode={darkMode} />
                <SummaryRow label="Total" value={money(totalAmount)} darkMode={darkMode} strong />
              </div>
              <button disabled={isPurchasing} onClick={handlePurchasePass} className="w-full rounded-2xl bg-[color:var(--color-primary)] px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-[color:var(--color-bg-deep)] shadow-lg transition hover:bg-[color:var(--color-primary-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                {isPurchasing ? "Opening Payment..." : `Pay ${money(totalAmount)} and Activate`}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
