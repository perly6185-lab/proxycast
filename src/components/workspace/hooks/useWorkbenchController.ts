import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  type ProjectType,
  getProjectTypeLabel,
  updateContent,
} from "@/lib/api/project";
import type {
  Page,
  PageParams,
  WorkspaceTheme,
  WorkspaceViewMode,
} from "@/types/page";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { getThemeModule } from "@/features/themes";
import type {
  NovelQuickCreateOptions,
  NovelQuickCreateResult,
  OpenProjectWritingOptions,
} from "@/features/themes/types";
import type { CreationMode } from "@/components/content-creator/types";
import type { WorkflowProgressSnapshot } from "@/components/agent/chat";
import { useCreationDialogs } from "@/components/workspace/hooks/useCreationDialogs";
import { useWorkbenchNavigation } from "@/components/workspace/hooks/useWorkbenchNavigation";
import { useWorkbenchPanelRenderer } from "@/components/workspace/hooks/useWorkbenchPanelRenderer";
import { useWorkbenchProjectData } from "@/components/workspace/hooks/useWorkbenchProjectData";
import { useWorkbenchQuickActions } from "@/components/workspace/hooks/useWorkbenchQuickActions";

export const DEFAULT_CREATION_MODE: CreationMode = "guided";
export const MIN_CREATION_INTENT_LENGTH = 10;

export const CREATION_MODE_OPTIONS: Array<{
  value: CreationMode;
  label: string;
  description: string;
}> = [
  {
    value: "guided",
    label: "引导模式",
    description: "AI 分步骤提问引导，适合精细创作",
  },
  {
    value: "fast",
    label: "快速模式",
    description: "AI 先生成初稿，适合快速起稿",
  },
  {
    value: "hybrid",
    label: "混合模式",
    description: "AI 与你协作，平衡质量和效率",
  },
  {
    value: "framework",
    label: "框架模式",
    description: "你定结构，AI 按框架补全内容",
  },
];

export function getWorkflowStepStatusLabel(
  status: WorkflowProgressSnapshot["steps"][number]["status"],
): string {
  switch (status) {
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "skipped":
      return "已跳过";
    case "error":
      return "异常";
    default:
      return "待开始";
  }
}

export interface UseWorkbenchControllerParams {
  onNavigate?: (page: Page, params?: PageParams) => void;
  initialProjectId?: string;
  initialContentId?: string;
  theme: WorkspaceTheme;
  initialViewMode?: WorkspaceViewMode;
  resetAt?: number;
}

interface UseWorkbenchBootstrapParams {
  applyInitialNavigationState: (
    initialViewMode: WorkspaceViewMode | undefined,
    initialContentId: string | undefined,
  ) => void;
  clearContentsSelection: () => void;
  initialContentId?: string;
  initialProjectId?: string;
  initialViewMode?: WorkspaceViewMode;
  loadProjects: () => Promise<void>;
  resetProjectAndContentQueries: () => void;
  resetAt?: number;
  setSelectedContentId: (contentId: string | null) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  theme: WorkspaceTheme;
}

function useWorkbenchBootstrap({
  applyInitialNavigationState,
  clearContentsSelection,
  initialContentId,
  initialProjectId,
  initialViewMode,
  loadProjects,
  resetProjectAndContentQueries,
  resetAt,
  setSelectedContentId,
  setSelectedProjectId,
  theme,
}: UseWorkbenchBootstrapParams): void {
  useEffect(() => {
    resetProjectAndContentQueries();
    setSelectedProjectId(initialProjectId ?? null);
    setSelectedContentId(initialContentId ?? null);
    applyInitialNavigationState(initialViewMode, initialContentId);
    clearContentsSelection();
    void loadProjects();
  }, [
    applyInitialNavigationState,
    clearContentsSelection,
    initialContentId,
    initialProjectId,
    initialViewMode,
    loadProjects,
    resetProjectAndContentQueries,
    resetAt,
    setSelectedContentId,
    setSelectedProjectId,
    theme,
  ]);
}

interface UseSelectedProjectContentsLoaderParams {
  clearContentsSelection: () => void;
  loadContents: (projectId: string) => Promise<void>;
  projects: Array<unknown>;
  selectedProjectId: string | null;
}

function useSelectedProjectContentsLoader({
  clearContentsSelection,
  loadContents,
  projects,
  selectedProjectId,
}: UseSelectedProjectContentsLoaderParams): void {
  useEffect(() => {
    if (!selectedProjectId) {
      clearContentsSelection();
      return;
    }
    void loadContents(selectedProjectId);
  }, [clearContentsSelection, loadContents, selectedProjectId, projects]);
}

function useSidebarToggleHotkey(toggleLeftSidebar: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "b") {
        event.preventDefault();
        toggleLeftSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleLeftSidebar]);
}

export function useWorkbenchController({
  onNavigate,
  initialProjectId,
  initialContentId,
  theme,
  initialViewMode,
  resetAt,
}: UseWorkbenchControllerParams) {
  const { leftSidebarCollapsed, toggleLeftSidebar, setLeftSidebarCollapsed } =
    useWorkbenchStore();
  const themeModule = useMemo(() => getThemeModule(theme), [theme]);
  const PrimaryWorkspaceRenderer =
    themeModule.primaryWorkspaceRenderer ?? themeModule.workspaceRenderer;
  const panelRenderers = themeModule.panelRenderers;
  const isAgentChatWorkspace =
    themeModule.capabilities.workspaceKind === "agent-chat";

  const {
    projects,
    projectsLoading,
    selectedProjectId,
    setSelectedProjectId,
    contents,
    contentsLoading,
    selectedContentId,
    setSelectedContentId,
    projectQuery,
    setProjectQuery,
    contentQuery,
    setContentQuery,
    selectedProject,
    filteredProjects,
    filteredContents,
    loadProjects,
    loadContents,
    resetProjectAndContentQueries,
    clearContentsSelection,
  } = useWorkbenchProjectData({
    theme,
    initialProjectId,
    initialContentId,
  });

  const {
    activeRightDrawer,
    setActiveRightDrawer,
    showChatPanel,
    setShowChatPanel,
    workflowProgress,
    setWorkflowProgress,
    showWorkflowRail,
    setShowWorkflowRail,
    workspaceMode,
    setWorkspaceMode,
    activeWorkspaceView,
    setActiveWorkspaceView,
    shouldRenderLeftSidebar,
    isCreateWorkspaceView,
    shouldRenderWorkspaceRightRail,
    activeWorkspaceViewLabel,
    hasWorkflowWorkspaceView,
    hasPublishWorkspaceView,
    hasSettingsWorkspaceView,
    applyInitialNavigationState,
    handleOpenWorkflowView,
    handleBackToProjectManagement,
    handleEnterWorkspaceView,
    handleSwitchWorkspaceView,
  } = useWorkbenchNavigation({
    initialViewMode,
    initialContentId,
    defaultWorkspaceView: themeModule.navigation.defaultView,
    navigationItems: themeModule.navigation.items,
    leftSidebarCollapsed,
    setLeftSidebarCollapsed,
    isAgentChatWorkspace,
    hasPrimaryWorkspaceRenderer: Boolean(PrimaryWorkspaceRenderer),
  });

  const handleEnterWorkspace = useCallback(
    (
      contentId: string,
      options?: {
        showChatPanel?: boolean;
      },
    ) => {
      setSelectedContentId(contentId);
      setWorkspaceMode("workspace");
      setActiveWorkspaceView("create");
      setShowChatPanel(options?.showChatPanel ?? true);
      setActiveRightDrawer(null);
      setLeftSidebarCollapsed(true);
    },
    [
      setActiveRightDrawer,
      setActiveWorkspaceView,
      setLeftSidebarCollapsed,
      setSelectedContentId,
      setShowChatPanel,
      setWorkspaceMode,
    ],
  );

  const handleSelectProjectAndEnterWorkspace = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      setContentQuery("");
      setWorkspaceMode("workspace");
      setActiveWorkspaceView(themeModule.navigation.defaultView);
      setActiveRightDrawer(null);
      setLeftSidebarCollapsed(true);
    },
    [
      setActiveRightDrawer,
      setActiveWorkspaceView,
      setContentQuery,
      setLeftSidebarCollapsed,
      setSelectedProjectId,
      setWorkspaceMode,
      themeModule.navigation.defaultView,
    ],
  );

  const {
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createContentDialogOpen,
    setCreateContentDialogOpen,
    createContentDialogStep,
    setCreateContentDialogStep,
    newProjectName,
    setNewProjectName,
    workspaceProjectsRoot,
    creatingProject,
    creatingContent,
    selectedCreationMode,
    setSelectedCreationMode,
    creationIntentValues,
    creationIntentError,
    setCreationIntentError,
    currentCreationIntentFields,
    currentIntentLength,
    pendingInitialPromptsByContentId,
    contentCreationModes,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    resetCreateContentDialogState,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    handleOpenCreateContentDialog,
    handleCreationIntentValueChange,
    handleGoToIntentStep,
    handleCreateContent,
    handleQuickCreateProjectAndContent,
    handleOpenProjectForWriting,
    consumePendingInitialPrompt,
  } = useCreationDialogs({
    theme,
    selectedProjectId,
    selectedContentId,
    loadProjects,
    loadContents,
    onEnterWorkspace: handleEnterWorkspace,
    onProjectCreated: (projectId) => {
      setSelectedProjectId(projectId);
      setProjectQuery("");
    },
    defaultCreationMode: DEFAULT_CREATION_MODE,
    minCreationIntentLength: MIN_CREATION_INTENT_LENGTH,
  });

  const handleQuickCreateNovelEntry = useCallback(
    async (options: NovelQuickCreateOptions): Promise<NovelQuickCreateResult> => {
      return handleQuickCreateProjectAndContent({
        projectName: options.projectName,
        workspaceType: "novel",
        contentTitle: options.contentTitle,
        initialUserPrompt: options.initialUserPrompt,
        creationMode: options.creationMode ?? DEFAULT_CREATION_MODE,
      });
    },
    [handleQuickCreateProjectAndContent],
  );

  const handleOpenProjectWriting = useCallback(
    async (
      projectId: string,
      options?: OpenProjectWritingOptions,
    ): Promise<string> => {
      return handleOpenProjectForWriting(projectId, {
        fallbackContentTitle: options?.fallbackContentTitle,
        initialUserPrompt: options?.initialUserPrompt,
        creationMode: options?.creationMode ?? DEFAULT_CREATION_MODE,
      });
    },
    [handleOpenProjectForWriting],
  );

  const handleQuickSaveCurrent = useCallback(async () => {
    if (!selectedContentId || !selectedProjectId) {
      return;
    }

    try {
      await updateContent(selectedContentId, {
        metadata: {
          saved_from: "theme-workspace",
          saved_at: Date.now(),
        },
      });
      toast.success("已保存当前文稿");
      await loadContents(selectedProjectId);
    } catch (error) {
      console.error("保存失败:", error);
      toast.error("保存失败");
    }
  }, [loadContents, selectedContentId, selectedProjectId]);

  useWorkbenchBootstrap({
    applyInitialNavigationState,
    clearContentsSelection,
    initialContentId,
    initialProjectId,
    initialViewMode,
    loadProjects,
    resetProjectAndContentQueries,
    resetAt,
    setSelectedContentId,
    setSelectedProjectId,
    theme,
  });
  useSelectedProjectContentsLoader({
    clearContentsSelection,
    loadContents,
    projects,
    selectedProjectId,
  });

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  const handleOpenCreateHome = useCallback(() => {
    setWorkspaceMode("workspace");
    setActiveWorkspaceView("create");
    setSelectedContentId(null);
    setShowChatPanel(true);
    setActiveRightDrawer(null);
    setShowWorkflowRail(false);
  }, [
    setActiveRightDrawer,
    setActiveWorkspaceView,
    setSelectedContentId,
    setShowChatPanel,
    setShowWorkflowRail,
    setWorkspaceMode,
  ]);

  useSidebarToggleHotkey(toggleLeftSidebar);

  const currentContentTitle = selectedContentId
    ? contents.find((item) => item.id === selectedContentId)?.title || "已选文稿"
    : null;

  const { activePanelRenderer } = useWorkbenchPanelRenderer({
    activeWorkspaceView,
    panelRenderers,
  });

  const { nonCreateQuickActions } = useWorkbenchQuickActions({
    workspaceMode,
    activeWorkspaceView,
    hasWorkflowWorkspaceView,
    hasPublishWorkspaceView,
    hasSettingsWorkspaceView,
    selectedContentId,
    onSwitchWorkspaceView: handleSwitchWorkspaceView,
    onQuickSaveCurrent: handleQuickSaveCurrent,
  });

  const ActivePanelRenderer = activePanelRenderer;
  const projectTypeLabel = getProjectTypeLabel(theme as ProjectType);

  return {
    themeModule,
    leftSidebarCollapsed,
    toggleLeftSidebar,

    activeRightDrawer,
    setActiveRightDrawer,
    showChatPanel,
    setShowChatPanel,
    workflowProgress,
    setWorkflowProgress,
    showWorkflowRail,
    setShowWorkflowRail,

    workspaceMode,
    activeWorkspaceView,
    setCreateProjectDialogOpen,
    setCreateContentDialogOpen,
    setCreateContentDialogStep,
    setCreationIntentError,
    setNewProjectName,
    setSelectedCreationMode,
    setProjectQuery,
    setContentQuery,

    selectedProject,
    selectedProjectId,
    selectedContentId,
    projectsLoading,
    contentsLoading,
    filteredProjects,
    filteredContents,
    projectQuery,
    contentQuery,
    createProjectDialogOpen,
    createContentDialogOpen,
    createContentDialogStep,
    newProjectName,
    workspaceProjectsRoot,
    creatingProject,
    creatingContent,
    selectedCreationMode,
    creationIntentValues,
    creationIntentError,
    currentCreationIntentFields,
    currentIntentLength,
    pendingInitialPromptsByContentId,
    contentCreationModes,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    projectTypeLabel,

    shouldRenderLeftSidebar,
    isCreateWorkspaceView,
    shouldRenderWorkspaceRightRail,
    activeWorkspaceViewLabel,
    hasWorkflowWorkspaceView,
    currentContentTitle,
    nonCreateQuickActions,
    ActivePanelRenderer,
    PrimaryWorkspaceRenderer,

    handleEnterWorkspace,
    handleSelectProjectAndEnterWorkspace,
    handleOpenWorkflowView,
    loadProjects,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    resetCreateContentDialogState,
    handleOpenCreateContentDialog,
    handleCreationIntentValueChange,
    handleGoToIntentStep,
    handleCreateContent,
    handleQuickCreateNovelEntry,
    handleOpenProjectWriting,
    consumePendingInitialPrompt,
    handleQuickSaveCurrent,
    handleBackHome,
    handleOpenCreateHome,
    handleBackToProjectManagement,
    handleEnterWorkspaceView,
    handleSwitchWorkspaceView,

    selectedProjectForContentActions: Boolean(selectedProjectId),
  };
}

export default useWorkbenchController;
