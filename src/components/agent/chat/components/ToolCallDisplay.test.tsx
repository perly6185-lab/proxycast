import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallDisplay, ToolCallList } from "./ToolCallDisplay";
import type { ToolCallState } from "@/lib/api/agentStream";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderTool(toolCall: ToolCallState): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ToolCallDisplay toolCall={toolCall} />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

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
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("ToolCallDisplay", () => {
  it("WebSearch 工具结果应在 AI 对话区展示搜索列表并支持悬浮预览", async () => {
    renderTool({
      id: "tool-search-1",
      name: "WebSearch",
      arguments: JSON.stringify({ query: "3月13日国际新闻" }),
      status: "completed",
      result: {
        success: true,
        output: [
          "Xinhua world news summary at 0030 GMT, March 13",
          "https://example.com/xinhua",
          "全球要闻摘要，覆盖国际局势与市场动态。",
          "",
          "Friday morning news: March 13, 2026 | WORLD - wng.org",
          "https://example.com/wng",
          "补充国际动态与区域冲突更新。",
        ].join("\n"),
      },
      startTime: new Date("2026-03-13T12:00:00.000Z"),
      endTime: new Date("2026-03-13T12:00:02.000Z"),
    });

    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );
    expect(document.body.textContent).toContain(
      "Friday morning news: March 13, 2026 | WORLD - wng.org",
    );

    const firstSearchResult = document.body.querySelector(
      '[aria-label="预览搜索结果：Xinhua world news summary at 0030 GMT, March 13"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      firstSearchResult?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "全球要闻摘要，覆盖国际局势与市场动态。",
    );
    expect(document.body.textContent).toContain("https://example.com/xinhua");

    const collapseButton = document.body.querySelector(
      'button[title="收起详情"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    expect(document.body.textContent).not.toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );

    const expandButton = document.body.querySelector(
      'button[title="展开详情"]',
    ) as HTMLButtonElement | null;

    act(() => {
      expandButton?.click();
    });

    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );
  });

  it("连续多次 WebSearch 应在对话区按搜索批次分组展示", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallList
          toolCalls={[
            {
              id: "tool-search-1",
              name: "WebSearch",
              arguments: JSON.stringify({ query: "3月13日国际新闻" }),
              status: "completed",
              result: { success: true, output: "https://example.com/1" },
              startTime: new Date("2026-03-13T12:00:00.000Z"),
              endTime: new Date("2026-03-13T12:00:01.000Z"),
            },
            {
              id: "tool-search-2",
              name: "WebSearch",
              arguments: JSON.stringify({ query: "March 13 2026 world headlines" }),
              status: "completed",
              result: { success: true, output: "https://example.com/2" },
              startTime: new Date("2026-03-13T12:00:02.000Z"),
              endTime: new Date("2026-03-13T12:00:03.000Z"),
            },
          ]}
        />,
      );
    });

    mountedRoots.push({ container, root });

    expect(container.textContent).toContain("已搜索 2 组查询");
    expect(container.textContent).toContain("3月13日国际新闻");
    expect(container.textContent).toContain("March 13 2026 world headlines");
    expect(container.textContent).toContain("中文日期检索");
    expect(container.textContent).toContain("头条检索");
  });
});
