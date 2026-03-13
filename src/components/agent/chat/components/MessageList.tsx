import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  User,
  Copy,
  Edit2,
  Trash2,
  Check,
  FileText,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Artifact } from "@/lib/artifact/types";
import {
  MessageListContainer,
  MessageWrapper,
  AvatarColumn,
  ContentColumn,
  MessageHeader,
  AvatarCircle,
  SenderName,
  TimeStamp,
  MessageBubble,
  MessageActions,
} from "../styles";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingRenderer } from "./StreamingRenderer";
import { TokenUsageDisplay } from "./TokenUsageDisplay";
import { AgentThreadTimeline } from "./AgentThreadTimeline";
import {
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import {
  Message,
  type AgentThreadItem,
  type AgentThreadTurn,
  type WriteArtifactContext,
} from "../types";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
import type { ConfirmResponse } from "../types";
import { buildMessageTurnTimeline } from "../utils/threadTimelineView";
import logoImg from "/logo.png";

interface MessageListProps {
  messages: Message[];
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  assistantLabel?: string;
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, content: string) => void;
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData, messageId: string) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** A2UI 表单数据映射（按消息 ID 索引） */
  a2uiFormDataMap?: Record<string, { formId: string; formData: A2UIFormData }>;
  /** A2UI 表单数据变化回调（用于持久化） */
  onA2UIFormChange?: (formId: string, formData: A2UIFormData) => void;
  /** 文件写入回调 */
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  /** 文件点击回调 */
  onFileClick?: (fileName: string, content: string) => void;
  /** Artifact 点击回调 */
  onArtifactClick?: (artifact: Artifact) => void;
  /** 权限确认响应回调 */
  onPermissionResponse?: (response: ConfirmResponse) => void;
  /** 是否折叠代码块（当画布打开时） */
  collapseCodeBlocks?: boolean;
  /** 代码块点击回调（用于在画布中显示） */
  onCodeBlockClick?: (language: string, code: string) => void;
}

const MessageListInner: React.FC<MessageListProps> = ({
  messages,
  turns = [],
  threadItems = [],
  currentTurnId = null,
  assistantLabel = "ProxyCast",
  onDeleteMessage,
  onEditMessage,
  onA2UISubmit,
  renderA2UIInline = true,
  a2uiFormDataMap,
  onA2UIFormChange,
  onWriteFile,
  onFileClick,
  onArtifactClick,
  onPermissionResponse,
  collapseCodeBlocks,
  onCodeBlockClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const visibleMessages = useMemo(
    () =>
      messages.filter((msg) => {
        if (msg.role !== "user") return true;
        if (msg.content.trim().length > 0) return true;
        return Array.isArray(msg.images) && msg.images.length > 0;
      }),
    [messages],
  );
  const timelineByMessageId = useMemo(
    () => buildMessageTurnTimeline(visibleMessages, turns, threadItems),
    [threadItems, turns, visibleMessages],
  );

  // 检测用户是否在手动滚动
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px 容差

      setIsUserScrolling(true);
      setShouldAutoScroll(isAtBottom);

      // 清除之前的定时器
      clearTimeout(scrollTimeout);

      // 500ms 后认为用户停止滚动
      scrollTimeout = setTimeout(() => {
        setIsUserScrolling(false);
      }, 500);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, []);

  // 智能自动滚动：只在用户没有手动滚动且在底部时才自动滚动
  useEffect(() => {
    if (shouldAutoScroll && !isUserScrolling && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleMessages, shouldAutoScroll, isUserScrolling]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  };

  const handleSaveEdit = (id: string) => {
    if (onEditMessage && editContent.trim()) {
      onEditMessage(id, editContent);
    }
    setEditingId(null);
    setEditContent("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleDelete = (id: string) => {
    if (onDeleteMessage) {
      onDeleteMessage(id);
      toast.success("消息已删除");
    }
  };

  const renderArtifactCards = (artifacts: Artifact[] | undefined) => {
    if (!artifacts || artifacts.length === 0) {
      return null;
    }

    return (
      <div className="mt-3 flex flex-col gap-2">
        {artifacts.map((artifact) => {
          const filePath =
            typeof artifact.meta.filePath === "string"
              ? artifact.meta.filePath
              : artifact.meta.filename || artifact.title;
          const writePhase = resolveArtifactWritePhase(artifact);
          const statusLabel = formatArtifactWritePhaseLabel(writePhase);
          const previewText = resolveArtifactPreviewText(artifact, 180);

          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onArtifactClick?.(artifact)}
              className="w-full flex items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-background"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                {artifact.status === "streaming" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {artifact.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {filePath}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {statusLabel}
                  </span>
                  {previewText ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {previewText}
                    </span>
                  ) : artifact.status === "streaming" ? (
                    <span className="text-xs text-muted-foreground">
                      正在准备文件内容...
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <MessageListContainer ref={containerRef}>
      <div className="py-8 flex flex-col">
        {visibleMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground opacity-50">
            <img
              src={logoImg}
              alt="ProxyCast"
              className="w-12 h-12 mb-4 opacity-20"
            />
            <p className="text-lg font-medium">开始一段新的对话吧</p>
          </div>
        )}

        {visibleMessages.map((msg) => {
          const timeline = timelineByMessageId.get(msg.id);

          return (
            <MessageWrapper key={msg.id} $isUser={msg.role === "user"}>
            <AvatarColumn>
              {msg.role === "user" ? (
                <AvatarCircle $isUser={true}>
                  <User size={20} />
                </AvatarCircle>
              ) : (
                <img
                  src={logoImg}
                  alt="ProxyCast"
                  style={{
                    width: 45,
                    height: 45,
                    minWidth: 45,
                    minHeight: 45,
                    borderRadius: 8,
                    display: "block",
                  }}
                />
              )}
            </AvatarColumn>

            <ContentColumn>
              <MessageHeader>
                <SenderName>
                  {msg.role === "user" ? "用户" : assistantLabel}
                </SenderName>
                <TimeStamp>{formatTime(msg.timestamp)}</TimeStamp>
              </MessageHeader>

              <MessageBubble $isUser={msg.role === "user"}>
                {msg.role === "assistant" && timeline ? (
                  <AgentThreadTimeline
                    turn={timeline.turn}
                    items={timeline.items}
                    isCurrentTurn={timeline.turn.id === currentTurnId}
                    onFileClick={onFileClick}
                    onPermissionResponse={onPermissionResponse}
                  />
                ) : null}

                {editingId === msg.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full min-h-[100px] p-2 rounded border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                      >
                        取消
                      </Button>
                      <Button size="sm" onClick={() => handleSaveEdit(msg.id)}>
                        保存
                      </Button>
                    </div>
                  </div>
                ) : msg.role === "assistant" ? (
                  /* 使用 StreamingRenderer 渲染 assistant 消息 - Requirements: 9.3, 9.4 */
                  <StreamingRenderer
                    content={msg.content}
                    isStreaming={msg.isThinking}
                    toolCalls={msg.toolCalls}
                    showCursor={msg.isThinking && !msg.content}
                    thinkingContent={msg.thinkingContent}
                    runtimeStatus={msg.runtimeStatus}
                    contentParts={msg.contentParts}
                    actionRequests={msg.actionRequests}
                    onA2UISubmit={
                      onA2UISubmit
                        ? (formData) => onA2UISubmit(formData, msg.id)
                        : undefined
                    }
                    a2uiFormId={a2uiFormDataMap?.[msg.id]?.formId}
                    a2uiInitialFormData={a2uiFormDataMap?.[msg.id]?.formData}
                    onA2UIFormChange={onA2UIFormChange}
                    renderA2UIInline={renderA2UIInline}
                    onWriteFile={
                      onWriteFile
                        ? (content, fileName, context) =>
                            onWriteFile(content, fileName, {
                              ...context,
                              sourceMessageId:
                                context?.sourceMessageId || msg.id,
                              source: context?.source || "message_content",
                            })
                        : undefined
                    }
                    onFileClick={onFileClick}
                    onPermissionResponse={onPermissionResponse}
                    collapseCodeBlocks={collapseCodeBlocks}
                    onCodeBlockClick={onCodeBlockClick}
                  />
                ) : (
                  <MarkdownRenderer
                    content={msg.content}
                    onA2UISubmit={
                      onA2UISubmit
                        ? (formData) => onA2UISubmit(formData, msg.id)
                        : undefined
                    }
                    renderA2UIInline={renderA2UIInline}
                  />
                )}

                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {msg.images.map((img, i) => (
                      <img
                        key={i}
                        src={`data:${img.mediaType};base64,${img.data}`}
                        className="max-w-xs rounded-lg border border-border"
                        alt="attachment"
                      />
                    ))}
                  </div>
                )}

                {msg.role === "assistant" && renderArtifactCards(msg.artifacts)}

                {/* Token 使用量显示 - Requirements: 9.5 */}
                {msg.role === "assistant" && !msg.isThinking && msg.usage && (
                  <TokenUsageDisplay usage={msg.usage} />
                )}

                {msg.role === "assistant" &&
                  !msg.isThinking &&
                  msg.contextTrace &&
                  msg.contextTrace.length > 0 && (
                    <details className="mt-3 rounded border border-border/60 bg-muted/20">
                      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                        上下文轨迹 ({msg.contextTrace.length})
                      </summary>
                      <div className="border-t border-border/60 px-3 py-2 space-y-1.5">
                        {msg.contextTrace.map((step, index) => (
                          <div key={`${step.stage}-${index}`} className="text-xs">
                            <span className="font-medium text-foreground/90">
                              {step.stage}
                            </span>
                            <span className="text-muted-foreground">: </span>
                            <span className="text-muted-foreground">{step.detail}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                {editingId !== msg.id && (
                  <MessageActions className="message-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => handleCopy(msg.content, msg.id)}
                    >
                      {copiedId === msg.id ? (
                        <Check size={12} className="text-green-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </Button>
                    {msg.role === "user" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => handleEdit(msg)}
                      >
                        <Edit2 size={12} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(msg.id)}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </MessageActions>
                )}
              </MessageBubble>
            </ContentColumn>
          </MessageWrapper>
          );
        })}
        <div ref={scrollRef} />
      </div>
    </MessageListContainer>
  );
};

export const MessageList = React.memo(MessageListInner);
MessageList.displayName = "MessageList";
