/**
 * 应用主入口组件
 *
 * 管理页面路由和全局状态
 * 支持静态页面和动态插件页面路由
 * 包含启动画面和全局图标侧边栏
 *
 * _需求: 2.2, 3.2, 5.2_
 */

import React, { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { withI18nPatch } from "./i18n/withI18nPatch";
import { SplashScreen } from "./components/SplashScreen";
import { AppSidebar } from "./components/AppSidebar";
import { SettingsPageV2 } from "./components/settings-v2";
import { ToolsPage } from "./components/tools/ToolsPage";
import { ResourcesPage } from "./components/resources";
import { MemoryPage } from "./components/memory";
import { AgentChatPage } from "./components/agent";
import { PluginsPage } from "./components/plugins/PluginsPage";
import { ImageGenPage } from "./components/image-gen";
import { BatchPage } from "./components/batch";
import { RecentImageInsertFloating } from "./components/image-gen/RecentImageInsertFloating";
import { CreateProjectDialog } from "./components/projects/CreateProjectDialog";
import { WorkbenchPage } from "./components/workspace";
import {
  ProjectType,
  createProject,
  createContent,
  isUserProjectType,
  resolveProjectRootPath,
} from "./lib/api/project";
import {
  TerminalWorkspace,
  SysinfoView,
  FileBrowserView,
  WebView,
} from "./components/terminal";
import { OnboardingWizard, useOnboardingState } from "./components/onboarding";
import { ConnectConfirmDialog } from "./components/connect";
import { showRegistryLoadError } from "./lib/utils/connectError";
import { useDeepLink } from "./hooks/useDeepLink";
import { useRelayRegistry } from "./hooks/useRelayRegistry";
import { ComponentDebugProvider } from "./contexts/ComponentDebugContext";
import { SoundProvider } from "./contexts/SoundProvider";
import { ComponentDebugOverlay } from "./components/dev";
import {
  AgentPageParams,
  getThemeByWorkspacePage,
  getThemeWorkspacePage,
  isThemeWorkspacePage,
  LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
  Page,
  PageParams,
  ProjectDetailPageParams,
  SettingsPageParams,
  ThemeWorkspacePage,
  WorkspaceTheme,
} from "./types/page";
import { SettingsTabs } from "./types/settings";
import { toast } from "sonner";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";

const AppContainer = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: hsl(var(--background));
  overflow: hidden;
`;

const MainContent = styled.main<{ $withSidebarGap?: boolean }>`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: ${(props) => (props.$withSidebarGap ? "10px" : "0")};
`;

const PageWrapper = styled.div<{ $isActive: boolean }>`
  flex: 1;
  padding: 24px;
  overflow: auto;
  display: ${(props) => (props.$isActive ? "block" : "none")};
`;

const FullscreenWrapper = styled.div<{ $isActive: boolean }>`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: ${(props) => (props.$isActive ? "flex" : "none")};
  flex-direction: column;
  position: relative;
`;

const THEME_WORKSPACE_PAGES: ThemeWorkspacePage[] = [
  "workspace-general",
  "workspace-social-media",
  "workspace-poster",
  "workspace-music",
  "workspace-knowledge",
  "workspace-planning",
  "workspace-document",
  "workspace-video",
  "workspace-novel",
];

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>("agent");
  const [pageParams, setPageParams] = useState<PageParams>({});
  const [agentHasMessages, setAgentHasMessages] = useState(false);
  const { needsOnboarding, completeOnboarding } = useOnboardingState();

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] = useState<{
    shortLabel: string;
    fullPrompt: string;
    projectType: ProjectType;
    projectName: string;
  } | null>(null);

  const resolveWorkspacePage = useCallback(
    (workspaceTheme?: WorkspaceTheme): ThemeWorkspacePage => {
      if (workspaceTheme) {
        return getThemeWorkspacePage(workspaceTheme);
      }

      if (typeof window !== "undefined") {
        const savedPage = localStorage.getItem(
          LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
        );

        if (
          savedPage &&
          THEME_WORKSPACE_PAGES.includes(savedPage as ThemeWorkspacePage)
        ) {
          return savedPage as ThemeWorkspacePage;
        }
      }

      return getThemeWorkspacePage("general");
    },
    [],
  );

  const handleNavigate = useCallback(
    (page: Page, params?: PageParams) => {
      if (page === "workspace") {
        setCurrentPage("agent");
        setPageParams(
          (params as AgentPageParams | undefined) || {
            theme: "general",
            lockTheme: false,
          },
        );
        return;
      }

      if (page === "api-server") {
        setCurrentPage("settings");
        setPageParams({ tab: SettingsTabs.ApiServer } as SettingsPageParams);
        return;
      }

      if (page === "provider-pool") {
        setCurrentPage("settings");
        setPageParams({ tab: SettingsTabs.Providers } as SettingsPageParams);
        return;
      }

      if (page === "mcp") {
        setCurrentPage("settings");
        setPageParams({ tab: SettingsTabs.McpServer } as SettingsPageParams);
        return;
      }

      if (page === "projects") {
        const projectParams = params as
          | {
              projectId?: string;
              workspaceTheme?: WorkspaceTheme;
            }
          | undefined;
        const targetWorkspacePage = resolveWorkspacePage(
          projectParams?.workspaceTheme,
        );

        if (typeof window !== "undefined") {
          localStorage.setItem(
            LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
            targetWorkspacePage,
          );
        }

        setCurrentPage(targetWorkspacePage);
        setPageParams({
          ...(projectParams?.projectId
            ? { projectId: projectParams.projectId }
            : {}),
          workspaceViewMode: "project-management",
        });
        return;
      }

      if (page === "project-detail") {
        const projectParams = params as ProjectDetailPageParams | undefined;
        const targetWorkspacePage = resolveWorkspacePage(
          projectParams?.workspaceTheme,
        );
        const workspaceViewMode = projectParams?.projectId
          ? "workspace"
          : "project-management";

        if (typeof window !== "undefined") {
          localStorage.setItem(
            LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
            targetWorkspacePage,
          );
        }

        setCurrentPage(targetWorkspacePage);
        setPageParams({
          ...(projectParams?.projectId
            ? { projectId: projectParams.projectId }
            : {}),
          workspaceViewMode,
        });
        return;
      }

      if (isThemeWorkspacePage(page) && typeof window !== "undefined") {
        localStorage.setItem(LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY, page);
      }

      setCurrentPage(page);
      setPageParams(params ? { ...params } : {});
    },
    [resolveWorkspacePage],
  );

  const _handleRequestRecommendation = useCallback(
    (shortLabel: string, fullPrompt: string, currentTheme: string) => {
      const themeLabels: Record<string, string> = {
        "social-media": "社媒",
        poster: "海报",
        music: "音乐",
        knowledge: "知识",
        planning: "计划",
        novel: "小说",
        document: "文档",
        video: "视频",
        general: "对话",
      };

      const prefix = themeLabels[currentTheme] || "项目";
      const projectName = `${prefix}：${shortLabel}`;

      setPendingRecommendation({
        shortLabel,
        fullPrompt,
        projectType: currentTheme as ProjectType,
        projectName,
      });
      setProjectDialogOpen(true);
    },
    [],
  );

  const handleCreateProjectFromRecommendation = async (
    name: string,
    type: ProjectType,
  ) => {
    const projectPath = await resolveProjectRootPath(name);

    const project = await createProject({
      name,
      rootPath: projectPath,
      workspaceType: type,
    });

    if (pendingRecommendation) {
      const content = await createContent({
        project_id: project.id,
        title: name,
        body: pendingRecommendation.fullPrompt,
      });

      handleNavigate("agent", {
        projectId: project.id,
        contentId: content.id,
      });

      setPendingRecommendation(null);
    } else if (isUserProjectType(type)) {
      handleNavigate(getThemeWorkspacePage(type as WorkspaceTheme), {
        projectId: project.id,
        workspaceViewMode: "project-management",
      });
    } else {
      handleNavigate("agent", {
        projectId: project.id,
      });
    }

    toast.success("项目创建成功");
  };

  const {
    connectPayload,
    relayInfo,
    isVerified,
    isDialogOpen,
    isSaving,
    error,
    handleConfirm,
    handleCancel,
  } = useDeepLink();

  const { error: registryError, refresh: _refreshRegistry } =
    useRelayRegistry();

  useEffect(() => {
    if (registryError) {
      console.warn("[App] Registry 加载失败:", registryError);
      showRegistryLoadError(registryError.message);
    }
  }, [registryError]);

  useEffect(() => {
    void invoke<{
      workspaceId: string;
      rootPath: string;
      created: boolean;
      repaired: boolean;
      relocated?: boolean;
    } | null>("workspace_ensure_default_ready")
      .then((result) => {
        if (result?.repaired) {
          recordWorkspaceRepair({
            workspaceId: result.workspaceId,
            rootPath: result.rootPath,
            source: "app_startup",
          });
          console.info(
            "[App] 启动时检测到默认工作区目录缺失，已自动修复:",
            result.rootPath,
          );
        }
      })
      .catch((error) => {
        console.warn("[App] 启动时工作区健康检查失败:", error);
      });
  }, []);

  useEffect(() => {
    const mainElement = document.querySelector("main");
    if (mainElement) {
      mainElement.scrollTop = 0;
    }
  }, [currentPage]);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const renderThemeWorkspaces = () => {
    return THEME_WORKSPACE_PAGES.map((page) => {
      const theme = getThemeByWorkspacePage(page);

      return (
        <div
          key={page}
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === page ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <WorkbenchPage
            onNavigate={handleNavigate}
            projectId={(pageParams as AgentPageParams).projectId}
            contentId={(pageParams as AgentPageParams).contentId}
            theme={theme}
            viewMode={(pageParams as AgentPageParams).workspaceViewMode}
            resetAt={(pageParams as AgentPageParams).workspaceResetAt}
          />
        </div>
      );
    });
  };

  const renderAllPages = () => {
    return (
      <>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "image-gen" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <ImageGenPage onNavigate={handleNavigate} />
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "batch" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <BatchPage onNavigate={handleNavigate} />
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "agent" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <AgentChatPage
            key={`${(pageParams as AgentPageParams).projectId || ""}:${(pageParams as AgentPageParams).contentId || ""}:${(pageParams as AgentPageParams).theme || ""}:${(pageParams as AgentPageParams).lockTheme ? "1" : "0"}`}
            onNavigate={handleNavigate}
            projectId={(pageParams as AgentPageParams).projectId}
            contentId={(pageParams as AgentPageParams).contentId}
            theme={(pageParams as AgentPageParams).theme}
            lockTheme={(pageParams as AgentPageParams).lockTheme}
            fromResources={(pageParams as AgentPageParams).fromResources}
            newChatAt={(pageParams as AgentPageParams).newChatAt}
            onHasMessagesChange={setAgentHasMessages}
          />
        </div>

        {renderThemeWorkspaces()}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "terminal" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <TerminalWorkspace onNavigate={handleNavigate} />
        </div>

        <FullscreenWrapper $isActive={currentPage === "sysinfo"}>
          <SysinfoView />
        </FullscreenWrapper>

        <FullscreenWrapper $isActive={currentPage === "files"}>
          <FileBrowserView />
        </FullscreenWrapper>

        <FullscreenWrapper $isActive={currentPage === "web"}>
          <WebView />
        </FullscreenWrapper>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "resources" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <ResourcesPage onNavigate={handleNavigate} />
        </div>

        <PageWrapper $isActive={currentPage === "tools"}>
          <ToolsPage onNavigate={handleNavigate} />
        </PageWrapper>

        <PageWrapper $isActive={currentPage === "plugins"}>
          <PluginsPage onNavigate={handleNavigate} />
        </PageWrapper>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "memory" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <MemoryPage onNavigate={handleNavigate} />
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentPage === "settings" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <SettingsPageV2
            onNavigate={handleNavigate}
            initialTab={(pageParams as SettingsPageParams).tab}
          />
        </div>
      </>
    );
  };

  const handleOnboardingComplete = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  if (needsOnboarding === null) {
    return null;
  }

  if (needsOnboarding) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  const currentAgentParams = pageParams as AgentPageParams;
  const shouldHideSidebarForAgent =
    currentPage === "agent" &&
    (Boolean(currentAgentParams.fromResources) ||
      (agentHasMessages && Boolean(currentAgentParams.lockTheme)));

  const shouldShowAppSidebar =
    currentPage !== "settings" &&
    currentPage !== "memory" &&
    currentPage !== "image-gen" &&
    currentPage !== "tools" &&
    currentPage !== "plugins" &&
    currentPage !== "resources" &&
    !isThemeWorkspacePage(currentPage) &&
    !shouldHideSidebarForAgent;

  const shouldAddMainContentGap = shouldShowAppSidebar && currentPage === "agent";

  return (
    <SoundProvider>
      <ComponentDebugProvider>
        <AppContainer>
          {shouldShowAppSidebar && (
            <AppSidebar currentPage={currentPage} onNavigate={handleNavigate} />
          )}
          <MainContent $withSidebarGap={shouldAddMainContentGap}>
            {renderAllPages()}
          </MainContent>
          <RecentImageInsertFloating onNavigate={handleNavigate} />

          <ConnectConfirmDialog
            open={isDialogOpen}
            relay={relayInfo}
            relayId={connectPayload?.relay ?? ""}
            apiKey={connectPayload?.key ?? ""}
            keyName={connectPayload?.name}
            isVerified={isVerified}
            isSaving={isSaving}
            error={error}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />

          <CreateProjectDialog
            open={projectDialogOpen}
            onOpenChange={(open) => {
              setProjectDialogOpen(open);
              if (!open) {
                setPendingRecommendation(null);
              }
            }}
            onSubmit={handleCreateProjectFromRecommendation}
            defaultType={pendingRecommendation?.projectType}
            defaultName={pendingRecommendation?.projectName}
          />

          <ComponentDebugOverlay />
        </AppContainer>
      </ComponentDebugProvider>
    </SoundProvider>
  );
}

const App = withI18nPatch(AppContent);
export default App;
