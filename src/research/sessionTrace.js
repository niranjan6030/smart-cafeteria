/**
 * Pure ordering-session trace. Every dispatched command (manual or voice) appends an entry; the
 * reducer folds it into the aggregate metrics that a `voice_sessions` doc carries at session end.
 *
 * The headline signal is the fallback classifier: when a voice command FAILS, the very next
 * command reveals the recovery path — a manual command is a voice→manual fallback (the study's
 * central friction outcome), another voice command is a retry. Pure and dependency-free so the
 * classifier is unit-testable and identical on every call site.
 */

/**
 * @typedef {Object} TraceEntry
 * @property {'manual' | 'voice' | 'hybrid'} modality
 * @property {string} commandType
 * @property {boolean} success
 * @property {number} ts
 * @property {number | null} [latencyMs]
 */

/** @typedef {'voice_to_manual' | 'voice_retry'} FallbackSignal */

/** @typedef {Object} SessionTrace
 * @property {TraceEntry[]} entries
 * @property {number} interactionCount
 * @property {number} manualCount
 * @property {number} voiceCount
 * @property {number} voiceSuccessCount
 * @property {number} voiceFailureCount
 * @property {number} voiceToManualFallbacks
 * @property {number} voiceRetries
 * @property {number | null} firstTs
 * @property {number | null} lastTs
 * @property {number[]} voiceLatenciesMs
 * @property {boolean} checkoutSucceeded
 */

/** @returns {SessionTrace} */
export function createSessionTrace() {
  return {
    entries: [],
    interactionCount: 0,
    manualCount: 0,
    voiceCount: 0,
    voiceSuccessCount: 0,
    voiceFailureCount: 0,
    voiceToManualFallbacks: 0,
    voiceRetries: 0,
    firstTs: null,
    lastTs: null,
    voiceLatenciesMs: [],
    checkoutSucceeded: false,
  };
}

/**
 * Classify the recovery pattern triggered by a failed voice command.
 * @param {TraceEntry} prev
 * @param {TraceEntry} next
 * @returns {FallbackSignal | null}
 */
function classifyRecovery(prev, next) {
  if (!prev || prev.modality !== "voice" || prev.success) return null;
  if (next.modality === "manual") return "voice_to_manual";
  if (next.modality === "voice") return "voice_retry";
  return null;
}

/**
 * @param {SessionTrace} trace
 * @param {Omit<TraceEntry, 'ts'> & { ts?: number }} entry — ts is optional; when omitted it is
 *   stamped with Date.now() here (epoch ms) so the caller's render-time code stays pure.
 * @returns {{ trace: SessionTrace; signal: { type: FallbackSignal; from: string; to: string } | null }}
 */
export function appendTraceEntry(trace, entry) {
  const stamped = entry.ts == null ? { ...entry, ts: Date.now() } : entry;
  const prev = trace.entries[trace.entries.length - 1];
  const signal = classifyRecovery(prev, stamped);

  return {
    trace: {
      ...trace,
      entries: [...trace.entries, stamped],
      interactionCount: trace.interactionCount + 1,
      manualCount: trace.manualCount + (stamped.modality === "manual" ? 1 : 0),
      voiceCount: trace.voiceCount + (stamped.modality === "voice" ? 1 : 0),
      voiceSuccessCount: trace.voiceSuccessCount + (stamped.modality === "voice" && stamped.success ? 1 : 0),
      voiceFailureCount: trace.voiceFailureCount + (stamped.modality === "voice" && !stamped.success ? 1 : 0),
      voiceToManualFallbacks:
        trace.voiceToManualFallbacks + (signal === "voice_to_manual" ? 1 : 0),
      voiceRetries: trace.voiceRetries + (signal === "voice_retry" ? 1 : 0),
      firstTs: trace.firstTs ?? stamped.ts,
      lastTs: stamped.ts,
      voiceLatenciesMs:
        stamped.modality === "voice" && stamped.latencyMs != null
          ? [...trace.voiceLatenciesMs, stamped.latencyMs]
          : trace.voiceLatenciesMs,
    },
    signal: signal
      ? { type: signal, from: prev.commandType, to: stamped.commandType }
      : null,
  };
}

/**
 * Mark the session as ending in a successfully placed order. Also sets lastTs so duration spans
 * the checkout completion, not just the last command.
 * @param {SessionTrace} trace
 * @returns {SessionTrace}
 */
export function markCheckoutSucceeded(trace) {
  return { ...trace, checkoutSucceeded: true, lastTs: Date.now() };
}

/**
 * @param {SessionTrace} trace
 * @returns {{ interactionCount: number; manualCount: number; voiceCount: number; voiceSuccessCount: number; voiceFailureCount: number; voiceToManualFallbacks: number; voiceRetries: number; firstTs: number | null; lastTs: number | null; durationMs: number; avgVoiceLatencyMs: number; modalityMix: number; checkoutSucceeded: boolean }}
 */
export function summarizeSession(trace) {
  const durationMs = trace.firstTs == null ? 0 : Math.max(0, (trace.lastTs ?? trace.firstTs) - trace.firstTs);
  const avgVoiceLatencyMs = trace.voiceLatenciesMs.length
    ? trace.voiceLatenciesMs.reduce((sum, ms) => sum + ms, 0) / trace.voiceLatenciesMs.length
    : 0;
  const total = Math.max(1, trace.manualCount + trace.voiceCount);
  return {
    interactionCount: trace.interactionCount,
    manualCount: trace.manualCount,
    voiceCount: trace.voiceCount,
    voiceSuccessCount: trace.voiceSuccessCount,
    voiceFailureCount: trace.voiceFailureCount,
    voiceToManualFallbacks: trace.voiceToManualFallbacks,
    voiceRetries: trace.voiceRetries,
    firstTs: trace.firstTs,
    lastTs: trace.lastTs,
    durationMs,
    avgVoiceLatencyMs,
    modalityMix: trace.voiceCount / total,
    checkoutSucceeded: trace.checkoutSucceeded,
  };
}
