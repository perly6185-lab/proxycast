import React, { useState, useEffect, useCallback } from "react";
import {
  Server,
  Zap,
  Clock,
  Key,
  Monitor,
  Globe,
  AlertCircle,
  Coins,
  RefreshCw,
  LayoutDashboard,
  Activity,
  CheckCircle2,
} from "lucide-react";
import {
  getServerStatus,
  getConfig,
  ServerStatus,
  Config,
  getDefaultProvider,
} from "@/hooks/useTauri";
import { useAllOAuthCredentials } from "@/hooks/useOAuthCredentials";
import { useProviderPool } from "@/hooks/useProviderPool";
import { TokenStats } from "./monitoring/TokenStats";
import {
  getTokenStatsByDay,
  getTokenStatsByProvider,
  type PeriodTokenStats,
  type ProviderTokenStats,
} from "@/lib/api/telemetry";

type TabType = "overview" | "tokens";

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<string>("");
  const { reload: reloadCredentials } = useAllOAuthCredentials();
  const { refresh: refreshProviderPool } = useProviderPool();

  // Token 数据状态
  const [tokensByDay, setTokensByDay] = useState<PeriodTokenStats[]>([]);
  const [tokensByProvider, setTokensByProvider] = useState<
    Record<string, ProviderTokenStats>
  >({});
  const [monitoringLoading, setMonitoringLoading] = useState(false);

  // 获取基础数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [s, c, dp] = await Promise.all([
          getServerStatus(),
          getConfig(),
          getDefaultProvider(),
        ]);
        setStatus(s);
        setConfig(c);
        setDefaultProvider(dp);
      } catch (e) {
        console.error("Failed to fetch data:", e);
      }
    };

    fetchData();
    reloadCredentials();
    refreshProviderPool();

    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [reloadCredentials, refreshProviderPool]);

  // 获取Token数据
  const fetchMonitoringData = useCallback(async () => {
    try {
      setMonitoringLoading(true);
      const [dayStats, providerStats] = await Promise.all([
        getTokenStatsByDay(7),
        getTokenStatsByProvider({ preset: "7d" }),
      ]);

      setTokensByDay(dayStats);
      setTokensByProvider(providerStats);
    } catch (e) {
      console.error("Failed to fetch token data:", e);
    } finally {
      setMonitoringLoading(false);
    }
  }, []);

  // 切换到Token标签时加载数据
  useEffect(() => {
    if (activeTab === "tokens") {
      fetchMonitoringData();
    }
  }, [activeTab, fetchMonitoringData]);

  // 定时刷新Token数据
  useEffect(() => {
    if (activeTab === "tokens") {
      const interval = setInterval(fetchMonitoringData, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchMonitoringData]);

  const formatUptime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const serverUrl = status
    ? `http://${status.host}:${status.port}`
    : "http://localhost:8999";

  const getProviderName = (id: string) => {
    switch (id) {
      case "kiro":
        return "Kiro Claude";
      case "gemini":
        return "Gemini CLI";
      case "qwen":
        return "通义千问";
      case "openai":
        return "OpenAI 自定义";
      case "claude":
        return "Claude 自定义";
      default:
        return id;
    }
  };

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "tokens", label: "Token", icon: Coins },
  ];

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">仪表盘</h2>
          <p className="text-muted-foreground">系统状态与监控</p>
        </div>
        <div className="flex gap-2">
          {activeTab === "tokens" && (
            <button
              onClick={fetchMonitoringData}
              disabled={monitoringLoading}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${monitoringLoading ? "animate-spin" : ""}`}
              />
              刷新
            </button>
          )}
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      {activeTab === "overview" && (
        <OverviewTab
          status={status}
          config={config}
          defaultProvider={defaultProvider}
          serverUrl={serverUrl}
          formatUptime={formatUptime}
          getProviderName={getProviderName}
        />
      )}

      {activeTab === "tokens" && (
        <TokenStats
          summary={{
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            record_count: 0,
            actual_count: 0,
            estimated_count: 0,
            avg_input_tokens: 0,
            avg_output_tokens: 0,
          }}
          byProvider={tokensByProvider}
          byDay={tokensByDay}
        />
      )}

      {/* 加载状态 */}
      {activeTab === "tokens" &&
        monitoringLoading &&
        Object.keys(tokensByProvider).length === 0 && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
    </div>
  );
}

// 概览标签页内容
function OverviewTab({
  status,
  config,
  defaultProvider,
  serverUrl,
  formatUptime,
  getProviderName,
}: {
  status: ServerStatus | null;
  config: Config | null;
  defaultProvider: string;
  serverUrl: string;
  formatUptime: (secs: number) => string;
  getProviderName: (id: string) => string;
}) {
  return (
    <div className="space-y-6">
      {/* Server Status Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">服务状态</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${status?.running ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="font-medium">
              {status?.running ? "运行中" : "已停止"}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">请求数</span>
          </div>
          <div className="mt-2 text-2xl font-bold">{status?.requests || 0}</div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">运行时间</span>
          </div>
          <div className="mt-2 font-medium">
            {formatUptime(status?.uptime_secs || 0)}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">默认 Provider</span>
          </div>
          <div className="mt-2 font-medium">
            {defaultProvider ? getProviderName(defaultProvider) : "加载中..."}
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-3 gap-4">
        <QuickLinkCard
          icon={Key}
          title="凭证管理"
          description="管理 OAuth 凭证"
          status="info"
          statusText="Provider Pool 管理"
        />
        <QuickLinkCard
          icon={Monitor}
          title="配置切换"
          description="一键切换 Claude Code/Codex/Gemini CLI 的 API 配置"
          status="info"
          statusText="管理 Provider 配置"
        />
        <QuickLinkCard
          icon={Globe}
          title="API Server"
          description={`${serverUrl}`}
          status={status?.running ? "success" : "warning"}
          statusText={status?.running ? "运行中" : "已停止"}
        />
      </div>

      {/* Server Info */}
      {config && (
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 font-semibold">服务器信息</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">API 地址:</span>
              <code className="ml-2 rounded bg-muted px-2 py-1">
                {serverUrl}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">API Key:</span>
              <code className="ml-2 rounded bg-muted px-2 py-1">
                {config.server.api_key.length > 8
                  ? `${config.server.api_key.slice(0, 4)}****${config.server.api_key.slice(-4)}`
                  : "****"}
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickLinkCard({
  icon: Icon,
  title,
  description,
  status,
  statusText,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  status: "success" | "warning" | "error" | "info";
  statusText: string;
}) {
  const statusColors = {
    success: "text-green-600",
    warning: "text-yellow-600",
    error: "text-red-600",
    info: "text-blue-600",
  };

  const StatusIcon = status === "success" ? CheckCircle2 : AlertCircle;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="rounded-lg bg-primary/10 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h4 className="font-medium">{title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div
        className={`flex items-center gap-1 text-xs ${statusColors[status]}`}
      >
        <StatusIcon className="h-3 w-3" />
        {statusText}
      </div>
    </div>
  );
}
