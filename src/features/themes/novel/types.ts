export type NovelCategory = "long" | "short" | "book-analysis";

export interface NovelCategoryConfig {
  id: NovelCategory;
  label: string;
  description: string;
  subtitle: string;
  icon: string;
  cardClassName: string;
  projectNamePrefix: string;
  defaultContentTitle: string;
}

export interface NovelAiToolConfig {
  id: string;
  title: string;
  description: string;
  tags: string[];
  author: string;
  likes: number;
  uses: number;
  presetPrompt: string;
}

export const NOVEL_CATEGORIES: NovelCategoryConfig[] = [
  {
    id: "long",
    label: "长篇小说",
    subtitle: "多章节连载，情节连贯迭代更新",
    description: "适合世界观搭建、角色成长线、长期更新的连载创作。",
    icon: "📗",
    cardClassName:
      "border-emerald-200 bg-gradient-to-r from-emerald-50/95 to-emerald-100/55 hover:border-emerald-300",
    projectNamePrefix: "长篇小说",
    defaultContentTitle: "第一章",
  },
  {
    id: "short",
    label: "短篇小说",
    subtitle: "两万字以内的短篇故事，情节简单节奏快",
    description: "适合短平快创作，聚焦单一冲突，快速产出完整故事。",
    icon: "📘",
    cardClassName:
      "border-sky-200 bg-gradient-to-r from-sky-50/95 to-sky-100/55 hover:border-sky-300",
    projectNamePrefix: "短篇小说",
    defaultContentTitle: "短篇正文",
  },
  {
    id: "book-analysis",
    label: "小说拆书",
    subtitle: "提取大纲、拆解剧情，助力创作",
    description: "适合做结构分析、角色关系拆解与写作素材提炼。",
    icon: "📙",
    cardClassName:
      "border-rose-200 bg-gradient-to-r from-rose-50/95 to-rose-100/50 hover:border-rose-300",
    projectNamePrefix: "小说拆书",
    defaultContentTitle: "拆书笔记",
  },
];

