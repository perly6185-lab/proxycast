import { describe, expect, it } from "vitest";

import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildMessageTurnTimeline,
  mergeThreadItems,
} from "./threadTimelineView";

describe("threadTimelineView", () => {
  it("应将 turn 对齐到最近的 assistant 消息", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "旧问题",
        timestamp: new Date("2026-03-13T10:00:00Z"),
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "旧回答",
        timestamp: new Date("2026-03-13T10:00:01Z"),
      },
      {
        id: "user-2",
        role: "user",
        content: "新问题",
        timestamp: new Date("2026-03-13T10:01:00Z"),
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "新回答",
        timestamp: new Date("2026-03-13T10:01:01Z"),
      },
    ];
    const turns: AgentThreadTurn[] = [
      {
        id: "turn-2",
        thread_id: "thread-1",
        prompt_text: "新问题",
        status: "completed",
        started_at: "2026-03-13T10:01:00Z",
        completed_at: "2026-03-13T10:01:05Z",
        created_at: "2026-03-13T10:01:00Z",
        updated_at: "2026-03-13T10:01:05Z",
      },
    ];
    const items: AgentThreadItem[] = [
      {
        id: "plan-1",
        thread_id: "thread-1",
        turn_id: "turn-2",
        sequence: 2,
        status: "completed",
        started_at: "2026-03-13T10:01:02Z",
        completed_at: "2026-03-13T10:01:03Z",
        updated_at: "2026-03-13T10:01:03Z",
        type: "plan",
        text: "1. 总结\n2. 输出",
      },
    ];

    const timeline = buildMessageTurnTimeline(messages, turns, items);

    expect(timeline.has("assistant-1")).toBe(false);
    expect(timeline.get("assistant-2")?.turn.id).toBe("turn-2");
    expect(timeline.get("assistant-2")?.items).toHaveLength(1);
  });

  it("应合并并排序真实与临时 thread items", () => {
    const persistedItem: AgentThreadItem = {
      id: "item-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 1,
      status: "completed",
      started_at: "2026-03-13T10:00:00Z",
      completed_at: "2026-03-13T10:00:01Z",
      updated_at: "2026-03-13T10:00:01Z",
      type: "plan",
      text: "旧计划",
    };
    const syntheticItem: AgentThreadItem = {
      id: "item-2",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 10000,
      status: "in_progress",
      started_at: "2026-03-13T10:00:02Z",
      updated_at: "2026-03-13T10:00:02Z",
      type: "subagent_activity",
      status_label: "running",
      title: "子代理协作",
      summary: "执行中",
    };

    const items = mergeThreadItems([persistedItem], [syntheticItem]);

    expect(items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
  });
});
