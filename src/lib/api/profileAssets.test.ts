import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { deleteAvatar, uploadAvatar } from "./profileAssets";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("profileAssets API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理头像上传与删除命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ url: "/avatar.png", size: 123 })
      .mockResolvedValueOnce(undefined);

    await expect(uploadAvatar("/tmp/avatar.png")).resolves.toEqual(
      expect.objectContaining({ url: "/avatar.png" }),
    );
    await expect(deleteAvatar("/avatar.png")).resolves.toBeUndefined();
  });
});
