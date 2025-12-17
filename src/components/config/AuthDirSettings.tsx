import { useState, useEffect } from "react";
import {
  Folder,
  RotateCcw,
  Check,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { Config } from "@/lib/api/config";
import { invoke } from "@tauri-apps/api/core";

interface AuthDirSettingsProps {
  config: Config | null;
  onConfigChange: (config: Config) => void;
}

const DEFAULT_AUTH_DIR = "~/.proxycast/auth";

export function AuthDirSettings({
  config,
  onConfigChange,
}: AuthDirSettingsProps) {
  const [authDir, setAuthDir] = useState(DEFAULT_AUTH_DIR);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  // Load auth_dir from config
  useEffect(() => {
    if (config?.auth_dir) {
      setAuthDir(config.auth_dir);
    }
  }, [config]);

  // Validate and expand path
  const validatePath = async (path: string) => {
    try {
      const expanded = await invoke<string>("expand_path", { path });
      setExpandedPath(expanded);
      setError(null);
      return true;
    } catch (err) {
      setError(`路径无效: ${err}`);
      setExpandedPath(null);
      return false;
    }
  };

  // Handle path change
  const handlePathChange = (newPath: string) => {
    setAuthDir(newPath);
    setSaveSuccess(false);
    // Debounce validation
    const timer = setTimeout(() => {
      validatePath(newPath);
    }, 300);
    return () => clearTimeout(timer);
  };

  // Reset to default
  const handleReset = () => {
    setAuthDir(DEFAULT_AUTH_DIR);
    setSaveSuccess(false);
    validatePath(DEFAULT_AUTH_DIR);
  };

  // Save changes
  const handleSave = async () => {
    if (!config) return;

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      // Validate path first
      const isValid = await validatePath(authDir);
      if (!isValid) {
        setIsSaving(false);
        return;
      }

      // Update config
      const newConfig = {
        ...config,
        auth_dir: authDir,
      };
      onConfigChange(newConfig);
      setSaveSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(`保存失败: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Open folder in file manager
  const handleOpenFolder = async () => {
    try {
      await invoke("open_auth_dir", { path: authDir });
    } catch (err) {
      setError(`打开文件夹失败: ${err}`);
    }
  };

  const hasChanges = config?.auth_dir !== authDir;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Folder className="h-5 w-5" />
          认证目录设置
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          配置 OAuth Token 文件的存储目录。支持使用 ~ 表示用户主目录。
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">认证目录路径 (auth_dir)</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Folder className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={authDir}
                onChange={(e) => handlePathChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                placeholder={DEFAULT_AUTH_DIR}
              />
            </div>
            <button
              onClick={handleReset}
              className="p-2 rounded-lg border hover:bg-muted text-muted-foreground"
              title="重置为默认"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={handleOpenFolder}
              className="p-2 rounded-lg border hover:bg-muted text-muted-foreground"
              title="打开文件夹"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expanded path preview */}
        {expandedPath && (
          <div className="text-sm">
            <span className="text-muted-foreground">展开后路径: </span>
            <code className="rounded bg-muted px-2 py-0.5 text-xs">
              {expandedPath}
            </code>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Success message */}
        {saveSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
            <Check className="h-5 w-5" />
            <span className="text-sm">设置已保存</span>
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </div>

      {/* Help text */}
      <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
        <h4 className="text-sm font-medium">说明</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>认证目录用于存储 OAuth Token 文件（Kiro、Gemini、Qwen 等）</li>
          <li>
            使用 <code className="rounded bg-muted px-1">~</code>{" "}
            表示用户主目录，例如{" "}
            <code className="rounded bg-muted px-1">~/.proxycast/auth</code>
          </li>
          <li>修改此设置后，现有的 Token 文件不会自动迁移，需要手动移动</li>
          <li>导出配置时，Token 文件会从此目录读取并包含在导出包中</li>
        </ul>
      </div>
    </div>
  );
}
