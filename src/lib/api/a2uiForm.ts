/**
 * A2UI 表单持久化 API
 *
 * 提供 A2UI 表单数据的持久化管理，支持：
 * - 创建表单记录
 * - 保存用户填写的表单数据
 * - 提交表单
 * - 查询表单（按消息/会话）
 */

import { safeInvoke } from "@/lib/dev-bridge";

/**
 * A2UI 表单记录
 */
export interface A2UIForm {
  /** 表单唯一 ID */
  id: string;
  /** 关联的消息 ID */
  messageId: number;
  /** 会话 ID */
  sessionId: string;
  /** A2UI 响应 JSON（原始 AI 返回的 A2UI 结构） */
  a2uiResponseJson: string;
  /** 用户填写的表单数据 JSON */
  formDataJson: string | null;
  /** 表单状态: draft | submitted */
  status: "draft" | "submitted";
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

/**
 * A2UI 表单 API 类
 */
export class A2UIFormAPI {
  /**
   * 创建 A2UI 表单记录
   *
   * @param messageId 关联的消息 ID
   * @param sessionId 会话 ID
   * @param a2uiResponseJson A2UI 响应 JSON
   * @param formDataJson 初始表单数据（可选）
   */
  static async create(
    messageId: number,
    sessionId: string,
    a2uiResponseJson: string,
    formDataJson?: string,
  ): Promise<A2UIForm> {
    return safeInvoke<A2UIForm>("create_a2ui_form", {
      messageId,
      sessionId,
      a2uiResponseJson,
      formDataJson: formDataJson ?? null,
    });
  }

  /**
   * 获取单个表单
   */
  static async get(id: string): Promise<A2UIForm | null> {
    return safeInvoke<A2UIForm | null>("get_a2ui_form", { id });
  }

  /**
   * 根据消息 ID 获取表单列表
   */
  static async getByMessage(messageId: number): Promise<A2UIForm[]> {
    return safeInvoke<A2UIForm[]>("get_a2ui_forms_by_message", { messageId });
  }

  /**
   * 根据会话 ID 获取所有表单
   */
  static async getBySession(sessionId: string): Promise<A2UIForm[]> {
    return safeInvoke<A2UIForm[]>("get_a2ui_forms_by_session", { sessionId });
  }

  /**
   * 保存表单数据（用户填写的内容）
   *
   * @param id 表单 ID
   * @param formDataJson 表单数据 JSON
   */
  static async saveFormData(
    id: string,
    formDataJson: string,
  ): Promise<A2UIForm> {
    return safeInvoke<A2UIForm>("save_a2ui_form_data", { id, formDataJson });
  }

  /**
   * 提交表单
   *
   * @param id 表单 ID
   * @param formDataJson 最终表单数据 JSON
   */
  static async submit(id: string, formDataJson: string): Promise<A2UIForm> {
    return safeInvoke<A2UIForm>("submit_a2ui_form", { id, formDataJson });
  }

  /**
   * 删除表单
   */
  static async delete(id: string): Promise<void> {
    return safeInvoke<void>("delete_a2ui_form", { id });
  }

  /**
   * 获取或创建表单（便捷方法）
   *
   * 如果消息已有表单记录则返回，否则创建新记录
   */
  static async getOrCreate(
    messageId: number,
    sessionId: string,
    a2uiResponseJson: string,
  ): Promise<A2UIForm> {
    const forms = await this.getByMessage(messageId);
    if (forms.length > 0) {
      return forms[0];
    }
    return this.create(messageId, sessionId, a2uiResponseJson);
  }
}

export default A2UIFormAPI;
