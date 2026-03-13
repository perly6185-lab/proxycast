import { SkillsPage } from "@/components/skills/SkillsPage";

export function ExtensionsSettings() {
  return (
    <div className="space-y-5">
      <div className="max-w-3xl">
        <p className="text-sm leading-6 text-muted-foreground">
          管理 Skills 实验功能，不影响核心使用。
          <a
            href="https://github.com/aiclientproxy/proxycast/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-primary hover:underline"
          >
            问题反馈
          </a>
        </p>
      </div>

      <div>
        <SkillsPage hideHeader />
      </div>
    </div>
  );
}
