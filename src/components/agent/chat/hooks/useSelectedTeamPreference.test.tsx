import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeamDefinition } from "../utils/teamDefinitions";
import { createTeamDefinitionFromPreset } from "../utils/teamDefinitions";
import { useSelectedTeamPreference } from "./useSelectedTeamPreference";
import {
  loadSelectedTeamReference,
  persistSelectedTeam,
} from "../utils/teamStorage";

interface HookHarness {
  getValue: () => ReturnType<typeof useSelectedTeamPreference>;
  rerender: (theme?: string | null) => void;
  unmount: () => void;
}

function mountHook(initialTheme?: string | null): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useSelectedTeamPreference> | null = null;

  function TestComponent({ theme }: { theme?: string | null }) {
    hookValue = useSelectedTeamPreference(theme);
    return null;
  }

  const render = (theme?: string | null) => {
    act(() => {
      root.render(<TestComponent theme={theme} />);
    });
  };

  render(initialTheme);

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSelectedTeamPreference", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("切换 theme 时应读取对应 Team，而不是把旧主题选择写回新主题", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;

    persistSelectedTeam(engineeringTeam, "general");
    persistSelectedTeam(researchTeam, "knowledge");

    const harness = mountHook("general");

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("code-triage-team");

      harness.rerender("knowledge");
      await flushEffects();

      expect(harness.getValue().selectedTeam?.id).toBe("research-team");
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
      expect(loadSelectedTeamReference("knowledge")).toEqual({
        id: "research-team",
        source: "builtin",
      });

      act(() => {
        harness.getValue().setSelectedTeam(null);
      });

      expect(loadSelectedTeamReference("knowledge")).toBeNull();
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });
});
