# general-chat

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

`general-chat` 已不再承担完整对话页面职责。
当前仅保留少量兼容桥接能力，供现役 `agent/chat` 复用画布面板与少数共享类型。

> 治理说明：`general-chat` 当前只剩桥接层与画布层；
> 新代码不应继续在这里新增聊天状态、页面入口、Hook 或 Store。
> 新逻辑优先走统一对话链路（如 `@/hooks/useUnifiedChat`）或现有工作台/路由接入。
> 如必须跨模块复用 `general-chat` 的少量能力，请优先走 `bridge.ts`，不要直接深导入内部目录。

### 技术栈

- React 18 + TypeScript
- TailwindCSS 样式
- react-markdown + remark-gfm (Markdown 渲染)
- react-syntax-highlighter (代码高亮)

## 文件索引

- `bridge.ts` - 对外桥接层，仅暴露少量跨模块允许复用的稳定能力
- `types.ts` - 仍被桥接层与画布层复用的共享类型与默认值
  - `CanvasState`
  - `Message`
  - `DEFAULT_CANVAS_STATE`

### 子目录

- `canvas/` - 右侧画布面板组件
  - `CanvasPanel.tsx` - 画布容器
  - `CodePreview.tsx` - 代码预览
  - `MarkdownPreview.tsx` - Markdown 预览

> 注：旧的页面入口、聊天组件、Hook、Store 与 `src/lib/api/generalChatCompat.ts` 兼容网关已删除；
> 当前 `general-chat` 只保留画布桥接能力。

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
