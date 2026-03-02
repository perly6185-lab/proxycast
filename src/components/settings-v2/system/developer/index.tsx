/**
 * @file DeveloperSettings.tsx
 * @description 开发者设置页面 - 组件视图调试等开发工具
 */
import { useCallback, useState } from "react";
import { Bug, Code2, Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useComponentDebug } from "@/contexts/ComponentDebugContext";
import { getConfig, getLogs, getPersistedLogsTail } from "@/hooks/useTauri";
import {
  buildCrashDiagnosticPayload,
  copyCrashDiagnosticToClipboard,
  copyCrashDiagnosticJsonToClipboard,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { cn } from "@/lib/utils";
import { ClipboardPermissionGuideCard } from "../shared/ClipboardPermissionGuideCard";
import { WorkspaceRepairHistoryCard } from "../shared/WorkspaceRepairHistoryCard";

export function DeveloperSettings() {
  const { enabled, setEnabled } = useComponentDebug();
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);

  const buildDiagnosticPayload = useCallback(async () => {
    const [config, logs, persistedLogs] = await Promise.all([
      getConfig(),
      getLogs(),
      getPersistedLogsTail(200),
    ]);
    return buildCrashDiagnosticPayload({
      crashConfig: normalizeCrashReportingConfig(config.crash_reporting),
      logs,
      persistedLogTail: persistedLogs,
      appVersion: import.meta.env.VITE_APP_VERSION,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    });
  }, []);

  const handleCopyDiagnostic = useCallback(async () => {
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

  const handleCopyDiagnosticJson = useCallback(async () => {
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

  const handleExportDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      const result = exportCrashDiagnosticToJson(payload, {
        sceneTag: "settings-developer",
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

  const handleOpenDownloadDirectory = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
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

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <Code2 className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">开发者工具</h3>
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

      {/* 组件视图调试 */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Eye className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h4 className="font-medium">组件视图调试</h4>
              <p className="text-sm text-muted-foreground">
                显示组件轮廓，Alt+点击查看组件信息
              </p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="mt-4 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">使用说明:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>按住 Alt 键 + 鼠标悬浮显示组件轮廓</li>
              <li>Alt + 点击组件可查看名称和文件路径</li>
              <li>文件路径仅在开发模式 (npm run tauri dev) 下可用</li>
            </ul>
          </div>
        )}
      </div>

      {/* 崩溃诊断入口 */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-500/10 rounded-lg">
            <Bug className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h4 className="font-medium">崩溃诊断日志（开发协作）</h4>
            <p className="text-sm text-muted-foreground">
              用于定位 Windows 闪退与前端异常，包含最近 30 条 FrontendCrash 日志（DSN 自动脱敏）
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyDiagnostic()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            复制诊断信息
          </button>
          <button
            type="button"
            onClick={() => void handleCopyDiagnosticJson()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            复制纯 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleExportDiagnostic()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            导出诊断 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleOpenDownloadDirectory()}
            disabled={diagnosticBusy}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
              diagnosticBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            打开下载目录
          </button>
        </div>
      </div>

      <WorkspaceRepairHistoryCard description="仅用于开发排查，记录最近自动修复/迁移（不打断用户操作）" />
    </div>
  );
}
