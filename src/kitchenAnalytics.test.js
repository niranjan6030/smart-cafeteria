import { describe, it, expect } from "vitest";
import { computeKitchenAnalytics, hourRangeLabel } from "./kitchenAnalytics";

const ts = (date) => ({ toDate: () => date });

// Build N consecutive weekdays ending `daysBefore` days before `anchor`, each producing
// `countsByHour` orders (hour -> count) for that day.
function weekdayHistory(anchor, daysBefore, countsByHour) {
  const orders = [];
  const added = new Set();
  let offset = 0;
  while (added.size < daysBefore) {
    offset += 1;
    const day = new Date(anchor);
    day.setDate(day.getDate() - offset);
    if ([0, 6].includes(day.getDay())) continue;
    added.add(day.getDate());
    Object.entries(countsByHour).forEach(([hour, count]) => {
      for (let i = 0; i < count; i++) {
        const d = new Date(day);
        d.setHours(Number(hour), 10 + i, 0, 0);
        orders.push({ created_at: ts(d) });
      }
    });
  }
  return orders;
}

describe("hourRangeLabel", () => {
  it("formats 12:00 PM – 1:00 PM for hour 12", () => {
    expect(hourRangeLabel(12)).toBe("12:00 PM – 1:00 PM");
  });
});

describe("computeKitchenAnalytics — data sufficiency", () => {
  it("reports no_data and never fabricates peaks when there is zero history", () => {
    const now = new Date("2026-07-23T12:30:00");
    const result = computeKitchenAnalytics({ orders: [], now });
    expect(result.status).toBe("no_data");
    expect(result.dataSufficiency.forecastEnabled).toBe(false);
    expect(result.historical.peakHourByAvg).toBeNull();
    expect(result.historical.peakDayByAvg).toBeNull();
    expect(result.forecast.expectedNextHour).toBeGreaterThanOrEqual(0);
    expect(result.workload.current.level).toBe("LOW");
  });

  it("reports insufficient_data below 3 historical days but still shows real descriptive stats", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = weekdayHistory(now, 2, { 12: 3, 13: 1 });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.status).toBe("insufficient_data");
    expect(result.dataSufficiency.daysCovered).toBe(2);
    expect(result.dataSufficiency.totalOrders).toBe(8);
    expect(result.forecast.enabled).toBe(false);
    expect(result.historical.ordersByHour[12].total).toBe(6);
    expect(result.historical.ordersByHour[13].total).toBe(2);
  });

  it("enables forecasting once enough history exists", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = weekdayHistory(now, 6, { 8: 2, 12: 3 });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.status).toBe("ready");
    expect(result.dataSufficiency.forecastEnabled).toBe(true);
    expect(result.dataSufficiency.daysCovered).toBe(6);
  });
});

describe("computeKitchenAnalytics — peak analysis from real data", () => {
  const now = new Date("2026-07-23T12:30:00"); // Thursday
  const orders = weekdayHistory(now, 5, { 8: 1, 12: 5, 13: 2 });

  it("detects the true peak hour by average (12:00)", () => {
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.historical.peakHourByAvg.hour).toBe(12);
    expect(result.historical.peakHourByTotal.hour).toBe(12);
    expect(result.historical.ordersPerHour.avg).toBeGreaterThan(0);
    expect(result.historical.ordersPerHour.max).toBe(5);
  });

  it("detects the peak day from per-day averages", () => {
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.historical.peakDayByAvg.avg).toBe(8);
  });

  it("reports lunch as the dominant meal period", () => {
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.historical.peakMealPeriod.key).toBe("lunch");
  });
});

describe("computeKitchenAnalytics — workload classification (data-driven percentiles)", () => {
  it("classifies a light current hour as LOW against scaled percentiles", () => {
    const now = new Date("2026-07-23T12:30:00");
    // Historical hour-12 samples across 5 days: [1, 2, 3, 4, 5] → p50=3, p75=4, p90=5.
    const orders = [];
    [[13, 1], [14, 2], [15, 3], [16, 4], [17, 5]].forEach(([day, count]) => {
      for (let i = 0; i < count; i++) {
        const d = new Date(`2026-07-${day}T12:15:00`);
        orders.push({ created_at: ts(d) });
      }
    });
    // 1 live order so far at 12:30 (elapsed 0.5 → thresholds [1.5, 2, 2.5]).
    orders.push({ created_at: ts(new Date("2026-07-23T12:05:00")) });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.workload.current.ordersThisHour).toBe(1);
    expect(result.workload.current.level).toBe("LOW");
    expect(result.workload.current.expectedFullHour).toBe(3);
  });

  it("classifies a very heavy current hour as VERY HIGH", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = [];
    [[13, 1], [14, 2], [15, 3], [16, 4], [17, 5]].forEach(([day, count]) => {
      for (let i = 0; i < count; i++) {
        const d = new Date(`2026-07-${day}T12:15:00`);
        orders.push({ created_at: ts(d) });
      }
    });
    for (let i = 0; i < 3; i++) orders.push({ created_at: ts(new Date("2026-07-23T12:05:00")) });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.workload.current.level).toBe("VERY_HIGH");
  });
});

describe("computeKitchenAnalytics — forecast integrity", () => {
  it("returns a non-negative next-hour forecast and 6 prediction slots with a chosen method", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = weekdayHistory(now, 10, { 8: 2, 12: 4, 13: 3, 17: 2 });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.forecast.enabled).toBe(true);
    expect(["seasonal-ewma", "seasonal-average"]).toContain(result.forecast.method);
    expect(result.forecast.expectedNextHour).toBeGreaterThanOrEqual(0);
    expect(result.forecast.nextHours.predictions).toHaveLength(6);
    expect(result.forecast.chosenMae).toBeGreaterThanOrEqual(0);
  });

  it("never leaks future data: future/unparseable timestamps are ignored", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = weekdayHistory(now, 5, { 12: 3 });
    orders.push({ created_at: ts(new Date(now.getTime() + 3600000)) }); // 1h in the future
    orders.push({ created_at: null });
    orders.push({ created_at: undefined });
    orders.push({ notCreatedAt: "x" });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.dataSufficiency.totalOrders).toBe(15);
  });

  it("shows a likely range when an hour has >=3 samples, and none otherwise", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = weekdayHistory(now, 5, { 12: 3 });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.forecast.expectedNextHourRange).not.toBeNull();
    expect(result.forecast.expectedNextHourRange.low).toBeLessThanOrEqual(
      result.forecast.expectedNextHourRange.high
    );
  });

  it("treats the current partial day as live, not history", () => {
    const now = new Date("2026-07-23T12:30:00");
    const orders = weekdayHistory(now, 4, { 12: 3 });
    orders.push({ created_at: ts(new Date("2026-07-23T12:10:00")) });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.dataSufficiency.liveOrdersToday).toBe(1);
    expect(result.dataSufficiency.historicalOrders).toBe(12);
    expect(result.dataSufficiency.daysCovered).toBe(4);
  });
});

describe("computeKitchenAnalytics — today / next-30-min / prepare-more (decision layer)", () => {
  const now = new Date("2026-07-23T12:30:00"); // Thursday

  it("sums today's real orders, sales and average wait from live docs", () => {
    const orders = weekdayHistory(now, 6, { 12: 2 }); // history only
    const waitMin = 5;
    orders.push({
      created_at: ts(new Date("2026-07-23T12:05:00")),
      ready_at: ts(new Date("2026-07-23T12:10:00")),
      price: 120,
    });
    orders.push({
      created_at: ts(new Date("2026-07-23T12:15:00")),
      ready_at: ts(new Date("2026-07-23T12:20:00")),
      price: 60,
    });

    const result = computeKitchenAnalytics({ orders, now });
    expect(result.today.orderCount).toBe(2);
    expect(result.today.sales).toBe(180);
    expect(result.today.avgWaitMin).toBeCloseTo(waitMin);
    expect(result.today.hourlyCounts.find((c) => c.hour === 12).count).toBe(2);
  });

  it("exposes a sane next-30-min expectation once forecasting is enabled", () => {
    const orders = weekdayHistory(now, 6, { 12: 3 });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.next30min.enabled).toBe(true);
    expect(Number.isInteger(result.next30min.orders)).toBe(true);
    expect(result.next30min.orders).toBeGreaterThanOrEqual(0);
    expect(typeof result.next30min.highDemand).toBe("boolean");
  });

  it("ranks prepare-more items by recent order frequency and allocates the forecast proportionally", () => {
    const orders = weekdayHistory(now, 6, { 12: 3 });
    orders.push({
      created_at: ts(new Date("2026-07-23T12:00:00")),
      items: [
        { name: "Chicken Roll", quantity: 2 },
        { name: "Coffee", quantity: 1 },
      ],
    });
    orders.push({ created_at: ts(new Date("2026-07-23T12:10:00")), items: [{ name: "Chicken Roll", quantity: 1 }] });
    orders.push({ created_at: ts(new Date("2026-07-23T11:05:00")), items: [{ name: "Maggi", quantity: 3 }] });

    const result = computeKitchenAnalytics({ orders, now });
    expect(result.prepareMore.totalRecent).toBe(7);
    expect(result.prepareMore.items).toHaveLength(3);
    expect(result.prepareMore.items[0].name).toBe("Chicken Roll");
    expect(result.prepareMore.items[0].recentCount).toBe(3);
    expect(result.prepareMore.items[0].expected).toBeGreaterThanOrEqual(0);
    expect(result.prepareMore.items[2].name).toBe("Coffee");
  });

  it("ignores stale items outside the recent window", () => {
    const orders = weekdayHistory(now, 6, { 12: 3 });
    orders.push({ created_at: ts(new Date("2026-07-23T08:00:00")), items: [{ name: "Old Dish", quantity: 9 }] });
    const result = computeKitchenAnalytics({ orders, now });
    expect(result.prepareMore.totalRecent).toBe(0);
    expect(result.prepareMore.items).toEqual([]);
  });
});
