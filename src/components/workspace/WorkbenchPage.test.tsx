import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  clickButtonByText,
  clickButtonByTitle,
  clickElement,
  cleanupMountedRoots,
  findAsideByClassFragment,
  findButtonByText,
  findButtonByTitle,
  findInputById,
  findInputByPlaceholder,
  fillTextInput,
  flushEffects as flushAsyncEffects,
  mountHarness,
  setupReactActEnvironment,
  triggerKeyboardShortcut,
  type MountedRoot,
} from "./hooks/testUtils";
import {
  createWorkspaceContentFixture,
  createWorkspaceProjectFixture,
  DEFAULT_WORKSPACE_PAGE_PROPS,
} from "./testFixtures";

const {
  mockListProjects,
  mockListContents,
  mockGetContent,
  mockCreateProject,
  mockCreateContent,
  mockUpdateContent,
} = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockListContents: vi.fn(),
  mockGetContent: vi.fn(),
  mockCreateProject: vi.fn(),
  mockCreateContent: vi.fn(),
  mockUpdateContent: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/agent", () => ({
  AgentChatPage: ({ hideTopBar }: { hideTopBar?: boolean }) => (
    <div data-testid="agent-chat-page" data-hide-topbar={String(hideTopBar)} />
  ),
}));

vi.mock("@/components/content-creator/canvas/video", () => ({
  VideoCanvas: ({ projectId }: { projectId?: string | null }) => (
    <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
  ),
  createInitialVideoState: () => ({
    type: "video",
    prompt: "",
    providerId: "",
    model: "",
    duration: 5,
    generateAudio: false,
    cameraFixed: false,
    aspectRatio: "adaptive",
    resolution: "720p",
    status: "idle",
  }),
}));

vi.mock("@/features/themes/video", () => ({
  videoThemeModule: {
    theme: "video",
    capabilities: {
      workspaceKind: "video-canvas",
    },
    navigation: {
      defaultView: "create",
      items: [
        { key: "create", label: "创作" },
        { key: "material", label: "素材" },
        { key: "template", label: "排版" },
        { key: "publish", label: "发布" },
        { key: "settings", label: "设置" },
      ],
    },
    primaryWorkspaceRenderer: ({ projectId }: { projectId?: string | null }) => (
      <div data-testid="video-theme-workspace">
        <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
      </div>
    ),
    workspaceRenderer: ({ projectId }: { projectId?: string | null }) => (
      <div data-testid="video-theme-workspace">
        <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
      </div>
    ),
    panelRenderers: {
      material: () => <div>Material Panel</div>,
      template: () => <div>Template Panel</div>,
      publish: () => <div>Publish Panel</div>,
      settings: () => <div>Settings Panel</div>,
    },
  },
}));

vi.mock("@/lib/api/project", () => ({
  listProjects: mockListProjects,
  listContents: mockListContents,
  getContent: mockGetContent,
  createProject: mockCreateProject,
  createContent: mockCreateContent,
  updateContent: mockUpdateContent,
  getWorkspaceProjectsRoot: vi.fn(async () => "/tmp/workspace"),
  getProjectByRootPath: vi.fn(async () => null),
  resolveProjectRootPath: vi.fn(async (name: string) => `/tmp/workspace/${name}`),
  getCreateProjectErrorMessage: vi.fn((message: string) => message),
  extractErrorMessage: vi.fn(() => "mock-error"),
  formatRelativeTime: vi.fn(() => "刚刚"),
  getContentTypeLabel: vi.fn(() => "文稿"),
  getDefaultContentTypeForProject: vi.fn(() => "post"),
  getProjectTypeLabel: vi.fn((theme: string) =>
    theme === "social-media" ? "社媒内容" : theme,
  ),
}));

import { WorkbenchPage } from "./WorkbenchPage";

const mountedRoots: MountedRoot[] = [];

function renderPage(
  props: Partial<ComponentProps<typeof WorkbenchPage>> = {},
) {
  return mountHarness(
    WorkbenchPage,
    { theme: "social-media", ...props },
    mountedRoots,
  );
}

function renderDefaultWorkspacePage(
  props: Partial<ComponentProps<typeof WorkbenchPage>> = {},
) {
  return renderPage({
    ...DEFAULT_WORKSPACE_PAGE_PROPS,
    ...props,
  });
}

async function flushEffects(times = 3): Promise<void> {
  await flushAsyncEffects(times);
}

async function enterDefaultWorkspace(options?: {
  expandSidebar?: boolean;
}): Promise<{ container: HTMLDivElement }> {
  const rendered = renderDefaultWorkspacePage();
  await flushEffects();

  if (options?.expandSidebar) {
    triggerKeyboardShortcut(window, "b", { ctrlKey: true });
    await flushEffects();
  }

  return { container: rendered.container };
}

function expectAgentWorkspaceVisible(container: HTMLElement): void {
  expect(container.querySelector("[data-testid='agent-chat-page']")).not.toBeNull();
}

function expectWorkspaceNavigationVisible(container: HTMLElement): void {
  expect(container.textContent).toContain("创作");
  expect(container.textContent).toContain("发布");
}

async function enterProjectManagementFromWorkspace(
  container: HTMLElement,
): Promise<void> {
  const managementButton = findButtonByText(container, "项目管理");
  expect(managementButton).toBeDefined();
  clickButtonByText(container, "项目管理");
  await flushEffects();
}

function expectProjectManagementLandingVisible(container: HTMLElement): void {
  expect(container.textContent).toContain("统一创作工作区");
  expect(container.textContent).toContain("进入创作");
}

beforeEach(() => {
  setupReactActEnvironment();

  localStorage.clear();
  vi.clearAllMocks();
  useWorkbenchStore.getState().setLeftSidebarCollapsed(true);

  mockListProjects.mockResolvedValue([
    createWorkspaceProjectFixture({
      id: "project-1",
      name: "社媒项目A",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/project-1",
    }),
  ]);

  mockListContents.mockResolvedValue([
    createWorkspaceContentFixture({
      id: "content-1",
      project_id: "project-1",
      title: "文稿A",
    }),
  ]);

  mockGetContent.mockResolvedValue({
    id: "content-1",
    metadata: { creationMode: "guided" },
  });
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  localStorage.clear();
});

describe("WorkbenchPage 左侧栏模式行为", () => {
  it("项目管理模式默认展开左侧栏", async () => {
    const { container } = renderPage({ viewMode: "project-management" });
    await flushEffects();

    const leftSidebar = findAsideByClassFragment(container, "bg-muted/20");
    expect(leftSidebar).not.toBeNull();
    expect(leftSidebar?.className).toContain("w-[260px]");
    expect(container.textContent).toContain("主题项目管理");
  });

  it("项目管理模式点击项目后直接进入统一工作区", async () => {
    const { container } = renderPage({ viewMode: "project-management" });
    await flushEffects();

    const projectButton = findButtonByText(container, "社媒项目A");
    expect(projectButton).toBeDefined();
    clickButtonByText(container, "社媒项目A");
    await flushEffects();

    expectAgentWorkspaceVisible(container);
    expectWorkspaceNavigationVisible(container);
  });

  it("作业模式默认收起左侧栏", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(findAsideByClassFragment(container, "bg-muted/20")).toBeNull();
    expect(container.textContent).not.toContain("主题项目管理");
  });

  it("作业模式展开侧栏后点击项目保持在统一工作区", async () => {
    const { container } = await enterDefaultWorkspace({ expandSidebar: true });

    const projectButton = findButtonByText(container, "社媒项目A");
    expect(projectButton).toBeDefined();
    clickButtonByText(container, "社媒项目A");
    await flushEffects();

    expectAgentWorkspaceVisible(container);
  });

  it("工作区点击项目管理后回到项目管理态", async () => {
    const { container } = await enterDefaultWorkspace();

    await enterProjectManagementFromWorkspace(container);
    expectProjectManagementLandingVisible(container);
  });

  it("工作区点击项目管理后自动展开左侧栏", async () => {
    const { container } = await enterDefaultWorkspace();

    await enterProjectManagementFromWorkspace(container);

    const leftSidebar = findAsideByClassFragment(container, "bg-muted/20");
    expect(leftSidebar).not.toBeNull();
    expect(leftSidebar?.className).toContain("w-[260px]");
    expectProjectManagementLandingVisible(container);
    expect(container.textContent).toContain("主题项目管理");
  });

  it("统一工作区中的聊天页隐藏内部顶部栏，避免双导航", async () => {
    const { container } = await enterDefaultWorkspace();

    const chat = container.querySelector("[data-testid='agent-chat-page']");
    expect(chat).not.toBeNull();
    expect(chat?.getAttribute("data-hide-topbar")).toBe("true");
  });

  it.skip("视频主题在作业模式渲染主题工作区而非对话工作区", async () => {
    mockListProjects.mockResolvedValueOnce([
      createWorkspaceProjectFixture({
        id: "video-project-1",
        name: "视频项目A",
        workspaceType: "video",
        rootPath: "/tmp/workspace/video-project-1",
      }),
    ]);

    const { container } = renderPage({
      theme: "video",
      viewMode: "workspace",
      projectId: "video-project-1",
    });
    await flushEffects();

    expect(
      container.querySelector("[data-testid='video-theme-workspace']"),
    ).not.toBeNull();
    expect(container.querySelector("[data-testid='video-canvas']")).not.toBeNull();
    expect(container.querySelector("[data-testid='agent-chat-page']")).toBeNull();
  });

  it("切换到非创作视图时左侧显示紧凑提示并可返回创作视图", async () => {
    const { container } = await enterDefaultWorkspace({ expandSidebar: true });

    const publishButton = findButtonByText(container, "发布", { exact: true });
    expect(publishButton).toBeDefined();
    clickButtonByText(container, "发布", { exact: true });
    await flushEffects();

    expect(container.textContent).toContain("当前处于「发布」视图");
    expect(container.textContent).toContain("当前文稿：文稿A");
    expect(container.textContent).toContain("返回创作视图");
    expect(findInputByPlaceholder(container, "搜索文稿...")).toBeNull();

    const openViewActionsButton = findButtonByTitle(container, "展开视图动作");
    expect(openViewActionsButton).not.toBeNull();

    clickElement(openViewActionsButton);
    await flushEffects();

    expect(container.textContent).toContain("视图动作");
    expect(container.textContent).toContain("前往设置视图");

    const backToCreateButton = findButtonByText(container, "返回创作视图", {
      exact: true,
    });
    expect(backToCreateButton).toBeDefined();
    clickButtonByText(container, "返回创作视图", { exact: true });
    await flushEffects();

    expect(findInputByPlaceholder(container, "搜索文稿...")).not.toBeNull();
  });

  it("创建项目后保持选中新项目且重置项目搜索", async () => {
    const baseProject = createWorkspaceProjectFixture({
      id: "project-1",
      name: "社媒项目A",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/project-1",
    });
    const createdProject = createWorkspaceProjectFixture({
      id: "project-2",
      name: "新项目B",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/新项目B",
    });

    mockListProjects
      .mockResolvedValueOnce([baseProject])
      .mockResolvedValueOnce([baseProject, createdProject]);
    mockCreateProject.mockResolvedValue(createdProject);

    const { container } = await enterDefaultWorkspace({ expandSidebar: true });

    const projectSearchInput = findInputByPlaceholder(
      container,
      "搜索项目...",
    ) as HTMLInputElement | null;
    expect(projectSearchInput).not.toBeNull();
    fillTextInput(projectSearchInput, "关键字");
    await flushEffects();
    expect(projectSearchInput?.value).toBe("关键字");

    const createProjectButton = findButtonByTitle(container, "新建项目");
    expect(createProjectButton).not.toBeNull();
    clickButtonByTitle(container, "新建项目");
    await flushEffects();

    const projectNameInput = findInputById(
      document,
      "workspace-project-name",
    ) as HTMLInputElement | null;
    expect(projectNameInput).not.toBeNull();
    fillTextInput(projectNameInput, "新项目B");
    await flushEffects();

    const createButton = findButtonByText(document, "创建项目", { exact: true });
    expect(createButton).toBeDefined();
    clickButtonByText(document, "创建项目", { exact: true });
    await flushEffects(5);

    expect(mockCreateProject).toHaveBeenCalled();
    expect(mockListContents).toHaveBeenCalledWith("project-2");
    expect(projectSearchInput?.value).toBe("");

    const newProjectEntry = findButtonByText(container, "新项目B");
    const oldProjectEntry = findButtonByText(container, "社媒项目A");
    expect(newProjectEntry).toBeDefined();
    expect(newProjectEntry?.className).toContain("bg-accent text-accent-foreground");
    expect(oldProjectEntry).toBeDefined();
    expect(oldProjectEntry?.className).not.toContain(
      "bg-accent text-accent-foreground",
    );
  });
});
