import { useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported } from "../../voice/stt/webSpeechProvider.js";
import { VoiceRecognitionManager } from "../../voice/stt/voiceRecognitionManager.js";

/**
 * Assistant-scoped push-to-talk. Reuses the app's battle-tested VoiceRecognitionManager (fresh
 * recognizer per session, single-flight start/stop, permission auto-resume) but routes the final
 * transcript to the Food Assistant instead of the ordering command engine — the two voice paths
 * never compete for the microphone.
 */
export function useAssistantVoice({ onFinal } = {}) {
  const supported = isSpeechRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);

  const managerRef = useRef(null);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    if (!supported) return undefined;
    const manager = new VoiceRecognitionManager({
      onStateChange: (state) => {
        setListening(state === "starting" || state === "listening");
        if (state === "idle") setInterim("");
      },
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        setInterim("");
        onFinalRef.current?.(text);
      },
      onError: (err) => setError(err?.message || "Microphone unavailable"),
    });
    managerRef.current = manager;
    return () => manager.abort();
  }, [supported]);

  const toggle = () => {
    setError(null);
    if (!managerRef.current) return;
    if (listening) managerRef.current.stop();
    else managerRef.current.start();
  };

  return { supported, listening, interim, error, toggle };
}
