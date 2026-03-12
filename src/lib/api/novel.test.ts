import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  checkNovelConsistency,
  continueNovelChapter,
  createNovelProject,
  deleteNovelCharacter,
  generateNovelCharacters,
  generateNovelChapter,
  generateNovelOutline,
  getNovelProjectSnapshot,
  listNovelRuns,
  polishNovelChapter,
  rewriteNovelChapter,
  updateNovelSettings,
} from "./novel";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

vi.mock("@/lib/novel-settings/types", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/novel-settings/types")
  >("@/lib/novel-settings/types");
  return {
    ...actual,
    normalizeNovelSettingsEnvelope: vi.fn((settings) => ({
      version: 1,
      data: settings,
    })),
  };
});

describe("novel API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理项目与设置命令并归一化设置", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ id: "novel-1", title: "小说" })
      .mockResolvedValueOnce({ id: "settings-1", project_id: "novel-1" });

    await expect(
      createNovelProject({
        title: "小说",
        settings_json: { structure: "三幕式" },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "novel-1" }));
    await expect(
      updateNovelSettings({
        project_id: "novel-1",
        settings_json: { structure: "英雄之旅" },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "settings-1" }));
  });

  it("应代理生成、检查、查询和删除角色命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ run_id: "run-outline", mode: "outline" })
      .mockResolvedValueOnce({ run_id: "run-characters", mode: "characters" })
      .mockResolvedValueOnce({ run_id: "run-chapter", mode: "chapter" })
      .mockResolvedValueOnce({ run_id: "run-continue", mode: "continue" })
      .mockResolvedValueOnce({ run_id: "run-rewrite", mode: "rewrite" })
      .mockResolvedValueOnce({ run_id: "run-polish", mode: "polish" })
      .mockResolvedValueOnce({ id: "check-1", score: 0.9, issues: [] })
      .mockResolvedValueOnce({
        project: { id: "novel-1" },
        characters: [],
        chapters: [],
      })
      .mockResolvedValueOnce([{ id: "run-1" }])
      .mockResolvedValueOnce(true);

    await expect(
      generateNovelOutline({ project_id: "novel-1" }),
    ).resolves.toEqual(expect.objectContaining({ run_id: "run-outline" }));
    await expect(
      generateNovelCharacters({ project_id: "novel-1" }),
    ).resolves.toEqual(expect.objectContaining({ run_id: "run-characters" }));
    await expect(
      generateNovelChapter({ project_id: "novel-1", chapter_no: 1 }),
    ).resolves.toEqual(expect.objectContaining({ run_id: "run-chapter" }));
    await expect(
      continueNovelChapter({ project_id: "novel-1" }),
    ).resolves.toEqual(expect.objectContaining({ run_id: "run-continue" }));
    await expect(
      rewriteNovelChapter({ project_id: "novel-1", chapter_id: "chapter-1" }),
    ).resolves.toEqual(expect.objectContaining({ run_id: "run-rewrite" }));
    await expect(
      polishNovelChapter({ project_id: "novel-1", chapter_id: "chapter-1" }),
    ).resolves.toEqual(expect.objectContaining({ run_id: "run-polish" }));
    await expect(
      checkNovelConsistency({ project_id: "novel-1", chapter_id: "chapter-1" }),
    ).resolves.toEqual(expect.objectContaining({ id: "check-1" }));
    await expect(getNovelProjectSnapshot("novel-1")).resolves.toEqual(
      expect.objectContaining({
        project: expect.objectContaining({ id: "novel-1" }),
      }),
    );
    await expect(listNovelRuns({ project_id: "novel-1" })).resolves.toEqual([
      expect.objectContaining({ id: "run-1" }),
    ]);
    await expect(
      deleteNovelCharacter({ project_id: "novel-1", character_id: "char-1" }),
    ).resolves.toBe(true);
  });
});
