/**
 * @file 文档画布模块导出
 * @description 导出文档画布相关组件和类型
 * @module components/content-creator/canvas/document
 */

/* eslint-disable react-refresh/only-export-components */

export { DocumentCanvas } from "./DocumentCanvas";
export { ContentReviewPanel } from "./ContentReviewPanel";
export { DocumentToolbar } from "./DocumentToolbar";
export { DocumentRenderer } from "./DocumentRenderer";
export { DocumentEditor } from "./DocumentEditor";
export { PlatformTabs } from "./PlatformTabs";
export { VersionSelector } from "./VersionSelector";

// Hooks
export { useDocumentCanvas } from "./hooks/useDocumentCanvas";
export { useVersions } from "./hooks/useVersions";

// 注册
export {
  registerDocumentCanvas,
  unregisterDocumentCanvas,
  documentCanvasPlugin,
} from "./registerDocumentCanvas";

// Types
export type {
  AutoContinueSettings,
  AutoContinueRunPayload,
  ContentReviewRunPayload,
  ContentReviewExpert,
  CustomContentReviewExpertInput,
  PlatformType,
  ExportFormat,
  DocumentVersion,
  DocumentVersionMetadata,
  DocumentCanvasState,
  DocumentCanvasProps,
  DocumentToolbarProps,
  DocumentRendererProps,
  PlatformTabsProps,
  DocumentEditorProps,
  VersionSelectorProps,
} from "./types";

export { PLATFORM_CONFIGS, createInitialDocumentState } from "./types";
