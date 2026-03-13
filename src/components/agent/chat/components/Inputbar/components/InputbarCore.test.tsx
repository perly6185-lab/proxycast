import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputbarCore } from "./InputbarCore";

vi.mock("./InputbarTools", () => ({
  InputbarTools: () => <div data-testid="inputbar-tools">tools</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

const renderInputbarCore = (
  props?: Partial<React.ComponentProps<typeof InputbarCore>>,
) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InputbarCore
        text=""
        setText={vi.fn()}
        onSend={vi.fn()}
        activeTools={{}}
        onToolClick={vi.fn()}
        showTranslate={false}
        toolMode="attach-only"
        visualVariant="floating"
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
};

describe("InputbarCore", () => {
  it("主题工作台未聚焦时应使用单行紧凑态，点击展开，移出后收起", () => {
    const container = renderInputbarCore();
    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const inputBar = container.querySelector(
      '[data-testid="inputbar-core-container"]',
    ) as HTMLDivElement | null;
    expect(textarea).toBeTruthy();
    expect(inputBar).toBeTruthy();
    expect(textarea?.className).toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();

    act(() => {
      inputBar?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      textarea?.focus();
    });

    expect(textarea?.className).not.toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeTruthy();

    act(() => {
      inputBar?.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(textarea?.className).not.toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeTruthy();

    act(() => {
      textarea?.blur();
      inputBar?.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(textarea?.className).toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();
  });

  it("生成中应显示排队与停止按钮，并渲染排队列表", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const container = renderInputbarCore({
      text: "下一条需求",
      onSend,
      onStop,
      isLoading: true,
      queuedTurns: [
        {
          queued_turn_id: "queued-1",
          message_preview: "本周复盘摘要",
          message_text: "这里是完整的排队输入内容，点击后应展开查看。",
          created_at: 1700000000000,
          image_count: 0,
          position: 1,
        },
      ],
    });

    const queueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("排队"),
    );
    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("停止"),
    );

    expect(queueButton).toBeTruthy();
    expect(stopButton).toBeTruthy();
    expect(container.textContent).toContain("已排队 1");
    expect(container.textContent).not.toContain("这里是完整的排队输入内容");

    const queueCard = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("本周复盘摘要"),
    );
    expect(queueCard).toBeTruthy();

    act(() => {
      queueCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("这里是完整的排队输入内容");

    act(() => {
      queueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
