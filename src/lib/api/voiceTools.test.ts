import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { getAvailableVoices, testTts } from "./voiceTools";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("voiceTools API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理语音测试命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ success: true, error: null, audio_path: null })
      .mockResolvedValueOnce([{ id: "alloy", name: "Alloy", language: "en" }]);

    await expect(testTts("openai", "alloy")).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
    await expect(getAvailableVoices("openai")).resolves.toEqual([
      expect.objectContaining({ id: "alloy" }),
    ]);
  });
});
