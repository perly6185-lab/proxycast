import { useState } from "react";
import { Route, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoutingPage } from "./RoutingPage";
import { ResiliencePage } from "../resilience/ResiliencePage";

type Tab = "routing" | "resilience";

const tabs = [
  { id: "routing" as Tab, label: "智能路由", icon: Route },
  { id: "resilience" as Tab, label: "容错配置", icon: Shield },
];

export function RoutingManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>("routing");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">路由管理</h2>
        <p className="text-muted-foreground">配置智能路由规则和容错策略</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="pt-2">
        {activeTab === "routing" && <RoutingPageContent />}
        {activeTab === "resilience" && <ResiliencePageContent />}
      </div>
    </div>
  );
}

// 路由页面内容（去掉标题）
function RoutingPageContent() {
  return (
    <div className="routing-content">
      <RoutingPage hideHeader />
    </div>
  );
}

// 容错页面内容（去掉标题）
function ResiliencePageContent() {
  return (
    <div className="resilience-content">
      <ResiliencePage hideHeader />
    </div>
  );
}
