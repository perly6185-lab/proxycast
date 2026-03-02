import { describe, expect, it } from "vitest";
import { resolveAppVersion } from "./appVersion";

describe("appVersion", () => {
  it("优先返回首个有效版本号", () => {
    expect(resolveAppVersion("0.77.1", "0.77.0")).toBe("0.77.1");
    expect(resolveAppVersion("unknown", "0.77.0")).toBe("0.77.0");
    expect(resolveAppVersion("", "  ", "0.77.0")).toBe("0.77.0");
  });

  it("无候选值时回退 package.json 版本", () => {
    expect(resolveAppVersion(undefined, null, "unknown")).toBe("0.77.0");
  });
});
