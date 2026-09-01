import { createPermissionWatcher, createSpeechRecognizer } from "./webSpeechProvider.js";

/**
 * VoiceRecognitionManager — framework-agnostic lifecycle owner for the Web Speech API.
 *
 * Fixes the root cause of the recurring "network" error: Chrome's speech service cannot start a
 * new session until the previous session has fully ended (onend), and it fails outright while the
 * microphone permission prompt is still pending. The manager therefore:
 *
 *  1. Is a strict state machine (idle → starting → listening → stopping → idle).
 *  2. Is single-flight — a second start() while active is rejected, never raced.
 *  3. Uses a FRESH recognizer per session, so a poisoned instance is always discarded.
 *  4. Restarts ONLY from onend (never from onerror), with exponential backoff for retryable
 *     (network / invalid-state) errors, capped at maxRetries, plus ONE longer last-chance retry.
 *  5. Watches the microphone permission: if a session dies while the permission prompt is still
 *     pending, it waits (with a safety timeout) and AUTO-RESUMES the instant the user clicks
 *     "Allow" — no manual re-tap.
 *  6. Guards async callbacks with a session id so a stop()/abort() can never resurrect a stale
 *     retry (no infinite restart loops, no resource leaks).
 *  7. Preflights the mic permission where the Permissions API exists.
 *
 * The manager holds no React state and performs no I/O other than delegating to the injected
 * recognizer factory and permission watcher, so every transition is unit-testable with mocks.
 */

export const MANAGER_STATE = Object.freeze({
  IDLE: "idle",
  STARTING: "starting",
  LISTENING: "listening",
  STOPPING: "stopping",
});

/** @typedef {keyof typeof MANAGER_STATE} ManagerState */

/**
 * Default mic-permission preflight via the Permissions API (Chrome 78+). Resolves "unknown" when
 * the API is unavailable so start() is never blocked by permission queries.
 * @returns {Promise<'granted' | 'denied' | 'prompt' | 'unknown'>}
 */
export function queryMicrophonePermission() {
  if (typeof navigator === "undefined" || !navigator.permissions || !navigator.permissions.query) {
    return Promise.resolve("unknown");
  }
  return navigator.permissions
    .query({ name: "microphone" })
    .then((status) => status.state)
    .catch(() => "unknown");
}

/**
 * @typedef {Object} RecognitionError
 * @property {string} code
 * @property {boolean} retryable
 * @property {string} message
 * @property {boolean} [waiting] — set when the error is actually a "waiting for permission" state
 */

export class VoiceRecognitionManager {
  /**
   * @param {{
   *   createRecognizer?: (options: object) => { start: () => boolean; stop: () => void; abort: () => void } | null;
   *   getPermissionState?: (name: string) => Promise<string>;
   *   permissionWatcher?: (onState: (state: string) => void) => (() => void) | void;
   *   lang?: string;
   *   continuous?: boolean;
   *   interimResults?: boolean;
   *   maxAlternatives?: number;
   *   maxRetries?: number;
   *   backoffBaseMs?: number;
   *   lastChanceDelayMs?: number;
   *   permissionWaitMs?: number;
   *   onStateChange?: (state: ManagerState) => void;
   *   onInterim?: (text: string) => void;
   *   onFinal?: (text: string) => void;
   *   onError?: (error: RecognitionError, retrying: boolean) => void;
   *   onSessionEnd?: () => void;
   * }} config
   */
  constructor(config = {}) {
    this.createRecognizer = config.createRecognizer || createSpeechRecognizer;
    this.getPermissionState = config.getPermissionState || queryMicrophonePermission;
    this.permissionWatcher = config.permissionWatcher || createPermissionWatcher;
    this.maxRetries = config.maxRetries ?? 2;
    this.backoffBaseMs = config.backoffBaseMs ?? 800;
    this.lastChanceDelayMs = config.lastChanceDelayMs ?? 4000;
    this.permissionWaitMs = config.permissionWaitMs ?? 20000;
    this.onStateChange = config.onStateChange;
    this.onInterim = config.onInterim;
    this.onFinal = config.onFinal;
    this.onError = config.onError;
    this.onSessionEnd = config.onSessionEnd;
    this.config = {
      lang: config.lang || "en-IN",
      continuous: config.continuous ?? false,
      interimResults: config.interimResults ?? true,
      maxAlternatives: config.maxAlternatives ?? 1,
    };

    /** @type {ManagerState} */
    this.state = MANAGER_STATE.IDLE;
    /** @type {{ start: () => boolean; stop: () => void; abort: () => void } | null} */
    this.recognizer = null;
    this.stopRequested = false;
    this.retryCount = 0;
    this.sessionId = 0;
    this.retryTimer = null;
    this.lastChanceUsed = false;
    this.permissionCleanup = null;
    this.watchedSessionId = null;
  }

  /** @returns {boolean} true when the mic is (or is about to be) live. */
  get isActive() {
    return this.state === MANAGER_STATE.STARTING || this.state === MANAGER_STATE.LISTENING || this.state === MANAGER_STATE.STOPPING;
  }

  /**
   * Begin a listening session. Single-flight: returns false if one is already active or stopping.
   * @returns {boolean}
   */
  start() {
    if (this.state === MANAGER_STATE.STARTING || this.state === MANAGER_STATE.LISTENING || this.state === MANAGER_STATE.STOPPING) {
      return false;
    }
    this.stopRequested = false;
    this.retryCount = 0; // an explicit start resets the retry budget
    this.lastChanceUsed = false; // ...and the last-chance cooldown
    this.#clearPermissionWatch();
    this.#setState(MANAGER_STATE.STARTING);
    // Mic-permission preflight. Non-blocking: the session begins on the next microtask.
    this.#checkMicPermission().then((permission) => {
      if (this.stopRequested || this.state === MANAGER_STATE.STOPPING || this.state === MANAGER_STATE.IDLE) {
        this.#finishIfStopped();
        return;
      }
      if (permission === "denied") {
        this.recognizer = null;
        this.#setState(MANAGER_STATE.IDLE);
        this.#emitError({ code: "not-allowed", retryable: false, message: "Microphone permission is blocked. Allow mic access in your browser settings." }, false);
        return;
      }
      this.#beginSession();
    });
    return true;
  }

  /** Graceful stop: lets the current utterance finish, then ends. Never auto-restarts. */
  stop() {
    this.stopRequested = true;
    this.sessionId += 1; // invalidate in-flight callbacks from the session we're ending
    this.#clearPermissionWatch();
    if (this.state === MANAGER_STATE.LISTENING || this.state === MANAGER_STATE.STARTING) {
      this.#setState(MANAGER_STATE.STOPPING);
      this.recognizer?.stop();
    } else {
      this.#setState(MANAGER_STATE.IDLE);
    }
  }

  /** Hard stop for teardown (unmount): aborts immediately and invalidates pending callbacks. */
  abort() {
    this.stopRequested = true;
    this.sessionId += 1; // any in-flight permission/retry callback now sees a stale session
    this.#clearPermissionWatch();
    try {
      this.recognizer?.abort();
    } catch {
      /* ignore */
    }
    this.recognizer = null;
    this.#setState(MANAGER_STATE.IDLE);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  #setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
  }

  #emitError(error, retrying) {
    this.onError?.(error, Boolean(retrying));
  }

  #clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  #clearPermissionWatch() {
    this.#clearRetryTimer();
    if (this.permissionCleanup) {
      try {
        this.permissionCleanup();
      } catch {
        /* ignore */
      }
      this.permissionCleanup = null;
    }
    this.watchedSessionId = null;
  }

  async #checkMicPermission() {
    try {
      return await this.getPermissionState("microphone");
    } catch {
      return "unknown";
    }
  }

  #beginSession() {
    this.sessionId += 1; // this session now owns subsequent async callbacks
    const sessionForStart = this.sessionId;
    const recognizer = this.createRecognizer({
      ...this.config,
      onListeningStart: () => {
        if (this.stopRequested || sessionForStart !== this.sessionId) return;
        this.#setState(MANAGER_STATE.LISTENING);
      },
      onResult: (text, isFinal) => {
        if (sessionForStart !== this.sessionId) return;
        if (isFinal) {
          this.retryCount = 0; // a successful recognition means the service is healthy
          this.lastChanceUsed = false;
          this.onFinal?.(text);
        } else {
          this.onInterim?.(text);
        }
      },
      onError: (error) => this.#handleError(error, sessionForStart),
      onEnd: () => this.#handleEnd(),
    });
    if (!recognizer) {
      this.#setState(MANAGER_STATE.IDLE);
      this.#emitError({ code: "unsupported", retryable: false, message: "Speech recognition is not supported in this browser." }, false);
      return;
    }
    this.recognizer = recognizer;
    recognizer.start();
    // If start() returned false, the recognizer already surfaced an invalid-state error via
    // onError → #handleError routes it through the retry path.
  }

  #handleError(error, sessionForStart) {
    if (this.stopRequested || sessionForStart !== this.sessionId) return; // stale session
    this.recognizer = null; // this session is dead

    if (!error.retryable) {
      this.#setState(MANAGER_STATE.IDLE);
      this.#emitError(error, false);
      return;
    }

    this.retryCount += 1;

    if (this.retryCount > this.maxRetries) {
      // Budget exhausted — ONE last chance with a real cooldown, then give up honestly.
      if (!this.lastChanceUsed) {
        this.lastChanceUsed = true;
        this.#setState(MANAGER_STATE.IDLE);
        this.#emitError(error, true);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.stopRequested || sessionForStart !== this.sessionId) return;
          this.#beginSession();
        }, this.lastChanceDelayMs);
        return;
      }
      this.#setState(MANAGER_STATE.IDLE);
      this.#emitError(
        { ...error, message: "Speech service is temporarily unavailable. Check your connection, then tap the mic to retry." },
        false
      );
      return;
    }

    this.#setState(MANAGER_STATE.IDLE);
    this.#emitError(error, true);

    // Before hammering the service again, check whether the mic permission prompt is still
    // pending — the most common real cause of repeated network errors on first use.
    this.#checkMicPermission().then((permission) => {
      if (this.stopRequested || sessionForStart !== this.sessionId) return;
      if (permission === "denied") {
        this.#setState(MANAGER_STATE.IDLE);
        this.#emitError(
          { code: "not-allowed", retryable: false, message: "Microphone access is blocked. Allow the mic in browser settings, then tap again." },
          false
        );
        return;
      }
      if (permission === "prompt") {
        this.#setState(MANAGER_STATE.IDLE);
        this.#emitError(
          {
            code: "permission-wait",
            retryable: false,
            waiting: true,
            message: "Waiting for microphone access — listening will resume once you allow it.",
          },
          false
        );
        this.#waitForPermissionGrant(sessionForStart);
        return;
      }
      this.#scheduleRetry(sessionForStart);
    });
  }

  #scheduleRetry(sessionForStart) {
    const delay = Math.min(this.backoffBaseMs * 2 ** (this.retryCount - 1), 4000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopRequested || sessionForStart !== this.sessionId) return; // stop/abort won
      this.#beginSession();
    }, delay);
  }

  #waitForPermissionGrant(sessionForStart) {
    this.watchedSessionId = sessionForStart;
    const onPermission = (state) => {
      if (sessionForStart !== this.sessionId || this.stopRequested) return;
      if (state === "granted") {
        // The user allowed the mic — resume listening without any manual re-tap.
        this.#clearPermissionWatch();
        this.#beginSession();
      } else if (state === "denied") {
        this.#clearPermissionWatch();
        this.#setState(MANAGER_STATE.IDLE);
        this.#emitError(
          { code: "not-allowed", retryable: false, message: "Microphone access was denied. Allow the mic in browser settings, then tap again." },
          false
        );
      }
      // 'prompt' → keep waiting
    };
    let cleanup;
    try {
      cleanup = this.permissionWatcher(onPermission) || null;
    } catch {
      cleanup = null;
    }
    this.permissionCleanup = cleanup;
    // Safety timeout — never wait for permission indefinitely.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (sessionForStart !== this.sessionId) return;
      this.#clearPermissionWatch();
      this.#setState(MANAGER_STATE.IDLE);
      this.#emitError(
        { code: "not-allowed", retryable: false, message: "Microphone access was not granted. Tap the mic to try again." },
        false
      );
    }, this.permissionWaitMs);
  }

  #handleEnd() {
    if (this.stopRequested) {
      this.stopRequested = false;
      this.recognizer = null;
      this.#setState(MANAGER_STATE.IDLE);
      this.onSessionEnd?.();
      return;
    }
    if (this.retryTimer) return; // a retry is scheduled; it owns the session now
    this.recognizer = null;
    this.#setState(MANAGER_STATE.IDLE);
    this.onSessionEnd?.();
  }

  #finishIfStopped() {
    if (this.stopRequested) {
      this.stopRequested = false;
      this.#setState(MANAGER_STATE.IDLE);
      this.onSessionEnd?.();
    }
  }
}
