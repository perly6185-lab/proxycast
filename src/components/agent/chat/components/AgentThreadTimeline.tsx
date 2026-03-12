import React, { useMemo } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Clock3,
  FileText,
  Globe,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ToolCallState } from "@/lib/api/agentStream";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  ConfirmResponse,
} from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ToolCallItem } from "./ToolCallDisplay";
import { DecisionPanel } from "./DecisionPanel";
import { AgentPlanBlock } from "./AgentPlanBlock";

interface AgentThreadTimelineProps {
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
  isCurrentTurn?: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
}

function formatTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toQuestionOptions(
  options: Array<{ label: string; description?: string }> | undefined,
) {
  return options?.map((option) => ({
    label: option.label,
    description: option.description,
  }));
}

function stringifyResponse(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toActionRequired(item: AgentThreadItem): ActionRequired | null {
  if (item.type === "approval_request") {
    return {
      requestId: item.request_id,
      actionType: "tool_confirmation",
      toolName: item.tool_name,
      arguments:
        item.arguments && typeof item.arguments === "object"
          ? (item.arguments as Record<string, unknown>)
          : undefined,
      prompt: item.prompt,
      status: item.status === "completed" ? "submitted" : "pending",
      submittedResponse: stringifyResponse(item.response),
      submittedUserData: item.response,
    };
  }

  if (item.type === "request_user_input") {
    return {
      requestId: item.request_id,
      actionType:
        item.action_type === "elicitation" ? "elicitation" : "ask_user",
      prompt: item.prompt,
      questions: item.questions?.map((question) => ({
        question: question.question,
        header: question.header,
        options: toQuestionOptions(question.options),
        multiSelect: question.multi_select,
      })),
      status: item.status === "completed" ? "submitted" : "pending",
      submittedResponse: stringifyResponse(item.response),
      submittedUserData: item.response,
    };
  }

  return null;
}

function mapItemStatus(
  status: AgentThreadItem["status"],
): ToolCallState["status"] {
  if (status === "failed") {
    return "failed";
  }
  return status === "completed" ? "completed" : "running";
}

function toToolCallState(item: AgentThreadItem): ToolCallState | null {
  switch (item.type) {
    case "tool_call":
      return {
        id: item.id,
        name: item.tool_name,
        arguments:
          item.arguments === undefined
            ? undefined
            : JSON.stringify(item.arguments, null, 2),
        status: mapItemStatus(item.status),
        result:
          item.output !== undefined ||
          item.error !== undefined ||
          item.metadata !== undefined
            ? {
                success:
                  item.success ??
                  (item.status === "completed" && item.error === undefined),
                output: item.output || "",
                error: item.error,
                metadata:
                  item.metadata && typeof item.metadata === "object"
                    ? (item.metadata as Record<string, unknown>)
                    : undefined,
              }
            : undefined,
        startTime: new Date(item.started_at),
        endTime: item.completed_at ? new Date(item.completed_at) : undefined,
      };
    case "command_execution":
      return {
        id: item.id,
        name: "exec_command",
        arguments: JSON.stringify(
          { command: item.command, cwd: item.cwd },
          null,
          2,
        ),
        status: mapItemStatus(item.status),
        result:
          item.aggregated_output !== undefined ||
          item.error !== undefined ||
          item.exit_code !== undefined
            ? {
                success: item.status === "completed" && item.error === undefined,
                output: item.aggregated_output || "",
                error: item.error,
                metadata:
                  item.exit_code !== undefined
                    ? { exit_code: item.exit_code, cwd: item.cwd }
                    : { cwd: item.cwd },
              }
            : undefined,
        startTime: new Date(item.started_at),
        endTime: item.completed_at ? new Date(item.completed_at) : undefined,
      };
    case "web_search":
      return {
        id: item.id,
        name: item.action || "web_search",
        arguments:
          item.query !== undefined
            ? JSON.stringify({ query: item.query }, null, 2)
            : undefined,
        status: mapItemStatus(item.status),
        result:
          item.output !== undefined
            ? {
                success: item.status !== "failed",
                output: item.output,
              }
            : undefined,
        startTime: new Date(item.started_at),
        endTime: item.completed_at ? new Date(item.completed_at) : undefined,
      };
    default:
      return null;
  }
}

function resolveStatusBadgeVariant(
  status: AgentThreadItem["status"],
): "secondary" | "outline" | "destructive" {
  if (status === "failed") {
    return "destructive";
  }
  return status === "completed" ? "outline" : "secondary";
}

function TimelineCard({
  icon: Icon,
  title,
  badge,
  timestamp,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: React.ReactNode;
  timestamp?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        {badge ? <div className="ml-auto">{badge}</div> : null}
        {timestamp ? (
          <div className="text-xs text-muted-foreground">{timestamp}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export const AgentThreadTimeline: React.FC<AgentThreadTimelineProps> = ({
  turn,
  items,
  isCurrentTurn = false,
  onFileClick,
  onPermissionResponse,
}) => {
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) => item.type !== "user_message" && item.type !== "agent_message",
      ),
    [items],
  );

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-foreground">执行轨迹</div>
        {isCurrentTurn ? <Badge variant="secondary">当前回合</Badge> : null}
        <Badge variant="outline">
          {turn.status === "running"
            ? "执行中"
            : turn.status === "failed"
              ? "失败"
              : turn.status === "aborted"
                ? "已中断"
                : "已完成"}
        </Badge>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          <span>{formatTimestamp(turn.started_at) || "刚刚"}</span>
        </div>
      </div>

      <div className="space-y-2">
        {visibleItems.map((item) => {
          const timestamp = formatTimestamp(item.completed_at || item.updated_at);
          const actionRequest = toActionRequired(item);
          const toolCall = toToolCallState(item);

          if (item.type === "plan") {
            return (
              <AgentPlanBlock
                key={item.id}
                content={item.text}
                isComplete={item.status !== "in_progress"}
              />
            );
          }

          if (item.type === "reasoning") {
            return (
              <details
                key={item.id}
                className="overflow-hidden rounded-2xl border border-border/70 bg-background/80"
                open={item.status === "in_progress"}
              >
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  思考摘要
                  <Badge
                    variant={resolveStatusBadgeVariant(item.status)}
                    className="ml-auto"
                  >
                    {item.status === "in_progress" ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        推理中
                      </span>
                    ) : item.status === "failed" ? (
                      "推理失败"
                    ) : (
                      "已整理"
                    )}
                  </Badge>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </summary>
                <div className="border-t border-border/70 px-4 py-3">
                  <MarkdownRenderer content={item.text} />
                </div>
              </details>
            );
          }

          if (toolCall) {
            return (
              <div key={item.id} className="rounded-2xl border border-border/70 bg-background/80">
                <ToolCallItem
                  toolCall={toolCall}
                  defaultExpanded={item.status === "in_progress"}
                  onFileClick={onFileClick}
                />
              </div>
            );
          }

          if (actionRequest) {
            return (
              <div key={item.id}>
                <DecisionPanel
                  request={actionRequest}
                  onSubmit={(response) => onPermissionResponse?.(response)}
                />
              </div>
            );
          }

          if (item.type === "file_artifact") {
            return (
              <TimelineCard
                key={item.id}
                icon={FileText}
                title="文件产物"
                badge={
                  <Badge variant={resolveStatusBadgeVariant(item.status)}>
                    {item.source}
                  </Badge>
                }
                timestamp={timestamp}
              >
                <button
                  type="button"
                  className="w-full rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onFileClick?.(item.path, item.content || "")}
                >
                  <div className="text-sm font-medium text-foreground">
                    {item.path}
                  </div>
                  {item.content?.trim() ? (
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                      {item.content}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-muted-foreground">
                      点击在画布中打开文件
                    </div>
                  )}
                </button>
              </TimelineCard>
            );
          }

          if (item.type === "subagent_activity") {
            return (
              <TimelineCard
                key={item.id}
                icon={Bot}
                title={item.title || "子代理协作"}
                badge={
                  <Badge variant={resolveStatusBadgeVariant(item.status)}>
                    {item.status_label}
                  </Badge>
                }
                timestamp={timestamp}
              >
                {item.summary ? (
                  <div className="text-sm text-muted-foreground">{item.summary}</div>
                ) : null}
                {item.role || item.model ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.role ? <Badge variant="outline">{item.role}</Badge> : null}
                    {item.model ? <Badge variant="outline">{item.model}</Badge> : null}
                  </div>
                ) : null}
              </TimelineCard>
            );
          }

          if (item.type === "turn_summary") {
            return (
              <TimelineCard
                key={item.id}
                icon={Sparkles}
                title={item.status === "in_progress" ? "执行准备" : "回合总结"}
                badge={
                  item.status === "in_progress" ? (
                    <Badge variant="secondary" className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      进行中
                    </Badge>
                  ) : (
                    <Badge variant="outline">摘要</Badge>
                  )
                }
                timestamp={timestamp}
              >
                <MarkdownRenderer content={item.text} />
              </TimelineCard>
            );
          }

          if (item.type === "warning") {
            return (
              <TimelineCard
                key={item.id}
                icon={AlertTriangle}
                title="运行提醒"
                badge={<Badge variant="secondary">{item.code || "warning"}</Badge>}
                timestamp={timestamp}
              >
                <div className="text-sm text-muted-foreground">{item.message}</div>
              </TimelineCard>
            );
          }

          if (item.type === "error") {
            return (
              <TimelineCard
                key={item.id}
                icon={ShieldAlert}
                title="执行错误"
                badge={<Badge variant="destructive">失败</Badge>}
                timestamp={timestamp}
              >
                <div className="text-sm text-destructive">{item.message}</div>
              </TimelineCard>
            );
          }

          return (
            <TimelineCard
              key={item.id}
              icon={
                item.type === "web_search"
                  ? Search
                  : item.type === "command_execution"
                    ? TerminalSquare
                    : item.type === "approval_request"
                      ? ShieldAlert
                      : item.type === "request_user_input"
                        ? Globe
                        : Wrench
              }
              title={item.type}
              badge={
                <Badge variant={resolveStatusBadgeVariant(item.status)}>
                  {item.status}
                </Badge>
              }
              timestamp={timestamp}
            >
              <div className="text-sm text-muted-foreground">
                该事件类型已记录到 timeline 中。
              </div>
            </TimelineCard>
          );
        })}
      </div>
    </div>
  );
};

export default AgentThreadTimeline;
