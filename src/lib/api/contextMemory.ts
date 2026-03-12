/**
 * 上下文记忆管理 API
 *
 * 基于文件系统的持久化记忆系统，解决 AI Agent 的上下文丢失、目标漂移、错误重复问题
 */

import { safeInvoke } from "@/lib/dev-bridge";

export interface MemoryEntry {
  id: string;
  session_id: string;
  file_type: MemoryFileType;
  title: string;
  content: string;
  tags: string[];
  priority: number;
  created_at: number;
  updated_at: number;
  archived: boolean;
}

export type MemoryFileType =
  | "task_plan"
  | "findings"
  | "progress"
  | "error_log";

export interface MemoryStats {
  session_id: string;
  active_memories: number;
  archived_memories: number;
  unresolved_errors: number;
  resolved_errors: number;
  memory_by_type: Record<MemoryFileType, number>;
  last_updated: number;
}

export interface SaveMemoryRequest {
  session_id: string;
  file_type: MemoryFileType;
  title: string;
  content: string;
  tags: string[];
  priority: number;
}

export interface RecordErrorRequest {
  session_id: string;
  error_description: string;
  attempted_solution: string;
}

export interface ResolveErrorRequest {
  session_id: string;
  error_description: string;
  resolution: string;
}

/**
 * 上下文记忆管理 API 类
 */
export class ContextMemoryAPI {
  /**
   * 保存记忆条目
   */
  static async saveMemoryEntry(request: SaveMemoryRequest): Promise<void> {
    return safeInvoke<void>("save_memory_entry", { request });
  }

  /**
   * 获取会话记忆
   */
  static async getSessionMemories(
    sessionId: string,
    fileType?: MemoryFileType,
  ): Promise<MemoryEntry[]> {
    return safeInvoke<MemoryEntry[]>("get_session_memories", {
      sessionId,
      fileType: fileType || null,
    });
  }

  /**
   * 获取记忆上下文（用于 AI 上下文）
   */
  static async getMemoryContext(sessionId: string): Promise<string> {
    return safeInvoke<string>("get_memory_context", { sessionId });
  }

  /**
   * 记录错误
   */
  static async recordError(request: RecordErrorRequest): Promise<void> {
    return safeInvoke<void>("record_error", { request });
  }

  /**
   * 检查是否应该避免某个操作（3次错误协议）
   */
  static async shouldAvoidOperation(
    sessionId: string,
    operationDescription: string,
  ): Promise<boolean> {
    return safeInvoke<boolean>("should_avoid_operation", {
      sessionId,
      operationDescription,
    });
  }

  /**
   * 标记错误已解决
   */
  static async markErrorResolved(request: ResolveErrorRequest): Promise<void> {
    return safeInvoke<void>("mark_error_resolved", { request });
  }

  /**
   * 获取记忆统计信息
   */
  static async getMemoryStats(sessionId: string): Promise<MemoryStats> {
    return safeInvoke<MemoryStats>("get_memory_stats", { sessionId });
  }

  /**
   * 清理过期记忆
   */
  static async cleanupExpiredMemories(): Promise<void> {
    return safeInvoke<void>("cleanup_expired_memories");
  }

  /**
   * 保存任务计划记忆
   */
  static async saveTaskPlan(
    sessionId: string,
    title: string,
    content: string,
    priority: number = 3,
  ): Promise<void> {
    return this.saveMemoryEntry({
      session_id: sessionId,
      file_type: "task_plan",
      title,
      content,
      tags: ["任务计划"],
      priority,
    });
  }

  /**
   * 保存研究发现
   */
  static async saveFinding(
    sessionId: string,
    title: string,
    content: string,
    tags: string[] = [],
    priority: number = 4,
  ): Promise<void> {
    return this.saveMemoryEntry({
      session_id: sessionId,
      file_type: "findings",
      title,
      content,
      tags: ["发现", ...tags],
      priority,
    });
  }

  /**
   * 记录进度
   */
  static async logProgress(
    sessionId: string,
    title: string,
    content: string,
  ): Promise<void> {
    return this.saveMemoryEntry({
      session_id: sessionId,
      file_type: "progress",
      title,
      content,
      tags: ["进度"],
      priority: 2,
    });
  }

  /**
   * 应用 2-Action 规则：每2次视觉操作后保存发现
   */
  static async apply2ActionRule(
    sessionId: string,
    finding: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleTimeString();
    return this.saveFinding(
      sessionId,
      `2-Action 规则发现 (${timestamp})`,
      finding,
      ["2-Action规则", "自动保存"],
      4,
    );
  }

  /**
   * 记录错误并检查是否需要避免重复操作
   */
  static async recordErrorWithCheck(
    sessionId: string,
    errorDescription: string,
    attemptedSolution: string,
    operationDescription?: string,
  ): Promise<{ shouldAvoid: boolean }> {
    // 记录错误
    await this.recordError({
      session_id: sessionId,
      error_description: errorDescription,
      attempted_solution: attemptedSolution,
    });

    // 检查是否应该避免该操作
    const shouldAvoid = operationDescription
      ? await this.shouldAvoidOperation(sessionId, operationDescription)
      : false;

    return { shouldAvoid };
  }
}

export default ContextMemoryAPI;
