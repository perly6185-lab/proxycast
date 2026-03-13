import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactRenderer } from "./ArtifactRenderer";
import type { Artifact } from "@/lib/artifact/types";

interface MountedRenderer {
  container: HTMLDivElement;
  root: Root;
}

const mountedRenderers: MountedRenderer[] = [];

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  const content = overrides.content ?? "";
  return {
    id: overrides.id ?? "artifact-1",
    type: overrides.type ?? "document",
    title: overrides.title ?? "demo.md",
    content,
    status: overrides.status ?? "pending",
    meta: {
      filePath: overrides.meta?.filePath ?? "workspace/demo.md",
      filename: overrides.meta?.filename ?? "demo.md",
      ...overrides.meta,
    },
    position: overrides.position ?? { start: 0, end: content.length },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

function renderArtifact(artifact: Artifact) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ArtifactRenderer artifact={artifact} tone="light" />);
  });

  mountedRenderers.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRenderers.length > 0) {
    const mounted = mountedRenderers.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("ArtifactRenderer 空内容态", () => {
  it("流式写入但暂无内容时应展示类型化骨架", () => {
    const container = renderArtifact(
      createArtifact({
        type: "code",
        title: "index.ts",
        status: "streaming",
        meta: {
          filePath: "workspace/index.ts",
          writePhase: "streaming",
          language: "typescript",
        },
      }),
    );

    const surface = container.querySelector(
      "[data-testid=\"artifact-empty-surface\"]",
    );

    expect(surface).not.toBeNull();
    expect(surface?.getAttribute("data-empty-mode")).toBe("writing");
    expect(container.textContent).toContain("正在写入");
    expect(container.textContent).toContain("workspace/index.ts");
  });

  it("失败且没有内容时应展示错误解释态", () => {
    const container = renderArtifact(
      createArtifact({
        status: "error",
        error: "保存失败",
        meta: {
          filePath: "workspace/broken.md",
          writePhase: "failed",
        },
      }),
    );

    const surface = container.querySelector(
      "[data-testid=\"artifact-empty-surface\"]",
    );

    expect(surface?.getAttribute("data-empty-mode")).toBe("failed");
    expect(container.textContent).toContain("写入未完成");
    expect(container.textContent).toContain("保存失败");
  });
});
