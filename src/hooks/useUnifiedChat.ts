/**
 * @file useUnifiedChat.ts
 * @description 统一对话 Hook
 * @module hooks/useUnifiedChat
 *
 * 提供统一的对话逻辑，支持多种对话模式：
 * - Agent: AI Agent 模式，支持工具调用
 * - General: 通用对话模式，纯文本
 * - Creator: 内容创作模式，支持画布输出
 *
 * ## 设计原则
 * - 单一入口：所有对话场景使用同一个 Hook
 * - 模式化设计：通过 mode 参数区分不同场景
 * - 统一 API：调用后端统一的 unified_chat_cmd
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import * as chatApi from "@/lib/api/unified-chat";
import type {
  ChatSession,
  ChatMessage,
  ChatError,
  ImageInput,
  StreamEvent,
  UseUnifiedChatOptions,
  UseUnifiedChatReturn,
  ToolCall,
  CreateSessionRequest,
  HarnessArtifactSnapshot,
} from "@/types/chat";

// ============================================================================
// 常量
// ============================================================================

const STORAGE_PREFIX = "unified_chat_";

// ============================================================================
// 辅助函数
// ============================================================================

/** 从 localStorage 加载数据 */
function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/** 保存数据到 localStorage */
function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch (e) {
    console.error("[useUnifiedChat] 保存到 localStorage 失败:", e);
  }
}

/** 解析 API 错误 */
function parseApiError(error: unknown): ChatError {
  const message = error instanceof Error ? error.message : String(error);

  // 根据错误消息判断类型
  if (message.includes("network") || message.includes("连接")) {
    return { type: "network", message, retryable: true };
  }
  if (
    message.includes("auth") ||
    message.includes("认证") ||
    message.includes("401")
  ) {
    return { type: "auth", message, retryable: false };
  }
  if (
    message.includes("rate") ||
    message.includes("限流") ||
    message.includes("429")
  ) {
    return { type: "rate_limit", message, retryable: true };
  }
  if (message.includes("quota") || message.includes("配额")) {
    return { type: "quota", message, retryable: false };
  }

  return { type: "unknown", message, retryable: true };
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 统一对话 Hook
 */
export function useUnifiedChat(
  options: UseUnifiedChatOptions,
): UseUnifiedChatReturn {
  const {
    mode,
    sessionId: initialSessionId,
    systemPrompt,
    providerType: initialProviderType,
    model: initialModel,
    onCanvasUpdate,
    onWriteFile,
    harnessConfig,
    onHarnessEvent,
    onArtifactUpdate,
    onError,
  } = options;

  // ========== 状态 ==========
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);

  // Provider 配置
  const [providerType, setProviderType] = useState(
    () => initialProviderType || loadFromStorage(`${mode}_provider`, "claude"),
  );
  const [model, setModel] = useState(
    () => initialModel || loadFromStorage(`${mode}_model`, ""),
  );

  // Refs
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const currentMsgIdRef = useRef<string | null>(null);
  const accumulatedContentRef = useRef<string>("");
  const completedWriteFilesRef = useRef<Map<string, string>>(new Map());

  // ========== 会话操作 ==========

  /** 创建新会话 */
  const createSession = useCallback(
    async (opts?: Partial<CreateSessionRequest>): Promise<string> => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await chatApi.createSession({
          mode,
          title: opts?.title,
          systemPrompt: opts?.systemPrompt || systemPrompt,
          providerType: opts?.providerType || providerType,
          model: opts?.model || model,
          metadata:
            harnessConfig || opts?.metadata
              ? {
                  ...(opts?.metadata || {}),
                  ...(harnessConfig ? { harness: harnessConfig } : {}),
                }
              : undefined,
        });

        const newSession: ChatSession = {
          id: response.id,
          mode: response.mode,
          title: response.title,
          model: response.model,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
          messageCount: response.messageCount,
        };

      setSession(newSession);
      setMessages([]);
      completedWriteFilesRef.current.clear();
      saveToStorage(`${mode}_session_id`, response.id);

        console.log("[useUnifiedChat] 创建会话成功:", response.id);
        return response.id;
      } catch (e) {
        const chatError = parseApiError(e);
        setError(chatError);
        onError?.(chatError);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [mode, systemPrompt, providerType, model, harnessConfig, onError],
  );

  /** 加载会话 */
  const loadSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        // 获取会话详情
        const response = await chatApi.getSession(sessionId);
        const loadedSession: ChatSession = {
          id: response.id,
          mode: response.mode,
          title: response.title,
          model: response.model,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
          messageCount: response.messageCount,
        };
        setSession(loadedSession);

        // 获取消息列表
        const loadedMessages = await chatApi.getMessages(sessionId);
        setMessages(loadedMessages);

        saveToStorage(`${mode}_session_id`, sessionId);
        console.log(
          "[useUnifiedChat] 加载会话成功:",
          sessionId,
          "消息数:",
          loadedMessages.length,
        );
      } catch (e) {
        const chatError = parseApiError(e);
        setError(chatError);
        onError?.(chatError);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [mode, onError],
  );

  /** 删除会话 */
  const deleteSession = useCallback(
    async (sessionId?: string): Promise<void> => {
      const targetId = sessionId || session?.id;
      if (!targetId) return;

      try {
        await chatApi.deleteSession(targetId);

        if (targetId === session?.id) {
          setSession(null);
          setMessages([]);
          completedWriteFilesRef.current.clear();
          localStorage.removeItem(`${STORAGE_PREFIX}${mode}_session_id`);
        }

        toast.success("会话已删除");
      } catch (e) {
        const chatError = parseApiError(e);
        setError(chatError);
        onError?.(chatError);
        toast.error("删除会话失败");
      }
    },
    [session?.id, mode, onError],
  );

  /** 重命名会话 */
  const renameSession = useCallback(
    async (title: string, sessionId?: string): Promise<void> => {
      const targetId = sessionId || session?.id;
      if (!targetId) return;

      try {
        await chatApi.renameSession(targetId, title);

        if (targetId === session?.id) {
          setSession((prev) => (prev ? { ...prev, title } : null));
        }
      } catch (e) {
        const chatError = parseApiError(e);
        setError(chatError);
        onError?.(chatError);
        toast.error("重命名失败");
      }
    },
    [session?.id, onError],
  );

  // ========== 消息操作 ==========

  /** 发送消息 */
  const sendMessage = useCallback(
    async (
      content: string,
      images?: ImageInput[],
      webSearch?: boolean,
    ): Promise<void> => {
      if (!content.trim() && (!images || images.length === 0)) return;

      let activeSessionId = session?.id;

      // 如果没有会话，先创建一个
      if (!activeSessionId) {
        try {
          activeSessionId = await createSession();
        } catch {
          return;
        }
      }

      // 创建用户消息
      const userMsgId = `user-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: userMsgId,
        sessionId: activeSessionId,
        role: "user",
        content: content.trim(),
        contentBlocks: [{ type: "text", text: content.trim() }],
        status: "complete",
        createdAt: new Date().toISOString(),
      };

      // 创建助手消息占位符
      const assistantMsgId = `assistant-${Date.now()}`;
      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        sessionId: activeSessionId,
        role: "assistant",
        content: "",
        contentBlocks: [],
        status: "streaming",
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsSending(true);
      currentMsgIdRef.current = assistantMsgId;
      accumulatedContentRef.current = "";

      // 设置事件监听
      const eventName = chatApi.generateEventName(activeSessionId);

      try {
        const unlisten = await safeListen<StreamEvent>(eventName, (event) => {
          const data = chatApi.parseStreamEvent(event.payload);
          if (!data) return;

          handleStreamEvent(data, assistantMsgId);
        });

        unlistenRef.current = unlisten;

        // 发送消息
        await chatApi.sendMessage({
          sessionId: activeSessionId,
          message: content.trim(),
          eventName,
          webSearch,
          images: images?.map((img) => ({
            data: img.data,
            media_type: img.mediaType,
          })),
        });
      } catch (e) {
        console.error("[useUnifiedChat] 发送消息失败:", e);
        const chatError = parseApiError(e);

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  status: "error",
                  error: chatError,
                  content: chatError.message,
                }
              : msg,
          ),
        );

        setIsSending(false);
        onError?.(chatError);

        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.id, createSession, onError],
  );

  /** 处理流式事件 */
  const handleStreamEvent = useCallback(
    (event: StreamEvent, msgId: string): void => {
      switch (event.type) {
        case "text_delta":
          accumulatedContentRef.current += event.text;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? { ...msg, content: accumulatedContentRef.current }
                : msg,
            ),
          );

          // 检查是否有 write_file 标签（用于画布）
          checkWriteFileTag(accumulatedContentRef.current);
          break;

        case "thinking_delta":
          // 处理思考内容（可选显示）
          break;

        case "tool_start": {
          const newToolCall: ToolCall = {
            id: event.tool_id,
            name: event.tool_name,
            arguments: event.arguments,
            status: "running",
            startTime: new Date(),
          };

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? { ...msg, toolCalls: [...(msg.toolCalls || []), newToolCall] }
                : msg,
            ),
          );

          // 检查是否是文件写入工具
          const toolName = event.tool_name.toLowerCase();
          if (toolName.includes("write") || toolName.includes("create")) {
            try {
              const args = JSON.parse(event.arguments || "{}");
              const filePath = args.path || args.file_path || args.filePath;
              const content = args.content || args.text || "";
              if (filePath && content && onWriteFile) {
                onWriteFile(content, filePath);
              }
            } catch {
              // 忽略解析错误
            }
          }
          break;
        }

        case "tool_end":
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== msgId) return msg;
              return {
                ...msg,
                toolCalls: msg.toolCalls?.map((tc) =>
                  tc.id === event.tool_id
                    ? {
                        ...tc,
                        status: event.result.success ? "completed" : "failed",
                        result: event.result,
                        endTime: new Date(),
                      }
                    : tc,
                ),
              };
            }),
          );
          break;

        case "harness_event":
          onHarnessEvent?.(event.event);
          break;

        case "artifact_snapshot":
          onArtifactUpdate?.(event.artifact);
          if (event.artifact.filePath && typeof event.artifact.content === "string") {
            onCanvasUpdate?.(event.artifact.filePath, event.artifact.content);
            const previousContent = completedWriteFilesRef.current.get(
              event.artifact.filePath,
            );
            if (
              previousContent !== event.artifact.content &&
              onWriteFile
            ) {
              completedWriteFilesRef.current.set(
                event.artifact.filePath,
                event.artifact.content,
              );
              onWriteFile(event.artifact.content, event.artifact.filePath);
            }
          }
          break;

        case "done":
          // 单次 API 响应完成，但工具循环可能继续
          break;

        case "final_done":
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? {
                    ...msg,
                    status: "complete",
                    content: accumulatedContentRef.current || "(无响应)",
                    metadata: event.usage
                      ? {
                          tokens: {
                            input: event.usage.input_tokens,
                            output: event.usage.output_tokens,
                          },
                        }
                      : undefined,
                  }
                : msg,
            ),
          );
          setIsSending(false);
          cleanup();
          break;

        case "error": {
          const chatError: ChatError = {
            type: "unknown",
            message: event.message,
            retryable: true,
          };

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? {
                    ...msg,
                    status: "error",
                    error: chatError,
                    content: accumulatedContentRef.current || event.message,
                  }
                : msg,
            ),
          );
          setIsSending(false);
          onError?.(chatError);
          cleanup();
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onArtifactUpdate, onCanvasUpdate, onHarnessEvent, onWriteFile, onError],
  );

  /** 检查 write_file 标签 */
  const checkWriteFileTag = useCallback(
    (content: string): void => {
      // 匹配 <write_file path="xxx">content</write_file>
      const regex = /<write_file\s+path="([^"]+)">([\s\S]*?)(<\/write_file>)?/g;
      let match;

      while ((match = regex.exec(content)) !== null) {
        const [, path, fileContent, closeTag] = match;
        const isComplete = !!closeTag;

        if (onCanvasUpdate) {
          onCanvasUpdate(path, fileContent);
        }

        if (onArtifactUpdate) {
          const artifact: HarnessArtifactSnapshot = {
            artifactId: `write-file:${path}`,
            filePath: path,
            content: fileContent,
            metadata: {
              source: "write_file",
              complete: isComplete,
            },
          };
          onArtifactUpdate(artifact);
        }

        if (isComplete && onWriteFile) {
          const previousContent = completedWriteFilesRef.current.get(path);
          if (previousContent === fileContent) {
            continue;
          }
          completedWriteFilesRef.current.set(path, fileContent);
          onWriteFile(fileContent, path);
          onHarnessEvent?.({
            kind: previousContent === undefined ? "artifact_created" : "artifact_updated",
            summary: `产物已写入 ${path}`,
            artifact: {
              artifactId: `write-file:${path}`,
              filePath: path,
              content: fileContent,
              metadata: {
                source: "write_file",
              },
            },
          });
        }
      }
    },
    [onArtifactUpdate, onCanvasUpdate, onHarnessEvent, onWriteFile],
  );

  /** 清理资源 */
  const cleanup = useCallback((): void => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    currentMsgIdRef.current = null;
    accumulatedContentRef.current = "";
  }, []);

  /** 停止生成 */
  const stopGeneration = useCallback(async (): Promise<void> => {
    if (!session?.id) return;

    try {
      await chatApi.stopGeneration(session.id);

      // 更新当前消息状态
      if (currentMsgIdRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === currentMsgIdRef.current
              ? {
                  ...msg,
                  status: "complete",
                  content: accumulatedContentRef.current || "(已停止)",
                }
              : msg,
          ),
        );
      }

      setIsSending(false);
      cleanup();
    } catch (e) {
      console.error("[useUnifiedChat] 停止生成失败:", e);
    }
  }, [session?.id, cleanup]);

  /** 清空消息 */
  const clearMessages = useCallback((): void => {
    setMessages([]);
    setSession(null);
    completedWriteFilesRef.current.clear();
    localStorage.removeItem(`${STORAGE_PREFIX}${mode}_session_id`);
    toast.success("新对话已创建");
  }, [mode]);

  // ========== Provider 配置 ==========

  /** 配置 Provider */
  const configureProvider = useCallback(
    async (newProviderType: string, newModel: string): Promise<void> => {
      setProviderType(newProviderType);
      setModel(newModel);
      saveToStorage(`${mode}_provider`, newProviderType);
      saveToStorage(`${mode}_model`, newModel);

      // 如果有活跃会话，更新其 Provider 配置
      if (session?.id) {
        try {
          await chatApi.configureProvider(
            session.id,
            newProviderType,
            newModel,
          );
        } catch (e) {
          console.error("[useUnifiedChat] 配置 Provider 失败:", e);
        }
      }
    },
    [mode, session?.id],
  );

  // ========== 初始化 ==========

  useEffect(() => {
    // 尝试恢复上次的会话
    const savedSessionId =
      initialSessionId || loadFromStorage(`${mode}_session_id`, null);
    if (savedSessionId) {
      loadSession(savedSessionId).catch(() => {
        // 如果加载失败，清除保存的 ID
        localStorage.removeItem(`${STORAGE_PREFIX}${mode}_session_id`);
      });
    }

    // 清理函数
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialSessionId]);

  // ========== 返回值 ==========

  return {
    // 状态
    session,
    messages,
    isLoading,
    isSending,
    error,

    // 会话操作
    createSession,
    loadSession,
    deleteSession,
    renameSession,

    // 消息操作
    sendMessage,
    stopGeneration,
    clearMessages,

    // Provider 配置
    configureProvider,
  };
}

export default useUnifiedChat;
