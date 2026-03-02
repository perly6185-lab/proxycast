import { Button } from "@/components/ui/button";
import type { Project } from "@/types/project";

export interface RecentNovelWork {
  project: Project;
  latestContentTitle?: string;
  chapterCount?: number;
  totalWords?: number;
}

interface RecentWorksSectionProps {
  work: RecentNovelWork | null;
  loading?: boolean;
  onStartWriting: (projectId: string) => void;
}

function formatWords(words: number): string {
  return `${words.toLocaleString("zh-CN")}字`;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export function RecentWorksSection({
  work,
  loading = false,
  onStartWriting,
}: RecentWorksSectionProps) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">近期作品</h2>
      </div>

      {!work ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {loading ? "正在加载近期作品..." : "暂无近期小说作品，先创建一个吧"}
        </div>
      ) : (
        <div className="rounded-lg border bg-background px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold">{work.project.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                最近更新：
                {work.latestContentTitle || "未命名章节"}
              </p>
            </div>

            <Button
              size="sm"
              onClick={() => onStartWriting(work.project.id)}
              disabled={loading}
            >
              开始写作
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>总章节：{work.chapterCount ?? 0} 章</span>
            <span>总字数：{formatWords(work.totalWords ?? 0)}</span>
            <span>更新时间：{formatDateTime(work.project.updatedAt)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
