import {
  FileText,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type ContentListItem,
  formatRelativeTime,
  getProjectTypeLabel,
  type Project,
  type ProjectType,
} from "@/lib/api/project";

export interface WorkbenchLeftSidebarProps {
  shouldRender: boolean;
  leftSidebarCollapsed: boolean;
  theme: ProjectType;
  projectsLoading: boolean;
  filteredProjects: Project[];
  selectedProjectId: string | null;
  projectQuery: string;
  onProjectQueryChange: (value: string) => void;
  onReloadProjects: () => void;
  onOpenCreateProjectDialog: () => void;
  onToggleLeftSidebar: () => void;
  onSelectProject: (projectId: string) => void;
  isCreateWorkspaceView: boolean;
  selectedContentId: string | null;
  currentContentTitle: string | null;
  activeWorkspaceViewLabel: string;
  selectedProjectForContentActions: boolean;
  onOpenCreateContentDialog: () => void;
  contentQuery: string;
  onContentQueryChange: (value: string) => void;
  contentsLoading: boolean;
  filteredContents: ContentListItem[];
  onSelectContent: (contentId: string) => void;
  onBackToCreateView: () => void;
  onOpenCreateHome: () => void;
}

export function WorkbenchLeftSidebar({
  shouldRender,
  leftSidebarCollapsed,
  theme,
  projectsLoading,
  filteredProjects,
  selectedProjectId,
  projectQuery,
  onProjectQueryChange,
  onReloadProjects,
  onOpenCreateProjectDialog,
  onToggleLeftSidebar,
  onSelectProject,
  isCreateWorkspaceView,
  selectedContentId,
  currentContentTitle,
  activeWorkspaceViewLabel,
  selectedProjectForContentActions,
  onOpenCreateContentDialog,
  contentQuery,
  onContentQueryChange,
  contentsLoading,
  filteredContents,
  onSelectContent,
  onBackToCreateView,
  onOpenCreateHome,
}: WorkbenchLeftSidebarProps) {
  if (!shouldRender) {
    return null;
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "border-r bg-muted/20 flex flex-col transition-all duration-300 ease-out",
          leftSidebarCollapsed ? "w-16" : "w-[260px] min-w-[240px]",
        )}
      >
        {leftSidebarCollapsed ? (
          <div className="flex flex-col items-center py-3 gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={onToggleLeftSidebar}
                >
                  <PanelLeftOpen className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>展开侧边栏 (⌘B)</p>
              </TooltipContent>
            </Tooltip>

            <div className="w-full border-t" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={onToggleLeftSidebar}
                >
                  <FolderOpen className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>项目列表</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={onToggleLeftSidebar}
                >
                  <FileText className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>文稿列表</p>
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <>
            <div className="px-3 py-3 border-b space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold truncate">
                    {getProjectTypeLabel(theme)}
                  </h2>
                  <p className="text-xs text-muted-foreground">主题项目管理</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onToggleLeftSidebar}
                    title="折叠侧边栏 (⌘B)"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onReloadProjects}
                    disabled={projectsLoading}
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", projectsLoading && "animate-spin")}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onOpenCreateProjectDialog}
                    title="新建项目"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Input
                value={projectQuery}
                onChange={(event) => onProjectQueryChange(event.target.value)}
                placeholder="搜索项目..."
                className="h-8 text-xs"
              />
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="min-h-0 basis-1/2 border-b flex flex-col">
                <div className="px-3 py-2 text-xs text-muted-foreground">项目</div>
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {filteredProjects.length === 0 ? (
                      <div className="px-2 py-6 text-xs text-muted-foreground text-center">
                        该主题下暂无项目
                      </div>
                    ) : (
                      filteredProjects.map((project) => (
                        <button
                          key={project.id}
                          className={cn(
                            "w-full text-left rounded-md px-2 py-2 transition-colors",
                            "hover:bg-accent",
                            selectedProjectId === project.id &&
                              "bg-accent text-accent-foreground",
                          )}
                          onClick={() => onSelectProject(project.id)}
                        >
                          <div className="flex items-center gap-2">
                            <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium truncate">
                              {project.name}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground truncate">
                            {getProjectTypeLabel(project.workspaceType)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="min-h-0 basis-1/2 flex flex-col">
                <div className="px-3 py-2 flex items-center gap-2">
                  <div className="text-xs text-muted-foreground flex-1">
                    {isCreateWorkspaceView ? "文稿" : "创作文稿"}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onOpenCreateContentDialog}
                    disabled={!selectedProjectForContentActions || !isCreateWorkspaceView}
                    title="新建文稿"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {isCreateWorkspaceView ? (
                  <>
                    <div className="px-2 pb-2">
                      <Input
                        value={contentQuery}
                        onChange={(event) => onContentQueryChange(event.target.value)}
                        placeholder="搜索文稿..."
                        className="h-8 text-xs"
                        disabled={!selectedProjectForContentActions}
                      />
                    </div>

                    {selectedContentId && (
                      <div className="px-2 pb-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={onOpenCreateHome}
                        >
                          返回创作首页
                        </Button>
                      </div>
                    )}

                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-1">
                        {contentsLoading ? (
                          <div className="px-2 py-6 text-xs text-muted-foreground text-center">
                            文稿加载中...
                          </div>
                        ) : filteredContents.length === 0 ? (
                          <div className="px-2 py-6 text-xs text-muted-foreground text-center">
                            还没有文稿
                          </div>
                        ) : (
                          filteredContents.map((content) => (
                            <button
                              key={content.id}
                              className={cn(
                                "w-full text-left rounded-md px-2 py-2 transition-colors",
                                "hover:bg-accent",
                                selectedContentId === content.id &&
                                  "bg-accent text-accent-foreground",
                              )}
                              onClick={() => onSelectContent(content.id)}
                            >
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium truncate">
                                  {content.title}
                                </span>
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground truncate">
                                {formatRelativeTime(content.updated_at)}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </>
                ) : (
                  <div className="px-2 pb-2">
                    <div className="rounded-md border bg-muted/30 px-3 py-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        当前处于「{activeWorkspaceViewLabel}」视图
                      </p>
                      {selectedContentId ? (
                        <p className="text-xs text-muted-foreground truncate">
                          当前文稿：{currentContentTitle}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">暂未选择文稿</p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={onBackToCreateView}
                      >
                        返回创作视图
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={onOpenCreateHome}
                      >
                        进入创作首页
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </TooltipProvider>
  );
}

export default WorkbenchLeftSidebar;
