/**
 * SubAgent 执行进度组件
 *
 * 显示 SubAgent 调度器的执行进度
 */

import React from "react";
import {
  SchedulerProgress,
  SchedulerEvent,
} from "@/hooks/useSubAgentScheduler";

interface SubAgentProgressProps {
  progress: SchedulerProgress | null;
  events: SchedulerEvent[];
  isRunning: boolean;
  onCancel?: () => void;
}

/**
 * 进度条组件
 */
const ProgressBar: React.FC<{ percentage: number; className?: string }> = ({
  percentage,
  className = "",
}) => (
  <div className={`w-full bg-gray-200 rounded-full h-2.5 ${className}`}>
    <div
      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
      style={{ width: `${Math.min(100, percentage)}%` }}
    />
  </div>
);

/**
 * 状态徽章
 */
const StatusBadge: React.FC<{ status: string; count: number }> = ({
  status,
  count,
}) => {
  const colors: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    running: "bg-blue-100 text-blue-800",
    pending: "bg-gray-100 text-gray-800",
    skipped: "bg-yellow-100 text-yellow-800",
  };

  return (
    <span
      className={`px-2 py-1 text-xs font-medium rounded ${colors[status] || colors.pending}`}
    >
      {status}: {count}
    </span>
  );
};

/**
 * 事件日志项
 */
const EventLogItem: React.FC<{ event: SchedulerEvent }> = ({ event }) => {
  const getEventContent = () => {
    switch (event.type) {
      case "started":
        return `🚀 开始执行 ${event.totalTasks} 个任务`;
      case "queueRejected":
        return `🚫 任务被拒绝: 请求 ${event.requested}，队列上限 ${event.limit}`;
      case "taskStarted":
        return `▶️ 任务 ${event.taskId} (${event.taskType}) 开始`;
      case "taskCompleted":
        return `✅ 任务 ${event.taskId} 完成 (${event.durationMs}ms)`;
      case "taskTimedOut":
        return `⏱️ 任务 ${event.taskId} 超时 (${event.timeoutMs}ms)`;
      case "taskFailed":
        return `❌ 任务 ${event.taskId} 失败: ${event.error}`;
      case "taskRetry":
        return `🔄 任务 ${event.taskId} 重试 #${event.retryCount}`;
      case "taskSkipped":
        return `⏭️ 任务 ${event.taskId} 跳过: ${event.reason}`;
      case "completed":
        return `🏁 执行${event.success ? "成功" : "失败"} (${event.durationMs}ms)`;
      case "cancelled":
        return `🛑 执行已取消`;
      default:
        return null;
    }
  };

  const content = getEventContent();
  if (!content) return null;

  return <div className="text-sm text-gray-600 py-1">{content}</div>;
};

/**
 * SubAgent 进度组件
 */
export const SubAgentProgress: React.FC<SubAgentProgressProps> = ({
  progress,
  events,
  isRunning,
  onCancel,
}) => {
  if (!progress && events.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      {/* 标题和取消按钮 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">SubAgent 执行进度</h3>
        {isRunning && onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
          >
            取消
          </button>
        )}
      </div>

      {/* 进度条 */}
      {progress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {progress.completed + progress.failed + progress.skipped} /{" "}
              {progress.total}
            </span>
            <span className="text-gray-600">
              {progress.percentage.toFixed(1)}%
            </span>
          </div>
          <ProgressBar percentage={progress.percentage} />
        </div>
      )}

      {/* 状态统计 */}
      {progress && (
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="completed" count={progress.completed} />
          <StatusBadge status="running" count={progress.running} />
          <StatusBadge status="pending" count={progress.pending} />
          <StatusBadge status="failed" count={progress.failed} />
          <StatusBadge status="skipped" count={progress.skipped} />
        </div>
      )}

      {/* 当前运行的任务 */}
      {progress && progress.currentTasks.length > 0 && (
        <div className="text-sm">
          <span className="text-gray-500">正在执行: </span>
          <span className="text-blue-600">
            {progress.currentTasks.join(", ")}
          </span>
        </div>
      )}

      {/* 事件日志 */}
      {events.length > 0 && (
        <div className="border-t pt-3">
          <h4 className="text-sm font-medium text-gray-700 mb-2">执行日志</h4>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {events.slice(-10).map((event, index) => (
              <EventLogItem key={index} event={event} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubAgentProgress;
