/**
 * @file WorkbenchPage.tsx
 * @description 主题工作台页面，按主题管理项目并复用 Agent 对话与画布
 * @module components/workspace/WorkbenchPage
 */

import type { ProjectType } from "@/lib/api/project";
import type {
  Page,
  PageParams,
  WorkspaceTheme,
  WorkspaceViewMode,
} from "@/types/page";
import { WorkspaceShell, WorkspaceTopbar } from "@/components/workspace/shell";
import {
  WorkbenchCreateContentDialog,
  WorkbenchCreateContentDialogBoundary,
  WorkbenchCreateProjectDialog,
} from "@/components/workspace/dialogs";
import {
  WorkbenchLeftSidebar,
  WorkbenchMainContent,
  WorkbenchRightRail,
} from "@/components/workspace/panels";
import {
  CREATION_MODE_OPTIONS,
  MIN_CREATION_INTENT_LENGTH,
  getWorkflowStepStatusLabel,
  useWorkbenchController,
} from "@/components/workspace/hooks/useWorkbenchController";

export interface WorkbenchPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  contentId?: string;
  theme: WorkspaceTheme;
  viewMode?: WorkspaceViewMode;
  resetAt?: number;
}

export function WorkbenchPage({
  onNavigate,
  projectId: initialProjectId,
  contentId: initialContentId,
  theme,
  viewMode: initialViewMode,
  resetAt,
}: WorkbenchPageProps) {
  const {
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
    selectedProjectForContentActions,
  } = useWorkbenchController({
    onNavigate,
    initialProjectId,
    initialContentId,
    theme,
    initialViewMode,
    resetAt,
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <WorkspaceShell
        header={
          <WorkspaceTopbar
            theme={theme as ProjectType}
            projectName={selectedProject?.name}
            navigationItems={
              workspaceMode === "workspace" ? themeModule.navigation.items : []
            }
            activeView={activeWorkspaceView}
            onViewChange={handleSwitchWorkspaceView}
            onBackHome={handleBackHome}
            onOpenCreateHome={handleOpenCreateHome}
            onBackToProjectManagement={handleBackToProjectManagement}
            showBackToProjectManagement={workspaceMode === "workspace"}
          />
        }
        leftSidebar={
          <WorkbenchLeftSidebar
            shouldRender={shouldRenderLeftSidebar}
            leftSidebarCollapsed={leftSidebarCollapsed}
            theme={theme as ProjectType}
            projectsLoading={projectsLoading}
            filteredProjects={filteredProjects}
            selectedProjectId={selectedProjectId}
            projectQuery={projectQuery}
            onProjectQueryChange={setProjectQuery}
            onReloadProjects={() => {
              void loadProjects();
            }}
            onOpenCreateProjectDialog={handleOpenCreateProjectDialog}
            onToggleLeftSidebar={toggleLeftSidebar}
            onSelectProject={handleSelectProjectAndEnterWorkspace}
            isCreateWorkspaceView={isCreateWorkspaceView}
            selectedContentId={selectedContentId}
            currentContentTitle={currentContentTitle}
            activeWorkspaceViewLabel={activeWorkspaceViewLabel}
            selectedProjectForContentActions={selectedProjectForContentActions}
            onOpenCreateContentDialog={handleOpenCreateContentDialog}
            contentQuery={contentQuery}
            onContentQueryChange={setContentQuery}
            contentsLoading={contentsLoading}
            filteredContents={filteredContents}
            onSelectContent={handleEnterWorkspace}
            onBackToCreateView={() => handleSwitchWorkspaceView("create")}
            onOpenCreateHome={handleOpenCreateHome}
          />
        }
        main={
          <WorkbenchMainContent
            workspaceMode={workspaceMode}
            selectedProjectId={selectedProjectId}
            selectedProject={selectedProject}
            navigationItems={themeModule.navigation.items}
            workspaceNotice={themeModule.capabilities.workspaceNotice}
            onOpenCreateProjectDialog={handleOpenCreateProjectDialog}
            onOpenCreateContentDialog={handleOpenCreateContentDialog}
            onEnterWorkspaceView={handleEnterWorkspaceView}
            onQuickCreateNovelEntry={handleQuickCreateNovelEntry}
            onOpenProjectWriting={handleOpenProjectWriting}
            activeWorkspaceView={activeWorkspaceView}
            primaryWorkspaceRenderer={PrimaryWorkspaceRenderer}
            selectedContentId={selectedContentId}
            resetAt={resetAt}
            onBackHome={handleBackHome}
            onOpenWorkflowView={handleOpenWorkflowView}
            onNavigate={onNavigate}
            theme={theme}
            pendingInitialPromptsByContentId={pendingInitialPromptsByContentId}
            onConsumePendingInitialPrompt={consumePendingInitialPrompt}
            contentCreationModes={contentCreationModes}
            showChatPanel={showChatPanel}
            onWorkflowProgressChange={setWorkflowProgress}
            activePanelRenderer={ActivePanelRenderer}
          />
        }
        rightRail={
          <WorkbenchRightRail
            shouldRender={shouldRenderWorkspaceRightRail}
            isCreateWorkspaceView={isCreateWorkspaceView}
            activeRightDrawer={activeRightDrawer}
            showChatPanel={showChatPanel}
            onToggleChatPanel={() => setShowChatPanel((visible) => !visible)}
            onToggleToolsDrawer={() =>
              setActiveRightDrawer((previous) =>
                previous === "tools" ? null : "tools",
              )
            }
            onCloseToolsDrawer={() => setActiveRightDrawer(null)}
            workflowProgress={workflowProgress}
            showWorkflowRail={showWorkflowRail}
            onToggleWorkflowRail={() => setShowWorkflowRail((previous) => !previous)}
            onQuickSaveCurrent={() => {
              void handleQuickSaveCurrent();
            }}
            selectedContentId={selectedContentId}
            onOpenWorkflowView={handleOpenWorkflowView}
            selectedProjectId={selectedProjectId}
            hasWorkflowWorkspaceView={hasWorkflowWorkspaceView}
            activeWorkspaceViewLabel={activeWorkspaceViewLabel}
            currentContentTitle={currentContentTitle}
            nonCreateQuickActions={nonCreateQuickActions}
            onBackToCreateView={() => handleSwitchWorkspaceView("create")}
            getWorkflowStepStatusLabel={getWorkflowStepStatusLabel}
          />
        }
      />

      <WorkbenchCreateProjectDialog
        open={createProjectDialogOpen}
        creatingProject={creatingProject}
        newProjectName={newProjectName}
        projectTypeLabel={projectTypeLabel}
        workspaceProjectsRoot={workspaceProjectsRoot}
        resolvedProjectPath={resolvedProjectPath}
        pathChecking={pathChecking}
        pathConflictMessage={pathConflictMessage}
        onOpenChange={(open) => {
          if (!creatingProject) {
            setCreateProjectDialogOpen(open);
          }
        }}
        onProjectNameChange={setNewProjectName}
        onCreateProject={() => {
          void handleCreateProject();
        }}
      />

      <WorkbenchCreateContentDialogBoundary
        open={createContentDialogOpen}
        step={createContentDialogStep}
        mode={selectedCreationMode}
      >
        <WorkbenchCreateContentDialog
          open={createContentDialogOpen}
          creatingContent={creatingContent}
          step={createContentDialogStep}
          selectedProjectId={selectedProjectId}
          creationModeOptions={CREATION_MODE_OPTIONS}
          selectedCreationMode={selectedCreationMode}
          onCreationModeChange={setSelectedCreationMode}
          currentCreationIntentFields={currentCreationIntentFields}
          creationIntentValues={creationIntentValues}
          onCreationIntentValueChange={handleCreationIntentValueChange}
          currentIntentLength={currentIntentLength}
          minCreationIntentLength={MIN_CREATION_INTENT_LENGTH}
          creationIntentError={creationIntentError}
          onOpenChange={(open) => {
            if (!creatingContent) {
              setCreateContentDialogOpen(open);
              if (!open) {
                resetCreateContentDialogState();
              }
            }
          }}
          onBackOrCancel={() => {
            if (createContentDialogStep === "intent") {
              setCreateContentDialogStep("mode");
              setCreationIntentError("");
              return;
            }
            setCreateContentDialogOpen(false);
            resetCreateContentDialogState();
          }}
          onGoToIntentStep={handleGoToIntentStep}
          onCreateContent={() => {
            void handleCreateContent();
          }}
        />
      </WorkbenchCreateContentDialogBoundary>
    </div>
  );
}

export default WorkbenchPage;
