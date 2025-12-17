import React, {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { FileCode, RefreshCw, FolderOpen, Settings } from "lucide-react";
import { ConfigEditor } from "./ConfigEditor";
import { ImportExport } from "./ImportExport";
import { AuthDirSettings } from "./AuthDirSettings";
import { Config, configApi, ConfigPathInfo } from "@/lib/api/config";
import { invoke } from "@tauri-apps/api/core";

export interface ConfigPageRef {
  refresh: () => void;
}

type TabType = "editor" | "import-export" | "settings";

export const ConfigPage = forwardRef<ConfigPageRef>((_props, ref) => {
  const [activeTab, setActiveTab] = useState<TabType>("editor");
  const [config, setConfig] = useState<Config | null>(null);
  const [pathInfo, setPathInfo] = useState<ConfigPathInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Load current config from app state
      const currentConfig = await invoke<Config>("get_config");
      setConfig(currentConfig);

      // Load path info
      const paths = await configApi.getConfigPaths();
      setPathInfo(paths);
    } catch (err) {
      setError(`加载配置失败: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useImperativeHandle(ref, () => ({
    refresh: loadConfig,
  }));

  const handleConfigChange = async (newConfig: Config) => {
    setConfig(newConfig);
    // Save config to backend
    try {
      await invoke("save_config", { config: newConfig });
    } catch (err) {
      setError(`保存配置失败: ${err}`);
    }
  };

  const handleOpenConfigFolder = async () => {
    try {
      await invoke("open_config_folder", { appType: "ProxyCast" });
    } catch (err) {
      setError(`打开文件夹失败: ${err}`);
    }
  };

  const tabs: { id: TabType; label: string; icon?: React.ReactNode }[] = [
    { id: "editor", label: "YAML 编辑器" },
    { id: "import-export", label: "导入/导出" },
    { id: "settings", label: "设置", icon: <Settings className="h-4 w-4" /> },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FileCode className="h-6 w-6" />
            配置管理
          </h2>
          <p className="text-muted-foreground">
            编辑 YAML 配置文件，导入导出配置
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenConfigFolder}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
          >
            <FolderOpen className="h-4 w-4" />
            打开配置目录
          </button>
          <button
            onClick={loadConfig}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </div>

      {/* Config path info */}
      {pathInfo && (
        <div className="rounded-lg border bg-muted/50 p-3 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">配置文件:</span>
            <code className="rounded bg-muted px-2 py-0.5">
              {pathInfo.yaml_path}
            </code>
            {pathInfo.yaml_exists ? (
              <span className="text-green-600 text-xs">存在</span>
            ) : (
              <span className="text-yellow-600 text-xs">不存在</span>
            )}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="py-4">
        {activeTab === "editor" && (
          <ConfigEditor config={config} onConfigChange={handleConfigChange} />
        )}
        {activeTab === "import-export" && (
          <ImportExport config={config} onConfigImported={handleConfigChange} />
        )}
        {activeTab === "settings" && (
          <AuthDirSettings
            config={config}
            onConfigChange={handleConfigChange}
          />
        )}
      </div>
    </div>
  );
});

ConfigPage.displayName = "ConfigPage";
