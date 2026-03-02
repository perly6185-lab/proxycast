import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ThemeWorkspaceNavigationItem,
  ThemeWorkspaceView,
} from "@/features/themes/types";
import type { ProjectType } from "@/lib/api/project";
import { getProjectTypeLabel } from "@/lib/api/project";
import { CanvasBreadcrumbHeader } from "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader";

export interface WorkspaceTopbarProps {
  theme: ProjectType;
  projectName?: string;
  navigationItems: ThemeWorkspaceNavigationItem[];
  activeView: ThemeWorkspaceView;
  onViewChange: (view: ThemeWorkspaceView) => void;
  onBackHome?: () => void;
  onOpenCreateHome?: () => void;
  onBackToProjectManagement?: () => void;
  showBackToProjectManagement?: boolean;
}

export function WorkspaceTopbar({
  theme,
  projectName,
  navigationItems,
  activeView,
  onViewChange,
  onBackHome,
  onOpenCreateHome,
  onBackToProjectManagement,
  showBackToProjectManagement = true,
}: WorkspaceTopbarProps) {
  return (
    <header className="border-b bg-background">
      <div className="px-3 py-2 flex items-center gap-2">
        <CanvasBreadcrumbHeader
          label={getProjectTypeLabel(theme)}
          onBackHome={onBackHome}
        />
        {showBackToProjectManagement && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onBackToProjectManagement}
          >
            项目管理
          </Button>
        )}
        {onOpenCreateHome && (
          <Button
            variant={activeView === "create" ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={onOpenCreateHome}
          >
            创作首页
          </Button>
        )}
        {projectName && (
          <div className="text-xs text-muted-foreground truncate">{projectName}</div>
        )}
      </div>

      {navigationItems.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
          {navigationItems.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={activeView === item.key ? "default" : "outline"}
              className={cn("h-8")}
              onClick={() => onViewChange(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </header>
  );
}

export default WorkspaceTopbar;
