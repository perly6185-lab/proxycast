import { useState } from "react";
import { Monitor, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClientsPage } from "../clients/ClientsPage";
import { ConfigPage } from "./ConfigPage";

type Tab = "switch" | "config";

const tabs = [
  { id: "switch" as Tab, label: "配置切换", icon: Monitor },
  { id: "config" as Tab, label: "配置文件", icon: FileCode },
];

export function ConfigManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>("switch");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">配置管理</h2>
        <p className="text-muted-foreground">管理客户端配置和配置文件</p>
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
        {activeTab === "switch" && <ClientsPage hideHeader />}
        {activeTab === "config" && <ConfigPage hideHeader />}
      </div>
    </div>
  );
}
