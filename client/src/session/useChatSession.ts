import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentBackend, AgentSessionSummary } from "../lib/agent";
import type { AcpClientEvent } from "../lib/acpClientTypes";
import type { EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "../lib/environment";
import { RemoteAgent } from "../lib/remoteAgent";
import { applyAcpEvent } from "./applyAcpEvent";
import {
  createInitialChatSessionState,
  type ChatSessionState,
  type PermissionRequestState,
  type QueuedMessage,
  type UsageState,
  reduceChatSession,
} from "./chatSessionState";

export interface UseChatSessionOptions {
  agentBackend: AgentBackend;
  initialSession: AgentSessionSummary;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
}

export interface UseChatSessionResult {
  state: ChatSessionState;
  usageLabel: string | null;
  handleSubmit: (text: string) => void;
  handleStop: () => void;
  handleModeChange: (modeId: string) => void;
  handleConfigOptionChange: (configId: string, value: string) => void;
  handlePermissionDecision: (optionId?: string) => void;
  handleQueueSendNow: (id: string) => void;
  handleQueueDelete: (id: string) => void;
  handleQueueEditStart: (id: string) => void;
  handleQueueEditChange: (id: string, text: string) => void;
  handleQueueEditCancel: (id: string) => void;
  handleQueueSaveEdit: (id: string) => void;
}

function formatUsage(usage: UsageState | null): string | null {
  if (!usage) return null;
  const pct = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0;
  const base = `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens (${pct}%)`;
  if (!usage.cost) return base;
  return `${base} · ${usage.cost.amount.toFixed(3)} ${usage.cost.currency}`;
}

export function useChatSession({
  agentBackend,
  initialSession,
  onEnvironmentOfferAvailable,
  onEnvironmentOfferResolved,
}: UseChatSessionOptions): UseChatSessionResult {
  const [state, setState] = useState<ChatSessionState>(createInitialChatSessionState);
  const agentRef = useRef<RemoteAgent | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const isAgentProcessingRef = useRef(false);
  const messageIdRef = useRef(0);
  const pendingPermissionRef = useRef<PermissionRequestState | null>(null);

  const startAgentRun = useCallback((text: string) => {
    isAgentProcessingRef.current = true;
    agentRef.current?.run(text);
  }, []);

  const handleRunCompletion = useCallback((stopReason: string) => {
    setState((prev) => reduceChatSession(prev, { type: "RUN_COMPLETED", stopReason }));
    const next = queueRef.current.shift();
    if (next) {
      setState((prev) => reduceChatSession(prev, { type: "USER_MESSAGE_DEQUEUED", id: next.id }));
      window.setTimeout(() => startAgentRun(next.text), 120);
    } else {
      isAgentProcessingRef.current = false;
    }
  }, [startAgentRun]);

  const onAcpEvent = useCallback((event: AcpClientEvent) => {
    applyAcpEvent(event, {
      dispatch: (action) => setState((prev) => reduceChatSession(prev, action)),
      onRunCompleted: handleRunCompletion,
      onRunFailed: (error, source) => {
        isAgentProcessingRef.current = false;
        setState((prev) => reduceChatSession(prev, { type: "RUN_FAILED", error, source }));
      },
      onPermissionStateChange: (permission) => {
        pendingPermissionRef.current = permission;
      },
      onEnvironmentOfferAvailable,
      onEnvironmentOfferResolved,
    });
  }, [handleRunCompletion, onEnvironmentOfferAvailable, onEnvironmentOfferResolved]);

  useEffect(() => {
    const agent = new RemoteAgent({ backend: agentBackend, session: initialSession, onAcpEvent });
    agentRef.current = agent;
    const timer = window.setTimeout(() => { void agent.connect().catch(() => undefined); }, 0);
    return () => {
      window.clearTimeout(timer);
      if (agentRef.current === agent) agentRef.current = null;
      agent.close();
    };
  }, [agentBackend, initialSession, onAcpEvent]);

  const createQueuedMessage = useCallback((text: string): QueuedMessage => {
    messageIdRef.current += 1;
    const trimmed = text.trim();
    return {
      id: `queued-${messageIdRef.current}`,
      text: trimmed,
      draftText: trimmed,
      isEditing: false,
    };
  }, []);

  const handleSubmit = useCallback((text: string) => {
    if (isAgentProcessingRef.current) {
      const msg = createQueuedMessage(text);
      queueRef.current.push(msg);
      setState((prev) => reduceChatSession(prev, { type: "USER_MESSAGE_QUEUED", message: msg }));
      return;
    }
    startAgentRun(text);
  }, [createQueuedMessage, startAgentRun]);

  const handleStop = useCallback(() => {
    void agentRef.current?.cancel();
  }, []);

  const handleModeChange = useCallback((modeId: string) => {
    void agentRef.current?.setMode(modeId);
  }, []);

  const handleConfigOptionChange = useCallback((configId: string, value: string) => {
    void agentRef.current?.setConfigOption(configId, value);
  }, []);

  const handlePermissionDecision = useCallback((optionId?: string) => {
    const pending = pendingPermissionRef.current;
    if (!pending) return;
    setState((prev) => reduceChatSession(prev, { type: "PERMISSION_CLEARED" }));
    pendingPermissionRef.current = null;
    void agentRef.current?.respondToPermissionRequest(
      pending.requestId,
      optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
    );
  }, []);

  const handleQueueSendNow = useCallback((id: string) => {
    const queueIndex = queueRef.current.findIndex((m) => m.id === id);
    if (queueIndex === -1) return;
    const [msg] = queueRef.current.splice(queueIndex, 1);
    setState((prev) => reduceChatSession(prev, { type: "USER_MESSAGE_DEQUEUED", id }));
    void agentRef.current?.sendSteeringMessage(msg.text).catch((error) => {
      const restored = { ...msg, isEditing: false, draftText: msg.text };
      queueRef.current.splice(Math.min(queueIndex, queueRef.current.length), 0, restored);
      setState((prev) => {
        const next = reduceChatSession(prev, { type: "QUEUED_MESSAGE_RESTORED", message: restored, index: Math.min(queueIndex, prev.queuedMessages.length) });
        return reduceChatSession(next, { type: "RUN_FAILED", error: error instanceof Error ? error.message : String(error), source: "run" });
      });
    });
  }, []);

  const handleQueueDelete = useCallback((id: string) => {
    queueRef.current = queueRef.current.filter((m) => m.id !== id);
    setState((prev) => reduceChatSession(prev, { type: "USER_MESSAGE_DEQUEUED", id }));
  }, []);

  const handleQueueEditStart = useCallback((id: string) => {
    setState((prev) => reduceChatSession(prev, { type: "QUEUED_MESSAGE_EDIT_STARTED", id }));
  }, []);

  const handleQueueEditChange = useCallback((id: string, text: string) => {
    queueRef.current = queueRef.current.map((m) => m.id === id ? { ...m, draftText: text } : m);
    setState((prev) => reduceChatSession(prev, { type: "QUEUED_MESSAGE_EDIT_CHANGED", id, text }));
  }, []);

  const handleQueueEditCancel = useCallback((id: string) => {
    queueRef.current = queueRef.current.map((m) => m.id === id ? { ...m, draftText: m.text, isEditing: false } : m);
    setState((prev) => reduceChatSession(prev, { type: "QUEUED_MESSAGE_EDIT_CANCELLED", id }));
  }, []);

  const handleQueueSaveEdit = useCallback((id: string) => {
    queueRef.current = queueRef.current.map((m) => m.id === id ? { ...m, text: m.draftText.trim(), draftText: m.draftText.trim(), isEditing: false } : m);
    setState((prev) => reduceChatSession(prev, { type: "QUEUED_MESSAGE_EDIT_SAVED", id }));
  }, []);

  return {
    state,
    usageLabel: formatUsage(state.usage),
    handleSubmit,
    handleStop,
    handleModeChange,
    handleConfigOptionChange,
    handlePermissionDecision,
    handleQueueSendNow,
    handleQueueDelete,
    handleQueueEditStart,
    handleQueueEditChange,
    handleQueueEditCancel,
    handleQueueSaveEdit,
  };
}
