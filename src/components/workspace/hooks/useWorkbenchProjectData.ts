import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type ContentListItem,
  type Project,
  type ProjectType,
  listContents,
  listProjects,
} from "@/lib/api/project";
import type { WorkspaceTheme } from "@/types/page";

export interface UseWorkbenchProjectDataParams {
  theme: WorkspaceTheme;
  initialProjectId?: string;
  initialContentId?: string;
}

export function useWorkbenchProjectData({
  theme,
  initialProjectId,
  initialContentId,
}: UseWorkbenchProjectDataParams) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectId ?? null,
  );

  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    initialContentId ?? null,
  );

  const [projectQuery, setProjectQuery] = useState("");
  const [contentQuery, setContentQuery] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) {
      return projects;
    }

    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(query) ||
        project.tags.some((tag) => tag.toLowerCase().includes(query)),
    );
  }, [projectQuery, projects]);

  const filteredContents = useMemo(() => {
    const query = contentQuery.trim().toLowerCase();
    if (!query) {
      return contents;
    }

    return contents.filter((content) =>
      content.title.toLowerCase().includes(query),
    );
  }, [contentQuery, contents]);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const allProjects = await listProjects();
      const typedProjects = allProjects.filter(
        (project) =>
          project.workspaceType === (theme as ProjectType) &&
          !project.isArchived,
      );

      setProjects(typedProjects);
      setSelectedProjectId((previousId) => {
        if (
          previousId &&
          typedProjects.some((project) => project.id === previousId)
        ) {
          return previousId;
        }

        if (
          initialProjectId &&
          typedProjects.some((project) => project.id === initialProjectId)
        ) {
          return initialProjectId;
        }

        return typedProjects[0]?.id ?? null;
      });
    } catch (error) {
      console.error("加载主题项目失败:", error);
      toast.error("加载项目失败");
    } finally {
      setProjectsLoading(false);
    }
  }, [initialProjectId, theme]);

  const loadContents = useCallback(
    async (projectId: string) => {
      setContentsLoading(true);
      try {
        const contentList = await listContents(projectId);
        // 防御性编程：确保 contentList 是数组
        const safeContentList = Array.isArray(contentList) ? contentList : [];
        setContents(safeContentList);

        setSelectedContentId((previousId) => {
          if (
            previousId &&
            safeContentList.some((content) => content.id === previousId)
          ) {
            return previousId;
          }

          if (
            initialContentId &&
            safeContentList.some((content) => content.id === initialContentId)
          ) {
            return initialContentId;
          }

          return safeContentList[0]?.id ?? null;
        });
      } catch (error) {
        console.error("加载文稿失败:", error);
        toast.error("加载文稿失败");
      } finally {
        setContentsLoading(false);
      }
    },
    [initialContentId],
  );

  const resetProjectAndContentQueries = useCallback(() => {
    setProjectQuery("");
    setContentQuery("");
  }, []);

  const clearContentsSelection = useCallback(() => {
    setContents([]);
    setSelectedContentId(null);
  }, []);

  return {
    projects,
    projectsLoading,
    selectedProjectId,
    setSelectedProjectId,
    contents,
    contentsLoading,
    selectedContentId,
    setSelectedContentId,
    projectQuery,
    setProjectQuery,
    contentQuery,
    setContentQuery,
    selectedProject,
    filteredProjects,
    filteredContents,
    loadProjects,
    loadContents,
    resetProjectAndContentQueries,
    clearContentsSelection,
  };
}

export default useWorkbenchProjectData;
