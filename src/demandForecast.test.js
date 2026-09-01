import { describe, it, expect } from "vitest";
import { computeDemandForecast, formatHourLabel } from "./demandForecast";

const ts = (date) => ({ toDate: () => date });

describe("computeDemandForecast", () => {
  it("returns the cold-start meal-curve shape with zero order history", () => {
    const now = new Date("2026-07-23T10:00:00");
    const result = computeDemandForecast({ orders: [], horizonHours: 3, now });
    expect(result.isColdStart).toBe(true);
    expect(result.hourlyForecast).toHaveLength(3);
    expect(result.modelAccuracy.confidenceLabel).toBe("Low");
    expect(result.next1h).toBeGreaterThanOrEqual(0);
  });

  it("produces real (non-cold-start) predictions once enough history exists", () => {
    const now = new Date("2026-07-23T13:00:00"); // a Thursday
    const orders = [];
    // 20 days of lunch-hour (12:00) orders so the weekday-12 bucket has a real EWMA level.
    for (let d = 1; d <= 20; d++) {
      const day = new Date(now);
      day.setDate(day.getDate() - d);
      day.setHours(12, 0, 0, 0);
      // Skip weekends to keep this purely a weekday bucket.
      if ([0, 6].includes(day.getDay())) continue;
      orders.push({ created_at: ts(day) }, { created_at: ts(day) }, { created_at: ts(day) });
    }
    const result = computeDemandForecast({ orders, horizonHours: 1, now });
    expect(result.isColdStart).toBe(false);
    expect(result.modelAccuracy.sampleCount).toBeGreaterThan(0);
  });

  it("never predicts a negative order count", () => {
    const now = new Date("2026-07-23T03:00:00"); // dead-of-night hour
    const result = computeDemandForecast({ orders: [], horizonHours: 5, now });
    result.hourlyForecast.forEach((h) => expect(h.predictedOrders).toBeGreaterThanOrEqual(0));
  });

  it("next3h equals the sum of the first 3 hourly predictions", () => {
    const now = new Date("2026-07-23T09:00:00");
    const result = computeDemandForecast({ orders: [], horizonHours: 3, now });
    const sum = result.hourlyForecast.slice(0, 3).reduce((s, h) => s + h.predictedOrders, 0);
    expect(result.next3h).toBe(sum);
  });

  it("quietestHour always resolves to a valid 0-23 hour", () => {
    const now = new Date("2026-07-23T09:00:00");
    const result = computeDemandForecast({ orders: [], horizonHours: 3, now });
    expect(result.quietestHour.hour).toBeGreaterThanOrEqual(0);
    expect(result.quietestHour.hour).toBeLessThanOrEqual(23);
  });

  it("ignores order docs with an unparseable created_at instead of throwing", () => {
    const now = new Date("2026-07-23T09:00:00");
    const orders = [{ created_at: null }, { created_at: undefined }, { notCreatedAt: "x" }];
    expect(() => computeDemandForecast({ orders, horizonHours: 3, now })).not.toThrow();
  });
});

describe("formatHourLabel", () => {
  it("formats midnight and noon correctly", () => {
    expect(formatHourLabel(0)).toBe("12 AM");
    expect(formatHourLabel(12)).toBe("12 PM");
  });
  it("formats a standard morning and evening hour", () => {
    expect(formatHourLabel(9)).toBe("9 AM");
    expect(formatHourLabel(21)).toBe("9 PM");
  });
});
