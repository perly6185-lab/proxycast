import React from "react";
import type { ChatInputAdapter } from "@/components/input-kit/adapters/types";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { MessageImage } from "../../../types";
import { CharacterMention } from "./CharacterMention";
import { InputbarCore } from "./InputbarCore";
import { ThemeWorkbenchStatusPanel } from "./ThemeWorkbenchStatusPanel";
import { InputbarModelExtra } from "./InputbarModelExtra";
import { InputbarExecutionStrategySelect } from "./InputbarExecutionStrategySelect";
import type {
  ThemeWorkbenchGateState,
  ThemeWorkbenchQuickAction,
  ThemeWorkbenchWorkflowStep,
} from "../hooks/useThemeWorkbenchInputState";

interface InputbarComposerSectionProps {
  renderThemeWorkbenchGeneratingPanel: boolean;
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  themeWorkbenchQuickActions: ThemeWorkbenchQuickAction[];
  themeWorkbenchQueueItems: ThemeWorkbenchWorkflowStep[];
  inputAdapter: ChatInputAdapter;
  characters: Character[];
  skills: Skill[];
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  onSelectCharacter?: (character: Character) => void;
  onSelectSkill: (skill: Skill) => void;
  onNavigateToSettings?: () => void;
  onSend: () => void;
  onToolClick: (tool: string) => void;
  activeTools: Record<string, boolean>;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  pendingImages: MessageImage[];
  onRemoveImage: (index: number) => void;
  onPaste: (event: React.ClipboardEvent) => void;
  isFullscreen: boolean;
  isCanvasOpen: boolean;
  isThemeWorkbenchVariant: boolean;
  activeTheme?: string;
  onManageProviders?: () => void;
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  topExtra?: React.ReactNode;
}

export const InputbarComposerSection: React.FC<
  InputbarComposerSectionProps
> = ({
  renderThemeWorkbenchGeneratingPanel,
  themeWorkbenchGate,
  themeWorkbenchQuickActions,
  themeWorkbenchQueueItems,
  inputAdapter,
  characters,
  skills,
  textareaRef,
  input,
  onSelectCharacter,
  onSelectSkill,
  onNavigateToSettings,
  onSend,
  onToolClick,
  activeTools,
  executionStrategy,
  pendingImages,
  onRemoveImage,
  onPaste,
  isFullscreen,
  isCanvasOpen,
  isThemeWorkbenchVariant,
  activeTheme,
  onManageProviders,
  setExecutionStrategy,
  topExtra,
}) => {
  if (renderThemeWorkbenchGeneratingPanel) {
    return (
      <ThemeWorkbenchStatusPanel
        gate={themeWorkbenchGate}
        quickActions={themeWorkbenchQuickActions}
        queueItems={themeWorkbenchQueueItems}
        renderGeneratingPanel
        onQuickAction={inputAdapter.actions.setText}
        onStop={inputAdapter.actions.stop}
      />
    );
  }

  return (
    <>
      <ThemeWorkbenchStatusPanel
        gate={themeWorkbenchGate}
        quickActions={themeWorkbenchQuickActions}
        queueItems={themeWorkbenchQueueItems}
        renderGeneratingPanel={false}
        onQuickAction={inputAdapter.actions.setText}
        onStop={inputAdapter.actions.stop}
      />
      <CharacterMention
        characters={characters}
        skills={skills}
        inputRef={textareaRef}
        value={input}
        onChange={inputAdapter.actions.setText}
        onSelectCharacter={onSelectCharacter}
        onSelectSkill={onSelectSkill}
        onNavigateToSettings={onNavigateToSettings}
      />
      <InputbarCore
        textareaRef={textareaRef}
        text={inputAdapter.state.text}
        setText={inputAdapter.actions.setText}
        onSend={onSend}
        onStop={inputAdapter.actions.stop}
        isLoading={inputAdapter.state.isSending}
        disabled={inputAdapter.state.disabled}
        onToolClick={onToolClick}
        activeTools={activeTools}
        executionStrategy={executionStrategy}
        showExecutionStrategy={false}
        pendingImages={
          (inputAdapter.state.attachments as MessageImage[] | undefined) ||
          pendingImages
        }
        onRemoveImage={onRemoveImage}
        onPaste={onPaste}
        isFullscreen={isFullscreen}
        isCanvasOpen={isCanvasOpen}
        placeholder={
          isThemeWorkbenchVariant
            ? themeWorkbenchGate?.status === "waiting"
              ? "说说你的选择，剩下的交给我"
              : "试着输入任何指令，剩下的交给我"
            : undefined
        }
        toolMode={isThemeWorkbenchVariant ? "attach-only" : "default"}
        showTranslate={!isThemeWorkbenchVariant}
        showDragHandle={!isThemeWorkbenchVariant}
        visualVariant={isThemeWorkbenchVariant ? "floating" : "default"}
        topExtra={topExtra}
        activeTheme={activeTheme}
        leftExtra={
          <InputbarModelExtra
            isFullscreen={isFullscreen}
            isThemeWorkbenchVariant={isThemeWorkbenchVariant}
            providerType={inputAdapter.model?.providerType}
            setProviderType={inputAdapter.actions.setProviderType}
            model={inputAdapter.model?.model}
            setModel={inputAdapter.actions.setModel}
            activeTheme={activeTheme}
            onManageProviders={onManageProviders}
          />
        }
        rightExtra={
          <InputbarExecutionStrategySelect
            isFullscreen={isFullscreen}
            isThemeWorkbenchVariant={isThemeWorkbenchVariant}
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
          />
        }
      />
    </>
  );
};
