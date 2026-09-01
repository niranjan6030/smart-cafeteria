import { describe, expect, it } from "vitest";
import { appendTraceEntry, createSessionTrace, markCheckoutSucceeded, summarizeSession } from "./sessionTrace.js";

const manual = (overrides = {}) => ({ modality: "manual", commandType: "ADD_ITEM", success: true, ts: 1000, ...overrides });
const voiceOk = (overrides = {}) => ({ modality: "voice", commandType: "ADD_ITEM", success: true, ts: 2000, latencyMs: 150, ...overrides });
const voiceFail = (overrides = {}) => ({ modality: "voice", commandType: "NOOP", success: false, ts: 3000, latencyMs: 250, ...overrides });

describe("createSessionTrace", () => {
  it("starts empty with zero metrics", () => {
    const t = createSessionTrace();
    expect(t).toMatchObject({
      interactionCount: 0,
      manualCount: 0,
      voiceCount: 0,
      voiceSuccessCount: 0,
      voiceFailureCount: 0,
      voiceToManualFallbacks: 0,
      voiceRetries: 0,
      firstTs: null,
      lastTs: null,
      checkoutSucceeded: false,
    });
    expect(t.entries).toEqual([]);
    expect(t.voiceLatenciesMs).toEqual([]);
  });
});

describe("appendTraceEntry — counts", () => {
  it("counts manual and voice commands", () => {
    let { trace } = appendTraceEntry(createSessionTrace(), manual({ ts: 100 }));
    ({ trace } = appendTraceEntry(trace, voiceOk({ ts: 200 })));
    expect(trace.interactionCount).toBe(2);
    expect(trace.manualCount).toBe(1);
    expect(trace.voiceCount).toBe(1);
    expect(trace.firstTs).toBe(100);
    expect(trace.lastTs).toBe(200);
  });

  it("stamps ts with Date.now() when omitted (caller-side purity)", () => {
    const realNow = Date.now;
    Date.now = () => 777;
    try {
      const { trace } = appendTraceEntry(createSessionTrace(), manual({ ts: undefined }));
      expect(trace.entries[0].ts).toBe(777);
    } finally {
      Date.now = realNow;
    }
  });

  it("tracks voice success/failure and latency", () => {
    let { trace } = appendTraceEntry(createSessionTrace(), voiceOk());
    ({ trace } = appendTraceEntry(trace, voiceFail({ ts: 4000, latencyMs: 500 })));
    expect(trace.voiceSuccessCount).toBe(1);
    expect(trace.voiceFailureCount).toBe(1);
    expect(trace.voiceLatenciesMs).toEqual([150, 500]);
  });

  it("ignores latency on manual entries", () => {
    const { trace } = appendTraceEntry(createSessionTrace(), manual({ latencyMs: 900 }));
    expect(trace.voiceLatenciesMs).toEqual([]);
  });
});

describe("appendTraceEntry — recovery classifier", () => {
  it("a failed voice command followed by a manual command is a voice→manual fallback", () => {
    const base = appendTraceEntry(createSessionTrace(), voiceFail()).trace;
    const { trace, signal } = appendTraceEntry(base, manual());
    expect(signal).toEqual({ type: "voice_to_manual", from: "NOOP", to: "ADD_ITEM" });
    expect(trace.voiceToManualFallbacks).toBe(1);
    expect(trace.voiceRetries).toBe(0);
  });

  it("a failed voice command followed by another voice command is a retry", () => {
    const base = appendTraceEntry(createSessionTrace(), voiceFail()).trace;
    const { trace, signal } = appendTraceEntry(base, voiceOk());
    expect(signal).toEqual({ type: "voice_retry", from: "NOOP", to: "ADD_ITEM" });
    expect(trace.voiceRetries).toBe(1);
    expect(trace.voiceToManualFallbacks).toBe(0);
  });

  it("does not classify recovery after a SUCCESSFUL voice command", () => {
    const base = appendTraceEntry(createSessionTrace(), voiceOk()).trace;
    const { trace, signal } = appendTraceEntry(base, manual());
    expect(signal).toBeNull();
    expect(trace.voiceToManualFallbacks).toBe(0);
  });

  it("does not classify the first command of a session", () => {
    const { trace, signal } = appendTraceEntry(createSessionTrace(), manual());
    expect(signal).toBeNull();
    expect(trace.voiceToManualFallbacks).toBe(0);
  });

  it("chains: two consecutive failures produce two retry signals", () => {
    let t = createSessionTrace();
    let signals = [];
    for (const entry of [voiceFail({ ts: 1 }), voiceFail({ ts: 2 }), voiceOk({ ts: 3 })]) {
      const r = appendTraceEntry(t, entry);
      t = r.trace;
      if (r.signal) signals.push(r.signal.type);
    }
    expect(signals).toEqual(["voice_retry", "voice_retry"]);
    expect(t.voiceRetries).toBe(2);
  });
});

describe("markCheckoutSucceeded + summarizeSession", () => {
  it("marks checkout and extends lastTs", () => {
    const base = appendTraceEntry(createSessionTrace(), manual({ ts: 1000 })).trace;
    const realNow = Date.now;
    Date.now = () => 5000;
    try {
      const marked = markCheckoutSucceeded(base);
      expect(marked.checkoutSucceeded).toBe(true);
      expect(marked.lastTs).toBe(5000);
    } finally {
      Date.now = realNow;
    }
  });

  it("summarizes duration, latency average, and modality mix", () => {
    let t = createSessionTrace();
    ({ trace: t } = appendTraceEntry(t, manual({ ts: 1000 })));
    ({ trace: t } = appendTraceEntry(t, voiceOk({ ts: 2000, latencyMs: 100 })));
    ({ trace: t } = appendTraceEntry(t, voiceOk({ ts: 3000, latencyMs: 200 })));
    const s = summarizeSession(t);
    expect(s.durationMs).toBe(2000);
    expect(s.avgVoiceLatencyMs).toBe(150);
    expect(s.modalityMix).toBeCloseTo(2 / 3);
    expect(s.interactionCount).toBe(3);
    expect(s.checkoutSucceeded).toBe(false);
  });

  it("handles a single-command session without NaN", () => {
    const { trace } = appendTraceEntry(createSessionTrace(), manual({ ts: 500 }));
    const s = summarizeSession(trace);
    expect(s.durationMs).toBe(0);
    expect(s.avgVoiceLatencyMs).toBe(0);
    expect(s.modalityMix).toBe(0);
  });
});
