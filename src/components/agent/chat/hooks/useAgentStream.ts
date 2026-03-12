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
} from "@/lib/api/agentRuntime";
import {
  parseStreamEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
  type StreamEvent,
} from "@/lib/api/agentStream";
import type {
  ActionRequired,
  Message,
  MessageImage,
} from "../types";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import {
  parseSkillSlashCommand,
  tryExecuteSlashSkillCommand,
} from "./skillCommand";
import {
  isWorkspacePathErrorMessage,
  mapProviderName,
  WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE,
} from "./agentChatCoreUtils";
import { appendTextToParts } from "./agentChatHistory";
import { playToolcallSound, playTypewriterSound } from "./agentChatStorage";
import {
  updateMessageArtifactsStatus,
} from "../utils/messageArtifacts";
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
  buildInitialAgentRuntimeStatus,
  buildWaitingAgentRuntimeStatus,
} from "../utils/agentRuntimeStatus";
import {
  handleActionRequiredEvent,
  handleArtifactSnapshotEvent,
  handleContextTraceEvent,
  handleToolEndEvent,
  handleToolStartEvent,
} from "./agentStreamEventProcessor";

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
  warnedKeysRef: MutableRefObject<Set<string>>;
  getRequiredWorkspaceId: () => string;
  setWorkspacePathMissing: Dispatch<
    SetStateAction<WorkspacePathMissingState | null>
  >;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
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
    warnedKeysRef,
    getRequiredWorkspaceId,
    setWorkspacePathMissing,
    setMessages,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
    setPendingActions,
  } = options;

  const [isSending, setIsSending] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const buildRuntimeStatusSummary = useCallback(
    (status?: Message["runtimeStatus"]): string => {
      if (!status?.title) {
        return "Agent 正在准备执行";
      }

      const lines = [status.title.trim()];
      if (status.detail?.trim()) {
        lines.push(status.detail.trim());
      }

      return lines.join("\n\n");
    },
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

      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isThinking: true,
        contentParts: [],
        runtimeStatus: buildInitialAgentRuntimeStatus({
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
          id: crypto.randomUUID(),
          role: "user",
          content,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date(),
          purpose: messagePurpose,
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }
      setIsSending(true);
      currentAssistantMsgIdRef.current = assistantMsgId;

      if (!skipUserMessage) {
        const parsedSkillCommand = parseSkillSlashCommand(content);
        if (parsedSkillCommand) {
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
              currentAssistantMsgIdRef.current = id;
            },
            setStreamUnlisten: (unlistenFn) => {
              unlistenRef.current = unlistenFn;
            },
            setActiveSessionIdForStop: (sessionIdForStop) => {
              currentStreamingSessionIdRef.current = sessionIdForStop;
            },
            isExecutionCancelled: () =>
              currentAssistantMsgIdRef.current !== assistantMsgId,
            playTypewriterSound,
            playToolcallSound,
            onWriteFile,
          });

          if (skillHandled) {
            return;
          }
        }
      }

      let accumulatedContent = "";
      let unlisten: (() => void) | null = null;
      let requestLogId: string | null = null;
      let requestStartedAt = 0;
      let requestFinished = false;
      const optimisticStartedAt = assistantMsg.timestamp.toISOString();
      const optimisticTurnId = `local-turn:${assistantMsgId}`;
      const optimisticItemId = `local-item:${assistantMsgId}:turn-summary`;
      const optimisticThreadId =
        sessionIdRef.current || `local-thread:${assistantMsgId}`;
      const toolLogIdByToolId = new Map<string, string>();
      const toolStartedAtByToolId = new Map<string, number>();
      const toolNameByToolId = new Map<string, string>();
      const actionLoggedKeys = new Set<string>();

      const clearOptimisticItem = () => {
        setThreadItems((prev) => removeThreadItemState(prev, optimisticItemId));
      };

      const clearOptimisticTurn = () => {
        setThreadTurns((prev) => removeThreadTurnState(prev, optimisticTurnId));
        setCurrentTurnId((prev) =>
          prev === optimisticTurnId ? null : prev,
        );
      };

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
          text: buildRuntimeStatusSummary(assistantMsg.runtimeStatus),
        }),
      );
      setCurrentTurnId(optimisticTurnId);

      try {
        const activeSessionId = await ensureSession();
        if (!activeSessionId) throw new Error("无法创建会话");
        currentStreamingSessionIdRef.current = activeSessionId;
        const resolvedWorkspaceId = getRequiredWorkspaceId();
        const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
          executionStrategy: effectiveExecutionStrategy,
          webSearch,
          thinking: _thinking,
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
            text: buildRuntimeStatusSummary(waitingRuntimeStatus),
          }),
        );

        const eventName = `aster_stream_${assistantMsgId}`;
        requestStartedAt = Date.now();
        requestLogId = activityLogger.log({
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
          },
        });

        unlisten = await runtime.listenToTurnEvents(
          eventName,
          (event: { payload: StreamEvent | unknown }) => {
            const data = parseStreamEvent(event.payload);
            if (!data) return;

            switch (data.type) {
              case "thread_started":
                break;

              case "turn_started":
                setCurrentTurnId(data.turn.id);
                setThreadTurns((prev) =>
                  upsertThreadTurnState(
                    removeThreadTurnState(prev, optimisticTurnId),
                    data.turn,
                  ),
                );
                clearOptimisticItem();
                break;

              case "item_started":
              case "item_updated":
              case "item_completed":
                setThreadItems((prev) =>
                  upsertThreadItemState(
                    removeThreadItemState(prev, optimisticItemId),
                    data.item,
                  ),
                );
                break;

              case "turn_completed":
              case "turn_failed":
                clearOptimisticItem();
                setThreadTurns((prev) =>
                  upsertThreadTurnState(
                    removeThreadTurnState(prev, optimisticTurnId),
                    data.turn,
                  ),
                );
                setCurrentTurnId(data.turn.id);
                break;

              case "text_delta":
                clearOptimisticItem();
                accumulatedContent += data.text;
                observer?.onTextDelta?.(data.text, accumulatedContent);
                playTypewriterSound();
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? {
                          ...msg,
                          content: accumulatedContent,
                          thinkingContent: undefined,
                          runtimeStatus: undefined,
                          contentParts: appendTextToParts(
                            msg.contentParts || [],
                            data.text,
                          ),
                        }
                      : msg,
                  ),
                );
                break;

              case "tool_start": {
                clearOptimisticItem();
                playToolcallSound();
                handleToolStartEvent({
                  data,
                  setPendingActions,
                  onWriteFile,
                  toolLogIdByToolId,
                  toolStartedAtByToolId,
                  toolNameByToolId,
                  assistantMsgId,
                  activeSessionId,
                  resolvedWorkspaceId,
                  setMessages,
                });
                break;
              }

              case "tool_end": {
                clearOptimisticItem();
                handleToolEndEvent({
                  data,
                  onWriteFile,
                  toolLogIdByToolId,
                  toolStartedAtByToolId,
                  toolNameByToolId,
                  assistantMsgId,
                  activeSessionId,
                  resolvedWorkspaceId,
                  setMessages,
                });
                break;
              }

              case "artifact_snapshot": {
                clearOptimisticItem();
                handleArtifactSnapshotEvent({
                  data,
                  onWriteFile,
                  assistantMsgId,
                  activeSessionId,
                  resolvedWorkspaceId,
                  setMessages,
                });
                break;
              }

              case "action_required": {
                clearOptimisticItem();
                handleActionRequiredEvent({
                  data,
                  actionLoggedKeys,
                  effectiveExecutionStrategy,
                  runtime,
                  setPendingActions,
                  assistantMsgId,
                  activeSessionId,
                  resolvedWorkspaceId,
                  setMessages,
                });
                break;
              }

              case "context_trace":
                clearOptimisticItem();
                handleContextTraceEvent({
                  data,
                  assistantMsgId,
                  activeSessionId,
                  resolvedWorkspaceId,
                  setMessages,
                });
                break;

              case "final_done": {
                clearOptimisticItem();
                clearOptimisticTurn();
                if (requestLogId && !requestFinished) {
                  requestFinished = true;
                  activityLogger.updateLog(requestLogId, {
                    eventType: "chat_request_complete",
                    status: "success",
                    duration: Date.now() - requestStartedAt,
                    description: `请求完成，工具调用 ${toolLogIdByToolId.size} 次`,
                  });
                }
                const finalContent = accumulatedContent || "(无响应)";
                observer?.onComplete?.(finalContent);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? {
                          ...updateMessageArtifactsStatus(msg, "complete"),
                          isThinking: false,
                          content: finalContent,
                          runtimeStatus: undefined,
                        }
                      : msg,
                  ),
                );
                setIsSending(false);
                unlistenRef.current = null;
                currentAssistantMsgIdRef.current = null;
                currentStreamingSessionIdRef.current = null;
                if (unlisten) {
                  unlisten();
                  unlisten = null;
                }
                break;
              }

              case "error":
                clearOptimisticItem();
                clearOptimisticTurn();
                if (requestLogId && !requestFinished) {
                  requestFinished = true;
                  activityLogger.updateLog(requestLogId, {
                    eventType: "chat_request_error",
                    status: "error",
                    duration: Date.now() - requestStartedAt,
                    error: data.message,
                  });
                }
                observer?.onError?.(data.message);
                if (
                  data.message.includes("429") ||
                  data.message.toLowerCase().includes("rate limit")
                ) {
                  toast.warning("请求过于频繁，请稍后重试");
                } else {
                  toast.error(`响应错误: ${data.message}`);
                }
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? {
                          ...updateMessageArtifactsStatus(msg, "error"),
                          isThinking: false,
                          content: accumulatedContent || `错误: ${data.message}`,
                          runtimeStatus: undefined,
                        }
                      : msg,
                  ),
                );
                setIsSending(false);
                currentStreamingSessionIdRef.current = null;
                if (unlisten) {
                  unlisten();
                  unlisten = null;
                }
                break;

              case "warning": {
                if (data.code === WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE) {
                  break;
                }
                const warningKey = `${activeSessionId}:${data.code || data.message}`;
                if (!warnedKeysRef.current.has(warningKey)) {
                  warnedKeysRef.current.add(warningKey);
                  toast.warning(data.message);
                }
                break;
              }

              default:
                break;
            }
          },
        );

        unlistenRef.current = unlisten;

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
          images: imagesToSend,
          providerConfig,
          executionStrategy: effectiveExecutionStrategy,
          webSearch,
          autoContinue,
          systemPrompt,
          metadata: requestMetadata,
        });
      } catch (error) {
        if (requestLogId && !requestFinished) {
          requestFinished = true;
          activityLogger.updateLog(requestLogId, {
            eventType: "chat_request_error",
            status: "error",
            duration: Date.now() - requestStartedAt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        console.error("[AsterChat] 发送失败:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
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
        clearOptimisticItem();
        clearOptimisticTurn();
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
        setIsSending(false);
        currentStreamingSessionIdRef.current = null;
        if (unlisten) {
          unlisten();
        }
      }
    },
    [
      currentAssistantMsgIdRef,
      currentStreamingSessionIdRef,
      ensureSession,
      executionStrategy,
      getRequiredWorkspaceId,
      modelRef,
      onWriteFile,
      providerTypeRef,
      runtime,
      setMessages,
      setThreadItems,
      setThreadTurns,
      setCurrentTurnId,
      setPendingActions,
      setWorkspacePathMissing,
      systemPrompt,
      warnedKeysRef,
      sessionIdRef,
      buildRuntimeStatusSummary,
    ],
  );

  const stopSending = useCallback(async () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    const activeSessionId =
      currentStreamingSessionIdRef.current || sessionIdRef.current;
    if (activeSessionId) {
      try {
        await runtime.interruptTurn(activeSessionId);
      } catch (e) {
        console.error("[AsterChat] 停止失败:", e);
      }
    }

    if (currentAssistantMsgIdRef.current) {
      const optimisticTurnId = `local-turn:${currentAssistantMsgIdRef.current}`;
      const optimisticItemId = `${`local-item:${currentAssistantMsgIdRef.current}`}:turn-summary`;
      setThreadItems((prev) => removeThreadItemState(prev, optimisticItemId));
      setThreadTurns((prev) => removeThreadTurnState(prev, optimisticTurnId));
      setCurrentTurnId((prev) => (prev === optimisticTurnId ? null : prev));
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === currentAssistantMsgIdRef.current
            ? {
                ...updateMessageArtifactsStatus(msg, "complete"),
                isThinking: false,
                content: msg.content || "(已停止)",
                runtimeStatus: undefined,
              }
            : msg,
        ),
      );
      currentAssistantMsgIdRef.current = null;
    }

    currentStreamingSessionIdRef.current = null;
    setIsSending(false);
    toast.info("已停止生成");
  }, [
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    runtime,
    sessionIdRef,
    setMessages,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
  ]);

  return {
    isSending,
    sendMessage,
    stopSending,
  };
}
