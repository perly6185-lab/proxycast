import React, { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type { SchedulerEvent, SchedulerProgress } from "@/lib/api/subAgentScheduler";

import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { HarnessSessionState } from "../utils/harnessState";

interface AgentRuntimeStripProps {
  activeTheme?: string;
  toolPreferences: ChatToolPreferences;
  harnessState: HarnessSessionState;
  subAgentRuntime: {
    isRunning: boolean;
    progress: SchedulerProgress | null;
    events: SchedulerEvent[];
  };
  variant?: "standalone" | "embedded";
  isSending?: boolean;
  runtimeStatusTitle?: string | null;
}

const THEME_LABELS: Record<string, string> = {
  general: "通用对话",
  knowledge: "知识探索",
  planning: "计划规划",
};

interface CapabilityItem {
  key: string;
  label: string;
  enabled: boolean;
}

interface StatusItem {
  key: string;
  label: string;
  tone?: "default" | "outline" | "secondary";
}

export const AgentRuntimeStrip: React.FC<AgentRuntimeStripProps> = ({
  activeTheme,
  toolPreferences,
  harnessState,
  subAgentRuntime,
  variant = "standalone",
  isSending = false,
  runtimeStatusTitle = null,
}) => {
  const themeLabel =
    THEME_LABELS[activeTheme?.trim().toLowerCase() || ""] || "通用对话";

  const capabilities = useMemo<CapabilityItem[]>(
    () => [
      { key: "direct", label: "直接回答", enabled: true },
      { key: "thinking", label: "深度思考", enabled: toolPreferences.thinking },
      {
        key: "web_search",
        label: "联网搜索",
        enabled: toolPreferences.webSearch,
      },
      { key: "task", label: "后台任务", enabled: toolPreferences.task },
      { key: "subagent", label: "多代理", enabled: toolPreferences.subagent },
    ],
    [toolPreferences],
  );

  const statusItems = useMemo<StatusItem[]>(() => {
    const nextItems: StatusItem[] = [];

    if (isSending) {
      nextItems.push({
        key: "sending",
        label: runtimeStatusTitle || "正在准备执行",
        tone: "secondary",
      });
    }

    if (harnessState.plan.phase === "planning") {
      nextItems.push({
        key: "planning",
        label: "正在整理执行计划",
        tone: "secondary",
      });
    }

    if (harnessState.plan.items.length > 0) {
      nextItems.push({
        key: "plan_items",
        label: `当前计划 ${harnessState.plan.items.length} 项`,
        tone: "outline",
      });
    }

    if (harnessState.pendingApprovals.length > 0) {
      nextItems.push({
        key: "pending",
        label: `等待确认 ${harnessState.pendingApprovals.length}`,
        tone: "secondary",
      });
    }

    if (subAgentRuntime.isRunning) {
      const progressLabel =
        subAgentRuntime.progress &&
        typeof subAgentRuntime.progress.completed === "number" &&
        typeof subAgentRuntime.progress.total === "number"
          ? `子代理运行中 ${subAgentRuntime.progress.completed}/${subAgentRuntime.progress.total}`
          : "子代理运行中";
      nextItems.push({
        key: "subagent_running",
        label: progressLabel,
        tone: "secondary",
      });
    } else if (harnessState.delegatedTasks.length > 0) {
      nextItems.push({
        key: "delegated",
        label: `最近委派 ${harnessState.delegatedTasks.length}`,
        tone: "outline",
      });
    }

    if (harnessState.outputSignals.length > 0) {
      nextItems.push({
        key: "outputs",
        label: `最近产物 ${harnessState.outputSignals.length}`,
        tone: "outline",
      });
    }

    if (nextItems.length === 0) {
      nextItems.push({
        key: "default_mode",
        label: "当前以直接回答优先，必要时再升级工具链",
        tone: "outline",
      });
    }

    return nextItems;
  }, [
    harnessState,
    isSending,
    runtimeStatusTitle,
    subAgentRuntime.isRunning,
    subAgentRuntime.progress,
  ]);

  return (
    <div
      className={
        variant === "embedded"
          ? "rounded-xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-3"
          : "mx-3 mb-2 mt-3 rounded-2xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-3"
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-foreground">通用 Agent</div>
        <Badge variant="outline">{themeLabel}</Badge>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {capabilities.map((item) => (
          <span
            key={item.key}
            className={[
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              item.enabled
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/70 bg-background/80 text-muted-foreground",
            ].join(" ")}
          >
            {item.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {statusItems.map((item) => (
          <Badge key={item.key} variant={item.tone || "outline"}>
            {item.label}
          </Badge>
        ))}
      </div>
    </div>
  );
};

export default AgentRuntimeStrip;
