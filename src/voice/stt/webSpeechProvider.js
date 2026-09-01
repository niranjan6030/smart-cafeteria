/**
 * Web Speech API STT wrapper. Chrome/Edge/Safari; returns null from create if unsupported.
 *
 * Reliability contract: this wrapper never silently swallows a failure. In particular,
 * `start()` returning `false` means the recognizer rejected the call (Chrome throws
 * `InvalidStateError` when `start()` races with an already-active or mid-stop session) — the
 * caller (VoiceRecognitionManager) treats that as a poisoned session and recreates with backoff,
 * which is exactly what fixes the recurring "network" error.
 */

/**
 * @returns {boolean}
 */
export function isSpeechRecognitionSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Canonical error map for `SpeechRecognitionErrorEvent.error` values plus our own synthetic
 * codes. `retryable` distinguishes service hiccups (auto-retry) from hard failures (surface to
 * the user, no retry loop).
 */
export const RECOGNITION_ERRORS = {
  network: { code: "network", retryable: true, message: "Speech service hiccup. Retrying..." },
  "invalid-state": { code: "invalid-state", retryable: true, message: "Speech session was busy. Restarting..." },
  "no-speech": { code: "no-speech", retryable: false, message: "No speech detected. Tap the mic and try again." },
  "not-allowed": { code: "not-allowed", retryable: false, message: "Microphone permission denied. Allow mic access in browser settings, then tap again." },
  "service-not-allowed": { code: "service-not-allowed", retryable: false, message: "Speech service is blocked. Check browser site settings." },
  "audio-capture": { code: "audio-capture", retryable: false, message: "No microphone detected. Connect one and tap the mic again." },
  aborted: { code: "aborted", retryable: false, message: "Listening stopped." },
  "language-not-supported": { code: "language-not-supported", retryable: false, message: "This language is not supported for speech recognition." },
};

/**
 * @param {string} rawError
 * @returns {{ code: string; retryable: boolean; message: string }}
 */
export function mapRecognitionError(rawError) {
  return RECOGNITION_ERRORS[rawError] || {
    code: rawError || "unknown",
    retryable: false,
    message: `Speech recognition error: ${rawError}`,
  };
}

/**
 * Subscribe to microphone-permission changes (Permissions API `change` event). Reports the current
 * state immediately, then again whenever it flips (e.g. the user answering the prompt). Returns an
 * unsubscribe function; safe no-op when the API is unavailable.
 *
 * @param {(state: 'granted' | 'denied' | 'prompt') => void} onState
 * @returns {() => void}
 */
export function createPermissionWatcher(onState) {
  if (typeof navigator === "undefined" || !navigator.permissions || !navigator.permissions.query) {
    return () => {};
  }
  let statusRef = null;
  let disposed = false;
  const onChange = () => {
    if (!disposed && statusRef) onState(statusRef.state);
  };
  const cleanup = () => {
    disposed = true;
    if (statusRef) {
      statusRef.removeEventListener("change", onChange);
      statusRef = null;
    }
  };
  navigator.permissions
    .query({ name: "microphone" })
    .then((status) => {
      if (disposed) return;
      statusRef = status;
      onState(status.state);
      status.addEventListener("change", onChange);
    })
    .catch(() => {});
  return cleanup;
}

/**
 * @param {{
 *   lang?: string;
 *   continuous?: boolean;
 *   interimResults?: boolean;
 *   maxAlternatives?: number;
 *   onResult?: (transcript: string, isFinal: boolean) => void;
 *   onListeningStart?: () => void;
 *   onError?: (error: { code: string; retryable: boolean; message: string }) => void;
 *   onEnd?: () => void;
 * }} options
 * @returns {{ start: () => boolean; stop: () => void; abort: () => void } | null}
 */
export function createSpeechRecognizer(options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = options.lang || "en-IN";
  recognition.continuous = options.continuous ?? false;
  recognition.interimResults = options.interimResults ?? true;
  recognition.maxAlternatives = options.maxAlternatives ?? 1;

  recognition.onresult = (event) => {
    let transcript = "";
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    options.onResult?.(transcript.trim(), isFinal);
  };

  recognition.onerror = (event) => {
    options.onError?.(mapRecognitionError(event.error));
  };

  recognition.onaudiostart = () => {
    options.onListeningStart?.();
  };

  recognition.onend = () => {
    options.onEnd?.();
  };

  return {
    start() {
      try {
        recognition.start();
        return true;
      } catch {
        // InvalidStateError (already started / mid-stop) — surface it, never swallow.
        options.onError?.(mapRecognitionError("invalid-state"));
        return false;
      }
    },
    stop() {
      try {
        recognition.stop();
      } catch {
        /* already stopped — nothing to do */
      }
    },
    abort() {
      try {
        recognition.abort();
      } catch {
        /* already stopped — nothing to do */
      }
    },
  };
}
