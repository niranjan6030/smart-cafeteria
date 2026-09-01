/**
 * Optional voice feedback via Web Speech API synthesis.
 */

/**
 * @returns {boolean}
 */
export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * @param {string} text
 * @param {{ lang?: string; rate?: number }} [options]
 */
export function speakFeedback(text, options = {}) {
  if (!isSpeechSynthesisSupported() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || "en-IN";
    utterance.rate = options.rate ?? 1;
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.warn("TTS unavailable:", error);
  }
}

export function stopSpeaking() {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}
