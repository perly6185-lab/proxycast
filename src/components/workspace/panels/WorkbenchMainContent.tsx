import type { ComponentType } from "react";
import { FolderOpen, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Page, PageParams, WorkspaceTheme, WorkspaceViewMode } from "@/types/page";
import type {
  NovelQuickCreateOptions,
  NovelQuickCreateResult,
  OpenProjectWritingOptions,
  ThemeWorkspaceNotice,
  ThemeWorkspaceNavigationItem,
  ThemeWorkspaceRendererProps,
  ThemeWorkspaceView,
} from "@/features/themes/types";
import type { Project } from "@/lib/api/project";
import { AgentChatPage } from "@/components/agent";
import type { WorkflowProgressSnapshot } from "@/components/agent/chat";
import type { CreationMode } from "@/components/content-creator/types";

type ThemeWorkspaceRenderer = ComponentType<ThemeWorkspaceRendererProps> | null | undefined;

export interface WorkbenchMainContentProps {
  workspaceMode: WorkspaceViewMode;
  selectedProjectId: string | null;
  selectedProject: Project | null;
  navigationItems: ThemeWorkspaceNavigationItem[];
  workspaceNotice?: ThemeWorkspaceNotice;
  onOpenCreateProjectDialog: () => void;
  onOpenCreateContentDialog: () => void;
  onEnterWorkspaceView: (view: ThemeWorkspaceView) => void;
  onQuickCreateNovelEntry?: (
    options: NovelQuickCreateOptions,
  ) => Promise<NovelQuickCreateResult>;
  onOpenProjectWriting?: (
    projectId: string,
    options?: OpenProjectWritingOptions,
  ) => Promise<string>;
  activeWorkspaceView: ThemeWorkspaceView;
  primaryWorkspaceRenderer?: ThemeWorkspaceRenderer;
  selectedContentId: string | null;
  resetAt?: number;
  onBackHome?: () => void;
  onOpenWorkflowView: () => void;
  onNavigate?: (page: Page, params?: PageParams) => void;
  theme: WorkspaceTheme;
  pendingInitialPromptsByContentId: Record<string, string>;
  onConsumePendingInitialPrompt: (contentId: string) => void;
  contentCreationModes: Record<string, CreationMode>;
  showChatPanel: boolean;
  onWorkflowProgressChange: (progress: WorkflowProgressSnapshot | null) => void;
  activePanelRenderer?: ThemeWorkspaceRenderer;
}

export function WorkbenchMainContent({
  workspaceMode,
  selectedProjectId,
  selectedProject,
  navigationItems,
  workspaceNotice,
  onOpenCreateProjectDialog,
  onOpenCreateContentDialog,
  onEnterWorkspaceView,
  onQuickCreateNovelEntry,
  onOpenProjectWriting,
  activeWorkspaceView,
  primaryWorkspaceRenderer: PrimaryWorkspaceRenderer,
  selectedContentId,
  resetAt,
  onBackHome,
  onOpenWorkflowView,
  onNavigate,
  theme,
  pendingInitialPromptsByContentId,
  onConsumePendingInitialPrompt,
  contentCreationModes,
  showChatPanel,
  onWorkflowProgressChange,
  activePanelRenderer: ActivePanelRenderer,
}: WorkbenchMainContentProps) {
  if (workspaceMode === "project-management") {
    return (
      <div className="h-full min-h-0 p-4">
        <div className="h-full rounded-lg border bg-card p-4 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">统一创作工作区</h2>
              <p className="text-sm text-muted-foreground mt-1">
                左侧选择项目后，可直接进入创作、流程、发布与设置
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onOpenCreateProjectDialog}>
                <FolderOpen className="h-4 w-4 mr-1" />
                新建项目
              </Button>
              <Button
                variant="outline"
                onClick={onOpenCreateContentDialog}
                disabled={!selectedProjectId}
              >
                <Plus className="h-4 w-4 mr-1" />
                新建文稿
              </Button>
            </div>
          </div>

          {!selectedProjectId ? (
            <div className="flex-1 rounded-md border border-dashed flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Sparkles className="h-8 w-8 opacity-60" />
              <p className="text-sm">请先在左侧选择项目</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                当前项目：{selectedProject?.name}
              </div>
              <div className="flex flex-wrap gap-2">
                {navigationItems.map((item) => (
                  <Button
                    key={item.key}
                    variant="outline"
                    onClick={() => onEnterWorkspaceView(item.key)}
                  >
                    进入{item.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 如果有 PrimaryWorkspaceRenderer 且在 create 视图，优先渲染自定义首页
  const isNovelHomeRenderer =
    Boolean(onQuickCreateNovelEntry) || Boolean(onOpenProjectWriting);
  const shouldRenderPrimaryWorkspace =
    activeWorkspaceView === "create" &&
    PrimaryWorkspaceRenderer &&
    (!isNovelHomeRenderer || !selectedContentId);

  if (shouldRenderPrimaryWorkspace) {
    return (
      <PrimaryWorkspaceRenderer
        projectId={selectedProjectId}
        projectName={selectedProject?.name}
        workspaceType={selectedProject?.workspaceType}
        resetAt={resetAt}
        onBackHome={onBackHome}
        onOpenCreateProjectDialog={onOpenCreateProjectDialog}
        onProjectSelect={(projectId) => {
          // 通过导航更新 URL 参数来选中项目
          if (onNavigate) {
            const url = new URL(window.location.href);
            url.searchParams.set("projectId", projectId);
            onNavigate(theme as any, Object.fromEntries(url.searchParams));
          }
        }}
        onQuickCreateNovelEntry={onQuickCreateNovelEntry}
        onOpenProjectWriting={onOpenProjectWriting}
      />
    );
  }

  if (!selectedProjectId) {
    return (
      <div className="h-full rounded-lg border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground m-4">
        <Sparkles className="h-8 w-8 opacity-60" />
        <p className="text-sm">请先在左侧选择项目</p>
      </div>
    );
  }

  if (activeWorkspaceView === "create" && !selectedContentId) {
    return (
      <div className="h-full rounded-lg border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground m-4">
        <Sparkles className="h-8 w-8 opacity-60" />
        <p className="text-sm">请先在左侧选择文稿后进入创作</p>
        <Button
          variant="outline"
          onClick={onOpenCreateContentDialog}
          disabled={!selectedProjectId}
        >
          <Plus className="h-4 w-4 mr-1" />
          新建文稿
        </Button>
      </div>
    );
  }

  if (activeWorkspaceView === "create") {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {workspaceNotice && (
          <div className="border-b px-3 py-2 bg-muted/20 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">{workspaceNotice.message}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenWorkflowView}
              disabled={!selectedProjectId}
            >
              {workspaceNotice.actionLabel || "打开流程视图"}
            </Button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <AgentChatPage
            key={`${selectedProjectId || ""}:${selectedContentId || ""}:${theme || ""}:workspace`}
            onNavigate={onNavigate}
            projectId={selectedProjectId ?? undefined}
            contentId={selectedContentId ?? undefined}
            theme={theme}
            initialUserPrompt={
              selectedContentId
                ? pendingInitialPromptsByContentId[selectedContentId]
                : undefined
            }
            onInitialUserPromptConsumed={() => {
              if (!selectedContentId) {
                return;
              }
              onConsumePendingInitialPrompt(selectedContentId);
            }}
            initialCreationMode={
              (selectedContentId && contentCreationModes[selectedContentId]) || undefined
            }
            lockTheme={true}
            hideHistoryToggle={true}
            hideTopBar={true}
            showChatPanel={showChatPanel}
            hideInlineStepProgress={true}
            onWorkflowProgressChange={onWorkflowProgressChange}
          />
        </div>
      </div>
    );
  }

  if (ActivePanelRenderer) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ActivePanelRenderer
          projectId={selectedProjectId}
          projectName={selectedProject?.name}
          workspaceType={selectedProject?.workspaceType}
          resetAt={resetAt}
          onBackHome={onBackHome}
        />
      </div>
    );
  }

  return (
    <div className="h-full rounded-lg border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground m-4">
      <Sparkles className="h-8 w-8 opacity-60" />
      <p className="text-sm">当前视图暂未配置</p>
    </div>
  );
}

export default WorkbenchMainContent;
