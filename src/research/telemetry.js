import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";

const SESSION_KEY = "ordering_session_id";

/** @returns {string} */
export function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `sess_${Date.now()}`;
  }
}

/**
 * Fire-and-forget interaction log for manual + voice research metrics.
 * @param {{
 *   user: { uid?: string; email?: string } | null;
 *   abGroup?: string;
 *   modality: 'manual' | 'voice' | 'hybrid';
 *   commandType: string;
 *   success: boolean;
 *   message?: string;
 *   activeShop?: string;
 *   transcript?: string;
 *   meta?: object;
 *   latencyMs?: number;
 * }} payload
 */
export async function logInteractionEvent(payload) {
  try {
    await addDoc(collection(db, "interaction_events"), {
      student_uid: payload.user?.uid || "guest",
      student_email: payload.user?.email || null,
      test_group: payload.abGroup || localStorage.getItem("ab_testing_group") || "Unknown",
      session_id: getOrCreateSessionId(),
      modality: payload.modality,
      command_type: payload.commandType,
      success: payload.success,
      message: payload.message || "",
      active_shop: payload.activeShop || "",
      transcript: payload.transcript || null,
      meta: payload.meta || {},
      latency_ms: payload.latencyMs ?? null,
      created_at: serverTimestamp(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("Interaction telemetry write failed:", error);
  }
}

/**
 * Fire-and-forget ordering-session summary for `voice_sessions`. Written once per session by the
 * Phase 2 session manager when the session ends (checkout, pagehide) and only for sessions that
 * included at least one voice command — manual-only sessions stay event-granular in
 * interaction_events (grouped by session_id).
 * @param {{
 *   user: { uid?: string; email?: string } | null;
 *   abGroup?: string;
 *   sessionId?: string;
 *   summary: ReturnType<import("./sessionTrace.js").summarizeSession>;
 * }} payload
 */
export async function logVoiceSession(payload) {
  const s = payload.summary;
  try {
    await addDoc(collection(db, "voice_sessions"), {
      student_uid: payload.user?.uid || "guest",
      student_email: payload.user?.email || null,
      test_group: payload.abGroup || localStorage.getItem("ab_testing_group") || "Unknown",
      session_id: payload.sessionId || getOrCreateSessionId(),
      interaction_count: s.interactionCount,
      manual_count: s.manualCount,
      voice_count: s.voiceCount,
      voice_success_count: s.voiceSuccessCount,
      voice_failure_count: s.voiceFailureCount,
      voice_to_manual_fallbacks: s.voiceToManualFallbacks,
      voice_retries: s.voiceRetries,
      duration_ms: Math.round(s.durationMs),
      avg_voice_latency_ms: Math.round(s.avgVoiceLatencyMs),
      modality_mix: s.modalityMix,
      checkout_succeeded: s.checkoutSucceeded,
      started_at: s.firstTs == null ? null : new Date(s.firstTs).toISOString(),
      ended_at: s.lastTs == null ? null : new Date(s.lastTs).toISOString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("Session summary write failed:", error);
  }
}
