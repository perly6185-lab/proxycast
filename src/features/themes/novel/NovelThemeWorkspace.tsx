import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThemeWorkspaceRendererProps } from "@/features/themes/types";
import { NovelCategoryCard } from "./components/NovelCategoryCard";
import { RecentWorksSection, type RecentNovelWork } from "./components/RecentWorksSection";
import { AIToolsSection } from "./components/AIToolsSection";
import { NOVEL_CATEGORIES } from "./types";
import { NOVEL_AI_TOOLS } from "./constants/aiTools";
import { useProjects } from "@/hooks/useProjects";
import { getContentStats, listContents } from "@/lib/api/project";
import type { Project } from "@/types/project";
import { toast } from "sonner";

function buildAutoProjectName(prefix: string): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${prefix}-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function getLatestNovelProject(projects: Project[]): Project | null {
  const recentNovelProjects = projects
    .filter((project) => !project.isArchived && project.workspaceType === "novel")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return recentNovelProjects[0] ?? null;
}

export function NovelThemeWorkspace({
  projectId,
  onOpenCreateProjectDialog,
  onProjectSelect,
  onQuickCreateNovelEntry,
  onOpenProjectWriting,
}: ThemeWorkspaceRendererProps) {
  const { projects, loading } = useProjects();
  const currentProject = useMemo(
    () =>
      projectId
        ? (projects as Project[]).find((project) => project.id === projectId) ?? null
        : null,
    [projectId, projects],
  );
  const latestProject = useMemo(
    () => getLatestNovelProject(projects as Project[]),
    [projects],
  );
  const activeProject = currentProject ?? latestProject;

  const [recentWork, setRecentWork] = useState<RecentNovelWork | null>(null);
  const [creatingCategoryId, setCreatingCategoryId] = useState<string | null>(null);
  const [loadingToolId, setLoadingToolId] = useState<string | null>(null);
  const [startingRecentProject, setStartingRecentProject] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadRecentWork = async () => {
      if (!activeProject) {
        if (mounted) {
          setRecentWork(null);
        }
        return;
      }

      try {
        const [contentStats, contents] = await Promise.all([
          getContentStats(activeProject.id),
          listContents(activeProject.id),
        ]);
        const latestContentTitle =
          [...contents].sort((a, b) => b.updated_at - a.updated_at)[0]?.title ||
          "未命名章节";

        if (!mounted) {
          return;
        }
        setRecentWork({
          project: activeProject,
          latestContentTitle,
          chapterCount: contentStats[0],
          totalWords: contentStats[1],
        });
      } catch {
        if (!mounted) {
          return;
        }
        setRecentWork({
          project: activeProject,
          latestContentTitle: "未命名章节",
          chapterCount: 0,
          totalWords: 0,
        });
      }
    };

    void loadRecentWork();

    return () => {
      mounted = false;
    };
  }, [activeProject]);

  const handleCategoryClick = useCallback(
    async (categoryId: string) => {
      const category = NOVEL_CATEGORIES.find((item) => item.id === categoryId);
      if (!category) {
        return;
      }

      if (!onQuickCreateNovelEntry) {
        onOpenCreateProjectDialog?.();
        return;
      }

      setCreatingCategoryId(category.id);
      try {
        await onQuickCreateNovelEntry({
          category: category.id,
          projectName: buildAutoProjectName(category.projectNamePrefix),
          autoCreateContent: true,
          contentTitle: category.defaultContentTitle,
          creationMode: "guided",
        });
      } catch {
        // 错误提示由上游统一处理
      } finally {
        setCreatingCategoryId(null);
      }
    },
    [onOpenCreateProjectDialog, onQuickCreateNovelEntry],
  );

  const handleStartWriting = useCallback(
    async (targetProjectId: string) => {
      if (onOpenProjectWriting) {
        setStartingRecentProject(true);
        try {
          await onOpenProjectWriting(targetProjectId, {
            fallbackContentTitle: "第一章",
            creationMode: "guided",
          });
        } catch {
          // 错误提示由上游统一处理
        } finally {
          setStartingRecentProject(false);
        }
        return;
      }

      onProjectSelect?.(targetProjectId);
    },
    [onOpenProjectWriting, onProjectSelect],
  );

  const handleUseTool = useCallback(
    async (tool: (typeof NOVEL_AI_TOOLS)[number]) => {
      setLoadingToolId(tool.id);
      try {
        if (activeProject && onOpenProjectWriting) {
          await onOpenProjectWriting(activeProject.id, {
            fallbackContentTitle: "AI工具草稿",
            initialUserPrompt: tool.presetPrompt,
            creationMode: "guided",
          });
          return;
        }

        if (onQuickCreateNovelEntry) {
          await onQuickCreateNovelEntry({
            category: "long",
            projectName: buildAutoProjectName("小说创作"),
            autoCreateContent: true,
            contentTitle: "AI工具草稿",
            initialUserPrompt: tool.presetPrompt,
            creationMode: "guided",
          });
          return;
        }

        onOpenCreateProjectDialog?.();
        toast.info("请先创建项目后使用 AI 工具");
      } catch {
        // 错误提示由上游统一处理
      } finally {
        setLoadingToolId(null);
      }
    },
    [activeProject, onOpenCreateProjectDialog, onOpenProjectWriting, onQuickCreateNovelEntry],
  );

  return (
    <div className="h-full overflow-y-auto bg-muted/20">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-5">
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">新的创作</h2>
          <div className="grid gap-3 md:grid-cols-3 grid-cols-1">
            {NOVEL_CATEGORIES.map((category) => (
              <NovelCategoryCard
                key={category.id}
                category={category}
                loading={creatingCategoryId === category.id}
                onClick={() => {
                  void handleCategoryClick(category.id);
                }}
              />
            ))}
          </div>
        </section>

        <RecentWorksSection
          work={recentWork}
          loading={loading || startingRecentProject}
          onStartWriting={(targetProjectId) => {
            void handleStartWriting(targetProjectId);
          }}
        />

        <AIToolsSection
          tools={NOVEL_AI_TOOLS}
          loadingToolId={loadingToolId}
          onUseTool={(tool) => {
            void handleUseTool(tool);
          }}
        />
      </div>
    </div>
  );
}
