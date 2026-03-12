import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { promptsApi } from "./prompts";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("prompts API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理现役 prompt 命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ main: { id: "main" } })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("imported")
      .mockResolvedValueOnce("content")
      .mockResolvedValueOnce(1);

    await expect(promptsApi.getPrompts("claude")).resolves.toEqual(
      expect.objectContaining({ main: { id: "main" } }),
    );
    await expect(
      promptsApi.upsertPrompt("claude", "main", {
        id: "main",
        app_type: "claude",
        name: "Main",
        content: "hello",
        enabled: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      promptsApi.addPrompt({
        id: "main",
        app_type: "claude",
        name: "Main",
        content: "hello",
        enabled: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      promptsApi.updatePrompt({
        id: "main",
        app_type: "claude",
        name: "Main",
        content: "hello",
        enabled: true,
      }),
    ).resolves.toBeUndefined();
    await expect(promptsApi.deletePrompt("claude", "main")).resolves.toBeUndefined();
    await expect(promptsApi.enablePrompt("claude", "main")).resolves.toBeUndefined();
    await expect(promptsApi.importFromFile("claude")).resolves.toBe("imported");
    await expect(promptsApi.getCurrentFileContent("claude")).resolves.toBe("content");
    await expect(promptsApi.autoImport("claude")).resolves.toBe(1);
  });

  it("不应继续暴露 switchPrompt compat API", () => {
    expect("switchPrompt" in promptsApi).toBe(false);
  });
});
