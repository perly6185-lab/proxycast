import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { A2UIFormAPI } from "./a2uiForm";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("a2uiForm API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理表单创建、查询、保存、提交、删除命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ id: "form-1", status: "draft" })
      .mockResolvedValueOnce({ id: "form-1", status: "draft" })
      .mockResolvedValueOnce([{ id: "form-1", status: "draft" }])
      .mockResolvedValueOnce([{ id: "form-1", status: "draft" }])
      .mockResolvedValueOnce({ id: "form-1", status: "draft" })
      .mockResolvedValueOnce({ id: "form-1", status: "submitted" })
      .mockResolvedValueOnce(undefined);

    await expect(
      A2UIFormAPI.create(1, "session-1", '{"type":"form"}'),
    ).resolves.toEqual(expect.objectContaining({ id: "form-1" }));
    await expect(A2UIFormAPI.get("form-1")).resolves.toEqual(
      expect.objectContaining({ id: "form-1" }),
    );
    await expect(A2UIFormAPI.getByMessage(1)).resolves.toEqual([
      expect.objectContaining({ id: "form-1" }),
    ]);
    await expect(A2UIFormAPI.getBySession("session-1")).resolves.toEqual([
      expect.objectContaining({ id: "form-1" }),
    ]);
    await expect(
      A2UIFormAPI.saveFormData("form-1", '{"name":"demo"}'),
    ).resolves.toEqual(expect.objectContaining({ status: "draft" }));
    await expect(
      A2UIFormAPI.submit("form-1", '{"name":"demo"}'),
    ).resolves.toEqual(expect.objectContaining({ status: "submitted" }));
    await expect(A2UIFormAPI.delete("form-1")).resolves.toBeUndefined();
  });

  it("应在已有消息表单时复用首条记录", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce([{ id: "form-2" }]);

    await expect(
      A2UIFormAPI.getOrCreate(2, "session-2", '{"type":"form"}'),
    ).resolves.toEqual(expect.objectContaining({ id: "form-2" }));
    expect(safeInvoke).toHaveBeenCalledTimes(1);
    expect(safeInvoke).toHaveBeenCalledWith("get_a2ui_forms_by_message", {
      messageId: 2,
    });
  });
});
