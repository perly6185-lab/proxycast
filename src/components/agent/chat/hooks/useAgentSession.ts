import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import {
  isAsterSessionNotFoundError,
  resolveRestorableSessionId,
} from "@/lib/asterSessionRecovery";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  getScopedStorageKey,
  mapSessionToTopic,
  type ClearMessagesOptions,
  type SessionModelPreference,
  type Topic,
} from "./agentChatShared";
import {
  hydrateSessionDetailMessages,
  normalizeHistoryMessages,
} from "./agentChatHistory";
import {
  loadPersisted,
  loadPersistedString,
  loadTransient,
  savePersisted,
  saveTransient,
} from "./agentChatStorage";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";

interface UseAgentSessionOptions {
  runtime: AgentRuntimeAdapter;
  workspaceId: string;
  isInitialized: boolean;
  executionStrategy: AsterExecutionStrategy;
  providerTypeRef: MutableRefObject<string>;
  modelRef: MutableRefObject<string>;
  sessionIdRef: MutableRefObject<string | null>;
  currentAssistantMsgIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  resetPendingActions: () => void;
  persistSessionModelPreference: (
    sessionId: string,
    providerType: string,
    model: string,
  ) => void;
  loadSessionModelPreference: (
    sessionId: string,
  ) => SessionModelPreference | null;
  applySessionModelPreference: (
    sessionId: string,
    preference: SessionModelPreference,
  ) => void;
  filterSessionsByWorkspace: <T extends { id: string }>(sessions: T[]) => T[];
  setExecutionStrategyState: (
    executionStrategy: AsterExecutionStrategy,
  ) => void;
}

export function useAgentSession(options: UseAgentSessionOptions) {
  const {
    runtime,
    workspaceId,
    isInitialized,
    executionStrategy,
    providerTypeRef,
    modelRef,
    sessionIdRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    resetPendingActions,
    persistSessionModelPreference,
    loadSessionModelPreference,
    applySessionModelPreference,
    filterSessionsByWorkspace,
    setExecutionStrategyState,
  } = options;

  const getScopedSessionKey = useCallback(
    () => getScopedStorageKey(workspaceId, "aster_curr_sessionId"),
    [workspaceId],
  );
  const getScopedMessagesKey = useCallback(
    () => getScopedStorageKey(workspaceId, "aster_messages"),
    [workspaceId],
  );
  const getScopedPersistedSessionKey = useCallback(
    () => getScopedStorageKey(workspaceId, "aster_last_sessionId"),
    [workspaceId],
  );
  const getScopedTurnsKey = useCallback(
    () => getScopedStorageKey(workspaceId, "aster_thread_turns"),
    [workspaceId],
  );
  const getScopedItemsKey = useCallback(
    () => getScopedStorageKey(workspaceId, "aster_thread_items"),
    [workspaceId],
  );
  const getScopedCurrentTurnKey = useCallback(
    () => getScopedStorageKey(workspaceId, "aster_curr_turnId"),
    [workspaceId],
  );

  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (!workspaceId?.trim()) {
      return null;
    }

    const scopedSessionId = loadTransient<string | null>(
      `aster_curr_sessionId_${workspaceId.trim()}`,
      null,
    );
    if (scopedSessionId) {
      return scopedSessionId;
    }

    return loadPersisted<string | null>(
      `aster_last_sessionId_${workspaceId.trim()}`,
      null,
    );
  });
  const [messages, setMessages] = useState<Message[]>(() =>
    workspaceId?.trim()
      ? loadTransient<Message[]>(`aster_messages_${workspaceId.trim()}`, [])
      : [],
  );
  const [threadTurns, setThreadTurns] = useState<AgentThreadTurn[]>(() =>
    workspaceId?.trim()
      ? loadTransient<AgentThreadTurn[]>(
          `aster_thread_turns_${workspaceId.trim()}`,
          [],
        )
      : [],
  );
  const [threadItems, setThreadItems] = useState<AgentThreadItem[]>(() =>
    workspaceId?.trim()
      ? loadTransient<AgentThreadItem[]>(
          `aster_thread_items_${workspaceId.trim()}`,
          [],
        )
      : [],
  );
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(() =>
    workspaceId?.trim()
      ? loadTransient<string | null>(
          `aster_curr_turnId_${workspaceId.trim()}`,
          null,
        )
      : null,
  );
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsReady, setTopicsReady] = useState(false);

  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);

  sessionIdRef.current = sessionId;

  const resetStreamingRefs = useCallback(() => {
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
  }, [currentAssistantMsgIdRef, currentStreamingSessionIdRef]);

  useEffect(() => {
    setMessages((prev) => {
      const normalized = normalizeHistoryMessages(prev);
      return normalized.length === prev.length ? prev : normalized;
    });
  }, [sessionId, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      return;
    }

    const scopedSessionKey = getScopedSessionKey();
    const scopedPersistedSessionKey = getScopedPersistedSessionKey();

    saveTransient(scopedSessionKey, sessionId);
    savePersisted(scopedPersistedSessionKey, sessionId);

    if (sessionId) {
      const sessionWorkspaceKey = `agent_session_workspace_${sessionId}`;
      const existingWorkspaceId = loadPersistedString(sessionWorkspaceKey);

      if (
        existingWorkspaceId &&
        existingWorkspaceId !== "__invalid__" &&
        existingWorkspaceId !== resolvedWorkspaceId
      ) {
        console.warn("[AsterChat] 检测到会话与工作区映射冲突，跳过覆盖", {
          sessionId,
          existingWorkspaceId,
          currentWorkspaceId: resolvedWorkspaceId,
        });
      } else {
        savePersisted(sessionWorkspaceKey, resolvedWorkspaceId);
      }
    }
  }, [
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    sessionId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedMessagesKey(), messages);
  }, [getScopedMessagesKey, messages, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedTurnsKey(), threadTurns);
  }, [getScopedTurnsKey, threadTurns, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedItemsKey(), threadItems);
  }, [getScopedItemsKey, threadItems, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedCurrentTurnKey(), currentTurnId);
  }, [currentTurnId, getScopedCurrentTurnKey, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      setSessionId(null);
      setMessages([]);
      setThreadTurns([]);
      setThreadItems([]);
      setCurrentTurnId(null);
      resetPendingActions();
      resetStreamingRefs();
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = false;
      return;
    }

    const scopedSessionId =
      loadTransient<string | null>(getScopedSessionKey(), null) ??
      loadPersisted<string | null>(getScopedPersistedSessionKey(), null);

    const scopedMessages = loadTransient<Message[]>(getScopedMessagesKey(), []);
    const scopedTurns = loadTransient<AgentThreadTurn[]>(getScopedTurnsKey(), []);
    const scopedItems = loadTransient<AgentThreadItem[]>(getScopedItemsKey(), []);
    const scopedCurrentTurnId = loadTransient<string | null>(
      getScopedCurrentTurnKey(),
      null,
    );

    setSessionId(scopedSessionId);
    setMessages(scopedMessages);
    setThreadTurns(scopedTurns);
    setThreadItems(scopedItems);
    setCurrentTurnId(scopedCurrentTurnId);
    resetPendingActions();
    resetStreamingRefs();
    restoredWorkspaceRef.current = null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = false;
  }, [
    getScopedMessagesKey,
    getScopedItemsKey,
    getScopedTurnsKey,
    getScopedCurrentTurnKey,
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    resetPendingActions,
    resetStreamingRefs,
    workspaceId,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!isInitialized) {
      return;
    }

    if (!workspaceId?.trim()) {
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    runtime
      .listSessions()
      .then((sessions) => {
        if (cancelled) {
          return;
        }
        const topicList =
          filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
        setTopics(topicList);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error("[AsterChat] 加载话题失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setTopicsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterSessionsByWorkspace, isInitialized, runtime, workspaceId]);

  const loadTopics = useCallback(async () => {
    if (!workspaceId?.trim()) {
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    try {
      const sessions = await runtime.listSessions();
      const topicList =
        filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
      setTopics(topicList);
    } catch (error) {
      console.error("[AsterChat] 加载话题失败:", error);
    } finally {
      setTopicsReady(true);
    }
  }, [filterSessionsByWorkspace, runtime, workspaceId]);

  const createFreshSession = useCallback(
    async (sessionName?: string): Promise<string | null> => {
      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        toast.error("缺少项目工作区，请先选择项目");
        return null;
      }

      try {
        const newSessionId = await runtime.createSession(
          resolvedWorkspaceId,
          sessionName,
          executionStrategy,
        );

        const now = new Date();
        setSessionId(newSessionId);
        setThreadTurns([]);
        setThreadItems([]);
        setCurrentTurnId(null);
        setTopics((prev) => [
          {
            id: newSessionId,
            title: sessionName?.trim() || "新话题",
            createdAt: now,
            updatedAt: now,
            messagesCount: 0,
            executionStrategy,
          },
          ...prev.filter((topic) => topic.id !== newSessionId),
        ]);
        resetPendingActions();
        resetStreamingRefs();
        hydratedSessionRef.current = newSessionId;
        skipAutoRestoreRef.current = false;
        restoredWorkspaceRef.current = resolvedWorkspaceId;

        persistSessionModelPreference(
          newSessionId,
          providerTypeRef.current,
          modelRef.current,
        );
        saveTransient(getScopedSessionKey(), newSessionId);
        savePersisted(getScopedPersistedSessionKey(), newSessionId);
        saveTransient(getScopedMessagesKey(), []);
        saveTransient(getScopedTurnsKey(), []);
        saveTransient(getScopedItemsKey(), []);
        saveTransient(getScopedCurrentTurnKey(), null);

        void loadTopics();
        return newSessionId;
      } catch (error) {
        console.error("[AsterChat] 创建新话题失败:", error);
        toast.error(`创建新话题失败: ${error}`);
        return null;
      }
    },
    [
      executionStrategy,
      getScopedMessagesKey,
      getScopedItemsKey,
      getScopedTurnsKey,
      getScopedCurrentTurnKey,
      getScopedPersistedSessionKey,
      getScopedSessionKey,
      loadTopics,
      modelRef,
      persistSessionModelPreference,
      providerTypeRef,
      resetPendingActions,
      resetStreamingRefs,
      runtime,
      workspaceId,
    ],
  );

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    return createFreshSession();
  }, [createFreshSession, sessionIdRef]);

  const clearMessages = useCallback(
    (options: ClearMessagesOptions = {}) => {
      const { showToast = true, toastMessage = "新话题已创建" } = options;

      const scopedSessionKey = getScopedSessionKey();
      const scopedPersistedSessionKey = getScopedPersistedSessionKey();
      const scopedMessagesKey = getScopedMessagesKey();

      setMessages([]);
      setThreadTurns([]);
      setThreadItems([]);
      setCurrentTurnId(null);
      setSessionId(null);
      resetPendingActions();
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = true;
      resetStreamingRefs();

      saveTransient(scopedSessionKey, null);
      savePersisted(scopedPersistedSessionKey, null);
      saveTransient(scopedMessagesKey, []);
      saveTransient(getScopedTurnsKey(), []);
      saveTransient(getScopedItemsKey(), []);
      saveTransient(getScopedCurrentTurnKey(), null);

      if (showToast) {
        toast.success(toastMessage);
      }
    },
    [
      getScopedMessagesKey,
      getScopedItemsKey,
      getScopedTurnsKey,
      getScopedCurrentTurnKey,
      getScopedPersistedSessionKey,
      getScopedSessionKey,
      resetPendingActions,
      resetStreamingRefs,
    ],
  );

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  const editMessage = useCallback((id: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, content: newContent } : msg,
      ),
    );
  }, []);

  const switchTopic = useCallback(
    async (topicId: string) => {
      if (topicId === sessionIdRef.current && messages.length > 0) return;

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        persistSessionModelPreference(
          currentSessionId,
          providerTypeRef.current,
          modelRef.current,
        );
      }

      skipAutoRestoreRef.current = false;
      try {
        const detail = await runtime.getSession(topicId);
        const topicPreference = loadSessionModelPreference(topicId);

        setMessages(hydrateSessionDetailMessages(detail, topicId));
        setThreadTurns(detail.turns || []);
        setThreadItems(detail.items || []);
        setCurrentTurnId(
          detail.turns && detail.turns.length > 0
            ? detail.turns[detail.turns.length - 1]?.id || null
            : null,
        );
        const selectedTopic = topics.find((topic) => topic.id === topicId);
        setExecutionStrategyState(
          normalizeExecutionStrategy(
            detail.execution_strategy || selectedTopic?.executionStrategy,
          ),
        );
        setSessionId(topicId);

        if (topicPreference) {
          applySessionModelPreference(topicId, topicPreference);
        }
      } catch (error) {
        console.error("[AsterChat] 切换话题失败:", error);
        console.error("[AsterChat] 错误详情:", JSON.stringify(error, null, 2));
        if (isAsterSessionNotFoundError(error)) {
          setMessages([]);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          setSessionId(null);
          saveTransient(getScopedSessionKey(), null);
          savePersisted(getScopedPersistedSessionKey(), null);
          void loadTopics();
          return;
        }
        setMessages([]);
        setThreadTurns([]);
        setThreadItems([]);
        setCurrentTurnId(null);
        setSessionId(null);
        saveTransient(getScopedSessionKey(), null);
        savePersisted(getScopedPersistedSessionKey(), null);
        toast.error(
          `加载对话历史失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [
      applySessionModelPreference,
      getScopedPersistedSessionKey,
      getScopedSessionKey,
      loadSessionModelPreference,
      loadTopics,
      messages.length,
      modelRef,
      persistSessionModelPreference,
      providerTypeRef,
      runtime,
      setExecutionStrategyState,
      sessionIdRef,
      topics,
    ],
  );

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) return;
    if (!isInitialized) return;
    if (!topicsReady) return;
    if (skipAutoRestoreRef.current) return;
    if (sessionId) return;
    if (topics.length === 0) return;
    if (restoredWorkspaceRef.current === resolvedWorkspaceId) return;

    restoredWorkspaceRef.current = resolvedWorkspaceId;

    const scopedCandidate =
      loadTransient<string | null>(getScopedSessionKey(), null) ||
      loadPersisted<string | null>(getScopedPersistedSessionKey(), null);
    const targetSessionId = resolveRestorableSessionId({
      candidateSessionId: scopedCandidate,
      sessions: topics.map((topic) => ({
        id: topic.id,
        createdAt: Math.floor(topic.createdAt.getTime() / 1000),
        updatedAt: Math.floor(topic.updatedAt.getTime() / 1000),
      })),
    });
    if (!targetSessionId) {
      return;
    }

    switchTopic(targetSessionId).catch((error) => {
      console.warn("[AsterChat] 自动恢复会话失败:", error);
      saveTransient(getScopedSessionKey(), null);
      savePersisted(getScopedPersistedSessionKey(), null);
    });
  }, [
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    isInitialized,
    sessionId,
    switchTopic,
    topics,
    topicsReady,
    workspaceId,
  ]);

  useEffect(() => {
    if (sessionId) {
      skipAutoRestoreRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (!topicsReady) return;

    if (topics.length > 0 && !topics.some((topic) => topic.id === sessionId)) {
      setSessionId(null);
      setMessages([]);
      setThreadTurns([]);
      setThreadItems([]);
      setCurrentTurnId(null);
      saveTransient(getScopedSessionKey(), null);
      savePersisted(getScopedPersistedSessionKey(), null);
      hydratedSessionRef.current = null;
      return;
    }

    if (messages.length > 0 && (threadTurns.length > 0 || threadItems.length > 0)) {
      hydratedSessionRef.current = sessionId;
      return;
    }

    if (hydratedSessionRef.current === sessionId) {
      return;
    }

    hydratedSessionRef.current = sessionId;

    switchTopic(sessionId).catch((error) => {
      console.warn("[AsterChat] 会话水合失败:", error);
      hydratedSessionRef.current = null;
    });
  }, [
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    messages.length,
    sessionId,
    switchTopic,
    threadItems.length,
    threadTurns.length,
    topics,
    topicsReady,
  ]);

  const deleteTopic = useCallback(
    async (topicId: string) => {
      try {
        await runtime.deleteSession(topicId);
        await loadTopics();

        if (topicId === sessionIdRef.current) {
          setSessionId(null);
          setMessages([]);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          resetPendingActions();
          resetStreamingRefs();
          hydratedSessionRef.current = null;
          restoredWorkspaceRef.current = null;
          saveTransient(getScopedSessionKey(), null);
          savePersisted(getScopedPersistedSessionKey(), null);
          saveTransient(getScopedTurnsKey(), []);
          saveTransient(getScopedItemsKey(), []);
          saveTransient(getScopedCurrentTurnKey(), null);
        }

        toast.success("话题已删除");
      } catch (error) {
        console.error("[AsterChat] 删除话题失败:", error);
        toast.error("删除话题失败");
      }
    },
    [
      getScopedPersistedSessionKey,
      getScopedSessionKey,
      getScopedItemsKey,
      getScopedTurnsKey,
      getScopedCurrentTurnKey,
      loadTopics,
      resetPendingActions,
      resetStreamingRefs,
      runtime,
      sessionIdRef,
    ],
  );

  const renameTopic = useCallback(
    async (topicId: string, newTitle: string) => {
      const normalizedTitle = newTitle.trim();
      if (!normalizedTitle) {
        return;
      }

      try {
        await runtime.renameSession(topicId, normalizedTitle);
        await loadTopics();
        toast.success("话题已重命名");
      } catch (error) {
        console.error("[AsterChat] 重命名话题失败:", error);
        toast.error("重命名失败");
      }
    },
    [loadTopics, runtime],
  );

  const updateTopicExecutionStrategy = useCallback(
    (targetSessionId: string, nextExecutionStrategy: AsterExecutionStrategy) => {
      setTopics((prev) =>
        prev.map((topic) =>
          topic.id === targetSessionId
            ? { ...topic, executionStrategy: nextExecutionStrategy }
            : topic,
        ),
      );
    },
    [],
  );

  return {
    sessionId,
    setSessionId,
    messages,
    setMessages,
    threadTurns,
    setThreadTurns,
    threadItems,
    setThreadItems,
    currentTurnId,
    setCurrentTurnId,
    topics,
    setTopics,
    topicsReady,
    loadTopics,
    createFreshSession,
    ensureSession,
    switchTopic,
    deleteTopic,
    renameTopic,
    clearMessages,
    deleteMessage,
    editMessage,
    updateTopicExecutionStrategy,
  };
}
