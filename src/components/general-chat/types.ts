/**
 * @file types.ts
 * @description 通用对话功能的核心类型定义
 * @module components/general-chat/types
 *
 * 定义了会话、消息、画布、UI 状态等核心类型
 * 用于前端状态管理和组件接口
 *
 * @requirements 1.1, 2.1, 4.1
 */

import type { Page, PageParams } from "@/types/page";

// ============================================================================
// 会话相关类型
// ============================================================================

/**
 * 会话信息
 * @description 表示一个对话会话的基本信息
 */
export interface Session {
  /** 会话唯一标识 */
  id: string;
  /** 会话名称/标题 */
  name: string;
  /** 创建时间戳 (毫秒) */
  createdAt: number;
  /** 最后更新时间戳 (毫秒) */
  updatedAt: number;
  /** 消息数量 */
  messageCount: number;
}

// ============================================================================
// 消息相关类型
// ============================================================================

/**
 * 消息角色
 * @description 标识消息的发送者类型
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * 消息状态
 * @description 标识消息的当前处理状态
 */
export type MessageStatus = "pending" | "streaming" | "complete" | "error";

/**
 * 消息内容块类型
 * @description 标识内容块的类型
 */
export type ContentBlockType = "text" | "code" | "image" | "file";

/**
 * 内容块
 * @description 消息中的一个内容单元，可以是文本、代码、图片或文件
 */
export interface ContentBlock {
  /** 内容块类型 */
  type: ContentBlockType;
  /** 内容文本 */
  content: string;
  /** 代码块语言 (仅 type='code' 时有效) */
  language?: string;
  /** 文件名 (仅 type='file' 或 type='image' 时有效) */
  filename?: string;
  /** MIME 类型 (仅 type='file' 或 type='image' 时有效) */
  mimeType?: string;
}

/**
 * 消息元数据
 * @description 消息的附加信息，如模型、token 数等
 */
export interface MessageMetadata {
  /** 使用的模型名称 */
  model?: string;
  /** 消耗的 token 数量 */
  tokens?: number;
  /** 生成耗时 (毫秒) */
  duration?: number;
}

// ============================================================================
// 错误相关类型
// ============================================================================

/**
 * 错误代码枚举
 * @description 定义各种错误类型的代码
 * @requirements 9.2, 9.3
 */
export type ErrorCode =
  | "NETWORK_ERROR" // 网络连接错误
  | "TIMEOUT" // 请求超时
  | "RATE_LIMIT" // 请求频率限制
  | "TOKEN_LIMIT" // Token 数量超限
  | "AUTH_ERROR" // 认证错误
  | "SERVER_ERROR" // 服务器错误
  | "PROVIDER_ERROR" // Provider 错误
  | "UNKNOWN_ERROR"; // 未知错误

/**
 * 错误信息接口
 * @description 描述消息发送/生成过程中的错误
 * @requirements 2.6, 9.2, 9.3, 9.5
 */
export interface ErrorInfo {
  /** 错误代码 */
  code: ErrorCode;
  /** 错误消息（用户可读） */
  message: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 重试等待时间（秒），仅当 retryable 为 true 时有效 */
  retryAfter?: number;
  /** 原始错误详情（用于调试） */
  details?: string;
  /** 错误发生时间戳 */
  timestamp: number;
}

/**
 * 根据错误代码获取默认错误信息
 * @param code 错误代码
 * @param details 可选的详细信息
 * @returns ErrorInfo 对象
 */
export const createErrorInfo = (
  code: ErrorCode,
  details?: string,
): ErrorInfo => {
  const errorMessages: Record<
    ErrorCode,
    { message: string; retryable: boolean }
  > = {
    NETWORK_ERROR: {
      message: "网络连接已断开，请检查网络设置",
      retryable: true,
    },
    TIMEOUT: {
      message: "请求超时，请点击重试",
      retryable: true,
    },
    RATE_LIMIT: {
      message: "请求过于频繁，请稍后重试",
      retryable: true,
    },
    TOKEN_LIMIT: {
      message: "对话过长，建议新建会话",
      retryable: false,
    },
    AUTH_ERROR: {
      message: "认证失败，请检查 Provider 配置",
      retryable: false,
    },
    SERVER_ERROR: {
      message: "服务器错误，请稍后重试",
      retryable: true,
    },
    PROVIDER_ERROR: {
      message: "AI 服务暂时不可用，请稍后重试",
      retryable: true,
    },
    UNKNOWN_ERROR: {
      message: "发生未知错误，请重试",
      retryable: true,
    },
  };

  const { message, retryable } = errorMessages[code];

  return {
    code,
    message,
    retryable,
    details,
    timestamp: Date.now(),
  };
};

/**
 * 从 API 错误响应解析错误信息
 * @param error 错误对象或字符串
 * @returns ErrorInfo 对象
 */
export const parseApiError = (error: unknown): ErrorInfo => {
  const errorStr = error instanceof Error ? error.message : String(error);
  const lowerError = errorStr.toLowerCase();

  // 根据错误信息判断错误类型
  if (
    lowerError.includes("network") ||
    lowerError.includes("fetch") ||
    lowerError.includes("connection")
  ) {
    return createErrorInfo("NETWORK_ERROR", errorStr);
  }
  if (lowerError.includes("timeout") || lowerError.includes("timed out")) {
    return createErrorInfo("TIMEOUT", errorStr);
  }
  if (
    lowerError.includes("rate limit") ||
    lowerError.includes("429") ||
    lowerError.includes("too many")
  ) {
    const retryMatch = errorStr.match(/(\d+)\s*(?:seconds?|s)/i);
    const info = createErrorInfo("RATE_LIMIT", errorStr);
    if (retryMatch) {
      info.retryAfter = parseInt(retryMatch[1], 10);
    }
    return info;
  }
  if (
    lowerError.includes("token") &&
    (lowerError.includes("limit") || lowerError.includes("exceed"))
  ) {
    return createErrorInfo("TOKEN_LIMIT", errorStr);
  }
  if (
    lowerError.includes("401") ||
    lowerError.includes("unauthorized") ||
    lowerError.includes("auth")
  ) {
    return createErrorInfo("AUTH_ERROR", errorStr);
  }
  if (
    lowerError.includes("500") ||
    lowerError.includes("server error") ||
    lowerError.includes("internal")
  ) {
    return createErrorInfo("SERVER_ERROR", errorStr);
  }
  if (lowerError.includes("provider") || lowerError.includes("model")) {
    return createErrorInfo("PROVIDER_ERROR", errorStr);
  }

  return createErrorInfo("UNKNOWN_ERROR", errorStr);
};

/**
 * 消息
 * @description 表示一条完整的对话消息
 */
export interface Message {
  /** 消息唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色 */
  role: MessageRole;
  /** 消息原始内容 (Markdown 格式) */
  content: string;
  /** 解析后的内容块列表 */
  blocks: ContentBlock[];
  /** 消息状态 */
  status: MessageStatus;
  /** 创建时间戳 (毫秒) */
  createdAt: number;
  /** 消息元数据 */
  metadata?: MessageMetadata;
  /** 错误信息（仅当 status 为 'error' 时有效）*/
  error?: ErrorInfo;
  /** 图片列表（用于多模态支持）*/
  images?: Array<{ data: string; mediaType: string }>;
}

// ============================================================================
// 画布相关类型
// ============================================================================

/**
 * 画布内容类型
 * @description 标识画布中显示的内容类型
 */
export type CanvasContentType = "code" | "file" | "markdown" | "empty";

/**
 * 画布状态
 * @description 右侧画布面板的完整状态
 */
export interface CanvasState {
  /** 画布是否打开 */
  isOpen: boolean;
  /** 当前显示的内容类型 */
  contentType: CanvasContentType;
  /** 内容文本 */
  content: string;
  /** 代码语言 (仅 contentType='code' 时有效) */
  language?: string;
  /** 文件名 */
  filename?: string;
  /** 是否处于编辑模式 */
  isEditing: boolean;
}

// ============================================================================
// UI 状态相关类型
// ============================================================================

/**
 * UI 布局状态
 * @description 界面布局的状态信息
 */
export interface UIState {
  /** 左侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  /** 左侧边栏宽度 (像素) */
  sidebarWidth: number;
  /** 右侧画布是否折叠 */
  canvasCollapsed: boolean;
  /** 右侧画布宽度 (像素) */
  canvasWidth: number;
}

/**
 * 流式状态
 * @description AI 流式响应的状态信息
 */
export interface StreamingState {
  /** 是否正在流式生成 */
  isStreaming: boolean;
  /** 当前正在生成的消息 ID */
  currentMessageId: string | null;
  /** 已接收的部分内容 */
  partialContent: string;
}

/**
 * 分页状态
 * @description 消息分页加载的状态信息
 * @requirements 10.2
 */
export interface PaginationState {
  /** 是否还有更多消息可加载 */
  hasMoreMessages: boolean;
  /** 是否正在加载更多消息 */
  isLoadingMore: boolean;
  /** 每页加载的消息数量（20-50 条） */
  pageSize: number;
  /** 最早消息的 ID（用于分页查询） */
  oldestMessageId: string | null;
}

/**
 * 默认分页状态
 * @requirements 10.2
 */
export const DEFAULT_PAGINATION_STATE: PaginationState = {
  hasMoreMessages: true,
  isLoadingMore: false,
  pageSize: 30, // 默认每次加载 30 条，在 20-50 范围内
  oldestMessageId: null,
};

// ============================================================================
// Provider 相关类型
// ============================================================================

/**
 * Provider 配置
 * @description AI Provider 的配置信息
 */
export interface ProviderConfig {
  /** Provider 名称 */
  providerName: string;
  /** 模型名称 */
  modelName: string;
  /** API Key (可选，部分 Provider 需要) */
  apiKey?: string;
  /** 自定义 API 地址 (可选) */
  baseUrl?: string;
}

/**
 * Provider 选择状态
 * @description 当前选中的 Provider 和模型信息
 */
export interface ProviderSelectionState {
  /** 选中的 Provider Key */
  selectedProviderKey: string | null;
  /** 选中的模型 ID */
  selectedModelId: string | null;
  /** 是否正在加载 Provider */
  isLoadingProviders: boolean;
  /** Provider 加载错误 */
  providerError: string | null;
}

/**
 * 默认 Provider 选择状态
 */
export const DEFAULT_PROVIDER_SELECTION_STATE: ProviderSelectionState = {
  selectedProviderKey: null,
  selectedModelId: null,
  isLoadingProviders: false,
  providerError: null,
};

// ============================================================================
// 组件 Props 类型
// ============================================================================

/**
 * ChatPanel 组件属性
 */
export interface ChatPanelProps {
  /** 当前会话 ID */
  sessionId: string;
  /** 打开画布回调 */
  onOpenCanvas: (content: CanvasState) => void;
  /** 页面导航回调 */
  onNavigate?: (page: Page, params?: PageParams) => void;
}

/**
 * MessageItem 组件属性
 */
export interface MessageItemProps {
  /** 消息数据 */
  message: Message;
  /** 是否正在流式生成 */
  isStreaming: boolean;
  /** 复制内容回调 */
  onCopy: (content: string) => void;
  /** 在画布中打开回调 */
  onOpenInCanvas: (block: ContentBlock) => void;
  /** 重新生成回调 (仅 AI 消息) */
  onRegenerate?: () => void;
}

/**
 * InputBar 组件属性
 */
export interface InputBarProps {
  /** 发送消息回调 */
  onSend: (message: string, images?: File[]) => void;
  /** 停止生成回调 */
  onStop: () => void;
  /** 是否正在流式生成 */
  isStreaming: boolean;
  /** 是否禁用输入 */
  disabled: boolean;
  /** 是否支持图片上传 */
  supportsImages?: boolean;
}

// ============================================================================
// 图片相关类型
// ============================================================================

/**
 * 图片数据
 * @description 表示上传的图片信息
 */
export interface ImageData {
  /** 图片唯一标识 */
  id: string;
  /** 文件名 */
  filename: string;
  /** MIME 类型 */
  mimeType: string;
  /** base64 编码的图片数据 */
  data: string;
  /** 文件大小（字节） */
  size: number;
  /** 图片宽度（像素） */
  width?: number;
  /** 图片高度（像素） */
  height?: number;
}

/**
 * 图片预览状态
 * @description 输入栏中图片预览的状态
 */
export interface ImagePreviewState {
  /** 预览的图片列表 */
  images: ImageData[];
  /** 是否正在上传 */
  isUploading: boolean;
  /** 上传错误信息 */
  uploadError: string | null;
}

/**
 * 支持的图片格式
 */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

/**
 * 图片文件大小限制（10MB）
 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * 单次最大图片数量
 */
export const MAX_IMAGES_PER_MESSAGE = 5;

/**
 * 检查文件是否为支持的图片格式
 * @param file 文件对象
 * @returns 是否支持
 */
export const isSupportedImageType = (file: File): boolean => {
  return SUPPORTED_IMAGE_TYPES.includes(file.type as any);
};

/**
 * 检查图片文件大小是否符合要求
 * @param file 文件对象
 * @returns 是否符合要求
 */
export const isValidImageSize = (file: File): boolean => {
  return file.size <= MAX_IMAGE_SIZE;
};

/**
 * 将文件转换为 ImageData
 * @param file 文件对象
 * @returns Promise<ImageData>
 */
export const fileToImageData = (file: File): Promise<ImageData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) {
        reject(new Error("无法读取文件"));
        return;
      }

      // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
      const base64Data = result.split(",")[1];

      // 创建图片元素获取尺寸
      const img = new Image();
      img.onload = () => {
        const imageData: ImageData = {
          id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          filename: file.name,
          mimeType: file.type,
          data: base64Data,
          size: file.size,
          width: img.width,
          height: img.height,
        };
        resolve(imageData);
      };

      img.onerror = () => {
        reject(new Error("无法解析图片"));
      };

      img.src = result;
    };

    reader.onerror = () => {
      reject(new Error("文件读取失败"));
    };

    reader.readAsDataURL(file);
  });
};

/**
 * CanvasPanel 组件属性
 */
export interface CanvasPanelProps {
  /** 画布状态 */
  state: CanvasState;
  /** 关闭画布回调 */
  onClose: () => void;
  /** 内容变更回调 */
  onContentChange: (content: string) => void;
  /** 画布宽度 */
  width: number;
  /** 宽度变更回调 */
  onWidthChange: (width: number) => void;
}

// ============================================================================
// 默认值常量
// ============================================================================

/**
 * 默认 UI 状态
 */
export const DEFAULT_UI_STATE: UIState = {
  sidebarCollapsed: false,
  sidebarWidth: 260,
  canvasCollapsed: true,
  canvasWidth: 400,
};

/**
 * 默认画布状态
 */
export const DEFAULT_CANVAS_STATE: CanvasState = {
  isOpen: false,
  contentType: "empty",
  content: "",
  isEditing: false,
};

/**
 * 默认流式状态
 */
export const DEFAULT_STREAMING_STATE: StreamingState = {
  isStreaming: false,
  currentMessageId: null,
  partialContent: "",
};
