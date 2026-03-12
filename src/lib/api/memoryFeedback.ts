import { safeInvoke } from "@/lib/dev-bridge";

export interface FeedbackRequest {
  memory_id: string;
  action: "approve" | "reject" | { type: "modify"; changes: string };
  session_id: string;
}

export interface FeedbackStats {
  total: number;
  approve_count: number;
  reject_count: number;
  modify_count: number;
  approval_rate: number;
}

export async function recordFeedback(
  memoryId: string,
  action: "approve" | "reject",
  sessionId: string,
): Promise<void> {
  return safeInvoke<void>("unified_memory_feedback", {
    request: {
      memory_id: memoryId,
      action: { type: action },
      session_id: sessionId,
    },
  });
}

export async function getFeedbackStats(
  sessionId: string,
): Promise<FeedbackStats> {
  return safeInvoke<FeedbackStats>("get_memory_feedback_stats", {
    session_id: sessionId,
  });
}
