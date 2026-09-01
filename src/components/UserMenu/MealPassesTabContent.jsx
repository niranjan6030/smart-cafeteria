import GuestFallbackCard from "./GuestFallbackCard";
import MealPassCallout from "./MealPassCallout";
import { stallDisplayName } from "./helpers";

// ─── Meal Passes Tab ──────────────────────────────────────────────────────────
export default function MealPassesTabContent({ user, activeShop, activePassForShop, setShowMealPassModal, setShowLoginModal }) {
  if (!user) {
    return (
      <GuestFallbackCard
        title="Unlock Your Personal Digital Wallet"
        subtitle="Log in to manage your recurring daily thali subscriptions, claim meal passes at the counter, and track your monthly campus budget spending details instantly."
        onLoginClick={() => setShowLoginModal(true)}
      />
    );
  }

  return (
    <div>
      <div className="mb-6">
        <p className="cc-kicker mb-2">Meal Passes</p>
        <h2 className="text-3xl font-extrabold tracking-tight">{stallDisplayName(activeShop)}</h2>
      </div>
      <MealPassCallout
        activePassForShop={activePassForShop}
        onManage={() => setShowMealPassModal(true)}
        activeClassName="mb-6"
      />
    </div>
  );
}
