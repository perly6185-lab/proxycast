import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { getFeedbackStats, recordFeedback } from "./memoryFeedback";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("memoryFeedback API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理反馈记录与统计查询", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        total: 10,
        approve_count: 7,
        reject_count: 2,
        modify_count: 1,
        approval_rate: 0.7,
      });

    await expect(
      recordFeedback("memory-1", "approve", "session-1"),
    ).resolves.toBeUndefined();
    await expect(getFeedbackStats("session-1")).resolves.toEqual(
      expect.objectContaining({ total: 10, approval_rate: 0.7 }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "unified_memory_feedback", {
      request: {
        memory_id: "memory-1",
        action: { type: "approve" },
        session_id: "session-1",
      },
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, "get_memory_feedback_stats", {
      session_id: "session-1",
    });
  });
});
