import { describe, expect, it } from "vitest";

import {
  splitProposedPlanSegments,
  stripProposedPlanBlocks,
} from "./proposedPlan";

describe("proposedPlan", () => {
  it("应提取计划块并保留前后文本顺序", () => {
    expect(
      splitProposedPlanSegments(
        "前言\n<proposed_plan>\n- 第一步\n- 第二步\n</proposed_plan>\n结尾",
      ),
    ).toEqual([
      { type: "text", content: "前言\n" },
      {
        type: "plan",
        content: "- 第一步\n- 第二步",
        isComplete: true,
      },
      { type: "text", content: "\n结尾" },
    ]);
  });

  it("未闭合的计划块应视为流式中的进行中计划", () => {
    expect(
      splitProposedPlanSegments("开始\n<proposed_plan>\n- 调研\n- 整理"),
    ).toEqual([
      { type: "text", content: "开始\n" },
      {
        type: "plan",
        content: "- 调研\n- 整理",
        isComplete: false,
      },
    ]);
  });

  it("应能移除计划块得到可见正文", () => {
    expect(
      stripProposedPlanBlocks(
        "before\n<proposed_plan>\n- step\n</proposed_plan>\nafter",
      ),
    ).toBe("before\nafter");
  });
});
