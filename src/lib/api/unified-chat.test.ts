import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  configureProvider,
  createSession,
  deleteSession,
  generateEventName,
  getMessages,
  getSession,
  listSessions,
  parseStreamEvent,
  renameSession,
  sendMessage,
  stopGeneration,
} from "./unified-chat";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("unified-chat API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理会话与消息命令并转换消息结构", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ id: "session-1", title: "测试会话" })
      .mockResolvedValueOnce([{ id: "session-1", title: "测试会话" }])
      .mockResolvedValueOnce({ id: "session-1", title: "测试会话" })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        {
          id: 1,
          session_id: "session-1",
          role: "assistant",
          content: [{ type: "text", text: "你好" }],
          created_at: "2024-01-01T00:00:00Z",
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined);

    await expect(createSession({ mode: "general" } as never)).resolves.toEqual(
      expect.objectContaining({ id: "session-1" }),
    );
    await expect(listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "session-1" }),
    ]);
    await expect(getSession("session-1")).resolves.toEqual(
      expect.objectContaining({ id: "session-1" }),
    );
    await expect(deleteSession("session-1")).resolves.toBe(true);
    await expect(renameSession("session-1", "新标题")).resolves.toBeUndefined();
    await expect(getMessages("session-1")).resolves.toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        content: "你好",
      }),
    ]);
    await expect(
      sendMessage({ sessionId: "session-1", content: "hello" } as never),
    ).resolves.toBeUndefined();
    await expect(stopGeneration("session-1")).resolves.toBe(true);
    await expect(
      configureProvider("session-1", "openai", "gpt-4o"),
    ).resolves.toBeUndefined();
  });

  it("应解析流事件并生成事件名", () => {
    expect(parseStreamEvent({ type: "text_delta", text: "hi" })).toEqual({
      type: "text_delta",
      text: "hi",
    });
    expect(
      parseStreamEvent({ type: "tool_end", tool_id: "tool-1", result: "done" }),
    ).toEqual({
      type: "tool_end",
      tool_id: "tool-1",
      result: "done",
    });
    expect(
      parseStreamEvent({
        type: "harness_event",
        kind: "artifact_created",
        session_id: "session-1",
        stage: "drafting",
      }),
    ).toEqual({
      type: "harness_event",
      event: {
        kind: "artifact_created",
        sessionId: "session-1",
        runId: undefined,
        correlationId: undefined,
        theme: undefined,
        stage: "drafting",
        summary: undefined,
        artifact: undefined,
        metadata: undefined,
      },
    });
    expect(
      parseStreamEvent({
        type: "artifact_snapshot",
        artifact_id: "artifact-1",
        file_path: "draft.md",
        content: "# 标题",
      }),
    ).toEqual({
      type: "artifact_snapshot",
      artifact: {
        artifactId: "artifact-1",
        filePath: "draft.md",
        content: "# 标题",
        metadata: undefined,
      },
    });
    expect(parseStreamEvent({ type: "unknown" })).toBeNull();
    expect(generateEventName("session-1")).toMatch(
      /^unified-chat-stream-session-1-/,
    );
  });
});
