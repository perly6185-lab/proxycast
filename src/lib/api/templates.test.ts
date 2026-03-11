import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createTemplate,
  deleteTemplate,
  getDefaultTemplate,
  listTemplates,
  setDefaultTemplate,
  updateTemplate,
} from "./templates";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("templates API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取模板列表和默认模板", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "t1", name: "模板 1" }])
      .mockResolvedValueOnce({ id: "t1", name: "模板 1" });

    await expect(listTemplates("project-1")).resolves.toEqual([
      expect.objectContaining({ id: "t1" }),
    ]);
    await expect(getDefaultTemplate("project-1")).resolves.toEqual(
      expect.objectContaining({ id: "t1" }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "list_templates", {
      projectId: "project-1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "get_default_template", {
      projectId: "project-1",
    });
  });

  it("应代理模板写操作", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ id: "t2", name: "模板 2" })
      .mockResolvedValueOnce({ id: "t2", name: "模板 2-更新" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      createTemplate({
        projectId: "project-2",
        name: "模板 2",
        platform: "wechat",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "t2" }));
    await expect(
      updateTemplate("t2", { name: "模板 2-更新" }),
    ).resolves.toEqual(expect.objectContaining({ id: "t2" }));
    await expect(deleteTemplate("t2")).resolves.toBeUndefined();
    await expect(
      setDefaultTemplate("project-2", "t2"),
    ).resolves.toBeUndefined();

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "create_template", {
      req: expect.objectContaining({ projectId: "project-2" }),
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "update_template", {
      id: "t2",
      update: { name: "模板 2-更新" },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "delete_template", {
      id: "t2",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(4, "set_default_template", {
      projectId: "project-2",
      templateId: "t2",
    });
  });
});
