import { describe, it, expect } from "vitest";
import { computeQueueMetrics, waitLabel } from "./queueingModel";

// Firestore Timestamp-like helper: real docs use .toMillis()/.toDate(), not raw numbers.
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

describe("computeQueueMetrics", () => {
  it("returns cold-start defaults with no order history", () => {
    const m = computeQueueMetrics({ queueDepth: 0, recentOrders: [], concurrency: 2 });
    expect(m.isColdStart).toBe(true);
    expect(m.avgServiceTimeMin).toBe(6); // DEFAULT_SERVICE_TIME_MIN
    expect(m.arrivalRatePerMin).toBe(0);
    expect(m.utilization).toBe(0);
  });

  it("computes a real service-time average once enough samples exist", () => {
    const now = Date.now();
    const recentOrders = [
      { created_at: ts(now - 60000), preparing_started_at: ts(now - 50000), ready_at: ts(now - 40000) }, // 10 min? no: (readyMs-startMs)/60000
      { created_at: ts(now - 55000), preparing_started_at: ts(now - 45000), ready_at: ts(now - 15000) },
      { created_at: ts(now - 50000), preparing_started_at: ts(now - 40000), ready_at: ts(now - 10000) },
    ];
    const m = computeQueueMetrics({ queueDepth: 3, recentOrders, concurrency: 2 });
    expect(m.isColdStart).toBe(false);
    expect(m.avgServiceTimeMin).toBeGreaterThan(0);
    expect(m.estimatedWaitMin).toBeGreaterThanOrEqual(0);
  });

  it("clamps utilization to at most 0.98 even when offered load exceeds capacity", () => {
    const now = Date.now();
    // Tight arrivals (high lambda) with slow service (low mu) to push offered load over capacity.
    const recentOrders = [
      { created_at: ts(now - 1000), preparing_started_at: ts(now - 900), ready_at: ts(now - 100) },
      { created_at: ts(now - 2000), preparing_started_at: ts(now - 1900), ready_at: ts(now - 200) },
      { created_at: ts(now - 3000), preparing_started_at: ts(now - 2900), ready_at: ts(now - 300) },
      { created_at: ts(now - 4000), preparing_started_at: ts(now - 3900), ready_at: ts(now - 400) },
    ];
    const m = computeQueueMetrics({ queueDepth: 20, recentOrders, concurrency: 1 });
    expect(m.utilization).toBeLessThanOrEqual(0.98);
  });

  it("never returns a negative estimated wait", () => {
    const m = computeQueueMetrics({ queueDepth: 0, recentOrders: [], concurrency: 5 });
    expect(m.estimatedWaitMin).toBeGreaterThanOrEqual(0);
  });

  it("enforces a minimum concurrency of 1 even if 0 or negative is passed", () => {
    const m = computeQueueMetrics({ queueDepth: 1, recentOrders: [], concurrency: 0 });
    expect(m.concurrency).toBe(1);
    const m2 = computeQueueMetrics({ queueDepth: 1, recentOrders: [], concurrency: -3 });
    expect(m2.concurrency).toBe(1);
  });

  it("ignores samples outside the sample window", () => {
    const now = Date.now();
    const stale = [
      { created_at: ts(now - 3 * 60 * 60 * 1000), preparing_started_at: ts(now - 3 * 60 * 60 * 1000), ready_at: ts(now - 3 * 60 * 60 * 1000 + 60000) },
    ];
    const m = computeQueueMetrics({ queueDepth: 0, recentOrders: stale, concurrency: 2 });
    // Stale samples fall outside SAMPLE_WINDOW_MS, so this should still be cold-start.
    expect(m.isColdStart).toBe(true);
  });
});

describe("waitLabel", () => {
  it("labels low utilization as Quiet", () => {
    expect(waitLabel(0)).toBe("Quiet");
    expect(waitLabel(0.39)).toBe("Quiet");
  });
  it("labels mid utilization as Moderate", () => {
    expect(waitLabel(0.4)).toBe("Moderate");
    expect(waitLabel(0.74)).toBe("Moderate");
  });
  it("labels high utilization as Busy", () => {
    expect(waitLabel(0.75)).toBe("Busy");
    expect(waitLabel(1)).toBe("Busy");
  });
});
