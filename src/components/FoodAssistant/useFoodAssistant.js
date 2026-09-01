import { useCallback, useEffect, useRef, useState } from "react";
import { sendAssistantTurn } from "./assistantClient.js";

let nextId = 0;
const uid = () => `am_${++nextId}_${Date.now().toString(36)}`;

function serializeHistory(messages) {
  return messages.map((message) =>
    message.role === "user"
      ? { role: "user", content: message.content, kind: message.kind, data: message.data }
      : { role: "assistant", content: message.content, type: message.type, data: message.data, constraints: message.constraints }
  );
}

async function fetchTurn(runTurn, history, getToken, context) {
  if (runTurn) return runTurn(history);
  const token = getToken ? await getToken() : null;
  return sendAssistantTurn({ messages: history, context: context || {}, idToken: token });
}

/**
 * State + transport for the Food Assistant.
 *
 * The hook is deliberately side-effect free apart from the network call: every cart write the
 * engine proposes comes back as a ProposedAction, and `confirmAction` hands it to the app's
 * command engine via `onAction` — the assistant never mutates ordering state itself.
 *
 * @param {object} options
 * @param {object} options.context — { activeShop, activeTab, cart } forwarded to the backend
 * @param {() => Promise<string>} [options.getToken] — Firebase ID token provider
 * @param {(action: object) => void} [options.onAction] — applies ProposedActions via the command engine
 * @param {(history: Array) => Promise<object>} [options.runTurn] — injectable turn runner for tests
 */
export function useFoodAssistant(options = {}) {
  const { context, getToken, onAction, runTurn } = options;
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const contextRef = useRef(context);
  const getTokenRef = useRef(getToken);
  const onActionRef = useRef(onAction);
  const runTurnRef = useRef(runTurn);
  const messagesRef = useRef(messages);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);
  useEffect(() => {
    runTurnRef.current = runTurn;
  }, [runTurn]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const pushUser = useCallback((content, kind, data) => {
    setMessages((current) => [...current, { id: uid(), role: "user", content, kind, data }]);
  }, []);

  const pushAssistant = useCallback((response) => {
    setMessages((current) => [
      ...current,
      {
        id: uid(),
        role: "assistant",
        content: response.reply,
        type: response.type,
        data: response.data,
        actions: response.actions || [],
        constraints: response.constraints || {},
        suggestions: response.suggestions || [],
        status: response.actions?.length ? "pending" : "done",
      },
    ]);
  }, []);

  const execute = useCallback(
    async (entry) => {
      setBusy(true);
      setError(null);
      const history = serializeHistory([...messagesRef.current, entry]);
      try {
        const response = await fetchTurn(runTurnRef.current, history, getTokenRef.current, contextRef.current);
        pushAssistant(response);
      } catch (err) {
        setError(err?.message || "The food assistant couldn't respond right now.");
      } finally {
        setBusy(false);
      }
    },
    [pushAssistant]
  );

  const send = useCallback(
    async (text) => {
      const content = String(text || "").trim();
      if (!content || busy) return;
      pushUser(content);
      await execute({ id: "x", role: "user", content });
    },
    [busy, pushUser, execute]
  );

  const pick = useCallback(
    async (productId) => {
      if (!productId || busy) return;
      pushUser("", "pick", { productId });
      await execute({ id: "x", role: "user", content: "", kind: "pick", data: { productId } });
    },
    [busy, pushUser, execute]
  );
  const confirmAction = useCallback((action, messageId) => {
    try {
      onActionRef.current?.(action);
    } catch (err) {
      setError(err?.message || "Couldn't apply that.");
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, status: "confirmed" } : message
      )
    );
  }, []);

  const cancelAction = useCallback((messageId) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, status: "cancelled" } : message
      )
    );
  }, []);

  const open = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  return { isOpen, open, close, toggle, messages, busy, error, send, pick, confirmAction, cancelAction };
}
