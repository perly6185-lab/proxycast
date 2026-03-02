import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  checkNovelConsistency,
  createNovelProject,
  deleteNovelCharacter,
  generateNovelCharacters,
  generateNovelOutline,
  getNovelProjectSnapshot,
  listNovelRuns,
  polishNovelChapter,
  rewriteNovelChapter,
  updateNovelSettings,
  type NovelCharacterRecord,
  type NovelGenerationRun,
  type NovelProjectSnapshot,
} from "@/lib/api/novel";
import NovelSettingsPanel from "@/components/projects/tabs/NovelSettingsPanel";
import NovelSettingsWizard from "@/components/projects/tabs/novel-settings/NovelSettingsWizard";
import {
  createDefaultNovelSettingsEnvelope,
  normalizeNovelSettingsEnvelope,
  type NovelSettingsEnvelope,
} from "@/lib/novel-settings/types";
import {
  resolveNovelPipelineState,
  type NovelPipelineStage,
  type NovelStageStatus,
} from "@/lib/novel-flow/pipeline";
import { generateNextChapterWithConsistency } from "@/lib/novel-flow/actions";
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface StageMeta {
  id: NovelPipelineStage;
  title: string;
  description: string;
}

const SETTINGS_AUTOSAVE_DELAY_MS = 800;

const STAGE_METAS: StageMeta[] = [
  {
    id: "setup",
    title: "设定",
    description: "完成小说设定与约束",
  },
  {
    id: "outline",
    title: "大纲",
    description: "生成并校验故事骨架",
  },
  {
    id: "characters",
    title: "角色",
    description: "生成角色阵列",
  },
  {
    id: "chapters",
    title: "章节",
    description: "半自动生成与迭代",
  },
  {
    id: "qa",
    title: "质检",
    description: "一致性与质量检查",
  },
  {
    id: "publish",
    title: "发布",
    description: "确认发布前条件",
  },
];

type SettingsMode = "wizard" | "expert";
type FlowAction =
  | "outline"
  | "characters"
  | "chapter-rewrite"
  | "chapter-polish"
  | "chapter-consistency"
  | "chapter-cycle"
  | "save-settings"
  | "primary"
  | "refresh";

export interface NovelFlowWorkbenchProps {
  projectId: string;
  projectName?: string;
}

interface RecentNovelActionError {
  message: string;
  context: string;
  stage: NovelPipelineStage;
  action?: FlowAction;
  occurredAt: number;
}

function getSettingsModeStorageKey(projectId: string): string {
  return `novel_settings_mode_${projectId}`;
}

function loadSettingsMode(projectId: string): SettingsMode {
  if (typeof window === "undefined") {
    return "wizard";
  }
  const raw = window.localStorage.getItem(getSettingsModeStorageKey(projectId));
  if (raw === "expert") {
    return "expert";
  }
  return "wizard";
}

function persistSettingsMode(projectId: string, mode: SettingsMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(getSettingsModeStorageKey(projectId), mode);
}

function loadPreferredModel(projectId: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const keys = [
    `agent_pref_model_${projectId}`,
    "agent_pref_model_global",
    "agent_pref_model",
  ];

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
      }
    } catch {
      if (raw.trim()) {
        return raw.trim();
      }
    }
  }

  return undefined;
}

function loadPreferredProvider(projectId: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const keys = [
    `agent_pref_provider_${projectId}`,
    "agent_pref_provider_global",
    "agent_pref_provider",
  ];

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
      }
    } catch {
      if (raw.trim()) {
        return raw.trim();
      }
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "未知错误";
}

function isNovelProjectNotFound(message: string): boolean {
  return message.includes("小说项目不存在") || message.includes("项目不存在");
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function formatRunMode(mode: string): string {
  switch (mode) {
    case "outline":
      return "生成大纲";
    case "characters":
      return "生成角色";
    case "generate":
      return "生成章节";
    case "continue":
      return "续写章节";
    case "rewrite":
      return "重写章节";
    case "polish":
      return "润色章节";
    default:
      return mode;
  }
}

function formatRunStatus(status: string): string {
  if (status === "success") {
    return "成功";
  }
  if (status === "failed") {
    return "失败";
  }
  return status;
}

function getRunStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "outline";
}

function getStageStatusVariant(
  status: NovelStageStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") {
    return "default";
  }
  if (status === "warning") {
    return "destructive";
  }
  if (status === "ready") {
    return "secondary";
  }
  return "outline";
}

function getStageStatusLabel(status: NovelStageStatus): string {
  if (status === "done") {
    return "已完成";
  }
  if (status === "warning") {
    return "有告警";
  }
  if (status === "ready") {
    return "进行中";
  }
  return "待开始";
}

function normalizeCharacterText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/^["']+|["',\s]+$/g, "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.includes('":') || ["{", "}", "[", "]", ","].includes(normalized)) {
    return null;
  }
  return normalized;
}

function getCardField(
  card: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = normalizeCharacterText(card[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function formatCharacterRole(roleType: string): string {
  const normalized = roleType.trim().toLowerCase();
  if (normalized === "main") return "主角";
  if (normalized === "antagonist") return "反派";
  if (normalized === "support") return "配角";
  return roleType || "配角";
}

function isSuspiciousCharacterName(name: string): boolean {
  const normalized = name.trim();
  if (!normalized) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  if (
    normalized.startsWith("```") ||
    normalized.endsWith("```") ||
    ["```", "```json", "```yaml", "```yml", "json", "yaml", "yml"].includes(lowered)
  ) {
    return true;
  }

  const isOnlyStructureChars = [...normalized].every((char) =>
    "{}[],:".includes(char),
  );
  if (isOnlyStructureChars || normalized.includes('":')) {
    return true;
  }

  return false;
}

function buildCharacterDisplay(
  character: NovelCharacterRecord,
  index: number,
): {
  name: string;
  roleLabel: string;
  details: Array<{ label: string; value: string }>;
} {
  const rawCard = character.card_json;
  const card =
    rawCard && typeof rawCard === "object" && !Array.isArray(rawCard)
      ? (rawCard as Record<string, unknown>)
      : {};

  const name =
    normalizeCharacterText(character.name) ||
    getCardField(card, ["name", "character_name", "characterName", "角色名"]) ||
    `角色${index + 1}`;

  const roleLabel = formatCharacterRole(
    normalizeCharacterText(character.role_type) ||
      getCardField(card, ["role_type", "roleType", "type", "role"]) ||
      "support",
  );

  const details = [
    {
      label: "关系",
      value:
        getCardField(card, ["relationship", "relation", "关系"]) || "未提供",
    },
    {
      label: "弧线",
      value: getCardField(card, ["arc", "character_arc", "人物弧线"]) || "未提供",
    },
    {
      label: "能力",
      value: getCardField(card, ["abilities", "ability", "能力"]) || "未提供",
    },
  ];

  return { name, roleLabel, details };
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 忽略并走降级方案
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error("复制失败，请检查剪贴板权限后重试");
}

function buildNovelActionErrorReport(options: {
  projectId: string;
  projectName?: string;
  preferredProvider?: string;
  preferredModel?: string;
  selectedChapterId?: string;
  error: RecentNovelActionError;
}): string {
  const payload = {
    project_id: options.projectId,
    project_name: options.projectName ?? "",
    stage: options.error.stage,
    action: options.error.action ?? "",
    context: options.error.context,
    message: options.error.message,
    selected_chapter_id: options.selectedChapterId ?? "",
    preferred_provider: options.preferredProvider ?? "",
    preferred_model: options.preferredModel ?? "",
    occurred_at: options.error.occurredAt,
    occurred_at_text: formatDateTime(options.error.occurredAt),
  };
  return JSON.stringify(payload, null, 2);
}

function downloadTextFile(filename: string, content: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("当前环境不支持导出文件");
  }
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function NovelFlowWorkbench({
  projectId,
  projectName,
}: NovelFlowWorkbenchProps) {
  const [snapshot, setSnapshot] = useState<NovelProjectSnapshot | null>(null);
  const [runs, setRuns] = useState<NovelGenerationRun[]>([]);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [runningAction, setRunningAction] = useState<FlowAction | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [rewriteInstructions, setRewriteInstructions] = useState("");
  const [polishFocus, setPolishFocus] = useState("");

  const [settingsDraft, setSettingsDraft] = useState<NovelSettingsEnvelope>(
    createDefaultNovelSettingsEnvelope(),
  );
  const [settingsMode, setSettingsMode] = useState<SettingsMode>(() =>
    loadSettingsMode(projectId),
  );
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [activeStage, setActiveStage] = useState<NovelPipelineStage>("setup");
  const [lastActionError, setLastActionError] = useState<RecentNovelActionError | null>(null);

  const autoSaveTimerRef = useRef<number | null>(null);

  const preferredModel = loadPreferredModel(projectId);
  const preferredProvider = loadPreferredProvider(projectId);

  const selectedChapter = useMemo(
    () => snapshot?.chapters.find((chapter) => chapter.id === selectedChapterId),
    [selectedChapterId, snapshot],
  );

  const characterEntries = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return snapshot.characters.map((character, index) => {
      const display = buildCharacterDisplay(character, index);
      return {
        character,
        display,
        isSuspicious: isSuspiciousCharacterName(display.name),
      };
    });
  }, [snapshot]);

  const mainCharacterEntries = useMemo(
    () =>
      characterEntries.filter(
        (item) => item.character.role_type.trim().toLowerCase() === "main",
      ),
    [characterEntries],
  );

  const sideCharacterEntries = useMemo(
    () =>
      characterEntries.filter(
        (item) => item.character.role_type.trim().toLowerCase() !== "main",
      ),
    [characterEntries],
  );

  const suspiciousCharacterEntries = useMemo(
    () => characterEntries.filter((item) => item.isSuspicious),
    [characterEntries],
  );

  const pipelineState = useMemo(
    () =>
      resolveNovelPipelineState({
        snapshot,
        settings: settingsDraft,
      }),
    [settingsDraft, snapshot],
  );

  const hasSnapshot = snapshot !== null;
  const generationLocked = runningAction !== null || savingSettings;

  const settingsSyncState = useMemo<"saving" | "error" | "dirty" | "synced">(() => {
    if (savingSettings) {
      return "saving";
    }
    if (settingsSaveError) {
      return "error";
    }
    if (settingsDirty) {
      return "dirty";
    }
    return "synced";
  }, [savingSettings, settingsDirty, settingsSaveError]);

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const recordActionError = useCallback(
    (context: string, error: unknown, action?: FlowAction): string => {
      const message = getErrorMessage(error);
      setLastActionError({
        message,
        context,
        action,
        stage: activeStage,
        occurredAt: Date.now(),
      });
      return message;
    },
    [activeStage],
  );

  const runAction = useCallback(
    async (action: FlowAction, successText: string, fn: () => Promise<void>) => {
      setRunningAction(action);
      try {
        await fn();
        toast.success(successText);
      } catch (error) {
        const message = recordActionError(`${successText}失败`, error, action);
        toast.error(`${successText}失败: ${message}`);
      } finally {
        setRunningAction(null);
      }
    },
    [recordActionError],
  );

  const loadSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    try {
      const result = await getNovelProjectSnapshot(projectId);
      setSnapshot(result);
      setLoadError(null);
    } catch (error) {
      const message = getErrorMessage(error);
      if (isNovelProjectNotFound(message)) {
        setSnapshot(null);
        setLoadError(null);
      } else {
        setLoadError(message);
      }
    } finally {
      setLoadingSnapshot(false);
    }
  }, [projectId]);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const result = await listNovelRuns({
        project_id: projectId,
        limit: 20,
      });
      setRuns(result);
    } catch (error) {
      const message = getErrorMessage(error);
      if (isNovelProjectNotFound(message)) {
        setRuns([]);
      } else {
        recordActionError("加载运行记录失败", error, "refresh");
        toast.error(`加载运行记录失败: ${message}`);
      }
    } finally {
      setLoadingRuns(false);
    }
  }, [projectId, recordActionError]);

  const refreshNovelData = useCallback(async () => {
    await Promise.all([loadSnapshot(), loadRuns()]);
  }, [loadRuns, loadSnapshot]);

  useEffect(() => {
    void refreshNovelData();
  }, [refreshNovelData]);

  useEffect(() => {
    setSettingsMode(loadSettingsMode(projectId));
  }, [projectId]);

  useEffect(() => () => clearAutoSaveTimer(), [clearAutoSaveTimer]);

  useEffect(() => {
    if (!snapshot) {
      setSelectedChapterId("");
      return;
    }
    const hasSelected = snapshot.chapters.some(
      (chapter) => chapter.id === selectedChapterId,
    );
    if (hasSelected) {
      return;
    }
    const latestChapter = snapshot.chapters[snapshot.chapters.length - 1];
    setSelectedChapterId(latestChapter?.id ?? "");
  }, [selectedChapterId, snapshot]);

  useEffect(() => {
    if (!snapshot) {
      setSettingsDraft(createDefaultNovelSettingsEnvelope());
      setSettingsDirty(false);
      setSettingsSaveError(null);
      setLastSavedAt(null);
      return;
    }

    const latestSettings = normalizeNovelSettingsEnvelope(
      snapshot.latest_settings?.settings_json,
    );
    setSettingsDraft(latestSettings);
    setSettingsDirty(false);
    setSettingsSaveError(null);
    setLastSavedAt(snapshot.latest_settings?.created_at ?? null);
  }, [snapshot]);

  const handleInitializeNovelProject = useCallback(async () => {
    setInitializing(true);
    try {
      await createNovelProject({
        id: projectId,
        title: projectName?.trim() || "小说项目",
        theme: "长篇小说",
        metadata_json: {
          workspace_project_id: projectId,
        },
      });
      toast.success("小说项目初始化完成");
      await refreshNovelData();
    } catch (error) {
      const message = recordActionError("初始化小说项目失败", error);
      toast.error(`初始化失败: ${message}`);
    } finally {
      setInitializing(false);
    }
  }, [projectId, projectName, recordActionError, refreshNovelData]);

  const handleSaveSettings = useCallback(
    async (silent = false): Promise<boolean> => {
      clearAutoSaveTimer();
      if (!snapshot || savingSettings) {
        return false;
      }
      if (!settingsDirty) {
        return true;
      }

      setSavingSettings(true);
      setSettingsSaveError(null);
      try {
        const normalized = normalizeNovelSettingsEnvelope(settingsDraft);
        const saved = await updateNovelSettings({
          project_id: projectId,
          settings_json: normalized,
        });

        setSettingsDraft(normalizeNovelSettingsEnvelope(saved.settings_json));
        setSettingsDirty(false);
        setSettingsSaveError(null);
        setLastSavedAt(saved.created_at);

        if (!silent) {
          toast.success("创作设定已保存");
        }
        return true;
      } catch (error) {
        const message = recordActionError("保存创作设定失败", error, "save-settings");
        setSettingsSaveError(message);
        if (!silent) {
          toast.error(`保存创作设定失败: ${message}`);
        }
        return false;
      } finally {
        setSavingSettings(false);
      }
    },
    [
      clearAutoSaveTimer,
      projectId,
      recordActionError,
      savingSettings,
      settingsDirty,
      settingsDraft,
      snapshot,
    ],
  );

  useEffect(() => {
    if (!snapshot || !settingsDirty || savingSettings) {
      return;
    }
    clearAutoSaveTimer();
    autoSaveTimerRef.current = window.setTimeout(() => {
      void handleSaveSettings(true);
    }, SETTINGS_AUTOSAVE_DELAY_MS);

    return () => {
      clearAutoSaveTimer();
    };
  }, [
    clearAutoSaveTimer,
    handleSaveSettings,
    savingSettings,
    settingsDirty,
    settingsDraft,
    snapshot,
  ]);

  const flushPendingSettingsSave = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    return handleSaveSettings(true);
  }, [clearAutoSaveTimer, handleSaveSettings]);

  const ensureSettingsSavedForGeneration = useCallback(async () => {
    const saved = await flushPendingSettingsSave();
    if (!saved) {
      throw new Error("创作设定保存失败");
    }
  }, [flushPendingSettingsSave]);

  const handleSettingsChange = useCallback((nextData: NovelSettingsEnvelope["data"]) => {
    setSettingsDraft((prev) => ({
      ...normalizeNovelSettingsEnvelope(prev),
      data: nextData,
    }));
    setSettingsDirty(true);
    setSettingsSaveError(null);
  }, []);

  const handleSwitchSettingsMode = useCallback(
    async (mode: SettingsMode) => {
      if (mode === settingsMode || runningAction !== null || savingSettings) {
        return;
      }

      const saved = await flushPendingSettingsSave();
      if (!saved) {
        toast.error("切换模式前保存失败，请稍后重试");
        return;
      }

      setSettingsMode(mode);
      persistSettingsMode(projectId, mode);
    },
    [flushPendingSettingsSave, projectId, runningAction, savingSettings, settingsMode],
  );

  const handleGenerateOutline = useCallback(async () => {
    await runAction("outline", "大纲已更新", async () => {
      await ensureSettingsSavedForGeneration();
      await generateNovelOutline({
        project_id: projectId,
        provider: preferredProvider,
        model: preferredModel,
      });
      await refreshNovelData();
    });
  }, [
    ensureSettingsSavedForGeneration,
    preferredModel,
    preferredProvider,
    projectId,
    refreshNovelData,
    runAction,
  ]);

  const handleGenerateCharacters = useCallback(async () => {
    await runAction("characters", "角色阵列已更新", async () => {
      await ensureSettingsSavedForGeneration();
      await generateNovelCharacters({
        project_id: projectId,
        provider: preferredProvider,
        model: preferredModel,
      });
      await refreshNovelData();
    });
  }, [
    ensureSettingsSavedForGeneration,
    preferredModel,
    preferredProvider,
    projectId,
    refreshNovelData,
    runAction,
  ]);

  const handleDeleteCharacter = useCallback(
    async (characterId: string, characterName: string) => {
      if (
        !window.confirm(
          `确定要删除角色“${characterName}”吗？\n\n删除后该角色将无法在后续章节生成中被引用。`,
        )
      ) {
        return;
      }

      await runAction("characters", "角色已删除", async () => {
        const removed = await deleteNovelCharacter({
          project_id: projectId,
          character_id: characterId,
        });
        if (!removed) {
          throw new Error("角色不存在或已被删除");
        }
        await refreshNovelData();
      });
    },
    [projectId, refreshNovelData, runAction],
  );

  const handleCleanupSuspiciousCharacters = useCallback(async () => {
    if (suspiciousCharacterEntries.length === 0) {
      toast.info("暂无异常角色");
      return;
    }

    const previewNames = suspiciousCharacterEntries
      .slice(0, 3)
      .map((item) => item.display.name)
      .join("、");
    const previewText =
      suspiciousCharacterEntries.length > 3
        ? `${previewNames} 等 ${suspiciousCharacterEntries.length} 个角色`
        : previewNames;

    if (
      !window.confirm(
        `检测到异常角色：${previewText}\n\n是否继续清理这些异常角色？`,
      )
    ) {
      return;
    }

    await runAction("characters", "异常角色清理完成", async () => {
      let removedCount = 0;
      let failedCount = 0;

      for (const item of suspiciousCharacterEntries) {
        try {
          const removed = await deleteNovelCharacter({
            project_id: projectId,
            character_id: item.character.id,
          });
          if (removed) {
            removedCount += 1;
          } else {
            failedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }

      await refreshNovelData();

      if (removedCount === 0) {
        throw new Error("未清理任何异常角色");
      }
      if (failedCount > 0) {
        toast.warning(`已清理 ${removedCount} 个异常角色，${failedCount} 个清理失败`);
      }
    });
  }, [projectId, refreshNovelData, runAction, suspiciousCharacterEntries]);

  const handleGenerateNextChapter = useCallback(async () => {
    await runAction("chapter-cycle", "章节已生成", async () => {
      await ensureSettingsSavedForGeneration();
      const result = await generateNextChapterWithConsistency({
        projectId,
        hasExistingChapters: Boolean(snapshot?.chapters.length),
        provider: preferredProvider,
        model: preferredModel,
      });

      if (result.consistency) {
        toast.success(`一致性评分: ${result.consistency.score.toFixed(1)}`);
      } else if (result.consistencyError) {
        toast.warning(`章节已生成，一致性检查失败: ${result.consistencyError}`);
      }

      await refreshNovelData();
      setSelectedChapterId(result.chapter.id);
    });
  }, [
    ensureSettingsSavedForGeneration,
    preferredModel,
    preferredProvider,
    projectId,
    refreshNovelData,
    runAction,
    snapshot?.chapters.length,
  ]);

  const handleRewriteChapter = useCallback(async () => {
    if (!selectedChapterId) {
      toast.error("请先选择章节");
      return;
    }

    await runAction("chapter-rewrite", "章节已重写", async () => {
      await ensureSettingsSavedForGeneration();
      await rewriteNovelChapter({
        project_id: projectId,
        chapter_id: selectedChapterId,
        instructions: rewriteInstructions.trim() || undefined,
        provider: preferredProvider,
        model: preferredModel,
      });
      await refreshNovelData();
    });
  }, [
    ensureSettingsSavedForGeneration,
    preferredModel,
    preferredProvider,
    projectId,
    refreshNovelData,
    rewriteInstructions,
    runAction,
    selectedChapterId,
  ]);

  const handlePolishChapter = useCallback(async () => {
    if (!selectedChapterId) {
      toast.error("请先选择章节");
      return;
    }

    await runAction("chapter-polish", "章节已润色", async () => {
      await ensureSettingsSavedForGeneration();
      await polishNovelChapter({
        project_id: projectId,
        chapter_id: selectedChapterId,
        focus: polishFocus.trim() || undefined,
        provider: preferredProvider,
        model: preferredModel,
      });
      await refreshNovelData();
    });
  }, [
    ensureSettingsSavedForGeneration,
    polishFocus,
    preferredModel,
    preferredProvider,
    projectId,
    refreshNovelData,
    runAction,
    selectedChapterId,
  ]);

  const handleCheckConsistencyForSelectedChapter = useCallback(async () => {
    if (!selectedChapterId) {
      toast.error("请先选择章节");
      return;
    }

    await runAction("chapter-consistency", "一致性检查完成", async () => {
      await ensureSettingsSavedForGeneration();
      const result = await checkNovelConsistency({
        project_id: projectId,
        chapter_id: selectedChapterId,
      });
      toast.success(`一致性评分: ${result.score.toFixed(1)}`);
      await refreshNovelData();
    });
  }, [
    ensureSettingsSavedForGeneration,
    projectId,
    refreshNovelData,
    runAction,
    selectedChapterId,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (pipelineState.primaryAction.disabled || generationLocked) {
      return;
    }

    switch (pipelineState.primaryAction.key) {
      case "save-settings":
        await handleSaveSettings(false);
        return;
      case "generate-outline":
        await handleGenerateOutline();
        return;
      case "generate-characters":
        await handleGenerateCharacters();
        return;
      case "generate-next-chapter":
        await handleGenerateNextChapter();
        return;
      case "run-consistency":
        await handleCheckConsistencyForSelectedChapter();
        return;
      case "open-publish":
        toast.info("请切换到“发布”标签页继续发布流程");
        return;
      default:
        return;
    }
  }, [
    generationLocked,
    handleCheckConsistencyForSelectedChapter,
    handleGenerateCharacters,
    handleGenerateNextChapter,
    handleGenerateOutline,
    handleSaveSettings,
    pipelineState.primaryAction,
  ]);

  const handleCopyLastActionError = useCallback(async () => {
    if (!lastActionError) {
      toast.info("暂无可复制错误");
      return;
    }
    const content = buildNovelActionErrorReport({
      projectId,
      projectName,
      preferredProvider,
      preferredModel,
      selectedChapterId,
      error: lastActionError,
    });
    try {
      await copyTextToClipboard(content);
      toast.success("错误信息已复制");
    } catch (error) {
      toast.error(`复制失败: ${getErrorMessage(error)}`);
    }
  }, [
    lastActionError,
    preferredModel,
    preferredProvider,
    projectId,
    projectName,
    selectedChapterId,
  ]);

  const handleExportLastActionError = useCallback(() => {
    if (!lastActionError) {
      toast.info("暂无可导出错误");
      return;
    }
    const content = buildNovelActionErrorReport({
      projectId,
      projectName,
      preferredProvider,
      preferredModel,
      selectedChapterId,
      error: lastActionError,
    });
    const date = new Date(lastActionError.occurredAt);
    const pad = (value: number) => value.toString().padStart(2, "0");
    const filename = `proxycast-novel-error-${date.getFullYear()}${pad(
      date.getMonth() + 1,
    )}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(
      date.getSeconds(),
    )}.json`;

    try {
      downloadTextFile(filename, content);
      toast.success("错误 JSON 已导出到系统默认下载目录");
    } catch (error) {
      toast.error(`导出失败: ${getErrorMessage(error)}`);
    }
  }, [
    lastActionError,
    preferredModel,
    preferredProvider,
    projectId,
    projectName,
    selectedChapterId,
  ]);

  if (loadingSnapshot && !hasSnapshot) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载小说编排数据...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasSnapshot) {
    return (
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">尚未初始化小说项目</CardTitle>
            <CardDescription>
              当前工作区还没有小说编排数据，初始化后即可进入流水线生成。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadError && <div className="text-sm text-destructive">加载失败: {loadError}</div>}
            <Button onClick={handleInitializeNovelProject} disabled={initializing}>
              {initializing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              初始化小说项目
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">小说流水线工作台</h2>
            <p className="text-sm text-muted-foreground">
              设定 → 大纲 → 角色 → 章节循环 → 质检 → 发布
            </p>
            {preferredModel && (
              <p className="mt-1 text-xs text-muted-foreground">
                默认模型:
                <span className="font-mono"> {preferredModel}</span>
                {preferredProvider && <span className="ml-2">Provider: {preferredProvider}</span>}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void refreshNovelData();
              }}
              disabled={loadingSnapshot || loadingRuns || generationLocked}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-1",
                  (loadingSnapshot || loadingRuns) && "animate-spin",
                )}
              />
              刷新
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setActiveStage(pipelineState.currentStage);
              }}
            >
              回到推荐阶段
            </Button>
            <Button
              onClick={() => {
                void handlePrimaryAction();
              }}
              disabled={pipelineState.primaryAction.disabled || generationLocked}
            >
              {generationLocked ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4 mr-1" />
              )}
              {pipelineState.primaryAction.label}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {STAGE_METAS.map((stage) => {
            const status = pipelineState.stageStatus[stage.id];
            const selected = activeStage === stage.id;
            const recommended = stage.id === pipelineState.currentStage;
            return (
              <button
                key={`top-stage-${stage.id}`}
                type="button"
                onClick={() => {
                  setActiveStage(stage.id);
                }}
                className={cn(
                  "rounded-lg border p-2 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/70 hover:bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{stage.title}</span>
                  <Badge variant={getStageStatusVariant(status)}>
                    {getStageStatusLabel(status)}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {stage.description}
                  </span>
                  {recommended && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      推荐
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {lastActionError && (
        <Card className="border-destructive/40 bg-destructive/[0.04]">
          <CardHeader className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm text-destructive">最近错误</CardTitle>
                <CardDescription>
                  {lastActionError.context} · {formatDateTime(lastActionError.occurredAt)}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void handleCopyLastActionError();
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  复制错误
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportLastActionError}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  导出 JSON
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setLastActionError(null);
                  }}
                  aria-label="关闭错误提示"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-destructive break-words">{lastActionError.message}</div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              阶段：{STAGE_METAS.find((item) => item.id === lastActionError.stage)?.title ?? "未知"}
              {lastActionError.action ? ` · 动作：${lastActionError.action}` : ""}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,1fr)_280px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">阶段导航</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {STAGE_METAS.map((stage) => {
              const status = pipelineState.stageStatus[stage.id];
              const selected = activeStage === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    setActiveStage(stage.id);
                  }}
                  className={cn(
                    "w-full rounded-md border px-2 py-2 text-left transition-colors",
                    selected ? "border-primary bg-muted/40" : "hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{stage.title}</span>
                    <Badge variant={getStageStatusVariant(status)}>
                      {getStageStatusLabel(status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{stage.description}</div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-3 min-w-0">
          {activeStage === "setup" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">创作设定</CardTitle>
                  <CardDescription>向导模式默认开启，专家模式放在二级入口。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        settingsSyncState === "error"
                          ? "destructive"
                          : settingsSyncState === "dirty"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {settingsSyncState === "saving"
                        ? "设定保存中"
                        : settingsSyncState === "error"
                          ? "设定保存失败"
                          : settingsSyncState === "dirty"
                            ? "设定未保存"
                            : "设定已同步"}
                    </Badge>

                    {savingSettings && <Loader2 className="h-3.5 w-3.5 animate-spin" />}

                    {lastSavedAt && (
                      <span className="text-xs text-muted-foreground">
                        上次保存: {formatDateTime(lastSavedAt)}
                      </span>
                    )}
                    {snapshot.latest_settings && (
                      <span className="text-xs text-muted-foreground">
                        版本 {snapshot.latest_settings.version}
                      </span>
                    )}
                  </div>

                  {settingsSaveError && (
                    <div className="text-xs text-destructive">{settingsSaveError}</div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={settingsMode === "wizard" ? "default" : "outline"}
                      onClick={() => {
                        void handleSwitchSettingsMode("wizard");
                      }}
                      disabled={savingSettings || generationLocked}
                    >
                      向导模式
                    </Button>
                    <Button
                      size="sm"
                      variant={settingsMode === "expert" ? "default" : "outline"}
                      onClick={() => {
                        void handleSwitchSettingsMode("expert");
                      }}
                      disabled={savingSettings || generationLocked}
                    >
                      专家模式
                    </Button>
                    <Button
                      variant={settingsDirty ? "default" : "outline"}
                      onClick={() => {
                        void handleSaveSettings(false);
                      }}
                      disabled={!settingsDirty || savingSettings || generationLocked}
                    >
                      保存设定
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {settingsMode === "wizard" ? (
                <NovelSettingsWizard
                  value={settingsDraft.data}
                  onChange={handleSettingsChange}
                  onBeforeStepChange={flushPendingSettingsSave}
                  disabled={savingSettings || generationLocked}
                />
              ) : (
                <NovelSettingsPanel
                  value={settingsDraft.data}
                  onChange={handleSettingsChange}
                  disabled={savingSettings || generationLocked}
                />
              )}
            </>
          )}

          {activeStage === "outline" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">大纲阶段</CardTitle>
                <CardDescription>
                  {snapshot.latest_outline
                    ? `版本 ${snapshot.latest_outline.version} · ${formatDateTime(snapshot.latest_outline.created_at)}`
                    : "尚未生成大纲"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => {
                    void handleGenerateOutline();
                  }}
                  disabled={generationLocked}
                >
                  <BookOpenText className="h-4 w-4 mr-1" />
                  {snapshot.latest_outline ? "重新生成大纲" : "生成大纲"}
                </Button>
                <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap leading-6 max-h-96 overflow-y-auto">
                  {snapshot.latest_outline?.outline_markdown || "暂无大纲内容"}
                </div>
              </CardContent>
            </Card>
          )}

          {activeStage === "characters" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">角色阶段</CardTitle>
                <CardDescription>生成后可在后续章节中自动引用角色关系。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => {
                      void handleGenerateCharacters();
                    }}
                    disabled={generationLocked}
                  >
                    <Users className="h-4 w-4 mr-1" />
                    {characterEntries.length > 0 ? "更新角色阵列" : "生成角色阵列"}
                  </Button>
                  {suspiciousCharacterEntries.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        void handleCleanupSuspiciousCharacters();
                      }}
                      disabled={generationLocked}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      清理异常角色 ({suspiciousCharacterEntries.length})
                    </Button>
                  )}
                </div>

                {suspiciousCharacterEntries.length > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    检测到 {suspiciousCharacterEntries.length} 个疑似异常角色（如 ```json），建议清理后再继续生成章节。
                  </div>
                )}

                {characterEntries.length === 0 ? (
                  <div className="text-sm text-muted-foreground">暂无角色数据</div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">主要角色</h4>
                        <span className="text-xs text-muted-foreground">
                          {mainCharacterEntries.length}
                        </span>
                      </div>
                      {mainCharacterEntries.length === 0 ? (
                        <div className="rounded-md border bg-muted/10 px-3 py-2 text-sm text-muted-foreground">
                          暂无主要角色
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {mainCharacterEntries.map((item) => (
                            <div key={item.character.id} className="rounded-md border p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium break-words">{item.display.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {item.display.roleLabel} · 版本 {item.character.version}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {item.isSuspicious && <Badge variant="destructive">异常</Badge>}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      void handleDeleteCharacter(
                                        item.character.id,
                                        item.display.name,
                                      );
                                    }}
                                    disabled={generationLocked}
                                    aria-label={`删除角色 ${item.display.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="space-y-1 text-sm">
                                {item.display.details.map((detail) => (
                                  <div key={detail.label} className="leading-6 break-words">
                                    <span className="text-muted-foreground">{detail.label}：</span>
                                    <span>{detail.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">次要角色</h4>
                        <span className="text-xs text-muted-foreground">
                          {sideCharacterEntries.length}
                        </span>
                      </div>
                      {sideCharacterEntries.length === 0 ? (
                        <div className="rounded-md border bg-muted/10 px-3 py-2 text-sm text-muted-foreground">
                          暂无次要角色
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                          {sideCharacterEntries.map((item) => (
                            <div key={item.character.id} className="rounded-md border p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium break-words">{item.display.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {item.display.roleLabel} · 版本 {item.character.version}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {item.isSuspicious && <Badge variant="destructive">异常</Badge>}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      void handleDeleteCharacter(
                                        item.character.id,
                                        item.display.name,
                                      );
                                    }}
                                    disabled={generationLocked}
                                    aria-label={`删除角色 ${item.display.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="space-y-1 text-sm">
                                {item.display.details.map((detail) => (
                                  <div key={detail.label} className="leading-6 break-words">
                                    <span className="text-muted-foreground">{detail.label}：</span>
                                    <span>{detail.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeStage === "chapters" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">章节阶段（半自动循环）</CardTitle>
                <CardDescription>主动作会自动生成下一章并执行一致性检查。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => {
                    void handleGenerateNextChapter();
                  }}
                  disabled={generationLocked}
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  生成下一章（含自动检查）
                </Button>

                <div className="space-y-2">
                  <label className="text-sm font-medium">选择章节</label>
                  <select
                    value={selectedChapterId}
                    onChange={(event) => setSelectedChapterId(event.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                    disabled={snapshot.chapters.length === 0}
                  >
                    {snapshot.chapters.length === 0 ? (
                      <option value="">暂无章节</option>
                    ) : (
                      snapshot.chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          第 {chapter.chapter_no} 章 · {chapter.title}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap leading-6 max-h-96 overflow-y-auto">
                  {selectedChapter?.content || "暂无章节内容"}
                </div>
              </CardContent>
            </Card>
          )}

          {activeStage === "qa" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">质检阶段</CardTitle>
                <CardDescription>一致性检查采用软门槛，告警不阻塞。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    void handleCheckConsistencyForSelectedChapter();
                  }}
                  disabled={generationLocked}
                >
                  一致性检查
                </Button>

                {snapshot.latest_consistency ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          snapshot.latest_consistency.score < 60 ? "destructive" : "default"
                        }
                      >
                        评分 {snapshot.latest_consistency.score.toFixed(1)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(snapshot.latest_consistency.created_at)}
                      </span>
                    </div>
                    {snapshot.latest_consistency.issues.length === 0 ? (
                      <div className="text-sm text-muted-foreground">暂无一致性问题</div>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                        {snapshot.latest_consistency.issues.map((issue, index) => (
                          <div key={`${issue.code}-${index}`} className="rounded-md border p-3">
                            <div className="text-sm font-medium flex items-center gap-2">
                              {issue.level === "error" ? (
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-amber-600" />
                              )}
                              {issue.code}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{issue.message}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">尚未执行一致性检查</div>
                )}
              </CardContent>
            </Card>
          )}

          {activeStage === "publish" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">发布阶段</CardTitle>
                <CardDescription>发布入口已独立到“发布”标签页。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  当前已有 {snapshot.chapters.length} 章可发布内容。
                  {snapshot.latest_consistency && (
                    <span>
                      最近一致性评分 {snapshot.latest_consistency.score.toFixed(1)}。
                    </span>
                  )}
                </div>
                <Button
                  onClick={() => {
                    toast.info("请切换到“发布”标签页继续");
                  }}
                >
                  前往发布页
                </Button>
              </CardContent>
            </Card>
          )}

          <Collapsible>
            <Card>
              <CardHeader>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="justify-between w-full px-0">
                    <span className="font-medium">高级操作</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CardDescription>重写、润色等非主路径动作</CardDescription>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">重写要求</label>
                      <Textarea
                        value={rewriteInstructions}
                        onChange={(event) => setRewriteInstructions(event.target.value)}
                        placeholder="例如：强化冲突节奏，保留人物关系"
                        rows={3}
                      />
                      <Button
                        variant="outline"
                        onClick={() => {
                          void handleRewriteChapter();
                        }}
                        disabled={generationLocked || !selectedChapterId}
                        className="w-full"
                      >
                        重写当前章节
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">润色重点</label>
                      <Textarea
                        value={polishFocus}
                        onChange={(event) => setPolishFocus(event.target.value)}
                        placeholder="例如：对白自然度、叙事流畅度"
                        rows={3}
                      />
                      <Button
                        variant="outline"
                        onClick={() => {
                          void handlePolishChapter();
                        }}
                        disabled={generationLocked || !selectedChapterId}
                        className="w-full"
                      >
                        润色当前章节
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>

        <div className="space-y-3 xl:col-span-2 2xl:col-span-1 min-w-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">流程上下文</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">目标字数</span>
                <span>{snapshot.project.target_words.toLocaleString("zh-CN")}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">当前字数</span>
                <span>{snapshot.project.current_word_count.toLocaleString("zh-CN")}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">章节</span>
                <span>{snapshot.chapters.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">角色</span>
                <span>{snapshot.characters.length}</span>
              </div>
              {snapshot.latest_consistency && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">最新质检</span>
                  <Badge
                    variant={
                      snapshot.latest_consistency.score < 60 ? "destructive" : "default"
                    }
                  >
                    {snapshot.latest_consistency.score.toFixed(1)}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">最近运行记录</CardTitle>
              <CardDescription>默认展示最近 3 条</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingRuns ? (
                <div className="text-xs text-muted-foreground">加载中...</div>
              ) : runs.length === 0 ? (
                <div className="text-xs text-muted-foreground">暂无运行记录</div>
              ) : (
                runs.slice(0, 3).map((run) => (
                  <div key={run.id} className="rounded-md border p-2">
                    <div className="text-xs font-medium">{formatRunMode(run.mode)}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {formatDateTime(run.created_at)}
                    </div>
                    <div className="mt-1">
                      <Badge variant={getRunStatusVariant(run.result_status)}>
                        {formatRunStatus(run.result_status)}
                      </Badge>
                    </div>
                    {run.error_message && (
                      <div className="mt-1 text-[11px] leading-5 text-destructive break-words">
                        {run.error_message}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {loadError && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-destructive">数据加载告警</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-destructive">{loadError}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default NovelFlowWorkbench;
