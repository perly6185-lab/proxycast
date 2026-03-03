import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseAgentChatUnified,
  mockGetProject,
  mockGetDefaultProject,
  mockGetOrCreateDefaultProject,
  mockGetContent,
  mockUpdateContent,
  mockGetProjectMemory,
  mockToast,
  mockArtifactsAtom,
  mockSelectedArtifactAtom,
  mockSelectedArtifactIdAtom,
  mockGenerateContentCreationPrompt,
  mockIsContentCreationTheme,
  mockEmptyState,
} = vi.hoisted(() => ({
  mockUseAgentChatUnified: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetDefaultProject: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  mockGetContent: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetProjectMemory: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockArtifactsAtom: { key: "artifacts" },
  mockSelectedArtifactAtom: { key: "selectedArtifact" },
  mockSelectedArtifactIdAtom: { key: "selectedArtifactId" },
  mockGenerateContentCreationPrompt: vi.fn(() => "mock-system-prompt"),
  mockIsContentCreationTheme: vi.fn(() => false),
  mockEmptyState: vi.fn((props?: { input?: string }) => (
    <div data-testid="empty-state">{props?.input || ""}</div>
  )),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("./hooks", () => ({
  useAgentChatUnified: mockUseAgentChatUnified,
}));

vi.mock("./hooks/useSessionFiles", () => ({
  useSessionFiles: () => ({
    saveFile: vi.fn(),
    files: [],
    readFile: vi.fn(async () => null),
    meta: null,
  }),
}));

vi.mock("./hooks/useContentSync", () => ({
  useContentSync: () => ({
    syncContent: vi.fn(),
    syncStatus: "idle",
  }),
}));

vi.mock("@/components/content-creator/hooks/useWorkflow", () => ({
  useWorkflow: () => ({
    steps: [],
    currentStepIndex: 0,
    goToStep: vi.fn(),
    completeStep: vi.fn(),
  }),
}));

vi.mock("@/components/content-creator/core/LayoutTransition/LayoutTransition", () => ({
  LayoutTransition: ({ chatContent }: { chatContent: ReactNode }) => (
    <div data-testid="layout-transition">{chatContent}</div>
  ),
}));

vi.mock("./components/ChatNavbar", () => ({
  ChatNavbar: ({
    onToggleHistory,
    onProjectChange,
  }: {
    onToggleHistory?: () => void;
    onProjectChange?: (projectId: string) => void;
  }) => (
    <div data-testid="chat-navbar">
      <button
        type="button"
        data-testid="toggle-history"
        onClick={() => {
          onToggleHistory?.();
        }}
      >
        切换侧边栏
      </button>
      <button
        type="button"
        data-testid="set-project"
        onClick={() => {
          onProjectChange?.("project-manual");
        }}
      >
        选择项目
      </button>
    </div>
  ),
}));

vi.mock("./components/ChatSidebar", () => ({
  ChatSidebar: ({
    onSwitchTopic,
  }: {
    onSwitchTopic?: (topicId: string) => Promise<void> | void;
  }) => (
    <div data-testid="chat-sidebar">
      <button
        type="button"
        data-testid="switch-topic"
        onClick={() => {
          void onSwitchTopic?.("topic-a");
        }}
      >
        切换话题
      </button>
    </div>
  ),
}));

vi.mock("./components/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("./components/Inputbar", () => ({
  Inputbar: () => <div data-testid="inputbar" />,
}));

vi.mock("./components/EmptyState", () => ({
  EmptyState: (props?: { input?: string }) => mockEmptyState(props),
}));

vi.mock("@/components/content-creator/core/StepGuide/StepProgress", () => ({
  StepProgress: () => <div data-testid="step-progress" />,
}));

vi.mock("@/components/content-creator/canvas/CanvasFactory", () => ({
  CanvasFactory: () => <div data-testid="canvas-factory" />,
}));

vi.mock("@/components/general-chat/canvas", () => ({
  CanvasPanel: () => <div data-testid="general-canvas" />,
}));

vi.mock("@/components/artifact", () => ({
  ArtifactRenderer: () => <div data-testid="artifact-renderer" />,
  ArtifactToolbar: () => <div data-testid="artifact-toolbar" />,
}));

vi.mock("@/lib/artifact/store", () => ({
  artifactsAtom: mockArtifactsAtom,
  selectedArtifactAtom: mockSelectedArtifactAtom,
  selectedArtifactIdAtom: mockSelectedArtifactIdAtom,
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: unknown) =>
    atom === mockSelectedArtifactAtom ? null : [],
  useSetAtom: () => vi.fn(),
}));

vi.mock("@/components/content-creator/utils/systemPrompt", () => ({
  generateContentCreationPrompt: mockGenerateContentCreationPrompt,
  isContentCreationTheme: mockIsContentCreationTheme,
}));

vi.mock("@/components/content-creator/utils/projectPrompt", () => ({
  generateProjectMemoryPrompt: vi.fn(() => ""),
}));

vi.mock("@/components/content-creator/canvas/canvasUtils", () => ({
  createInitialCanvasState: vi.fn(() => null),
}));

vi.mock("@/components/content-creator/canvas/document", () => ({
  createInitialDocumentState: vi.fn(() => ({
    type: "document",
    content: "",
    versions: [],
    currentVersionId: "",
  })),
}));

vi.mock("./utils/workflowMapping", () => ({
  getFileToStepMap: vi.fn(() => new Map()),
}));

vi.mock("@/lib/workspace/navigation", () => ({
  buildHomeAgentParams: vi.fn(() => ({})),
}));

vi.mock("@/lib/api/project", () => ({
  getProject: mockGetProject,
  getDefaultProject: mockGetDefaultProject,
  getOrCreateDefaultProject: mockGetOrCreateDefaultProject,
  getContent: mockGetContent,
  updateContent: mockUpdateContent,
}));

vi.mock("@/lib/api/memory", () => ({
  getProjectMemory: mockGetProjectMemory,
}));

import { AgentChatPage } from "./index";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];
const observedWorkspaceIds: string[] = [];
let sharedSwitchTopicMock: ReturnType<typeof vi.fn>;
let sharedSendMessageMock: ReturnType<typeof vi.fn>;
let sharedTriggerAIGuideMock: ReturnType<typeof vi.fn>;

function createProject(id: string, archived = false) {
  return {
    id,
    name: `Project ${id}`,
    workspaceType: "general",
    rootPath: `/tmp/${id}`,
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isFavorite: false,
    isArchived: archived,
    tags: [],
  };
}

function renderPage(
  props: Partial<ComponentProps<typeof AgentChatPage>> = {},
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<AgentChatPage {...props} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

async function flushEffects(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function clickButton(container: HTMLElement, testId: string) {
  const button = container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`未找到按钮: ${testId}`);
  }

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getHookCallOrderForWorkspace(workspaceId: string): number {
  const index = mockUseAgentChatUnified.mock.calls.findIndex(
    (args: unknown[]) =>
      (args[0] as { workspaceId?: string } | undefined)?.workspaceId ===
      workspaceId,
  );
  if (index < 0) {
    throw new Error(`未找到 workspaceId=${workspaceId} 的 hook 调用`);
  }
  return mockUseAgentChatUnified.mock.invocationCallOrder[index];
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  localStorage.clear();
  observedWorkspaceIds.length = 0;

  mockGetProject.mockImplementation(async (projectId: string) => {
    if (!projectId) {
      return null;
    }
    return createProject(projectId);
  });
  mockGetDefaultProject.mockResolvedValue(null);
  mockGetOrCreateDefaultProject.mockResolvedValue(null);
  mockGetContent.mockResolvedValue(null);
  mockUpdateContent.mockResolvedValue(undefined);
  mockGetProjectMemory.mockResolvedValue(null);
  mockGenerateContentCreationPrompt.mockReturnValue("mock-system-prompt");
  mockIsContentCreationTheme.mockReturnValue(false);
  mockEmptyState.mockImplementation((props?: { input?: string }) => (
    <div data-testid="empty-state">{props?.input || ""}</div>
  ));

  sharedSwitchTopicMock = vi.fn(async () => undefined);
  sharedSendMessageMock = vi.fn(async () => undefined);
  sharedTriggerAIGuideMock = vi.fn();
  mockUseAgentChatUnified.mockImplementation(
    ({ workspaceId }: { workspaceId: string }) => {
      observedWorkspaceIds.push(workspaceId);
      return {
        providerType: "kiro",
        setProviderType: vi.fn(),
        model: "mock-model",
        setModel: vi.fn(),
        executionStrategy: "auto",
        setExecutionStrategy: vi.fn(),
        messages: [],
        isSending: false,
        sendMessage: sharedSendMessageMock,
        stopSending: vi.fn(async () => undefined),
        clearMessages: vi.fn(),
        deleteMessage: vi.fn(),
        editMessage: vi.fn(),
        handlePermissionResponse: vi.fn(),
        triggerAIGuide: sharedTriggerAIGuideMock,
        topics: [
          {
            id: "topic-a",
            title: "话题 A",
            updatedAt: Date.now(),
          },
        ],
        sessionId: "session-1",
        switchTopic: sharedSwitchTopicMock,
        deleteTopic: vi.fn(),
        renameTopic: vi.fn(),
      };
    },
  );
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  localStorage.clear();
});

describe("AgentChatPage 话题切换项目恢复", () => {
  it("应先切换到话题绑定项目，再执行话题切换", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("project-topic"),
    );

    const container = renderPage();
    await flushEffects();

    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(switchTopicMock).toHaveBeenCalledWith("topic-a");

    const workspaceHookOrder = getHookCallOrderForWorkspace("project-topic");
    const switchTopicOrder = switchTopicMock.mock.invocationCallOrder[0];
    expect(workspaceHookOrder).toBeLessThan(switchTopicOrder);
    expect(observedWorkspaceIds).toContain("project-topic");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("外部锁定项目与话题绑定冲突时应阻止切换并提示", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("topic-project"),
    );

    const container = renderPage({ projectId: "locked-project" });
    await flushEffects();

    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(switchTopicMock).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "该话题绑定了其他项目，请先切换到对应项目",
    );
    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
  });

  it("无可用项目时应自动创建默认项目并继续切换话题", async () => {
    mockGetProject.mockResolvedValue(null);
    mockGetDefaultProject.mockResolvedValue(null);
    mockGetOrCreateDefaultProject.mockResolvedValue(createProject("default-new"));

    const container = renderPage();
    await flushEffects();

    clickButton(container, "switch-topic");
    await flushEffects();

    const switchTopicMock = mockUseAgentChatUnified.mock.results[0]?.value
      ?.switchTopic as ReturnType<typeof vi.fn>;
    expect(mockGetOrCreateDefaultProject).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledWith(
      "未找到可用项目，已自动创建默认项目",
    );
    expect(switchTopicMock).toHaveBeenCalledWith("topic-a");

    const workspaceHookOrder = getHookCallOrderForWorkspace("default-new");
    const switchTopicOrder = switchTopicMock.mock.invocationCallOrder[0];
    expect(workspaceHookOrder).toBeLessThan(switchTopicOrder);
  });

  it("存在 newChatAt 时手动选项目不应被重置", async () => {
    const container = renderPage({ newChatAt: 1234567890 });
    await flushEffects();

    clickButton(container, "set-project");
    await flushEffects();

    expect(observedWorkspaceIds).toContain("project-manual");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "project-manual",
    );
  });
});

describe("AgentChatPage 侧栏显示控制", () => {
  it("有消息时默认显示侧栏且不应被自动收起", async () => {
    mockUseAgentChatUnified.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) => {
        observedWorkspaceIds.push(workspaceId);
        return {
          providerType: "kiro",
          setProviderType: vi.fn(),
          model: "mock-model",
          setModel: vi.fn(),
          executionStrategy: "auto",
          setExecutionStrategy: vi.fn(),
          messages: [{ id: "msg-1", role: "user", content: "你好" }],
          isSending: false,
          sendMessage: sharedSendMessageMock,
          stopSending: vi.fn(async () => undefined),
          clearMessages: vi.fn(),
          deleteMessage: vi.fn(),
          editMessage: vi.fn(),
          handlePermissionResponse: vi.fn(),
          triggerAIGuide: sharedTriggerAIGuideMock,
          topics: [
            {
              id: "topic-a",
              title: "话题 A",
              updatedAt: Date.now(),
            },
          ],
          sessionId: "session-1",
          switchTopic: sharedSwitchTopicMock,
          deleteTopic: vi.fn(),
          renameTopic: vi.fn(),
        };
      },
    );

    const container = renderPage();
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).not.toBeNull();

    clickButton(container, "set-project");
    await flushEffects();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).not.toBeNull();
  });

  it("showChatPanel=false 时应保持侧栏隐藏", async () => {
    const container = renderPage({ showChatPanel: false });
    await flushEffects();

    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();

    clickButton(container, "toggle-history");
    await flushEffects();
    expect(container.querySelector('[data-testid="chat-sidebar"]')).toBeNull();
  });
});

describe("AgentChatPage 自动引导", () => {
  it("社媒空文稿应预填引导词且不自动发送", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);

    const container = renderPage({
      projectId: "project-social",
      contentId: "content-social",
      theme: "social-media",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("社媒内容创作教练");
  });

  it("非社媒空文稿应维持原始自动引导调用", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);

    renderPage({
      projectId: "project-document",
      contentId: "content-document",
      theme: "document",
      lockTheme: true,
    });
    await flushEffects(10);

    expect(sharedTriggerAIGuideMock).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).toHaveBeenCalledWith();
  });

  it("存在 initialUserPrompt 时应优先发送首条意图", async () => {
    mockIsContentCreationTheme.mockReturnValue(true);
    const onInitialUserPromptConsumed = vi.fn();
    const initialUserPrompt = "请先帮我写一篇社媒文案提纲。";

    renderPage({
      projectId: "project-social-intent",
      contentId: "content-social-intent",
      theme: "social-media",
      lockTheme: true,
      initialUserPrompt,
      onInitialUserPromptConsumed,
    });
    await flushEffects(12);

    expect(sharedSendMessageMock).toHaveBeenCalledWith(
      initialUserPrompt,
      [],
      false,
      false,
      false,
      undefined,
    );
    expect(onInitialUserPromptConsumed).toHaveBeenCalledTimes(1);
    expect(sharedTriggerAIGuideMock).not.toHaveBeenCalled();
  });
});
