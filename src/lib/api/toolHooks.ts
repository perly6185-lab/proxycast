/**
 * 工具钩子管理 API
 *
 * 提供工具执行前后的钩子机制，用于自动化上下文记忆管理
 */

import { safeInvoke } from "@/lib/dev-bridge";

export type HookTrigger =
  | "session_start"
  | "pre_tool_use"
  | "post_tool_use"
  | "stop";

export interface HookRule {
  id: string;
  name: string;
  description: string;
  trigger: HookTrigger;
  conditions: HookCondition[];
  actions: HookAction[];
  enabled: boolean;
  priority: number;
  created_at: number;
}

export type HookCondition =
  | { tool_name_equals: string }
  | { tool_name_contains: string }
  | { message_contains: string }
  | { message_count_greater_than: number }
  | { error_count_greater_than: number }
  | { custom: { condition_type: string; parameters: Record<string, string> } };

export type HookAction =
  | {
      save_finding: {
        title: string;
        content: string;
        tags: string[];
        priority: number;
      };
    }
  | { update_task_plan: { title: string; content: string; priority: number } }
  | { log_progress: { title: string; content: string } }
  | { record_error: { error_description: string; attempted_solution: string } }
  | { custom: { action_type: string; parameters: Record<string, string> } };

export interface HookExecutionStats {
  execution_count: number;
  success_count: number;
  failure_count: number;
  last_execution_at: number;
  average_execution_time_ms: number;
}

export interface HookContextData {
  session_id: string;
  tool_name?: string;
  tool_parameters?: Record<string, string>;
  tool_result?: string;
  message_content?: string;
  message_count: number;
  error_info?: string;
  metadata: Record<string, string>;
}

export interface ExecuteHooksRequest {
  trigger: HookTrigger;
  context: HookContextData;
}

/**
 * 工具钩子管理 API 类
 */
export class ToolHooksAPI {
  /**
   * 执行钩子
   */
  static async executeHooks(request: ExecuteHooksRequest): Promise<void> {
    return safeInvoke<void>("execute_hooks", { request });
  }

  /**
   * 添加钩子规则
   */
  static async addHookRule(rule: HookRule): Promise<void> {
    return safeInvoke<void>("add_hook_rule", { rule });
  }

  /**
   * 移除钩子规则
   */
  static async removeHookRule(ruleId: string): Promise<void> {
    return safeInvoke<void>("remove_hook_rule", { ruleId });
  }

  /**
   * 启用/禁用钩子规则
   */
  static async toggleHookRule(ruleId: string, enabled: boolean): Promise<void> {
    return safeInvoke<void>("toggle_hook_rule", { ruleId, enabled });
  }

  /**
   * 获取所有钩子规则
   */
  static async getHookRules(): Promise<HookRule[]> {
    return safeInvoke<HookRule[]>("get_hook_rules");
  }

  /**
   * 获取钩子执行统计
   */
  static async getHookExecutionStats(): Promise<
    Record<string, HookExecutionStats>
  > {
    return safeInvoke<Record<string, HookExecutionStats>>(
      "get_hook_execution_stats",
    );
  }

  /**
   * 清理钩子执行统计
   */
  static async clearHookExecutionStats(): Promise<void> {
    return safeInvoke<void>("clear_hook_execution_stats");
  }

  /**
   * 触发会话开始钩子
   */
  static async triggerSessionStart(
    sessionId: string,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    return this.executeHooks({
      trigger: "session_start",
      context: {
        session_id: sessionId,
        message_count: 0,
        metadata: {
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      },
    });
  }

  /**
   * 触发工具使用前钩子
   */
  static async triggerPreToolUse(
    sessionId: string,
    toolName: string,
    toolParameters: Record<string, string> = {},
    messageContent?: string,
    messageCount: number = 0,
  ): Promise<void> {
    return this.executeHooks({
      trigger: "pre_tool_use",
      context: {
        session_id: sessionId,
        tool_name: toolName,
        tool_parameters: toolParameters,
        message_content: messageContent,
        message_count: messageCount,
        metadata: {
          timestamp: new Date().toISOString(),
          tool_name: toolName,
        },
      },
    });
  }

  /**
   * 触发工具使用后钩子
   */
  static async triggerPostToolUse(
    sessionId: string,
    toolName: string,
    toolResult: string,
    toolParameters: Record<string, string> = {},
    messageContent?: string,
    messageCount: number = 0,
    errorInfo?: string,
  ): Promise<void> {
    return this.executeHooks({
      trigger: "post_tool_use",
      context: {
        session_id: sessionId,
        tool_name: toolName,
        tool_parameters: toolParameters,
        tool_result: toolResult,
        message_content: messageContent,
        message_count: messageCount,
        error_info: errorInfo,
        metadata: {
          timestamp: new Date().toISOString(),
          tool_name: toolName,
          has_error: errorInfo ? "true" : "false",
        },
      },
    });
  }

  /**
   * 触发会话停止钩子
   */
  static async triggerStop(
    sessionId: string,
    messageCount: number,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    return this.executeHooks({
      trigger: "stop",
      context: {
        session_id: sessionId,
        message_count: messageCount,
        metadata: {
          timestamp: new Date().toISOString(),
          session_end: "true",
          ...metadata,
        },
      },
    });
  }

  /**
   * 创建自定义钩子规则
   */
  static createCustomRule(
    id: string,
    name: string,
    description: string,
    trigger: HookTrigger,
    conditions: HookCondition[],
    actions: HookAction[],
    priority: number = 100,
  ): HookRule {
    return {
      id,
      name,
      description,
      trigger,
      conditions,
      actions,
      enabled: true,
      priority,
      created_at: Date.now(),
    };
  }

  /**
   * 创建重要发现自动保存规则
   */
  static createImportantFindingRule(): HookRule {
    return this.createCustomRule(
      "important-finding-auto-save",
      "重要发现自动保存",
      "检测到重要信息时自动保存到 findings.md",
      "post_tool_use",
      [{ message_contains: "重要" }, { message_contains: "发现" }],
      [
        {
          save_finding: {
            title: "重要发现 (自动检测)",
            content: "检测到重要信息，已自动保存",
            tags: ["重要", "自动保存"],
            priority: 4,
          },
        },
      ],
      1,
    );
  }

  /**
   * 创建错误自动记录规则
   */
  static createErrorAutoRecordRule(): HookRule {
    return this.createCustomRule(
      "error-auto-record",
      "错误自动记录",
      "检测到错误时自动记录到错误日志",
      "post_tool_use",
      [{ message_contains: "错误" }],
      [
        {
          record_error: {
            error_description: "检测到错误",
            attempted_solution: "正在尝试解决",
          },
        },
      ],
      1,
    );
  }

  /**
   * 创建 2-Action 规则
   */
  static create2ActionRule(): HookRule {
    return this.createCustomRule(
      "2-action-rule",
      "2-Action 规则",
      "每2次视觉操作后自动保存发现",
      "post_tool_use",
      [{ tool_name_contains: "view" }],
      [
        {
          save_finding: {
            title: "2-Action 规则触发",
            content: "视觉操作完成，自动保存发现",
            tags: ["2-Action规则", "视觉操作"],
            priority: 3,
          },
        },
      ],
      2,
    );
  }

  /**
   * 批量添加默认钩子规则
   */
  static async addDefaultRules(): Promise<void> {
    const rules = [
      this.createImportantFindingRule(),
      this.createErrorAutoRecordRule(),
      this.create2ActionRule(),
    ];

    for (const rule of rules) {
      try {
        await this.addHookRule(rule);
      } catch (error) {
        console.warn(`添加钩子规则失败: ${rule.name}`, error);
      }
    }
  }
}

export default ToolHooksAPI;
