import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  buildTeamDefinitionLabel,
  buildTeamDefinitionSummary,
  createTeamDefinitionFromPreset,
} from "../utils/teamDefinitions";
import {
  persistSelectedTeam,
  resolvePersistedSelectedTeam,
} from "../utils/teamStorage";

export function useSelectedTeamPreference(theme?: string | null) {
  const [selectedTeam, setSelectedTeamState] = useState<TeamDefinition | null>(
    () => resolvePersistedSelectedTeam(theme),
  );

  useEffect(() => {
    setSelectedTeamState(resolvePersistedSelectedTeam(theme));
  }, [theme]);

  const setSelectedTeam = useCallback(
    (team: TeamDefinition | null) => {
      persistSelectedTeam(team, theme);
      setSelectedTeamState(team);
    },
    [theme],
  );

  const enableSuggestedTeam = useCallback(
    (suggestedPresetId?: string) => {
      const resolvedPresetId = suggestedPresetId?.trim();
      if (!resolvedPresetId) {
        return;
      }

      const suggestedTeam = createTeamDefinitionFromPreset(resolvedPresetId);
      if (suggestedTeam) {
        setSelectedTeam(suggestedTeam);
      }
    },
    [setSelectedTeam],
  );

  const preferredTeamPresetId = useMemo(
    () =>
      selectedTeam?.presetId?.trim() ||
      (selectedTeam?.source === "builtin" ? selectedTeam.id : undefined),
    [selectedTeam],
  );
  const selectedTeamLabel = useMemo(
    () => buildTeamDefinitionLabel(selectedTeam) || undefined,
    [selectedTeam],
  );
  const selectedTeamSummary = useMemo(
    () => buildTeamDefinitionSummary(selectedTeam) || undefined,
    [selectedTeam],
  );

  return {
    selectedTeam,
    setSelectedTeam,
    enableSuggestedTeam,
    preferredTeamPresetId,
    selectedTeamLabel,
    selectedTeamSummary,
  };
}
