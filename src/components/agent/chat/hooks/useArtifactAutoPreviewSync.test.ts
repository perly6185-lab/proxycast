import { describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import {
  mergePreviewContentIntoArtifact,
  shouldAutoSyncArtifactPreview,
} from "./useArtifactAutoPreviewSync";

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

describe("useArtifactAutoPreviewSync helpers", () => {
  it("空内容的 pending artifact 应触发自动预览同步", () => {
    const artifact = createArtifact({
      status: "pending",
      meta: {
        filePath: "workspace/demo.md",
        writePhase: "preparing",
      },
    });

    expect(shouldAutoSyncArtifactPreview(artifact)).toBe(true);
  });

  it("已经完成且有内容的 artifact 不应继续轮询", () => {
    const artifact = createArtifact({
      status: "complete",
      content: "# 已完成",
      meta: {
        filePath: "workspace/demo.md",
        writePhase: "completed",
      },
    });

    expect(shouldAutoSyncArtifactPreview(artifact)).toBe(false);
  });

  it("读取到文件内容后应把 preview 合并回 artifact", () => {
    const artifact = createArtifact({
      status: "streaming",
      meta: {
        filePath: "workspace/demo.md",
        writePhase: "streaming",
      },
    });

    const merged = mergePreviewContentIntoArtifact(artifact, {
      path: "workspace/demo.md",
      content: "# 标题\n\n第一段",
    });

    expect(merged).not.toBeNull();
    expect(merged?.content).toContain("第一段");
    expect(merged?.status).toBe("streaming");
    expect(merged?.meta.writePhase).toBe("streaming");
  });

  it("已有更长内容时不应被更短的 preview 回退覆盖", () => {
    const artifact = createArtifact({
      status: "streaming",
      content: "# 标题\n\n第一段\n第二段",
      meta: {
        filePath: "workspace/demo.md",
        writePhase: "streaming",
      },
    });

    const merged = mergePreviewContentIntoArtifact(artifact, {
      path: "workspace/demo.md",
      content: "# 标题\n\n第一段",
    });

    expect(merged).toBeNull();
  });
});
