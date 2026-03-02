import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceRepairBatchSummary,
  buildWorkspaceRepairSummary,
  clearWorkspaceRepairHistory,
  getWorkspaceRepairHistory,
  recordWorkspaceRepair,
} from "./workspaceHealthTelemetry";

describe("workspaceHealthTelemetry", () => {
  afterEach(() => {
    clearWorkspaceRepairHistory();
  });

  it("应记录并读取修复历史（新记录优先）", () => {
    recordWorkspaceRepair({
      workspaceId: "ws-1",
      rootPath: "/tmp/ws-1",
      source: "app_startup",
    });
    recordWorkspaceRepair({
      workspaceId: "ws-2",
      rootPath: "/tmp/ws-2",
      source: "workspace_set_default",
    });

    const history = getWorkspaceRepairHistory();
    expect(history.length).toBe(2);
    expect(history[0].workspace_id).toBe("ws-2");
    expect(history[1].workspace_id).toBe("ws-1");
  });

  it("应限制最大记录条数为 50", () => {
    for (let i = 1; i <= 55; i += 1) {
      recordWorkspaceRepair({
        workspaceId: `ws-${i}`,
        rootPath: `/tmp/ws-${i}`,
        source: "workspace_refresh",
      });
    }

    const history = getWorkspaceRepairHistory();
    expect(history.length).toBe(50);
    expect(history[0].workspace_id).toBe("ws-55");
    expect(history[49].workspace_id).toBe("ws-6");
  });

  it("应生成可复制的自愈摘要", () => {
    const summary = buildWorkspaceRepairSummary({
      timestamp: "2026-03-02T10:00:00.000Z",
      workspace_id: "ws-99",
      root_path: "/tmp/ws-99",
      source: "agent_chat_page",
    });

    expect(summary).toContain("ProxyCast Workspace 自愈记录");
    expect(summary).toContain("Workspace ID: ws-99");
    expect(summary).toContain("来源: agent_chat_page");
    expect(summary).toContain("修复后路径: /tmp/ws-99");
  });

  it("应生成批量自愈摘要", () => {
    const summary = buildWorkspaceRepairBatchSummary([
      {
        timestamp: "2026-03-02T10:00:00.000Z",
        workspace_id: "ws-1",
        root_path: "/tmp/ws-1",
        source: "app_startup",
      },
      {
        timestamp: "2026-03-02T10:02:00.000Z",
        workspace_id: "ws-2",
        root_path: "/tmp/ws-2",
        source: "agent_chat_page",
      },
    ]);

    expect(summary).toContain("ProxyCast Workspace 自愈记录（最近）");
    expect(summary).toContain("## 记录 1");
    expect(summary).toContain("Workspace ID: ws-1");
    expect(summary).toContain("## 记录 2");
    expect(summary).toContain("Workspace ID: ws-2");
  });
});
