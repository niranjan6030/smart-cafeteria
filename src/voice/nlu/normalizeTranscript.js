const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  a: 1,
  an: 1,
};

/** Lowercase, trim, collapse whitespace, expand spoken numbers, strip punctuation. */
export function normalizeTranscript(raw) {
  let text = String(raw || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[?.,!;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (word) => {
    const n = NUMBER_WORDS[word];
    return n !== undefined ? String(n) : word;
  });

  return text;
}
