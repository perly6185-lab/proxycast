import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { ToolHooksAPI } from "./toolHooks";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("toolHooks API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理钩子规则管理命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: "rule-1", name: "规则1" }])
      .mockResolvedValueOnce({ "rule-1": { execution_count: 3 } })
      .mockResolvedValueOnce(undefined);

    const rule = ToolHooksAPI.createCustomRule(
      "rule-1",
      "规则1",
      "说明",
      "session_start",
      [],
      [],
    );

    await expect(
      ToolHooksAPI.executeHooks({
        trigger: "session_start",
        context: { session_id: "session-1", message_count: 0, metadata: {} },
      }),
    ).resolves.toBeUndefined();
    await expect(ToolHooksAPI.addHookRule(rule)).resolves.toBeUndefined();
    await expect(
      ToolHooksAPI.removeHookRule("rule-1"),
    ).resolves.toBeUndefined();
    await expect(
      ToolHooksAPI.toggleHookRule("rule-1", true),
    ).resolves.toBeUndefined();
    await expect(ToolHooksAPI.getHookRules()).resolves.toEqual([
      expect.objectContaining({ id: "rule-1" }),
    ]);
    await expect(ToolHooksAPI.getHookExecutionStats()).resolves.toEqual(
      expect.objectContaining({ "rule-1": expect.any(Object) }),
    );
    await expect(
      ToolHooksAPI.clearHookExecutionStats(),
    ).resolves.toBeUndefined();
  });

  it("应基于上下文辅助方法生成 executeHooks 请求", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValue(undefined)
      .mockResolvedValue(undefined)
      .mockResolvedValue(undefined);

    await ToolHooksAPI.triggerSessionStart("session-1", { source: "test" });
    await ToolHooksAPI.triggerPreToolUse(
      "session-1",
      "read_file",
      { path: "/tmp/a.ts" },
      "读取文件",
      2,
    );
    await ToolHooksAPI.triggerStop("session-1", 5, { source: "test" });

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "execute_hooks", {
      request: expect.objectContaining({
        trigger: "session_start",
        context: expect.objectContaining({
          session_id: "session-1",
          metadata: expect.objectContaining({ source: "test" }),
        }),
      }),
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "execute_hooks", {
      request: expect.objectContaining({
        trigger: "pre_tool_use",
        context: expect.objectContaining({
          tool_name: "read_file",
          message_count: 2,
        }),
      }),
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "execute_hooks", {
      request: expect.objectContaining({
        trigger: "stop",
        context: expect.objectContaining({
          message_count: 5,
        }),
      }),
    });
  });
});
