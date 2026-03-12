import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type {
  ConfirmResponse,
  Message,
  ActionRequired,
  AgentThreadItem,
} from "../types";
import { resolveActionPromptKey } from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { markThreadActionItemSubmitted } from "./agentThreadState";

interface UseAgentToolsOptions {
  runtime: AgentRuntimeAdapter;
  sessionIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
}

export function useAgentTools(options: UseAgentToolsOptions) {
  const {
    runtime,
    sessionIdRef,
    currentStreamingSessionIdRef,
    setMessages,
    setThreadItems,
  } = options;

  const [pendingActions, setPendingActions] = useState<ActionRequired[]>([]);
  const warnedKeysRef = useRef<Set<string>>(new Set());

  const confirmAction = useCallback(
    async (response: ConfirmResponse) => {
      try {
        const pendingAction = pendingActions.find(
          (item) => item.requestId === response.requestId,
        );
        const actionType = response.actionType || pendingAction?.actionType;
        if (!actionType) {
          throw new Error("缺少 actionType，无法提交确认");
        }

        const normalizedResponse =
          typeof response.response === "string" ? response.response.trim() : "";
        let submittedUserData: unknown = response.userData;
        let effectiveRequestId = response.requestId;
        const acknowledgedRequestIds = new Set<string>([response.requestId]);

        if (actionType === "elicitation" || actionType === "ask_user") {
          const activeSessionId =
            currentStreamingSessionIdRef.current || sessionIdRef.current;
          if (!activeSessionId) {
            throw new Error("缺少会话 ID，无法提交 elicitation 响应");
          }

          let userData: unknown;
          if (!response.confirmed) {
            userData = "";
          } else if (response.userData !== undefined) {
            userData = response.userData;
          } else if (response.response !== undefined) {
            const rawResponse = response.response.trim();
            if (!rawResponse) {
              userData = "";
            } else {
              try {
                userData = JSON.parse(rawResponse);
              } catch {
                userData = rawResponse;
              }
            }
          } else {
            userData = "";
          }

          submittedUserData = userData;

          if (pendingAction?.isFallback) {
            const fallbackPromptKey = resolveActionPromptKey(pendingAction);
            const resolvedAction = pendingActions.find((item) => {
              if (item.requestId === pendingAction.requestId) return false;
              if (item.isFallback) return false;
              if (item.actionType !== pendingAction.actionType) return false;
              if (!fallbackPromptKey) return false;
              return resolveActionPromptKey(item) === fallbackPromptKey;
            });

            if (!resolvedAction) {
              throw new Error("Ask 请求 ID 尚未就绪，请稍后再试");
            }

            effectiveRequestId = resolvedAction.requestId;
            acknowledgedRequestIds.add(resolvedAction.requestId);
          }

          await runtime.respondToAction({
            sessionId: activeSessionId,
            requestId: effectiveRequestId,
            actionType,
            confirmed: response.confirmed,
            response: response.response,
            userData,
          });
        } else {
          await runtime.respondToAction({
            sessionId: sessionIdRef.current || "",
            requestId: effectiveRequestId,
            actionType,
            confirmed: response.confirmed,
            response: response.response,
          });
        }

        setPendingActions((prev) =>
          prev.filter((a) => !acknowledgedRequestIds.has(a.requestId)),
        );
        const shouldPersistSubmittedAction =
          actionType === "elicitation" || actionType === "ask_user";
        setMessages((prev) =>
          prev.map((msg) => ({
            ...msg,
            actionRequests: shouldPersistSubmittedAction
              ? msg.actionRequests?.map((item) =>
                  acknowledgedRequestIds.has(item.requestId)
                    ? {
                        ...item,
                        status: "submitted" as const,
                        submittedResponse: normalizedResponse || undefined,
                        submittedUserData,
                      }
                    : item,
                )
              : msg.actionRequests?.filter(
                  (item) => !acknowledgedRequestIds.has(item.requestId),
                ),
            contentParts: shouldPersistSubmittedAction
              ? msg.contentParts?.map((part) =>
                  part.type === "action_required" &&
                  acknowledgedRequestIds.has(part.actionRequired.requestId)
                    ? {
                        ...part,
                        actionRequired: {
                          ...part.actionRequired,
                          status: "submitted" as const,
                          submittedResponse: normalizedResponse || undefined,
                          submittedUserData,
                        },
                      }
                    : part,
                )
              : msg.contentParts?.filter(
                  (part) =>
                    part.type !== "action_required" ||
                    !acknowledgedRequestIds.has(part.actionRequired.requestId),
                ),
          })),
        );
        setThreadItems((prev) =>
          markThreadActionItemSubmitted(
            prev,
            acknowledgedRequestIds,
            normalizedResponse || undefined,
            submittedUserData,
          ),
        );
      } catch (error) {
        console.error("[AsterChat] 确认失败:", error);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "确认操作失败",
        );
      }
    },
    [
      currentStreamingSessionIdRef,
      pendingActions,
      runtime,
      sessionIdRef,
      setMessages,
      setThreadItems,
    ],
  );

  const handlePermissionResponse = useCallback(
    async (response: ConfirmResponse) => {
      await confirmAction(response);
    },
    [confirmAction],
  );

  return {
    pendingActions,
    setPendingActions,
    warnedKeysRef,
    confirmAction,
    handlePermissionResponse,
  };
}
