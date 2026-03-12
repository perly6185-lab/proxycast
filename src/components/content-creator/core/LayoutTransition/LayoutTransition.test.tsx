import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayoutMode } from "../../types";
import { LayoutTransition } from "./LayoutTransition";
import {
  cleanupMountedRoots,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "../../../workspace/hooks/testUtils";

setupReactActEnvironment();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function LayoutHarness({ mode }: { mode: LayoutMode }) {
  return (
    <div style={{ width: "1200px", height: "720px" }}>
      <LayoutTransition
        mode={mode}
        chatContent={<div data-testid="layout-chat-content">chat</div>}
        canvasContent={<div data-testid="layout-canvas-content">canvas</div>}
      />
    </div>
  );
}

function EmptyCanvasLayoutHarness({ mode }: { mode: LayoutMode }) {
  return (
    <div style={{ width: "1200px", height: "720px" }}>
      <LayoutTransition
        mode={mode}
        chatContent={<div data-testid="layout-chat-content">chat</div>}
        canvasContent={null}
      />
    </div>
  );
}

describe("LayoutTransition", () => {
  const mountedRoots: MountedRoot[] = [];

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("chat-canvas 模式应为画布与对话保留分栏间距", () => {
    const { container } = mountHarness(
      LayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );
    expect(root).not.toBeNull();

    const styles = Array.from(document.head.querySelectorAll("style"))
      .map((node) => node.textContent || "")
      .join("\n");

    const hasGapRule = Array.from(root?.classList || []).some((className) =>
      new RegExp(`\\.${escapeRegExp(className)}\\{[^}]*gap:12px;`).test(styles),
    );

    expect(hasGapRule).toBe(true);
  });

  it("画布内容为空时应退回聊天布局，避免保留空白画布列", () => {
    const { container } = mountHarness(
      EmptyCanvasLayoutHarness,
      { mode: "chat-canvas" },
      mountedRoots,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-testid="layout-transition-root"]',
    );

    expect(root?.getAttribute("data-effective-mode")).toBe("chat");
    expect(root?.getAttribute("data-has-canvas")).toBe("false");
    expect(
      container.querySelector('[data-testid="layout-chat-content"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layout-canvas-content"]'),
    ).toBeNull();
  });
});
