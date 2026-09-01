import { useCallback, useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported } from "../voice/stt/webSpeechProvider.js";
import { VoiceRecognitionManager } from "../voice/stt/voiceRecognitionManager.js";
import { executeDisambiguationChoice, executeVoiceTranscript } from "../voice/executeVoiceCommand.js";
import { speakFeedback, stopSpeaking } from "../voice/tts/speakFeedback.js";

/**
 * Orchestrates push-to-talk voice ordering: STT → NLU → command dispatch.
 *
 * All SpeechRecognition lifecycle (start/stop/restart/cleanup, retry-with-backoff, permission
 * preflight, single-flight guards) lives in VoiceRecognitionManager — the hook is only a thin
 * React adapter that maps manager events to UI state.
 *
 * The voice pipeline produces the SAME typed AppCommand objects the manual UI does, and every
 * command flows through ctx.dispatch (the shared command engine) — so telemetry and state
 * mutation are single-sourced. The hook only adds the STT layer and voice-specific metadata
 * (transcript, latency) to the dispatch call; it never mutates app state itself.
 *
 * @param {import("../voice/executeVoiceCommand.js").VoiceExecutionContext} voiceContext
 */
export function useVoiceOrdering(voiceContext) {
  const [supported] = useState(() => isSpeechRecognitionSupported());
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [disambiguation, setDisambiguation] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const contextRef = useRef(voiceContext);

  // Keep the latest voiceContext without mutating the ref during render (React purity rule).
  useEffect(() => {
    contextRef.current = voiceContext;
  }, [voiceContext]);

  const clearFeedbackLater = useCallback((ms = 5000) => {
    window.setTimeout(() => setFeedback(null), ms);
  }, []);

  const processTranscript = useCallback(
    (text) => {
      if (!text.trim()) return;
      const startedAt = performance.now();
      const result = executeVoiceTranscript(text, {
        ...contextRef.current,
        // Attach transcript + NLU/execution latency to every command the voice pipeline
        // dispatches, so interaction_events carries them for the research dataset.
        dispatch: (command, meta = {}) =>
          contextRef.current.dispatch(command, {
            ...meta,
            transcript: text,
            latencyMs: Math.round(performance.now() - startedAt),
          }),
      });
      setFeedback(result);
      clearFeedbackLater();

      if (result.disambiguationCandidates?.length) {
        setDisambiguation({
          candidates: result.disambiguationCandidates,
          pendingIntent: result.pendingIntent,
          pendingQuantity: result.pendingQuantity,
        });
      } else {
        setDisambiguation(null);
      }
    },
    [clearFeedbackLater]
  );

  // Manager lifecycle. Created once inside an effect (processTranscript + clearFeedbackLater are
  // stable, so the effect runs once) and held in a ref; every access site is an event handler or
  // effect, never render. Terminal STT failures flow through the command engine as NOOP
  // (success: false) so they land in interaction_events like every other voice interaction.
  const managerRef = useRef(null);
  useEffect(() => {
    const manager = new VoiceRecognitionManager({
      lang: "en-IN",
      continuous: false,
      interimResults: true,
      maxAlternatives: 1,
      maxRetries: 2,
      backoffBaseMs: 500,
      onStateChange: (state) => setListening(state === "starting" || state === "listening"),
      onInterim: setInterimTranscript,
      onFinal: (text) => {
        setTranscript(text);
        setInterimTranscript("");
        processTranscript(text);
      },
      onError: (error, retrying) => {
        if (!retrying && !error.waiting) {
          contextRef.current.dispatch(
            { type: "NOOP", reason: error.message, modality: "voice" },
            { meta: { stt_error: true, code: error.code } }
          );
        }
        const tone = error.waiting ? "info" : retrying ? "info" : "error";
        setFeedback({
          success: false,
          message: error.message,
          tone,
        });
        clearFeedbackLater(error.waiting ? 25000 : retrying ? 2500 : 8000);
      },
      onSessionEnd: () => {
        setListening(false);
        setInterimTranscript("");
      },
    });
    managerRef.current = manager;
    return () => {
      manager.abort();
      stopSpeaking();
    };
  }, [processTranscript, clearFeedbackLater]);

  const startListening = useCallback(() => {
    if (!supported) return;

    stopSpeaking();
    setTranscript("");
    setInterimTranscript("");
    setDisambiguation(null);
    setFeedback(null);
    setVoiceEnabled(true);
    managerRef.current?.start();
  }, [supported]);

  const stopListening = useCallback(() => {
    managerRef.current?.stop();
    setListening(false);
    setInterimTranscript("");
  }, []);

  const toggleListening = useCallback(() => {
    if (managerRef.current?.isActive) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  const pickDisambiguation = useCallback(
    (candidate) => {
      if (!disambiguation) return;
      const result = executeDisambiguationChoice(
        candidate,
        {
          pendingIntent: disambiguation.pendingIntent,
          pendingQuantity: disambiguation.pendingQuantity,
        },
        {
          ...contextRef.current,
          dispatch: (command, meta = {}) =>
            contextRef.current.dispatch(command, {
              ...meta,
              meta: { ...(meta.meta || {}), disambiguated: true },
            }),
        }
      );
      speakFeedback(result.message);
      setFeedback(result);
      setDisambiguation(null);
      clearFeedbackLater();
    },
    [disambiguation, clearFeedbackLater]
  );

  // Chrome suspends the speech service when the tab is hidden — end cleanly rather than let it
  // surface a spurious network error. Push-to-talk means the user re-taps on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && managerRef.current?.isActive) {
        managerRef.current.stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return {
    supported,
    voiceEnabled,
    listening,
    transcript,
    interimTranscript,
    feedback,
    disambiguation,
    startListening,
    stopListening,
    toggleListening,
    pickDisambiguation,
    dismissDisambiguation: () => setDisambiguation(null),
  };
}
