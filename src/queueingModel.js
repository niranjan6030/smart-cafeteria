// M/M/c queueing model for per-stall wait-time estimation.
// c = concurrency (parallel prep slots), lambda = arrival rate, mu = service rate.

const DEFAULT_SERVICE_TIME_MIN = 6;
const MIN_SAMPLES_FOR_CONFIDENCE = 3;
const SAMPLE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_SAMPLES = 40;

const toMillis = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;

function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

// Erlang C: probability an arriving order must queue rather than be served immediately,
// given offered load `a` (= lambda/mu) spread across `c` parallel servers.
function erlangC(c, a) {
  if (a <= 0) return 0;
  if (a >= c) return 1; // offered load at/over capacity — queueing is certain
  let sum = 0;
  for (let k = 0; k < c; k++) sum += Math.pow(a, k) / factorial(k);
  const lastTerm = (Math.pow(a, c) / factorial(c)) * (c / (c - a));
  return lastTerm / (sum + lastTerm);
}

/**
 * @param {number} queueDepth - orders currently pending/preparing/ready for this stall
 * @param {Array} recentOrders - raw order docs for this stall (created_at, preparing_started_at, ready_at)
 * @param {number} concurrency - parallel prep slots this stall can run (c)
 */
export function computeQueueMetrics({ queueDepth = 0, recentOrders = [], concurrency = 2 }) {
  const c = Math.max(1, concurrency);
  const now = Date.now();

  const serviceSamplesMin = [];
  const arrivalTimestamps = [];

  recentOrders.forEach((order) => {
    const createdMs = toMillis(order.created_at);
    if (createdMs && now - createdMs <= SAMPLE_WINDOW_MS) arrivalTimestamps.push(createdMs);

    const startMs = toMillis(order.preparing_started_at);
    const readyMs = toMillis(order.ready_at);
    if (startMs && readyMs && readyMs > startMs && now - readyMs <= SAMPLE_WINDOW_MS) {
      serviceSamplesMin.push((readyMs - startMs) / 60000);
    }
  });

  const trimmedService = serviceSamplesMin.slice(-MAX_SAMPLES);
  const isColdStart = trimmedService.length < MIN_SAMPLES_FOR_CONFIDENCE;
  const avgServiceTimeMin = isColdStart
    ? DEFAULT_SERVICE_TIME_MIN
    : trimmedService.reduce((sum, v) => sum + v, 0) / trimmedService.length;

  const serviceRatePerMin = 1 / avgServiceTimeMin; // mu, per server

  const sortedArrivals = arrivalTimestamps.slice(-MAX_SAMPLES).sort((a, b) => a - b);
  let arrivalRatePerMin = 0;
  if (sortedArrivals.length >= 2) {
    const spanMin = (sortedArrivals[sortedArrivals.length - 1] - sortedArrivals[0]) / 60000;
    if (spanMin > 0) arrivalRatePerMin = (sortedArrivals.length - 1) / spanMin;
  }
  const throughputPerHour = arrivalRatePerMin * 60;

  const offeredLoad = arrivalRatePerMin / serviceRatePerMin; // a = lambda/mu
  const utilization = Math.min(0.98, Math.max(0, offeredLoad / c)); // rho = a/c

  // Practical, real-time estimate: current backlog spread across c parallel slots.
  // Used for the student-facing number since canteen arrivals are bursty, not steady-state Poisson.
  const estimatedWaitMin = (queueDepth / c) * avgServiceTimeMin;

  // Theoretical M/M/c diagnostics (steady-state Erlang C) — staff-facing operational health only.
  const cappedOfferedLoad = Math.min(offeredLoad, c - 0.02);
  const erlangCWaitProbability = arrivalRatePerMin > 0 ? erlangC(c, cappedOfferedLoad) : 0;
  const serviceCapacityMargin = c * serviceRatePerMin - arrivalRatePerMin;
  const erlangCExpectedWaitMin =
    arrivalRatePerMin > 0 && serviceCapacityMargin > 0
      ? erlangCWaitProbability / serviceCapacityMargin
      : null; // null = arrivals at/over capacity, steady-state wait is undefined

  return {
    queueDepth,
    concurrency: c,
    avgServiceTimeMin,
    serviceRatePerMin,
    arrivalRatePerMin,
    throughputPerHour,
    utilization,
    estimatedWaitMin,
    erlangCWaitProbability,
    erlangCExpectedWaitMin,
    isColdStart,
  };
}

export function waitLabel(utilization) {
  if (utilization < 0.4) return "Quiet";
  if (utilization < 0.75) return "Moderate";
  return "Busy";
}
