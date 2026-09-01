import { computeDemandForecast } from "./demandForecast";

// ─── Kitchen Analytics: real-data peak / crowd / forecast engine ────────────
// All numbers below are derived from this stall's REAL Firestore order history (the
// `created_at` server timestamps already streamed into the terminal). Nothing is invented,
// hardcoded, or random.
//
// METHODOLOGY (mirrored in the dashboard "Methodology" panel):
//
// DATA SPLIT
//   Orders from the in-progress calendar day are LIVE; everything earlier is HISTORY. Historical
//   averages never include the partial current day, so a half-finished day cannot skew them.
//
// 1) PEAK ANALYSIS — descriptive statistics, no model.
//    Real orders are aggregated into hour-of-day and day-of-week buckets, zero-filled so quiet
//    hours count as genuine zero observations. "Typical peak hour" = the highest AVERAGE
//    orders/hour, so one giant day can't manufacture a peak; totals are reported alongside.
//
// 2) CROWD / WORKLOAD — data-driven thresholds, not arbitrary bands.
//    Every (date, hour) in history is one sample of "orders placed in that hour". Level bands
//    are percentiles of that hour's OWN historical distribution (falling back to the overall
//    open-hour distribution when an hour has fewer than 3 samples):
//        < P50           → LOW
//        P50 – P75       → MODERATE
//        P75 – P90       → HIGH
//        > P90           → VERY HIGH
//    The current hour is still in progress, so those full-hour thresholds are scaled by the
//    fraction of the hour already elapsed — "are we on track to be crowded?", not a misleading
//    raw partial-hour count.
//
// 3) FORECAST — seasonal EWMA vs seasonal-average baseline, walk-forward validated.
//    Two candidate predictors for each (day-type × hour-of-day) bucket. Both are fed only data
//    observed BEFORE the point being predicted (strictly time-ordered walk-forward — no
//    shuffling, no future leakage):
//        baseline  — running mean of earlier observations in the same bucket
//        model     — exponential smoothing (α = 0.35) of the same bucket (the existing
//                    demandForecast.js seasonal-EWMA model)
//    MAE is accumulated over every walk-forward step of every bucket. The predictor with the
//    lower MAE is selected; if smoothing does not beat the baseline, the baseline is used and
//    the UI says so explicitly. A "likely range" (±1σ of that hour's historical spread) is
//    shown when the hour has ≥3 samples, and is never implied to be a guaranteed interval.
//
// 4) DATA SUFFICIENCY
//    Fewer than 3 distinct historical days → descriptive counts only, forecasts and peak claims
//    suppressed ("Insufficient historical data"). Below FORECAST_MIN_ORDERS total orders →
//    forecasts exist but are flagged as low-confidence estimates.

const OPEN_HOUR_START = 7; // cafeteria opens 7:00 AM
const OPEN_HOUR_END = 22; // ... and closes at 10:00 PM (hour 22 itself is closed)
const FORECAST_MIN_ORDERS = 10;
const STATS_MIN_HISTORY_DAYS = 3;
const EWMA_HORIZON_HOURS = 16; // horizon wide enough to cover every remaining open hour today
const DISPLAY_HORIZON_HOURS = 6; // length of the "actual vs predicted" forecast chart
const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // ignore timestamps more than 5 min ahead of "now"
const MIN_BUCKET_SAMPLES = 3;

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_OF_WEEK = WEEKDAY_LABELS.map((label, day) => ({ day, label }));

// Meal-period boundaries are CONFIG (labels for grouping), not predictions. The period that
// actually dominates is computed from the data and reported separately.
const MEAL_PERIODS = [
  { key: "breakfast", label: "Breakfast", rangeLabel: "7:00 AM – 11:00 AM", start: 7, end: 11 },
  { key: "lunch", label: "Lunch", rangeLabel: "11:00 AM – 3:00 PM", start: 11, end: 15 },
  { key: "snacks", label: "Evening Snacks", rangeLabel: "3:00 PM – 6:00 PM", start: 15, end: 18 },
  { key: "dinner", label: "Dinner", rangeLabel: "6:00 PM – 10:00 PM", start: 18, end: 22 },
];

const WORKLOAD_LEVELS = [
  { level: "LOW", threshold: (v, t) => v < t.p50, label: "LOW" },
  { level: "MODERATE", threshold: (v, t) => v < t.p75, label: "MODERATE" },
  { level: "HIGH", threshold: (v, t) => v < t.p90, label: "HIGH" },
  { level: "VERY_HIGH", threshold: () => true, label: "VERY HIGH" },
];

// ─── Time helpers ───────────────────────────────────────────────────────────
function toMs(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function format12Hour(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour >= 12 ? "PM" : "AM"}`;
}

export function hourRangeLabel(hour) {
  return `${format12Hour(hour)} – ${format12Hour((hour + 1) % 24)}`;
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const dayType = (date) => ([0, 6].includes(date.getDay()) ? "weekend" : "weekday");
const bucketKeyFor = (date) => `${dayType(date)}-${date.getHours()}`;
const isOpenHour = (hour) => hour >= OPEN_HOUR_START && hour < OPEN_HOUR_END;
const mealPeriodKey = (hour) => {
  const period = MEAL_PERIODS.find((p) => hour >= p.start && hour < p.end);
  return period ? period.key : "offHours";
};

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function mean(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

// ─── Core entry point ───────────────────────────────────────────────────────
/**
 * @param {Array} orders - raw order docs for one stall (needs `created_at`)
 * @param {Date} now - reference "current" time (injectable for testing)
 */
export function computeKitchenAnalytics({ orders = [], now = new Date() }) {
  const nowMs = now.getTime();
  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const currentHour = now.getHours();

  // ── Partition real orders into HISTORY (before today) and LIVE (today so far). ──
  // `liveOrders` keeps the full order docs so operational summaries (today's sales, wait times,
  // item demand) can be derived from the same real data instead of a separate fake dataset.
  const historyMs = [];
  const liveOrders = [];
  orders.forEach((order) => {
    const ms = toMs(order.created_at);
    if (ms == null || ms > nowMs + FUTURE_SKEW_TOLERANCE_MS) return;
    if (ms >= todayStartMs) liveOrders.push(order);
    else historyMs.push(ms);
  });

  const allMs = [...historyMs, ...liveOrders.map((order) => toMs(order.created_at))];
  const totalOrders = allMs.length;
  const liveOrdersToday = liveOrders.length;

  // Counts used by every aggregation below.
  const countsByDateHour = new Map(); // `${dateKey}|${hour}` -> count (ALL orders)
  const dailyTotals = new Map(); // dateKey -> total (ALL orders)
  const historicalDays = new Set(); // dateKeys strictly before today
  allMs.forEach((ms) => {
    const d = new Date(ms);
    const dk = dateKey(d);
    const hour = d.getHours();
    countsByDateHour.set(`${dk}|${hour}`, (countsByDateHour.get(`${dk}|${hour}`) || 0) + 1);
    dailyTotals.set(dk, (dailyTotals.get(dk) || 0) + 1);
    if (ms < todayStartMs) historicalDays.add(dk);
  });
  const daysCovered = historicalDays.size;

  const liveHourlyCount = new Array(24).fill(0);
  liveOrders.forEach((order) => {
    liveHourlyCount[new Date(toMs(order.created_at)).getHours()] += 1;
  });

  const status =
    totalOrders === 0
      ? "no_data"
      : daysCovered < STATS_MIN_HISTORY_DAYS
      ? "insufficient_data"
      : "ready";
  const forecastEnabled = totalOrders >= FORECAST_MIN_ORDERS;

  // ── 1) Historical aggregation (zero-filled per day). ──
  const hourSamples = Array.from({ length: 24 }, () => []);
  const weekdayHourTotals = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const weekdayOccurrences = new Array(7).fill(0);
  const weekdayTotals = new Array(7).fill(0);
  const mealPeriodTotals = { breakfast: 0, lunch: 0, snacks: 0, dinner: 0, offHours: 0 };
  let totalHistory = 0;

  const sortedHistoryDays = [...historicalDays].sort();
  sortedHistoryDays.forEach((dk) => {
    const [y, m, d] = dk.split("-").map(Number);
    const weekday = new Date(y, m, d).getDay();
    weekdayOccurrences[weekday] += 1;
    for (let hour = 0; hour < 24; hour++) {
      const count = countsByDateHour.get(`${dk}|${hour}`) || 0;
      hourSamples[hour].push(count);
      weekdayHourTotals[weekday][hour] += count;
      weekdayTotals[weekday] += count;
      mealPeriodTotals[mealPeriodKey(hour)] += count;
      totalHistory += count;
    }
  });

  const ordersByHour = hourSamples.map((samples, hour) => ({
    hour,
    label: hourRangeLabel(hour),
    total: samples.reduce((s, c) => s + c, 0),
    avg: daysCovered ? samples.reduce((s, c) => s + c, 0) / daysCovered : 0,
    max: Math.max(0, ...samples),
  }));

  const ordersByWeekday = DAYS_OF_WEEK.map(({ day, label }) => ({
    day,
    label,
    total: weekdayTotals[day],
    avg: weekdayOccurrences[day] ? weekdayTotals[day] / weekdayOccurrences[day] : 0,
    days: weekdayOccurrences[day],
  }));

  const ordersByMealPeriod = MEAL_PERIODS.map((period) => ({
    key: period.key,
    label: period.label,
    rangeLabel: period.rangeLabel,
    total: mealPeriodTotals[period.key],
    avgPerDay: daysCovered ? mealPeriodTotals[period.key] / daysCovered : 0,
  }));
  ordersByMealPeriod.push({
    key: "offHours",
    label: "Off-hours",
    rangeLabel: "10:00 PM – 7:00 AM",
    total: mealPeriodTotals.offHours,
    avgPerDay: daysCovered ? mealPeriodTotals.offHours / daysCovered : 0,
  });

  const heatmap = DAYS_OF_WEEK.map(({ day, label }) => ({
    day,
    label,
    hours: weekdayHourTotals[day].map((total, hour) => ({
      hour,
      total,
      avg: weekdayOccurrences[day] ? total / weekdayOccurrences[day] : 0,
    })),
  }));

  const openSamples = [];
  for (let hour = OPEN_HOUR_START; hour < OPEN_HOUR_END; hour++) openSamples.push(...hourSamples[hour]);
  const sortedOpenSamples = [...openSamples].sort((a, b) => a - b);

  const peakHourByAvg = pickBest(ordersByHour, (o) => o.avg, OPEN_HOUR_START);
  const peakHourByTotal = pickBest(ordersByHour, (o) => o.total, OPEN_HOUR_START);
  const peakDayByAvg = pickBest(ordersByWeekday, (o) => o.avg, 0);
  const peakMealPeriod = pickBest(ordersByMealPeriod, (o) => o.avgPerDay, 0);

  const todayWeekday = now.getDay();
  const todayPeakFact = weekdayOccurrences[todayWeekday]
    ? pickBest(
        heatmap[todayWeekday].hours.map((cell, hour) => ({ hour, label: hourRangeLabel(hour), avg: cell.avg })),
        (o) => o.avg,
        OPEN_HOUR_START
      )
    : null;

  // ── 2) Workload percentiles. ──
  const globalPercentiles = {
    p50: percentile(sortedOpenSamples, 0.5),
    p75: percentile(sortedOpenSamples, 0.75),
    p90: percentile(sortedOpenSamples, 0.9),
  };

  const bucketPercentiles = (samples) => {
    if (samples.length < MIN_BUCKET_SAMPLES) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
    };
  };

  const currentBucket = bucketPercentiles(hourSamples[currentHour]) || globalPercentiles;
  const currentThresholdMethod = bucketPercentiles(hourSamples[currentHour])
    ? "hour-bucket"
    : "global-open-hours";
  const elapsed = Math.min(1, Math.max(0, now.getMinutes() / 60));
  const currentOrdersThisHour = liveHourlyCount[currentHour];
  const scaledCurrentThresholds = {
    p50: currentBucket.p50 * elapsed,
    p75: currentBucket.p75 * elapsed,
    p90: currentBucket.p90 * elapsed,
  };
  const currentWorkloadLevel = isOpenHour(currentHour)
    ? classifyWorkload(currentOrdersThisHour, scaledCurrentThresholds)
    : { level: "LOW", label: "LOW", closedHours: true };
  const expectedFullHour = Math.round(currentBucket.p50);
  const expectedSoFar = Math.round(currentBucket.p50 * elapsed);
  const deltaPct =
    expectedSoFar > 0
      ? Math.round(((currentOrdersThisHour - expectedSoFar) / expectedSoFar) * 100)
      : currentOrdersThisHour > 0
      ? null
      : 0;

  const nextHourDate = new Date(now.getTime() + 3600000);
  const nextHour = nextHourDate.getHours();

  // ── 3) Forecast: build bucket series once, reuse for baseline backtest + averages. ──
  const bucketSeries = buildBucketSeries(countsByDateHour, dailyTotals, now);
  const baselineMae = computeSeasonalAverageMae(bucketSeries);
  const demandForecast = computeDemandForecast({ orders, horizonHours: EWMA_HORIZON_HOURS, now });
  const modelMae = demandForecast.modelAccuracy.mae;

  let method = "seasonal-average";
  if (modelMae != null && (baselineMae == null || modelMae <= baselineMae)) method = "seasonal-ewma";
  const chosenMae = method === "seasonal-ewma" ? modelMae : baselineMae;

  const overallOpenHourAvg = totalHistory / Math.max(1, (OPEN_HOUR_END - OPEN_HOUR_START) * Math.max(1, daysCovered));
  const seasonalAvgFor = (date) => {
    const counts = bucketSeries.get(bucketKeyFor(date)) || [];
    const avg = counts.length ? counts.reduce((s, c) => s + c, 0) / counts.length : overallOpenHourAvg;
    return avg;
  };

  const predictHour = (date) => {
    if (method === "seasonal-ewma") {
      const match = demandForecast.hourlyForecast.find((slot) => slot.hour === date.getHours());
      if (match) return match.predictedOrders;
    }
    return Math.max(0, Math.round(seasonalAvgFor(date)));
  };

  const expectedNextHour = predictHour(nextHourDate);
  const expectedNextHourRange = buildRange(expectedNextHour, hourSamples[nextHour]);
  const nextHours = buildNextHours(predictHour, seasonalAvgFor, now, liveHourlyCount, currentHour);
  const expectedPeakToday = findExpectedPeakToday(predictHour, now, currentHour);
  const tomorrowPeak = findTomorrowPeak(seasonalAvgFor, now);

  const nextHourBucket = bucketPercentiles(hourSamples[nextHour]);
  const nextHourThresholds = nextHourBucket || globalPercentiles;
  const expectedWorkloadNextHour = isOpenHour(nextHour)
    ? classifyWorkload(expectedNextHour, nextHourThresholds)
    : { level: "LOW", label: "LOW", closedHours: true };

  const historical = {
    daysCovered,
    totalHistory,
    ordersPerHour: {
      avg: mean(openSamples),
      max: sortedOpenSamples.length ? sortedOpenSamples[sortedOpenSamples.length - 1] : 0,
      min: sortedOpenSamples.length ? sortedOpenSamples[0] : 0,
      median: median(openSamples),
      samples: openSamples.length,
    },
    peakHourByAvg,
    peakHourByTotal,
    peakDayByAvg,
    peakMealPeriod,
    ordersByHour,
    ordersByWeekday,
    ordersByMealPeriod,
    heatmap,
  };

  const workload = {
    scale: globalPercentiles,
    method: currentThresholdMethod,
    current: {
      hour: currentHour,
      label: hourRangeLabel(currentHour),
      ordersThisHour: currentOrdersThisHour,
      elapsedFraction: Number(elapsed.toFixed(2)),
      expectedFullHour,
      expectedSoFar,
      historicalTypical: expectedFullHour,
      deltaPct,
      level: currentWorkloadLevel.level,
      levelLabel: currentWorkloadLevel.label,
      thresholds: currentBucket,
      closedHours: Boolean(currentWorkloadLevel.closedHours),
    },
    expectedNextHour: {
      hour: nextHour,
      label: hourRangeLabel(nextHour),
      predicted: expectedNextHour,
      level: expectedWorkloadNextHour.level,
      levelLabel: expectedWorkloadNextHour.label,
      thresholds: nextHourThresholds,
    },
  };

  const forecast = {
    enabled: forecastEnabled,
    method,
    modelMae,
    baselineMae,
    chosenMae,
    confidenceLabel: demandForecast.modelAccuracy.confidenceLabel,
    expectedNextHour,
    expectedNextHourRange,
    expectedPeakToday,
    tomorrowPeak,
    todayPeakFact,
    nextHours,
  };

  const insights = buildInsights({ historical, workload, forecast, forecastEnabled });

  // ── 6) Operational translations: NEXT 30 MIN, TODAY summary, PREPARE MORE. ──
  // These convert the research layer into the plain answers a kitchen worker needs.
  const minutesIntoHour = now.getMinutes();
  const remainingThisHourExpected = Math.max(0, workload.current.expectedFullHour - workload.current.ordersThisHour);
  const currentWindowHours = Math.min(30, 60 - minutesIntoHour) / 60;
  const nextHourStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHour + 1);
  const next30Portion =
    minutesIntoHour > 30 ? predictHour(nextHourStartDate) * ((minutesIntoHour - 30) / 60) : 0;
  const expectedNext30Min = Math.round(remainingThisHourExpected * currentWindowHours + next30Portion);
  const next30min = {
    enabled: forecastEnabled,
    orders: expectedNext30Min,
    // "High demand" is anchored to this hour's real P50 (the typical full-hour volume): a busy
    // half-hour is one where the 30-min expectation reaches at least half of a typical hour.
    highDemand: forecastEnabled && expectedNext30Min >= Math.max(4, Math.round(workload.current.thresholds.p50 / 2)),
  };

  const today = buildTodaySummary(liveOrders);
  const prepareMore = buildPrepareMore({ orders, now, next30min });

  return {
    status,
    statusMessage: buildStatusMessage({ status, totalOrders, daysCovered }),
    dataSufficiency: {
      totalOrders,
      liveOrdersToday,
      historicalOrders: totalHistory,
      daysCovered,
      forecastEnabled,
      descriptiveEnabled: totalOrders > 0,
    },
    historical,
    workload,
    forecast,
    next30min,
    today,
    prepareMore,
    insights,
    generatedAt: new Date(nowMs),
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────
function pickBest(items, valueOf, startIndex) {
  let best = null;
  for (let i = startIndex; i < items.length; i++) {
    const value = valueOf(items[i]);
    if (!best || value > valueOf(best)) best = items[i];
  }
  return best && valueOf(best) > 0 ? { ...best } : null;
}

function classifyWorkload(count, thresholds) {
  if (thresholds.p50 === 0 && thresholds.p75 === 0 && thresholds.p90 === 0) {
    return { level: "LOW", label: "LOW" };
  }
  const found = WORKLOAD_LEVELS.find((band) => band.threshold(count, thresholds));
  return { level: found.level, label: found.label };
}

// Build per-(day-type × hour) series over the FULL inclusive day range (earliest recorded day →
// today), zero-filling so absent hours count as real zeros — identical bucketing to the
// demandForecast model, which makes the baseline-vs-model MAE comparison apples-to-apples.
function buildBucketSeries(countsByDateHour, dailyTotals, now) {
  const earliest = new Date(Math.min(...[...countsByDateHour.keys()].map((key) => {
    const [dk] = key.split("|");
    const [y, m, d] = dk.split("-").map(Number);
    return new Date(y, m, d).getTime();
  })));
  const rangeStart = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const series = new Map();
  for (let date = new Date(rangeStart); date <= rangeEnd; date.setDate(date.getDate() + 1)) {
    const dk = dateKey(date);
    const dt = dayType(date);
    for (let hour = 0; hour < 24; hour++) {
      const key = `${dt}-${hour}`;
      if (!series.has(key)) series.set(key, []);
      series.get(key).push(countsByDateHour.get(`${dk}|${hour}`) || 0);
    }
  }
  return series;
}

// Walk-forward baseline: predict each observation with the RUNNING MEAN of only the earlier
// observations in its bucket. Never peeks forward, so its MAE is a fair adversary for the EWMA.
function computeSeasonalAverageMae(series) {
  const errors = [];
  series.forEach((counts) => {
    let sum = 0;
    for (let i = 0; i < counts.length; i++) {
      if (i > 0) errors.push(Math.abs(counts[i] - sum / i));
      sum += counts[i];
    }
  });
  return errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : null;
}

function buildRange(predicted, samples) {
  if (samples.length < MIN_BUCKET_SAMPLES) return null;
  const sigma = stdDev(samples);
  return { low: Math.max(0, Math.round(predicted - sigma)), high: Math.round(predicted + sigma) };
}

function buildNextHours(predictHour, seasonalAvgFor, now, liveHourlyCount, currentHour) {
  const hours = [];
  for (let i = 1; i <= DISPLAY_HORIZON_HOURS; i++) {
    const target = new Date(now.getTime() + i * 3600000);
    const hour = target.getHours();
    hours.push({
      hour,
      label: hourRangeLabel(hour),
      actual: null,
      predicted: predictHour(target),
      historicalAvg: Math.max(0, Math.round(seasonalAvgFor(target))),
    });
  }
  // Actuals for today's hours (for the "actual vs predicted" chart) and the historical
  // average reference across the whole open window.
  const actuals = [];
  for (let h = OPEN_HOUR_START; h < OPEN_HOUR_END; h++) {
    actuals.push({
      hour: h,
      label: hourRangeLabel(h),
      actual: h <= currentHour ? liveHourlyCount[h] : null,
      predicted: null,
      historicalAvg: null,
    });
  }
  return { actuals, predictions: hours };
}

function findExpectedPeakToday(predictHour, now, currentHour) {
  let peak = null;
  for (let h = currentHour + 1; h < OPEN_HOUR_END; h++) {
    const target = new Date(now);
    target.setHours(h, 0, 0, 0);
    const predicted = predictHour(target);
    if (!peak || predicted > peak.predictedOrders) {
      peak = { hour: h, label: hourRangeLabel(h), predictedOrders: predicted };
    }
  }
  return peak;
}

function findTomorrowPeak(seasonalAvgFor, now) {
  let peak = null;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  for (let h = OPEN_HOUR_START; h < OPEN_HOUR_END; h++) {
    const target = new Date(tomorrow);
    target.setHours(h, 0, 0, 0);
    const value = Math.max(0, Math.round(seasonalAvgFor(target)));
    if (!peak || value > peak.predictedOrders) {
      peak = { hour: h, label: hourRangeLabel(h), predictedOrders: value, isTomorrow: true };
    }
  }
  return peak;
}

function buildStatusMessage({ status, totalOrders, daysCovered }) {
  if (status === "no_data") {
    return "No orders have been recorded for this stall yet. Analytics will appear as real order history accumulates.";
  }
  if (status === "insufficient_data") {
    return `Insufficient historical data for reliable prediction — only ${daysCovered} distinct day${daysCovered === 1 ? "" : "s"} on record (need ${STATS_MIN_HISTORY_DAYS}). Showing descriptive statistics from the ${totalOrders} real orders available.`;
  }
  return `Forecasting enabled — based on ${totalOrders} real orders across ${daysCovered} historical days.`;
}

function buildInsights({ historical, workload, forecast, forecastEnabled }) {
  const insights = [];
  const { peakMealPeriod, peakDayByAvg, ordersPerHour } = historical;

  if (peakMealPeriod && peakMealPeriod.avgPerDay > 0) {
    insights.push(
      `${peakMealPeriod.label} (${peakMealPeriod.rangeLabel}) carries the highest typical volume at ${Math.round(
        peakMealPeriod.avgPerDay
      )} orders/day — prepare the most food then.`
    );
  }
  if (peakDayByAvg && peakDayByAvg.avg > 0) {
    insights.push(
      `${peakDayByAvg.label} has the highest average volume at ${Math.round(
        peakDayByAvg.avg
      )} orders/day (across ${peakDayByAvg.days} occurrences).`
    );
  }
  const current = workload.current;
  if (current.ordersThisHour > 0 && current.deltaPct != null && !current.closedHours) {
    const direction = current.deltaPct >= 0 ? "above" : "below";
    insights.push(
      `This hour is running ${direction} the typical pace by ${Math.abs(current.deltaPct)}% (${current.ordersThisHour} now vs ~${current.expectedSoFar} typical by now) — workload ${current.levelLabel}.`
    );
  }
  if (forecast.expectedPeakToday) {
    insights.push(
      `The model expects today's busiest remaining hour at ${forecast.expectedPeakToday.label} (~${forecast.expectedPeakToday.predictedOrders} orders).`
    );
  } else if (forecast.tomorrowPeak) {
    insights.push(
      `No open hours remain today — tomorrow's expected peak is ~${forecast.tomorrowPeak.label} (${forecast.tomorrowPeak.predictedOrders} orders).`
    );
  }
  if (forecastEnabled && forecast.modelMae != null && forecast.baselineMae != null) {
    insights.push(
      forecast.method === "seasonal-ewma"
        ? `Seasonal-EWMA forecast was selected: walk-forward MAE ${forecast.modelMae.toFixed(
            1
          )} orders/hour vs ${forecast.baselineMae.toFixed(1)} for the seasonal-average baseline.`
        : `The simple seasonal-average baseline was kept: walk-forward MAE ${forecast.baselineMae.toFixed(
            1
          )} orders/hour — exponential smoothing (${forecast.modelMae.toFixed(1)}) did not beat it.`
    );
  } else if (forecastEnabled && ordersPerHour.avg > 0) {
    insights.push(`Typical open-hour volume is ${Math.round(ordersPerHour.avg)} orders/hour (median ${Math.round(ordersPerHour.median)}).`);
  }
  return insights;
}

// ─── Operational summaries (the "decision layer" the kitchen UI actually shows) ────────────
// TODAY: derived straight from the LIVE (today-so-far) order docs — no model involved.
function buildTodaySummary(liveOrders) {
  const hourlyCounts = new Array(24).fill(0);
  let sales = 0;
  let waitSamples = 0;
  let waitTotalMin = 0;
  liveOrders.forEach((order) => {
    const createdMs = toMs(order.created_at);
    if (createdMs != null) hourlyCounts[new Date(createdMs).getHours()] += 1;
    const amount = Number(order.price ?? order.amount ?? order.total ?? 0);
    if (Number.isFinite(amount)) sales += amount;
    const readyMs = toMs(order.ready_at);
    if (createdMs != null && readyMs != null && readyMs >= createdMs) {
      waitSamples += 1;
      waitTotalMin += (readyMs - createdMs) / 60000;
    }
  });
  return {
    orderCount: liveOrders.length,
    sales,
    avgWaitMin: waitSamples ? waitTotalMin / waitSamples : null,
    waitSamples,
    hourlyCounts: hourlyCounts.map((count, hour) => ({ hour, count })),
  };
}

// PREPARE MORE: which items to restock/prep now. Ranked by real recent order frequency (last 90
// minutes), then the next-30-min forecast is allocated across them proportionally — the same
// "translate the prediction into an action" contract the rest of the command center uses.
function buildPrepareMore({ orders, now, next30min }) {
  const windowMs = 90 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const itemCounts = new Map();
  let totalRecent = 0;
  orders.forEach((order) => {
    const ms = toMs(order.created_at);
    if (ms == null || ms < cutoff || ms > now.getTime() + FUTURE_SKEW_TOLERANCE_MS) return;
    if (Array.isArray(order.items) && order.items.length) {
      order.items.forEach((item) => {
        const name = item?.name;
        if (!name) return;
        const qty = Math.max(1, Number(item?.quantity) || 1);
        itemCounts.set(name, (itemCounts.get(name) || 0) + qty);
        totalRecent += qty;
      });
    } else {
      const name = order.itemName || order.item_name;
      if (!name) return;
      itemCounts.set(name, (itemCounts.get(name) || 0) + 1);
      totalRecent += 1;
    }
  });

  const ranked = [...itemCounts.entries()]
    .map(([name, recentCount]) => ({ name, recentCount }))
    .sort((a, b) => b.recentCount - a.recentCount)
    .slice(0, 3);

  const items =
    next30min.enabled && totalRecent > 0 && ranked.length
      ? ranked.map((item) => ({
          ...item,
          expected: Math.max(0, Math.round((item.recentCount / totalRecent) * next30min.orders)),
        }))
      : ranked.map((item) => ({ ...item, expected: null }));

  return { items, totalRecent, enabled: next30min.enabled };
}
