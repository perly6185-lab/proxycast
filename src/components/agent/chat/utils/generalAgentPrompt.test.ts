import { describe, expect, it } from "vitest";

import {
  buildGeneralAgentSystemPrompt,
  isGeneralResearchTheme,
  resolveAgentChatMode,
} from "./generalAgentPrompt";

describe("generalAgentPrompt", () => {
  it("应识别通用对话主题", () => {
    expect(isGeneralResearchTheme("general")).toBe(true);
    expect(isGeneralResearchTheme("knowledge")).toBe(true);
    expect(isGeneralResearchTheme("planning")).toBe(true);
    expect(isGeneralResearchTheme("social-media")).toBe(false);
  });

  it("内容创作模式应优先返回 creator", () => {
    expect(resolveAgentChatMode("general", true)).toBe("creator");
    expect(resolveAgentChatMode("general", false)).toBe("general");
    expect(resolveAgentChatMode("social-media", false)).toBe("agent");
  });

  it("通用主题 Prompt 应避免编程和落盘默认倾向", () => {
    const prompt = buildGeneralAgentSystemPrompt(
      "general",
      {
        now: new Date("2026-03-12T12:00:00+08:00"),
        toolPreferences: {
          webSearch: false,
          thinking: false,
          task: true,
          subagent: true,
        },
      },
    );

    expect(prompt).toContain("不要把自己限制为编程助手");
    expect(prompt).toContain("不主动落盘");
    expect(prompt).toContain("需求澄清");
    expect(prompt).toContain("本回合能力快照");
    expect(prompt).toContain("执行车道");
    expect(prompt).toContain("后台任务：已开启");
    expect(prompt).toContain("多代理：已开启");
  });

  it("知识主题 Prompt 应强调事实与时效性", () => {
    const prompt = buildGeneralAgentSystemPrompt("knowledge");

    expect(prompt).toContain("知识探索");
    expect(prompt).toContain("区分事实、推断与不确定性");
    expect(prompt).toContain("优先核对时间与来源");
  });

  it("计划主题 Prompt 应强调执行节奏与风险", () => {
    const prompt = buildGeneralAgentSystemPrompt("planning");

    expect(prompt).toContain("计划规划");
    expect(prompt).toContain("阶段安排");
    expect(prompt).toContain("风险提醒");
    expect(prompt).toContain("验收标准");
  });

  it("theme workbench 场景应注入 harness 上下文", () => {
    const prompt = buildGeneralAgentSystemPrompt("general", {
      harness: {
        sessionMode: "theme_workbench",
        gateKey: "research_mode",
        runTitle: "行业分析",
        contentId: "content-1",
      },
    });

    expect(prompt).toContain("theme workbench");
    expect(prompt).toContain("当前 gate：research_mode");
    expect(prompt).toContain("当前任务标题：行业分析");
    expect(prompt).toContain("当前内容 ID：content-1");
    expect(prompt).toContain("<proposed_plan>");
  });
});
