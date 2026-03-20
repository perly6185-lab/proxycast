import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type {
  AsterExecutionStrategy,
  AutoContinueRequestPayload,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import {
  parseStreamEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentStream";
import type { ActionRequired, Message, MessageImage } from "../types";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import {
  parseSkillSlashCommand,
  tryExecuteSlashSkillCommand,
} from "./skillCommand";
import {
  isWorkspacePathErrorMessage,
  mapProviderName,
} from "./agentChatCoreUtils";
import { playToolcallSound, playTypewriterSound } from "./agentChatStorage";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import type {
  SendMessageOptions,
  WorkspacePathMissingState,
} from "./agentChatShared";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import {
  buildFailedAgentMessageContent,
  buildFailedAgentRuntimeStatus,
  buildInitialAgentRuntimeStatus,
  buildWaitingAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";

function buildQueuedMessagePreview(content: string): string {
  const compact = content.split(/\s+/).filter(Boolean).join(" ");
  if (!compact) {
    return "空白输入";
  }

  const preview = Array.from(compact).slice(0, 80).join("");
  return compact.length > preview.length ? `${preview}...` : preview;
}

function appendThinkingToParts(
  parts: NonNullable<Message["contentParts"]>,
  textDelta: string,
): NonNullable<Message["contentParts"]> {
  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];

  if (lastPart?.type === "thinking") {
    nextParts[nextParts.length - 1] = {
      type: "thinking",
      text: lastPart.text + textDelta,
    };
    return nextParts;
  }

  nextParts.push({
    type: "thinking",
    text: textDelta,
  });
  return nextParts;
}

interface UseAgentStreamOptions {
  runtime: AgentRuntimeAdapter;
  systemPrompt?: string;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  ensureSession: () => Promise<string | null>;
  sessionIdRef: MutableRefObject<string | null>;
  executionStrategy: AsterExecutionStrategy;
  providerTypeRef: MutableRefObject<string>;
  modelRef: MutableRefObject<string>;
  currentAssistantMsgIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  currentStreamingEventNameRef: MutableRefObject<string | null>;
  warnedKeysRef: MutableRefObject<Set<string>>;
  getRequiredWorkspaceId: () => string;
  setWorkspacePathMissing: Dispatch<
    SetStateAction<WorkspacePathMissingState | null>
  >;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  queuedTurns: QueuedTurnSnapshot[];
  setQueuedTurns: Dispatch<SetStateAction<QueuedTurnSnapshot[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
}

export function useAgentStream(options: UseAgentStreamOptions) {
  const {
    runtime,
    systemPrompt,
    onWriteFile,
    ensureSession,
    sessionIdRef,
    executionStrategy,
    providerTypeRef,
    modelRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
    warnedKeysRef,
    getRequiredWorkspaceId,
    setWorkspacePathMissing,
    setMessages,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
    queuedTurns,
    setQueuedTurns,
    setPendingActions,
  } = options;

  const [isSending, setIsSending] = useState(false);
  const listenerMapRef = useRef(new Map<string, () => void>());
  const activeStreamRef = useRef<{
    assistantMsgId: string;
    eventName: string;
    sessionId: string;
    optimisticTurnId?: string;
    optimisticItemId?: string;
  } | null>(null);

  useEffect(() => {
    const listenerMap = listenerMapRef.current;
    return () => {
      for (const unlisten of listenerMap.values()) {
        unlisten();
      }
      listenerMap.clear();
    };
  }, []);

  const setActiveStream = useCallback(
    (
      nextActive: {
        assistantMsgId: string;
        eventName: string;
        sessionId: string;
        optimisticTurnId?: string;
        optimisticItemId?: string;
      } | null,
    ) => {
      activeStreamRef.current = nextActive;
      currentAssistantMsgIdRef.current = nextActive?.assistantMsgId ?? null;
      currentStreamingSessionIdRef.current = nextActive?.sessionId ?? null;
      currentStreamingEventNameRef.current = nextActive?.eventName ?? null;
      setIsSending(Boolean(nextActive));
    },
    [
      currentAssistantMsgIdRef,
      currentStreamingEventNameRef,
      currentStreamingSessionIdRef,
    ],
  );

  const clearActiveStreamIfMatch = useCallback(
    (eventName: string) => {
      if (activeStreamRef.current?.eventName !== eventName) {
        return false;
      }
      setActiveStream(null);
      return true;
    },
    [setActiveStream],
  );

  const buildQueuedRuntimeStatus = useCallback(
    (
      currentExecutionStrategy: AsterExecutionStrategy,
      content: string,
      webSearch?: boolean,
    ) => ({
      phase: "routing" as const,
      title: "已加入排队列表",
      detail: `当前会话仍在执行中，本条消息会在前一条完成后自动开始。待处理内容：${buildQueuedMessagePreview(content)}`,
      checkpoints: [
        "已创建待执行回合",
        webSearch ? "联网搜索能力待命" : "直接回答优先",
        currentExecutionStrategy === "code_orchestrated"
          ? "代码编排待命"
          : currentExecutionStrategy === "react"
            ? "对话执行待命"
            : "自动路由待命",
      ],
    }),
    [],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      images: MessageImage[],
      webSearch?: boolean,
      _thinking?: boolean,
      skipUserMessage = false,
      executionStrategyOverride?: AsterExecutionStrategy,
      modelOverride?: string,
      autoContinue?: AutoContinueRequestPayload,
      options?: SendMessageOptions,
    ) => {
      const effectiveExecutionStrategy =
        executionStrategyOverride || executionStrategy;
      const effectiveProviderType = providerTypeRef.current;
      const effectiveModel = modelOverride?.trim() || modelRef.current;
      const observer = options?.observer;
      const requestMetadata = options?.requestMetadata;
      const messagePurpose = options?.purpose;
      const expectingQueue =
        Boolean(activeStreamRef.current) || queuedTurns.length > 0;

      const assistantMsgId = crypto.randomUUID();
      const userMsgId = skipUserMessage ? null : crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isThinking: true,
        contentParts: [],
        runtimeStatus: expectingQueue
          ? buildQueuedRuntimeStatus(
              effectiveExecutionStrategy,
              content,
              webSearch,
            )
          : buildInitialAgentRuntimeStatus({
              executionStrategy: effectiveExecutionStrategy,
              webSearch,
              thinking: _thinking,
              skipUserMessage,
            }),
        purpose: messagePurpose,
      };

      if (skipUserMessage) {
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: Message = {
          id: userMsgId as string,
          role: "user",
          content,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date(),
          purpose: messagePurpose,
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }

      if (!expectingQueue) {
        setIsSending(true);
      }

      if (!skipUserMessage && !expectingQueue) {
        const parsedSkillCommand = parseSkillSlashCommand(content);
        if (parsedSkillCommand) {
          const skillEventName = `skill-exec-${assistantMsgId}`;
          setActiveStream({
            assistantMsgId,
            eventName: skillEventName,
            sessionId: sessionIdRef.current || "",
          });
          const skillHandled = await tryExecuteSlashSkillCommand({
            command: parsedSkillCommand,
            rawContent: content,
            assistantMsgId,
            providerType: effectiveProviderType,
            model: effectiveModel || undefined,
            ensureSession,
            setMessages,
            setIsSending,
            setCurrentAssistantMsgId: (id) => {
              if (!id) {
                clearActiveStreamIfMatch(skillEventName);
                return;
              }
              setActiveStream({
                assistantMsgId: id,
                eventName: skillEventName,
                sessionId:
                  activeStreamRef.current?.sessionId ||
                  sessionIdRef.current ||
                  "",
              });
            },
            setStreamUnlisten: (unlistenFn) => {
              const previous = listenerMapRef.current.get(skillEventName);
              if (previous) {
                previous();
                listenerMapRef.current.delete(skillEventName);
              }
              if (unlistenFn) {
                listenerMapRef.current.set(skillEventName, unlistenFn);
              }
            },
            setActiveSessionIdForStop: (sessionIdForStop) => {
              if (!sessionIdForStop) {
                clearActiveStreamIfMatch(skillEventName);
                return;
              }
              setActiveStream({
                assistantMsgId:
                  activeStreamRef.current?.assistantMsgId || assistantMsgId,
                eventName: skillEventName,
                sessionId: sessionIdForStop,
                optimisticTurnId: activeStreamRef.current?.optimisticTurnId,
                optimisticItemId: activeStreamRef.current?.optimisticItemId,
              });
            },
            isExecutionCancelled: () =>
              activeStreamRef.current?.assistantMsgId !== assistantMsgId,
            playTypewriterSound,
            playToolcallSound,
            onWriteFile,
          });

          if (skillHandled) {
            return;
          }

          clearActiveStreamIfMatch(skillEventName);
        }
      }

      let unlisten: (() => void) | null = null;
      const requestState = {
        accumulatedContent: "",
        requestLogId: null as string | null,
        requestStartedAt: 0,
        requestFinished: false,
        queuedTurnId: null as string | null,
      };
      let streamActivated = false;
      const optimisticStartedAt = assistantMsg.timestamp.toISOString();
      const optimisticTurnId = crypto.randomUUID();
      const optimisticItemId = `turn-summary:${optimisticTurnId}`;
      const optimisticThreadId =
        sessionIdRef.current || `local-thread:${assistantMsgId}`;
      const toolLogIdByToolId = new Map<string, string>();
      const toolStartedAtByToolId = new Map<string, number>();
      const toolNameByToolId = new Map<string, string>();
      const actionLoggedKeys = new Set<string>();

      const upsertQueuedTurn = (nextQueuedTurn: QueuedTurnSnapshot) => {
        setQueuedTurns((prev) =>
          [
            ...prev.filter(
              (item) => item.queued_turn_id !== nextQueuedTurn.queued_turn_id,
            ),
            nextQueuedTurn,
          ].sort((left, right) => {
            if (left.position !== right.position) {
              return left.position - right.position;
            }
            return left.created_at - right.created_at;
          }),
        );
      };

      const removeQueuedTurnState = (queuedTurnIds: string[]) => {
        if (queuedTurnIds.length === 0) {
          return;
        }
        setQueuedTurns((prev) => {
          const idSet = new Set(queuedTurnIds);
          return prev
            .filter((item) => !idSet.has(item.queued_turn_id))
            .map((item, index) => ({
              ...item,
              position: index + 1,
            }));
        });
      };

      const removeQueuedDraftMessages = () => {
        setMessages((prev) =>
          prev.filter(
            (msg) =>
              msg.id !== assistantMsgId &&
              (userMsgId ? msg.id !== userMsgId : true),
          ),
        );
      };

      const clearOptimisticItem = () => {
        if (expectingQueue) {
          return;
        }
        setThreadItems((prev) => removeThreadItemState(prev, optimisticItemId));
      };

      const clearOptimisticTurn = () => {
        if (expectingQueue) {
          return;
        }
        setThreadTurns((prev) => removeThreadTurnState(prev, optimisticTurnId));
        setCurrentTurnId((prev) => (prev === optimisticTurnId ? null : prev));
      };

      const markOptimisticFailure = (errorMessage: string) => {
        if (expectingQueue) {
          return;
        }

        const failedAt = new Date().toISOString();
        const failedRuntimeStatus = buildFailedAgentRuntimeStatus(errorMessage);

        setThreadTurns((prev) => {
          const currentTurn = prev.find((turn) => turn.id === optimisticTurnId);
          if (!currentTurn) {
            return prev;
          }

          return upsertThreadTurnState(prev, {
            ...currentTurn,
            status: "failed",
            error_message: errorMessage,
            completed_at: currentTurn.completed_at || failedAt,
            updated_at: failedAt,
          });
        });

        setThreadItems((prev) => {
          const currentItem = prev.find((item) => item.id === optimisticItemId);
          if (!currentItem || currentItem.type !== "turn_summary") {
            return prev;
          }

          return upsertThreadItemState(prev, {
            ...currentItem,
            status: "failed",
            completed_at: currentItem.completed_at || failedAt,
            updated_at: failedAt,
            text: formatAgentRuntimeStatusSummary(failedRuntimeStatus),
          });
        });
      };

      const disposeListener = () => {
        const registered = listenerMapRef.current.get(eventName);
        if (registered) {
          registered();
          listenerMapRef.current.delete(eventName);
        } else if (unlisten) {
          unlisten();
        }
        unlisten = null;
      };

      if (!expectingQueue) {
        setThreadTurns((prev) =>
          upsertThreadTurnState(prev, {
            id: optimisticTurnId,
            thread_id: optimisticThreadId,
            prompt_text: content,
            status: "running",
            started_at: optimisticStartedAt,
            created_at: optimisticStartedAt,
            updated_at: optimisticStartedAt,
          }),
        );
        setThreadItems((prev) =>
          upsertThreadItemState(prev, {
            id: optimisticItemId,
            thread_id: optimisticThreadId,
            turn_id: optimisticTurnId,
            sequence: 0,
            status: "in_progress",
            started_at: optimisticStartedAt,
            updated_at: optimisticStartedAt,
            type: "turn_summary",
            text: formatAgentRuntimeStatusSummary(assistantMsg.runtimeStatus),
          }),
        );
        setCurrentTurnId(optimisticTurnId);
      }

      const eventName = `aster_stream_${assistantMsgId}`;

      try {
        const activeSessionId = await ensureSession();
        if (!activeSessionId) throw new Error("无法创建会话");
        const resolvedWorkspaceId = getRequiredWorkspaceId();
        const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
          executionStrategy: effectiveExecutionStrategy,
          webSearch,
          thinking: _thinking,
        });

        const activateStream = () => {
          if (streamActivated) {
            return;
          }
          streamActivated = true;
          setActiveStream({
            assistantMsgId,
            eventName,
            sessionId: activeSessionId,
            optimisticTurnId,
            optimisticItemId,
          });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    runtimeStatus: waitingRuntimeStatus,
                  }
                : msg,
            ),
          );
        };

        if (!expectingQueue) {
          activateStream();
          setThreadTurns((prev) =>
            upsertThreadTurnState(prev, {
              id: optimisticTurnId,
              thread_id: activeSessionId,
              prompt_text: content,
              status: "running",
              started_at: optimisticStartedAt,
              created_at: optimisticStartedAt,
              updated_at: new Date().toISOString(),
            }),
          );
          setThreadItems((prev) =>
            upsertThreadItemState(prev, {
              id: optimisticItemId,
              thread_id: activeSessionId,
              turn_id: optimisticTurnId,
              sequence: 0,
              status: "in_progress",
              started_at: optimisticStartedAt,
              updated_at: new Date().toISOString(),
              type: "turn_summary",
              text: formatAgentRuntimeStatusSummary(waitingRuntimeStatus),
            }),
          );
        }

        requestState.requestStartedAt = Date.now();
        requestState.requestLogId = activityLogger.log({
          eventType: "chat_request_start",
          status: "pending",
          title: skipUserMessage ? "系统引导请求" : "发送请求",
          description: `模型: ${effectiveModel} · 策略: ${effectiveExecutionStrategy}`,
          workspaceId: resolvedWorkspaceId,
          sessionId: activeSessionId,
          source: "aster-chat",
          metadata: {
            provider: mapProviderName(effectiveProviderType),
            model: effectiveModel,
            executionStrategy: effectiveExecutionStrategy,
            contentLength: content.trim().length,
            skipUserMessage,
            autoContinueEnabled: autoContinue?.enabled ?? false,
            autoContinue: autoContinue?.enabled ? autoContinue : undefined,
            queuedSubmission: expectingQueue,
          },
        });

        unlisten = await runtime.listenToTurnEvents(
          eventName,
          (event: { payload: unknown }) => {
            const data = parseStreamEvent(event.payload);
            if (!data) {
              return;
            }

            handleTurnStreamEvent({
              data,
              requestState,
              callbacks: {
                activateStream,
                isStreamActivated: () => streamActivated,
                clearOptimisticItem,
                clearOptimisticTurn,
                disposeListener,
                removeQueuedDraftMessages,
                clearActiveStreamIfMatch,
                upsertQueuedTurn,
                removeQueuedTurnState,
                playToolcallSound,
                playTypewriterSound,
                appendThinkingToParts,
              },
              observer,
              eventName,
              optimisticTurnId,
              optimisticItemId,
              assistantMsgId,
              activeSessionId,
              resolvedWorkspaceId,
              effectiveExecutionStrategy,
              runtime,
              warnedKeysRef,
              actionLoggedKeys,
              toolLogIdByToolId,
              toolStartedAtByToolId,
              toolNameByToolId,
              onWriteFile,
              setMessages,
              setPendingActions,
              setThreadItems,
              setThreadTurns,
              setCurrentTurnId,
            });
          },
        );

        listenerMapRef.current.set(eventName, unlisten);

        const imagesToSend =
          images.length > 0
            ? images.map((img) => ({
                data: img.data,
                media_type: img.mediaType,
              }))
            : undefined;

        const providerConfig = {
          provider_id: effectiveProviderType,
          provider_name: mapProviderName(effectiveProviderType),
          model_name: effectiveModel,
        };

        await runtime.submitTurn({
          message: content,
          sessionId: activeSessionId,
          eventName,
          workspaceId: resolvedWorkspaceId,
          turnId: optimisticTurnId,
          images: imagesToSend,
          providerConfig,
          executionStrategy: effectiveExecutionStrategy,
          webSearch,
          searchMode: webSearch ? "allowed" : "disabled",
          autoContinue,
          systemPrompt,
          metadata: requestMetadata,
          queueIfBusy: true,
        });
      } catch (error) {
        if (requestState.requestLogId && !requestState.requestFinished) {
          requestState.requestFinished = true;
          activityLogger.updateLog(requestState.requestLogId, {
            eventType: "chat_request_error",
            status: "error",
            duration: Date.now() - requestState.requestStartedAt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        console.error("[AsterChat] 发送失败:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        const failedRuntimeStatus = buildFailedAgentRuntimeStatus(errMsg);
        observer?.onError?.(errMsg);
        if (
          errMsg.includes("429") ||
          errMsg.toLowerCase().includes("rate limit")
        ) {
          toast.warning("请求过于频繁，请稍后重试");
        } else if (isWorkspacePathErrorMessage(errMsg)) {
          setWorkspacePathMissing({ content, images });
        } else {
          toast.error(`发送失败: ${error}`);
        }
        markOptimisticFailure(errMsg);
        removeQueuedTurnState(
          requestState.queuedTurnId ? [requestState.queuedTurnId] : [],
        );
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...updateMessageArtifactsStatus(msg, "error"),
                  isThinking: false,
                  content: buildFailedAgentMessageContent(errMsg, msg.content),
                  runtimeStatus: failedRuntimeStatus,
                }
              : msg,
          ),
        );
        clearActiveStreamIfMatch(eventName);
        disposeListener();
        if (!expectingQueue && !activeStreamRef.current) {
          setIsSending(false);
        }
      }
    },
    [
      activeStreamRef,
      buildQueuedRuntimeStatus,
      clearActiveStreamIfMatch,
      ensureSession,
      executionStrategy,
      getRequiredWorkspaceId,
      modelRef,
      onWriteFile,
      providerTypeRef,
      queuedTurns.length,
      runtime,
      sessionIdRef,
      setActiveStream,
      setCurrentTurnId,
      setMessages,
      setPendingActions,
      setQueuedTurns,
      setThreadItems,
      setThreadTurns,
      setWorkspacePathMissing,
      systemPrompt,
      warnedKeysRef,
    ],
  );

  const stopSending = useCallback(async () => {
    const activeStream = activeStreamRef.current;
    if (activeStream) {
      const activeUnlisten = listenerMapRef.current.get(activeStream.eventName);
      if (activeUnlisten) {
        activeUnlisten();
        listenerMapRef.current.delete(activeStream.eventName);
      }
    }

    const activeSessionId = activeStream?.sessionId || sessionIdRef.current;
    if (activeSessionId) {
      try {
        await runtime.interruptTurn(activeSessionId);
      } catch (e) {
        console.error("[AsterChat] 停止失败:", e);
      }
    }

    setQueuedTurns([]);

    if (activeStream?.assistantMsgId) {
      if (activeStream.optimisticItemId) {
        setThreadItems((prev) =>
          removeThreadItemState(prev, activeStream.optimisticItemId!),
        );
      }
      if (activeStream.optimisticTurnId) {
        setThreadTurns((prev) =>
          removeThreadTurnState(prev, activeStream.optimisticTurnId!),
        );
        setCurrentTurnId((prev) =>
          prev === activeStream.optimisticTurnId ? null : prev,
        );
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === activeStream.assistantMsgId
            ? {
                ...updateMessageArtifactsStatus(msg, "complete"),
                isThinking: false,
                content: msg.content || "(已停止)",
                runtimeStatus: undefined,
              }
            : msg,
        ),
      );
    }

    setActiveStream(null);
    toast.info("已停止生成");
  }, [
    runtime,
    sessionIdRef,
    setActiveStream,
    setCurrentTurnId,
    setMessages,
    setQueuedTurns,
    setThreadItems,
    setThreadTurns,
  ]);

  const removeQueuedTurn = useCallback(
    async (queuedTurnId: string) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || !queuedTurnId.trim()) {
        return false;
      }

      try {
        const removed = await runtime.removeQueuedTurn(
          activeSessionId,
          queuedTurnId,
        );
        if (removed) {
          setQueuedTurns((prev) =>
            prev
              .filter((item) => item.queued_turn_id !== queuedTurnId)
              .map((item, index) => ({
                ...item,
                position: index + 1,
              })),
          );
        }
        return removed;
      } catch (error) {
        console.error("[AsterChat] 移除排队消息失败:", error);
        toast.error("移除排队消息失败");
        return false;
      }
    },
    [runtime, sessionIdRef, setQueuedTurns],
  );

  const promoteQueuedTurn = useCallback(
    async (queuedTurnId: string) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || !queuedTurnId.trim()) {
        return false;
      }

      setQueuedTurns((prev) =>
        prev
          .filter((item) => item.queued_turn_id !== queuedTurnId)
          .map((item, index) => ({
            ...item,
            position: index + 1,
          })),
      );

      try {
        const promoted = await runtime.promoteQueuedTurn(
          activeSessionId,
          queuedTurnId,
        );
        if (!promoted) {
          const detail = await runtime.getSession(activeSessionId);
          setQueuedTurns(detail.queued_turns ?? []);
          return false;
        }

        toast.info("正在切换到该排队任务");
        return true;
      } catch (error) {
        console.error("[AsterChat] 立即执行排队消息失败:", error);
        toast.error("立即执行排队消息失败");
        try {
          const detail = await runtime.getSession(activeSessionId);
          setQueuedTurns(detail.queued_turns ?? []);
        } catch (refreshError) {
          console.error("[AsterChat] 刷新排队状态失败:", refreshError);
        }
        return false;
      }
    },
    [runtime, sessionIdRef, setQueuedTurns],
  );

  return {
    isSending,
    sendMessage,
    stopSending,
    promoteQueuedTurn,
    removeQueuedTurn,
  };
}
