import { money, itemImage, itemEmoji, stallDisplayName } from "../UserMenu/helpers.js";
import { RESPONSE_TYPE, ACTION_TYPE } from "../../assistant/types.js";

const ratingStars = (item) =>
  item.rating != null ? `★ ${Number(item.rating).toFixed(1)}` : null;

function MacroLine({ nutrition, compact = false }) {
  if (!nutrition) return null;
  const cal = Math.round(nutrition.calories || 0);
  const protein = Math.round(nutrition.protein || 0);
  const carbs = Math.round(nutrition.carbs || 0);
  const fat = Math.round(nutrition.fat || 0);
  if (compact) {
    return (
      <p className="fa-macros">
        <span>{nutrition.estimated ? "~" : ""}{cal} kcal</span>
        <span aria-hidden="true">·</span>
        <span>{protein}g protein</span>
        {nutrition.estimated && <span className="fa-est-chip">est.</span>}
      </p>
    );
  }
  return (
    <p className="fa-macros fa-macros-full">
      <span>{nutrition.estimated ? "~" : ""}{cal} kcal</span>
      <span>· {protein}g protein</span>
      <span>· {carbs}g carbs</span>
      <span>· {fat}g fat</span>
      {nutrition.estimated && <span className="fa-est-chip">est.</span>}
    </p>
  );
}

function FoodVisual({ item }) {
  const src = itemImage(item);
  const emoji = itemEmoji(item);
  if (src) {
    return <img className="fa-food-img" src={src} alt="" loading="lazy" />;
  }
  return (
    <span className="fa-food-emoji" role="img" aria-label={item.name}>
      {emoji}
    </span>
  );
}

/**
 * A single food item card inside assistant results. Add is offered per item when the app is
 * interactive (stall open & not busy); availability always reflects live data.
 */
export function FoodItemCard({ item, onAdd, interactive = true, showQuantity = false }) {
  const unavailable = item.available === false;
  const tags = [
    item.originalPrice != null && Number(item.originalPrice) > Number(item.price) ? "deal" : null,
    item.nutrition?.vegetarian ? "veg" : null,
  ].filter(Boolean);

  return (
    <article className={`fa-card ${unavailable ? "fa-card-muted" : ""}`} aria-label={item.name}>
      <div className="fa-food">
        <div className="fa-food-visual">
          <FoodVisual item={item} />
          {item.nutrition?.vegetarian && <span className="fa-veg-dot" aria-label="Vegetarian" />}
        </div>
        <div className="fa-food-body">
          <div className="fa-food-head">
            <h4 className="fa-food-name">{item.name}</h4>
            {tags.map((tag) => (
              <span key={tag} className={`fa-tag fa-tag-${tag}`}>{tag}</span>
            ))}
          </div>
          <p className="fa-food-shop">{stallDisplayName(item.shop)}</p>
          {item.reason && <p className="fa-reason">{item.reason}</p>}
          <MacroLine nutrition={item.nutrition} compact />
        </div>
      </div>
      <div className="fa-food-foot">
        <p className="fa-price">
          <strong>{money(item.price)}</strong>
          {item.originalPrice != null && Number(item.originalPrice) > Number(item.price) && (
            <s className="fa-price-old">{money(item.originalPrice)}</s>
          )}
          {ratingStars(item) && <span className="fa-rating">{ratingStars(item)}</span>}
        </p>
        {showQuantity && item.quantity > 1 && <span className="fa-qty">×{item.quantity}</span>}
        {unavailable ? (
          <span className="fa-chip-muted">Unavailable</span>
        ) : (
          onAdd && (
            <button type="button" className="fa-btn fa-btn-primary" onClick={() => onAdd(item)} disabled={!interactive}>
              Add {showQuantity && item.quantity > 1 ? `${item.quantity}` : ""}
            </button>
          )
        )}
      </div>
    </article>
  );
}

/** Food comparison table — cleanest way to read three foods side by side. */
export function FoodComparisonCard({ items, summary }) {
  return (
    <div className="fa-card">
      <div className="fa-compare-grid">
        {items.map((item) => (
          <div key={item.id} className="fa-compare-col">
            <div className="fa-food-visual fa-compare-visual">
              <FoodVisual item={item} />
            </div>
            <p className="fa-compare-name">{item.name}</p>
            <p className="fa-price"><strong>{money(item.price)}</strong></p>
            <dl className="fa-compare-macros">
              <div><dt>Calories</dt><dd>{item.nutrition.estimated ? "~" : ""}{Math.round(item.nutrition.calories)}</dd></div>
              <div><dt>Protein</dt><dd>{Math.round(item.nutrition.protein)}g</dd></div>
              <div><dt>Carbs</dt><dd>{Math.round(item.nutrition.carbs)}g</dd></div>
              <div><dt>Fat</dt><dd>{Math.round(item.nutrition.fat)}g</dd></div>
            </dl>
          </div>
        ))}
      </div>
      {summary && (
        <ul className="fa-compare-summary">
          {summary.byProtein && <li><strong>Most protein:</strong> {summary.byProtein}</li>}
          {summary.byCalories && <li><strong>Fewest calories:</strong> {summary.byCalories}</li>}
          {summary.cheapest && <li><strong>Cheapest:</strong> {summary.cheapest}</li>}
        </ul>
      )}
    </div>
  );
}

/** Meal plan built within a budget, with one-tap "add all". */
export function MealPlanCard({ plan, onConfirm, interactive = true }) {
  if (!plan || plan.items.length === 0) return null;
  return (
    <div className="fa-card">
      <p className="fa-plan-line">
        {plan.items.map((item) => `${item.quantity}× ${item.name}`).join(" + ")}
      </p>
      <MacroLine nutrition={{ calories: plan.totalCalories, protein: plan.totalProtein, carbs: 0, fat: 0, estimated: true }} compact />
      <div className="fa-food-foot">
        <p className="fa-price"><strong>{money(plan.total)}</strong></p>
        <button
          type="button"
          className="fa-btn fa-btn-primary"
          onClick={() => onConfirm?.({ type: ACTION_TYPE.ADD_ITEMS, items: plan.items.map((item) => ({ productId: item.id, quantity: item.quantity, product: item })), label: "Add all to cart" })}
          disabled={!interactive}
        >
          Add all to cart
        </button>
      </div>
    </div>
  );
}

/** Cart summary with macros — mirrors the real cart the client sent. */
export function CartSummaryCard({ summary, onOpenCart }) {
  if (!summary) return null;
  if (summary.empty || summary.lines.length === 0) {
    return (
      <div className="fa-card fa-card-ghost">
        <p>Your cart is empty — ask me for suggestions or add something you like.</p>
      </div>
    );
  }
  return (
    <div className="fa-card">
      <ul className="fa-cart-lines">
        {summary.lines.map((line) => (
          <li key={line.id}>
            <span className="fa-cart-name">{line.quantity > 1 ? `${line.quantity}× ` : ""}{line.name}</span>
            <span className="fa-cart-sub">{Math.round(line.nutrition.calories)} kcal · {Math.round(line.nutrition.protein)}g protein</span>
            <span className="fa-cart-price">{money(line.price * line.quantity)}</span>
          </li>
        ))}
      </ul>
      <MacroLine nutrition={summary.nutrition} compact />
      <div className="fa-food-foot">
        <p className="fa-price"><strong>{money(summary.total)}</strong> <span className="fa-muted">· {summary.itemCount} items</span></p>
        {onOpenCart && (
          <button type="button" className="fa-btn fa-btn-secondary" onClick={onOpenCart}>
            Open cart
          </button>
        )}
      </div>
    </div>
  );
}

/** Single-item nutrition result with an add action. */
export function NutritionCard({ item, focus }) {
  if (!item) return null;
  return (
    <div className="fa-card">
      <div className="fa-food">
        <div className="fa-food-visual"><FoodVisual item={item} /></div>
        <div className="fa-food-body">
          <h4 className="fa-food-name">{item.name}</h4>
          <p className="fa-food-shop">{stallDisplayName(item.shop)} · {money(item.price)}</p>
          {item.reason && <p className="fa-reason">{item.reason}</p>}
        </div>
      </div>
      <MacroLine nutrition={item.nutrition} />
      {item.nutrition.vegetarian && item.nutrition.vegan && <p className="fa-tag-line">Vegan</p>}
      {item.nutrition.vegetarian && !item.nutrition.vegan && <p className="fa-tag-line">Vegetarian</p>}
      {focus === "protein" && item.nutrition.protein >= 15 && <p className="fa-tag-line">High protein</p>}
    </div>
  );
}

/** Confirmation bubble with a single confirmed action + cancel. */
export function ConfirmationCard({ message, onConfirm, onCancel, interactive = true }) {
  const [action] = message.actions || [];
  const done = message.status === "confirmed";
  const cancelled = message.status === "cancelled";
  if (done) {
    return <p className="fa-confirm-note">Done ✓</p>;
  }
  if (cancelled) {
    return <p className="fa-confirm-note">Skipped — nothing was changed.</p>;
  }
  if (!action) return null;
  return (
    <div className="fa-card fa-card-actions">
      {message.data?.summary && <p className="fa-plan-line">{message.data.summary}</p>}
      <div className="fa-btn-row">
        <button type="button" className="fa-btn fa-btn-primary" onClick={() => onConfirm(action)} disabled={!interactive}>
          Yes, {action.label?.toLowerCase().startsWith("add") ? "add it" : action.label?.toLowerCase() || "apply"}
        </button>
        <button type="button" className="fa-btn fa-btn-ghost" onClick={onCancel}>
          No, cancel
        </button>
      </div>
    </div>
  );
}

/** Ambiguity resolution: "Which one did you mean?" with tap-to-pick options. */
export function ClarificationCard({ message, onPick, interactive = true }) {
  const options = message.data?.options || [];
  if (options.length === 0) return null;
  return (
    <div className="fa-card">
      <p className="fa-kicker">Which one?</p>
      <ul className="fa-clarify">
        {options.map((item) => (
          <li key={item.id}>
            <button type="button" className="fa-clarify-opt" onClick={() => onPick(item.id)} disabled={!interactive}>
              <span className="fa-food-visual fa-clarify-visual"><FoodVisual item={item} /></span>
              <span className="fa-clarify-body">
                <span className="fa-food-name">{item.name}</span>
                <span className="fa-clarify-sub">{stallDisplayName(item.shop)} · {money(item.price)}</span>
              </span>
              <span className="fa-clarify-arrow" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Map an assistant response to the right card component. */
export function AssistantResponseCard({ message, onAdd, onConfirm, onCancel, onPick, onOpenCart, interactive }) {
  switch (message.type) {
    case RESPONSE_TYPE.FOOD_LIST:
    case RESPONSE_TYPE.RECOMMENDATION_LIST:
      return (
        <div className="fa-list">
          {(message.data?.items || []).map((item) => (
            <FoodItemCard key={item.id} item={item} onAdd={onAdd} interactive={interactive} showQuantity />
          ))}
        </div>
      );
    case RESPONSE_TYPE.FOOD_COMPARISON:
      return <FoodComparisonCard items={message.data?.items || []} summary={message.data?.summary} />;
    case RESPONSE_TYPE.MEAL_PLAN:
      return <MealPlanCard plan={message.data} onConfirm={onConfirm} interactive={interactive} />;
    case RESPONSE_TYPE.CART_SUMMARY:
      return <CartSummaryCard summary={message.data} onOpenCart={onOpenCart} />;
    case RESPONSE_TYPE.NUTRITION_RESULT:
      return <NutritionCard item={message.data?.item} focus={message.data?.focus} />;
    case RESPONSE_TYPE.CONFIRMATION:
      return <ConfirmationCard message={message} onConfirm={onConfirm} onCancel={onCancel} interactive={interactive} />;
    case RESPONSE_TYPE.CLARIFICATION:
      return <ClarificationCard message={message} onPick={onPick} interactive={interactive} />;
    default:
      return null;
  }
}
