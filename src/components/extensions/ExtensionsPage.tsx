import { useState } from "react";
import { Plug, MessageSquare, Boxes, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import { McpPage } from "../mcp/McpPage";
import { PromptsPage } from "../prompts/PromptsPage";
import { SkillsPage } from "../skills/SkillsPage";
import { PluginManager } from "../plugins/PluginManager";

type Tab = "mcp" | "prompts" | "skills" | "plugins";

const tabs = [
  { id: "mcp" as Tab, label: "MCP", icon: Plug },
  { id: "prompts" as Tab, label: "Prompts", icon: MessageSquare },
  { id: "skills" as Tab, label: "Skills", icon: Boxes },
  { id: "plugins" as Tab, label: "Plugins", icon: Puzzle },
];

export function ExtensionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("mcp");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">扩展</h2>
        <p className="text-muted-foreground">
          管理 MCP 服务器、Prompts 和 Skills
        </p>
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
        {activeTab === "mcp" && <McpPage hideHeader />}
        {activeTab === "prompts" && <PromptsPage hideHeader />}
        {activeTab === "skills" && <SkillsPage hideHeader />}
        {activeTab === "plugins" && <PluginManager />}
      </div>
    </div>
  );
}
