/**
 * @file 任务文件列表组件
 * @description 展示内容创作过程中生成的文件列表
 * 完全按照 AnyGen 的文件面板样式实现
 */

import React, { memo, useRef, useEffect, useState } from "react";
import styled from "styled-components";
import { toast } from "sonner";
import {
  FileText,
  FolderOpen,
  List,
  Copy,
  Image,
  Code,
  MoreHorizontal,
  ChevronRight,
  Folder,
} from "lucide-react";

/** 任务文件类型 */
export interface TaskFile {
  id: string;
  name: string;
  type: "document" | "image" | "audio" | "video" | "other";
  content?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

interface TaskFileListProps {
  /** 文件列表 */
  files: TaskFile[];
  /** 当前选中的文件 ID */
  selectedFileId?: string;
  /** 文件点击回调 */
  onFileClick?: (file: TaskFile) => void;
  /** 是否展开 */
  expanded?: boolean;
  /** 展开状态变更回调 */
  onExpandedChange?: (expanded: boolean) => void;
}

// 外层容器
const Container = styled.div`
  position: relative;
`;

// 展开的文件面板
const FilePanel = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 320px;
  max-height: 400px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  z-index: 100;
  display: flex;
  flex-direction: column;
`;

// 面板头部
const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  flex-shrink: 0;
`;

// 面包屑导航
const Breadcrumb = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
`;

const BreadcrumbItem = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--foreground));
  }
`;

const BreadcrumbSeparator = styled.span`
  color: hsl(var(--muted-foreground) / 0.5);
  display: flex;
  align-items: center;
`;

// 工具栏
const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`;

const ToolbarButton = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: ${(props) =>
    props.$active ? "hsl(var(--primary) / 0.1)" : "transparent"};
  border-radius: 6px;
  color: ${(props) =>
    props.$active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--foreground));
  }
`;

// 文件列表区域
const FileListContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 100px;
  max-height: 320px;

  /* 自定义滚动条 */
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.3);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.5);
  }
`;

// 空状态
const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: hsl(var(--muted-foreground));
`;

const EmptyIcon = styled.div`
  margin-bottom: 12px;
  opacity: 0.5;
`;

const EmptyText = styled.div`
  font-size: 13px;
`;

// 文件项
const FileItem = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: ${(props) =>
    props.$selected ? "hsl(var(--primary) / 0.08)" : "transparent"};

  &:hover {
    background: ${(props) =>
      props.$selected
        ? "hsl(var(--primary) / 0.12)"
        : "hsl(var(--muted) / 0.4)"};
  }
`;

// 文件图标容器
const FileIconWrapper = styled.div<{ $color?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: ${(props) => props.$color || "#f59e0b"}20;
  color: ${(props) => props.$color || "#f59e0b"};
  flex-shrink: 0;
`;

const FileInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const FileName = styled.div`
  font-size: 13px;
  font-weight: 450;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const FileMeta = styled.div`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  margin-top: 2px;
`;

const MoreButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  flex-shrink: 0;

  ${FileItem}:hover & {
    opacity: 1;
  }

  &:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
  }
`;

// 底部触发按钮（放在 Inputbar 中）
export const TaskFilesTrigger = styled.button<{
  $expanded?: boolean;
  $hasFiles?: boolean;
}>`
  display: ${(props) => (props.$hasFiles ? "flex" : "none")};
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.15s;
  margin-right: 8px;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    color: hsl(var(--foreground));
  }

  ${(props) =>
    props.$expanded &&
    `
    border-color: hsl(var(--primary));
    color: hsl(var(--foreground));
    background: hsl(var(--primary) / 0.05);
  `}
`;

/**
 * 格式化相对时间
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days === 1) return "1 天前";
  if (days < 7) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

/**
 * 根据文件类型获取图标颜色
 */
function getFileColor(type: string, name: string): string {
  // 根据文件扩展名判断
  if (name.endsWith(".md") || name.endsWith(".txt")) {
    return "#3b82f6"; // 蓝色 - 文档
  }
  if (
    name.endsWith(".pptx") ||
    name.endsWith(".ppt") ||
    name.endsWith(".key")
  ) {
    return "#f59e0b"; // 橙色 - 演示文稿
  }
  if (name.endsWith(".doc") || name.endsWith(".docx")) {
    return "#2563eb"; // 深蓝 - Word文档
  }
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
    return "#10b981"; // 绿色 - Excel
  }
  if (name.endsWith(".pdf")) {
    return "#ef4444"; // 红色 - PDF
  }
  if (type === "image") {
    return "#8b5cf6"; // 紫色 - 图片
  }
  if (type === "audio") {
    return "#ec4899"; // 粉色 - 音频
  }
  return "#f59e0b"; // 默认橙色
}

/**
 * 任务文件列表组件
 *
 * 展示内容创作过程中生成的文件列表
 * 采用 AnyGen 风格的浮动面板设计
 */
export const TaskFileList: React.FC<TaskFileListProps> = memo(
  ({
    files,
    selectedFileId,
    onFileClick,
    expanded = false,
    onExpandedChange,
  }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [currentFolder, setCurrentFolder] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<"all" | "image" | "code">(
      "all",
    );
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");

    // 点击外部关闭面板
    useEffect(() => {
      if (!expanded) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        // 检查点击是否在面板外部
        if (panelRef.current && !panelRef.current.contains(target)) {
          // 检查是否点击了触发按钮（在 Inputbar 中）
          const triggerButton = document.querySelector(
            "[data-task-files-trigger]",
          );
          if (triggerButton && triggerButton.contains(target)) {
            return;
          }
          onExpandedChange?.(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [expanded, onExpandedChange]);

    // 复制所有文件内容
    const handleCopyAll = () => {
      const allContent = files
        .filter((f) => f.content)
        .map((f) => `=== ${f.name} ===\n${f.content}`)
        .join("\n\n");
      if (allContent) {
        navigator.clipboard.writeText(allContent);
        toast.success("已复制所有文件内容");
      } else {
        toast.info("没有可复制的内容");
      }
    };

    // 切换筛选类型
    const handleFilterImage = () => {
      setFilterType((prev) => (prev === "image" ? "all" : "image"));
    };

    const handleFilterCode = () => {
      setFilterType((prev) => (prev === "code" ? "all" : "code"));
    };

    // 切换视图模式
    const handleToggleView = () => {
      setViewMode((prev) => (prev === "list" ? "grid" : "list"));
    };

    if (files.length === 0) {
      return null;
    }

    // 过滤文件
    let displayFiles = currentFolder
      ? files.filter((f) => f.name.startsWith(currentFolder + "/"))
      : files;

    // 根据类型筛选
    if (filterType === "image") {
      displayFiles = displayFiles.filter(
        (f) =>
          f.type === "image" || /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.name),
      );
    } else if (filterType === "code") {
      displayFiles = displayFiles.filter((f) =>
        /\.(js|ts|jsx|tsx|py|go|rs|java|cpp|c|h|css|html|json|md)$/i.test(
          f.name,
        ),
      );
    }

    return (
      <Container>
        {expanded && (
          <FilePanel ref={panelRef}>
            <PanelHeader>
              <Breadcrumb>
                <BreadcrumbItem onClick={() => setCurrentFolder(null)}>
                  <FolderOpen size={14} />
                  所有文件
                </BreadcrumbItem>
                {currentFolder && (
                  <>
                    <BreadcrumbSeparator>
                      <ChevronRight size={14} />
                    </BreadcrumbSeparator>
                    <BreadcrumbItem>{currentFolder}</BreadcrumbItem>
                  </>
                )}
              </Breadcrumb>
              <Toolbar>
                <ToolbarButton
                  title={viewMode === "list" ? "网格视图" : "列表视图"}
                  onClick={handleToggleView}
                  $active={viewMode === "grid"}
                >
                  <List size={16} />
                </ToolbarButton>
                <ToolbarButton title="复制全部" onClick={handleCopyAll}>
                  <Copy size={16} />
                </ToolbarButton>
                <ToolbarButton
                  title="筛选图片"
                  onClick={handleFilterImage}
                  $active={filterType === "image"}
                >
                  <Image size={16} />
                </ToolbarButton>
                <ToolbarButton
                  title="筛选代码"
                  onClick={handleFilterCode}
                  $active={filterType === "code"}
                >
                  <Code size={16} />
                </ToolbarButton>
              </Toolbar>
            </PanelHeader>

            <FileListContainer>
              {displayFiles.length === 0 ? (
                <EmptyState>
                  <EmptyIcon>
                    <FileText size={40} strokeWidth={1} />
                  </EmptyIcon>
                  <EmptyText>未找到任何项目</EmptyText>
                </EmptyState>
              ) : (
                displayFiles.map((file) => {
                  const color = getFileColor(file.type, file.name);
                  return (
                    <FileItem
                      key={file.id}
                      $selected={selectedFileId === file.id}
                      onClick={() => onFileClick?.(file)}
                    >
                      <FileIconWrapper $color={color}>
                        <Folder size={18} />
                      </FileIconWrapper>
                      <FileInfo>
                        <FileName title={file.name}>{file.name}</FileName>
                        <FileMeta>
                          {formatRelativeTime(file.updatedAt)}
                        </FileMeta>
                      </FileInfo>
                      <MoreButton
                        onClick={(e) => {
                          e.stopPropagation();
                          // TODO: 显示更多操作菜单
                        }}
                      >
                        <MoreHorizontal size={16} />
                      </MoreButton>
                    </FileItem>
                  );
                })
              )}
            </FileListContainer>
          </FilePanel>
        )}
      </Container>
    );
  },
);

TaskFileList.displayName = "TaskFileList";
