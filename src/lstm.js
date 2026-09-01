// Minimal, dependency-free LSTM (Long Short-Term Memory) network used for in-browser food
// recommendations. Implements only the FORWARD pass (inference) — training happens offline and
// the weights are serialized as plain JS numbers, so there is no runtime ML dependency and no
// server round-trip. This matches the project's standing convention (queueingModel.js,
// demandForecast.js) of hand-written statistics instead of black-box libraries.
//
// Weight provenance: the default weights are deterministic Xavier/Glorot-style initializations
// from a fixed seed (see initLstmWeights). They are the standard *starting point* of an LSTM —
// the sequence-aware memory machinery is real and the pipeline blends its signal with explicit
// recency/frequency/daypart/popularity features (see recommenderEngine.js). To swap in weights
// actually learned from real order data, run src/research/train_lstm.py offline, export its
// state_dict to the same schema this module expects, and pass it through loadTrainedWeights().

export const DEFAULT_LSTM_CONFIG = {
  vocabSize: 96, // fixed item-slot vocabulary (index 0 is reserved for unknown items)
  embeddingDim: 12,
  contextDim: 4, // [hourNorm, isWeekend, recency, quantityNorm] appended to each embedding
  hiddenUnits: 16,
  seed: 20260806,
};

// ─── Deterministic PRNG (mulberry32) ───────────────────────────────────────────
// Same seed ⇒ identical weight matrices on every machine/browser — required so unit tests and
// the recommendation output are reproducible (no Math.random() anywhere in the model).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sigmoid(x) {
  if (x > 0) return 1 / (1 + Math.exp(-x));
  const ex = Math.exp(x);
  return ex / (1 + ex); // numerically stable for very negative inputs
}

// Softmax over a logits array — numerically stable (subtracts the max before exp).
export function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function zeros(n) {
  return new Array(n).fill(0);
}

// matvec(A, v): A is row-major [rows][cols], returns A·v of length rows.
function matvec(matrix, vector) {
  return matrix.map((row) => {
    let acc = 0;
    for (let j = 0; j < row.length; j++) acc += row[j] * vector[j];
    return acc;
  });
}

function addBias(vector, bias) {
  return vector.map((value, i) => value + bias[i]);
}

function uniformMatrix(rand, rows, cols, limit) {
  const matrix = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) row.push((rand() * 2 - 1) * limit);
    matrix.push(row);
  }
  return matrix;
}

function uniformVector(rand, length, limit) {
  const vector = [];
  for (let i = 0; i < length; i++) vector.push((rand() * 2 - 1) * limit);
  return vector;
}

/**
 * Deterministic Xavier/Glorot-style weight initialization.
 * @param {Partial<typeof DEFAULT_LSTM_CONFIG>} configOverride
 */
export function initLstmWeights(configOverride = {}) {
  const config = { ...DEFAULT_LSTM_CONFIG, ...configOverride };
  const { vocabSize, embeddingDim, contextDim, hiddenUnits, seed } = config;
  const rand = mulberry32(seed);
  const inputDim = embeddingDim + contextDim;

  // Embedding rows sampled from a narrow uniform so token vectors start small.
  const embedding = uniformMatrix(rand, vocabSize, embeddingDim, 1 / Math.sqrt(embeddingDim));

  const xLimit = Math.sqrt(6 / (hiddenUnits + inputDim));
  const hLimit = Math.sqrt(6 / (hiddenUnits + hiddenUnits));

  const makeGate = () => ({
    wx: uniformMatrix(rand, hiddenUnits, inputDim, xLimit),
    wh: uniformMatrix(rand, hiddenUnits, hiddenUnits, hLimit),
    // Forget-gate bias starts at +1 so the cell *remembers* by default (standard LSTM practice).
    b: uniformVector(rand, hiddenUnits, 0.1),
  });
  const gates = { i: makeGate(), f: makeGate(), o: makeGate(), c: makeGate() };
  gates.f.b = gates.f.b.map((value) => value + 1);

  const outLimit = Math.sqrt(6 / (hiddenUnits + vocabSize));
  const output = {
    w: uniformMatrix(rand, vocabSize, hiddenUnits, outLimit),
    b: uniformVector(rand, vocabSize, 0.1),
  };

  return { config, embedding, gates, output };
}

/**
 * Loads weights produced offline by src/research/train_lstm.py (same numeric schema as
 * initLstmWeights, but actually learned). Throws if the shape is incompatible with config so a
 * mismatched checkpoint fails loudly instead of silently producing garbage.
 * @param {ReturnType<typeof initLstmWeights>} checkpoint
 * @param {Partial<typeof DEFAULT_LSTM_CONFIG>} configOverride
 */
export function loadTrainedWeights(checkpoint, configOverride = {}) {
  const config = { ...DEFAULT_LSTM_CONFIG, ...configOverride };
  const { vocabSize, embeddingDim, contextDim, hiddenUnits } = config;
  const inputDim = embeddingDim + contextDim;
  const shape = (matrix) => `${matrix.length}x${matrix[0].length}`;

  const expect = (condition, message) => {
    if (!condition) throw new Error(`loadTrainedWeights: ${message}`);
  };
  expect(Array.isArray(checkpoint.embedding) && checkpoint.embedding.length === vocabSize, "embedding row count mismatch");
  expect(checkpoint.embedding.every((row) => row.length === embeddingDim), "embedding column count mismatch");
  Object.entries(checkpoint.gates).forEach(([gateName, gate]) => {
    expect(shape(gate.wx) === `${hiddenUnits}x${inputDim}`, `gate ${gateName} wx shape ${shape(gate.wx)}`);
    expect(shape(gate.wh) === `${hiddenUnits}x${hiddenUnits}`, `gate ${gateName} wh shape ${shape(gate.wh)}`);
    expect(gate.b.length === hiddenUnits, `gate ${gateName} bias length mismatch`);
  });
  expect(shape(checkpoint.output.w) === `${vocabSize}x${hiddenUnits}`, "output weight shape mismatch");
  expect(checkpoint.output.b.length === vocabSize, "output bias length mismatch");

  return { config, ...checkpoint };
}

/**
 * One LSTM cell step. Full standard formulation:
 *   i = σ(Wxi·x + Whi·h + bi)   input gate
 *   f = σ(Wxf·x + Whf·h + bf)   forget gate
 *   o = σ(Wxo·x + Who·h + bo)   output gate
 *   g = tanh(Wxc·x + Whc·h + bc) candidate memory
 *   c = f ⊙ c + i ⊙ g
 *   h = o ⊙ tanh(c)
 * @returns {{ h: number[], c: number[] }}
 */
export function lstmCell(weights, x, hPrev, cPrev) {
  const step = (gate) => {
    const pre = addBias(
      matvec(gate.wh, hPrev).map((value, i) => value + gate.wx[i].reduce((acc, w, j) => acc + w * x[j], 0)),
      gate.b
    );
    return pre;
  };

  const i = step(weights.gates.i).map(sigmoid);
  const f = step(weights.gates.f).map(sigmoid);
  const o = step(weights.gates.o).map(sigmoid);
  const g = step(weights.gates.c).map(Math.tanh);

  const c = cPrev.map((value, idx) => f[idx] * value + i[idx] * g[idx]);
  const h = c.map((value, idx) => o[idx] * Math.tanh(value));
  return { h, c };
}

function embed(weights, index) {
  return weights.embedding[index] || zeros(weights.embedding[0].length);
}

/**
 * Runs the LSTM over a token sequence and projects the final hidden state to vocab-sized logits.
 * @param {ReturnType<typeof initLstmWeights>} weights
 * @param {Array<{ index: number, context: number[] }>} tokens - oldest→newest
 * @returns {{ logits: number[], probabilities: number[], hidden: number[] }}
 */
export function forwardLstm(weights, tokens) {
  const H = weights.config.hiddenUnits;
  let h = zeros(H);
  let c = zeros(H);

  tokens.forEach((token) => {
    const base = embed(weights, token.index);
    const input = base.concat(token.context || zeros(weights.config.contextDim));
    const next = lstmCell(weights, input, h, c);
    h = next.h;
    c = next.c;
  });

  const logits = addBias(matvec(weights.output.w, h), weights.output.b);
  return { logits, probabilities: softmax(logits), hidden: h };
}
