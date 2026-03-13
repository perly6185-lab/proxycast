import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  FolderOpen,
  HardDriveDownload,
  ListChecks,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  SchedulerEvent,
  SchedulerExecutionResult,
  SchedulerProgress,
} from "@/lib/api/subAgentScheduler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import { SearchResultPreviewList } from "./SearchResultPreviewList";
import type { ActionRequired } from "../types";
import type {
  HarnessFileAction,
  HarnessActiveFileWrite,
  HarnessFileKind,
  HarnessOutputSignal,
  HarnessSessionState,
} from "../utils/harnessState";
import { formatArtifactWritePhaseLabel } from "../utils/messageArtifacts";
import {
  isUnifiedWebSearchToolName,
  resolveSearchResultPreviewItemsFromText,
} from "../utils/searchResultPreview";
import {
  classifySearchQuerySemantic,
  summarizeSearchQuerySemantics,
} from "../utils/searchQueryGrouping";

interface HarnessEnvironmentSummary {
  skillsCount: number;
  skillNames: string[];
  memorySignals: string[];
  contextItemsCount: number;
  activeContextCount: number;
  contextItemNames: string[];
  contextEnabled: boolean;
}

export interface HarnessFilePreviewResult {
  path?: string;
  content?: string | null;
  error?: string | null;
  isBinary?: boolean;
  size?: number;
}

interface HarnessStatusPanelProps {
  harnessState: HarnessSessionState;
  subAgentRuntime: {
    isRunning: boolean;
    progress: SchedulerProgress | null;
    events: SchedulerEvent[];
    result: SchedulerExecutionResult | null;
    error: string | null;
  };
  environment: HarnessEnvironmentSummary;
  layout?: "default" | "sidebar" | "dialog";
  onLoadFilePreview?: (path: string) => Promise<HarnessFilePreviewResult>;
  onOpenFile?: (fileName: string, content: string) => void;
  onRevealPath?: (path: string) => Promise<void>;
  onOpenPath?: (path: string) => Promise<void>;
  title?: string;
  description?: string;
  toggleLabel?: string;
  leadContent?: ReactNode;
}

interface PreviewDialogState {
  open: boolean;
  title: string;
  description?: string;
  path?: string;
  displayName: string;
  content?: string;
  preview?: string;
  error?: string;
  isBinary: boolean;
  size?: number;
  loading: boolean;
}

type FileFilterValue = "all" | HarnessFileKind;
type OutputFilterValue = "all" | "path" | "offload" | "truncated" | "summary";
type FileDisplayMode = "timeline" | "grouped";

type HarnessSectionKey =
  | "runtime"
  | "approvals"
  | "writes"
  | "files"
  | "outputs"
  | "plan"
  | "delegation"
  | "context"
  | "capabilities";

interface HarnessSectionNavItem {
  key: HarnessSectionKey;
  label: string;
}

interface HarnessSummaryCard {
  sectionKey: HarnessSectionKey;
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}

interface TextSegment {
  type: "text" | "url";
  value: string;
}

const URL_PATTERN_SOURCE = String.raw`\bhttps?:\/\/[^\s<>"'\`]+`;
const URL_TRAILING_PUNCTUATION = /[),.;!?]+$/;

function createUrlPattern(): RegExp {
  return new RegExp(URL_PATTERN_SOURCE, "gi");
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function formatTime(value?: Date): string {
  if (!value) {
    return "刚刚";
  }

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function describeAction(action: HarnessFileAction): string {
  switch (action) {
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "edit":
      return "编辑";
    case "offload":
      return "转存";
    case "persist":
      return "落盘";
    default:
      return action;
  }
}

function describeKind(kind: HarnessFileKind): string {
  switch (kind) {
    case "document":
      return "文档";
    case "code":
      return "代码";
    case "log":
      return "日志";
    case "artifact":
      return "产物";
    case "offload":
      return "转存";
    default:
      return "文件";
  }
}

function resolveKindIcon(kind: HarnessFileKind): LucideIcon {
  switch (kind) {
    case "code":
      return FileCode2;
    case "artifact":
    case "offload":
      return FileArchive;
    default:
      return FileText;
  }
}

function getSignalPath(signal: HarnessOutputSignal): string | undefined {
  return signal.offloadFile || signal.outputFile || signal.artifactPath;
}

function normalizeUrlCandidate(rawUrl: string): {
  url: string;
  trailing: string;
} {
  const normalized = rawUrl.replace(URL_TRAILING_PUNCTUATION, "");
  return {
    url: normalized || rawUrl,
    trailing: rawUrl.slice((normalized || rawUrl).length),
  };
}

function splitTextIntoSegments(text: string): TextSegment[] {
  if (!text.trim()) {
    return [{ type: "text", value: text }];
  }

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  const urlPattern = createUrlPattern();

  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        value: text.slice(lastIndex, matchIndex),
      });
    }

    const { url, trailing } = normalizeUrlCandidate(rawUrl);
    segments.push({ type: "url", value: url });
    if (trailing) {
      segments.push({ type: "text", value: trailing });
    }
    lastIndex = matchIndex + rawUrl.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      value: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

function findFirstUrl(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(createUrlPattern());
    if (!match || match.length === 0) {
      continue;
    }
    return normalizeUrlCandidate(match[0]).url;
  }
  return undefined;
}

function isSearchOutputSignal(signal: HarnessOutputSignal): boolean {
  if (isUnifiedWebSearchToolName(signal.toolName)) {
    return true;
  }

  return signal.title === "联网检索摘要";
}

function isLikelyFilePath(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return false;
  }

  if (/^(~\/|\/|[A-Za-z]:[\\/]|\.{1,2}[\\/])/.test(normalized)) {
    return true;
  }

  return (
    /[\\/]/.test(normalized) &&
    /\.[A-Za-z0-9_-]{1,12}(?:[#?].*)?$/.test(normalized)
  );
}

function summarizeFileActions(events: HarnessSessionState["recentFileEvents"]): string {
  const counts = new Map<HarnessFileAction, number>();

  for (const event of events) {
    counts.set(event.action, (counts.get(event.action) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([action, count]) => `${describeAction(action)} ${count}`)
    .join(" · ");
}

function matchesOutputFilter(
  signal: HarnessOutputSignal,
  filter: OutputFilterValue,
): boolean {
  const signalPath = getSignalPath(signal);

  switch (filter) {
    case "path":
      return Boolean(signalPath);
    case "offload":
      return Boolean(signal.offloaded || signal.offloadFile);
    case "truncated":
      return signal.truncated === true;
    case "summary":
      return !signalPath && Boolean(signal.preview?.trim());
    default:
      return true;
  }
}

function pickPathFromArguments(
  argumentsValue?: Record<string, unknown>,
): string | undefined {
  if (!argumentsValue) {
    return undefined;
  }

  for (const key of [
    "path",
    "filePath",
    "file_path",
    "fileName",
    "file_name",
    "filename",
    "targetPath",
    "target_path",
    "outputPath",
    "output_path",
  ]) {
    const value = argumentsValue[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function describeApproval(item: ActionRequired): string | undefined {
  const hints: string[] = [];

  if (item.toolName?.trim()) {
    hints.push(item.toolName.trim());
  }

  const path = pickPathFromArguments(item.arguments);
  if (path) {
    hints.push(path);
  }

  const command = item.arguments?.cmd ?? item.arguments?.command;
  if (typeof command === "string" && command.trim()) {
    hints.push(command.trim());
  }

  return hints.length > 0 ? hints.join(" · ") : undefined;
}

function formatRuntimePhaseLabel(
  runtimeStatus: HarnessSessionState["runtimeStatus"],
): string {
  if (!runtimeStatus) {
    return "空闲";
  }

  switch (runtimeStatus.phase) {
    case "preparing":
      return "准备中";
    case "routing":
      return "建回合中";
    case "context":
      return "装载上下文";
    default:
      return runtimeStatus.phase;
  }
}

function formatWriteSourceLabel(source?: string): string {
  switch (source) {
    case "tool_start":
      return "工具启动";
    case "artifact_snapshot":
      return "快照同步";
    case "tool_result":
      return "工具结果";
    case "message_content":
      return "消息流";
    default:
      return source || "运行中";
  }
}

function getActiveWriteDescription(write: HarnessActiveFileWrite): string {
  const parts = [
    formatArtifactWritePhaseLabel(write.phase),
    write.source ? formatWriteSourceLabel(write.source) : undefined,
    write.updatedAt ? formatTime(write.updatedAt) : undefined,
  ].filter(Boolean);

  return parts.join(" · ");
}

function summarizeSchedulerEvent(event: SchedulerEvent): string {
  switch (event.type) {
    case "started":
      return `开始调度 ${event.totalTasks} 个子任务`;
    case "taskStarted":
      return `任务 ${event.taskId} 开始执行`;
    case "taskCompleted":
      return `任务 ${event.taskId} 已完成`;
    case "taskFailed":
      return `任务 ${event.taskId} 失败：${event.error}`;
    case "taskRetry":
      return `任务 ${event.taskId} 重试第 ${event.retryCount} 次`;
    case "taskSkipped":
      return `任务 ${event.taskId} 已跳过：${event.reason}`;
    case "progress":
      return `进度 ${event.progress.completed}/${event.progress.total}`;
    case "completed":
      return `调度完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`;
    case "cancelled":
      return "调度已取消";
    default:
      return (event as { type: string }).type;
  }
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    await openExternal(url);
  } catch {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank");
      return;
    }
    throw new Error("当前环境不支持打开外部链接");
  }
}

function InteractiveText({
  text,
  className,
  mono = false,
  stopPropagation = false,
  onOpenUrl,
}: {
  text?: string;
  className?: string;
  mono?: boolean;
  stopPropagation?: boolean;
  onOpenUrl: (url: string) => void | Promise<void>;
}) {
  if (!text?.trim()) {
    return null;
  }

  const segments = splitTextIntoSegments(text);

  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-all",
        mono && "font-mono",
        className,
      )}
    >
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <span key={`text-${index}`} className="whitespace-pre-wrap">
              {segment.value}
            </span>
          );
        }

        const handleOpen = (
          event:
            | ReactMouseEvent<HTMLSpanElement>
            | ReactKeyboardEvent<HTMLSpanElement>,
        ) => {
          if ("key" in event && event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          if (stopPropagation) {
            event.stopPropagation();
          }
          void onOpenUrl(segment.value);
        };

        return (
          <span
            key={`url-${segment.value}-${index}`}
            role="link"
            tabIndex={0}
            aria-label={`打开链接：${segment.value}`}
            className="cursor-pointer underline decoration-dotted underline-offset-2 text-primary transition-colors hover:text-primary/80"
            onClick={handleOpen}
            onKeyDown={handleOpen}
          >
            {segment.value}
          </span>
        );
      })}
    </span>
  );
}

function PathTextLink({
  path,
  className,
  stopPropagation = false,
  onOpenPath,
}: {
  path?: string;
  className?: string;
  stopPropagation?: boolean;
  onOpenPath: (path: string) => void | Promise<void>;
}) {
  if (!path?.trim()) {
    return null;
  }

  const normalizedPath = path.trim();

  const handleOpen = (
    event:
      | ReactMouseEvent<HTMLSpanElement>
      | ReactKeyboardEvent<HTMLSpanElement>,
  ) => {
    if ("key" in event && event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (stopPropagation) {
      event.stopPropagation();
    }
    void onOpenPath(normalizedPath);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`系统打开路径：${normalizedPath}`}
      className={cn(
        "cursor-pointer break-all underline decoration-dotted underline-offset-2 text-primary transition-colors hover:text-primary/80",
        className,
      )}
      onClick={handleOpen}
      onKeyDown={handleOpen}
    >
      {normalizedPath}
    </span>
  );
}

function ActionableBadge({
  value,
  variant,
  onOpenUrl,
  onOpenPath,
}: {
  value: string;
  variant: ComponentProps<typeof Badge>["variant"];
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPath: (path: string) => void | Promise<void>;
}) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const matchedUrl = findFirstUrl(normalized);
  if (matchedUrl && matchedUrl === normalized) {
    return (
      <Badge variant={variant} className="max-w-full whitespace-normal">
        <InteractiveText text={normalized} onOpenUrl={onOpenUrl} />
      </Badge>
    );
  }

  if (isLikelyFilePath(normalized)) {
    return (
      <Badge variant={variant} className="max-w-full whitespace-normal">
        <PathTextLink path={normalized} onOpenPath={onOpenPath} />
      </Badge>
    );
  }

  return <Badge variant={variant}>{normalized}</Badge>;
}

function SearchOutputCard({
  signal,
  onOpenUrl,
  onOpenDetail,
}: {
  signal: HarnessOutputSignal;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenDetail: () => void;
}) {
  const [resultsExpanded, setResultsExpanded] = useState(true);
  const results = useMemo(
    () =>
      resolveSearchResultPreviewItemsFromText(
        signal.content?.trim() || signal.preview?.trim() || signal.summary.trim(),
      ),
    [signal.content, signal.preview, signal.summary],
  );

  useEffect(() => {
    setResultsExpanded(true);
  }, [signal.id]);
  const semantic = useMemo(
    () => classifySearchQuerySemantic(signal.summary),
    [signal.summary],
  );

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-orange-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <Search className="h-3.5 w-3.5" />
            <span>已搜索</span>
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-foreground">
            {signal.summary}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {signal.title}
            {results.length > 0 ? ` · ${results.length} 条结果` : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{semantic.label}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {results.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              aria-label={
                resultsExpanded
                  ? `收起搜索结果：${signal.summary}`
                  : `展开搜索结果：${signal.summary}`
              }
              onClick={() => setResultsExpanded((prev) => !prev)}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  resultsExpanded && "rotate-180",
                )}
              />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label={`查看工具输出：${signal.title}`}
            onClick={onOpenDetail}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {results.length > 0 && resultsExpanded ? (
        <SearchResultPreviewList
          items={results}
          onOpenUrl={onOpenUrl}
          popoverSide="left"
          popoverAlign="start"
          className="mt-3"
        />
      ) : !results.length && signal.preview ? (
        <div className="mt-3 rounded-xl bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
          <InteractiveText text={signal.preview} onOpenUrl={onOpenUrl} />
        </div>
      ) : null}
    </div>
  );
}

function SearchOutputBatchCard({
  signals,
  onOpenUrl,
  onOpenDetail,
}: {
  signals: HarnessOutputSignal[];
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenDetail: (signal: HarnessOutputSignal) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const semanticSummaries = useMemo(
    () => summarizeSearchQuerySemantics(signals.map((signal) => signal.summary)),
    [signals],
  );
  const preview = signals
    .slice(0, 2)
    .map((signal) => signal.summary)
    .join(" · ");
  const hiddenCount = Math.max(signals.length - 2, 0);

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label={expanded ? "收起搜索批次" : "展开搜索批次"}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-orange-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <Search className="h-3.5 w-3.5" />
            <span>已搜索 {signals.length} 组查询</span>
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-foreground">
            {preview}
            {hiddenCount > 0 ? ` 等 ${hiddenCount} 组` : ""}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            联网检索批次
          </div>
        </div>
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          aria-hidden="true"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {semanticSummaries.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {semanticSummaries.map((item) => (
            <Badge key={item.key} variant="secondary">
              {item.label} {item.count}
            </Badge>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3">
          {signals.map((signal) => (
            <SearchOutputCard
              key={signal.id}
              signal={signal}
              onOpenUrl={onOpenUrl}
              onOpenDetail={() => onOpenDetail(signal)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  hint,
  icon: Icon,
  onClick,
  compact = false,
}: {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  onClick?: () => void;
  compact?: boolean;
}) {
  const cardContent = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div
          className={cn(
            "mt-1 font-semibold text-foreground",
            compact ? "text-sm" : "text-base",
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="rounded-lg bg-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "rounded-xl border border-border bg-background/80 text-left transition-colors hover:bg-muted/60",
          compact ? "p-2.5" : "p-3",
        )}
        onClick={onClick}
        aria-label={`跳转到${title}`}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background/80",
        compact ? "p-2.5" : "p-3",
      )}
    >
      {cardContent}
    </div>
  );
}

function Section({
  sectionKey,
  title,
  badge,
  children,
  registerRef,
}: {
  sectionKey?: HarnessSectionKey;
  title: string;
  badge?: string;
  children: ReactNode;
  registerRef?: (key: HarnessSectionKey, node: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={(node) =>
        sectionKey && registerRef ? registerRef(sectionKey, node) : undefined
      }
      data-harness-section={sectionKey}
      className="rounded-xl border border-border bg-background/80 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      {children}
    </section>
  );
}

export function HarnessStatusPanel({
  harnessState,
  subAgentRuntime,
  environment,
  layout = "default",
  onLoadFilePreview,
  onOpenFile,
  onRevealPath,
  onOpenPath,
  title = "Harness 运行面板",
  description = "展示最近文件活动、工具输出、审批与上下文装载情况。",
  toggleLabel = "详情",
  leadContent,
}: HarnessStatusPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const isDialogLayout = layout === "dialog";
  const isDetailsExpanded = isDialogLayout ? true : expanded;
  const [fileFilter, setFileFilter] = useState<FileFilterValue>("all");
  const [outputFilter, setOutputFilter] = useState<OutputFilterValue>("all");
  const [fileDisplayMode, setFileDisplayMode] =
    useState<FileDisplayMode>("timeline");
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState>({
    open: false,
    title: "",
    displayName: "",
    isBinary: false,
    loading: false,
  });
  const previewRequestIdRef = useRef(0);
  const sectionRefs = useRef<Partial<Record<HarnessSectionKey, HTMLElement | null>>>(
    {},
  );

  const registerSectionRef = useCallback(
    (key: HarnessSectionKey, node: HTMLElement | null) => {
      sectionRefs.current[key] = node;
    },
    [],
  );

  const scrollToSection = useCallback(
    (key: HarnessSectionKey) => {
      const target = sectionRefs.current[key];
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [],
  );

  const recentSchedulerEvents = useMemo(
    () => subAgentRuntime.events.slice(-4).reverse(),
    [subAgentRuntime.events],
  );

  const fileFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: "全部" },
        { value: "document" as const, label: "文档" },
        { value: "code" as const, label: "代码" },
        { value: "log" as const, label: "日志" },
        { value: "artifact" as const, label: "产物" },
        { value: "offload" as const, label: "转存" },
        { value: "other" as const, label: "其他" },
      ].filter(
        (option) =>
          option.value === "all" ||
          harnessState.recentFileEvents.some((event) => event.kind === option.value),
      ),
    [harnessState.recentFileEvents],
  );

  const outputFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: "全部" },
        { value: "path" as const, label: "有路径" },
        { value: "offload" as const, label: "转存" },
        { value: "truncated" as const, label: "截断" },
        { value: "summary" as const, label: "仅摘要" },
      ].filter(
        (option) =>
          option.value === "all" ||
          harnessState.outputSignals.some((signal) =>
            matchesOutputFilter(signal, option.value),
          ),
      ),
    [harnessState.outputSignals],
  );

  const filteredFileEvents = useMemo(
    () =>
      harnessState.recentFileEvents.filter(
        (event) => fileFilter === "all" || event.kind === fileFilter,
      ),
    [fileFilter, harnessState.recentFileEvents],
  );

  const filteredOutputSignals = useMemo(
    () =>
      harnessState.outputSignals.filter((signal) =>
        matchesOutputFilter(signal, outputFilter),
      ),
    [harnessState.outputSignals, outputFilter],
  );

  const groupedOutputEntries = useMemo(() => {
    const entries: Array<
      | { type: "single"; signal: HarnessOutputSignal }
      | { type: "search_batch"; signals: HarnessOutputSignal[] }
    > = [];

    for (const signal of filteredOutputSignals) {
      const isSearch = isSearchOutputSignal(signal);
      const lastEntry = entries[entries.length - 1];

      if (
        isSearch &&
        lastEntry &&
        lastEntry.type === "search_batch"
      ) {
        lastEntry.signals.push(signal);
        continue;
      }

      if (isSearch) {
        entries.push({ type: "search_batch", signals: [signal] });
        continue;
      }

      entries.push({ type: "single", signal });
    }

    return entries;
  }, [filteredOutputSignals]);

  const groupedFileEvents = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        path: string;
        displayName: string;
        kind: HarnessFileKind;
        latestEvent: HarnessSessionState["recentFileEvents"][number];
        count: number;
        events: HarnessSessionState["recentFileEvents"];
      }
    >();

    for (const event of filteredFileEvents) {
      const key = event.path.trim() || event.id;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          key,
          path: event.path,
          displayName: event.displayName,
          kind: event.kind,
          latestEvent: event,
          count: 1,
          events: [event],
        });
        continue;
      }

      existing.events.push(event);
      existing.count += 1;

      const currentTime = existing.latestEvent.timestamp?.getTime() ?? 0;
      const nextTime = event.timestamp?.getTime() ?? 0;
      if (nextTime >= currentTime) {
        existing.latestEvent = event;
        existing.displayName = event.displayName;
        existing.kind = event.kind;
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        actionSummary: summarizeFileActions(group.events),
      }))
      .sort((left, right) => {
        const leftTime = left.latestEvent.timestamp?.getTime() ?? 0;
        const rightTime = right.latestEvent.timestamp?.getTime() ?? 0;
        return rightTime - leftTime;
      });
  }, [filteredFileEvents]);

  const availableSections = useMemo(
    () => {
      const sections: HarnessSectionNavItem[] = [];

      if (harnessState.runtimeStatus) {
        sections.push({ key: "runtime", label: "当前阶段" });
      }
      if (harnessState.activeFileWrites.length > 0) {
        sections.push({ key: "writes", label: "文件写入" });
      }
      if (harnessState.outputSignals.length > 0) {
        sections.push({ key: "outputs", label: "工具输出" });
      }
      if (harnessState.pendingApprovals.length > 0) {
        sections.push({ key: "approvals", label: "待审批" });
      }
      if (harnessState.recentFileEvents.length > 0) {
        sections.push({ key: "files", label: "文件活动" });
      }
      if (
        harnessState.plan.phase !== "idle" ||
        harnessState.plan.items.length > 0
      ) {
        sections.push({ key: "plan", label: "规划状态" });
      }
      if (
        subAgentRuntime.isRunning ||
        harnessState.delegatedTasks.length > 0 ||
        recentSchedulerEvents.length > 0 ||
        subAgentRuntime.error ||
        subAgentRuntime.result
      ) {
        sections.push({ key: "delegation", label: "子任务委派" });
      }
      if (harnessState.latestContextTrace.length > 0) {
        sections.push({ key: "context", label: "上下文轨迹" });
      }

      sections.push({ key: "capabilities", label: "已装载能力" });

      return sections;
    },
    [
      harnessState.delegatedTasks.length,
      harnessState.activeFileWrites.length,
      harnessState.latestContextTrace.length,
      harnessState.outputSignals.length,
      harnessState.pendingApprovals.length,
      harnessState.plan.items.length,
      harnessState.plan.phase,
      harnessState.recentFileEvents.length,
      harnessState.runtimeStatus,
      recentSchedulerEvents.length,
      subAgentRuntime.error,
      subAgentRuntime.isRunning,
      subAgentRuntime.result,
    ],
  );

  const summaryCards = useMemo(
    () => {
      const cards: HarnessSummaryCard[] = [];

      if (harnessState.runtimeStatus) {
        cards.push({
          sectionKey: "runtime",
          title: "执行阶段",
          value: formatRuntimePhaseLabel(harnessState.runtimeStatus),
          hint:
            harnessState.runtimeStatus.detail ||
            harnessState.runtimeStatus.title,
          icon: Loader2,
        });
      }

      if (harnessState.activeFileWrites.length > 0) {
        cards.push({
          sectionKey: "writes",
          title: "文件写入",
          value: `${harnessState.activeFileWrites.length}`,
          hint:
            harnessState.activeFileWrites[0]?.displayName ||
            "暂无正在处理的文件",
          icon: FileText,
        });
      }

      cards.push(
        {
          sectionKey: "approvals",
          title: "待审批",
          value: `${harnessState.pendingApprovals.length}`,
          hint:
            harnessState.pendingApprovals.length > 0
              ? "需要你确认的操作"
              : "当前无阻塞审批",
          icon: ShieldAlert,
        },
        {
          sectionKey: "files",
          title: "文件活动",
          value: `${harnessState.recentFileEvents.length}`,
          hint:
            harnessState.recentFileEvents[0]?.displayName ||
            "暂无可展示文件活动",
          icon: FolderOpen,
        },
        {
          sectionKey: "plan",
          title: "计划状态",
          value:
            harnessState.plan.phase === "planning"
              ? "进行中"
              : harnessState.plan.phase === "ready"
                ? "已就绪"
                : "空闲",
          hint:
            harnessState.plan.items[0]?.content || "未检测到显式计划快照",
          icon: ListChecks,
        },
        {
          sectionKey: "context",
          title: "上下文",
          value: `${environment.activeContextCount}/${environment.contextItemsCount}`,
          hint:
            environment.contextEnabled ? "上下文工作台已启用" : "普通聊天模式",
          icon: Sparkles,
        },
      );

      return cards;
    },
    [
      environment.activeContextCount,
      environment.contextEnabled,
      environment.contextItemsCount,
      harnessState.activeFileWrites,
      harnessState.pendingApprovals.length,
      harnessState.plan.items,
      harnessState.plan.phase,
      harnessState.recentFileEvents,
      harnessState.runtimeStatus,
    ],
  );

  const openPreview = useCallback(
    async ({
      title,
      description,
      path,
      content,
      preview,
    }: {
      title: string;
      description?: string;
      path?: string;
      content?: string;
      preview?: string;
    }) => {
      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;

      const shouldLoad =
        !content?.trim() && !!path && typeof onLoadFilePreview === "function";

      setPreviewDialog({
        open: true,
        title,
        description,
        path,
        displayName: path ? getFileName(path) : title,
        content: content?.trim() || preview?.trim(),
        preview,
        error:
          content?.trim() || preview?.trim()
            ? undefined
            : shouldLoad
              ? undefined
              : "暂无可预览内容",
        isBinary: false,
        loading: shouldLoad,
      });

      if (!shouldLoad || !path) {
        return;
      }

      try {
        const result = await onLoadFilePreview(path);
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        const nextPath = result.path || path;
        const normalizedContent = result.content ?? undefined;

        setPreviewDialog((current) => ({
          ...current,
          path: nextPath,
          displayName: getFileName(nextPath),
          content: normalizedContent?.trim() ? normalizedContent : current.content,
          isBinary: result.isBinary === true,
          size: result.size,
          error:
            result.isBinary === true
              ? undefined
              : result.error || (normalizedContent ? undefined : current.error),
          loading: false,
        }));
      } catch (error) {
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setPreviewDialog((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [onLoadFilePreview],
  );

  const handleOpenFile = useCallback(() => {
    if (!onOpenFile || !previewDialog.content?.trim()) {
      return;
    }

    onOpenFile(
      previewDialog.path || previewDialog.displayName,
      previewDialog.content,
    );
  }, [onOpenFile, previewDialog.content, previewDialog.displayName, previewDialog.path]);

  const handleCopyPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可复制的文件路径");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      toast.success("文件路径已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制路径失败");
    }
  }, [previewDialog.path]);

  const handleCopyContent = useCallback(async () => {
    const content = previewDialog.content?.trim();
    if (!content) {
      toast.error("当前没有可复制的内容");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(previewDialog.content || "");
      toast.success("内容已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制内容失败");
    }
  }, [previewDialog.content]);

  const handleOpenPathValue = useCallback(
    async (path: string) => {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        toast.error("当前没有可打开的文件路径");
        return;
      }

      try {
        await (onOpenPath ?? openPathWithDefaultApp)(normalizedPath);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "打开文件失败");
      }
    },
    [onOpenPath],
  );

  const handleOpenExternalLink = useCallback(async (url: string) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      toast.error("当前没有可打开的链接");
      return;
    }

    try {
      await openExternalUrl(normalizedUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开链接失败");
    }
  }, []);

  const handleRevealPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可定位的文件路径");
      return;
    }

    try {
      await (onRevealPath ?? revealPathInFinder)(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "定位文件失败");
    }
  }, [onRevealPath, previewDialog.path]);

  const handleOpenPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可打开的文件路径");
      return;
    }

    await handleOpenPathValue(path);
  }, [handleOpenPathValue, previewDialog.path]);

  return (
    <>
      <div
        data-testid="harness-status-panel"
        data-layout={layout}
        className={cn(
          "bg-muted/30",
          layout === "sidebar"
            ? "rounded-xl border border-border"
            : layout === "dialog"
              ? "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background"
              : "mx-3 mt-2 rounded-2xl border border-border",
        )}
      >
        <div
          data-harness-drag-handle={isDialogLayout ? "true" : undefined}
          className={cn(
            "flex items-center justify-between gap-3 border-b border-border px-4 py-3",
            isDialogLayout &&
              "shrink-0 cursor-grab select-none px-5 py-4 active:cursor-grabbing",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                {title}
              </h2>
              {subAgentRuntime.isRunning ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  子任务运行中
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {description}
            </p>
          </div>
          {!isDialogLayout ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={isDetailsExpanded}
              aria-label={
                isDetailsExpanded
                  ? `折叠${toggleLabel}`
                  : `展开${toggleLabel}`
              }
            >
              {isDetailsExpanded ? (
                <ChevronDown className="mr-1 h-4 w-4" />
              ) : (
                <ChevronRight className="mr-1 h-4 w-4" />
              )}
              {isDetailsExpanded ? `收起${toggleLabel}` : `展开${toggleLabel}`}
            </Button>
          ) : null}
        </div>

        {leadContent ? (
          <div
            className={cn(
              "border-b border-border px-4 py-4",
              isDialogLayout && "shrink-0 px-5 py-4",
            )}
          >
            {leadContent}
          </div>
        ) : null}

        <div
          className={cn(
            "grid gap-2 px-4 py-4",
            isDialogLayout && "shrink-0 px-5 py-3",
            layout === "sidebar"
              ? "grid-cols-1"
              : isDialogLayout
                ? "sm:grid-cols-2 xl:grid-cols-5"
                : "md:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {summaryCards.map((card) => (
            <SummaryCard
              key={card.title}
              title={card.title}
              value={card.value}
              hint={card.hint}
              icon={card.icon}
              onClick={() => scrollToSection(card.sectionKey)}
              compact={isDialogLayout}
            />
          ))}
        </div>

        {isDetailsExpanded ? (
          <ScrollArea
            className={cn(
              "border-t border-border px-4 py-4",
              layout === "sidebar"
                ? "max-h-[24rem]"
                : layout === "dialog"
                  ? "flex-1 min-h-0 overscroll-contain px-5"
                  : "max-h-[28rem]",
            )}
          >
            <div className="space-y-4 pb-1">
              {availableSections.length > 0 ? (
                <div
                  className={cn(
                    "flex flex-wrap gap-2",
                    isDialogLayout &&
                      "sticky top-0 z-10 -mx-1 -mt-1 bg-background/95 px-1 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80",
                  )}
                >
                  {availableSections.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      onClick={() => scrollToSection(item.key)}
                      aria-label={`跳转到${item.label}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {harnessState.runtimeStatus ? (
                <Section
                  sectionKey="runtime"
                  title="当前执行阶段"
                  badge={formatRuntimePhaseLabel(harnessState.runtimeStatus)}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>{harnessState.runtimeStatus.title}</span>
                      </div>
                      <InteractiveText
                        text={harnessState.runtimeStatus.detail}
                        className="mt-2 text-sm text-muted-foreground"
                        onOpenUrl={handleOpenExternalLink}
                      />
                    </div>

                    {harnessState.runtimeStatus.checkpoints &&
                    harnessState.runtimeStatus.checkpoints.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {harnessState.runtimeStatus.checkpoints.map(
                          (checkpoint, index) => (
                            <ActionableBadge
                              key={`${checkpoint}-${index}`}
                              variant="outline"
                              value={checkpoint}
                              onOpenUrl={handleOpenExternalLink}
                              onOpenPath={handleOpenPathValue}
                            />
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {harnessState.activeFileWrites.length > 0 ? (
                <Section
                  sectionKey="writes"
                  title="当前文件写入"
                  badge={`${harnessState.activeFileWrites.length} 条`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {harnessState.activeFileWrites.map((write) => (
                      <button
                        key={write.id}
                        type="button"
                        className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                        onClick={() =>
                          void openPreview({
                            title: write.displayName,
                            description: getActiveWriteDescription(write),
                            path: write.path,
                            content: write.content,
                            preview: write.preview || write.latestChunk,
                          })
                        }
                        aria-label={`查看文件写入：${write.displayName}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate text-sm font-medium text-foreground">
                                {write.displayName}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {getActiveWriteDescription(write)}
                            </div>
                            <PathTextLink
                              path={write.path}
                              className="mt-1 text-xs"
                              stopPropagation={true}
                              onOpenPath={handleOpenPathValue}
                            />
                          </div>
                          <Badge variant="outline">
                            {formatArtifactWritePhaseLabel(write.phase)}
                          </Badge>
                        </div>
                        {write.preview || write.latestChunk ? (
                          <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                            <InteractiveText
                              text={write.preview || write.latestChunk}
                              mono={true}
                              stopPropagation={true}
                              onOpenUrl={handleOpenExternalLink}
                            />
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            正在准备文件内容...
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </Section>
              ) : null}

              {harnessState.outputSignals.length > 0 ? (
                <Section
                  sectionKey="outputs"
                  title="工具输出"
                  badge={
                    filteredOutputSignals.length === harnessState.outputSignals.length
                      ? `${harnessState.outputSignals.length} 条`
                      : `${filteredOutputSignals.length} / ${harnessState.outputSignals.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {outputFilterOptions.map((option) => {
                        const count =
                          option.value === "all"
                            ? harnessState.outputSignals.length
                            : harnessState.outputSignals.filter((signal) =>
                                matchesOutputFilter(signal, option.value),
                              ).length;
                        const active = option.value === outputFilter;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              active
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                            onClick={() => setOutputFilter(option.value)}
                            aria-pressed={active}
                            aria-label={`工具输出筛选：${option.label}`}
                          >
                            {option.label} {count}
                          </button>
                        );
                      })}
                    </div>
                    {filteredOutputSignals.length > 0 ? (
                      groupedOutputEntries.map((entry) => {
                        if (entry.type === "search_batch") {
                          if (entry.signals.length === 1) {
                            const signal = entry.signals[0];
                            return (
                              <SearchOutputCard
                                key={signal.id}
                                signal={signal}
                                onOpenUrl={handleOpenExternalLink}
                                onOpenDetail={() =>
                                  void openPreview({
                                    title: signal.title,
                                    description: signal.summary,
                                    path: getSignalPath(signal),
                                    content: signal.content,
                                    preview: signal.preview,
                                  })
                                }
                              />
                            );
                          }

                          return (
                            <SearchOutputBatchCard
                              key={entry.signals.map((signal) => signal.id).join("|")}
                              signals={entry.signals}
                              onOpenUrl={handleOpenExternalLink}
                              onOpenDetail={(signal) =>
                                void openPreview({
                                  title: signal.title,
                                  description: signal.summary,
                                  path: getSignalPath(signal),
                                  content: signal.content,
                                  preview: signal.preview,
                                })
                              }
                            />
                          );
                        }

                        const signal = entry.signal;
                        const signalPath = getSignalPath(signal);
                        const signalUrl = findFirstUrl(
                          signal.summary,
                          signal.content,
                          signal.preview,
                          signal.title,
                        );
                        const canOpenPreview = Boolean(
                          signalPath || signal.content || signal.preview,
                        );
                        const canOpenUrl = !canOpenPreview && Boolean(signalUrl);

                        return (
                          <button
                            key={signal.id}
                            type="button"
                            className={cn(
                              "w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60",
                              !canOpenPreview && !canOpenUrl && "cursor-default",
                            )}
                            onClick={() =>
                              canOpenPreview
                                ? void openPreview({
                                    title: signal.title,
                                    description: signal.summary,
                                    path: signalPath,
                                    content: signal.content,
                                    preview: signal.preview,
                                  })
                                : signalUrl
                                  ? void handleOpenExternalLink(signalUrl)
                                : undefined
                            }
                            aria-label={`查看工具输出：${signal.title}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {signal.title}
                                  </span>
                                </div>
                                <InteractiveText
                                  text={signal.summary}
                                  className="mt-1 text-xs text-muted-foreground"
                                  stopPropagation={true}
                                  onOpenUrl={handleOpenExternalLink}
                                />
                                <PathTextLink
                                  path={signalPath}
                                  className="mt-1 text-xs"
                                  stopPropagation={true}
                                  onOpenPath={handleOpenPathValue}
                                />
                              </div>
                              <Badge variant="outline">{signal.toolName}</Badge>
                            </div>
                            {signal.preview ? (
                              <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                <InteractiveText
                                  text={signal.preview}
                                  mono={true}
                                  stopPropagation={true}
                                  onOpenUrl={handleOpenExternalLink}
                                />
                              </div>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前筛选条件下暂无记录。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {harnessState.pendingApprovals.length > 0 ? (
                <Section
                  sectionKey="approvals"
                  title="待处理审批"
                  badge={`${harnessState.pendingApprovals.length} 条`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {harnessState.pendingApprovals.map((item) => (
                      <div
                        key={item.requestId}
                        className="rounded-xl border border-amber-200 bg-amber-50/80 p-3"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                          <ShieldAlert className="h-4 w-4" />
                          <InteractiveText
                            text={item.prompt || "等待用户确认"}
                            className="text-sm"
                            onOpenUrl={handleOpenExternalLink}
                          />
                        </div>
                        {describeApproval(item) ? (
                          <InteractiveText
                            text={describeApproval(item)}
                            className="mt-2 text-xs text-amber-800"
                            onOpenUrl={handleOpenExternalLink}
                          />
                        ) : null}
                        <div className="mt-2 text-xs text-amber-700">
                          请求 ID：{item.requestId}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {harnessState.recentFileEvents.length > 0 ? (
                <Section
                  sectionKey="files"
                  title="最近文件活动"
                  badge={
                    fileDisplayMode === "grouped"
                      ? `${groupedFileEvents.length} 个文件 / ${filteredFileEvents.length} 条`
                      : filteredFileEvents.length === harnessState.recentFileEvents.length
                        ? `${harnessState.recentFileEvents.length} 条`
                        : `${filteredFileEvents.length} / ${harnessState.recentFileEvents.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        {fileFilterOptions.map((option) => {
                          const count =
                            option.value === "all"
                              ? harnessState.recentFileEvents.length
                              : harnessState.recentFileEvents.filter(
                                  (event) => event.kind === option.value,
                                ).length;
                          const active = option.value === fileFilter;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                              onClick={() => setFileFilter(option.value)}
                              aria-pressed={active}
                              aria-label={`文件活动筛选：${option.label}`}
                            >
                              {option.label} {count}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "timeline" as const, label: "时间流" },
                          { value: "grouped" as const, label: "按文件" },
                        ].map((option) => {
                          const active = option.value === fileDisplayMode;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                              onClick={() => setFileDisplayMode(option.value)}
                              aria-pressed={active}
                              aria-label={`文件视图：${option.label}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {filteredFileEvents.length > 0 ? (
                      fileDisplayMode === "grouped" ? (
                        groupedFileEvents.map((group) => {
                          const latestEvent = group.latestEvent;
                          const Icon = resolveKindIcon(group.kind);
                          return (
                            <button
                              key={group.key}
                              type="button"
                              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                              onClick={() =>
                                void openPreview({
                                  title: latestEvent.displayName,
                                  description: `${describeAction(latestEvent.action)} · ${describeKind(group.kind)} · ${latestEvent.sourceToolName}`,
                                  path: latestEvent.path,
                                  content: latestEvent.content,
                                  preview: latestEvent.preview,
                                })
                              }
                              aria-label={`查看聚合文件活动：${group.displayName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {group.displayName}
                                    </span>
                                  </div>
                                  <PathTextLink
                                    path={group.path}
                                    className="mt-1 text-xs"
                                    stopPropagation={true}
                                    onOpenPath={handleOpenPathValue}
                                  />
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge variant="outline">{group.count} 次活动</Badge>
                                  <Badge variant="secondary">
                                    {describeKind(group.kind)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatTime(latestEvent.timestamp)}</span>
                                <span>·</span>
                                <span>最近 {describeAction(latestEvent.action)}</span>
                                <span>·</span>
                                <span>{group.actionSummary}</span>
                              </div>
                              {latestEvent.preview ? (
                                <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                  <InteractiveText
                                    text={latestEvent.preview}
                                    mono={true}
                                    stopPropagation={true}
                                    onOpenUrl={handleOpenExternalLink}
                                  />
                                </div>
                              ) : null}
                            </button>
                          );
                        })
                      ) : (
                        filteredFileEvents.map((event) => {
                          const Icon = resolveKindIcon(event.kind);
                          return (
                            <button
                              key={event.id}
                              type="button"
                              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                              onClick={() =>
                                void openPreview({
                                  title: event.displayName,
                                  description: `${describeAction(event.action)} · ${describeKind(event.kind)} · ${event.sourceToolName}`,
                                  path: event.path,
                                  content: event.content,
                                  preview: event.preview,
                                })
                              }
                              aria-label={`查看文件活动：${event.displayName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {event.displayName}
                                    </span>
                                  </div>
                                  <PathTextLink
                                    path={event.path}
                                    className="mt-1 text-xs"
                                    stopPropagation={true}
                                    onOpenPath={handleOpenPathValue}
                                  />
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge variant="outline">
                                    {describeAction(event.action)}
                                  </Badge>
                                  <Badge variant="secondary">
                                    {describeKind(event.kind)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatTime(event.timestamp)}</span>
                                <span>·</span>
                                <span>{event.sourceToolName}</span>
                              </div>
                              {event.preview ? (
                                <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                  <InteractiveText
                                    text={event.preview}
                                    mono={true}
                                    stopPropagation={true}
                                    onOpenUrl={handleOpenExternalLink}
                                  />
                                </div>
                              ) : null}
                            </button>
                          );
                        })
                      )
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前筛选条件下暂无记录。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {harnessState.plan.phase !== "idle" ||
              harnessState.plan.items.length > 0 ? (
                <Section
                  sectionKey="plan"
                  title="规划状态"
                  badge={
                    harnessState.plan.phase === "planning"
                      ? "规划中"
                      : harnessState.plan.phase === "ready"
                        ? "已就绪"
                        : "空闲"
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-2">
                    {harnessState.plan.items.length > 0 ? (
                      harnessState.plan.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                        >
                          <InteractiveText
                            text={item.content}
                            className="min-w-0 text-sm text-foreground"
                            onOpenUrl={handleOpenExternalLink}
                          />
                          <Badge
                            variant={
                              item.status === "completed"
                                ? "secondary"
                                : item.status === "in_progress"
                                  ? "default"
                                  : "outline"
                            }
                          >
                            {item.status === "completed"
                              ? "已完成"
                              : item.status === "in_progress"
                                ? "进行中"
                                : "待开始"}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        已进入规划流程，但暂无可展示的 Todo 快照。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {subAgentRuntime.isRunning ||
              harnessState.delegatedTasks.length > 0 ||
              recentSchedulerEvents.length > 0 ||
              subAgentRuntime.error ||
              subAgentRuntime.result ? (
                <Section
                  sectionKey="delegation"
                  title="子任务委派"
                  badge={
                    subAgentRuntime.isRunning
                      ? "运行中"
                      : `${harnessState.delegatedTasks.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {subAgentRuntime.progress ? (
                      <div className="rounded-xl border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-foreground">
                            调度进度
                          </div>
                          <Badge variant="secondary">
                            {subAgentRuntime.progress.completed}/
                            {subAgentRuntime.progress.total}
                          </Badge>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(100, subAgentRuntime.progress.percentage),
                              )}%`,
                            }}
                          />
                        </div>
                        {subAgentRuntime.progress.currentTasks.length > 0 ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            当前任务：
                            <InteractiveText
                              text={subAgentRuntime.progress.currentTasks.join("、")}
                              onOpenUrl={handleOpenExternalLink}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {harnessState.delegatedTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-xl border border-border bg-background p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate text-sm font-medium text-foreground">
                                {task.title}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {task.role ? <span>角色：{task.role}</span> : null}
                              {task.taskType ? (
                                <span>类型：{task.taskType}</span>
                              ) : null}
                              {task.model ? <span>模型：{task.model}</span> : null}
                            </div>
                            {task.summary ? (
                              <InteractiveText
                                text={task.summary}
                                className="mt-2 text-xs text-muted-foreground"
                                onOpenUrl={handleOpenExternalLink}
                              />
                            ) : null}
                          </div>
                          <Badge
                            variant={
                              task.status === "completed"
                                ? "secondary"
                                : task.status === "running"
                                  ? "default"
                                  : "destructive"
                            }
                          >
                            {task.status === "completed"
                              ? "已完成"
                              : task.status === "running"
                                ? "运行中"
                                : "失败"}
                          </Badge>
                        </div>
                      </div>
                    ))}

                    {recentSchedulerEvents.length > 0 ? (
                      <div className="rounded-xl border border-border bg-background p-3">
                        <div className="mb-2 text-sm font-medium text-foreground">
                          最近调度事件
                        </div>
                        <div className="space-y-2">
                          {recentSchedulerEvents.map((event, index) => (
                            <div
                              key={`${event.type}-${index}`}
                              className="text-xs text-muted-foreground"
                            >
                              <InteractiveText
                                text={summarizeSchedulerEvent(event)}
                                onOpenUrl={handleOpenExternalLink}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {subAgentRuntime.error ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        <InteractiveText
                          text={subAgentRuntime.error}
                          onOpenUrl={handleOpenExternalLink}
                        />
                      </div>
                    ) : null}

                    {subAgentRuntime.result?.mergedSummary ? (
                      <div className="rounded-xl border border-border bg-background p-3 text-sm text-muted-foreground">
                        <InteractiveText
                          text={subAgentRuntime.result.mergedSummary}
                          onOpenUrl={handleOpenExternalLink}
                        />
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {harnessState.latestContextTrace.length > 0 ? (
                <Section
                  sectionKey="context"
                  title="最新上下文轨迹"
                  badge={`${harnessState.latestContextTrace.length} 步`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-2">
                    {harnessState.latestContextTrace.map((step, index) => (
                      <div
                        key={`${step.stage}-${index}`}
                        className="rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Workflow className="h-4 w-4 text-muted-foreground" />
                          <span>{step.stage}</span>
                        </div>
                        <InteractiveText
                          text={step.detail}
                          className="mt-1 text-xs text-muted-foreground"
                          onOpenUrl={handleOpenExternalLink}
                        />
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              <Section
                sectionKey="capabilities"
                title="已装载能力"
                badge={`${environment.skillsCount} 个技能`}
                registerRef={registerSectionRef}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {environment.skillNames.length > 0 ? (
                      environment.skillNames.map((name) => (
                        <ActionableBadge
                          key={name}
                          variant="secondary"
                          value={name}
                          onOpenUrl={handleOpenExternalLink}
                          onOpenPath={handleOpenPathValue}
                        />
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        当前未检测到已装载技能名称
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {environment.memorySignals.length > 0 ? (
                      environment.memorySignals.map((signal) => (
                        <ActionableBadge
                          key={signal}
                          variant="outline"
                          value={signal}
                          onOpenUrl={handleOpenExternalLink}
                          onOpenPath={handleOpenPathValue}
                        />
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        当前未识别到持久记忆信号
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      上下文条目：{environment.activeContextCount}/
                      {environment.contextItemsCount}
                    </div>
                    {environment.contextItemNames.length > 0 ? (
                      <div className="space-y-1">
                        <div>活跃上下文：</div>
                        <div className="flex flex-wrap gap-2">
                          {environment.contextItemNames.map((item) => (
                            <ActionableBadge
                              key={item}
                              variant="outline"
                              value={item}
                              onOpenUrl={handleOpenExternalLink}
                              onOpenPath={handleOpenPathValue}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      规划 {harnessState.activity.planning}
                    </Badge>
                    <Badge variant="outline">
                      文件 {harnessState.activity.filesystem}
                    </Badge>
                    <Badge variant="outline">
                      执行 {harnessState.activity.execution}
                    </Badge>
                    <Badge variant="outline">网页 {harnessState.activity.web}</Badge>
                    <Badge variant="outline">
                      技能 {harnessState.activity.skills}
                    </Badge>
                    <Badge variant="outline">
                      委派 {harnessState.activity.delegation}
                    </Badge>
                  </div>
                </div>
              </Section>
            </div>
          </ScrollArea>
        ) : null}
      </div>

      <Dialog
        open={previewDialog.open}
        onOpenChange={(open) =>
          setPreviewDialog((current) => ({
            ...current,
            open,
            loading: open ? current.loading : false,
          }))
        }
      >
        <DialogContent maxWidth="max-w-4xl" className="p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="pr-8">{previewDialog.title}</DialogTitle>
            <DialogDescription className="space-y-1">
              {previewDialog.description ? (
                <InteractiveText
                  text={previewDialog.description}
                  className="block"
                  onOpenUrl={handleOpenExternalLink}
                />
              ) : null}
              {previewDialog.path ? (
                <PathTextLink
                  path={previewDialog.path}
                  className="block text-xs"
                  onOpenPath={handleOpenPathValue}
                />
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{previewDialog.displayName}</Badge>
              {formatSize(previewDialog.size) ? (
                <Badge variant="outline">{formatSize(previewDialog.size)}</Badge>
              ) : null}
              {previewDialog.loading ? (
                <Badge variant="outline" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在加载完整内容
                </Badge>
              ) : null}
              {previewDialog.preview &&
              previewDialog.content === previewDialog.preview &&
              !previewDialog.loading ? (
                <Badge variant="outline">当前展示为摘要预览</Badge>
              ) : null}
            </div>

            <ScrollArea className="max-h-[60vh] rounded-xl border border-border bg-muted/30">
              {previewDialog.isBinary ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <HardDriveDownload className="h-4 w-4" />
                  该文件为二进制内容，暂不支持文本预览。
                </div>
              ) : previewDialog.error ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {previewDialog.error}
                </div>
              ) : previewDialog.content ? (
                <div className="px-4 py-4 text-xs leading-6 text-foreground">
                  <InteractiveText
                    text={previewDialog.content}
                    mono={true}
                    onOpenUrl={handleOpenExternalLink}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  暂无可展示内容
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            {previewDialog.path ? (
              <Button type="button" variant="outline" onClick={() => void handleCopyPath()}>
                复制路径
              </Button>
            ) : null}
            {previewDialog.content?.trim() ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCopyContent()}
              >
                复制内容
              </Button>
            ) : null}
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRevealPath()}
              >
                定位文件
              </Button>
            ) : null}
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleOpenPath()}
              >
                系统打开
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPreviewDialog((current) => ({ ...current, open: false }))
              }
            >
              关闭
            </Button>
            {onOpenFile &&
            !previewDialog.isBinary &&
            previewDialog.content?.trim() ? (
              <Button type="button" onClick={handleOpenFile}>
                在会话中打开
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default HarnessStatusPanel;
