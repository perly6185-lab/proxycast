import { describe, expect, it } from "vitest";
import { normalizeToolCallingConfig } from "./tool-calling-config";

describe("normalizeToolCallingConfig", () => {
  it("应在配置缺失时返回默认值", () => {
    expect(normalizeToolCallingConfig(undefined)).toEqual({
      enabled: true,
      dynamic_filtering: true,
      native_input_examples: false,
    });
  });

  it("应保留传入的显式配置", () => {
    expect(
      normalizeToolCallingConfig({
        enabled: false,
        dynamic_filtering: false,
        native_input_examples: true,
      }),
    ).toEqual({
      enabled: false,
      dynamic_filtering: false,
      native_input_examples: true,
    });
  });
});
