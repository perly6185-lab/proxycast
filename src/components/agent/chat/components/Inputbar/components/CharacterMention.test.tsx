import React, { useRef, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterMention } from "./CharacterMention";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
  },
}));

vi.mock("@/components/ui/popover", () => {
  const Popover = ({
    open,
    children,
  }: {
    open?: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="mention-popover">{children}</div> : null);

  const PopoverTrigger = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );

  const PopoverContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
  >(({ children, className, style }, ref) => (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  ));

  return { Popover, PopoverTrigger, PopoverContent };
});

vi.mock("@/components/ui/command", () => {
  const Command = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
  >(({ children, ...props }, ref) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  ));

  const CommandInput = ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      data-testid="mention-command-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onValueChange?.(e.target.value)}
    />
  );

  const CommandList = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  const CommandGroup = ({
    heading,
    children,
  }: {
    heading?: string;
    children: React.ReactNode;
  }) => (
    <section>
      {heading && <div>{heading}</div>}
      {children}
    </section>
  );

  const CommandItem = ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  );

  const CommandEmpty = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return {
    Command,
    CommandInput,
    CommandList,
    CommandGroup,
    CommandItem,
    CommandEmpty,
  };
});

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

interface HarnessProps {
  characters?: Character[];
  skills?: Skill[];
  syncValue?: boolean;
  onNavigateToSettings?: () => void;
  onChangeSpy?: (value: string) => void;
}

const Harness: React.FC<HarnessProps> = ({
  characters = [],
  skills = [],
  syncValue = true,
  onNavigateToSettings,
  onChangeSpy,
}) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <textarea
        ref={inputRef}
        data-testid="mention-input"
        defaultValue=""
        onChange={(event) => {
          if (syncValue) {
            setValue(event.target.value);
          }
        }}
      />
      <CharacterMention
        characters={characters}
        skills={skills}
        inputRef={inputRef}
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          if (syncValue) {
            setValue(next);
          }
        }}
        onNavigateToSettings={onNavigateToSettings}
      />
    </div>
  );
};

function renderHarness(props: HarnessProps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Harness {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector(
    '[data-testid="mention-input"]',
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    throw new Error("未找到输入框");
  }
  return textarea;
}

function typeAt(textarea: HTMLTextAreaElement) {
  act(() => {
    textarea.focus();
    textarea.value = "@";
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function createSkill(name: string, key: string, installed: boolean): Skill {
  return {
    key,
    name,
    description: "测试技能",
    directory: `${key}-dir`,
    installed,
    sourceKind: "builtin",
  };
}

function createCharacter(name: string): Character {
  const now = new Date().toISOString();
  return {
    id: "char-1",
    project_id: "project-1",
    name,
    aliases: [],
    description: "测试角色",
    personality: undefined,
    background: undefined,
    appearance: undefined,
    relationships: [],
    avatar_url: undefined,
    is_main: true,
    order: 0,
    extra: undefined,
    created_at: now,
    updated_at: now,
  };
}

describe("CharacterMention", () => {
  it("输入 @ 当次应弹出提及面板（不依赖受控 value 同步）", () => {
    const container = renderHarness({
      characters: [createCharacter("测试角色")],
      syncValue: false,
    });
    const textarea = getTextarea(container);

    typeAt(textarea);

    expect(document.body.textContent).toContain("测试角色");
  });

  it("无角色和技能时仍显示空态，并可跳转技能设置", () => {
    const onNavigateToSettings = vi.fn<() => void>();
    const container = renderHarness({
      characters: [],
      skills: [],
      onNavigateToSettings,
    });
    const textarea = getTextarea(container);

    typeAt(textarea);

    expect(document.body.textContent).toContain("暂无可用角色或技能");
    const settingsButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("去技能设置"),
    );

    expect(settingsButton).toBeTruthy();
    act(() => {
      settingsButton?.click();
    });
    expect(onNavigateToSettings).toHaveBeenCalledTimes(1);
  });

  it("未提供 onSelectSkill 时，选择已安装技能应回填到输入框", () => {
    const onChangeSpy = vi.fn<(value: string) => void>();
    const container = renderHarness({
      skills: [createSkill("技能A", "skill-a", true)],
      onChangeSpy,
    });
    const textarea = getTextarea(container);

    typeAt(textarea);

    const skillButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("技能A"),
    );
    expect(skillButton).toBeTruthy();

    act(() => {
      skillButton?.click();
    });

    expect(onChangeSpy).toHaveBeenCalledWith("/skill-a ");
  });
});
