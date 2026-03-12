import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { contentWorkflowApi } from "./content-workflow";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("contentWorkflow API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理工作流创建、读取、推进、重试与取消命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ id: "wf-1", steps: [] })
      .mockResolvedValueOnce({ id: "wf-1", steps: [] })
      .mockResolvedValueOnce({ id: "wf-1", steps: [] })
      .mockResolvedValueOnce({ id: "wf-1", steps: [] })
      .mockResolvedValueOnce({ id: "wf-1", steps: [] })
      .mockResolvedValueOnce(undefined);

    await expect(
      contentWorkflowApi.create("content-1", "document", "guided"),
    ).resolves.toEqual(expect.objectContaining({ id: "wf-1" }));
    await expect(contentWorkflowApi.get("wf-1")).resolves.toEqual(
      expect.objectContaining({ id: "wf-1" }),
    );
    await expect(contentWorkflowApi.getByContent("content-1")).resolves.toEqual(
      expect.objectContaining({ id: "wf-1" }),
    );
    await expect(
      contentWorkflowApi.advance("wf-1", { user_input: { topic: "测试" } }),
    ).resolves.toEqual(expect.objectContaining({ id: "wf-1" }));
    await expect(contentWorkflowApi.retry("wf-1")).resolves.toEqual(
      expect.objectContaining({ id: "wf-1" }),
    );
    await expect(contentWorkflowApi.cancel("wf-1")).resolves.toBeUndefined();
  });
});
