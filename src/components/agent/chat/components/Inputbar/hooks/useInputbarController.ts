import React, { useRef } from "react";
import type { A2UISubmissionNoticeData } from "../components/A2UISubmissionNotice";
import { SkillBadge } from "../components/SkillBadge";
import { useActiveSkill } from "./useActiveSkill";
import { useHintRoutes } from "./useHintRoutes";
import { useImageAttachments } from "./useImageAttachments";
import { useInputbarAdapter } from "./useInputbarAdapter";
import { useInputbarDisplayState } from "./useInputbarDisplayState";
import { useInputbarSend } from "./useInputbarSend";
import {
  useInputbarToolState,
  type InputbarToolStates,
} from "./useInputbarToolState";
import type {
  ThemeWorkbenchGateState,
  ThemeWorkbenchWorkflowStep,
} from "./useThemeWorkbenchInputState";
import type { A2UIResponse } from "@/components/content-creator/a2ui/types";
import type { MessageImage } from "../../../types";

interface UseInputbarControllerParams {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
  ) => void;
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  onClearMessages?: () => void;
  onToggleCanvas?: () => void;
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
  variant?: "default" | "theme_workbench";
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  workflowSteps?: ThemeWorkbenchWorkflowStep[];
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  pendingA2UIForm?: A2UIResponse | null;
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
}

export function useInputbarController({
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
  variant = "default",
  themeWorkbenchGate,
  workflowSteps = [],
  themeWorkbenchRunState,
  pendingA2UIForm,
  a2uiSubmissionNotice,
}: UseInputbarControllerParams) {
  const { activeSkill, setActiveSkill, clearActiveSkill } = useActiveSkill();
  const {
    pendingImages,
    fileInputRef,
    handleFileSelect,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    clearPendingImages,
    openFileDialog,
  } = useImageAttachments();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isThemeWorkbenchVariant = variant === "theme_workbench";

  const {
    activeTools,
    handleToolClick,
    isFullscreen,
    thinkingEnabled,
    taskEnabled,
    subagentEnabled,
    webSearchEnabled,
  } = useInputbarToolState({
    toolStates,
    onToolStatesChange,
    executionStrategy,
    setExecutionStrategy,
    setInput,
    onClearMessages,
    onToggleCanvas,
    clearPendingImages,
    openFileDialog,
  });

  const {
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleSetInput,
    handleHintSelect,
    handleHintKeyDown,
  } = useHintRoutes({
    setInput,
    textareaRef,
  });

  const handleSend = useInputbarSend({
    input,
    pendingImages,
    webSearchEnabled,
    thinkingEnabled,
    executionStrategy,
    activeTools,
    activeSkill,
    activeTheme,
    onSend,
    clearPendingImages,
    clearActiveSkill,
  });

  const inputAdapter = useInputbarAdapter({
    input,
    setInput: handleSetInput,
    isLoading,
    disabled,
    providerType,
    setProviderType,
    model,
    setModel,
    handleSend,
    onStop,
    pendingImages,
    setExecutionStrategy,
  });

  const {
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
    visibleA2UISubmissionNotice,
    isA2UISubmissionNoticeVisible,
  } = useInputbarDisplayState({
    isThemeWorkbenchVariant,
    themeWorkbenchGate,
    workflowSteps,
    themeWorkbenchRunState,
    isSending: inputAdapter.state.isSending,
    pendingA2UIForm: Boolean(pendingA2UIForm),
    a2uiSubmissionNotice,
  });

  const topExtra = activeSkill
    ? React.createElement(SkillBadge, {
        skill: activeSkill,
        onClear: clearActiveSkill,
      })
    : undefined;

  return {
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
    taskEnabled,
    subagentEnabled,
    thinkingEnabled,
    webSearchEnabled,
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
    visibleA2UISubmissionNotice,
    isA2UISubmissionNoticeVisible,
    setActiveSkill,
  };
}
