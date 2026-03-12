import type {
  AsterExecutionStrategy,
  AsterSessionInfo,
  AutoContinueRequestPayload,
} from "@/lib/api/agentRuntime";
import type { Message, MessageImage, WriteArtifactContext } from "../types";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";

export interface Topic {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messagesCount: number;
  executionStrategy: AsterExecutionStrategy;
}

export interface UseAsterAgentChatOptions {
  systemPrompt?: string;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  workspaceId: string;
}

export interface SendMessageObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

export interface SendMessageOptions {
  purpose?: Message["purpose"];
  observer?: SendMessageObserver;
  requestMetadata?: Record<string, unknown>;
}

export interface WorkspacePathMissingState {
  content: string;
  images: MessageImage[];
}

export interface AgentPreferences {
  providerType: string;
  model: string;
}

export interface AgentPreferenceKeys {
  providerKey: string;
  modelKey: string;
  migratedKey: string;
}

export interface SessionModelPreference {
  providerType: string;
  model: string;
}

export interface ClearMessagesOptions {
  showToast?: boolean;
  toastMessage?: string;
}

export type SendMessageFn = (
  content: string,
  images: MessageImage[],
  webSearch?: boolean,
  thinking?: boolean,
  skipUserMessage?: boolean,
  executionStrategyOverride?: AsterExecutionStrategy,
  modelOverride?: string,
  autoContinue?: AutoContinueRequestPayload,
  options?: SendMessageOptions,
) => Promise<void>;

export const getScopedStorageKey = (
  workspaceId: string | null | undefined,
  prefix: string,
): string => {
  const resolvedWorkspaceId = workspaceId?.trim();
  return `${prefix}_${resolvedWorkspaceId || "global"}`;
};

export const mapSessionToTopic = (session: AsterSessionInfo): Topic => {
  const updatedAtEpoch = Number.isFinite(session.updated_at)
    ? session.updated_at
    : session.created_at;

  return {
    id: session.id,
    title:
      session.name ||
      `话题 ${new Date(session.created_at * 1000).toLocaleDateString("zh-CN")}`,
    createdAt: new Date(session.created_at * 1000),
    updatedAt: new Date(updatedAtEpoch * 1000),
    messagesCount: session.messages_count ?? 0,
    executionStrategy: normalizeExecutionStrategy(session.execution_strategy),
  };
};
