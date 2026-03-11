import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { checkApiCompatibility } from "./apiCompatibility";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("apiCompatibility API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理兼容性检查命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      provider: "openai",
      overall_status: "ok",
      results: [],
      warnings: [],
    });

    await expect(checkApiCompatibility("openai")).resolves.toEqual(
      expect.objectContaining({ overall_status: "ok" }),
    );
  });
});
