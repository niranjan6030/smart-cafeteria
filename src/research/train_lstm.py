#!/usr/bin/env python3
"""
Offline LSTM training for the canteen food-recommendation model.

The React app ships with deterministic Xavier-initialized weights (src/lstm.js,
`initLstmWeights`) so the feature runs with zero Python dependency. When real order data
accumulates, run this script to learn weights that actually capture ordering patterns, then
wire the exported checkpoint into the browser via `loadTrainedWeights()` in src/lstm.js.

It is NOT part of the app build or CI — it is provenance/retraining tooling. The app itself
never imports torch.

Architecture (must mirror src/lstm.js exactly):
  - Vocabulary: N item slots (index 0 reserved for unknown items).
  - Input per token: item embedding (embedding_dim) concatenated with a 4-value context vector
    [hour/24, is_weekend, recency, quantity/5] -> input_dim = embedding_dim + context_dim.
  - One LSTM layer (hidden_units), then a linear projection to vocabulary-sized logits.
  - Loss: cross-entropy on the NEXT item in the sequence (next-item prediction).

Export schema (matches the JS weights object):
  {
    "config": { "vocabSize": N, "embeddingDim": E, "contextDim": 4, "hiddenUnits": H },
    "embedding": [[...], ...],            # N x E
    "gates": {
      "i": { "wx": [[...]], "wh": [[...]], "b": [...] },   # input gate
      "f": { ... },                                          # forget gate
      "c": { ... },                                          # candidate cell
      "o": { ... }                                           # output gate
    },
    "output": { "w": [[...]], "b": [...] }                   # N x H + N
  }

PyTorch gate order inside weight_ih_l0 / weight_hh_l0 is [i, f, g, o] — the exporter reorders
the candidate/cell slice so `c` matches the JS schema.

Usage:
  python train_lstm.py --epochs 200 --out recommender_weights.json
"""

import argparse
import json
import math
import random

import torch
import torch.nn as nn

VOCAB_SIZE = 96
EMBEDDING_DIM = 12
CONTEXT_DIM = 4
HIDDEN_UNITS = 16
SEQ_LEN = 8

RNG_SEED = 20260806


class NextItemLSTM(nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding = nn.Embedding(VOCAB_SIZE, EMBEDDING_DIM)
        self.lstm = nn.LSTM(EMBEDDING_DIM + CONTEXT_DIM, HIDDEN_UNITS, batch_first=True)
        self.fc = nn.Linear(HIDDEN_UNITS, VOCAB_SIZE)

    def forward(self, token_idx, context):
        # token_idx: (batch, seq) of item slots; context: (batch, seq, context_dim)
        x = torch.cat([self.embedding(token_idx), context], dim=-1)
        out, _ = self.lstm(x)
        return self.fc(out)  # (batch, seq, vocab) logits


# ─── Synthetic training data ────────────────────────────────────────────────────
# Simulates ~150 students over ~60 days: each has a few favourite items (picked ~70% of the
# time), orders cluster around meal hours (8-9, 12-14, 18-20), and some items strongly follow
# others (the "sequence memory" the LSTM is meant to learn).
def build_synthetic_sequences(num_students=150, days=60):
    items = list(range(1, VOCAB_SIZE))
    sequences = []  # each: list of (slot, hour, is_weekend, quantity)
    for student in range(num_students):
        rng = random.Random(RNG_SEED + student)
        favourites = rng.sample(items, k=rng.randint(2, 6))
        pairings = {favourites[i]: favourites[(i + 1) % len(favourites)] for i in range(len(favourites))}
        hours = rng.choice([[8, 13, 19], [9, 14, 20], [13, 14, 18]])
        for day in range(days):
            for hour in hours:
                if rng.random() < 0.75:
                    slot = rng.choice(favourites) if rng.random() < 0.7 else rng.choice(items)
                    sequences.append((slot, hour, 1 if day % 7 in (5, 6) else 0, rng.randint(1, 3)))
                    if rng.random() < 0.4:
                        sequences.append((pairings.get(slot, rng.choice(items)), hour, 0 if day % 7 in (5, 6) else 1, 1))
    return sequences


def windowed_batches(sequences, batch_size=64):
    # Sliding windows of SEQ_LEN -> next item prediction. Window carries slot + context vector.
    examples = []
    for i in range(SEQ_LEN, len(sequences)):
        window = sequences[i - SEQ_LEN : i]
        target = sequences[i][0]
        context = torch.tensor(
            [[h / 24, w, math.exp(-0.02 * idx), q / 5] for idx, (_, h, w, q) in enumerate(window)],
            dtype=torch.float32,
        )
        slots = torch.tensor([slot for slot, _, _, _ in window], dtype=torch.long)
        examples.append((slots, context, target))
    random.Random(RNG_SEED).shuffle(examples)
    for start in range(0, len(examples), batch_size):
        batch = examples[start : start + batch_size]
        yield (
            torch.stack([e[0] for e in batch]),
            torch.stack([e[1] for e in batch]),
            torch.tensor([e[2] for e in batch], dtype=torch.long),
        )


# ─── Export ─────────────────────────────────────────────────────────────────────
def export_weights(model, out_path):
    state = model.state_dict()
    # PyTorch LSTM gate order inside the packed matrices: [i, f, g, o].
    def gates_for(ih, hh, b_ih, b_hh):
        def row_slice(matrix, gate_idx):
            return matrix[gate_idx * HIDDEN_UNITS : (gate_idx + 1) * HIDDEN_UNITS].tolist()

        wx = {"i": row_slice(ih, 0), "f": row_slice(ih, 1), "c": row_slice(ih, 2), "o": row_slice(ih, 3)}
        wh = {"i": row_slice(hh, 0), "f": row_slice(hh, 1), "c": row_slice(hh, 2), "o": row_slice(hh, 3)}
        bias = (b_ih + b_hh).tolist()
        b = {"i": bias[0:HIDDEN_UNITS], "f": bias[HIDDEN_UNITS : 2 * HIDDEN_UNITS],
             "c": bias[2 * HIDDEN_UNITS : 3 * HIDDEN_UNITS], "o": bias[3 * HIDDEN_UNITS : 4 * HIDDEN_UNITS]}
        return {"i": {"wx": wx["i"], "wh": wh["i"], "b": b["i"]},
                "f": {"wx": wx["f"], "wh": wh["f"], "b": b["f"]},
                "c": {"wx": wx["c"], "wh": wh["c"], "b": b["c"]},
                "o": {"wx": wx["o"], "wh": wh["o"], "b": b["o"]}}

    checkpoint = {
        "config": {"vocabSize": VOCAB_SIZE, "embeddingDim": EMBEDDING_DIM,
                   "contextDim": CONTEXT_DIM, "hiddenUnits": HIDDEN_UNITS},
        "embedding": state["embedding.weight"].tolist(),
        "gates": gates_for(state["lstm.weight_ih_l0"], state["lstm.weight_hh_l0"],
                           state["lstm.bias_ih_l0"], state["lstm.bias_hh_l0"]),
        "output": {"w": state["fc.weight"].tolist(), "b": state["fc.bias"].tolist()},
    }
    with open(out_path, "w") as fh:
        json.dump(checkpoint, fh)
    print(f"Exported weights -> {out_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--out", default="recommender_weights.json")
    args = parser.parse_args()

    torch.manual_seed(RNG_SEED)
    model = NextItemLSTM()
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-3)
    loss_fn = nn.CrossEntropyLoss()
    sequences = build_synthetic_sequences()

    for epoch in range(args.epochs):
        total_loss = 0.0
        batches = 0
        for slots, context, target in windowed_batches(sequences):
            optimizer.zero_grad()
            logits = model(slots, context).reshape(-1, VOCAB_SIZE)
            loss = loss_fn(logits, target)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            batches += 1
        if epoch % 20 == 0 or epoch == args.epochs - 1:
            print(f"epoch {epoch + 1:>3}/{args.epochs}  loss {total_loss / max(batches, 1):.4f}")

    export_weights(model, args.out)


if __name__ == "__main__":
    main()
