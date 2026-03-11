import { safeInvoke } from "@/lib/dev-bridge";
import type {
  AutoMemoryIndexResponse,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  MemoryAnalysisResult,
  MemoryAutoToggleResponse,
  MemoryStatsResponse,
  MemoryOverviewResponse,
} from "./memoryRuntimeTypes";

export type {
  AutoMemoryIndexResponse,
  AutoMemoryIndexItem,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  EffectiveMemorySource,
  MemoryAnalysisResult,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemoryCategoryStat,
  MemoryConfig,
  MemoryEntryPreview,
  MemoryOverviewResponse,
  MemoryProfileConfig,
  MemoryResolveConfig,
  MemorySourcesConfig,
  MemoryStatsResponse,
} from "./memoryRuntimeTypes";

export async function getMemoryOverview(
  limit?: number,
): Promise<MemoryOverviewResponse> {
  return safeInvoke("get_conversation_memory_overview", { limit });
}

export async function getMemoryStats(): Promise<MemoryStatsResponse> {
  return safeInvoke("get_conversation_memory_stats");
}

export async function requestMemoryAnalysis(
  fromTimestamp?: number,
  toTimestamp?: number,
): Promise<MemoryAnalysisResult> {
  return safeInvoke("request_conversation_memory_analysis", {
    fromTimestamp,
    toTimestamp,
  });
}

export async function cleanupMemory(): Promise<CleanupMemoryResult> {
  return safeInvoke("cleanup_conversation_memory");
}

export async function getMemoryEffectiveSources(
  workingDir?: string,
  activeRelativePath?: string,
): Promise<EffectiveMemorySourcesResponse> {
  return safeInvoke("memory_get_effective_sources", {
    workingDir,
    activeRelativePath,
  });
}

export async function getMemoryAutoIndex(
  workingDir?: string,
): Promise<AutoMemoryIndexResponse> {
  return safeInvoke("memory_get_auto_index", { workingDir });
}

export async function toggleMemoryAuto(
  enabled: boolean,
): Promise<MemoryAutoToggleResponse> {
  return safeInvoke("memory_toggle_auto", { enabled });
}

export async function updateMemoryAutoNote(
  note: string,
  topic?: string,
  workingDir?: string,
): Promise<AutoMemoryIndexResponse> {
  return safeInvoke("memory_update_auto_note", { note, topic, workingDir });
}
