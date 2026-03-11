import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  cleanupMemory,
  getMemoryAutoIndex,
  getMemoryEffectiveSources,
  getMemoryOverview,
  getMemoryStats,
  requestMemoryAnalysis,
  toggleMemoryAuto,
  updateMemoryAutoNote,
} from "./memoryRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("memoryRuntime API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理记忆查询命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        total_entries: 1,
        storage_used: 2,
        memory_count: 3,
      })
      .mockResolvedValueOnce({ analyzed_sessions: 1 })
      .mockResolvedValueOnce({ cleaned_entries: 1, freed_space: 2 })
      .mockResolvedValueOnce({ stats: {}, categories: [], entries: [] })
      .mockResolvedValueOnce({ sources: [] })
      .mockResolvedValueOnce({ items: [] });

    await expect(getMemoryStats()).resolves.toEqual(
      expect.objectContaining({ total_entries: 1 }),
    );
    await expect(requestMemoryAnalysis()).resolves.toEqual(
      expect.objectContaining({ analyzed_sessions: 1 }),
    );
    await expect(cleanupMemory()).resolves.toEqual(
      expect.objectContaining({ cleaned_entries: 1 }),
    );
    await expect(getMemoryOverview(200)).resolves.toEqual(
      expect.objectContaining({ entries: [] }),
    );
    await expect(getMemoryEffectiveSources()).resolves.toEqual(
      expect.objectContaining({ sources: [] }),
    );
    await expect(getMemoryAutoIndex()).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
  });

  it("应代理自动记忆开关与写入命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ items: [] });

    await expect(toggleMemoryAuto(true)).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(updateMemoryAutoNote("note", "topic")).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
  });
});
