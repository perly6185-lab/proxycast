import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { toast } from "sonner";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { getProjectMemory, type ProjectMemory } from "@/lib/api/memory";
import { logAgentDebug } from "@/lib/agentDebug";
import { skillsApi, type Skill } from "@/lib/api/skills";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import type { ThemeType } from "@/components/content-creator/types";
import { EmptyState } from "./components/EmptyState";
import type { CreationMode } from "./components/types";
import { buildClawAgentParams } from "@/lib/workspace/navigation";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_PROVIDER,
  GLOBAL_MODEL_PREF_KEY,
  GLOBAL_PROVIDER_PREF_KEY,
  getAgentPreferenceKeys,
  loadPersisted,
  loadPersistedString,
  savePersisted,
} from "./hooks/agentChatStorage";
import { normalizeExecutionStrategy } from "./hooks/agentChatCoreUtils";
import type { MessageImage } from "./types";
import {
  loadChatToolPreferences,
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "./utils/chatToolPreferences";
import { isTeamRuntimeRecommendation } from "./utils/contextualRecommendations";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import { useSelectedTeamPreference } from "./hooks/useSelectedTeamPreference";

const SUPPORTED_ENTRY_THEMES: ThemeType[] = [
  "general",
  "social-media",
  "poster",
  "music",
  "knowledge",
  "planning",
  "document",
  "video",
  "novel",
];

const HOME_ENHANCEMENT_IDLE_TIMEOUT_MS = 1_500;
const HOME_ENHANCEMENT_FALLBACK_DELAY_MS = 180;
const LAST_PROJECT_ID_KEY = "agent_last_project_id";

const PageContainer = styled.div<{ $compact?: boolean }>`
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
  min-height: 0;
  gap: ${({ $compact }) => ($compact ? "8px" : "14px")};
  padding: ${({ $compact }) => ($compact ? "8px" : "14px")};
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(
      circle at 14% 18%,
      rgba(56, 189, 248, 0.1),
      transparent 30%
    ),
    radial-gradient(
      circle at 86% 14%,
      rgba(16, 185, 129, 0.08),
      transparent 28%
    ),
    radial-gradient(
      circle at 72% 84%,
      rgba(245, 158, 11, 0.06),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      rgba(248, 250, 252, 0.98) 0%,
      rgba(248, 250, 252, 0.96) 42%,
      rgba(242, 251, 247, 0.94) 100%
    );

  > * {
    position: relative;
    z-index: 1;
  }
`;

const MainArea = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: ${({ $compact }) => ($compact ? "24px" : "32px")};
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(248, 250, 252, 0.94) 56%,
    rgba(248, 250, 252, 0.88) 100%
  );
  box-shadow:
    0 24px 72px -36px rgba(15, 23, 42, 0.18),
    0 16px 28px -24px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(18px);
`;

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
`;

const ChatContainerInner = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.78) 0%,
    rgba(255, 255, 255, 0.12) 18%,
    rgba(255, 255, 255, 0) 100%
  );
`;

const ThemeWorkbenchLayoutShell = styled.div<{ $bottomInset: string }>`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: ${({ $bottomInset }) => $bottomInset};
  transition: padding-bottom 0.2s ease;
`;

function normalizeInitialTheme(value?: string): ThemeType {
  if (!value) return "general";
  if (SUPPORTED_ENTRY_THEMES.includes(value as ThemeType)) {
    return value as ThemeType;
  }
  return "general";
}

function scheduleDeferredHomeEnhancement(task: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), {
      timeout: HOME_ENHANCEMENT_IDLE_TIMEOUT_MS,
    });
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(task, HOME_ENHANCEMENT_FALLBACK_DELAY_MS);
  return () => {
    window.clearTimeout(timeoutId);
  };
}

function loadPersistedProjectId(key: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      return normalizeProjectId(typeof parsed === "string" ? parsed : stored);
    } catch {
      return normalizeProjectId(stored);
    }
  } catch {
    return null;
  }
}

function savePersistedProjectId(key: string, projectId: string) {
  const normalized = normalizeProjectId(projectId);
  if (!normalized) {
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch {
    // ignore write errors
  }
}

function resolveExecutionStrategyStorageKey(
  projectId?: string | null,
): string | null {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return null;
  }

  return `aster_execution_strategy_${normalizedProjectId}`;
}

function resolvePersistedProviderModel(projectId?: string | null): {
  providerType: string;
  model: string;
} {
  const { providerKey, modelKey } = getAgentPreferenceKeys(projectId);
  return {
    providerType:
      loadPersistedString(providerKey) ||
      loadPersistedString(GLOBAL_PROVIDER_PREF_KEY) ||
      DEFAULT_AGENT_PROVIDER,
    model:
      loadPersistedString(modelKey) ||
      loadPersistedString(GLOBAL_MODEL_PREF_KEY) ||
      DEFAULT_AGENT_MODEL,
  };
}

function resolvePersistedExecutionStrategy(
  projectId?: string | null,
): AsterExecutionStrategy {
  const storageKey = resolveExecutionStrategyStorageKey(projectId);
  if (!storageKey) {
    return "react";
  }

  return normalizeExecutionStrategy(loadPersisted<string | null>(storageKey, "react"));
}

export interface AgentChatWorkspaceBootstrap {
  projectId?: string;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  theme?: string;
  initialCreationMode?: CreationMode;
  openBrowserAssistOnMount?: boolean;
  newChatAt?: number;
}

interface AgentChatHomeShellProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  theme?: string;
  initialCreationMode?: CreationMode;
  lockTheme?: boolean;
  onEnterWorkspace: (payload: AgentChatWorkspaceBootstrap) => void;
}

export function AgentChatHomeShell({
  onNavigate,
  projectId: externalProjectId,
  theme: initialTheme,
  initialCreationMode,
  lockTheme = false,
  onEnterWorkspace,
}: AgentChatHomeShellProps) {
  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const [input, setInput] = useState("");
  const [activeTheme, setActiveTheme] = useState<string>(normalizedEntryTheme);
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const [chatToolPreferences, setChatToolPreferences] =
    useState<ChatToolPreferences>(() =>
      loadChatToolPreferences(normalizedEntryTheme),
    );
  const [chatToolPreferencesTheme, setChatToolPreferencesTheme] =
    useState<string>(normalizedEntryTheme);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(
    () =>
      normalizeProjectId(externalProjectId) ??
      loadPersistedProjectId(LAST_PROJECT_ID_KEY),
  );
  const initialProviderModel = resolvePersistedProviderModel(currentProjectId);
  const [providerType, setProviderTypeState] = useState(
    initialProviderModel.providerType,
  );
  const [model, setModelState] = useState(initialProviderModel.model);
  const [executionStrategy, setExecutionStrategyState] =
    useState<AsterExecutionStrategy>(() =>
      resolvePersistedExecutionStrategy(currentProjectId),
    );
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [browserAssistLoading, setBrowserAssistLoading] = useState(false);
  const {
    selectedTeam,
    setSelectedTeam: handleSelectTeam,
    enableSuggestedTeam: handleEnableSuggestedTeam,
  } = useSelectedTeamPreference(activeTheme);

  useEffect(() => {
    setActiveTheme(normalizeInitialTheme(initialTheme));
  }, [initialTheme]);

  useEffect(() => {
    if (!initialCreationMode) {
      return;
    }
    setCreationMode(initialCreationMode);
  }, [initialCreationMode]);

  useEffect(() => {
    setCurrentProjectId(
      normalizeProjectId(externalProjectId) ??
        loadPersistedProjectId(LAST_PROJECT_ID_KEY),
    );
  }, [externalProjectId]);

  useEffect(() => {
    if (chatToolPreferencesTheme === activeTheme) {
      return;
    }

    setChatToolPreferences(loadChatToolPreferences(activeTheme));
    setChatToolPreferencesTheme(activeTheme);
  }, [activeTheme, chatToolPreferencesTheme]);

  useEffect(() => {
    if (chatToolPreferencesTheme !== activeTheme) {
      return;
    }

    saveChatToolPreferences(chatToolPreferences, activeTheme);
  }, [activeTheme, chatToolPreferences, chatToolPreferencesTheme]);

  useEffect(() => {
    const nextPreferences = resolvePersistedProviderModel(currentProjectId);
    setProviderTypeState(nextPreferences.providerType);
    setModelState(nextPreferences.model);
    setExecutionStrategyState(resolvePersistedExecutionStrategy(currentProjectId));
  }, [currentProjectId]);

  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(currentProjectId);
    if (!normalizedProjectId) {
      setProjectMemory(null);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    logAgentDebug("AgentChatHomeShell", "loadProjectMemory.start", {
      projectId: normalizedProjectId,
    });

    void getProjectMemory(normalizedProjectId)
      .then((memory) => {
        if (cancelled) {
          return;
        }
        setProjectMemory(memory);
        logAgentDebug("AgentChatHomeShell", "loadProjectMemory.success", {
          durationMs: Date.now() - startedAt,
          projectId: normalizedProjectId,
          charactersCount: memory.characters.length,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setProjectMemory(null);
        logAgentDebug(
          "AgentChatHomeShell",
          "loadProjectMemory.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            projectId: normalizedProjectId,
          },
          { level: "warn" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  const loadSkills = useCallback(
    async (includeRemote = false): Promise<Skill[]> => {
      const startedAt = Date.now();
      logAgentDebug("AgentChatHomeShell", "loadSkills.start", {
        includeRemote,
      });
      setSkillsLoading(true);
      try {
        const loadedSkills = includeRemote
          ? await skillsApi.getAll("lime")
          : await skillsApi.getLocal("lime");
        setSkills(loadedSkills);
        logAgentDebug("AgentChatHomeShell", "loadSkills.success", {
          durationMs: Date.now() - startedAt,
          includeRemote,
          skillsCount: loadedSkills.length,
        });
        return loadedSkills;
      } catch (error) {
        setSkills([]);
        logAgentDebug(
          "AgentChatHomeShell",
          "loadSkills.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            includeRemote,
          },
          { level: "warn" },
        );
        return [];
      } finally {
        setSkillsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    return scheduleDeferredHomeEnhancement(() => {
      void loadSkills(false);
    });
  }, [loadSkills]);

  const setProviderType = useCallback(
    (nextProviderType: string) => {
      setProviderTypeState(nextProviderType);
      const { providerKey } = getAgentPreferenceKeys(currentProjectId);
      savePersisted(providerKey, nextProviderType);
    },
    [currentProjectId],
  );

  const setModel = useCallback(
    (nextModel: string) => {
      setModelState(nextModel);
      const { modelKey } = getAgentPreferenceKeys(currentProjectId);
      savePersisted(modelKey, nextModel);
    },
    [currentProjectId],
  );

  const setExecutionStrategy = useCallback(
    (nextExecutionStrategy: AsterExecutionStrategy) => {
      const normalized = normalizeExecutionStrategy(nextExecutionStrategy);
      setExecutionStrategyState(normalized);
      const storageKey = resolveExecutionStrategyStorageKey(currentProjectId);
      if (!storageKey) {
        return;
      }
      savePersisted(storageKey, normalized);
    },
    [currentProjectId],
  );

  const handleRefreshSkills = useCallback(async () => {
    await loadSkills(true);
  }, [loadSkills]);

  const handleProjectChange = useCallback(
    (nextProjectId: string) => {
      if (externalProjectId) {
        return;
      }

      const normalizedProjectId = normalizeProjectId(nextProjectId);
      setCurrentProjectId(normalizedProjectId);
      if (normalizedProjectId) {
        savePersistedProjectId(LAST_PROJECT_ID_KEY, normalizedProjectId);
      }
    },
    [externalProjectId],
  );

  const handleEnterWorkspace = useCallback(
    (payload: {
      prompt?: string;
      images?: MessageImage[];
      openBrowserAssistOnMount?: boolean;
      toolPreferences?: ChatToolPreferences;
    }) => {
      const normalizedProjectId = normalizeProjectId(currentProjectId);
      const hasPrompt = Boolean(payload.prompt?.trim());
      const hasImages = Boolean(payload.images?.length);
      const effectiveToolPreferences =
        payload.toolPreferences ?? chatToolPreferences;

      if (!payload.openBrowserAssistOnMount && !normalizedProjectId) {
        toast.error("缺少项目工作区，请先选择项目后再使用 Agent");
        return;
      }

      if (!payload.openBrowserAssistOnMount && !hasPrompt && !hasImages) {
        return;
      }

      if (normalizedProjectId) {
        savePersistedProjectId(LAST_PROJECT_ID_KEY, normalizedProjectId);
      }
      saveChatToolPreferences(effectiveToolPreferences, activeTheme);
      const nextNewChatAt = Date.now();

      if (onNavigate) {
        onNavigate(
          "agent",
          buildClawAgentParams({
            projectId: normalizedProjectId ?? undefined,
            theme: activeTheme,
            initialCreationMode: creationMode,
            initialUserPrompt: payload.prompt,
            initialUserImages: payload.images,
            openBrowserAssistOnMount: payload.openBrowserAssistOnMount,
            newChatAt: nextNewChatAt,
          }),
        );
        return;
      }

      onEnterWorkspace({
        projectId: normalizedProjectId ?? undefined,
        initialUserPrompt: payload.prompt,
        initialUserImages: payload.images,
        theme: activeTheme,
        initialCreationMode: creationMode,
        openBrowserAssistOnMount: payload.openBrowserAssistOnMount,
        newChatAt: nextNewChatAt,
      });
    },
    [
      activeTheme,
      chatToolPreferences,
      creationMode,
      currentProjectId,
      onEnterWorkspace,
      onNavigate,
    ],
  );

  const handleRecommendationClick = useCallback(
    (shortLabel: string, fullPrompt: string) => {
      setInput(fullPrompt);

      if (
        activeTheme !== "general" ||
        !isTeamRuntimeRecommendation(shortLabel, fullPrompt)
      ) {
        return;
      }

      const nextToolPreferences = chatToolPreferences.subagent
        ? chatToolPreferences
        : {
            ...chatToolPreferences,
            subagent: true,
          };

      if (!chatToolPreferences.subagent) {
        setChatToolPreferences(nextToolPreferences);
      }
      saveChatToolPreferences(nextToolPreferences, activeTheme);
      handleEnterWorkspace({
        prompt: fullPrompt,
        toolPreferences: nextToolPreferences,
      });
    },
    [activeTheme, chatToolPreferences, handleEnterWorkspace],
  );

  return (
    <PageContainer>
      <MainArea>
        <ThemeWorkbenchLayoutShell $bottomInset="0">
          <ChatContainer>
            <ChatContainerInner>
              <EmptyState
                input={input}
                setInput={setInput}
                onSend={(value, sendExecutionStrategy, images) => {
                  if (sendExecutionStrategy) {
                    setExecutionStrategy(sendExecutionStrategy);
                  }
                  handleEnterWorkspace({
                    prompt: value,
                    images,
                  });
                }}
                providerType={providerType}
                setProviderType={setProviderType}
                model={model}
                setModel={setModel}
                modelSelectorBackgroundPreload="idle"
                executionStrategy={executionStrategy}
                setExecutionStrategy={setExecutionStrategy}
                onManageProviders={() => {
                  onNavigate?.("settings", {
                    tab: SettingsTabs.Providers,
                  });
                }}
                webSearchEnabled={chatToolPreferences.webSearch}
                onWebSearchEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    webSearch: enabled,
                  }))
                }
                thinkingEnabled={chatToolPreferences.thinking}
                onThinkingEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    thinking: enabled,
                  }))
                }
                taskEnabled={chatToolPreferences.task}
                onTaskEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    task: enabled,
                  }))
                }
                subagentEnabled={chatToolPreferences.subagent}
                onSubagentEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    subagent: enabled,
                  }))
                }
                selectedTeam={selectedTeam}
                onSelectTeam={handleSelectTeam}
                onEnableSuggestedTeam={handleEnableSuggestedTeam}
                creationMode={creationMode}
                onCreationModeChange={setCreationMode}
                activeTheme={activeTheme}
                onThemeChange={(theme) => {
                  if (!lockTheme) {
                    setActiveTheme(theme);
                  }
                }}
                showThemeTabs={false}
                hasCanvasContent={false}
                hasContentId={false}
                selectedText=""
                onRecommendationClick={handleRecommendationClick}
                characters={projectMemory?.characters || []}
                skills={skills}
                isSkillsLoading={skillsLoading}
                onNavigateToSettings={() => {
                  onNavigate?.("settings", {
                    tab: SettingsTabs.Skills,
                  });
                }}
                onRefreshSkills={handleRefreshSkills}
                onLaunchBrowserAssist={() => {
                  if (activeTheme !== "general") {
                    return;
                  }
                  setBrowserAssistLoading(true);
                  handleEnterWorkspace({
                    prompt: input,
                    openBrowserAssistOnMount: true,
                  });
                }}
                browserAssistLoading={browserAssistLoading}
                projectId={currentProjectId}
                onProjectChange={handleProjectChange}
                skipProjectSelectorWorkspaceReadyCheck
                deferProjectSelectorListLoad
                configLoadStrategy="idle"
                onOpenSettings={() => {
                  onNavigate?.("settings", {
                    tab: SettingsTabs.Appearance,
                  });
                }}
              />
            </ChatContainerInner>
          </ChatContainer>
        </ThemeWorkbenchLayoutShell>
      </MainArea>
    </PageContainer>
  );
}
