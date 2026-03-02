/**
 * @file ExperimentalSettings.tsx
 * @description 实验室设置页面 - 管理实验性功能的开关和配置
 * @module components/settings-v2/system/experimental
 *
 * 需求: 6.1, 6.2, 6.3, 6.5 - 实验室标签页，截图对话功能开关，快捷键设置，权限警告
 */

import { useState, useEffect, useCallback } from "react";
import { FlaskConical, Camera, AlertTriangle, RefreshCw, Bug } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getExperimentalConfig,
  saveExperimentalConfig,
  validateShortcut,
  updateScreenshotShortcut,
  ExperimentalFeatures,
  getConfig,
  saveConfig,
  type Config,
  getLogs,
  getPersistedLogsTail,
  type CrashReportingConfig,
} from "@/hooks/useTauri";
import { ShortcutSettings } from "@/components/smart-input/ShortcutSettings";
import { UpdateCheckSettings } from "./UpdateCheckSettings";
import { VoiceSettings } from "@/components/voice";
import {
  getVoiceInputConfig,
  saveVoiceInputConfig,
  VoiceInputConfig,
} from "@/lib/api/asrProvider";
import { applyCrashReportingSettings } from "@/lib/crashReporting";
import {
  buildCrashDiagnosticPayload,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  DEFAULT_CRASH_REPORTING_CONFIG,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { ClipboardPermissionGuideCard } from "../shared/ClipboardPermissionGuideCard";
import { WorkspaceRepairHistoryCard } from "../shared/WorkspaceRepairHistoryCard";

// ============================================================
// 组件
// ============================================================

export function ExperimentalSettings() {
  // 状态
  const [config, setConfig] = useState<ExperimentalFeatures | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceInputConfig | null>(null);
  const [crashConfig, setCrashConfig] = useState<CrashReportingConfig>(
    DEFAULT_CRASH_REPORTING_CONFIG,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);

  // 检测是否为 macOS（使用 userAgentData 或 userAgent 替代已弃用的 platform）
  const isMacOS = navigator.userAgent.includes("Mac");

  // 加载配置
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [experimentalConfig, voiceInputConfig, fullConfig] = await Promise.all([
        getExperimentalConfig(),
        getVoiceInputConfig(),
        getConfig(),
      ]);
      setConfig(experimentalConfig);
      setVoiceConfig(voiceInputConfig);
      setCrashConfig(
        normalizeCrashReportingConfig(fullConfig.crash_reporting),
      );
    } catch (err) {
      console.error("加载实验室配置失败:", err);
      setError(err instanceof Error ? err.message : "加载配置失败");
      // 设置默认配置
      setConfig({
        screenshot_chat: {
          enabled: false,
          shortcut: "CommandOrControl+Alt+Q",
        },
      });
      setVoiceConfig({
        enabled: false,
        shortcut: "CommandOrControl+Shift+V",
        processor: {
          polish_enabled: true,
          default_instruction_id: "default",
        },
        output: {
          mode: "type",
          type_delay_ms: 10,
        },
        instructions: [],
        sound_enabled: true,
        translate_instruction_id: "default",
      });
      setCrashConfig(DEFAULT_CRASH_REPORTING_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 切换截图对话功能开关
  const handleToggleSmartInput = useCallback(async () => {
    if (!config) return;

    const newEnabled = !config.screenshot_chat.enabled;
    const newConfig: ExperimentalFeatures = {
      ...config,
      screenshot_chat: {
        ...config.screenshot_chat,
        enabled: newEnabled,
      },
    };

    setSaving(true);
    setMessage(null);

    try {
      await saveExperimentalConfig(newConfig);
      setConfig(newConfig);
      setMessage({
        type: "success",
        text: newEnabled ? "截图对话功能已启用" : "截图对话功能已禁用",
      });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error("保存配置失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }, [config]);

  // 更新快捷键
  const handleShortcutChange = useCallback(
    async (newShortcut: string) => {
      if (!config) return;

      await updateScreenshotShortcut(newShortcut);
      setConfig({
        ...config,
        screenshot_chat: {
          ...config.screenshot_chat,
          shortcut: newShortcut,
        },
      });
      setMessage({ type: "success", text: "快捷键已更新" });
      setTimeout(() => setMessage(null), 2000);
    },
    [config],
  );

  // 验证快捷键
  const handleValidateShortcut = useCallback(async (shortcut: string) => {
    try {
      return await validateShortcut(shortcut);
    } catch {
      return false;
    }
  }, []);

  // 更新语音输入配置
  const handleVoiceConfigChange = useCallback(
    async (newConfig: VoiceInputConfig) => {
      setSaving(true);
      setMessage(null);
      try {
        await saveVoiceInputConfig(newConfig);
        setVoiceConfig(newConfig);
        setMessage({
          type: "success",
          text: newConfig.enabled ? "语音输入功能已启用" : "语音输入功能已禁用",
        });
        setTimeout(() => setMessage(null), 2000);
      } catch (err) {
        console.error("保存语音配置失败:", err);
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "保存失败",
        });
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const persistCrashConfig = useCallback(async (next: CrashReportingConfig) => {
    setSaving(true);
    setMessage(null);
    try {
      const latestConfig = await getConfig();
      const normalized = normalizeCrashReportingConfig(next);
      const updatedConfig: Config = {
        ...latestConfig,
        crash_reporting: normalized,
      };
      await saveConfig(updatedConfig);
      await applyCrashReportingSettings(normalized);
      setCrashConfig(normalized);
      setMessage({ type: "success", text: "崩溃上报配置已更新" });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error("保存崩溃上报配置失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "保存崩溃上报配置失败",
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const handleCrashEnabledToggle = useCallback(() => {
    const nextConfig = {
      ...crashConfig,
      enabled: !crashConfig.enabled,
    };
    void persistCrashConfig(nextConfig);
  }, [crashConfig, persistCrashConfig]);

  const handleCrashFieldChange = useCallback(
    (
      field: keyof CrashReportingConfig,
      value: string | boolean | number | null,
    ) => {
      setCrashConfig((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    [],
  );

  const handleSaveCrashConfig = useCallback(() => {
    void persistCrashConfig(crashConfig);
  }, [crashConfig, persistCrashConfig]);

  const buildDiagnosticPayload = useCallback(async () => {
    const [logs, persistedLogs] = await Promise.all([
      getLogs(),
      getPersistedLogsTail(200),
    ]);
    return buildCrashDiagnosticPayload({
      crashConfig,
      logs,
      persistedLogTail: persistedLogs,
      appVersion: import.meta.env.VITE_APP_VERSION,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    });
  }, [crashConfig]);

  const copyCrashDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      await copyCrashDiagnosticToClipboard(payload);
      setMessage({
        type: "success",
        text: "诊断信息已复制，可直接发给开发者",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("复制诊断信息失败:", err);
      const isPermissionDenied = isClipboardPermissionDeniedError(err);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "复制诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const copyCrashDiagnosticJson = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      await copyCrashDiagnosticJsonToClipboard(payload);
      setMessage({
        type: "success",
        text: "纯 JSON 诊断信息已复制",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("复制纯 JSON 失败:", err);
      const isPermissionDenied = isClipboardPermissionDeniedError(err);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "复制纯 JSON 失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const exportCrashDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      const result = exportCrashDiagnosticToJson(payload, {
        sceneTag: "settings-experimental",
      });
      let openedPath: string | null = null;
      try {
        const opened = await openCrashDiagnosticDownloadDirectory();
        openedPath = opened.openedPath;
      } catch {
        openedPath = null;
      }
      setMessage({
        type: "success",
        text: openedPath
          ? `诊断文件已导出：${result.fileName}，并已打开目录：${openedPath}`
          : `诊断文件已导出：${result.fileName}（位置：${result.locationHint}）`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("导出诊断信息失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "导出诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const openCrashDownloadDirectory = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const result = await openCrashDiagnosticDownloadDirectory();
      setMessage({
        type: "success",
        text: `已打开下载目录：${result.openedPath}`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("打开下载目录失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "打开下载目录失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, []);

  // 加载中状态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 错误状态
  if (error && !config) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">加载配置失败</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <button
          onClick={loadConfig}
          className="mt-2 text-sm text-primary hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* 页面标题 */}
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="h-5 w-5 text-primary" />
        <div>
          <h3 className="text-sm font-medium">实验室功能</h3>
          <p className="text-xs text-muted-foreground">
            这些功能仍在开发中，可能不稳定
          </p>
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            message.type === "success"
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {message.text}
        </div>
      )}

      {showClipboardGuide && <ClipboardPermissionGuideCard />}

      {/* 截图对话功能 */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Camera className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <h4 className="text-sm font-medium">截图对话</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                使用全局快捷键截取屏幕区域，并与 AI 进行对话
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config?.screenshot_chat.enabled ?? false}
              onChange={handleToggleSmartInput}
              disabled={saving}
              className="sr-only peer"
            />
            <div
              className={cn(
                "w-9 h-5 rounded-full transition-colors",
                "bg-muted peer-checked:bg-primary",
                "after:content-[''] after:absolute after:top-0.5 after:left-0.5",
                "after:bg-white after:rounded-full after:h-4 after:w-4",
                "after:transition-transform peer-checked:after:translate-x-4",
                saving && "opacity-50 cursor-not-allowed",
              )}
            />
          </label>
        </div>

        {/* 快捷键设置 - 仅在功能启用时显示 */}
        {config?.screenshot_chat.enabled && (
          <div className="pt-3 border-t">
            <ShortcutSettings
              currentShortcut={config.screenshot_chat.shortcut}
              onShortcutChange={handleShortcutChange}
              onValidate={handleValidateShortcut}
              disabled={saving}
            />
          </div>
        )}

        {/* macOS 权限警告 */}
        {isMacOS && config?.screenshot_chat.enabled && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs flex-1">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                需要屏幕录制权限
              </p>
              <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                截图功能需要屏幕录制权限才能正常工作。如果截图只显示桌面背景而不是窗口内容，请授权此权限。
              </p>
              <button
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-shell");
                    await open(
                      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                    );
                  } catch (e) {
                    console.error("打开系统设置失败:", e);
                  }
                }}
                className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
              >
                打开系统设置
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 自动更新检查设置 */}
      <div className="rounded-lg border p-4">
        <UpdateCheckSettings />
      </div>

      {/* 崩溃上报 */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Bug className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <h4 className="text-sm font-medium">崩溃上报（Sentry）</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                收集前端渲染错误与崩溃信息，用于定位 Windows 客诉闪退问题
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(crashConfig.enabled)}
              onChange={handleCrashEnabledToggle}
              disabled={saving}
              className="sr-only peer"
            />
            <div
              className={cn(
                "w-9 h-5 rounded-full transition-colors",
                "bg-muted peer-checked:bg-primary",
                "after:content-[''] after:absolute after:top-0.5 after:left-0.5",
                "after:bg-white after:rounded-full after:h-4 after:w-4",
                "after:transition-transform peer-checked:after:translate-x-4",
                saving && "opacity-50 cursor-not-allowed",
              )}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs text-muted-foreground">DSN</label>
            <input
              value={crashConfig.dsn ?? ""}
              onChange={(event) =>
                handleCrashFieldChange("dsn", event.target.value || null)
              }
              disabled={saving}
              placeholder="https://xxx@o0.ingest.sentry.io/0"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Environment</label>
            <input
              value={crashConfig.environment ?? "production"}
              onChange={(event) =>
                handleCrashFieldChange("environment", event.target.value)
              }
              disabled={saving}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">采样率 (0-1)</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={Number(crashConfig.sample_rate ?? 1)}
              onChange={(event) =>
                handleCrashFieldChange(
                  "sample_rate",
                  Number(event.target.value || 1),
                )
              }
              disabled={saving}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(crashConfig.send_pii)}
            onChange={(event) =>
              handleCrashFieldChange("send_pii", event.target.checked)
            }
            disabled={saving}
            className="h-4 w-4 rounded border"
          />
          发送默认 PII 字段（默认关闭）
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            关闭后仅写本地日志，不发送远端。若 DSN 为空，也会自动仅本地记录。
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyCrashDiagnostic()}
              disabled={saving || diagnosticBusy}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs transition-colors",
                (saving || diagnosticBusy) && "opacity-50 cursor-not-allowed",
              )}
            >
              复制诊断信息
            </button>
            <button
              type="button"
              onClick={() => void exportCrashDiagnostic()}
              disabled={saving || diagnosticBusy}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs transition-colors",
                (saving || diagnosticBusy) && "opacity-50 cursor-not-allowed",
              )}
            >
              导出诊断 JSON
            </button>
            <button
              type="button"
              onClick={() => void copyCrashDiagnosticJson()}
              disabled={saving || diagnosticBusy}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs transition-colors",
                (saving || diagnosticBusy) && "opacity-50 cursor-not-allowed",
              )}
            >
              复制纯 JSON
            </button>
            <button
              type="button"
              onClick={() => void openCrashDownloadDirectory()}
              disabled={saving || diagnosticBusy}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs transition-colors",
                (saving || diagnosticBusy) && "opacity-50 cursor-not-allowed",
              )}
            >
              打开下载目录
            </button>
            <button
              type="button"
              onClick={handleSaveCrashConfig}
              disabled={saving || diagnosticBusy}
              className={cn(
                "rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors",
                (saving || diagnosticBusy) && "opacity-50 cursor-not-allowed",
              )}
            >
              保存配置
            </button>
          </div>
        </div>
      </div>

      <WorkspaceRepairHistoryCard
        title="Workspace 自愈记录（实验室）"
        description="用于排查“路径不存在/自动迁移”问题，记录最近修复事件"
      />

      {/* 语音输入功能 */}
      {voiceConfig && (
        <div className="rounded-lg border p-4">
          <VoiceSettings
            config={voiceConfig}
            onConfigChange={handleVoiceConfigChange}
            onValidateShortcut={handleValidateShortcut}
            disabled={saving}
          />
        </div>
      )}

      {/* 更多实验功能占位 */}
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">更多实验功能即将推出...</p>
      </div>
    </div>
  );
}

export default ExperimentalSettings;
