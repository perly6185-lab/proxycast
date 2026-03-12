import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { Message } from "../types";

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content || "<empty>"}</div>
  ),
}));

const mockStreamingRenderer = vi.fn(
  ({
    content,
  }: {
    content: string;
    renderA2UIInline?: boolean;
  }) => (
    <div data-testid="streaming-renderer">{content || "<empty-assistant>"}</div>
  ),
);

vi.mock("./StreamingRenderer", () => ({
  StreamingRenderer: (props: {
    content: string;
    renderA2UIInline?: boolean;
  }) => mockStreamingRenderer(props),
}));

vi.mock("./TokenUsageDisplay", () => ({
  TokenUsageDisplay: () => <div data-testid="token-usage-display" />,
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
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

function render(
  messages: Message[],
  props?: { renderA2UIInline?: boolean },
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<MessageList messages={messages} {...props} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("MessageList", () => {
  it("应过滤空白 user 消息，避免渲染空白气泡", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-empty",
        role: "user",
        content: "",
        timestamp: now,
      },
      {
        id: "msg-user-text",
        role: "user",
        content: "请继续生成",
        timestamp: now,
      },
      {
        id: "msg-assistant",
        role: "assistant",
        content: "好的，我继续处理。",
        timestamp: now,
      },
    ];

    const container = render(messages);

    const markdownTexts = Array.from(
      container.querySelectorAll('[data-testid="markdown-renderer"]'),
    ).map((node) => node.textContent);
    expect(markdownTexts).toEqual(["请继续生成"]);

    const streamingTexts = Array.from(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    ).map((node) => node.textContent);
    expect(streamingTexts).toEqual(["好的，我继续处理。"]);
  });

  it("应向助手消息透传内联 A2UI 开关", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant",
        role: "assistant",
        content: "```a2ui\n{}\n```",
        timestamp: now,
      },
    ];

    render(messages);
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ renderA2UIInline: true }),
    );

    render(messages, { renderA2UIInline: false });
    expect(mockStreamingRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ renderA2UIInline: false }),
    );
  });

  it("助手消息包含 artifacts 时应渲染产物卡片并响应点击", () => {
    const now = new Date();
    const onArtifactClick = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-artifact",
        role: "assistant",
        content: "已生成文档",
        timestamp: now,
        artifacts: [
          {
            id: "artifact-demo",
            type: "document",
            title: "demo.md",
            content: "# Demo",
            status: "complete",
            meta: {
              filePath: "docs/demo.md",
              filename: "demo.md",
            },
            position: { start: 0, end: 0 },
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
          },
        ],
      },
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MessageList messages={messages} onArtifactClick={onArtifactClick} />,
      );
    });

    mountedRoots.push({ container, root });

    const artifactCard = container.querySelector("button");
    expect(artifactCard?.textContent).toContain("demo.md");
    expect(artifactCard?.textContent).toContain("docs/demo.md");

    act(() => {
      artifactCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onArtifactClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "artifact-demo",
        title: "demo.md",
      }),
    );
  });
});
