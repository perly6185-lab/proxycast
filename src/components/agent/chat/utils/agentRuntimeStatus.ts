import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { ContextTraceStep } from "@/lib/api/agentStream";
import type { AgentRuntimeStatus } from "../types";

function buildExecutionLabel(strategy: AsterExecutionStrategy): string {
  switch (strategy) {
    case "auto":
      return "自动选择执行方式";
    case "react":
      return "对话优先执行";
    case "code_orchestrated":
      return "代码编排执行";
    default:
      return strategy;
  }
}

function normalizeRuntimeErrorDetail(errorMessage: string): string {
  const detail = errorMessage.trim();
  return detail || "执行链路返回失败，请查看详情后重试。";
}

export function buildInitialAgentRuntimeStatus(options: {
  executionStrategy: AsterExecutionStrategy;
  webSearch?: boolean;
  thinking?: boolean;
  skipUserMessage?: boolean;
}): AgentRuntimeStatus {
  const checkpoints = [
    buildExecutionLabel(options.executionStrategy),
    options.webSearch ? "联网搜索仅作为候选能力待命" : "优先本地直接回答",
    options.thinking ? "必要时启用深度思考" : "先走轻量推理",
    options.skipUserMessage ? "系统引导请求" : "用户请求已入队",
  ];

  return {
    phase: "preparing",
    title: "Agent 正在准备执行",
    detail: "正在理解请求、判断执行车道并准备当前回合。",
    checkpoints,
  };
}

export function buildWaitingAgentRuntimeStatus(options: {
  executionStrategy: AsterExecutionStrategy;
  webSearch?: boolean;
  thinking?: boolean;
}): AgentRuntimeStatus {
  const checkpoints = [
    "会话已建立",
    buildExecutionLabel(options.executionStrategy),
    options.webSearch ? "先理解意图，再决定是否联网" : "直接回答优先",
    options.thinking ? "推理增强已待命" : "等待首个模型事件",
  ];

  return {
    phase: "routing",
    title: "正在建立执行回合",
    detail: "已提交到运行时，正在装载工作区与等待首个执行事件。",
    checkpoints,
  };
}

export function buildContextRuntimeStatus(
  steps: ContextTraceStep[],
): AgentRuntimeStatus {
  const latestStep = steps[steps.length - 1];
  const checkpoints = steps
    .slice(-3)
    .map((step) => `${step.stage} · ${step.detail}`);

  return {
    phase: "context",
    title: "正在装载上下文",
    detail: latestStep
      ? `${latestStep.stage}：${latestStep.detail}`
      : "正在整理上下文以生成更准确的响应。",
    checkpoints,
  };
}

export function buildActionResumeRuntimeStatus(): AgentRuntimeStatus {
  return {
    phase: "routing",
    title: "已提交补充信息，继续执行中",
    detail: "补充信息已回填到当前执行链路，正在恢复后续步骤。",
    checkpoints: ["补充信息已确认", "已唤醒当前执行链路", "等待下一条执行事件"],
  };
}

export function buildFailedAgentRuntimeStatus(
  errorMessage: string,
): AgentRuntimeStatus {
  return {
    phase: "failed",
    title: "当前执行失败",
    detail: normalizeRuntimeErrorDetail(errorMessage),
    checkpoints: ["已保留当前回合过程", "可修正问题后重试", "如需继续可补充更明确的输入"],
  };
}

export function buildFailedAgentMessageContent(
  errorMessage: string,
  partialContent?: string,
): string {
  const failureText = `执行失败：${normalizeRuntimeErrorDetail(errorMessage)}`;
  const trimmedPartialContent = partialContent?.trim();
  return trimmedPartialContent
    ? `${trimmedPartialContent}\n\n${failureText}`
    : failureText;
}

export function formatAgentRuntimeStatusSummary(
  status?: AgentRuntimeStatus | null,
): string {
  if (!status?.title) {
    return "Agent 正在准备执行";
  }

  const lines = [status.title.trim()];
  if (status.detail?.trim()) {
    lines.push(status.detail.trim());
  }

  return lines.join("\n\n");
}
