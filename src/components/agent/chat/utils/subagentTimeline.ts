import type { AgentThreadItem } from "../types";
import type { SchedulerEvent } from "@/lib/api/subAgentScheduler";
import { sortThreadItems } from "./threadTimelineView";

type SyntheticSubagentItem = Extract<AgentThreadItem, { type: "subagent_activity" }>;

interface BuildSubagentTimelineItemsOptions {
  threadId?: string | null;
  turnId?: string | null;
  events: SchedulerEvent[];
  baseTime?: Date;
}

function createTimestamp(baseTime: number, index: number): string {
  return new Date(baseTime + index).toISOString();
}

function resolveRunSummary(event: SchedulerEvent): string | undefined {
  switch (event.type) {
    case "started":
      return `准备调度 ${event.totalTasks} 个子任务`;
    case "progress":
      return `进度 ${event.progress.completed}/${event.progress.total}，运行中 ${event.progress.running}`;
    case "completed":
      return event.success
        ? `子代理协作完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`
        : `子代理协作结束，耗时 ${Math.round(event.durationMs / 1000)} 秒`;
    case "cancelled":
      return "子代理协作已取消";
    default:
      return undefined;
  }
}

function resolveTaskTitle(event: Extract<SchedulerEvent, { taskId: string }>): string {
  if ("taskType" in event && typeof event.taskType === "string" && event.taskType.trim()) {
    return `${event.taskId} · ${event.taskType.trim()}`;
  }
  return event.taskId;
}

export function buildSyntheticSubagentTimelineItems({
  threadId,
  turnId,
  events,
  baseTime,
}: BuildSubagentTimelineItemsOptions): AgentThreadItem[] {
  const resolvedThreadId = threadId?.trim();
  const resolvedTurnId = turnId?.trim();
  if (!resolvedThreadId || !resolvedTurnId || events.length === 0) {
    return [];
  }

  const items = new Map<string, AgentThreadItem>();
  const startTimes = new Map<string, string>();
  const timestampBase = (baseTime ?? new Date()).getTime();

  const upsertItem = (
    id: string,
    sequence: number,
    timestamp: string,
    item: Omit<
      SyntheticSubagentItem,
      "id" | "thread_id" | "turn_id" | "sequence" | "started_at"
    >,
  ) => {
    const previous = items.get(id);
    const startedAt = previous?.started_at || startTimes.get(id) || timestamp;
    startTimes.set(id, startedAt);
    items.set(id, {
      ...previous,
      ...item,
      id,
      thread_id: resolvedThreadId,
      turn_id: resolvedTurnId,
      sequence: previous?.sequence ?? sequence,
      started_at: startedAt,
    } as AgentThreadItem);
  };

  events.forEach((event, index) => {
    const sequence = 10_000 + index;
    const timestamp = createTimestamp(timestampBase, index);
    const runItemId = `synthetic:subagent:${resolvedTurnId}:run`;

    switch (event.type) {
      case "started":
      case "progress":
      case "completed":
      case "cancelled": {
        upsertItem(runItemId, sequence, timestamp, {
          status:
            event.type === "completed" || event.type === "cancelled"
              ? "completed"
              : "in_progress",
          completed_at:
            event.type === "completed" || event.type === "cancelled"
              ? timestamp
              : undefined,
          updated_at: timestamp,
          type: "subagent_activity",
          status_label:
            event.type === "started"
              ? "dispatching"
              : event.type === "progress"
                ? "running"
                : event.type === "cancelled"
                  ? "cancelled"
                  : "completed",
          title: "子代理协作",
          summary: resolveRunSummary(event),
        });
        break;
      }

      case "taskStarted":
      case "taskRetry":
      case "taskCompleted":
      case "taskFailed":
      case "taskSkipped": {
        const itemId = `synthetic:subagent:${resolvedTurnId}:${event.taskId}`;
        upsertItem(itemId, sequence, timestamp, {
          status:
            event.type === "taskFailed"
              ? "failed"
              : event.type === "taskCompleted" || event.type === "taskSkipped"
                ? "completed"
                : "in_progress",
          completed_at:
            event.type === "taskCompleted" ||
            event.type === "taskFailed" ||
            event.type === "taskSkipped"
              ? timestamp
              : undefined,
          updated_at: timestamp,
          type: "subagent_activity",
          status_label:
            event.type === "taskStarted"
              ? "running"
              : event.type === "taskRetry"
                ? "retrying"
                : event.type === "taskCompleted"
                  ? "completed"
                  : event.type === "taskSkipped"
                    ? "skipped"
                    : "failed",
          title: resolveTaskTitle(event),
          summary:
            event.type === "taskStarted"
              ? "子代理开始执行"
              : event.type === "taskRetry"
                ? `重试第 ${event.retryCount} 次`
                : event.type === "taskCompleted"
                  ? `已完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`
                  : event.type === "taskSkipped"
                    ? `已跳过：${event.reason}`
                    : event.error,
        });
        break;
      }
    }
  });

  return sortThreadItems(Array.from(items.values()));
}
