import React, { useCallback, useRef, useState } from "react";
import {
  ActionButtonGroup,
  Container,
  InputBarContainer,
  StyledTextarea,
  BottomBar,
  LeftSection,
  RightSection,
  SendButton,
  SecondaryActionButton,
  DragHandle,
  ImagePreviewContainer,
  ImagePreviewItem,
  ImagePreviewImg,
  ImageRemoveButton,
  ToolButton,
} from "../styles";
import { InputbarTools } from "./InputbarTools";
import { ArrowUp, Square, X, Languages } from "lucide-react";
import { BaseComposer } from "@/components/input-kit";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MessageImage } from "../../../types";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import { QueuedTurnsPanel } from "./QueuedTurnsPanel";

const INTERACTIVE_TARGET_SELECTOR =
  "button, a, input, textarea, select, option, [role='button'], [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

function shouldFocusComposerTextarea(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return !target.closest(INTERACTIVE_TARGET_SELECTOR);
}

interface InputbarCoreProps {
  text: string;
  setText: (text: string) => void;
  onSend: () => void;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  activeTools: Record<string, boolean>;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  showExecutionStrategy?: boolean;
  onToolClick: (tool: string) => void;
  pendingImages?: MessageImage[];
  onRemoveImage?: (index: number) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  isFullscreen?: boolean;
  /** 画布是否打开 */
  isCanvasOpen?: boolean;
  /** Textarea ref（用于 CharacterMention） */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** 输入框底栏左侧扩展区域 */
  leftExtra?: React.ReactNode;
  /** 输入框底栏右侧扩展区域 */
  rightExtra?: React.ReactNode;
  /** 输入框内部顶部扩展区域（textarea 上方） */
  topExtra?: React.ReactNode;
  /** 输入框提示文案 */
  placeholder?: string;
  /** 工具栏模式 */
  toolMode?: "default" | "attach-only";
  /** 是否显示翻译按钮 */
  showTranslate?: boolean;
  /** 是否显示顶部拖拽条 */
  showDragHandle?: boolean;
  /** 视觉风格 */
  visualVariant?: "default" | "floating";
  activeTheme?: string;
  queuedTurns?: QueuedTurnSnapshot[];
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
}

export const InputbarCore: React.FC<InputbarCoreProps> = ({
  text,
  setText,
  onSend,
  onStop,
  isLoading = false,
  disabled = false,
  activeTools,
  executionStrategy,
  showExecutionStrategy = false,
  onToolClick,
  pendingImages = [],
  onRemoveImage,
  onPaste,
  isFullscreen = false,
  isCanvasOpen = false,
  textareaRef: externalTextareaRef,
  leftExtra,
  rightExtra,
  topExtra,
  placeholder,
  toolMode = "default",
  showTranslate = true,
  showDragHandle = true,
  visualVariant = "default",
  activeTheme,
  queuedTurns = [],
  onRemoveQueuedTurn,
}) => {
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const inputBarContainerRef = useRef<HTMLDivElement | null>(null);
  const isFloatingVariant = visualVariant === "floating";
  const shouldCollapseFloatingTools =
    isFloatingVariant &&
    toolMode === "attach-only" &&
    !isComposerExpanded &&
    pendingImages.length === 0 &&
    queuedTurns.length === 0;
  const shouldUseCompactFloatingComposer =
    shouldCollapseFloatingTools && !topExtra;
  const containerClassName = [
    isFullscreen ? "flex-1 flex flex-col" : "",
    isFloatingVariant ? "floating-composer" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputBarClassName = [
    isFullscreen ? "flex-1 flex flex-col" : "",
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const textareaClassName = [
    isFullscreen ? "flex-1 resize-none" : "",
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bottomBarClassName = [
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const leftSectionClassName = shouldCollapseFloatingTools ? "floating-collapsed" : "";
  const rightSectionClassName = shouldUseCompactFloatingComposer
    ? "floating-collapsed"
    : "";

  const handleExpandComposer = useCallback(() => {
    if (!isFloatingVariant || toolMode !== "attach-only") {
      return;
    }
    setIsComposerExpanded(true);
  }, [isFloatingVariant, toolMode]);

  const handleCollapseComposer = useCallback(() => {
    if (!isFloatingVariant || toolMode !== "attach-only" || pendingImages.length > 0) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement && inputBarContainerRef.current?.contains(activeElement)) {
      return;
    }
    setIsComposerExpanded(false);
  }, [isFloatingVariant, pendingImages.length, toolMode]);

  const handleBlurCapture = useCallback(() => {
    if (!isFloatingVariant || toolMode !== "attach-only") {
      return;
    }
    window.requestAnimationFrame(() => {
      const nextActiveElement = document.activeElement;
      if (inputBarContainerRef.current?.contains(nextActiveElement)) {
        return;
      }
      setIsComposerExpanded(false);
    });
  }, [isFloatingVariant, toolMode]);

  return (
    <BaseComposer
      text={text}
      setText={setText}
      onSend={onSend}
      onStop={onStop}
      isLoading={isLoading}
      disabled={disabled}
      onPaste={onPaste}
      isFullscreen={isFullscreen}
      fillHeightWhenFullscreen
      hasAdditionalContent={pendingImages.length > 0}
      maxAutoHeight={isFloatingVariant ? 160 : 300}
      textareaRef={externalTextareaRef}
      onEscape={() => onToolClick("fullscreen")}
      allowSendWhileLoading
      placeholder={
        placeholder ||
        (isFullscreen
          ? "全屏编辑模式，按 ESC 退出，Enter 发送"
          : "在这里输入消息, 按 Enter 发送")
      }
    >
      {({ textareaProps, textareaRef, isPrimaryDisabled, onPrimaryAction }) => {
        const handleContainerMouseDownCapture = (
          event: React.MouseEvent<HTMLDivElement>,
        ) => {
          handleExpandComposer();
          if (!isFloatingVariant || toolMode !== "attach-only") {
            return;
          }
          if (!shouldFocusComposerTextarea(event.target)) {
            return;
          }
          window.requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        };

        return (
          <Container className={containerClassName}>
            <InputBarContainer
              ref={inputBarContainerRef}
              data-testid="inputbar-core-container"
              className={inputBarClassName}
              onFocusCapture={handleExpandComposer}
              onMouseDownCapture={handleContainerMouseDownCapture}
              onMouseLeave={handleCollapseComposer}
              onBlurCapture={handleBlurCapture}
            >
              {!isFullscreen && showDragHandle && <DragHandle />}

              {pendingImages.length > 0 && (
                <ImagePreviewContainer>
                  {pendingImages.map((img, index) => (
                    <ImagePreviewItem key={index}>
                      <ImagePreviewImg
                        src={`data:${img.mediaType};base64,${img.data}`}
                        alt={`预览 ${index + 1}`}
                      />
                      <ImageRemoveButton onClick={() => onRemoveImage?.(index)}>
                        <X size={12} />
                      </ImageRemoveButton>
                    </ImagePreviewItem>
                  ))}
                </ImagePreviewContainer>
              )}

              {topExtra}
              <QueuedTurnsPanel
                queuedTurns={queuedTurns}
                onRemoveQueuedTurn={onRemoveQueuedTurn}
              />

              <StyledTextarea
                ref={textareaRef}
                {...textareaProps}
                className={textareaClassName}
              />

              <BottomBar className={bottomBarClassName}>
                <LeftSection className={leftSectionClassName}>
                  {leftExtra && (
                    <div className="flex items-center gap-2 mr-2">{leftExtra}</div>
                  )}
                  {!shouldCollapseFloatingTools ? (
                    <InputbarTools
                      onToolClick={onToolClick}
                      activeTools={activeTools}
                      executionStrategy={executionStrategy}
                      showExecutionStrategy={showExecutionStrategy}
                      toolMode={toolMode}
                      isCanvasOpen={isCanvasOpen}
                      activeTheme={activeTheme}
                    />
                  ) : null}
                </LeftSection>

                <RightSection className={rightSectionClassName}>
                  {rightExtra}
                  {showTranslate ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ToolButton onClick={() => onToolClick("translate")}>
                            <Languages size={18} />
                          </ToolButton>
                        </TooltipTrigger>
                        <TooltipContent side="top">翻译</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                  <ActionButtonGroup>
                    {isLoading ? (
                      <SecondaryActionButton
                        type="button"
                        onClick={onStop}
                        disabled={!onStop}
                      >
                        <Square size={14} fill="currentColor" />
                        <span>停止</span>
                      </SecondaryActionButton>
                    ) : null}
                    <SendButton
                      type="button"
                      onClick={onPrimaryAction}
                      disabled={isPrimaryDisabled}
                      $hasLabel={isLoading}
                    >
                      <ArrowUp size={isLoading ? 16 : 20} strokeWidth={3} />
                      {isLoading ? <span>排队</span> : null}
                    </SendButton>
                  </ActionButtonGroup>
                </RightSection>
              </BottomBar>
            </InputBarContainer>
          </Container>
        );
      }}
    </BaseComposer>
  );
};
