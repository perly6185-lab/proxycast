import { describe, expect, it } from "vitest";
import type { AgentThreadItem, Message } from "../types";
import { deriveHarnessSessionState } from "./harnessState";

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    role: "assistant",
    content: "hello",
    timestamp: new Date("2026-03-13T12:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveHarnessSessionState", () => {
  it("应优先从 thread items 提取计划、审批与文件活动", () => {
    const messages = [
      createMessage({
        runtimeStatus: {
          phase: "preparing",
          title: "Agent 正在准备执行",
          detail: "正在理解请求并准备当前回合。",
          checkpoints: ["对话优先执行"],
        },
        contextTrace: [{ stage: "memory", detail: "已注入上下文" }],
      }),
    ];
    const items: AgentThreadItem[] = [
      {
        id: "plan-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "in_progress",
        started_at: "2026-03-13T12:00:00.000Z",
        updated_at: "2026-03-13T12:00:01.000Z",
        type: "plan",
        text: "1. 收集资料\n2. 输出方案",
      },
      {
        id: "approval-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 2,
        status: "in_progress",
        started_at: "2026-03-13T12:00:02.000Z",
        updated_at: "2026-03-13T12:00:02.000Z",
        type: "approval_request",
        request_id: "approval-1",
        action_type: "tool_confirmation",
        prompt: "确认写入文件",
        tool_name: "write_file",
      },
      {
        id: "artifact-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "completed",
        started_at: "2026-03-13T12:00:03.000Z",
        completed_at: "2026-03-13T12:00:04.000Z",
        updated_at: "2026-03-13T12:00:04.000Z",
        type: "file_artifact",
        path: "workspace/plan.md",
        source: "tool_result",
        content: "# 计划\n正文",
      },
    ];

    const state = deriveHarnessSessionState(messages, [], items);

    expect(state.plan.phase).toBe("planning");
    expect(state.runtimeStatus?.title).toBe("Agent 正在准备执行");
    expect(state.plan.items).toHaveLength(2);
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.pendingApprovals[0]?.requestId).toBe("approval-1");
    expect(state.recentFileEvents[0]?.path).toBe("workspace/plan.md");
    expect(state.outputSignals[0]?.artifactPath).toBe("workspace/plan.md");
    expect(state.latestContextTrace).toHaveLength(1);
  });
});
