import { describe, expect, it } from "vitest";
import { parseStreamEvent } from "./agentStream";

describe("agentStream.parseStreamEvent", () => {
  it("兼容嵌套 artifact_snapshot 结构", () => {
    expect(
      parseStreamEvent({
        type: "artifact_snapshot",
        artifact: {
          artifactId: "artifact-1",
          filePath: "drafts/demo.md",
          content: "# 标题",
          metadata: {
            complete: false,
            writePhase: "streaming",
          },
        },
      }),
    ).toEqual({
      type: "artifact_snapshot",
      artifact: {
        artifactId: "artifact-1",
        filePath: "drafts/demo.md",
        content: "# 标题",
        metadata: {
          complete: false,
          writePhase: "streaming",
        },
      },
    });
  });

  it("应解析 runtime_status 与 thinking_delta 事件", () => {
    expect(
      parseStreamEvent({
        type: "runtime_status",
        status: {
          phase: "routing",
          title: "已决定：先深度思考",
          detail: "先做意图理解，再决定是否搜索。",
          checkpoints: ["thinking 已开启", "搜索保持候选状态"],
        },
      }),
    ).toEqual({
      type: "runtime_status",
      status: {
        phase: "routing",
        title: "已决定：先深度思考",
        detail: "先做意图理解，再决定是否搜索。",
        checkpoints: ["thinking 已开启", "搜索保持候选状态"],
      },
    });

    expect(
      parseStreamEvent({
        type: "thinking_delta",
        text: "先判断任务性质",
      }),
    ).toEqual({
      type: "thinking_delta",
      text: "先判断任务性质",
    });
  });

  it("应解析队列事件", () => {
    expect(
      parseStreamEvent({
        type: "queue_added",
        session_id: "session-1",
        queued_turn: {
          queued_turn_id: "queued-1",
          message_preview: "继续写完提案",
          message_text: "继续写完提案，补齐目录结构并输出一版正式稿",
          created_at: 1700000000000,
          image_count: 1,
          position: 1,
        },
      }),
    ).toEqual({
      type: "queue_added",
      session_id: "session-1",
      queued_turn: {
        queued_turn_id: "queued-1",
        message_preview: "继续写完提案",
        message_text: "继续写完提案，补齐目录结构并输出一版正式稿",
        created_at: 1700000000000,
        image_count: 1,
        position: 1,
      },
    });
  });

  it("应兼容 camelCase 的队列快照字段", () => {
    expect(
      parseStreamEvent({
        type: "queue_added",
        session_id: "session-2",
        queued_turn: {
          queuedTurnId: "queued-2",
          messagePreview: "整理采访提纲",
          messageText: "整理采访提纲，并补上关键追问问题",
          createdAt: 1700000000001,
          imageCount: 2,
          position: 3,
        },
      }),
    ).toEqual({
      type: "queue_added",
      session_id: "session-2",
      queued_turn: {
        queued_turn_id: "queued-2",
        message_preview: "整理采访提纲",
        message_text: "整理采访提纲，并补上关键追问问题",
        created_at: 1700000000001,
        image_count: 2,
        position: 3,
      },
    });
  });
});
