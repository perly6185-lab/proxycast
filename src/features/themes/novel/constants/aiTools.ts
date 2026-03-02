import type { NovelAiToolConfig } from "@/features/themes/novel/types";

export const NOVEL_AI_TOOLS: NovelAiToolConfig[] = [
  {
    id: "official-continue",
    title: "【官方】续写正文",
    description: "基于大纲、角色和前文延续当前章节，保持叙事一致性。",
    tags: ["续写", "正文", "章节", "一致性"],
    author: "蛙蛙官方提示词",
    likes: 103740,
    uses: 76259,
    presetPrompt:
      "请基于当前小说设定、大纲、角色关系和已有章节内容，继续续写正文。\n要求：\n1. 保持人物语气稳定。\n2. 推进章节冲突与反转。\n3. 保持叙事节奏，不要写成总结。",
  },
  {
    id: "official-polish",
    title: "【官方】AI编辑审稿",
    description: "从逻辑、节奏、语言三个维度给出审稿建议并优化文本。",
    tags: ["编辑", "审稿", "润色", "质量"],
    author: "蛙蛙官方提示词",
    likes: 104195,
    uses: 67302,
    presetPrompt:
      "请担任小说编辑，对当前章节进行审稿与润色。\n请先指出问题，再给出优化版文本。\n重点检查：逻辑连贯、人物行为动机、语言流畅度。",
  },
  {
    id: "hot-rewrite",
    title: "【极速】番茄爆款风-正文改写",
    description: "提升冲突密度和爽点节奏，生成更适合连载传播的文本版本。",
    tags: ["改写", "爆款", "节奏", "冲突"],
    author: "极速流派",
    likes: 3200,
    uses: 34991,
    presetPrompt:
      "请将当前章节改写成高节奏、高冲突、强钩子的连载风格。\n要求：\n1. 开头 3 段快速建立冲突。\n2. 对话更短更有力。\n3. 结尾留悬念。",
  },
  {
    id: "screenplay-outline",
    title: "【孤星】剧情脚本分集提纲",
    description: "根据当前设定生成分集提纲，便于规划长线剧情推进。",
    tags: ["提纲", "分集", "剧情", "规划"],
    author: "孤星",
    likes: 1374,
    uses: 22448,
    presetPrompt:
      "请根据当前小说设定生成 12 节分集提纲。\n每节包含：核心目标、主要冲突、关键反转、结尾钩子。",
  },
  {
    id: "world-build",
    title: "【一键】世界观设定补全",
    description: "自动补全势力、规则、禁忌与关键地点，减少设定漏洞。",
    tags: ["世界观", "设定", "补全", "规则"],
    author: "工具包",
    likes: 1790,
    uses: 43390,
    presetPrompt:
      "请补全当前世界观设定，输出结构化清单：\n1. 力量体系\n2. 势力关系\n3. 关键地点\n4. 禁忌规则\n5. 可触发的主线冲突。",
  },
  {
    id: "longline-arc",
    title: "【zz】续写正文最优工具",
    description: "强调主线推进与人物弧线，适合中后期章节持续连载。",
    tags: ["主线", "人物弧线", "连载", "章节"],
    author: "zz",
    likes: 420,
    uses: 25122,
    presetPrompt:
      "请续写当前章节，重点推进主线与人物弧线。\n要求：\n1. 主角决策要有代价。\n2. 次要角色关系发生可感知变化。\n3. 避免重复前文表达。",
  },
];

