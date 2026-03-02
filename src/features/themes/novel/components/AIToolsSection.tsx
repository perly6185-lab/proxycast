import { Button } from "@/components/ui/button";
import { Sparkles, ThumbsUp, Users } from "lucide-react";
import type { NovelAiToolConfig } from "@/features/themes/novel/types";

interface AIToolsSectionProps {
  tools: NovelAiToolConfig[];
  loadingToolId?: string | null;
  onUseTool: (tool: NovelAiToolConfig) => void;
}

export function AIToolsSection({
  tools,
  loadingToolId = null,
  onUseTool,
}: AIToolsSectionProps) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-emerald-500" />
          AI工具（小说写作）
        </h2>
      </div>

      <div className="grid gap-3 xl:grid-cols-3 lg:grid-cols-2 grid-cols-1">
        {tools.map((tool) => (
          <article
            key={tool.id}
            className="rounded-lg border bg-background p-4 transition-shadow hover:shadow-sm"
          >
            <h3 className="line-clamp-1 text-sm font-semibold">{tool.title}</h3>
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
              {tool.description}
            </p>

            <div className="mt-2 flex flex-wrap gap-1">
              {tool.tags.map((tag) => (
                <span
                  key={`${tool.id}-${tag}`}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>@ {tool.author}</span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3" />
                  {tool.likes}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {tool.uses}
                </span>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={() => onUseTool(tool)}
                disabled={loadingToolId === tool.id}
              >
                {loadingToolId === tool.id ? "启动中..." : "立即使用"}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

