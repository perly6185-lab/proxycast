import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";

const mockCharacterMention = vi.fn<
  (props: {
    characters?: Character[];
    skills?: Skill[];
    onSelectSkill?: (skill: Skill) => void;
    value: string;
    onChange: (value: string) => void;
  }) => React.ReactNode
>();

vi.mock("@/hooks/useTauri", () => ({
  getConfig: vi.fn(async () => ({})),
}));

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="chat-model-selector" />,
}));

vi.mock("../utils/entryPromptComposer", () => ({
  composeEntryPrompt: vi.fn(() => ""),
  createDefaultEntrySlotValues: vi.fn(() => ({})),
  formatEntryTaskPreview: vi.fn(() => ""),
  getEntryTaskTemplate: vi.fn(() => ({ slots: [], description: "", label: "" })),
  SOCIAL_MEDIA_ENTRY_TASKS: [],
  validateEntryTaskSlots: vi.fn(() => ({ valid: true, missing: [] })),
}));

vi.mock("../utils/contextualRecommendations", () => ({
  buildRecommendationPrompt: vi.fn((fullPrompt: string) => fullPrompt),
  getContextualRecommendations: vi.fn(() => []),
}));

vi.mock("./Inputbar/components/CharacterMention", () => ({
  CharacterMention: (props: {
    characters?: Character[];
    skills?: Skill[];
    onSelectSkill?: (skill: Skill) => void;
    value: string;
    onChange: (value: string) => void;
  }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
  }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
}));

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  return { Textarea };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
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

function renderEmptyState(props?: Partial<React.ComponentProps<typeof EmptyState>>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof EmptyState> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn(),
    providerType: "openai",
    setProviderType: vi.fn(),
    model: "gpt-4.1",
    setModel: vi.fn(),
  };

  act(() => {
    root.render(<EmptyState {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("EmptyState", () => {
  it("应挂载 CharacterMention，并透传角色与技能", async () => {
    const characters: Character[] = [
      {
        id: "char-1",
        project_id: "project-1",
        name: "角色A",
        aliases: [],
        relationships: [],
        is_main: true,
        order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    const skills: Skill[] = [
      {
        key: "skill-1",
        name: "技能A",
        description: "desc",
        directory: "skill-a",
        installed: true,
      },
    ];
    const setInput = vi.fn<(value: string) => void>();

    const container = renderEmptyState({
      input: "@",
      setInput,
      characters,
      skills,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const mention = container.querySelector('[data-testid="character-mention-stub"]');
    expect(mention).toBeTruthy();
    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[mockCharacterMention.mock.calls.length - 1][0];
    expect(latestCall.characters).toEqual(characters);
    expect(latestCall.skills).toEqual(skills);

    act(() => {
      latestCall.onChange("@技能A");
    });
    expect(setInput).toHaveBeenCalledWith("@技能A");
  });

  it("选择技能后发送应自动附加 skill 前缀，且发送后清除激活技能", async () => {
    const onSend = vi.fn<
      (value: string, executionStrategy?: "react" | "code_orchestrated" | "auto") => void
    >();
    const skill: Skill = {
      key: "canvas-design",
      name: "canvas-design",
      description: "desc",
      directory: "canvas-design",
      installed: true,
    };

    const container = renderEmptyState({
      input: "帮我设计封面",
      onSend,
      skills: [skill],
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[mockCharacterMention.mock.calls.length - 1][0];
    expect(typeof latestCall.onSelectSkill).toBe("function");

    act(() => {
      latestCall.onSelectSkill?.(skill);
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("开始生成"),
    );
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith("/canvas-design 帮我设计封面", "react");

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith("帮我设计封面", "react");
  });
});
