import { describe, expect, it } from "vitest";

import { buildSyntheticSubagentTimelineItems } from "./subagentTimeline";

describe("subagentTimeline", () => {
  it("应将调度事件映射为子代理 timeline items", () => {
    const items = buildSyntheticSubagentTimelineItems({
      threadId: "thread-1",
      turnId: "turn-1",
      baseTime: new Date("2026-03-13T10:00:00Z"),
      events: [
        { type: "started", totalTasks: 2 },
        { type: "taskStarted", taskId: "task-a", taskType: "research" },
        { type: "progress", progress: {
          total: 2,
          completed: 0,
          failed: 0,
          running: 1,
          pending: 1,
          skipped: 0,
          cancelled: false,
          currentTasks: ["task-a"],
          percentage: 50,
        } },
        { type: "taskCompleted", taskId: "task-a", durationMs: 1200 },
        { type: "completed", success: true, durationMs: 1800 },
      ],
    });

    expect(items.some((item) => item.id.includes(":run"))).toBe(true);
    expect(items.some((item) => item.id.includes("task-a"))).toBe(true);
    expect(
      items.find((item) => item.id.includes("task-a"))?.status,
    ).toBe("completed");
  });

  it("缺少 thread 或 turn 时应返回空数组", () => {
    expect(
      buildSyntheticSubagentTimelineItems({
        threadId: null,
        turnId: "turn-1",
        events: [{ type: "started", totalTasks: 1 }],
      }),
    ).toEqual([]);
  });
});
