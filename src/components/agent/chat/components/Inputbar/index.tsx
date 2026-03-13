import React from "react";
import type { MessageImage } from "../../types";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import type { TaskFile } from "../TaskFiles";
import { InputbarComposerSection } from "./components/InputbarComposerSection";
import { InputbarOverlayShell } from "./components/InputbarOverlayShell";
import { InputbarSurface } from "./components/InputbarSurface";
import type { A2UISubmissionNoticeData } from "./components/A2UISubmissionNotice";
import type { A2UIResponse, A2UIFormData } from "@/components/content-creator/a2ui/types";
import type { ThemeWorkbenchGateState, ThemeWorkbenchWorkflowStep } from "./hooks/useThemeWorkbenchInputState";
import { type InputbarToolStates } from "./hooks/useInputbarToolState";
import { useInputbarController } from "./hooks/useInputbarController";

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
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
  variant?: "default" | "theme_workbench";
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  workflowSteps?: ThemeWorkbenchWorkflowStep[];
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  /** 待处理的 A2UI Form（显示在输入框上方） */
  pendingA2UIForm?: A2UIResponse | null;
  /** A2UI Form 提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** A2UI 表单已提交提示 */
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
  queuedTurns?: QueuedTurnSnapshot[];
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
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
  toolStates,
  onToolStatesChange,
  activeTheme,
  onManageProviders,
  variant = "default",
  themeWorkbenchGate,
  workflowSteps = [],
  themeWorkbenchRunState,
  pendingA2UIForm,
  onA2UISubmit,
  a2uiSubmissionNotice,
  queuedTurns = [],
  onRemoveQueuedTurn,
}) => {
  const {
    textareaRef,
    isThemeWorkbenchVariant,
    pendingImages,
    fileInputRef,
    handleFileSelect,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleHintSelect,
    handleHintKeyDown,
    activeTools,
    handleToolClick,
    isFullscreen,
    handleSend,
    inputAdapter,
    topExtra,
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
    visibleA2UISubmissionNotice,
    isA2UISubmissionNoticeVisible,
    setActiveSkill,
  } = useInputbarController({
    input,
    setInput,
    onSend,
    onStop,
    isLoading,
    disabled,
    onClearMessages,
    onToggleCanvas,
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    toolStates,
    onToolStatesChange,
    activeTheme,
    variant,
    themeWorkbenchGate,
    workflowSteps,
    themeWorkbenchRunState,
    pendingA2UIForm,
    a2uiSubmissionNotice,
  });

  return (
    <InputbarSurface
      isFullscreen={isFullscreen}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleHintKeyDown}
    >
      <InputbarOverlayShell
        showHintPopup={showHintPopup}
        hintRoutes={hintRoutes}
        hintIndex={hintIndex}
        onHintSelect={handleHintSelect}
        taskFiles={taskFiles}
        selectedFileId={selectedFileId}
        taskFilesExpanded={taskFilesExpanded}
        onToggleTaskFiles={onToggleTaskFiles}
        onTaskFileClick={onTaskFileClick}
        submissionNotice={visibleA2UISubmissionNotice}
        isSubmissionNoticeVisible={isA2UISubmissionNoticeVisible}
        pendingA2UIForm={pendingA2UIForm}
        onA2UISubmit={onA2UISubmit}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
      />
      <InputbarComposerSection
        renderThemeWorkbenchGeneratingPanel={
          renderThemeWorkbenchGeneratingPanel
        }
        themeWorkbenchGate={themeWorkbenchGate}
        themeWorkbenchQuickActions={themeWorkbenchQuickActions}
        themeWorkbenchQueueItems={themeWorkbenchQueueItems}
        inputAdapter={inputAdapter}
        characters={characters}
        skills={skills}
        textareaRef={textareaRef}
        input={input}
        onSelectCharacter={onSelectCharacter}
        onSelectSkill={setActiveSkill}
        onNavigateToSettings={onNavigateToSettings}
        onSend={handleSend}
        onToolClick={handleToolClick}
        activeTools={activeTools}
        executionStrategy={executionStrategy}
        pendingImages={pendingImages}
        onRemoveImage={handleRemoveImage}
        onPaste={handlePaste}
        isFullscreen={isFullscreen}
        isCanvasOpen={isCanvasOpen}
        isThemeWorkbenchVariant={isThemeWorkbenchVariant}
        activeTheme={activeTheme}
        onManageProviders={onManageProviders}
        setExecutionStrategy={setExecutionStrategy}
        topExtra={topExtra}
        queuedTurns={queuedTurns}
        onRemoveQueuedTurn={onRemoveQueuedTurn}
      />
    </InputbarSurface>
  );
};
