import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  ListTodo,
  Sparkles,
  X,
} from "lucide-react";
import { A2UIRenderer } from "@/components/content-creator/a2ui/components";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/components/content-creator/a2ui/types";
import { WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET } from "@/components/content-creator/a2ui/taskCardPresets";
import { A2UI_TASK_CARD_TOKENS } from "@/components/content-creator/a2ui/taskCardTokens";
import {
  A2UITaskCardBody,
  A2UITaskCardStatusBadge,
} from "@/components/content-creator/a2ui/taskCardPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CREATE_CONFIRMATION_FORM_FIELDS,
  type PendingCreateConfirmation,
} from "@/components/workspace/utils/createConfirmationPolicy";

export interface WorkbenchCreateEntryHomeProps {
  projectName?: string;
  pendingCreateConfirmation?: PendingCreateConfirmation;
  createConfirmationResponse: A2UIResponse | null;
  onOpenCreateContentDialog: () => void;
  onSubmitCreateConfirmation?: (formData: A2UIFormData) => Promise<void> | void;
  onCancelCreateConfirmation?: () => void;
}

const CREATION_MODE_LABELS: Record<string, string> = {
  guided: "引导模式",
  fast: "快速模式",
  hybrid: "混合模式",
  framework: "框架模式",
};

const SOURCE_LABELS: Record<PendingCreateConfirmation["source"], string> = {
  project_created: "新项目已创建",
  open_project_for_writing: "准备开始创作",
  workspace_create_entry: "创作首页",
  workspace_prompt: "已接收你的提示",
  quick_create: "快捷创建",
};

function getPromptPreview(prompt?: string): string {
  const normalizedPrompt = prompt?.trim() || "";
  if (!normalizedPrompt) {
    return "";
  }
  if (normalizedPrompt.length <= 72) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, 72)}…`;
}

export function WorkbenchCreateEntryHome({
  projectName,
  pendingCreateConfirmation,
  createConfirmationResponse,
  onOpenCreateContentDialog,
  onSubmitCreateConfirmation,
  onCancelCreateConfirmation,
}: WorkbenchCreateEntryHomeProps) {
  const [isTaskExpanded, setIsTaskExpanded] = useState(
    Boolean(createConfirmationResponse),
  );
  const [confirmationFormData, setConfirmationFormData] = useState<A2UIFormData>(
    {},
  );

  useEffect(() => {
    setIsTaskExpanded(Boolean(createConfirmationResponse));
  }, [createConfirmationResponse]);

  useEffect(() => {
    setConfirmationFormData({});
  }, [createConfirmationResponse?.id]);

  const hasPendingTask = Boolean(createConfirmationResponse);
  const promptPreview = getPromptPreview(
    pendingCreateConfirmation?.initialUserPrompt,
  );
  const sourceLabel = pendingCreateConfirmation
    ? SOURCE_LABELS[pendingCreateConfirmation.source]
    : "创作首页";
  const creationModeLabel = pendingCreateConfirmation
    ? CREATION_MODE_LABELS[pendingCreateConfirmation.creationMode] ||
      pendingCreateConfirmation.creationMode
    : null;
  const selectedOptionRaw =
    confirmationFormData[CREATE_CONFIRMATION_FORM_FIELDS.option];
  const selectedOption = Array.isArray(selectedOptionRaw)
    ? selectedOptionRaw[0]
    : selectedOptionRaw;
  const noteValue = String(
    confirmationFormData[CREATE_CONFIRMATION_FORM_FIELDS.note] || "",
  ).trim();
  const canSubmitTask = Boolean(
    selectedOption &&
      (selectedOption !== "other" || noteValue.length >= 2),
  );
  const taskSummary = useMemo(() => {
    switch (selectedOption) {
      case "continue_history":
        return "继续已有内容";
      case "new_post":
        return "新写一篇内容";
      case "new_version":
        return "新建一个版本";
      case "other":
        return noteValue || "补充自定义说明";
      default:
        return "等待确认开始方式";
    }
  }, [noteValue, selectedOption]);

  return (
    <div
      className="relative flex-1 min-h-0 overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.92))]"
      data-testid="workspace-create-entry-home"
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:28px_28px] opacity-70" />

      <div className="relative flex h-full min-h-0 flex-col px-6 py-5">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
          <div className="rounded-[28px] border border-white/80 bg-background/92 p-6 shadow-[0_16px_50px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-blue-200 bg-blue-50 text-blue-700"
                  >
                    {sourceLabel}
                  </Badge>
                  {creationModeLabel ? (
                    <Badge
                      variant="secondary"
                      className="bg-slate-100 text-slate-700"
                    >
                      {creationModeLabel}
                    </Badge>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {projectName ? `${projectName} · 创作首页` : "创作首页"}
                  </h2>
                  <p className="max-w-xl text-sm leading-6 text-slate-500">
                    先进入创作工作区，再通过单步任务卡补充必要信息。
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button variant="outline" onClick={onOpenCreateContentDialog}>
                  发起创建确认
                </Button>
                {hasPendingTask ? (
                  <Button
                    variant="default"
                    onClick={() => setIsTaskExpanded((value) => !value)}
                    data-testid="workspace-create-confirmation-toggle"
                  >
                    {isTaskExpanded ? "收起任务" : "继续填写"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.7fr_0.9fr]">
              <div className="relative min-h-[420px] overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <FileText className="h-4 w-4 text-violet-600" />
                    新项目
                  </div>
                  <div className="text-xs text-slate-400">创作画布已就绪</div>
                </div>
                <div className="flex h-[calc(100%-57px)] flex-col justify-between bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] px-8 py-7">
                  <div className="space-y-3">
                    <div className="h-4 w-40 rounded-full bg-slate-100" />
                    <div className="h-4 w-56 rounded-full bg-slate-100" />
                    <div className="mt-8 text-4xl font-semibold tracking-tight text-slate-800">
                      {projectName || "新项目"}
                    </div>
                    <div className="max-w-xl text-sm leading-6 text-slate-500">
                      {hasPendingTask
                        ? "当前正在等待你确认开始方式。确认后，我会继续进入对应的创作流程。"
                        : "当前没有待处理任务。你可以直接发起一次创建确认，然后再继续创作。"}
                    </div>
                  </div>
                  {promptPreview ? (
                    <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/70 px-4 py-3 text-sm text-slate-700">
                      已识别提示：{promptPreview}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
                      这里先保留画布感，等你确认后再继续进入生成与编辑。
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <ListTodo className="h-4 w-4 text-blue-600" />
                  任务概览
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      状态
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {hasPendingTask ? "待补充信息" : "暂无待办"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {hasPendingTask
                        ? "任务卡支持收起，底部仍会保留状态条。"
                        : "发起创建确认后，这里会显示当前步骤。"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      当前步骤
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      01 · 选择开始方式
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {hasPendingTask
                        ? `当前选择：${taskSummary}`
                        : "确认后再进入生成或编辑。"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {hasPendingTask ? (
          <>
            {isTaskExpanded ? (
              <div className="absolute inset-0 bg-white/28 backdrop-blur-[1px]" />
            ) : null}
            {isTaskExpanded ? (
              <div className="absolute inset-x-0 bottom-28 flex justify-center px-4">
                <div
                  className={A2UI_TASK_CARD_TOKENS.workspaceOverlay}
                  data-testid="workspace-create-confirmation-card"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="text-[26px] font-semibold tracking-tight text-slate-900">
                        {WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET.title}
                      </div>
                      <div className="max-w-2xl text-sm leading-6 text-slate-600">
                        {WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET.subtitle}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <A2UITaskCardStatusBadge
                        label={WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET.statusLabel}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        title="收起补充信息"
                        onClick={() => setIsTaskExpanded(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <A2UITaskCardBody
                    className={A2UI_TASK_CARD_TOKENS.workspaceSection}
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-700 shadow-sm">
                          01
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            请选择一种开始方式
                          </div>
                          <div className="text-xs text-blue-600">单项选择</div>
                        </div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
                        当前选择：{taskSummary}
                      </div>
                    </div>

                    {promptPreview ? (
                      <div className="mb-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-slate-700">
                        已附带提示：{promptPreview}
                      </div>
                    ) : null}

                    {createConfirmationResponse && (
                      <A2UIRenderer
                        response={createConfirmationResponse}
                        className="space-y-4"
                        onFormStateChange={setConfirmationFormData}
                        submitDisabled={!canSubmitTask}
                        submitButtonClassName="w-full"
                        onSubmit={(formData) => {
                          void onSubmitCreateConfirmation?.(formData);
                        }}
                      />
                    )}
                  </A2UITaskCardBody>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      切换项目或返回其他视图后，这个任务仍可稍后继续。
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setIsTaskExpanded(false)}
                      >
                        稍后处理
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={onCancelCreateConfirmation}
                      >
                        取消任务
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
              <button
                type="button"
                className={A2UI_TASK_CARD_TOKENS.workspaceDock}
                onClick={() => setIsTaskExpanded((value) => !value)}
                data-testid="workspace-create-confirmation-dock"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-600">
                    <Sparkles className="h-4 w-4" />
                    正在准备创作
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-700">{WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET.statusLabel}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {isTaskExpanded
                      ? `当前步骤：${taskSummary || "等待确认开始方式"}`
                      : `点击展开补充信息 · ${taskSummary || "等待确认开始方式"}`}
                  </div>
                </div>
                <div className="shrink-0 rounded-full border border-slate-200 p-2 text-slate-500">
                  {isTaskExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </div>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default WorkbenchCreateEntryHome;
