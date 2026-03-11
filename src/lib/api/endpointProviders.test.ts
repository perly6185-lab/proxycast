import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { getEndpointProviders, setEndpointProvider } from "./endpointProviders";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("endpointProviders API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理端点 Provider 配置读取与保存", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ cursor: "openai" })
      .mockResolvedValueOnce("claude");

    await expect(getEndpointProviders()).resolves.toEqual(
      expect.objectContaining({ cursor: "openai" }),
    );
    await expect(setEndpointProvider("cursor", "claude")).resolves.toBe(
      "claude",
    );
  });
});
