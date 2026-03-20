/**
 * Agent 流式事件与 UI 类型
 *
 * 聚合现役 Agent / Aster 流式协议的前端可消费类型与解析器。
 */

import {
  normalizeQueuedTurnSnapshot,
  type QueuedTurnSnapshot as QueueTurnSnapshot,
} from "./queuedTurn";

/**
 * Token 使用量统计
 * Requirements: 9.5 - THE Frontend SHALL display token usage statistics after each Agent response
 */
export interface TokenUsage {
  /** 输入 token 数 */
  input_tokens: number;
  /** 输出 token 数 */
  output_tokens: number;
}

/**
 * 工具执行结果图片
 * Requirements: 9.2 - THE Frontend SHALL display a collapsible section showing the tool result
 */
export interface ToolResultImage {
  src: string;
  mimeType?: string;
  origin?: "data_url" | "tool_payload" | "file_path";
}

export type ToolResultMetadata = Record<string, unknown>;

/**
 * 工具执行结果
 * Requirements: 9.2 - THE Frontend SHALL display a collapsible section showing the tool result
 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 错误信息（如果失败） */
  error?: string;
  /** 工具返回的图片（可选） */
  images?: ToolResultImage[];
  /** 工具返回的结构化元数据（可选） */
  metadata?: ToolResultMetadata;
}

export interface StreamArtifactSnapshot {
  artifactId: string;
  filePath?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export type AgentThreadTurnStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export type AgentThreadItemStatus = "in_progress" | "completed" | "failed";

export interface AgentThreadTurn {
  id: string;
  thread_id: string;
  prompt_text: string;
  status: AgentThreadTurnStatus;
  started_at: string;
  completed_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRequestOption {
  label: string;
  description?: string;
}

export interface AgentRequestQuestion {
  question: string;
  header?: string;
  options?: AgentRequestOption[];
  multi_select?: boolean;
}

interface AgentThreadItemBase {
  id: string;
  thread_id: string;
  turn_id: string;
  sequence: number;
  status: AgentThreadItemStatus;
  started_at: string;
  completed_at?: string;
  updated_at: string;
}

export interface AgentThreadUserMessageItem extends AgentThreadItemBase {
  type: "user_message";
  content: string;
}

export interface AgentThreadAgentMessageItem extends AgentThreadItemBase {
  type: "agent_message";
  text: string;
  phase?: string;
}

export interface AgentThreadPlanItem extends AgentThreadItemBase {
  type: "plan";
  text: string;
}

export interface AgentThreadReasoningItem extends AgentThreadItemBase {
  type: "reasoning";
  text: string;
  summary?: string[];
}

export interface AgentThreadToolCallItem extends AgentThreadItemBase {
  type: "tool_call";
  tool_name: string;
  arguments?: unknown;
  output?: string;
  success?: boolean;
  error?: string;
  metadata?: unknown;
}

export interface AgentThreadCommandExecutionItem extends AgentThreadItemBase {
  type: "command_execution";
  command: string;
  cwd: string;
  aggregated_output?: string;
  exit_code?: number;
  error?: string;
}

export interface AgentThreadWebSearchItem extends AgentThreadItemBase {
  type: "web_search";
  query?: string;
  action?: string;
  output?: string;
}

export interface AgentThreadApprovalRequestItem extends AgentThreadItemBase {
  type: "approval_request";
  request_id: string;
  action_type: string;
  prompt?: string;
  tool_name?: string;
  arguments?: unknown;
  response?: unknown;
}

export interface AgentThreadRequestUserInputItem extends AgentThreadItemBase {
  type: "request_user_input";
  request_id: string;
  action_type: string;
  prompt?: string;
  questions?: AgentRequestQuestion[];
  response?: unknown;
}

export interface AgentThreadFileArtifactItem extends AgentThreadItemBase {
  type: "file_artifact";
  path: string;
  source: string;
  content?: string;
  metadata?: unknown;
}

export interface AgentThreadSubagentActivityItem extends AgentThreadItemBase {
  type: "subagent_activity";
  status_label: string;
  title?: string;
  summary?: string;
  role?: string;
  model?: string;
  session_id?: string;
}

export interface AgentThreadWarningItem extends AgentThreadItemBase {
  type: "warning";
  message: string;
  code?: string;
}

export interface AgentThreadErrorItem extends AgentThreadItemBase {
  type: "error";
  message: string;
}

export interface AgentThreadTurnSummaryItem extends AgentThreadItemBase {
  type: "turn_summary";
  text: string;
}

export type AgentThreadItem =
  | AgentThreadUserMessageItem
  | AgentThreadAgentMessageItem
  | AgentThreadPlanItem
  | AgentThreadReasoningItem
  | AgentThreadToolCallItem
  | AgentThreadCommandExecutionItem
  | AgentThreadWebSearchItem
  | AgentThreadApprovalRequestItem
  | AgentThreadRequestUserInputItem
  | AgentThreadFileArtifactItem
  | AgentThreadSubagentActivityItem
  | AgentThreadWarningItem
  | AgentThreadErrorItem
  | AgentThreadTurnSummaryItem;

/**
 * 流式事件类型
 * Requirements: 9.1, 9.2, 9.3
 */
export type StreamEvent =
  | StreamEventThreadStarted
  | StreamEventTurnStarted
  | StreamEventItemStarted
  | StreamEventItemUpdated
  | StreamEventItemCompleted
  | StreamEventTurnCompleted
  | StreamEventTurnFailed
  | StreamEventTextDelta
  | StreamEventReasoningDelta
  | StreamEventToolStart
  | StreamEventToolEnd
  | StreamEventArtifactSnapshot
  | StreamEventActionRequired
  | StreamEventContextTrace
  | StreamEventRuntimeStatus
  | StreamEventQueueAdded
  | StreamEventQueueRemoved
  | StreamEventQueueStarted
  | StreamEventQueueCleared
  | StreamEventSubagentStatusChanged
  | StreamEventDone
  | StreamEventFinalDone
  | StreamEventWarning
  | StreamEventError;

/**
 * 文本增量事件
 * Requirements: 9.3 - THE Frontend SHALL distinguish between text responses and tool call responses visually
 */
export interface StreamEventTextDelta {
  type: "text_delta";
  text: string;
}

export interface StreamEventThreadStarted {
  type: "thread_started";
  thread_id: string;
}

export interface StreamEventTurnStarted {
  type: "turn_started";
  turn: AgentThreadTurn;
}

export interface StreamEventItemStarted {
  type: "item_started";
  item: AgentThreadItem;
}

export interface StreamEventItemUpdated {
  type: "item_updated";
  item: AgentThreadItem;
}

export interface StreamEventItemCompleted {
  type: "item_completed";
  item: AgentThreadItem;
}

export interface StreamEventTurnCompleted {
  type: "turn_completed";
  turn: AgentThreadTurn;
}

export interface StreamEventTurnFailed {
  type: "turn_failed";
  turn: AgentThreadTurn;
}

/**
 * 推理内容增量事件（DeepSeek reasoner 等模型的思考过程）
 * Requirements: 9.3 - THE Frontend SHALL distinguish between text responses and tool call responses visually
 */
export interface StreamEventReasoningDelta {
  type: "thinking_delta";
  text: string;
}

/**
 * 工具调用开始事件
 * Requirements: 9.1 - WHEN a tool is being executed, THE Frontend SHALL display a tool execution indicator with the tool name
 */
export interface StreamEventToolStart {
  type: "tool_start";
  /** 工具名称 */
  tool_name: string;
  /** 工具调用 ID */
  tool_id: string;
  /** 工具参数（JSON 字符串） */
  arguments?: string;
}

/**
 * 工具调用结束事件
 * Requirements: 9.2 - WHEN a tool completes, THE Frontend SHALL display a collapsible section showing the tool result
 */
export interface StreamEventToolEnd {
  type: "tool_end";
  /** 工具调用 ID */
  tool_id: string;
  /** 工具执行结果 */
  result: ToolExecutionResult;
}

export interface StreamEventArtifactSnapshot {
  type: "artifact_snapshot";
  artifact: StreamArtifactSnapshot;
}

/**
 * 权限确认请求事件
 * 当 Agent 需要用户确认某个操作时发送
 */
export interface StreamEventActionRequired {
  type: "action_required";
  /** 请求 ID */
  request_id: string;
  /** 操作类型 */
  action_type: "tool_confirmation" | "ask_user" | "elicitation";
  /** 工具名称（工具确认时） */
  tool_name?: string;
  /** 工具参数（工具确认时） */
  arguments?: Record<string, unknown>;
  /** 提示信息 */
  prompt?: string;
  /** 问题列表（ask_user 时） */
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{
      label: string;
      description?: string;
    }>;
    multiSelect?: boolean;
  }>;
  /** 请求的数据结构（elicitation 时） */
  requested_schema?: Record<string, unknown>;
}

export interface ContextTraceStep {
  stage: string;
  detail: string;
}

export interface StreamEventContextTrace {
  type: "context_trace";
  steps: ContextTraceStep[];
}

export interface StreamRuntimeStatusPayload {
  phase: "preparing" | "routing" | "context" | "failed";
  title: string;
  detail: string;
  checkpoints?: string[];
}

export interface StreamEventRuntimeStatus {
  type: "runtime_status";
  status: StreamRuntimeStatusPayload;
}

export interface StreamEventQueueAdded {
  type: "queue_added";
  session_id: string;
  queued_turn: QueueTurnSnapshot;
}

export interface StreamEventQueueRemoved {
  type: "queue_removed";
  session_id: string;
  queued_turn_id: string;
}

export interface StreamEventQueueStarted {
  type: "queue_started";
  session_id: string;
  queued_turn_id: string;
}

export interface StreamEventQueueCleared {
  type: "queue_cleared";
  session_id: string;
  queued_turn_ids: string[];
}

export interface StreamEventSubagentStatusChanged {
  type: "subagent_status_changed";
  session_id: string;
  root_session_id: string;
  parent_session_id?: string;
  status:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "closed"
    | "not_found";
}

/**
 * 完成事件（单次 API 响应完成，工具循环可能继续）
 * Requirements: 9.5 - THE Frontend SHALL display token usage statistics after each Agent response
 */
export interface StreamEventDone {
  type: "done";
  /** Token 使用量（可选） */
  usage?: TokenUsage;
}

/**
 * 最终完成事件（整个对话完成，包括所有工具调用循环）
 * 前端收到此事件后才能取消监听
 */
export interface StreamEventFinalDone {
  type: "final_done";
  /** Token 使用量（可选） */
  usage?: TokenUsage;
}

/**
 * 错误事件
 */
export interface StreamEventError {
  type: "error";
  /** 错误信息 */
  message: string;
}

/**
 * 告警事件（不中断流程）
 */
export interface StreamEventWarning {
  type: "warning";
  /** 告警代码（可选） */
  code?: string;
  /** 告警信息 */
  message: string;
}

/**
 * 工具调用状态（用于 UI 显示）
 */
export interface ToolCallState {
  /** 工具调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数（JSON 字符串） */
  arguments?: string;
  /** 执行状态 */
  status: "running" | "completed" | "failed";
  /** 执行结果（完成后） */
  result?: ToolExecutionResult;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间（完成后） */
  endTime?: Date;
  /** 执行日志（实时更新） */
  logs?: string[];
}

/**
 * 解析流式事件
 * @param data - 原始事件数据
 * @returns 解析后的流式事件
 */
export function parseStreamEvent(data: unknown): StreamEvent | null {
  if (!data || typeof data !== "object") return null;

  const event = data as Record<string, unknown>;
  const type = event.type as string;

  switch (type) {
    case "thread_started":
      return {
        type: "thread_started",
        thread_id: (event.thread_id as string) || "",
      };
    case "turn_started":
      return {
        type: "turn_started",
        turn: event.turn as AgentThreadTurn,
      };
    case "item_started":
      return {
        type: "item_started",
        item: event.item as AgentThreadItem,
      };
    case "item_updated":
      return {
        type: "item_updated",
        item: event.item as AgentThreadItem,
      };
    case "item_completed":
      return {
        type: "item_completed",
        item: event.item as AgentThreadItem,
      };
    case "turn_completed":
      return {
        type: "turn_completed",
        turn: event.turn as AgentThreadTurn,
      };
    case "turn_failed":
      return {
        type: "turn_failed",
        turn: event.turn as AgentThreadTurn,
      };
    case "text_delta":
      return {
        type: "text_delta",
        text: (event.text as string) || "",
      };
    case "reasoning_delta":
    case "thinking_delta":
      return {
        type: "thinking_delta",
        text: (event.text as string) || "",
      };
    case "tool_start":
      return {
        type: "tool_start",
        tool_name: (event.tool_name as string) || "",
        tool_id: (event.tool_id as string) || "",
        arguments: event.arguments as string | undefined,
      };
    case "tool_end":
      return {
        type: "tool_end",
        tool_id: (event.tool_id as string) || "",
        result: event.result as ToolExecutionResult,
      };
    case "artifact_snapshot":
    case "ArtifactSnapshot": {
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
    case "action_required": {
      const actionData =
        (event.data as Record<string, unknown> | undefined) || {};
      const requestId =
        (event.request_id as string | undefined) ||
        (actionData.request_id as string | undefined) ||
        (actionData.id as string | undefined) ||
        "";
      const actionType =
        (event.action_type as string | undefined) ||
        (actionData.action_type as string | undefined) ||
        (actionData.type as string | undefined) ||
        "tool_confirmation";

      return {
        type: "action_required",
        request_id: requestId,
        action_type: actionType as
          | "tool_confirmation"
          | "ask_user"
          | "elicitation",
        tool_name:
          (event.tool_name as string | undefined) ||
          (actionData.tool_name as string | undefined),
        arguments:
          (event.arguments as Record<string, unknown> | undefined) ||
          (actionData.arguments as Record<string, unknown> | undefined),
        prompt:
          (event.prompt as string | undefined) ||
          (actionData.prompt as string | undefined) ||
          (actionData.message as string | undefined),
        questions:
          (event.questions as
            | Array<{
                question: string;
                header?: string;
                options?: Array<{
                  label: string;
                  description?: string;
                }>;
                multiSelect?: boolean;
              }>
            | undefined) ||
          (actionData.questions as
            | Array<{
                question: string;
                header?: string;
                options?: Array<{
                  label: string;
                  description?: string;
                }>;
                multiSelect?: boolean;
              }>
            | undefined),
        requested_schema:
          (event.requested_schema as Record<string, unknown> | undefined) ||
          (actionData.requested_schema as Record<string, unknown> | undefined),
      };
    }
    case "done":
      return {
        type: "done",
        usage: event.usage as TokenUsage | undefined,
      };
    case "context_trace":
      return {
        type: "context_trace",
        steps: Array.isArray(event.steps)
          ? (event.steps as ContextTraceStep[])
          : [],
      };
    case "runtime_status": {
      const status =
        event.status && typeof event.status === "object"
          ? (event.status as Record<string, unknown>)
          : null;
      const phase = status?.phase;
      return {
        type: "runtime_status",
        status: {
          phase:
            phase === "preparing" || phase === "routing" || phase === "context"
              ? phase
              : "routing",
          title: typeof status?.title === "string" ? status.title : "",
          detail: typeof status?.detail === "string" ? status.detail : "",
          checkpoints: Array.isArray(status?.checkpoints)
            ? (status?.checkpoints as string[])
            : undefined,
        },
      };
    }
    case "queue_added": {
      const queuedTurn = normalizeQueuedTurnSnapshot(event.queued_turn);
      if (!queuedTurn) {
        return null;
      }
      return {
        type: "queue_added",
        session_id: (event.session_id as string) || "",
        queued_turn: queuedTurn,
      };
    }
    case "queue_removed":
      return {
        type: "queue_removed",
        session_id: (event.session_id as string) || "",
        queued_turn_id: (event.queued_turn_id as string) || "",
      };
    case "queue_started":
      return {
        type: "queue_started",
        session_id: (event.session_id as string) || "",
        queued_turn_id: (event.queued_turn_id as string) || "",
      };
    case "queue_cleared":
      return {
        type: "queue_cleared",
        session_id: (event.session_id as string) || "",
        queued_turn_ids: Array.isArray(event.queued_turn_ids)
          ? (event.queued_turn_ids as string[])
          : [],
      };
    case "subagent_status_changed":
      return {
        type: "subagent_status_changed",
        session_id: (event.session_id as string) || "",
        root_session_id: (event.root_session_id as string) || "",
        parent_session_id: event.parent_session_id as string | undefined,
        status:
          (event.status as
            | "idle"
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | "aborted"
            | "closed"
            | "not_found") || "idle",
      };
    case "final_done":
      return {
        type: "final_done",
        usage: event.usage as TokenUsage | undefined,
      };
    case "error":
      return {
        type: "error",
        message: (event.message as string) || "Unknown error",
      };
    case "warning":
      return {
        type: "warning",
        code: event.code as string | undefined,
        message: (event.message as string) || "Unknown warning",
      };
    default:
      return null;
  }
}
