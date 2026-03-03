import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { InputbarCore } from "./components/InputbarCore";
import { CharacterMention } from "./components/CharacterMention";
import { toast } from "sonner";
import styled from "styled-components";
import type { MessageImage } from "../../types";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import { TaskFileList, type TaskFile } from "../TaskFiles";
import { FolderOpen, ChevronUp, Code2 } from "lucide-react";
import { useActiveSkill } from "./hooks/useActiveSkill";
import { SkillBadge } from "./components/SkillBadge";
import { ChatModelSelector } from "../ChatModelSelector";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { createAgentInputAdapter } from "@/components/input-kit";

// 任务文件触发器区域（在输入框上方，与输入框对齐）
const TaskFilesArea = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 0 8px 8px 8px;
  width: 100%;
  max-width: none;
  margin: 0;
`;

// 按钮和面板的包装容器
const TaskFilesWrapper = styled.div`
  position: relative;
`;

// 任务文件按钮
const TaskFilesButton = styled.button<{
  $expanded?: boolean;
  $hasFiles?: boolean;
}>`
  display: ${(props) => (props.$hasFiles ? "flex" : "none")};
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.15s;

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

const FileCount = styled.span`
  font-weight: 500;
`;

const ChevronIcon = styled.span<{ $expanded?: boolean }>`
  display: flex;
  align-items: center;
  transform: ${(props) =>
    props.$expanded ? "rotate(0deg)" : "rotate(180deg)"};
  transition: transform 0.2s;
`;

// Hint 路由弹出框
const HintPopup = styled.div`
  position: absolute;
  bottom: 100%;
  left: 8px;
  margin-bottom: 4px;
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 50;
`;

const HintItem = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: ${(props) =>
    props.$active ? "hsl(var(--accent))" : "transparent"};
  color: hsl(var(--foreground));
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  line-height: 1.4;

  &:hover {
    background: hsl(var(--accent));
  }
`;

const HintLabel = styled.span`
  font-weight: 500;
`;

const HintModel = styled.span`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const NOOP_SET_PROVIDER_TYPE = (_type: string) => {};
const NOOP_SET_MODEL = (_model: string) => {};

interface HintRouteItem {
  hint: string;
  provider: string;
  model: string;
}

interface InputbarProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
  ) => void;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  onClearMessages?: () => void;
  /** 切换画布显示 */
  onToggleCanvas?: () => void;
  /** 画布是否打开 */
  isCanvasOpen?: boolean;
  /** 任务文件列表 */
  taskFiles?: TaskFile[];
  /** 选中的文件 ID */
  selectedFileId?: string;
  /** 任务文件面板是否展开 */
  taskFilesExpanded?: boolean;
  /** 切换任务文件面板 */
  onToggleTaskFiles?: () => void;
  /** 文件点击回调 */
  onTaskFileClick?: (file: TaskFile) => void;
  /** 角色列表（用于 @ 引用） */
  characters?: Character[];
  /** 技能列表（用于 @ 引用） */
  skills?: Skill[];
  /** 选择角色回调 */
  onSelectCharacter?: (character: Character) => void;
  /** 跳转到设置页安装技能 */
  onNavigateToSettings?: () => void;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
}

export const Inputbar: React.FC<InputbarProps> = ({
  input,
  setInput,
  onSend,
  onStop,
  isLoading,
  disabled,
  onClearMessages,
  onToggleCanvas,
  isCanvasOpen = false,
  taskFiles = [],
  selectedFileId,
  taskFilesExpanded = false,
  onToggleTaskFiles,
  onTaskFileClick,
  characters = [],
  skills = [],
  onSelectCharacter,
  onNavigateToSettings,
  providerType,
  setProviderType,
  model,
  setModel,
  executionStrategy,
  setExecutionStrategy,
  activeTheme,
  onManageProviders,
}) => {
  const [activeTools, setActiveTools] = useState<Record<string, boolean>>({});
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { activeSkill, setActiveSkill, clearActiveSkill } = useActiveSkill();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hint 路由
  const [showHintPopup, setShowHintPopup] = useState(false);
  const [hintRoutes, setHintRoutes] = useState<HintRouteItem[]>([]);
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    safeInvoke<HintRouteItem[]>("get_hint_routes")
      .then((routes) => {
        if (routes?.length > 0) {
          setHintRoutes(routes);
        }
      })
      .catch(() => {});
  }, []);

  // 监听输入变化，触发 hint 弹出
  const handleSetInput = useCallback(
    (value: string) => {
      setInput(value);
      if (hintRoutes.length > 0 && value === "[") {
        setShowHintPopup(true);
        setHintIndex(0);
      } else if (!value.startsWith("[") || value.includes("]")) {
        setShowHintPopup(false);
      }
    },
    [hintRoutes.length, setInput],
  );

  const handleHintSelect = useCallback(
    (hint: string) => {
      setInput(`[${hint}] `);
      setShowHintPopup(false);
      textareaRef.current?.focus();
    },
    [setInput],
  );

  const handleHintKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showHintPopup || hintRoutes.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHintIndex((i) => (i + 1) % hintRoutes.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHintIndex((i) => (i - 1 + hintRoutes.length) % hintRoutes.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleHintSelect(hintRoutes[hintIndex].hint);
      } else if (e.key === "Escape") {
        setShowHintPopup(false);
      }
    },
    [handleHintSelect, hintIndex, hintRoutes, showHintPopup],
  );

  const handleToolClick = useCallback(
    (tool: string) => {
      switch (tool) {
        case "thinking":
        case "web_search":
          setActiveTools((prev) => {
            const newState = { ...prev, [tool]: !prev[tool] };
            toast.info(
              `${tool === "thinking" ? "深度思考" : "联网搜索"}${newState[tool] ? "已开启" : "已关闭"}`,
            );
            return newState;
          });
          break;
        case "execution_strategy":
          if (setExecutionStrategy) {
            const strategyOrder: Array<
              "react" | "code_orchestrated" | "auto"
            > = ["react", "code_orchestrated", "auto"];
            const currentIndex = strategyOrder.indexOf(
              executionStrategy || "react",
            );
            const nextStrategy =
              strategyOrder[(currentIndex + 1) % strategyOrder.length];
            setExecutionStrategy(nextStrategy);
            toast.info(
              nextStrategy === "react"
                ? "执行模式：ReAct（需确认）"
                : nextStrategy === "code_orchestrated"
                  ? "执行模式：编排（需确认）"
                  : "执行模式：Auto（工具自动确认）",
            );
            break;
          }
          setActiveTools((prev) => {
            const enabled = !prev["execution_strategy"];
            toast.info(`编排模式${enabled ? "已开启" : "已关闭"}`);
            return { ...prev, execution_strategy: enabled };
          });
          break;
        case "clear":
          setInput("");
          setPendingImages([]);
          toast.success("已清除输入");
          break;
        case "new_topic":
          onClearMessages?.();
          setInput("");
          setPendingImages([]);
          break;
        case "attach":
          fileInputRef.current?.click();
          break;
        case "quick_action":
        case "translate":
          toast.info("翻译功能开发中...");
          break;
        case "fullscreen":
          setIsFullscreen((prev) => !prev);
          toast.info(isFullscreen ? "已退出全屏" : "已进入全屏编辑");
          break;
        case "canvas":
          onToggleCanvas?.();
          break;
        default:
          break;
      }
    },
    [
      executionStrategy,
      onClearMessages,
      onToggleCanvas,
      setExecutionStrategy,
      setInput,
      isFullscreen,
    ],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      Array.from(files).forEach((file) => {
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            const base64Data = base64.split(",")[1];
            setPendingImages((prev) => [
              ...prev,
              {
                data: base64Data,
                mediaType: file.type,
              },
            ]);
            toast.success(`已添加图片: ${file.name}`);
          };
          reader.readAsDataURL(file);
        } else {
          toast.info(`暂不支持该文件类型: ${file.type}`);
        }
      });

      e.target.value = "";
    },
    [],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            const base64Data = base64.split(",")[1];
            setPendingImages((prev) => [
              ...prev,
              {
                data: base64Data,
                mediaType: item.type,
              },
            ]);
            toast.success("已粘贴图片");
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  }, []);

  // 文件拖拽处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          const base64Data = base64.split(",")[1];
          setPendingImages((prev) => [
            ...prev,
            {
              data: base64Data,
              mediaType: file.type,
            },
          ]);
          toast.success(`已添加图片: ${file.name}`);
        };
        reader.readAsDataURL(file);
      } else {
        toast.info(`暂不支持该文件类型: ${file.type}`);
      }
    });
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(() => {
    if (!input.trim() && pendingImages.length === 0) return;
    const webSearch = activeTools["web_search"] || false;
    const thinking = activeTools["thinking"] || false;
    let strategy =
      executionStrategy ||
      (activeTools["execution_strategy"] ? "code_orchestrated" : "react");

    if (webSearch && strategy !== "react") {
      strategy = "react";
    }

    // 如果有 activeSkill，拼接 /skill.key 前缀
    const textOverride = activeSkill
      ? `/${activeSkill.key} ${input}`.trim()
      : undefined;

    onSend(
      pendingImages.length > 0 ? pendingImages : undefined,
      webSearch,
      thinking,
      textOverride,
      strategy,
    );
    setPendingImages([]);
    clearActiveSkill();
  }, [activeSkill, activeTools, clearActiveSkill, executionStrategy, input, onSend, pendingImages]);

  const handleToggleTaskFiles = useCallback(() => {
    onToggleTaskFiles?.();
  }, [onToggleTaskFiles]);

  const resolvedExecutionStrategy = executionStrategy || "react";
  const executionStrategyLabel =
    resolvedExecutionStrategy === "auto"
      ? "Auto"
      : resolvedExecutionStrategy === "code_orchestrated"
        ? "编排"
        : "ReAct";

  const inputAdapter = useMemo(
    () =>
      createAgentInputAdapter({
        text: input,
        setText: handleSetInput,
        isSending: isLoading,
        disabled,
        providerType: providerType || "",
        model: model || "",
        setProviderType: setProviderType || NOOP_SET_PROVIDER_TYPE,
        setModel: setModel || NOOP_SET_MODEL,
        send: () => handleSend(),
        stop: onStop,
        attachments: pendingImages,
        showExecutionStrategy: Boolean(setExecutionStrategy),
      }),
    [
      disabled,
      handleSend,
      handleSetInput,
      input,
      isLoading,
      model,
      onStop,
      pendingImages,
      providerType,
      setExecutionStrategy,
      setModel,
      setProviderType,
    ],
  );

  const shouldRenderModelSelector = Boolean(
    providerType && setProviderType && model && setModel,
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleHintKeyDown}
      className={
        isFullscreen ? "fixed inset-0 z-50 bg-background p-4 flex flex-col" : ""
      }
      style={{ position: "relative" }}
    >
      {/* Hint 路由弹出框 */}
      {showHintPopup && hintRoutes.length > 0 && (
        <HintPopup>
          {hintRoutes.map((route, i) => (
            <HintItem
              key={route.hint}
              $active={i === hintIndex}
              onClick={() => handleHintSelect(route.hint)}
            >
              <HintLabel>[{route.hint}]</HintLabel>
              <HintModel>{route.provider} / {route.model}</HintModel>
            </HintItem>
          ))}
        </HintPopup>
      )}
      {/* 任务文件区域 - 在输入框上方 */}
      {taskFiles.length > 0 && (
        <TaskFilesArea>
          {/* 按钮和面板的包装容器 */}
          <TaskFilesWrapper>
            {/* 任务文件面板 */}
            <TaskFileList
              files={taskFiles}
              selectedFileId={selectedFileId}
              onFileClick={onTaskFileClick}
              expanded={taskFilesExpanded}
              onExpandedChange={(expanded) => {
                if (expanded !== taskFilesExpanded) {
                  onToggleTaskFiles?.();
                }
              }}
            />
            {/* 任务文件按钮 */}
            <TaskFilesButton
              $hasFiles={taskFiles.length > 0}
              $expanded={taskFilesExpanded}
              onClick={handleToggleTaskFiles}
              data-task-files-trigger
            >
              <FolderOpen size={14} />
              任务文件
              <FileCount>({taskFiles.length})</FileCount>
              <ChevronIcon $expanded={taskFilesExpanded}>
                <ChevronUp size={14} />
              </ChevronIcon>
            </TaskFilesButton>
          </TaskFilesWrapper>
        </TaskFilesArea>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />
      {/* 角色与技能引用组件 */}
      <CharacterMention
        characters={characters}
        skills={skills}
        inputRef={textareaRef}
        value={input}
        onChange={inputAdapter.actions.setText}
        onSelectCharacter={onSelectCharacter}
        onSelectSkill={setActiveSkill}
        onNavigateToSettings={onNavigateToSettings}
      />
      <InputbarCore
        textareaRef={textareaRef}
        text={inputAdapter.state.text}
        setText={inputAdapter.actions.setText}
        onSend={handleSend}
        onStop={inputAdapter.actions.stop}
        isLoading={inputAdapter.state.isSending}
        disabled={inputAdapter.state.disabled}
        onToolClick={handleToolClick}
        activeTools={activeTools}
        executionStrategy={executionStrategy}
        showExecutionStrategy={false}
        pendingImages={
          (inputAdapter.state.attachments as MessageImage[] | undefined) ||
          pendingImages
        }
        onRemoveImage={handleRemoveImage}
        onPaste={handlePaste}
        isFullscreen={isFullscreen}
        isCanvasOpen={isCanvasOpen}
        topExtra={
          activeSkill ? (
            <SkillBadge skill={activeSkill} onClear={clearActiveSkill} />
          ) : undefined
        }
        leftExtra={
          !isFullscreen ? (
            <div className="flex items-center gap-2">
              {shouldRenderModelSelector && inputAdapter.model ? (
                <ChatModelSelector
                  providerType={inputAdapter.model.providerType}
                  setProviderType={inputAdapter.actions.setProviderType || NOOP_SET_PROVIDER_TYPE}
                  model={inputAdapter.model.model}
                  setModel={inputAdapter.actions.setModel || NOOP_SET_MODEL}
                  activeTheme={activeTheme}
                  compactTrigger
                  popoverSide="top"
                  onManageProviders={onManageProviders}
                />
              ) : null}
            </div>
          ) : undefined
        }
        rightExtra={
          !isFullscreen && setExecutionStrategy ? (
            <Select
              value={resolvedExecutionStrategy}
              onValueChange={(value) =>
                setExecutionStrategy(
                  value as "react" | "code_orchestrated" | "auto",
                )
              }
            >
              <SelectTrigger className="h-8 text-xs bg-background border shadow-sm min-w-[116px] px-2">
                <div className="flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="whitespace-nowrap">
                    {executionStrategyLabel}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent side="top" className="p-1 w-[176px]">
                <SelectItem value="react">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Code2 className="w-3.5 h-3.5" />
                    ReAct · 需确认
                  </div>
                </SelectItem>
                <SelectItem value="code_orchestrated">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Code2 className="w-3.5 h-3.5" />
                    编排 · 需确认
                  </div>
                </SelectItem>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Code2 className="w-3.5 h-3.5" />
                    Auto · 自动确认
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : undefined
        }
      />
    </div>
  );
};
