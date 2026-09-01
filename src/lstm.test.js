import { describe, it, expect } from "vitest";
import {
  DEFAULT_LSTM_CONFIG,
  initLstmWeights,
  loadTrainedWeights,
  lstmCell,
  mulberry32,
  forwardLstm,
  sigmoid,
  softmax,
} from "./lstm";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    expect(a()).not.toBe(b());
  });

  it("always returns values in [0, 1)", () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("sigmoid", () => {
  it("is bounded in (0, 1) for ordinary inputs", () => {
    [-20, -5, -1, 0, 1, 5, 20].forEach((x) => {
      const value = sigmoid(x);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    });
  });

  it("is anti-symmetric around 0.5", () => {
    expect(sigmoid(2)).toBeCloseTo(1 - sigmoid(-2), 10);
  });

  it("is numerically stable for extreme inputs", () => {
    expect(Number.isFinite(sigmoid(-1000))).toBe(true);
    expect(Number.isFinite(sigmoid(1000))).toBe(true);
  });
});

describe("softmax", () => {
  it("sums to 1 and preserves the argmax", () => {
    const logits = [1, 2, 3, 0.5];
    const probs = softmax(logits);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(probs.indexOf(Math.max(...probs))).toBe(logits.indexOf(Math.max(...logits)));
  });

  it("is invariant to adding a constant to all logits", () => {
    const base = [0.3, 1.7, -0.4];
    const shifted = softmax(base.map((x) => x + 5));
    softmax(base).forEach((p, i) => expect(p).toBeCloseTo(shifted[i], 10));
  });

  it("returns a flat distribution when all logits are equal", () => {
    const probs = softmax([2, 2, 2, 2]);
    probs.forEach((p) => expect(p).toBeCloseTo(0.25, 10));
  });

  it("handles a single element", () => {
    expect(softmax([7])[0]).toBeCloseTo(1, 10);
  });
});

describe("initLstmWeights", () => {
  it("is deterministic for the same seed", () => {
    const a = initLstmWeights(DEFAULT_LSTM_CONFIG);
    const b = initLstmWeights(DEFAULT_LSTM_CONFIG);
    expect(a.embedding).toEqual(b.embedding);
    expect(a.output.w).toEqual(b.output.w);
    expect(a.gates.i.wx).toEqual(b.gates.i.wx);
  });

  it("differs for a different seed", () => {
    const a = initLstmWeights({ ...DEFAULT_LSTM_CONFIG, seed: 1 });
    const b = initLstmWeights({ ...DEFAULT_LSTM_CONFIG, seed: 2 });
    expect(a.embedding).not.toEqual(b.embedding);
  });

  it("exposes a forget-gate bias shifted toward remembering (+1)", () => {
    const weights = initLstmWeights(DEFAULT_LSTM_CONFIG);
    weights.gates.f.b.forEach((value) => expect(value).toBeGreaterThan(0.5));
  });

  it("has the expected matrix shapes", () => {
    const { config, gates, embedding, output } = initLstmWeights(DEFAULT_LSTM_CONFIG);
    const { vocabSize, embeddingDim, contextDim, hiddenUnits } = config;
    const inputDim = embeddingDim + contextDim;
    expect(embedding).toHaveLength(vocabSize);
    expect(embedding[0]).toHaveLength(embeddingDim);
    Object.values(gates).forEach((gate) => {
      expect(gate.wx).toHaveLength(hiddenUnits);
      expect(gate.wx[0]).toHaveLength(inputDim);
      expect(gate.wh).toHaveLength(hiddenUnits);
      expect(gate.wh[0]).toHaveLength(hiddenUnits);
      expect(gate.b).toHaveLength(hiddenUnits);
    });
    expect(output.w).toHaveLength(vocabSize);
    expect(output.w[0]).toHaveLength(hiddenUnits);
    expect(output.b).toHaveLength(vocabSize);
  });
});

describe("loadTrainedWeights", () => {
  it("accepts a checkpoint with the same shape as initLstmWeights", () => {
    const checkpoint = initLstmWeights(DEFAULT_LSTM_CONFIG);
    const loaded = loadTrainedWeights(checkpoint, DEFAULT_LSTM_CONFIG);
    expect(loaded.embedding).toEqual(checkpoint.embedding);
  });

  it("throws on a shape mismatch instead of silently corrupting", () => {
    const checkpoint = initLstmWeights(DEFAULT_LSTM_CONFIG);
    const bad = { ...checkpoint, output: { w: [[0]], b: [0] } };
    expect(() => loadTrainedWeights(bad, DEFAULT_LSTM_CONFIG)).toThrow();
  });
});

describe("lstmCell", () => {
  const weights = initLstmWeights(DEFAULT_LSTM_CONFIG);
  const H = DEFAULT_LSTM_CONFIG.hiddenUnits;

  it("is deterministic for identical inputs", () => {
    const x = new Array(H).fill(0.5);
    const h0 = new Array(H).fill(0);
    const c0 = new Array(H).fill(0);
    expect(lstmCell(weights, x, h0, c0)).toEqual(lstmCell(weights, x, h0, c0));
  });

  it("produces finite, shaped outputs for a zero input", () => {
    const x = new Array(H).fill(0);
    const { h, c } = lstmCell(weights, x, new Array(H).fill(0), new Array(H).fill(0));
    expect(h).toHaveLength(H);
    expect(c).toHaveLength(H);
    h.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    c.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });

  it("changes its output when the previous hidden state differs", () => {
    const x = new Array(H).fill(0.3);
    const z = new Array(H).fill(0);
    const a = lstmCell(weights, x, z, z);
    const different = lstmCell(weights, x, new Array(H).fill(1), z);
    expect(a.h).not.toEqual(different.h);
  });

  it("carries hidden state forward across steps (recurrence)", () => {
    const x = new Array(H).fill(0.2);
    const { h: h1 } = lstmCell(weights, x, new Array(H).fill(0), new Array(H).fill(0));
    const { h: h2 } = lstmCell(weights, x, h1, h1);
    expect(h2).not.toEqual(h1);
  });
});

describe("forwardLstm", () => {
  const weights = initLstmWeights(DEFAULT_LSTM_CONFIG);
  const H = DEFAULT_LSTM_CONFIG.hiddenUnits;
  const V = DEFAULT_LSTM_CONFIG.vocabSize;

  it("returns vocab-sized logits and probabilities that sum to 1", () => {
    const tokens = [
      { index: 3, context: [0.5, 0, 0.8, 1] },
      { index: 9, context: [0.6, 1, 0.4, 1] },
    ];
    const { logits, probabilities } = forwardLstm(weights, tokens);
    expect(logits).toHaveLength(V);
    expect(probabilities).toHaveLength(V);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
  });

  it("is deterministic for the same token sequence", () => {
    const tokens = [{ index: 1, context: [0.2, 1, 0.9, 1] }];
    expect(forwardLstm(weights, tokens)).toEqual(forwardLstm(weights, tokens));
  });

  it("is order-sensitive — reversing a sequence changes the output", () => {
    const a = { index: 5, context: [0.3, 0, 0.2, 1] };
    const b = { index: 8, context: [0.7, 1, 0.9, 2] };
    const forward = forwardLstm(weights, [a, b]);
    const backward = forwardLstm(weights, [b, a]);
    expect(forward.probabilities).not.toEqual(backward.probabilities);
  });

  it("treats an unknown token index as a zero-embedding instead of throwing", () => {
    const { probabilities } = forwardLstm(weights, [{ index: 9999, context: [0, 0, 0, 0] }]);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
  });

  it("returns the exact same hidden-state dimension as hiddenUnits", () => {
    const { hidden } = forwardLstm(weights, [{ index: 1, context: [0, 0, 0, 0] }]);
    expect(hidden).toHaveLength(H);
  });
});
