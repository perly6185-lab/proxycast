/**
 * 小说编排 API
 *
 * 对应 src-tauri/src/commands/novel_cmd.rs
 */

import { safeInvoke } from "@/lib/dev-bridge";
import {
  normalizeNovelSettingsEnvelope,
  type NovelSettingsEnvelope,
  type NovelSettingsV1,
} from "@/lib/novel-settings/types";

export interface NovelProject {
  id: string;
  title: string;
  theme?: string | null;
  target_words: number;
  status: string;
  current_word_count: number;
  metadata_json?: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface NovelSettingsRecord {
  id: string;
  project_id: string;
  settings_json: NovelSettingsEnvelope;
  version: number;
  created_at: number;
}

export interface NovelOutlineRecord {
  id: string;
  project_id: string;
  outline_markdown: string;
  outline_json?: Record<string, unknown> | null;
  version: number;
  created_at: number;
}

export interface NovelCharacterRecord {
  id: string;
  project_id: string;
  name: string;
  role_type: string;
  card_json: Record<string, unknown>;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface NovelChapterRecord {
  id: string;
  project_id: string;
  chapter_no: number;
  title: string;
  content: string;
  word_count: number;
  status: string;
  quality_score?: number | null;
  metadata_json?: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface NovelGenerationRun {
  id: string;
  project_id: string;
  mode: string;
  input_snapshot_json?: Record<string, unknown> | null;
  output_snapshot_json?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  latency_ms?: number | null;
  token_usage_json?: Record<string, unknown> | null;
  result_status: string;
  error_message?: string | null;
  created_at: number;
}

export interface NovelConsistencyIssue {
  level: "info" | "warn" | "error" | string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface NovelConsistencyCheck {
  id: string;
  project_id: string;
  chapter_id: string;
  issues: NovelConsistencyIssue[];
  score: number;
  created_at: number;
}

export interface NovelProjectSnapshot {
  project: NovelProject;
  latest_settings?: NovelSettingsRecord | null;
  latest_outline?: NovelOutlineRecord | null;
  characters: NovelCharacterRecord[];
  chapters: NovelChapterRecord[];
  latest_consistency?: NovelConsistencyCheck | null;
}

export interface NovelGenerateResult {
  mode: string;
  run_id: string;
  content: string;
  chapter?: NovelChapterRecord | null;
}

export interface CreateNovelProjectRequest {
  id?: string;
  title: string;
  theme?: string;
  target_words?: number;
  metadata_json?: Record<string, unknown>;
  settings_json?:
    | NovelSettingsEnvelope
    | NovelSettingsV1
    | Record<string, unknown>;
}

export interface UpdateNovelSettingsRequest {
  project_id: string;
  settings_json:
    | NovelSettingsEnvelope
    | NovelSettingsV1
    | Record<string, unknown>;
}

export interface NovelGenerateRequest {
  project_id: string;
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface NovelGenerateChapterRequest extends NovelGenerateRequest {
  chapter_no?: number;
  force_overwrite?: boolean;
}

export interface NovelRewriteChapterRequest extends NovelGenerateRequest {
  chapter_id: string;
  instructions?: string;
}

export interface NovelPolishChapterRequest extends NovelGenerateRequest {
  chapter_id: string;
  focus?: string;
}

export interface NovelCheckConsistencyRequest {
  project_id: string;
  chapter_id: string;
}

export interface NovelListRunsRequest {
  project_id: string;
  limit?: number;
}

export interface NovelDeleteCharacterRequest {
  project_id: string;
  character_id: string;
}

export async function createNovelProject(
  request: CreateNovelProjectRequest,
): Promise<NovelProject> {
  const normalizedRequest =
    request.settings_json === undefined
      ? request
      : {
          ...request,
          settings_json: normalizeNovelSettingsEnvelope(request.settings_json),
        };
  return safeInvoke<NovelProject>("novel_create_project", {
    request: normalizedRequest,
  });
}

export async function updateNovelSettings(
  request: UpdateNovelSettingsRequest,
): Promise<NovelSettingsRecord> {
  return safeInvoke<NovelSettingsRecord>("novel_update_settings", {
    request: {
      ...request,
      settings_json: normalizeNovelSettingsEnvelope(request.settings_json),
    },
  });
}

export async function generateNovelOutline(
  request: NovelGenerateRequest,
): Promise<NovelGenerateResult> {
  return safeInvoke<NovelGenerateResult>("novel_generate_outline", { request });
}

export async function generateNovelCharacters(
  request: NovelGenerateRequest,
): Promise<NovelGenerateResult> {
  return safeInvoke<NovelGenerateResult>("novel_generate_characters", {
    request,
  });
}

export async function generateNovelChapter(
  request: NovelGenerateChapterRequest,
): Promise<NovelGenerateResult> {
  return safeInvoke<NovelGenerateResult>("novel_generate_chapter", { request });
}

export async function continueNovelChapter(
  request: NovelGenerateRequest,
): Promise<NovelGenerateResult> {
  return safeInvoke<NovelGenerateResult>("novel_continue_chapter", { request });
}

export async function rewriteNovelChapter(
  request: NovelRewriteChapterRequest,
): Promise<NovelGenerateResult> {
  return safeInvoke<NovelGenerateResult>("novel_rewrite_chapter", { request });
}

export async function polishNovelChapter(
  request: NovelPolishChapterRequest,
): Promise<NovelGenerateResult> {
  return safeInvoke<NovelGenerateResult>("novel_polish_chapter", { request });
}

export async function checkNovelConsistency(
  request: NovelCheckConsistencyRequest,
): Promise<NovelConsistencyCheck> {
  return safeInvoke<NovelConsistencyCheck>("novel_check_consistency", {
    request,
  });
}

export async function getNovelProjectSnapshot(
  projectId: string,
): Promise<NovelProjectSnapshot> {
  return safeInvoke<NovelProjectSnapshot>("novel_get_project_snapshot", {
    projectId,
  });
}

export async function listNovelRuns(
  request: NovelListRunsRequest,
): Promise<NovelGenerationRun[]> {
  return safeInvoke<NovelGenerationRun[]>("novel_list_runs", { request });
}

export async function deleteNovelCharacter(
  request: NovelDeleteCharacterRequest,
): Promise<boolean> {
  return safeInvoke<boolean>("novel_delete_character", { request });
}
