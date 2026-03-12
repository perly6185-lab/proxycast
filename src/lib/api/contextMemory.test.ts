import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { ContextMemoryAPI } from "./contextMemory";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("contextMemory API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理基础记忆命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: "m1", title: "任务" }])
      .mockResolvedValueOnce("上下文")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ session_id: "session-1", active_memories: 2 })
      .mockResolvedValueOnce(undefined);

    await expect(
      ContextMemoryAPI.saveMemoryEntry({
        session_id: "session-1",
        file_type: "task_plan",
        title: "计划",
        content: "内容",
        tags: ["任务"],
        priority: 3,
      }),
    ).resolves.toBeUndefined();
    await expect(
      ContextMemoryAPI.getSessionMemories("session-1"),
    ).resolves.toEqual([expect.objectContaining({ id: "m1" })]);
    await expect(ContextMemoryAPI.getMemoryContext("session-1")).resolves.toBe(
      "上下文",
    );
    await expect(
      ContextMemoryAPI.recordError({
        session_id: "session-1",
        error_description: "错误",
        attempted_solution: "方案",
      }),
    ).resolves.toBeUndefined();
    await expect(
      ContextMemoryAPI.shouldAvoidOperation("session-1", "重复操作"),
    ).resolves.toBe(true);
    await expect(
      ContextMemoryAPI.markErrorResolved({
        session_id: "session-1",
        error_description: "错误",
        resolution: "已修复",
      }),
    ).resolves.toBeUndefined();
    await expect(ContextMemoryAPI.getMemoryStats("session-1")).resolves.toEqual(
      expect.objectContaining({ active_memories: 2 }),
    );
    await expect(
      ContextMemoryAPI.cleanupExpiredMemories(),
    ).resolves.toBeUndefined();
  });

  it("应通过辅助方法复用基础命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false);

    await ContextMemoryAPI.saveTaskPlan("session-2", "计划", "内容");
    await ContextMemoryAPI.saveFinding("session-2", "发现", "内容", ["关键"]);
    await ContextMemoryAPI.logProgress("session-2", "进度", "完成一半");
    await ContextMemoryAPI.apply2ActionRule("session-2", "发现了线索");
    await expect(
      ContextMemoryAPI.recordErrorWithCheck(
        "session-2",
        "失败",
        "重试",
        "再次点击",
      ),
    ).resolves.toEqual({ shouldAvoid: false });

    expect(safeInvoke).toHaveBeenCalledWith("save_memory_entry", {
      request: expect.objectContaining({ file_type: "task_plan" }),
    });
    expect(safeInvoke).toHaveBeenCalledWith("save_memory_entry", {
      request: expect.objectContaining({ file_type: "findings" }),
    });
    expect(safeInvoke).toHaveBeenCalledWith("save_memory_entry", {
      request: expect.objectContaining({ file_type: "progress" }),
    });
    expect(safeInvoke).toHaveBeenCalledWith("record_error", {
      request: expect.objectContaining({ session_id: "session-2" }),
    });
    expect(safeInvoke).toHaveBeenCalledWith("should_avoid_operation", {
      sessionId: "session-2",
      operationDescription: "再次点击",
    });
  });
});
