import { useState, forwardRef, useImperativeHandle } from "react";
import { Shield, RefreshCw } from "lucide-react";
import { RetrySettings } from "./RetrySettings";
import { FailoverSettings } from "./FailoverSettings";

export interface ResiliencePageRef {
  refresh: () => void;
}

type TabType = "retry" | "failover";

interface ResiliencePageProps {
  hideHeader?: boolean;
}

export const ResiliencePage = forwardRef<
  ResiliencePageRef,
  ResiliencePageProps
>(({ hideHeader = false }, ref) => {
  const [activeTab, setActiveTab] = useState<TabType>("retry");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  useImperativeHandle(ref, () => ({
    refresh,
  }));

  const tabs: { id: TabType; label: string }[] = [
    { id: "retry", label: "重试配置" },
    { id: "failover", label: "故障转移" },
  ];

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6" />
              容错配置
            </h2>
            <p className="text-muted-foreground">配置重试机制和故障转移策略</p>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      )}

      {hideHeader && (
        <div className="flex items-center justify-end">
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="py-4" key={refreshKey}>
        {activeTab === "retry" && <RetrySettings />}
        {activeTab === "failover" && <FailoverSettings />}
      </div>
    </div>
  );
});

ResiliencePage.displayName = "ResiliencePage";
