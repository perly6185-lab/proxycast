import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_TOOL_PREFERENCES,
  loadChatToolPreferences,
  saveChatToolPreferences,
} from "./chatToolPreferences";

describe("chatToolPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("通用对话主题默认不应强制联网搜索", () => {
    expect(loadChatToolPreferences("general")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
    expect(loadChatToolPreferences("knowledge")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
    expect(loadChatToolPreferences("planning")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
  });

  it("通用对话主题不应继承 legacy 全局偏好", () => {
    localStorage.setItem(
      "proxycast.chat.tool_preferences.v1",
      JSON.stringify({ webSearch: true, thinking: true }),
    );

    expect(loadChatToolPreferences("general")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
  });

  it("非通用主题仍可回退 legacy 全局偏好", () => {
    localStorage.setItem(
      "proxycast.chat.tool_preferences.v1",
      JSON.stringify({ webSearch: true, thinking: true, task: true, subagent: true }),
    );

    expect(loadChatToolPreferences("social-media")).toEqual({
      webSearch: true,
      thinking: true,
      task: true,
      subagent: true,
    });
  });

  it("应按主题作用域保存偏好", () => {
    saveChatToolPreferences(
      { webSearch: true, thinking: false, task: true, subagent: false },
      "planning",
    );
    saveChatToolPreferences(
      { webSearch: false, thinking: true, task: false, subagent: true },
      "general",
    );

    expect(loadChatToolPreferences("planning")).toEqual({
      webSearch: true,
      thinking: false,
      task: true,
      subagent: false,
    });
    expect(loadChatToolPreferences("general")).toEqual({
      webSearch: false,
      thinking: true,
      task: false,
      subagent: true,
    });
    expect(loadChatToolPreferences("knowledge")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
  });
});
