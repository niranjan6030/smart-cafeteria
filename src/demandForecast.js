// Seasonal EWMA demand forecasting per (day-type x hour-of-day) bucket, with a linear-trend
// adjustment and a walk-forward-backtested accuracy report. No ML backend required — this is
// classical demand-planning statistics (seasonal decomposition + exponential smoothing), chosen
// over full Holt-Winters because it stays stable on the sparse, noisy order history a real
// college canteen has in its early months.

const ALPHA = 0.35; // EWMA smoothing factor
const MIN_TOTAL_ORDERS_FOR_CONFIDENCE = 10;
const TREND_WINDOW_DAYS = 14;
const TREND_CLAMP_MIN = 0.5;
const TREND_CLAMP_MAX = 2.0;
const NOMINAL_COLD_START_PEAK = 2; // placeholder peak-hour order count when there's zero history at all

// Generic canteen meal-time relative-demand curve, used only for cold-start buckets.
const MEAL_CURVE = [
  0.05, 0.03, 0.02, 0.02, 0.02, 0.05, // 0-5   overnight
  0.15, 0.45, 0.6, 0.35, 0.25, 0.5, // 6-11  breakfast ramp
  1.0, 0.9, 0.5, 0.3, 0.35, 0.5, // 12-17 lunch peak + afternoon lull
  0.65, 0.85, 0.7, 0.4, 0.2, 0.1, // 18-23 dinner peak, winding down
];
const MEAL_CURVE_SUM = MEAL_CURVE.reduce((sum, v) => sum + v, 0);

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.toMillis === "function") return new Date(value.toMillis());
  if (typeof value === "number") return new Date(value);
  return null;
}

const dateKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const dayType = (date) => ([0, 6].includes(date.getDay()) ? "weekend" : "weekday");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function bucketKeyFor(date) {
  return `${dayType(date)}-${date.getHours()}`;
}

// Walk chronologically through a bucket's per-day counts, EWMA-smoothing as we go and recording
// the (prediction-before-seeing-this-point) vs (actual) error at each step for backtesting.
function ewmaWithBacktest(counts) {
  if (counts.length === 0) return { level: null, errors: [] };
  let level = counts[0];
  const errors = [];
  for (let i = 1; i < counts.length; i++) {
    errors.push(Math.abs(counts[i] - level));
    level = ALPHA * counts[i] + (1 - ALPHA) * level;
  }
  return { level, errors };
}

function linearRegressionSlope(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, avg: values[0] || 0 };
  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = values.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * values[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { slope, avg: sumY / n };
}

/**
 * @param {Array} orders - raw order docs for one stall (needs `created_at`)
 * @param {number} horizonHours - how many hours ahead to forecast (default 3)
 * @param {Date} now - reference "current" time (injectable for testing)
 */
export function computeDemandForecast({ orders = [], horizonHours = 3, now = new Date() }) {
  const orderDates = orders.map((o) => toJsDate(o.created_at)).filter(Boolean);

  if (orderDates.length === 0) {
    return buildColdStartOnlyResult({ horizonHours, now });
  }

  // Build the full inclusive calendar-day range so hours with zero orders on a given day are
  // counted as real zero observations, not silently skipped (which would bias EWMA upward).
  const earliest = new Date(Math.min(...orderDates.map((d) => d.getTime())));
  const rangeStart = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // countsByDateHour: "dateKey|hour" -> count
  const countsByDateHour = new Map();
  const dailyTotals = new Map(); // dateKey -> total orders that day
  orderDates.forEach((d) => {
    const dk = dateKey(d);
    const key = `${dk}|${d.getHours()}`;
    countsByDateHour.set(key, (countsByDateHour.get(key) || 0) + 1);
    dailyTotals.set(dk, (dailyTotals.get(dk) || 0) + 1);
  });

  // Walk every calendar day in range, grouping per (dayType, hour) bucket.
  const bucketSeries = new Map(); // bucketKey -> ordered counts[]
  const dayTypeDailyTotals = { weekday: [], weekend: [] };
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const dk = dateKey(d);
    const dt = dayType(d);
    dayTypeDailyTotals[dt].push(dailyTotals.get(dk) || 0);
    for (let hour = 0; hour < 24; hour++) {
      const key = `${dt}-${hour}`;
      const count = countsByDateHour.get(`${dk}|${hour}`) || 0;
      if (!bucketSeries.has(key)) bucketSeries.set(key, []);
      bucketSeries.get(key).push(count);
    }
  }

  const bucketModels = new Map();
  const allErrors = [];
  bucketSeries.forEach((counts, key) => {
    const { level, errors } = ewmaWithBacktest(counts);
    // A bucket only counts as cold-start when this (day-type, hour) has never actually occurred
    // yet (e.g. no weekend day in range yet). Even a single observed day seeds a real EWMA level,
    // which is more informative than the generic fallback curve.
    bucketModels.set(key, { level, sampleCount: counts.length, isColdStart: counts.length === 0 });
    allErrors.push(...errors);
  });

  const totalOrders = orderDates.length;
  const overallAvgDemand = totalOrders / Math.max(1, [...dailyTotals.values()].length);
  const mae = allErrors.length ? allErrors.reduce((s, e) => s + e, 0) / allErrors.length : null;
  const relativeError = mae != null ? mae / Math.max(overallAvgDemand, 0.5) : null;
  const confidenceLabel =
    allErrors.length < 5 || totalOrders < MIN_TOTAL_ORDERS_FOR_CONFIDENCE
      ? "Low"
      : relativeError < 0.5
      ? "High"
      : relativeError < 1
      ? "Moderate"
      : "Low";

  // Trend: linear regression over the last TREND_WINDOW_DAYS of total daily orders.
  const sortedDailyTotals = [...dailyTotals.entries()]
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .slice(-TREND_WINDOW_DAYS)
    .map(([, count]) => count);
  const { slope, avg: avgDailyTotal } = linearRegressionSlope(sortedDailyTotals);
  const trendFactor = clamp(1 + slope / Math.max(avgDailyTotal, 1), TREND_CLAMP_MIN, TREND_CLAMP_MAX);

  const fallbackDailyAvg = (dt) => {
    const values = dayTypeDailyTotals[dt];
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    return avg > 0 ? avg : MEAL_CURVE_SUM; // ~1/hour placeholder scale when there's truly no data
  };

  const predictHour = (date) => {
    const key = bucketKeyFor(date);
    const dt = dayType(date);
    const model = bucketModels.get(key);
    if (!model || model.isColdStart) {
      const scale = fallbackDailyAvg(dt) / MEAL_CURVE_SUM;
      return { predictedOrders: Math.max(0, Math.round(MEAL_CURVE[date.getHours()] * scale)), isColdStart: true };
    }
    return { predictedOrders: Math.max(0, Math.round(model.level * trendFactor)), isColdStart: false };
  };

  const hourlyForecast = [];
  for (let i = 1; i <= horizonHours; i++) {
    const target = new Date(now.getTime() + i * 3600000);
    const { predictedOrders, isColdStart } = predictHour(target);
    hourlyForecast.push({ hour: target.getHours(), dayType: dayType(target), predictedOrders, isColdStart });
  }

  const quietestHour = findQuietestHour(predictHour, now);

  return {
    hourlyForecast,
    next1h: hourlyForecast[0]?.predictedOrders ?? 0,
    next2h: hourlyForecast.slice(0, 2).reduce((s, h) => s + h.predictedOrders, 0),
    next3h: hourlyForecast.slice(0, 3).reduce((s, h) => s + h.predictedOrders, 0),
    modelAccuracy: { mae, sampleCount: allErrors.length, confidenceLabel },
    isColdStart: totalOrders < MIN_TOTAL_ORDERS_FOR_CONFIDENCE,
    quietestHour,
  };
}

function findQuietestHour(predictHour, now) {
  const candidates = [];
  for (let h = now.getHours() + 1; h < 24; h++) {
    const target = new Date(now);
    target.setHours(h, 0, 0, 0);
    candidates.push(target);
  }
  if (candidates.length === 0) {
    for (let h = 0; h < 24; h++) {
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(h, 0, 0, 0);
      candidates.push(target);
    }
  }
  let best = null;
  candidates.forEach((target) => {
    const { predictedOrders } = predictHour(target);
    if (!best || predictedOrders < best.predictedOrders) {
      best = { hour: target.getHours(), predictedOrders, isTomorrow: target.getDate() !== now.getDate() };
    }
  });
  return best;
}

function buildColdStartOnlyResult({ horizonHours, now }) {
  // No data at all — show the generic meal-curve shape scaled to a small nominal peak, so the UI
  // demonstrates the expected daily pattern instead of flatlining at zero everywhere.
  const predictHour = (date) => ({
    predictedOrders: Math.max(0, Math.round(MEAL_CURVE[date.getHours()] * NOMINAL_COLD_START_PEAK)),
    isColdStart: true,
  });
  const hourlyForecast = [];
  for (let i = 1; i <= horizonHours; i++) {
    const target = new Date(now.getTime() + i * 3600000);
    hourlyForecast.push({ hour: target.getHours(), dayType: dayType(target), ...predictHour(target) });
  }
  return {
    hourlyForecast,
    next1h: hourlyForecast[0]?.predictedOrders ?? 0,
    next2h: hourlyForecast.slice(0, 2).reduce((s, h) => s + h.predictedOrders, 0),
    next3h: hourlyForecast.slice(0, 3).reduce((s, h) => s + h.predictedOrders, 0),
    modelAccuracy: { mae: null, sampleCount: 0, confidenceLabel: "Low" },
    isColdStart: true,
    quietestHour: findQuietestHour(predictHour, now),
  };
}

export function formatHourLabel(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}
