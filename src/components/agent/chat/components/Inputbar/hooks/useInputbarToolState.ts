import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

export interface InputbarToolStates {
  webSearch: boolean;
  thinking: boolean;
  task: boolean;
  subagent: boolean;
}

interface UseInputbarToolStateParams {
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  setInput: (value: string) => void;
  onClearMessages?: () => void;
  onToggleCanvas?: () => void;
  clearPendingImages: () => void;
  openFileDialog: () => void;
}

const DEFAULT_INPUTBAR_TOOL_STATES: InputbarToolStates = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

export function useInputbarToolState({
  toolStates,
  onToolStatesChange,
  executionStrategy,
  setExecutionStrategy,
  setInput,
  onClearMessages,
  onToggleCanvas,
  clearPendingImages,
  openFileDialog,
}: UseInputbarToolStateParams) {
  const [localActiveTools, setLocalActiveTools] = useState<
    Record<string, boolean>
  >({});
  const [localToolStates, setLocalToolStates] = useState<InputbarToolStates>(
    DEFAULT_INPUTBAR_TOOL_STATES,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  const webSearchEnabled =
    toolStates?.webSearch ?? localToolStates.webSearch;
  const thinkingEnabled = toolStates?.thinking ?? localToolStates.thinking;
  const taskEnabled = toolStates?.task ?? localToolStates.task;
  const subagentEnabled = toolStates?.subagent ?? localToolStates.subagent;

  const activeTools = useMemo<Record<string, boolean>>(
    () => ({
      ...localActiveTools,
      web_search: webSearchEnabled,
      thinking: thinkingEnabled,
      task_mode: taskEnabled,
      subagent_mode: subagentEnabled,
    }),
    [
      localActiveTools,
      thinkingEnabled,
      webSearchEnabled,
      taskEnabled,
      subagentEnabled,
    ],
  );

  const updateToolStates = useCallback(
    (next: InputbarToolStates) => {
      setLocalToolStates((prev) => ({
        webSearch: toolStates?.webSearch ?? next.webSearch ?? prev.webSearch,
        thinking: toolStates?.thinking ?? next.thinking ?? prev.thinking,
        task: toolStates?.task ?? next.task ?? prev.task,
        subagent: toolStates?.subagent ?? next.subagent ?? prev.subagent,
      }));
      onToolStatesChange?.(next);
      return next;
    },
    [
      onToolStatesChange,
      toolStates?.subagent,
      toolStates?.task,
      toolStates?.thinking,
      toolStates?.webSearch,
    ],
  );

  const handleToolClick = useCallback(
    (tool: string) => {
      switch (tool) {
        case "thinking": {
          const nextThinking = !thinkingEnabled;
          updateToolStates({
            webSearch: webSearchEnabled,
            thinking: nextThinking,
            task: taskEnabled,
            subagent: subagentEnabled,
          });
          toast.info(`深度思考${nextThinking ? "已开启" : "已关闭"}`);
          break;
        }
        case "web_search": {
          const nextWebSearch = !webSearchEnabled;
          updateToolStates({
            webSearch: nextWebSearch,
            thinking: thinkingEnabled,
            task: taskEnabled,
            subagent: subagentEnabled,
          });
          toast.info(`联网搜索${nextWebSearch ? "已开启" : "已关闭"}`);
          break;
        }
        case "task_mode": {
          const nextTask = !taskEnabled;
          updateToolStates({
            webSearch: webSearchEnabled,
            thinking: thinkingEnabled,
            task: nextTask,
            subagent: subagentEnabled,
          });
          toast.info(`后台任务${nextTask ? "偏好已开启" : "偏好已关闭"}`);
          break;
        }
        case "subagent_mode": {
          const nextSubagent = !subagentEnabled;
          updateToolStates({
            webSearch: webSearchEnabled,
            thinking: thinkingEnabled,
            task: taskEnabled,
            subagent: nextSubagent,
          });
          toast.info(`多代理${nextSubagent ? "偏好已开启" : "偏好已关闭"}`);
          break;
        }
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
                ? "执行模式：ReAct"
                : nextStrategy === "code_orchestrated"
                  ? "执行模式：Plan"
                  : "执行模式：Auto",
            );
            break;
          }
          setLocalActiveTools((prev) => {
            const enabled = !prev["execution_strategy"];
            toast.info(`Plan 模式${enabled ? "已开启" : "已关闭"}`);
            return { ...prev, execution_strategy: enabled };
          });
          break;
        case "clear":
          setInput("");
          clearPendingImages();
          toast.success("已清除输入");
          break;
        case "new_topic":
          onClearMessages?.();
          setInput("");
          clearPendingImages();
          break;
        case "attach":
          openFileDialog();
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
      clearPendingImages,
      executionStrategy,
      isFullscreen,
      onClearMessages,
      onToggleCanvas,
      openFileDialog,
      setExecutionStrategy,
      setInput,
      thinkingEnabled,
      subagentEnabled,
      taskEnabled,
      updateToolStates,
      webSearchEnabled,
    ],
  );

  return {
    activeTools,
    handleToolClick,
    isFullscreen,
    thinkingEnabled,
    taskEnabled,
    subagentEnabled,
    webSearchEnabled,
  };
}
