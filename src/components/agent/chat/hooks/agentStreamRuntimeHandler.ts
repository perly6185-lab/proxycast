import { toast } from "sonner";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AsterExecutionStrategy,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type {
  AgentThreadItem,
  AgentThreadTurn,
  StreamEvent,
} from "@/lib/api/agentStream";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import type { ActionRequired, Message } from "../types";
import { appendTextToParts } from "./agentChatHistory";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import { WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE } from "./agentChatCoreUtils";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import {
  handleActionRequiredEvent,
  handleArtifactSnapshotEvent,
  handleContextTraceEvent,
  handleToolEndEvent,
  handleToolStartEvent,
} from "./agentStreamEventProcessor";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";

type MessageParts = NonNullable<Message["contentParts"]>;

interface StreamObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

interface StreamRequestState {
  accumulatedContent: string;
  queuedTurnId: string | null;
  requestLogId: string | null;
  requestStartedAt: number;
  requestFinished: boolean;
}

interface StreamLifecycleCallbacks {
  activateStream: () => void;
  isStreamActivated: () => boolean;
  clearOptimisticItem: () => void;
  clearOptimisticTurn: () => void;
  disposeListener: () => void;
  removeQueuedDraftMessages: () => void;
  clearActiveStreamIfMatch: (eventName: string) => boolean;
  upsertQueuedTurn: (queuedTurn: QueuedTurnSnapshot) => void;
  removeQueuedTurnState: (queuedTurnIds: string[]) => void;
  playToolcallSound: () => void;
  playTypewriterSound: () => void;
  appendThinkingToParts: (
    parts: MessageParts,
    textDelta: string,
  ) => MessageParts;
}

interface HandleTurnStreamEventOptions {
  data: StreamEvent;
  requestState: StreamRequestState;
  callbacks: StreamLifecycleCallbacks;
  observer?: StreamObserver;
  eventName: string;
  optimisticTurnId: string;
  optimisticItemId: string;
  assistantMsgId: string;
  activeSessionId: string;
  resolvedWorkspaceId: string;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  runtime: AgentRuntimeAdapter;
  warnedKeysRef: MutableRefObject<Set<string>>;
  actionLoggedKeys: Set<string>;
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
}

function finishRequestLog(
  requestState: StreamRequestState,
  payload: {
    eventType: "chat_request_complete" | "chat_request_error";
    status: "success" | "error";
    description?: string;
    error?: string;
  },
) {
  if (!requestState.requestLogId || requestState.requestFinished) {
    return;
  }

  requestState.requestFinished = true;
  activityLogger.updateLog(requestState.requestLogId, {
    eventType: payload.eventType,
    status: payload.status,
    duration: Date.now() - requestState.requestStartedAt,
    description: payload.description,
    error: payload.error,
  });
}

export function handleTurnStreamEvent({
  data,
  requestState,
  callbacks,
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
}: HandleTurnStreamEventOptions): void {
  const {
    activateStream,
    isStreamActivated,
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
  } = callbacks;

  switch (data.type) {
    case "thread_started":
      break;

    case "queue_added":
      requestState.queuedTurnId = data.queued_turn.queued_turn_id;
      upsertQueuedTurn(data.queued_turn);
      break;

    case "queue_removed":
      removeQueuedTurnState([data.queued_turn_id]);
      if (
        !isStreamActivated() &&
        (!requestState.queuedTurnId ||
          requestState.queuedTurnId === data.queued_turn_id)
      ) {
        disposeListener();
        removeQueuedDraftMessages();
      }
      break;

    case "queue_started":
      requestState.queuedTurnId = data.queued_turn_id;
      removeQueuedTurnState([data.queued_turn_id]);
      activateStream();
      break;

    case "queue_cleared":
      removeQueuedTurnState(data.queued_turn_ids);
      if (
        !isStreamActivated() &&
        (!requestState.queuedTurnId ||
          data.queued_turn_ids.includes(requestState.queuedTurnId))
      ) {
        disposeListener();
        removeQueuedDraftMessages();
      }
      break;

    case "turn_started":
      activateStream();
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
      activateStream();
      setThreadItems((prev) =>
        upsertThreadItemState(
          removeThreadItemState(prev, optimisticItemId),
          data.item,
        ),
      );
      break;

    case "turn_completed":
    case "turn_failed":
      activateStream();
      clearOptimisticItem();
      setThreadTurns((prev) =>
        upsertThreadTurnState(
          removeThreadTurnState(prev, optimisticTurnId),
          data.turn,
        ),
      );
      setCurrentTurnId(data.turn.id);
      break;

    case "runtime_status":
      activateStream();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                runtimeStatus: data.status,
              }
            : msg,
        ),
      );
      break;

    case "thinking_delta":
      activateStream();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                isThinking: true,
                thinkingContent: (msg.thinkingContent || "") + data.text,
                contentParts: appendThinkingToParts(
                  msg.contentParts || [],
                  data.text,
                ),
              }
            : msg,
        ),
      );
      break;

    case "text_delta":
      activateStream();
      clearOptimisticItem();
      requestState.accumulatedContent += data.text;
      observer?.onTextDelta?.(data.text, requestState.accumulatedContent);
      playTypewriterSound();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: requestState.accumulatedContent,
                thinkingContent: undefined,
                contentParts: appendTextToParts(msg.contentParts || [], data.text),
              }
            : msg,
        ),
      );
      break;

    case "tool_start":
      activateStream();
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

    case "tool_end":
      activateStream();
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

    case "artifact_snapshot":
      activateStream();
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

    case "action_required":
      activateStream();
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

    case "context_trace":
      activateStream();
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
      removeQueuedTurnState(requestState.queuedTurnId ? [requestState.queuedTurnId] : []);
      finishRequestLog(requestState, {
        eventType: "chat_request_complete",
        status: "success",
        description: `请求完成，工具调用 ${toolLogIdByToolId.size} 次`,
      });
      const finalContent =
        requestState.accumulatedContent.trim() ||
        "已完成工具执行，但模型未输出最终答复，请重试。";
      if (!requestState.accumulatedContent.trim()) {
        toast.error("已完成工具执行，但模型未输出最终答复，请重试");
      }
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
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      break;
    }

    case "error":
      clearOptimisticItem();
      clearOptimisticTurn();
      removeQueuedTurnState(requestState.queuedTurnId ? [requestState.queuedTurnId] : []);
      finishRequestLog(requestState, {
        eventType: "chat_request_error",
        status: "error",
        error: data.message,
      });
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
                content:
                  requestState.accumulatedContent || `错误: ${data.message}`,
                runtimeStatus: undefined,
              }
            : msg,
        ),
      );
      clearActiveStreamIfMatch(eventName);
      disposeListener();
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
}
