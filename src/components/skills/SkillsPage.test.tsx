import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsPage } from "./SkillsPage";
import {
  filterSkillsByQueryAndStatus,
  groupSkillsBySourceKind,
} from "./skillsUtils";
import type { Skill } from "@/lib/api/skills";

const mockUseSkills = vi.fn();
const mockInspectLocalSkill = vi.fn();
const mockInspectRemoteSkill = vi.fn();
const mockCreateSkillScaffold = vi.fn();

vi.mock("@/hooks/useSkills", () => ({
  useSkills: (...args: unknown[]) => mockUseSkills(...args),
}));

vi.mock("@/lib/api/skills", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/skills")>(
      "@/lib/api/skills",
    );

  return {
    ...actual,
    skillsApi: {
      ...actual.skillsApi,
      inspectLocalSkill: (...args: unknown[]) => mockInspectLocalSkill(...args),
      inspectRemoteSkill: (...args: unknown[]) =>
        mockInspectRemoteSkill(...args),
      createSkillScaffold: (...args: unknown[]) =>
        mockCreateSkillScaffold(...args),
    },
  };
});

vi.mock("./SkillContentDialog", () => ({
  SkillContentDialog: () => null,
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    key: "skill:test",
    name: "Test Skill",
    description: "A test skill",
    directory: "test-skill",
    installed: true,
    sourceKind: "other",
    ...overrides,
  };
}

function renderSkillsPage(): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<SkillsPage hideHeader />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

function fillField(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  if (!element) {
    throw new Error("field not found");
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseSkills.mockReturnValue({
    skills: [],
    repos: [],
    loading: false,
    remoteLoading: false,
    error: null,
    refresh: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
  });

  mockInspectLocalSkill.mockReset();
  mockInspectRemoteSkill.mockReset();
  mockCreateSkillScaffold.mockReset();
  mockInspectLocalSkill.mockResolvedValue({
    content: "# Test",
    metadata: {},
    allowedTools: [],
    resourceSummary: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
  });
  mockInspectRemoteSkill.mockResolvedValue({
    content: "# Remote",
    metadata: {},
    allowedTools: [],
    resourceSummary: {
      hasScripts: false,
      hasReferences: true,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
  });
  mockCreateSkillScaffold.mockResolvedValue({
    content: "# Scaffold",
    metadata: {},
    allowedTools: [],
    resourceSummary: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
  });
});

afterEach(() => {
  mockUseSkills.mockReset();

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
});

describe("filterSkillsByQueryAndStatus", () => {
  it("应同时按搜索词和安装状态过滤技能", () => {
    const skills = [
      createSkill({ name: "Video Skill", installed: true }),
      createSkill({
        key: "skill:draft",
        name: "Draft Writer",
        directory: "draft-writer",
        installed: false,
      }),
    ];

    const result = filterSkillsByQueryAndStatus(skills, "draft", "uninstalled");
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Draft Writer");
  });
});

describe("groupSkillsBySourceKind", () => {
  it("应将技能分为内置、本地和远程三组", () => {
    const sections = groupSkillsBySourceKind([
      createSkill({
        key: "builtin:video_generate",
        name: "Video Generate",
        directory: "video_generate",
        sourceKind: "builtin",
      }),
      createSkill({
        key: "local:custom",
        name: "Custom Skill",
        directory: "custom-skill",
        sourceKind: "other",
      }),
      createSkill({
        key: "repo:remote",
        name: "Remote Skill",
        directory: "remote-skill",
        sourceKind: "other",
        catalogSource: "remote",
      }),
    ]);

    expect(sections[0]?.key).toBe("builtin");
    expect(sections[0]?.skills).toHaveLength(1);
    expect(sections[1]?.key).toBe("local");
    expect(sections[1]?.skills).toHaveLength(1);
    expect(sections[2]?.key).toBe("remote");
    expect(sections[2]?.skills).toHaveLength(1);
  });
});

describe("SkillsPage", () => {
  it("应按 Built-in / Local / Remote Skills 分组渲染，并隐藏内置技能卸载入口", () => {
    mockUseSkills.mockReturnValue({
      skills: [
        createSkill({
          key: "builtin:video_generate",
          name: "Video Generate",
          directory: "video_generate",
          sourceKind: "builtin",
        }),
        createSkill({
          key: "local:custom",
          name: "Local Skill",
          directory: "local-skill",
          sourceKind: "other",
          installed: false,
        }),
        createSkill({
          key: "repo:custom",
          name: "Remote Skill",
          directory: "remote-skill",
          catalogSource: "remote",
          repoOwner: "proxycast",
          repoName: "skills",
          sourceKind: "other",
        }),
      ],
      repos: [],
      loading: false,
      remoteLoading: false,
      error: null,
      refresh: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    const { container } = renderSkillsPage();
    const text = container.textContent ?? "";

    expect(text).toContain("BUILT-IN SKILLS");
    expect(text).toContain("LOCAL SKILLS");
    expect(text).toContain("REMOTE SKILLS");
    expect(text.indexOf("BUILT-IN SKILLS")).toBeLessThan(
      text.indexOf("LOCAL SKILLS"),
    );
    expect(text.indexOf("LOCAL SKILLS")).toBeLessThan(
      text.indexOf("REMOTE SKILLS"),
    );

    const buttonTexts = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent?.trim() ?? "",
    );
    const uninstallButtons = buttonTexts.filter((textContent) =>
      textContent.includes("卸载"),
    );

    expect(uninstallButtons).toHaveLength(1);
  });

  it("远程缓存为空时仍应显示远程分组和刷新提示", () => {
    mockUseSkills.mockReturnValue({
      skills: [
        createSkill({
          key: "builtin:video_generate",
          name: "Video Generate",
          directory: "video_generate",
          sourceKind: "builtin",
        }),
        createSkill({
          key: "local:custom",
          name: "Local Skill",
          directory: "local-skill",
          sourceKind: "other",
        }),
      ],
      repos: [],
      loading: false,
      remoteLoading: false,
      error: null,
      refresh: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    const { container } = renderSkillsPage();
    const text = container.textContent ?? "";

    expect(text).toContain("REMOTE SKILLS");
    expect(text).toContain("暂无远程缓存");
    expect(text).toContain('点击"刷新"同步已启用仓库');
  });

  it("点击本地 skill 的查看内容应调用本地 inspection", async () => {
    mockUseSkills.mockReturnValue({
      skills: [
        createSkill({
          key: "local:custom",
          name: "Local Skill",
          directory: "local-skill",
          sourceKind: "other",
          installed: true,
        }),
      ],
      repos: [],
      loading: false,
      remoteLoading: false,
      error: null,
      refresh: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    const { container } = renderSkillsPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("查看内容"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockInspectLocalSkill).toHaveBeenCalledWith(
      "local-skill",
      "proxycast",
    );
    expect(mockInspectRemoteSkill).not.toHaveBeenCalled();
  });

  it("点击远程 skill 的检查详情应调用远程 inspection", async () => {
    mockUseSkills.mockReturnValue({
      skills: [
        createSkill({
          key: "repo:remote",
          name: "Remote Skill",
          directory: "remote-skill",
          installed: false,
          sourceKind: "other",
          catalogSource: "remote",
          repoOwner: "proxycast",
          repoName: "skills",
          repoBranch: "main",
        }),
      ],
      repos: [],
      loading: false,
      remoteLoading: false,
      error: null,
      refresh: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    const { container } = renderSkillsPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("检查详情"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockInspectRemoteSkill).toHaveBeenCalledWith({
      owner: "proxycast",
      name: "skills",
      branch: "main",
      directory: "remote-skill",
    });
    expect(mockInspectLocalSkill).not.toHaveBeenCalled();
  });

  it("创建标准 Skill 脚手架后应调用创建 API 并刷新列表", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockUseSkills.mockReturnValue({
      skills: [],
      repos: [],
      loading: false,
      remoteLoading: false,
      error: null,
      refresh,
      install: vi.fn(),
      uninstall: vi.fn(),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
    });

    renderSkillsPage();

    const openButton = Array.from(document.body.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("新建 Skill"),
    );

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const directoryInput = document.body.querySelector(
      "#skill-scaffold-directory",
    ) as HTMLInputElement | null;
    const nameInput = document.body.querySelector(
      "#skill-scaffold-name",
    ) as HTMLInputElement | null;
    const descriptionInput = document.body.querySelector(
      "#skill-scaffold-description",
    ) as HTMLTextAreaElement | null;

    await act(async () => {
      fillField(directoryInput, "draft-skill");
      fillField(nameInput, "Draft Skill");
      fillField(descriptionInput, "Create a standard scaffold");
    });

    const createButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((item) => item.textContent?.trim() === "创建 Skill");

    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockCreateSkillScaffold).toHaveBeenCalledWith(
      {
        target: "project",
        directory: "draft-skill",
        name: "Draft Skill",
        description: "Create a standard scaffold",
      },
      "proxycast",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
