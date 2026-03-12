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
    vi.mocked(safeInvoke).mockImplementation(async (command) => {
      switch (command) {
        case "memory_runtime_get_stats":
          return {
            total_entries: 1,
            storage_used: 2,
            memory_count: 3,
          };
        case "memory_runtime_request_analysis":
          return { analyzed_sessions: 1 };
        case "memory_runtime_cleanup":
          return { cleaned_entries: 1, freed_space: 2 };
        case "memory_runtime_get_overview":
          return { stats: {}, categories: [], entries: [] };
        case "memory_get_effective_sources":
          return { sources: [] };
        case "memory_get_auto_index":
          return { items: [] };
        default:
          return null;
      }
    });

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

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "memory_runtime_get_stats");
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "memory_runtime_request_analysis", {
      fromTimestamp: undefined,
      toTimestamp: undefined,
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "memory_runtime_cleanup");
    expect(safeInvoke).toHaveBeenNthCalledWith(4, "memory_runtime_get_overview", {
      limit: 200,
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(5, "memory_get_effective_sources", {
      activeRelativePath: undefined,
      workingDir: undefined,
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(6, "memory_get_auto_index", {
      workingDir: undefined,
    });
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
