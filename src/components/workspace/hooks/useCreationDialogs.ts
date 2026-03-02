import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  createContent,
  createProject,
  extractErrorMessage,
  getContent,
  getContentTypeLabel,
  getCreateProjectErrorMessage,
  getDefaultContentTypeForProject,
  getProjectByRootPath,
  getProjectTypeLabel,
  getWorkspaceProjectsRoot,
  listContents,
  resolveProjectRootPath,
  type ProjectType,
} from "@/lib/api/project";
import type { WorkspaceTheme } from "@/types/page";
import type { CreationMode } from "@/components/content-creator/types";
import {
  buildCreationIntentMetadata,
  buildCreationIntentPrompt,
  createInitialCreationIntentValues,
  getCreationIntentFieldsSafe,
  isCreationMode,
  normalizeCreationMode,
  type CreationIntentFieldKey,
  type CreationIntentFormValues,
  type CreationIntentInput,
  validateCreationIntent,
} from "@/components/workspace/utils/creationIntentPrompt";
import { reportFrontendError } from "@/lib/crashReporting";

type CreateContentDialogStep = "mode" | "intent";

interface CreateContentDialogState {
  step: CreateContentDialogStep;
  selectedCreationMode: CreationMode;
  creationIntentValues: CreationIntentFormValues;
  creationIntentError: string;
}

type CreateContentDialogAction =
  | {
      type: "reset";
      defaultMode: CreationMode;
    }
  | {
      type: "setStep";
      step: CreateContentDialogStep;
    }
  | {
      type: "setMode";
      mode: unknown;
    }
  | {
      type: "setError";
      error: string;
    }
  | {
      type: "updateIntentValue";
      key: CreationIntentFieldKey;
      value: string;
    }
  | {
      type: "goIntentStep";
    };

function createInitialContentDialogState(
  defaultMode: CreationMode,
): CreateContentDialogState {
  return {
    step: "mode",
    selectedCreationMode: normalizeCreationMode(defaultMode),
    creationIntentValues: createInitialCreationIntentValues(),
    creationIntentError: "",
  };
}

function createContentDialogReducer(
  state: CreateContentDialogState,
  action: CreateContentDialogAction,
): CreateContentDialogState {
  switch (action.type) {
    case "reset":
      return createInitialContentDialogState(action.defaultMode);
    case "setStep":
      return {
        ...state,
        step: action.step,
      };
    case "setMode":
      return {
        ...state,
        selectedCreationMode: normalizeCreationMode(action.mode),
      };
    case "setError":
      return {
        ...state,
        creationIntentError: action.error,
      };
    case "updateIntentValue":
      return {
        ...state,
        creationIntentValues: {
          ...state.creationIntentValues,
          [action.key]: action.value,
        },
        creationIntentError: "",
      };
    case "goIntentStep":
      return {
        ...state,
        step: "intent",
        creationIntentError: "",
      };
    default:
      return state;
  }
}

function parseCreationModeFromMetadata(metadata: unknown): CreationMode | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const mode = (metadata as Record<string, unknown>).creationMode;
  return isCreationMode(mode) ? mode : null;
}

function useWorkspaceProjectsRootLoader(
  setWorkspaceProjectsRoot: Dispatch<SetStateAction<string>>,
): void {
  useEffect(() => {
    let mounted = true;

    const loadWorkspaceRoot = async () => {
      try {
        const root = await getWorkspaceProjectsRoot();
        if (mounted) {
          setWorkspaceProjectsRoot(root);
        }
      } catch (error) {
        console.error("加载 workspace 目录失败:", error);
      }
    };

    void loadWorkspaceRoot();

    return () => {
      mounted = false;
    };
  }, [setWorkspaceProjectsRoot]);
}

interface UseProjectPathResolverParams {
  createProjectDialogOpen: boolean;
  newProjectName: string;
  resetProjectPathState: () => void;
  setResolvedProjectPath: Dispatch<SetStateAction<string>>;
}

function useProjectPathResolver({
  createProjectDialogOpen,
  newProjectName,
  resetProjectPathState,
  setResolvedProjectPath,
}: UseProjectPathResolverParams): void {
  useEffect(() => {
    if (!createProjectDialogOpen) {
      resetProjectPathState();
      return;
    }

    const projectName = newProjectName.trim();
    if (!projectName) {
      resetProjectPathState();
      return;
    }

    let mounted = true;
    const resolvePath = async () => {
      try {
        const path = await resolveProjectRootPath(projectName);
        if (mounted) {
          setResolvedProjectPath(path);
        }
      } catch (error) {
        console.error("解析项目目录失败:", error);
        if (mounted) {
          resetProjectPathState();
        }
      }
    };

    void resolvePath();

    return () => {
      mounted = false;
    };
  }, [
    createProjectDialogOpen,
    newProjectName,
    resetProjectPathState,
    setResolvedProjectPath,
  ]);
}

interface UseProjectPathConflictCheckerParams {
  createProjectDialogOpen: boolean;
  resolvedProjectPath: string;
  setPathChecking: Dispatch<SetStateAction<boolean>>;
  setPathConflictMessage: Dispatch<SetStateAction<string>>;
}

function useProjectPathConflictChecker({
  createProjectDialogOpen,
  resolvedProjectPath,
  setPathChecking,
  setPathConflictMessage,
}: UseProjectPathConflictCheckerParams): void {
  useEffect(() => {
    if (!createProjectDialogOpen || !resolvedProjectPath) {
      setPathChecking(false);
      setPathConflictMessage("");
      return;
    }

    let mounted = true;
    setPathChecking(true);

    const checkPathConflict = async () => {
      try {
        const existingProject = await getProjectByRootPath(resolvedProjectPath);
        if (!mounted) {
          return;
        }
        if (existingProject) {
          setPathConflictMessage(`路径已存在项目：${existingProject.name}`);
        } else {
          setPathConflictMessage("");
        }
      } catch (error) {
        console.error("检查项目路径冲突失败:", error);
        if (mounted) {
          setPathConflictMessage("");
        }
      } finally {
        if (mounted) {
          setPathChecking(false);
        }
      }
    };

    void checkPathConflict();

    return () => {
      mounted = false;
    };
  }, [
    createProjectDialogOpen,
    resolvedProjectPath,
    setPathChecking,
    setPathConflictMessage,
  ]);
}

interface UseContentCreationModeLoaderParams {
  selectedContentId: string | null;
  contentCreationModes: Record<string, CreationMode>;
  setContentCreationModes: Dispatch<SetStateAction<Record<string, CreationMode>>>;
}

function useContentCreationModeLoader({
  selectedContentId,
  contentCreationModes,
  setContentCreationModes,
}: UseContentCreationModeLoaderParams): void {
  useEffect(() => {
    if (!selectedContentId || contentCreationModes[selectedContentId]) {
      return;
    }

    let mounted = true;
    const loadCreationMode = async () => {
      try {
        const content = await getContent(selectedContentId);
        const mode = parseCreationModeFromMetadata(content?.metadata);

        if (mounted && mode) {
          setContentCreationModes((previous) => ({
            ...previous,
            [selectedContentId]: mode,
          }));
        }
      } catch (error) {
        console.error("读取文稿创作模式失败:", error);
      }
    };

    void loadCreationMode();

    return () => {
      mounted = false;
    };
  }, [contentCreationModes, selectedContentId, setContentCreationModes]);
}

export interface UseCreationDialogsParams {
  theme: WorkspaceTheme;
  selectedProjectId: string | null;
  selectedContentId: string | null;
  loadProjects: () => Promise<void>;
  loadContents: (projectId: string) => Promise<void>;
  onEnterWorkspace: (
    contentId: string,
    options?: {
      showChatPanel?: boolean;
    },
  ) => void;
  onProjectCreated: (projectId: string) => void;
  defaultCreationMode: CreationMode;
  minCreationIntentLength: number;
}

export interface QuickCreateProjectAndContentOptions {
  projectName: string;
  workspaceType?: ProjectType;
  contentTitle?: string;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
}

export interface OpenProjectForWritingOptions {
  fallbackContentTitle?: string;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
}

export function useCreationDialogs({
  theme,
  selectedProjectId,
  selectedContentId,
  loadProjects,
  loadContents,
  onEnterWorkspace,
  onProjectCreated,
  defaultCreationMode,
  minCreationIntentLength,
}: UseCreationDialogsParams) {
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [createContentDialogOpen, setCreateContentDialogOpen] = useState(false);
  const [createContentDialogState, dispatchCreateContentDialog] = useReducer(
    createContentDialogReducer,
    defaultCreationMode,
    createInitialContentDialogState,
  );
  const [newProjectName, setNewProjectName] = useState("");
  const [workspaceProjectsRoot, setWorkspaceProjectsRoot] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingContent, setCreatingContent] = useState(false);
  const [resolvedProjectPath, setResolvedProjectPath] = useState("");
  const [pathChecking, setPathChecking] = useState(false);
  const [pathConflictMessage, setPathConflictMessage] = useState("");
  const [pendingInitialPromptsByContentId, setPendingInitialPromptsByContentId] =
    useState<Record<string, string>>({});
  const [contentCreationModes, setContentCreationModes] = useState<
    Record<string, CreationMode>
  >({});

  const resetProjectPathState = useCallback(() => {
    setResolvedProjectPath("");
    setPathChecking(false);
    setPathConflictMessage("");
  }, []);

  const creationIntentInput = useMemo<CreationIntentInput>(
    () => ({
      creationMode: createContentDialogState.selectedCreationMode,
      values: createContentDialogState.creationIntentValues,
    }),
    [createContentDialogState.creationIntentValues, createContentDialogState.selectedCreationMode],
  );

  const currentCreationIntentFields = useMemo(
    () => getCreationIntentFieldsSafe(createContentDialogState.selectedCreationMode),
    [createContentDialogState.selectedCreationMode],
  );

  const currentIntentLength = useMemo(
    () =>
      validateCreationIntent(creationIntentInput, minCreationIntentLength).length,
    [creationIntentInput, minCreationIntentLength],
  );

  const resetCreateContentDialogState = useCallback(() => {
    dispatchCreateContentDialog({
      type: "reset",
      defaultMode: defaultCreationMode,
    });
  }, [defaultCreationMode]);

  const setCreateContentDialogStep = useCallback(
    (step: CreateContentDialogStep) => {
      dispatchCreateContentDialog({
        type: "setStep",
        step,
      });
    },
    [],
  );

  const setSelectedCreationMode = useCallback((mode: CreationMode) => {
    dispatchCreateContentDialog({
      type: "setMode",
      mode,
    });
  }, []);

  const setCreationIntentError = useCallback((error: string) => {
    dispatchCreateContentDialog({
      type: "setError",
      error,
    });
  }, []);

  const handleOpenCreateProjectDialog = useCallback(() => {
    setNewProjectName(`${getProjectTypeLabel(theme as ProjectType)}项目`);
    resetProjectPathState();
    setCreateProjectDialogOpen(true);
  }, [resetProjectPathState, theme]);

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim();

    if (!name) {
      toast.error("请输入项目名称");
      return;
    }

    setCreatingProject(true);
    try {
      const rootPath = await resolveProjectRootPath(name);
      const createdProject = await createProject({
        name,
        rootPath,
        workspaceType: theme as ProjectType,
      });
      setCreateProjectDialogOpen(false);
      onProjectCreated(createdProject.id);
      toast.success("已创建新项目");
      await loadProjects();

      // 自动创建默认文稿并进入创作页面
      try {
        const defaultContentType = getDefaultContentTypeForProject(createdProject.workspaceType);
        const contentTypeLabel = getContentTypeLabel(defaultContentType);
        const defaultContent = await createContent({
          project_id: createdProject.id,
          title: `新${contentTypeLabel}`,
          content_type: defaultContentType,
        });

        // 加载文稿列表并进入创作页面
        await loadContents(createdProject.id);
        onEnterWorkspace(defaultContent.id);
      } catch (contentError) {
        console.error("自动创建默认文稿失败:", contentError);
        // 文稿创建失败不影响项目创建成功的提示
        // 用户可以手动创建文稿
      }
    } catch (error) {
      console.error("创建项目失败:", error);
      void reportFrontendError(error, {
        component: "useCreationDialogs",
        workflow_step: "workspace_creation_create_project",
      });
      const errorMessage = extractErrorMessage(error);
      const friendlyMessage = getCreateProjectErrorMessage(errorMessage);
      toast.error(`创建项目失败: ${friendlyMessage}`);
    } finally {
      setCreatingProject(false);
    }
  }, [loadProjects, loadContents, newProjectName, onProjectCreated, onEnterWorkspace, theme]);

  const handleQuickCreateProjectAndContent = useCallback(
    async (options: QuickCreateProjectAndContentOptions) => {
      const projectName = options.projectName.trim();
      if (!projectName) {
        throw new Error("项目名称不能为空");
      }

      const projectType = options.workspaceType ?? (theme as ProjectType);
      const creationMode = normalizeCreationMode(
        options.creationMode ?? defaultCreationMode,
      );
      const initialPrompt = options.initialUserPrompt?.trim() || "";

      try {
        const rootPath = await resolveProjectRootPath(projectName);
        const createdProject = await createProject({
          name: projectName,
          rootPath,
          workspaceType: projectType,
        });

        onProjectCreated(createdProject.id);
        await loadProjects();

        const defaultContentType = getDefaultContentTypeForProject(
          createdProject.workspaceType,
        );
        const contentTitle =
          options.contentTitle?.trim() ||
          `新${getContentTypeLabel(defaultContentType)}`;
        const createdContent = await createContent({
          project_id: createdProject.id,
          title: contentTitle,
          content_type: defaultContentType,
          metadata: {
            creationMode,
            quickCreate: true,
          },
        });

        setContentCreationModes((previous) => ({
          ...previous,
          [createdContent.id]: creationMode,
        }));

        if (initialPrompt) {
          setPendingInitialPromptsByContentId((previous) => ({
            ...previous,
            [createdContent.id]: initialPrompt,
          }));
        }

        await loadContents(createdProject.id);
        onEnterWorkspace(createdContent.id, { showChatPanel: true });

        return {
          projectId: createdProject.id,
          contentId: createdContent.id,
        };
      } catch (error) {
        console.error("快速创建项目与文稿失败:", error);
        void reportFrontendError(error, {
          component: "useCreationDialogs",
          workflow_step: "workspace_creation_quick_create_project_content",
        });
        toast.error(`创建失败: ${extractErrorMessage(error)}`);
        throw error;
      }
    },
    [defaultCreationMode, loadContents, loadProjects, onEnterWorkspace, onProjectCreated, theme],
  );

  const handleOpenProjectForWriting = useCallback(
    async (projectId: string, options?: OpenProjectForWritingOptions) => {
      const creationMode = normalizeCreationMode(
        options?.creationMode ?? defaultCreationMode,
      );
      const initialPrompt = options?.initialUserPrompt?.trim() || "";

      try {
        const existingContents = await listContents(projectId);
        const latestContent = [...existingContents].sort(
          (a, b) => b.updated_at - a.updated_at,
        )[0];

        let targetContentId = latestContent?.id || "";

        if (!targetContentId) {
          const defaultContentType = getDefaultContentTypeForProject(
            theme as ProjectType,
          );
          const fallbackTitle =
            options?.fallbackContentTitle?.trim() ||
            `新${getContentTypeLabel(defaultContentType)}`;
          const createdContent = await createContent({
            project_id: projectId,
            title: fallbackTitle,
            content_type: defaultContentType,
            metadata: {
              creationMode,
              quickCreate: true,
            },
          });
          targetContentId = createdContent.id;
          setContentCreationModes((previous) => ({
            ...previous,
            [createdContent.id]: creationMode,
          }));
        }

        if (initialPrompt) {
          setPendingInitialPromptsByContentId((previous) => ({
            ...previous,
            [targetContentId]: initialPrompt,
          }));
        }

        onProjectCreated(projectId);
        await loadContents(projectId);
        onEnterWorkspace(targetContentId, { showChatPanel: true });
        return targetContentId;
      } catch (error) {
        console.error("打开项目写作失败:", error);
        void reportFrontendError(error, {
          component: "useCreationDialogs",
          workflow_step: "workspace_open_project_for_writing",
        });
        toast.error(`打开写作失败: ${extractErrorMessage(error)}`);
        throw error;
      }
    },
    [defaultCreationMode, loadContents, onEnterWorkspace, onProjectCreated, theme],
  );

  const handleOpenCreateContentDialog = useCallback(() => {
    if (!selectedProjectId) {
      return;
    }
    resetCreateContentDialogState();
    setCreateContentDialogOpen(true);
  }, [resetCreateContentDialogState, selectedProjectId]);

  const handleCreationIntentValueChange = useCallback(
    (key: CreationIntentFieldKey, value: string) => {
      dispatchCreateContentDialog({
        type: "updateIntentValue",
        key,
        value,
      });
    },
    [],
  );

  const handleGoToIntentStep = useCallback(() => {
    const fields = getCreationIntentFieldsSafe(
      createContentDialogState.selectedCreationMode,
    );
    const hasOnlyFallbackTopicField =
      fields.length === 1 && fields[0]?.key === "topic";
    if (
      hasOnlyFallbackTopicField &&
      createContentDialogState.selectedCreationMode !== "guided"
    ) {
      console.warn(
        "[useCreationDialogs] 检测到创作模式字段异常，已降级为引导模式",
        {
          mode: createContentDialogState.selectedCreationMode,
          fieldCount: fields.length,
        },
      );
      dispatchCreateContentDialog({
        type: "setMode",
        mode: "guided",
      });
    }

    dispatchCreateContentDialog({
      type: "goIntentStep",
    });
  }, [createContentDialogState.selectedCreationMode]);

  const handleCreateContent = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }

    const validation = validateCreationIntent(
      creationIntentInput,
      minCreationIntentLength,
    );
    if (!validation.valid) {
      setCreationIntentError(validation.message || "请完善创作意图");
      return;
    }

    const initialUserPrompt = buildCreationIntentPrompt(creationIntentInput);
    const creationIntentMetadata =
      buildCreationIntentMetadata(creationIntentInput);

    setCreatingContent(true);
    try {
      const defaultType = getDefaultContentTypeForProject(theme as ProjectType);
      const created = await createContent({
        project_id: selectedProjectId,
        title: `新${getContentTypeLabel(defaultType)}`,
        content_type: defaultType,
        metadata: {
          creationMode: createContentDialogState.selectedCreationMode,
          creationIntent: creationIntentMetadata,
        },
      });

      setContentCreationModes((previous) => ({
        ...previous,
        [created.id]: createContentDialogState.selectedCreationMode,
      }));
      setPendingInitialPromptsByContentId((previous) => ({
        ...previous,
        [created.id]: initialUserPrompt,
      }));
      setCreateContentDialogOpen(false);
      resetCreateContentDialogState();
      await loadContents(selectedProjectId);
      onEnterWorkspace(created.id, { showChatPanel: true });
      toast.success("已创建新文稿");
    } catch (error) {
      console.error("创建文稿失败:", error);
      void reportFrontendError(error, {
        component: "useCreationDialogs",
        workflow_step: "workspace_creation_submit_intent",
        creation_mode: createContentDialogState.selectedCreationMode,
      });
      toast.error("创建文稿失败");
    } finally {
      setCreatingContent(false);
    }
  }, [
    creationIntentInput,
    loadContents,
    minCreationIntentLength,
    onEnterWorkspace,
    resetCreateContentDialogState,
    createContentDialogState.selectedCreationMode,
    selectedProjectId,
    setCreationIntentError,
    theme,
  ]);

  const consumePendingInitialPrompt = useCallback((contentId: string) => {
    setPendingInitialPromptsByContentId((previous) => {
      if (!previous[contentId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[contentId];
      return next;
    });
  }, []);

  useWorkspaceProjectsRootLoader(setWorkspaceProjectsRoot);
  useProjectPathResolver({
    createProjectDialogOpen,
    newProjectName,
    resetProjectPathState,
    setResolvedProjectPath,
  });
  useProjectPathConflictChecker({
    createProjectDialogOpen,
    resolvedProjectPath,
    setPathChecking,
    setPathConflictMessage,
  });
  useContentCreationModeLoader({
    selectedContentId,
    contentCreationModes,
    setContentCreationModes,
  });

  return {
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createContentDialogOpen,
    setCreateContentDialogOpen,
    createContentDialogStep: createContentDialogState.step,
    setCreateContentDialogStep,
    newProjectName,
    setNewProjectName,
    workspaceProjectsRoot,
    creatingProject,
    creatingContent,
    selectedCreationMode: createContentDialogState.selectedCreationMode,
    setSelectedCreationMode,
    creationIntentValues: createContentDialogState.creationIntentValues,
    creationIntentError: createContentDialogState.creationIntentError,
    setCreationIntentError,
    currentCreationIntentFields,
    currentIntentLength,
    pendingInitialPromptsByContentId,
    contentCreationModes,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    resetCreateContentDialogState,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    handleOpenCreateContentDialog,
    handleCreationIntentValueChange,
    handleGoToIntentStep,
    handleCreateContent,
    handleQuickCreateProjectAndContent,
    handleOpenProjectForWriting,
    consumePendingInitialPrompt,
  };
}

export default useCreationDialogs;
