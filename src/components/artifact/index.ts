/**
 * @file Artifact 组件模块导出入口
 * @description 导出所有公共组件和类型，提供统一的模块访问入口
 * @module components/artifact
 * @requirements 1.1
 */

// ============================================================================
// 核心组件导出
// ============================================================================

/**
 * Artifact 统一渲染入口组件
 * 根据 Artifact 类型分发到对应的渲染器
 */
export { ArtifactRenderer, ArtifactErrorBoundary } from "./ArtifactRenderer";
export type { ArtifactRendererComponentProps } from "./ArtifactRenderer";

/**
 * Artifact 侧边面板组件
 * 可调整大小的侧边面板，集成列表、工具栏和渲染器
 */
export { ArtifactPanel } from "./ArtifactPanel";
export type { ArtifactPanelProps } from "./ArtifactPanel";

/**
 * Artifact 工具栏组件
 * 提供复制、下载、源码切换等快捷操作
 */
export { ArtifactToolbar } from "./ArtifactToolbar";
export type { ArtifactToolbarProps } from "./ArtifactToolbar";

/**
 * Artifact 画布过渡遮罩组件
 * 在文件写入开始但首段内容尚未到达前展示稳定反馈
 */
export { ArtifactCanvasOverlay } from "./ArtifactCanvasOverlay";
export type { ArtifactCanvasOverlayProps } from "./ArtifactCanvasOverlay";

/**
 * Artifact 列表组件
 * 显示当前消息中的所有 artifacts
 */
export { ArtifactList } from "./ArtifactList";
export type { ArtifactListProps } from "./ArtifactList";

/**
 * Canvas 适配器组件
 * 将 Canvas 类型的 Artifact 适配到现有 Canvas 系统
 */
export { CanvasAdapter } from "./CanvasAdapter";
export type { CanvasAdapterProps } from "./CanvasAdapter";

/**
 * Canvas 适配器工具函数
 * 从单独的工具文件导出，避免 react-refresh 警告
 */
export {
  getCanvasTypeFromArtifact,
  isCanvasArtifact,
  createCanvasStateFromArtifact,
  extractContentFromCanvasState,
  extractCanvasMetadata,
  ARTIFACT_TO_CANVAS_TYPE,
  CANVAS_TYPE_LABELS,
  CANVAS_TYPE_ICONS,
} from "./canvasAdapterUtils";
export type { CanvasMetadata } from "./canvasAdapterUtils";

/**
 * 错误回退渲染器
 * 当 Artifact 渲染失败时显示友好的错误信息
 */
export { ErrorFallbackRenderer } from "./ErrorFallbackRenderer";
export type { ErrorFallbackRendererProps } from "./ErrorFallbackRenderer";

// ============================================================================
// 渲染器导出
// ============================================================================

/**
 * 轻量渲染器组件
 * 包括 CodeRenderer, HtmlRenderer, SvgRenderer, MermaidRenderer, ReactRenderer
 */
export {
  CodeRenderer,
  HtmlRenderer,
  SvgRenderer,
  MermaidRenderer,
  ReactRenderer,
  registerLightweightRenderers,
  getLightweightRendererEntries,
  areLightweightRenderersRegistered,
} from "./renderers";

// ============================================================================
// 类型重导出（便于使用）
// ============================================================================

/**
 * 从 lib/artifact 重导出核心类型
 * 方便组件使用者直接从 components/artifact 导入类型
 */
export type {
  Artifact,
  ArtifactType,
  ArtifactStatus,
  ArtifactMeta,
  ArtifactRendererProps,
  RendererEntry,
} from "@/lib/artifact/types";

export {
  LIGHTWEIGHT_ARTIFACT_TYPES,
  CANVAS_ARTIFACT_TYPES,
  ALL_ARTIFACT_TYPES,
  DEFAULT_FILE_EXTENSIONS,
  isCanvasType,
  isLightweightType,
} from "@/lib/artifact/types";
