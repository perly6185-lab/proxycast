import React from "react";
import {
  Paperclip,
  Lightbulb,
  Globe,
  Code2,
  ListChecks,
  Workflow,
} from "lucide-react";
import { ToolButton } from "../styles";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isGeneralResearchTheme } from "../../../utils/generalAgentPrompt";

interface InputbarToolsProps {
  onToolClick?: (tool: string) => void;
  activeTools?: Record<string, boolean>;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  showExecutionStrategy?: boolean;
  toolMode?: "default" | "attach-only";
  /** 画布是否打开（兼容保留，不再展示画布图标） */
  isCanvasOpen?: boolean;
  activeTheme?: string;
}

export const InputbarTools: React.FC<InputbarToolsProps> = ({
  onToolClick,
  activeTools = {},
  executionStrategy = "react",
  showExecutionStrategy = false,
  toolMode = "default",
  activeTheme,
}) => {
  const modeLabel =
    executionStrategy === "auto"
      ? "Auto"
      : executionStrategy === "code_orchestrated"
        ? "Plan"
        : "ReAct";
  const strategyEnabled =
    executionStrategy !== "react" || activeTools["execution_strategy"];
  const isGeneralTheme = isGeneralResearchTheme(activeTheme);

  return (
    <TooltipProvider>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolButton onClick={() => onToolClick?.("attach")}>
              <Paperclip />
            </ToolButton>
          </TooltipTrigger>
          <TooltipContent side="top">上传文件</TooltipContent>
        </Tooltip>

        {toolMode === "default" ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToolButton
                  onClick={() => onToolClick?.("thinking")}
                  className={activeTools["thinking"] ? "active" : ""}
                >
                  <Lightbulb
                    className={activeTools["thinking"] ? "text-yellow-500" : ""}
                  />
                </ToolButton>
              </TooltipTrigger>
              <TooltipContent side="top">
                深度思考 {activeTools["thinking"] ? "(已开启)" : ""}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToolButton
                  onClick={() => onToolClick?.("web_search")}
                  className={activeTools["web_search"] ? "active" : ""}
                >
                  <Globe
                    className={activeTools["web_search"] ? "text-blue-500" : ""}
                  />
                </ToolButton>
              </TooltipTrigger>
              <TooltipContent side="top">
                联网搜索 {activeTools["web_search"] ? "(已开启)" : ""}
              </TooltipContent>
            </Tooltip>

            {isGeneralTheme ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToolButton
                      onClick={() => onToolClick?.("task_mode")}
                      className={activeTools["task_mode"] ? "active" : ""}
                    >
                      <ListChecks
                        className={
                          activeTools["task_mode"] ? "text-emerald-500" : ""
                        }
                      />
                    </ToolButton>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    后台任务 {activeTools["task_mode"] ? "(偏好已开启)" : ""}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToolButton
                      onClick={() => onToolClick?.("subagent_mode")}
                      className={activeTools["subagent_mode"] ? "active" : ""}
                    >
                      <Workflow
                        className={
                          activeTools["subagent_mode"] ? "text-fuchsia-500" : ""
                        }
                      />
                    </ToolButton>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    多代理 {activeTools["subagent_mode"] ? "(偏好已开启)" : ""}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : null}

            {showExecutionStrategy && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolButton
                    onClick={() => onToolClick?.("execution_strategy")}
                    className={strategyEnabled ? "active" : ""}
                  >
                    <Code2
                      className={strategyEnabled ? "text-emerald-500" : ""}
                    />
                  </ToolButton>
                </TooltipTrigger>
                <TooltipContent side="top">执行模式: {modeLabel}</TooltipContent>
              </Tooltip>
            )}
          </>
        ) : null}
      </div>
    </TooltipProvider>
  );
};
