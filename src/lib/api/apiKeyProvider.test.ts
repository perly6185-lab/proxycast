import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { apiKeyProviderApi } from "./apiKeyProvider";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("apiKeyProvider API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理现役 provider 命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "openai" }])
      .mockResolvedValueOnce({ id: "key-1" })
      .mockResolvedValueOnce({ success: true });

    await expect(apiKeyProviderApi.getProviders()).resolves.toEqual([
      expect.objectContaining({ id: "openai" }),
    ]);
    await expect(
      apiKeyProviderApi.addApiKey({
        provider_id: "openai",
        api_key: "sk-test",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "key-1" }));
    await expect(
      apiKeyProviderApi.testConnection("openai", "gpt-4.1"),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it("不应继续暴露旧 API Key 迁移 API", () => {
    expect("getLegacyApiKeyCredentials" in apiKeyProviderApi).toBe(false);
    expect("migrateLegacyCredentials" in apiKeyProviderApi).toBe(false);
    expect("deleteLegacyCredential" in apiKeyProviderApi).toBe(false);
  });
});
