import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { NovelCategoryConfig } from "@/features/themes/novel/types";

interface NovelCategoryCardProps {
  category: NovelCategoryConfig;
  loading?: boolean;
  onClick: () => void;
}

export function NovelCategoryCard({
  category,
  loading = false,
  onClick,
}: NovelCategoryCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5 transition-all shadow-sm hover:shadow-md",
        category.cardClassName,
      )}
    >
      <Button
        variant="ghost"
        className="w-full h-auto p-0 justify-start hover:bg-transparent"
        onClick={onClick}
        disabled={loading}
      >
        <div className="flex w-full items-start gap-3 text-left">
          <div className="text-2xl leading-none mt-0.5">{category.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{category.label}</h3>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
              {category.subtitle}
            </p>
          </div>
        </div>
      </Button>
    </div>
  );
}

