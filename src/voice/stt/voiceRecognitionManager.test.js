import { describe, expect, it } from "vitest";
import { MANAGER_STATE, VoiceRecognitionManager } from "./voiceRecognitionManager.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A mock SpeechRecognition wrapper in the exact shape createSpeechRecognizer produces. The
 * factory records every created instance so tests can assert session churn and fire events.
 */
function createMockFactory() {
  const instances = [];
  return {
    instances,
    make(options) {
      const inst = {
        id: instances.length + 1,
        started: false,
        startCalls: 0,
        stopCalls: 0,
        abortCalls: 0,
        options,
        fireListeningStart: () => options.onListeningStart?.(),
        fireResult: (text, isFinal) => options.onResult?.(text, isFinal),
        fireError: (error) => options.onError?.(error),
        fireEnd: () => options.onEnd?.(),
        start() {
          this.startCalls += 1;
          if (this.started) {
            options.onError?.({ code: "invalid-state", retryable: true, message: "busy" });
            return false;
          }
          this.started = true;
          options.onListeningStart?.(); // Chrome fires onaudiostart after a successful start
          return true;
        },
        stop() {
          this.stopCalls += 1;
          this.started = false;
          options.onEnd?.();
        },
        abort() {
          this.abortCalls += 1;
          this.started = false;
          options.onEnd?.();
        },
      };
      instances.push(inst);
      return inst;
    },
  };
}

function setup({
  maxRetries = 2,
  backoffBaseMs = 5,
  lastChanceDelayMs = 8,
  permissionWaitMs = 20000,
  permission = "granted",
  permissionWatcher,
} = {}) {
  const factory = createMockFactory();
  const events = [];
  const manager = new VoiceRecognitionManager({
    createRecognizer: factory.make,
    maxRetries,
    backoffBaseMs,
    lastChanceDelayMs,
    permissionWaitMs,
    getPermissionState: async () => permission,
    permissionWatcher: permissionWatcher || (() => () => {}),
    onStateChange: (state) => events.push(["state", state]),
    onInterim: (text) => events.push(["interim", text]),
    onFinal: (text) => events.push(["final", text]),
    onError: (error, retrying) => events.push(["error", error.code, retrying]),
    onSessionEnd: () => events.push(["end"]),
  });
  return { manager, factory, events };
}

describe("VoiceRecognitionManager — lifecycle", () => {
  it("starts a session and reaches LISTENING on audio start", async () => {
    const { manager, factory } = setup();
    expect(manager.start()).toBe(true);
    expect(manager.state).toBe(MANAGER_STATE.STARTING);
    await flush();
    expect(factory.instances.length).toBe(1);
    expect(manager.state).toBe(MANAGER_STATE.LISTENING);
    expect(manager.isActive).toBe(true);
  });

  it("is single-flight: a second start() while active is rejected", async () => {
    const { manager, factory } = setup();
    manager.start();
    expect(manager.start()).toBe(false);
    await flush();
    expect(factory.instances.length).toBe(1);
    expect(factory.instances[0].startCalls).toBe(1);
  });

  it("stop() ends the session cleanly without auto-restarting", async () => {
    const { manager, factory } = setup();
    manager.start();
    await flush();
    manager.stop();
    expect(factory.instances[0].stopCalls).toBe(1);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
    await wait(15);
    expect(factory.instances.length).toBe(1); // no restart
  });

  it("abort() hard-stops the active session", async () => {
    const { manager, factory } = setup();
    manager.start();
    await flush();
    manager.abort();
    expect(factory.instances[0].abortCalls).toBe(1);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
    expect(manager.isActive).toBe(false);
  });

  it("streams interim results then final results", async () => {
    const { manager, factory, events } = setup();
    manager.start();
    await flush();
    factory.instances[0].fireResult("masala", false);
    factory.instances[0].fireResult("masala dosa", true);
    expect(events).toContainEqual(["interim", "masala"]);
    expect(events).toContainEqual(["final", "masala dosa"]);
  });
});

describe("VoiceRecognitionManager — error recovery", () => {
  it("retries network errors with backoff, then one last chance, then gives up", async () => {
    const { manager, factory, events } = setup({ maxRetries: 2, backoffBaseMs: 5, lastChanceDelayMs: 8 });
    manager.start();
    await flush();

    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    expect(events).toContainEqual(["error", "network", true]); // "retrying" surfaced
    await wait(10);
    expect(factory.instances.length).toBe(2);

    factory.instances[1].fireError({ code: "network", retryable: true, message: "hiccup" });
    await wait(12);
    expect(factory.instances.length).toBe(3);

    factory.instances[2].fireError({ code: "network", retryable: true, message: "hiccup" });
    await wait(12);
    expect(factory.instances.length).toBe(4); // last-chance cooldown retried once more

    factory.instances[3].fireError({ code: "network", retryable: true, message: "hiccup" });
    expect(events.at(-1)).toEqual(["error", "network", false]); // terminal, not retrying
    await wait(20);
    expect(factory.instances.length).toBe(4); // truly exhausted — no zombie sessions
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("does not retry a non-retryable error (no-speech)", async () => {
    const { manager, factory, events } = setup();
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "no-speech", retryable: false, message: "no speech" });
    await wait(15);
    expect(factory.instances.length).toBe(1);
    expect(events.at(-1)).toEqual(["error", "no-speech", false]);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("a scheduled retry is cancelled by stop() — no zombie restarts", async () => {
    const { manager, factory } = setup({ backoffBaseMs: 5 });
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    manager.stop(); // user gives up during the backoff window
    await wait(20);
    expect(factory.instances.length).toBe(1);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("abort() during a backoff window prevents the retry from firing", async () => {
    const { manager, factory } = setup({ backoffBaseMs: 5 });
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    manager.abort();
    await wait(20);
    expect(factory.instances.length).toBe(1);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("a successful final result resets the retry budget", async () => {
    const { manager, factory } = setup({ maxRetries: 1, backoffBaseMs: 5 });
    manager.start();
    await flush();
    factory.instances[0].fireResult("masala dosa", true);
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    await wait(10);
    expect(factory.instances.length).toBe(2); // retried despite maxRetries=1, because result reset the budget
  });
});

describe("VoiceRecognitionManager — permission-aware recovery", () => {
  it("waits for the mic permission prompt and auto-resumes once granted", async () => {
    const grantedCb = { fn: null };
    const fakeWatcher = (onState) => {
      grantedCb.fn = onState;
      return () => {
        grantedCb.fn = null;
      };
    };
    const { manager, factory, events } = setup({ permission: "prompt", permissionWatcher: fakeWatcher });
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    await flush(); // let the async permission check resolve before asserting
    expect(events).toContainEqual(["error", "permission-wait", false]);

    grantedCb.fn("granted"); // user clicks "Allow" on the browser prompt
    await flush();
    expect(factory.instances.length).toBe(2); // auto-resumed — no manual re-tap
    expect(manager.state).toBe(MANAGER_STATE.LISTENING);
  });

  it("emits a clear message if the permission is denied while waiting", async () => {
    const grantedCb = { fn: null };
    const fakeWatcher = (onState) => {
      grantedCb.fn = onState;
      return () => {};
    };
    const { manager, factory, events } = setup({ permission: "prompt", permissionWatcher: fakeWatcher });
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    await flush(); // let the async permission check resolve before asserting
    grantedCb.fn("denied");
    await flush();
    expect(factory.instances.length).toBe(1);
    expect(events.at(-1)).toEqual(["error", "not-allowed", false]);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("gives up with a clear message if permission is never granted (safety timeout)", async () => {
    const { manager, factory, events } = setup({ permission: "prompt", permissionWaitMs: 10 });
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    await wait(20);
    expect(factory.instances.length).toBe(1);
    expect(events.some((e) => e[0] === "error" && e[1] === "not-allowed")).toBe(true);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("does not enter the permission-wait when permission is already granted", async () => {
    const { manager, factory, events } = setup({ permission: "granted", backoffBaseMs: 5 });
    manager.start();
    await flush();
    factory.instances[0].fireError({ code: "network", retryable: true, message: "hiccup" });
    expect(events.some((e) => e[0] === "error" && e[1] === "permission-wait")).toBe(false);
    await wait(10);
    expect(factory.instances.length).toBe(2); // plain backoff retry instead
  });
});

describe("VoiceRecognitionManager — permission + unsupported", () => {
  it("blocks the session when the microphone permission is denied", async () => {
    const { manager, factory, events } = setup({ permission: "denied" });
    manager.start();
    await flush();
    expect(factory.instances.length).toBe(0);
    expect(events.some((e) => e[0] === "error" && e[1] === "not-allowed")).toBe(true);
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("reports an unsupported recognizer instead of crashing", async () => {
    const errors = [];
    const manager = new VoiceRecognitionManager({
      createRecognizer: () => null,
      getPermissionState: async () => "prompt",
      onError: (error) => errors.push(error),
    });
    manager.start();
    await flush();
    expect(errors[0].code).toBe("unsupported");
    expect(manager.state).toBe(MANAGER_STATE.IDLE);
  });

  it("ignores events from a stale session after stop (session-id guard)", async () => {
    const { manager, factory, events } = setup();
    manager.start();
    await flush();
    const stale = factory.instances[0];
    manager.stop();
    // A late result from the torn-down session must not be processed.
    stale.fireResult("ghost command", true);
    expect(events.some((e) => e[0] === "final")).toBe(false);
  });
});
