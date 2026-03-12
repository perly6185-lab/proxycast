import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type {
  StreamEventActionRequired,
  StreamEventArtifactSnapshot,
  StreamEventContextTrace,
  StreamEventToolEnd,
  StreamEventToolStart,
} from "@/lib/api/agentStream";
import type { Artifact } from "@/lib/artifact/types";
import type {
  ActionRequired,
  Message,
  WriteArtifactContext,
} from "../types";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import {
  isAskToolName,
  normalizeAskOptions,
  normalizeActionQuestions,
  parseJsonObject,
  resolveAskQuestionText,
  resolveAskRequestId,
  truncateForLog,
} from "./agentChatCoreUtils";
import { upsertAssistantActionRequest } from "./agentChatActionState";
import {
  extractProxycastToolMetadataBlock,
  isToolResultSuccessful,
  normalizeToolResultImages,
  normalizeToolResultMetadata,
} from "./agentChatToolResult";
import {
  buildArtifactFromWrite,
  extractArtifactPathsFromMetadata,
  upsertMessageArtifact,
} from "../utils/messageArtifacts";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { buildContextRuntimeStatus } from "../utils/agentRuntimeStatus";

interface BaseProcessorContext {
  assistantMsgId: string;
  activeSessionId: string;
  resolvedWorkspaceId: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

interface ArtifactWriteOptions {
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
}

interface ToolTrackingContext {
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
}

function upsertAssistantArtifact(
  messages: Message[],
  assistantMsgId: string,
  artifact: Artifact,
): Message[] {
  return messages.map((message) =>
    message.id === assistantMsgId
      ? upsertMessageArtifact(message, artifact)
      : message,
  );
}

export function handleToolStartEvent({
  data,
  setPendingActions,
  onWriteFile,
  toolLogIdByToolId,
  toolStartedAtByToolId,
  toolNameByToolId,
  setMessages,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
}: BaseProcessorContext &
  ArtifactWriteOptions &
  ToolTrackingContext & {
    data: StreamEventToolStart;
    setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  }) {
  const startedAt = Date.now();
  const newToolCall = {
    id: data.tool_id,
    name: data.tool_name,
    arguments: data.arguments,
    status: "running" as const,
    startTime: new Date(),
  };

  if (!toolLogIdByToolId.has(data.tool_id)) {
    const toolLogId = activityLogger.log({
      eventType: "tool_start",
      status: "pending",
      title: `调用工具 ${data.tool_name}`,
      description: truncateForLog(data.arguments || "等待工具结果"),
      workspaceId: resolvedWorkspaceId,
      sessionId: activeSessionId,
      source: "aster-chat",
      correlationId: data.tool_id,
      metadata: {
        toolId: data.tool_id,
        toolName: data.tool_name,
      },
    });
    toolLogIdByToolId.set(data.tool_id, toolLogId);
    toolStartedAtByToolId.set(data.tool_id, startedAt);
    toolNameByToolId.set(data.tool_id, data.tool_name);
  }

  const toolArgs = parseJsonObject(data.arguments);
  const toolName = data.tool_name.toLowerCase();
  if (toolName.includes("write") || toolName.includes("create")) {
    const filePath = toolArgs?.path || toolArgs?.file_path || toolArgs?.filePath;
    const fileContent = toolArgs?.content || toolArgs?.text || "";
    if (
      typeof filePath === "string" &&
      typeof fileContent === "string" &&
      filePath &&
      fileContent
    ) {
      const nextArtifact = buildArtifactFromWrite({
        filePath,
        content: fileContent,
        context: {
          artifactId: `artifact:${assistantMsgId}:${filePath}`,
          source: "tool_start",
          sourceMessageId: assistantMsgId,
          status: "streaming",
          metadata:
            toolArgs?.metadata && typeof toolArgs.metadata === "object"
              ? (toolArgs.metadata as Record<string, unknown>)
              : {},
        },
      });

      setMessages((prev) =>
        upsertAssistantArtifact(prev, assistantMsgId, nextArtifact),
      );

      onWriteFile?.(fileContent, filePath, {
        artifact: nextArtifact,
        artifactId: nextArtifact.id,
        source: "tool_start",
        sourceMessageId: assistantMsgId,
        status: nextArtifact.status,
        metadata: nextArtifact.meta,
      });
    }
  }

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      if (message.toolCalls?.find((toolCall) => toolCall.id === data.tool_id)) {
        return message;
      }

      return {
        ...message,
        runtimeStatus: undefined,
        toolCalls: [...(message.toolCalls || []), newToolCall],
        contentParts: [
          ...(message.contentParts || []),
          { type: "tool_use" as const, toolCall: newToolCall },
        ],
      };
    }),
  );

  if (!isAskToolName(data.tool_name)) {
    return;
  }

  const requestIdFromArgs = resolveAskRequestId(toolArgs);
  const question =
    (toolArgs && resolveAskQuestionText(toolArgs)) || "请提供继续执行所需信息";
  const questionList = toolArgs
    ? normalizeActionQuestions(toolArgs?.questions)
    : undefined;
  const askOptions = normalizeAskOptions(
    toolArgs?.options || toolArgs?.choices || toolArgs?.enum,
  );
  const explicitRequestId = requestIdFromArgs?.trim();
  const normalizedQuestions =
    questionList ?? [
      {
        question,
        options: askOptions,
        multiSelect: false,
      },
    ];

  const fallbackAction: ActionRequired = {
    requestId:
      explicitRequestId || `fallback:${data.tool_id || crypto.randomUUID()}`,
    actionType: "ask_user",
    prompt: question,
    isFallback: !explicitRequestId,
    questions: normalizedQuestions,
  };

  upsertAssistantActionRequest({
    assistantMsgId,
    actionData: fallbackAction,
    replaceByPrompt: true,
    setPendingActions,
    setMessages,
  });
}

export function handleToolEndEvent({
  data,
  onWriteFile,
  toolLogIdByToolId,
  toolStartedAtByToolId,
  toolNameByToolId,
  setMessages,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
}: BaseProcessorContext &
  ArtifactWriteOptions &
  ToolTrackingContext & {
    data: StreamEventToolEnd;
  }) {
  const normalizedOutput = extractProxycastToolMetadataBlock(data.result?.output);
  const normalizedResult = {
    ...data.result,
    output: normalizedOutput.text,
    images: normalizeToolResultImages(data.result?.images, normalizedOutput.text),
    metadata: normalizeToolResultMetadata(
      data.result?.metadata,
      data.result?.output,
    ),
  };
  const isSuccess = isToolResultSuccessful(normalizedResult);
  const eventType = isSuccess ? "tool_complete" : "tool_error";
  const startedAt = toolStartedAtByToolId.get(data.tool_id);
  const toolName = toolNameByToolId.get(data.tool_id) || "未知工具";
  const duration =
    typeof startedAt === "number" ? Date.now() - startedAt : undefined;
  const toolLogId = toolLogIdByToolId.get(data.tool_id);
  const outputText = normalizedResult.output
    ? truncateForLog(normalizedResult.output, 120)
    : "";

  if (toolLogId) {
    activityLogger.updateLog(toolLogId, {
      eventType,
      status: isSuccess ? "success" : "error",
      duration,
      description: outputText || (isSuccess ? "工具执行完成" : "工具执行失败"),
      error: isSuccess ? undefined : outputText || "工具返回失败状态",
    });
  } else {
    activityLogger.log({
      eventType,
      status: isSuccess ? "success" : "error",
      title: `工具 ${toolName}`,
      description: outputText || (isSuccess ? "工具执行完成" : "工具执行失败"),
      duration,
      workspaceId: resolvedWorkspaceId,
      sessionId: activeSessionId,
      source: "aster-chat",
      correlationId: data.tool_id,
    });
  }

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      const updatedToolCalls = (message.toolCalls || []).map((toolCall) =>
        toolCall.id === data.tool_id
          ? {
              ...toolCall,
              status: isSuccess ? ("completed" as const) : ("failed" as const),
              result: normalizedResult,
              endTime: new Date(),
            }
          : toolCall,
      );
      const updatedContentParts = (message.contentParts || []).map((part) => {
        if (part.type !== "tool_use" || part.toolCall.id !== data.tool_id) {
          return part;
        }

        return {
          ...part,
          toolCall: {
            ...part.toolCall,
            status: isSuccess ? ("completed" as const) : ("failed" as const),
            result: normalizedResult,
            endTime: new Date(),
          },
        };
      });

      return {
        ...message,
        runtimeStatus: undefined,
        toolCalls: updatedToolCalls,
        contentParts: updatedContentParts,
      };
    }),
  );

  const artifactPaths = extractArtifactPathsFromMetadata(normalizedResult.metadata);
  if (artifactPaths.length === 0) {
    return;
  }

  for (const artifactPath of artifactPaths) {
    const nextArtifact = buildArtifactFromWrite({
      filePath: artifactPath,
      content: "",
      context: {
        artifactId: `artifact:${assistantMsgId}:${artifactPath}`,
        source: "tool_result",
        sourceMessageId: assistantMsgId,
        status: isSuccess ? "complete" : "error",
        metadata: normalizedResult.metadata,
      },
    });

    setMessages((prev) =>
      upsertAssistantArtifact(prev, assistantMsgId, nextArtifact),
    );

    onWriteFile?.("", artifactPath, {
      artifact: nextArtifact,
      artifactId: nextArtifact.id,
      source: "tool_result",
      sourceMessageId: assistantMsgId,
      status: nextArtifact.status,
      metadata: nextArtifact.meta,
    });
  }
}

export function handleArtifactSnapshotEvent({
  data,
  onWriteFile,
  setMessages,
  assistantMsgId,
}: BaseProcessorContext &
  ArtifactWriteOptions & {
    data: StreamEventArtifactSnapshot;
  }) {
  const artifactPath = data.artifact.filePath;
  if (!artifactPath) {
    return;
  }

  const metadata = data.artifact.metadata;
  const nextArtifact = buildArtifactFromWrite({
    filePath: artifactPath,
    content:
      typeof data.artifact.content === "string" ? data.artifact.content : "",
    context: {
      artifactId:
        data.artifact.artifactId || `artifact:${assistantMsgId}:${artifactPath}`,
      source: "artifact_snapshot",
      sourceMessageId: assistantMsgId,
      status: metadata?.complete === false ? "streaming" : "complete",
      metadata,
    },
  });

  setMessages((prev) => upsertAssistantArtifact(prev, assistantMsgId, nextArtifact));

  onWriteFile?.(nextArtifact.content, artifactPath, {
    artifact: nextArtifact,
    artifactId: nextArtifact.id,
    source: "artifact_snapshot",
    sourceMessageId: assistantMsgId,
    status: nextArtifact.status,
    metadata: nextArtifact.meta,
  });
}

export function handleActionRequiredEvent({
  data,
  actionLoggedKeys,
  effectiveExecutionStrategy,
  runtime,
  setPendingActions,
  setMessages,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
}: BaseProcessorContext & {
  data: StreamEventActionRequired;
  actionLoggedKeys: Set<string>;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  runtime: AgentRuntimeAdapter;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
}) {
  const actionData: ActionRequired = {
    requestId: data.request_id,
    actionType: data.action_type,
    toolName: data.tool_name,
    arguments: data.arguments,
    prompt: data.prompt,
    questions: normalizeActionQuestions(data.questions, data.prompt),
    requestedSchema: data.requested_schema,
    isFallback: false,
  };
  const actionKey =
    actionData.requestId ||
    `${actionData.actionType}:${actionData.prompt || actionData.toolName || ""}`;
  if (!actionLoggedKeys.has(actionKey)) {
    actionLoggedKeys.add(actionKey);
    activityLogger.log({
      eventType: "action_required",
      status: "success",
      title: "等待用户确认",
      description:
        truncateForLog(actionData.prompt || "", 120) ||
        `类型: ${actionData.actionType}`,
      workspaceId: resolvedWorkspaceId,
      sessionId: activeSessionId,
      source: "aster-chat",
      correlationId: actionData.requestId,
      metadata: {
        actionType: actionData.actionType,
        toolName: actionData.toolName,
        requestId: actionData.requestId,
      },
    });
  }

  if (
    effectiveExecutionStrategy === "auto" &&
    actionData.actionType === "tool_confirmation"
  ) {
    void runtime
      .respondToAction({
        sessionId: activeSessionId,
        requestId: actionData.requestId,
        actionType: "tool_confirmation",
        confirmed: true,
        response: "Auto 模式自动确认",
      })
      .catch((error) => {
        console.error("[AsterChat] Auto 模式自动确认失败:", error);
        upsertAssistantActionRequest({
          assistantMsgId,
          actionData,
          setPendingActions,
          setMessages,
        });
        toast.error("Auto 模式自动确认失败，请手动确认");
      });
    return;
  }

  upsertAssistantActionRequest({
    assistantMsgId,
    actionData,
    replaceByPrompt:
      actionData.actionType === "ask_user" ||
      actionData.actionType === "elicitation",
    setPendingActions,
    setMessages,
  });
}

export function handleContextTraceEvent({
  data,
  setMessages,
  assistantMsgId,
}: BaseProcessorContext & {
  data: StreamEventContextTrace;
}) {
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    return;
  }

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      const seen = new Set(
        (message.contextTrace || []).map((step) => `${step.stage}::${step.detail}`),
      );
      const nextSteps = [...(message.contextTrace || [])];

      for (const step of data.steps) {
        const key = `${step.stage}::${step.detail}`;
        if (!seen.has(key)) {
          seen.add(key);
          nextSteps.push(step);
        }
      }

      return {
        ...message,
        contextTrace: nextSteps,
        runtimeStatus: buildContextRuntimeStatus(nextSteps),
      };
    }),
  );
}
