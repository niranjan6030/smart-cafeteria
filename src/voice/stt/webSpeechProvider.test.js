import { describe, expect, it } from "vitest";
import { mapRecognitionError, RECOGNITION_ERRORS } from "./webSpeechProvider.js";

describe("mapRecognitionError", () => {
  it("maps network to a retryable error", () => {
    const error = mapRecognitionError("network");
    expect(error.code).toBe("network");
    expect(error.retryable).toBe(true);
  });

  it("maps invalid-state to a retryable error (poisoned-session signal)", () => {
    expect(mapRecognitionError("invalid-state").retryable).toBe(true);
  });

  it("maps hard failures to non-retryable", () => {
    for (const code of ["no-speech", "not-allowed", "service-not-allowed", "audio-capture", "aborted", "language-not-supported"]) {
      expect(mapRecognitionError(code).retryable).toBe(false);
      expect(mapRecognitionError(code).message.length).toBeGreaterThan(0);
    }
  });

  it("falls back gracefully for unknown codes", () => {
    const error = mapRecognitionError("weird-thing");
    expect(error.code).toBe("weird-thing");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("weird-thing");
  });

  it("has a message for every canonical code", () => {
    for (const code of Object.keys(RECOGNITION_ERRORS)) {
      expect(RECOGNITION_ERRORS[code].message.length).toBeGreaterThan(0);
    }
  });
});
