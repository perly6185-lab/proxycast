import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inputbar } from "./index";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";

const mockCharacterMention = vi.fn<
  (props: {
    characters?: Character[];
    skills?: Skill[];
  }) => React.ReactNode
>();

vi.mock("./components/InputbarCore", () => ({
  InputbarCore: () => <div data-testid="inputbar-core" />,
}));

vi.mock("./components/CharacterMention", () => ({
  CharacterMention: (props: {
    characters?: Character[];
    skills?: Skill[];
  }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("../TaskFiles", () => ({
  TaskFileList: () => <div data-testid="task-file-list" />,
}));

vi.mock("./hooks/useActiveSkill", () => ({
  useActiveSkill: () => ({
    activeSkill: null,
    setActiveSkill: vi.fn(),
    clearActiveSkill: vi.fn(),
  }),
}));

vi.mock("./components/SkillBadge", () => ({
  SkillBadge: () => <div data-testid="skill-badge" />,
}));

vi.mock("../ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(async () => []),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/input-kit", () => ({
  createAgentInputAdapter: (options: {
    text: string;
    setText: (value: string) => void;
    isSending: boolean;
    disabled?: boolean;
    attachments?: unknown[];
    providerType: string;
    model: string;
    setProviderType: (providerType: string) => void;
    setModel: (model: string) => void;
    stop?: () => void;
  }) => ({
    state: {
      text: options.text,
      isSending: options.isSending,
      disabled: options.disabled,
      attachments: options.attachments,
    },
    model: {
      providerType: options.providerType,
      model: options.model,
    },
    actions: {
      setText: options.setText,
      send: vi.fn(),
      stop: options.stop,
      setProviderType: options.setProviderType,
      setModel: options.setModel,
    },
    ui: {
      showModelSelector: true,
      showToolBar: true,
      showExecutionStrategy: true,
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderInputbar() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Inputbar
        input=""
        setInput={vi.fn()}
        onSend={vi.fn()}
        isLoading={false}
        characters={[]}
        skills={[]}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("Inputbar", () => {
  it("即使角色和技能为空，也应挂载 CharacterMention", () => {
    const container = renderInputbar();

    const mention = container.querySelector('[data-testid="character-mention-stub"]');
    expect(mention).toBeTruthy();
    expect(mockCharacterMention).toHaveBeenCalledTimes(1);
    expect(mockCharacterMention.mock.calls[0][0].characters).toEqual([]);
    expect(mockCharacterMention.mock.calls[0][0].skills).toEqual([]);
  });
});
