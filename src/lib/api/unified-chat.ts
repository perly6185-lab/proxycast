/**
 * @file unified-chat.ts
 * @description 统一对话 API 封装
 * @module lib/api/unified-chat
 *
 * 封装所有统一对话相关的 Tauri 命令调用
 */

import { safeInvoke } from "@/lib/dev-bridge";
import type {
  ChatMode,
  ChatMessage,
  SessionResponse,
  CreateSessionRequest,
  SendMessageRequest,
  StreamEvent,
  ToolCall,
  ToolEndEvent,
  FinalDoneEvent,
  HarnessArtifactSnapshot,
  HarnessEventPayload,
} from "@/types/chat";

// ============================================================================
// 会话管理 API
// ============================================================================

/**
 * 创建新会话
 */
export async function createSession(
  request: CreateSessionRequest,
): Promise<SessionResponse> {
  return safeInvoke<SessionResponse>("chat_create_session", { request });
}

/**
 * 获取会话列表
 */
export async function listSessions(
  mode?: ChatMode,
): Promise<SessionResponse[]> {
  return safeInvoke<SessionResponse[]>("chat_list_sessions", { mode });
}

/**
 * 获取会话详情
 */
export async function getSession(sessionId: string): Promise<SessionResponse> {
  return safeInvoke<SessionResponse>("chat_get_session", { sessionId });
}

/**
 * 删除会话
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  return safeInvoke<boolean>("chat_delete_session", { sessionId });
}

/**
 * 重命名会话
 */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<void> {
  return safeInvoke<void>("chat_rename_session", { sessionId, title });
}

// ============================================================================
// 消息管理 API
// ============================================================================

/**
 * 获取会话消息列表
 */
export async function getMessages(
  sessionId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  const messages = await safeInvoke<
    Array<{
      id: number;
      session_id: string;
      role: string;
      content: unknown;
      tool_calls?: unknown;
      tool_call_id?: string;
      metadata?: unknown;
      created_at: string;
    }>
  >("chat_get_messages", { sessionId, limit });

  // 转换后端格式为前端格式
  return messages.map(convertBackendMessage);
}

/**
 * 发送消息（流式）
 */
export async function sendMessage(request: SendMessageRequest): Promise<void> {
  return safeInvoke<void>("chat_send_message", { request });
}

/**
 * 停止生成
 */
export async function stopGeneration(sessionId: string): Promise<boolean> {
  return safeInvoke<boolean>("chat_stop_generation", { sessionId });
}

/**
 * 配置会话的 Provider
 */
export async function configureProvider(
  sessionId: string,
  providerType: string,
  model: string,
): Promise<void> {
  return safeInvoke<void>("chat_configure_provider", {
    sessionId,
    providerType,
    model,
  });
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 转换后端消息格式为前端格式
 */
function convertBackendMessage(msg: {
  id: number;
  session_id: string;
  role: string;
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  metadata?: unknown;
  created_at: string;
}): ChatMessage {
  // 提取文本内容
  let textContent = "";
  if (typeof msg.content === "string") {
    textContent = msg.content;
  } else if (Array.isArray(msg.content)) {
    textContent = msg.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" && part !== null && part.type === "text",
      )
      .map((part) => part.text)
      .join("\n");
  } else if (typeof msg.content === "object" && msg.content !== null) {
    // 尝试从对象中提取文本
    const contentObj = msg.content as Record<string, unknown>;
    if (typeof contentObj.text === "string") {
      textContent = contentObj.text;
    }
  }

  return {
    id: msg.id,
    sessionId: msg.session_id,
    role: msg.role as ChatMessage["role"],
    content: textContent,
    contentBlocks: Array.isArray(msg.content)
      ? msg.content.map(convertContentBlock)
      : [{ type: "text" as const, text: textContent }],
    toolCalls: msg.tool_calls ? convertToolCalls(msg.tool_calls) : undefined,
    toolCallId: msg.tool_call_id,
    status: "complete",
    metadata: msg.metadata as ChatMessage["metadata"],
    createdAt: msg.created_at,
  };
}

/**
 * 转换内容块
 */
function convertContentBlock(
  block: unknown,
): NonNullable<ChatMessage["contentBlocks"]>[number] {
  if (typeof block !== "object" || block === null) {
    return { type: "text", text: String(block) };
  }

  const b = block as Record<string, unknown>;

  switch (b.type) {
    case "text":
      return { type: "text", text: String(b.text || "") };
    case "image":
      return { type: "image", url: String(b.url || ""), alt: b.alt as string };
    case "file":
      return {
        type: "file",
        path: String(b.path || ""),
        name: String(b.name || ""),
      };
    case "canvas":
      return {
        type: "canvas",
        canvasType: String(b.canvasType || ""),
        content: String(b.content || ""),
      };
    default:
      return { type: "text", text: JSON.stringify(block) };
  }
}

/**
 * 转换工具调用
 */
function convertToolCalls(toolCalls: unknown): ChatMessage["toolCalls"] {
  if (!Array.isArray(toolCalls)) return undefined;

  return toolCalls.map((tc) => {
    const call = tc as Record<string, unknown>;
    return {
      id: String(call.id || ""),
      name: String(call.name || ""),
      arguments: call.arguments as string,
      status: (call.status as ToolCall["status"]) || "completed",
      result: call.result as ToolCall["result"],
    };
  });
}

/**
 * 解析流式事件
 */
export function parseStreamEvent(payload: unknown): StreamEvent | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const event = payload as Record<string, unknown>;
  const type = event.type as string;

  switch (type) {
    case "TextDelta":
    case "text_delta":
      return {
        type: "text_delta",
        text: String(event.text || event.content || ""),
      };

    case "ThinkingDelta":
    case "thinking_delta":
      return {
        type: "thinking_delta",
        text: String(event.text || event.content || ""),
      };

    case "ToolStart":
    case "tool_start":
      return {
        type: "tool_start",
        tool_id: String(event.tool_id || event.id || ""),
        tool_name: String(event.tool_name || event.name || ""),
        arguments: event.arguments as string,
      };

    case "ToolEnd":
    case "tool_end":
      return {
        type: "tool_end",
        tool_id: String(event.tool_id || event.id || ""),
        result: event.result as ToolEndEvent["result"],
      };

    case "HarnessEvent":
    case "harness_event":
      return {
        type: "harness_event",
        event: {
          kind: String(event.kind || event.event_kind || "unknown"),
          sessionId:
            (event.session_id as string) || (event.sessionId as string),
          runId: (event.run_id as string) || (event.runId as string),
          correlationId:
            (event.correlation_id as string) ||
            (event.correlationId as string),
          theme: event.theme as string,
          stage: event.stage as string,
          summary: event.summary as string,
          artifact: (event.artifact ||
            (event.snapshot as HarnessArtifactSnapshot) ||
            undefined) as HarnessArtifactSnapshot | undefined,
          metadata: event.metadata as HarnessEventPayload["metadata"],
        },
      };

    case "ArtifactSnapshot":
    case "artifact_snapshot":
      {
        const nestedArtifact =
          event.artifact && typeof event.artifact === "object"
            ? (event.artifact as Record<string, unknown>)
            : undefined;
      return {
        type: "artifact_snapshot",
        artifact: {
          artifactId: String(
            nestedArtifact?.artifactId ||
              nestedArtifact?.artifact_id ||
              event.artifact_id ||
              event.artifactId ||
              event.id ||
              "artifact-unknown",
          ),
          filePath:
            (nestedArtifact?.filePath as string | undefined) ||
            (nestedArtifact?.file_path as string | undefined) ||
            (event.file_path as string | undefined) ||
            (event.filePath as string | undefined),
          content:
            (nestedArtifact?.content as string | undefined) ||
            (event.content as string | undefined),
          metadata:
            (nestedArtifact?.metadata as Record<string, unknown> | undefined) ||
            (event.metadata as Record<string, unknown> | undefined),
        },
      };
      }

    case "ActionRequired":
    case "action_required":
      return {
        type: "action_required",
        request_id: String(event.request_id || ""),
        action_type: String(event.action_type || ""),
        tool_name: event.tool_name as string,
        arguments: event.arguments as string,
        prompt: event.prompt as string,
        questions: event.questions as unknown[],
        requested_schema: event.requested_schema,
      };

    case "Done":
    case "done":
      return { type: "done" };

    case "FinalDone":
    case "final_done":
      return {
        type: "final_done",
        usage: event.usage as FinalDoneEvent["usage"],
      };

    case "Error":
    case "error":
      return {
        type: "error",
        message: String(event.message || "Unknown error"),
      };

    default:
      console.warn("[parseStreamEvent] 未知事件类型:", type);
      return null;
  }
}

/**
 * 生成唯一事件名称
 */
export function generateEventName(sessionId: string): string {
  return `unified-chat-stream-${sessionId}-${Date.now()}`;
}
