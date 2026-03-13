import { describe, expect, it } from "vitest";
import {
  classifySearchQuerySemantic,
  summarizeSearchQuerySemantics,
} from "./searchQueryGrouping";

describe("searchQueryGrouping", () => {
  it("应识别中文日期、英文日期与头条检索语义", () => {
    expect(classifySearchQuerySemantic("2026年3月13日 国际新闻").label).toBe(
      "中文日期检索",
    );
    expect(
      classifySearchQuerySemantic("March 13 2026 international news").label,
    ).toBe("英文日期检索");
    expect(
      classifySearchQuerySemantic("March 13 2026 world headlines").label,
    ).toBe("头条检索");
  });

  it("应汇总搜索语义标签数量", () => {
    const summary = summarizeSearchQuerySemantics([
      "2026年3月13日 国际新闻",
      "March 13 2026 international news",
      "March 13 2026 world headlines",
      "今日国际新闻",
    ]);

    expect(summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "中文日期检索", count: 1 }),
        expect.objectContaining({ label: "英文日期检索", count: 1 }),
        expect.objectContaining({ label: "头条检索", count: 1 }),
        expect.objectContaining({ label: "中文检索", count: 1 }),
      ]),
    );
  });
});
