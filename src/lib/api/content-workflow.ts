/**
 * 内容创作工作流 API
 *
 * 封装所有工作流相关的 Tauri 命令调用
 */

import { safeInvoke } from "@/lib/dev-bridge";

/**
 * 步骤状态
 */
export type StepStatus =
  | "pending"
  | "active"
  | "completed"
  | "skipped"
  | "error";

/**
 * 步骤类型
 */
export type StepType =
  | "clarify"
  | "research"
  | "outline"
  | "write"
  | "polish"
  | "adapt";

/**
 * 主题类型
 */
export type ThemeType =
  | "general"
  | "knowledge"
  | "planning"
  | "social-media"
  | "poster"
  | "document"
  | "paper"
  | "novel"
  | "script"
  | "music"
  | "video";

/**
 * 创作模式
 */
export type CreationMode = "guided" | "fast" | "hybrid" | "framework";

/**
 * 步骤行为配置
 */
export interface StepBehavior {
  skippable: boolean;
  redoable: boolean;
  auto_advance: boolean;
}

/**
 * 表单字段类型
 */
export type FormFieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "slider"
  | "tags"
  | "outline";

/**
 * 表单字段选项
 */
export interface FormFieldOption {
  label: string;
  value: string;
}

/**
 * 表单字段定义
 */
export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  options?: FormFieldOption[];
  default_value?: unknown;
}

/**
 * 表单配置
 */
export interface FormConfig {
  fields: FormField[];
  submit_label: string;
  skip_label?: string;
}

/**
 * AI 任务配置
 */
export interface AITaskConfig {
  task_type: string;
  prompt?: string;
  streaming: boolean;
}

/**
 * 内容文件
 */
export interface ContentFile {
  id: string;
  name: string;
  type: string;
  content?: string;
  created_at: number;
  updated_at: number;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 步骤结果
 */
export interface StepResult {
  user_input?: Record<string, unknown>;
  ai_output?: unknown;
  artifacts?: ContentFile[];
}

/**
 * 步骤定义
 */
export interface StepDefinition {
  id: string;
  type: StepType;
  title: string;
  description?: string;
  form?: FormConfig;
  ai_task?: AITaskConfig;
  behavior: StepBehavior;
}

/**
 * 工作流步骤（运行时状态）
 */
export interface WorkflowStep extends StepDefinition {
  status: StepStatus;
  result?: StepResult;
}

/**
 * 工作流状态
 */
export interface WorkflowState {
  id: string;
  content_id: string;
  theme: ThemeType;
  mode: CreationMode;
  steps: WorkflowStep[];
  current_step_index: number;
  created_at: number;
  updated_at: number;
}

/**
 * 内容创作工作流 API
 */
export const contentWorkflowApi = {
  /**
   * 创建工作流
   */
  async create(
    contentId: string,
    theme: ThemeType,
    mode: CreationMode,
  ): Promise<WorkflowState> {
    return safeInvoke<WorkflowState>("content_workflow_create", {
      contentId,
      theme,
      mode,
    });
  },

  /**
   * 获取工作流
   */
  async get(workflowId: string): Promise<WorkflowState | null> {
    return safeInvoke<WorkflowState | null>("content_workflow_get", {
      workflowId,
    });
  },

  /**
   * 根据 content_id 获取工作流
   */
  async getByContent(contentId: string): Promise<WorkflowState | null> {
    return safeInvoke<WorkflowState | null>("content_workflow_get_by_content", {
      contentId,
    });
  },

  /**
   * 推进工作流（完成当前步骤）
   */
  async advance(
    workflowId: string,
    stepResult: StepResult,
  ): Promise<WorkflowState> {
    return safeInvoke<WorkflowState>("content_workflow_advance", {
      workflowId,
      stepResult,
    });
  },

  /**
   * 重试失败的步骤
   */
  async retry(workflowId: string): Promise<WorkflowState> {
    return safeInvoke<WorkflowState>("content_workflow_retry", {
      workflowId,
    });
  },

  /**
   * 取消工作流
   */
  async cancel(workflowId: string): Promise<void> {
    return safeInvoke<void>("content_workflow_cancel", {
      workflowId,
    });
  },
};
