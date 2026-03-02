//! 小说领域服务
//!
//! 提供小说项目、设定、章节生成与一致性检查能力。

use crate::database::{lock_db, DbConnection};
use proxycast_services::api_key_provider_service::ApiKeyProviderService;
use proxycast_services::provider_pool_service::ProviderPoolService;
use proxycast_skills::{LlmProvider, ProxyCastLlmProvider};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

const DEFAULT_TARGET_WORDS: i64 = 100_000;
const DEFAULT_MODEL: &str = "default";
const DEFAULT_RECENT_CHAPTERS: usize = 3;
const NOVEL_SETTINGS_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MainCharacter {
    pub name: String,
    pub gender: String,
    pub age: String,
    pub personality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SideCharacter {
    pub id: String,
    pub name: String,
    pub nickname: String,
    pub gender: String,
    pub age: String,
    pub relationship: String,
    #[serde(rename = "relationshipCustom")]
    pub relationship_custom: String,
    #[serde(rename = "personalityTags")]
    pub personality_tags: Vec<String>,
    pub background: String,
    pub abilities: String,
    pub role: String,
    pub arc: String,
    #[serde(rename = "arcCustom")]
    pub arc_custom: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Antagonist {
    pub id: String,
    pub name: String,
    pub nickname: String,
    pub gender: String,
    pub age: String,
    pub relationship: String,
    #[serde(rename = "relationshipCustom")]
    pub relationship_custom: String,
    #[serde(rename = "personalityTags")]
    pub personality_tags: Vec<String>,
    pub background: String,
    pub abilities: String,
    pub role: String,
    pub arc: String,
    #[serde(rename = "arcCustom")]
    pub arc_custom: String,
    pub motive: String,
    pub fate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldDetails {
    #[serde(rename = "powerSystem")]
    pub power_system: String,
    pub factions: String,
    #[serde(rename = "historyEvents")]
    pub history_events: String,
    #[serde(rename = "importantLocations")]
    pub important_locations: String,
    #[serde(rename = "cultureAndTaboos")]
    pub culture_and_taboos: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotBeat {
    pub id: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WritingStyle {
    pub narration: String,
    pub tones: Vec<String>,
    #[serde(rename = "cheatLevel")]
    pub cheat_level: String,
    #[serde(rename = "focusAreas")]
    pub focus_areas: Vec<String>,
    #[serde(rename = "wordsPerChapter")]
    pub words_per_chapter: i64,
    pub temperature: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabooRule {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceWork {
    pub id: String,
    pub title: String,
    pub inspiration: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelSettingsV1 {
    pub genres: Vec<String>,
    #[serde(rename = "oneLinePitch")]
    pub one_line_pitch: String,
    #[serde(rename = "mainCharacter")]
    pub main_character: MainCharacter,
    #[serde(rename = "sideCharacters")]
    pub side_characters: Vec<SideCharacter>,
    pub antagonists: Vec<Antagonist>,
    #[serde(rename = "worldSummary")]
    pub world_summary: String,
    #[serde(rename = "conflictTheme")]
    pub conflict_theme: String,
    #[serde(rename = "worldDetails")]
    pub world_details: WorldDetails,
    pub opening: String,
    #[serde(rename = "middleBeats")]
    pub middle_beats: Vec<PlotBeat>,
    #[serde(rename = "endingType")]
    pub ending_type: String,
    pub subplots: Vec<PlotBeat>,
    #[serde(rename = "writingStyle")]
    pub writing_style: WritingStyle,
    #[serde(rename = "totalWords")]
    pub total_words: i64,
    #[serde(rename = "chapterWords")]
    pub chapter_words: i64,
    pub nsfw: bool,
    #[serde(rename = "systemNovel")]
    pub system_novel: bool,
    pub harem: bool,
    pub taboos: Vec<TabooRule>,
    pub references: Vec<ReferenceWork>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelSettingsEnvelope {
    pub schema_version: i32,
    pub data: NovelSettingsV1,
}

impl Default for MainCharacter {
    fn default() -> Self {
        Self {
            name: String::new(),
            gender: "男".to_string(),
            age: String::new(),
            personality: String::new(),
        }
    }
}

impl Default for SideCharacter {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: String::new(),
            nickname: String::new(),
            gender: "男".to_string(),
            age: String::new(),
            relationship: String::new(),
            relationship_custom: String::new(),
            personality_tags: Vec::new(),
            background: String::new(),
            abilities: String::new(),
            role: String::new(),
            arc: String::new(),
            arc_custom: String::new(),
        }
    }
}

impl Default for Antagonist {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: String::new(),
            nickname: String::new(),
            gender: "男".to_string(),
            age: String::new(),
            relationship: String::new(),
            relationship_custom: String::new(),
            personality_tags: Vec::new(),
            background: String::new(),
            abilities: String::new(),
            role: String::new(),
            arc: String::new(),
            arc_custom: String::new(),
            motive: String::new(),
            fate: String::new(),
        }
    }
}

impl Default for WorldDetails {
    fn default() -> Self {
        Self {
            power_system: String::new(),
            factions: String::new(),
            history_events: String::new(),
            important_locations: String::new(),
            culture_and_taboos: String::new(),
        }
    }
}

impl Default for WritingStyle {
    fn default() -> Self {
        Self {
            narration: "第三人称有限".to_string(),
            tones: Vec::new(),
            cheat_level: "稳步成长".to_string(),
            focus_areas: Vec::new(),
            words_per_chapter: 3000,
            temperature: 0.7,
        }
    }
}

impl Default for NovelSettingsV1 {
    fn default() -> Self {
        Self {
            genres: Vec::new(),
            one_line_pitch: String::new(),
            main_character: MainCharacter::default(),
            side_characters: Vec::new(),
            antagonists: Vec::new(),
            world_summary: String::new(),
            conflict_theme: String::new(),
            world_details: WorldDetails::default(),
            opening: String::new(),
            middle_beats: Vec::new(),
            ending_type: String::new(),
            subplots: Vec::new(),
            writing_style: WritingStyle::default(),
            total_words: 100_000,
            chapter_words: 3000,
            nsfw: false,
            system_novel: false,
            harem: false,
            taboos: Vec::new(),
            references: Vec::new(),
        }
    }
}

impl Default for NovelSettingsEnvelope {
    fn default() -> Self {
        Self {
            schema_version: NOVEL_SETTINGS_SCHEMA_VERSION,
            data: NovelSettingsV1::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelProject {
    pub id: String,
    pub title: String,
    pub theme: Option<String>,
    pub target_words: i64,
    pub status: String,
    pub current_word_count: i64,
    pub metadata_json: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelSettingsRecord {
    pub id: String,
    pub project_id: String,
    pub settings_json: NovelSettingsEnvelope,
    pub version: i32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelOutlineRecord {
    pub id: String,
    pub project_id: String,
    pub outline_markdown: String,
    pub outline_json: Option<Value>,
    pub version: i32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelCharacterRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub role_type: String,
    pub card_json: Value,
    pub version: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelChapterRecord {
    pub id: String,
    pub project_id: String,
    pub chapter_no: i32,
    pub title: String,
    pub content: String,
    pub word_count: i64,
    pub status: String,
    pub quality_score: Option<f64>,
    pub metadata_json: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelGenerationRun {
    pub id: String,
    pub project_id: String,
    pub mode: String,
    pub input_snapshot_json: Option<Value>,
    pub output_snapshot_json: Option<Value>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub latency_ms: Option<i64>,
    pub token_usage_json: Option<Value>,
    pub result_status: String,
    pub error_message: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelConsistencyIssue {
    pub level: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelConsistencyCheck {
    pub id: String,
    pub project_id: String,
    pub chapter_id: String,
    pub issues: Vec<NovelConsistencyIssue>,
    pub score: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelProjectSnapshot {
    pub project: NovelProject,
    pub latest_settings: Option<NovelSettingsRecord>,
    pub latest_outline: Option<NovelOutlineRecord>,
    pub characters: Vec<NovelCharacterRecord>,
    pub chapters: Vec<NovelChapterRecord>,
    pub latest_consistency: Option<NovelConsistencyCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovelGenerateResult {
    pub mode: String,
    pub run_id: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter: Option<NovelChapterRecord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelCreateProjectRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub target_words: Option<i64>,
    #[serde(default)]
    pub metadata_json: Option<Value>,
    #[serde(default)]
    pub settings_json: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelUpdateSettingsRequest {
    pub project_id: String,
    pub settings_json: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelGenerateRequest {
    pub project_id: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelGenerateChapterRequest {
    pub project_id: String,
    #[serde(default)]
    pub chapter_no: Option<i32>,
    #[serde(default)]
    pub force_overwrite: Option<bool>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelRewriteChapterRequest {
    pub project_id: String,
    pub chapter_id: String,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelPolishChapterRequest {
    pub project_id: String,
    pub chapter_id: String,
    #[serde(default)]
    pub focus: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelCheckConsistencyRequest {
    pub project_id: String,
    pub chapter_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelListRunsRequest {
    pub project_id: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NovelDeleteCharacterRequest {
    pub project_id: String,
    pub character_id: String,
}

#[derive(Clone)]
pub struct NovelService {
    db: DbConnection,
}

impl NovelService {
    pub fn new(db: DbConnection) -> Self {
        Self { db }
    }

    pub fn create_project(
        &self,
        request: NovelCreateProjectRequest,
    ) -> Result<NovelProject, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let project_id = request.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let settings_id = Uuid::new_v4().to_string();
        let target_words = request.target_words.unwrap_or(DEFAULT_TARGET_WORDS);
        let metadata_json_str = request
            .metadata_json
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("序列化 metadata_json 失败: {e}"))?;
        let settings_envelope = normalize_settings_envelope_from_value(
            request.settings_json.unwrap_or_else(|| json!({})),
        );
        let settings_json_str = serde_json::to_string(&settings_envelope)
            .map_err(|e| format!("序列化 settings_json 失败: {e}"))?;

        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;

        let already_exists = tx
            .query_row(
                "SELECT 1 FROM novel_projects WHERE id = ?1 LIMIT 1",
                params![&project_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| format!("检查小说项目是否存在失败: {e}"))?
            .is_some();
        if already_exists {
            tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
            drop(conn);
            return self
                .get_project(&project_id)?
                .ok_or_else(|| "项目已存在但读取失败".to_string());
        }

        tx.execute(
            "INSERT INTO novel_projects (id, title, theme, target_words, status, current_word_count, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'draft', 0, ?5, ?6, ?7)",
            params![
                &project_id,
                &request.title,
                &request.theme,
                target_words,
                &metadata_json_str,
                now,
                now
            ],
        )
        .map_err(|e| format!("创建小说项目失败: {e}"))?;

        tx.execute(
            "INSERT INTO novel_settings (id, project_id, settings_json, version, created_at)
             VALUES (?1, ?2, ?3, 1, ?4)",
            params![&settings_id, &project_id, &settings_json_str, now],
        )
        .map_err(|e| format!("初始化小说设定失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        drop(conn);

        self.get_project(&project_id)?
            .ok_or_else(|| "项目创建成功但读取失败".to_string())
    }

    pub fn get_project(&self, project_id: &str) -> Result<Option<NovelProject>, String> {
        let conn = lock_db(&self.db)?;
        let result = conn.query_row(
            "SELECT id, title, theme, target_words, status, current_word_count, metadata_json, created_at, updated_at
             FROM novel_projects WHERE id = ?1",
            params![project_id],
            row_to_project,
        );

        match result {
            Ok(project) => Ok(Some(project)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("读取项目失败: {e}")),
        }
    }

    pub fn update_settings(
        &self,
        request: NovelUpdateSettingsRequest,
    ) -> Result<NovelSettingsRecord, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let settings_envelope = normalize_settings_envelope_from_value(request.settings_json);
        let settings_json = serde_json::to_string(&settings_envelope)
            .map_err(|e| format!("序列化 settings_json 失败: {e}"))?;
        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;

        let next_version = query_next_version(
            &tx,
            "SELECT COALESCE(MAX(version), 0) + 1 FROM novel_settings WHERE project_id = ?1",
            &request.project_id,
        )?;

        tx.execute(
            "INSERT INTO novel_settings (id, project_id, settings_json, version, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, &request.project_id, settings_json, next_version, now],
        )
        .map_err(|e| format!("写入小说设定失败: {e}"))?;

        tx.execute(
            "UPDATE novel_projects SET updated_at = ?1 WHERE id = ?2",
            params![now, &request.project_id],
        )
        .map_err(|e| format!("更新项目时间失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        drop(conn);
        self.get_latest_settings(&request.project_id)?
            .ok_or_else(|| "设定更新后读取失败".to_string())
    }

    pub fn get_latest_settings(
        &self,
        project_id: &str,
    ) -> Result<Option<NovelSettingsRecord>, String> {
        let conn = lock_db(&self.db)?;
        let result = conn.query_row(
            "SELECT id, project_id, settings_json, version, created_at
             FROM novel_settings WHERE project_id = ?1
             ORDER BY version DESC LIMIT 1",
            params![project_id],
            row_to_settings,
        );

        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("读取最新设定失败: {e}")),
        }
    }

    pub async fn generate_outline(
        &self,
        request: NovelGenerateRequest,
    ) -> Result<NovelGenerateResult, String> {
        self.ensure_project_exists(&request.project_id)?;
        let settings = self.get_latest_settings(&request.project_id)?;
        let prompt = build_outline_prompt(settings.as_ref().map(|s| &s.settings_json));
        self.generate_and_save_outline(&request, &prompt).await
    }

    pub async fn generate_characters(
        &self,
        request: NovelGenerateRequest,
    ) -> Result<NovelGenerateResult, String> {
        self.ensure_project_exists(&request.project_id)?;
        let settings = self.get_latest_settings(&request.project_id)?;
        let prompt = build_characters_prompt(settings.as_ref().map(|s| &s.settings_json));
        self.generate_and_save_characters(&request, &prompt).await
    }

    pub async fn generate_chapter(
        &self,
        request: NovelGenerateChapterRequest,
    ) -> Result<NovelGenerateResult, String> {
        self.ensure_project_exists(&request.project_id)?;
        let settings = self.get_latest_settings(&request.project_id)?;
        let outline = self.get_latest_outline(&request.project_id)?;
        let characters = self.list_characters(&request.project_id)?;
        let chapters = self.list_chapters(&request.project_id)?;
        let chapter_no = request
            .chapter_no
            .unwrap_or_else(|| chapters.len() as i32 + 1);
        let prompt = build_chapter_prompt(
            settings.as_ref().map(|s| &s.settings_json),
            outline.as_ref().map(|o| o.outline_markdown.as_str()),
            &characters,
            &chapters,
            chapter_no,
        );

        self.generate_and_upsert_chapter(
            &request.project_id,
            "generate",
            prompt,
            chapter_no,
            request.force_overwrite.unwrap_or(false),
            request.provider.clone(),
            request.model.clone(),
            request.temperature,
            request.max_tokens,
        )
        .await
    }

    pub async fn continue_chapter(
        &self,
        request: NovelGenerateRequest,
    ) -> Result<NovelGenerateResult, String> {
        self.ensure_project_exists(&request.project_id)?;
        let settings = self.get_latest_settings(&request.project_id)?;
        let outline = self.get_latest_outline(&request.project_id)?;
        let characters = self.list_characters(&request.project_id)?;
        let chapters = self.list_chapters(&request.project_id)?;
        let chapter_no = chapters.len() as i32 + 1;

        let prompt = build_continue_prompt(
            settings.as_ref().map(|s| &s.settings_json),
            outline.as_ref().map(|o| o.outline_markdown.as_str()),
            &characters,
            &chapters,
            chapter_no,
        );

        self.generate_and_upsert_chapter(
            &request.project_id,
            "continue",
            prompt,
            chapter_no,
            false,
            request.provider,
            request.model,
            request.temperature,
            request.max_tokens,
        )
        .await
    }

    pub async fn rewrite_chapter(
        &self,
        request: NovelRewriteChapterRequest,
    ) -> Result<NovelGenerateResult, String> {
        self.ensure_project_exists(&request.project_id)?;
        let source = self
            .get_chapter(&request.chapter_id)?
            .ok_or_else(|| "章节不存在".to_string())?;
        let settings = self.get_latest_settings(&request.project_id)?;
        let prompt = build_rewrite_prompt(
            settings.as_ref().map(|s| &s.settings_json),
            &source,
            request.instructions.as_deref(),
        );

        self.generate_and_update_chapter(
            &request.project_id,
            "rewrite",
            prompt,
            &source,
            request.provider,
            request.model,
            request.temperature,
            request.max_tokens,
        )
        .await
    }

    pub async fn polish_chapter(
        &self,
        request: NovelPolishChapterRequest,
    ) -> Result<NovelGenerateResult, String> {
        self.ensure_project_exists(&request.project_id)?;
        let source = self
            .get_chapter(&request.chapter_id)?
            .ok_or_else(|| "章节不存在".to_string())?;
        let settings = self.get_latest_settings(&request.project_id)?;
        let prompt = build_polish_prompt(
            settings.as_ref().map(|s| &s.settings_json),
            &source,
            request.focus.as_deref(),
        );

        self.generate_and_update_chapter(
            &request.project_id,
            "polish",
            prompt,
            &source,
            request.provider,
            request.model,
            request.temperature,
            request.max_tokens,
        )
        .await
    }

    pub fn check_consistency(
        &self,
        request: NovelCheckConsistencyRequest,
    ) -> Result<NovelConsistencyCheck, String> {
        self.ensure_project_exists(&request.project_id)?;
        let chapter = self
            .get_chapter(&request.chapter_id)?
            .ok_or_else(|| "章节不存在".to_string())?;

        let settings = self.get_latest_settings(&request.project_id)?;
        let characters = self.list_characters(&request.project_id)?;
        let issues = evaluate_consistency(&chapter, settings.as_ref(), &characters);
        let score = calculate_score(&issues);
        let now = chrono::Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let issues_json =
            serde_json::to_string(&issues).map_err(|e| format!("序列化一致性结果失败: {e}"))?;
        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;

        tx.execute(
            "INSERT INTO novel_consistency_checks (id, project_id, chapter_id, issues_json, score, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, &request.project_id, &request.chapter_id, issues_json, score, now],
        )
        .map_err(|e| format!("保存一致性检查失败: {e}"))?;

        tx.execute(
            "UPDATE novel_chapters SET quality_score = ?1, updated_at = ?2 WHERE id = ?3",
            params![score, now, &request.chapter_id],
        )
        .map_err(|e| format!("更新章节质量分失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

        Ok(NovelConsistencyCheck {
            id,
            project_id: request.project_id,
            chapter_id: request.chapter_id,
            issues,
            score,
            created_at: now,
        })
    }

    pub fn get_project_snapshot(&self, project_id: &str) -> Result<NovelProjectSnapshot, String> {
        let project = self
            .get_project(project_id)?
            .ok_or_else(|| "项目不存在".to_string())?;
        let latest_settings = self.get_latest_settings(project_id)?;
        let latest_outline = self.get_latest_outline(project_id)?;
        let characters = self.list_characters(project_id)?;
        let chapters = self.list_chapters(project_id)?;
        let latest_consistency = self.get_latest_consistency(project_id)?;

        Ok(NovelProjectSnapshot {
            project,
            latest_settings,
            latest_outline,
            characters,
            chapters,
            latest_consistency,
        })
    }

    pub fn list_runs(
        &self,
        request: NovelListRunsRequest,
    ) -> Result<Vec<NovelGenerationRun>, String> {
        self.ensure_project_exists(&request.project_id)?;
        let limit = request.limit.unwrap_or(50).clamp(1, 500);
        let conn = lock_db(&self.db)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, mode, input_snapshot_json, output_snapshot_json, provider, model,
                        latency_ms, token_usage_json, result_status, error_message, created_at
                 FROM novel_generation_runs
                 WHERE project_id = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("准备查询 run 失败: {e}"))?;

        let rows = stmt
            .query_map(params![&request.project_id, limit], row_to_run)
            .map_err(|e| format!("查询 run 失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析 run 失败: {e}"))?;

        Ok(rows)
    }

    pub fn delete_character(&self, request: NovelDeleteCharacterRequest) -> Result<bool, String> {
        self.ensure_project_exists(&request.project_id)?;
        let now = chrono::Utc::now().timestamp_millis();
        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;

        let exists = tx
            .query_row(
                "SELECT 1 FROM novel_characters WHERE id = ?1 AND project_id = ?2 LIMIT 1",
                params![&request.character_id, &request.project_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| format!("检查角色是否存在失败: {e}"))?
            .is_some();

        if !exists {
            tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
            return Ok(false);
        }

        tx.execute(
            "DELETE FROM novel_characters WHERE id = ?1 AND project_id = ?2",
            params![&request.character_id, &request.project_id],
        )
        .map_err(|e| format!("删除角色失败: {e}"))?;

        tx.execute(
            "UPDATE novel_projects SET updated_at = ?1 WHERE id = ?2",
            params![now, &request.project_id],
        )
        .map_err(|e| format!("更新项目时间失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        Ok(true)
    }

    fn list_characters(&self, project_id: &str) -> Result<Vec<NovelCharacterRecord>, String> {
        let conn = lock_db(&self.db)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, role_type, card_json, version, created_at, updated_at
                 FROM novel_characters
                 WHERE project_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|e| format!("准备查询角色失败: {e}"))?;
        let rows = stmt
            .query_map(params![project_id], row_to_character)
            .map_err(|e| format!("查询角色失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析角色失败: {e}"))?;
        Ok(rows)
    }

    fn list_chapters(&self, project_id: &str) -> Result<Vec<NovelChapterRecord>, String> {
        let conn = lock_db(&self.db)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, chapter_no, title, content, word_count, status, quality_score,
                        metadata_json, created_at, updated_at
                 FROM novel_chapters WHERE project_id = ?1
                 ORDER BY chapter_no ASC",
            )
            .map_err(|e| format!("准备查询章节失败: {e}"))?;

        let rows = stmt
            .query_map(params![project_id], row_to_chapter)
            .map_err(|e| format!("查询章节失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析章节失败: {e}"))?;

        Ok(rows)
    }

    fn get_chapter(&self, chapter_id: &str) -> Result<Option<NovelChapterRecord>, String> {
        let conn = lock_db(&self.db)?;
        let result = conn.query_row(
            "SELECT id, project_id, chapter_no, title, content, word_count, status, quality_score,
                    metadata_json, created_at, updated_at
             FROM novel_chapters WHERE id = ?1",
            params![chapter_id],
            row_to_chapter,
        );

        match result {
            Ok(chapter) => Ok(Some(chapter)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("读取章节失败: {e}")),
        }
    }

    fn get_latest_outline(&self, project_id: &str) -> Result<Option<NovelOutlineRecord>, String> {
        let conn = lock_db(&self.db)?;
        let result = conn.query_row(
            "SELECT id, project_id, outline_markdown, outline_json, version, created_at
             FROM novel_outlines
             WHERE project_id = ?1
             ORDER BY version DESC
             LIMIT 1",
            params![project_id],
            row_to_outline,
        );

        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("读取大纲失败: {e}")),
        }
    }

    fn get_latest_consistency(
        &self,
        project_id: &str,
    ) -> Result<Option<NovelConsistencyCheck>, String> {
        let conn = lock_db(&self.db)?;
        let result = conn.query_row(
            "SELECT id, project_id, chapter_id, issues_json, score, created_at
             FROM novel_consistency_checks
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            params![project_id],
            |row| {
                let issues_json: String = row.get(3)?;
                let issues: Vec<NovelConsistencyIssue> =
                    serde_json::from_str(&issues_json).unwrap_or_default();
                Ok(NovelConsistencyCheck {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    chapter_id: row.get(2)?,
                    issues,
                    score: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        );

        match result {
            Ok(check) => Ok(Some(check)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("读取一致性检查失败: {e}")),
        }
    }

    fn ensure_project_exists(&self, project_id: &str) -> Result<(), String> {
        if self.get_project(project_id)?.is_none() {
            return Err("小说项目不存在".to_string());
        }
        Ok(())
    }

    async fn generate_and_save_outline(
        &self,
        request: &NovelGenerateRequest,
        prompt: &str,
    ) -> Result<NovelGenerateResult, String> {
        let (model_used, generated, latency_ms) = self
            .call_llm(
                prompt,
                request.provider.as_deref(),
                request.model.as_deref(),
                request.temperature,
                request.max_tokens,
            )
            .await?;

        let now = chrono::Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let run_id = Uuid::new_v4().to_string();
        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;

        let next_version = query_next_version(
            &tx,
            "SELECT COALESCE(MAX(version), 0) + 1 FROM novel_outlines WHERE project_id = ?1",
            &request.project_id,
        )?;

        tx.execute(
            "INSERT INTO novel_outlines (id, project_id, outline_markdown, outline_json, version, created_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
            params![id, &request.project_id, &generated, next_version, now],
        )
        .map_err(|e| format!("写入大纲失败: {e}"))?;

        self.insert_run_with_tx(
            &tx,
            InsertRunParams {
                run_id: &run_id,
                project_id: &request.project_id,
                mode: "outline",
                input_snapshot: json!({ "prompt": prompt }),
                output_snapshot: json!({ "outline": generated }),
                model: &model_used,
                latency_ms,
                status: "success",
                error_message: None,
                created_at: now,
            },
        )?;

        tx.execute(
            "UPDATE novel_projects SET updated_at = ?1 WHERE id = ?2",
            params![now, &request.project_id],
        )
        .map_err(|e| format!("更新项目时间失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

        Ok(NovelGenerateResult {
            mode: "outline".to_string(),
            run_id,
            content: generated,
            chapter: None,
        })
    }

    async fn generate_and_save_characters(
        &self,
        request: &NovelGenerateRequest,
        prompt: &str,
    ) -> Result<NovelGenerateResult, String> {
        let (model_used, generated, latency_ms) = self
            .call_llm(
                prompt,
                request.provider.as_deref(),
                request.model.as_deref(),
                request.temperature,
                request.max_tokens,
            )
            .await?;

        let cards = parse_character_cards(&generated);
        let now = chrono::Utc::now().timestamp_millis();
        let run_id = Uuid::new_v4().to_string();
        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;
        let next_version = query_next_version(
            &tx,
            "SELECT COALESCE(MAX(version), 0) + 1 FROM novel_characters WHERE project_id = ?1",
            &request.project_id,
        )?;

        tx.execute(
            "DELETE FROM novel_characters WHERE project_id = ?1",
            params![&request.project_id],
        )
        .map_err(|e| format!("清理旧角色失败: {e}"))?;

        for (index, card) in cards.iter().enumerate() {
            let id = Uuid::new_v4().to_string();
            let name = card
                .get("name")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| format!("角色{}", index + 1));
            let role_type = card
                .get("role_type")
                .and_then(Value::as_str)
                .unwrap_or("support");
            let card_json = serde_json::to_string(card).map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO novel_characters (id, project_id, name, role_type, card_json, version, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    &request.project_id,
                    name,
                    role_type,
                    card_json,
                    next_version,
                    now,
                    now
                ],
            )
            .map_err(|e| format!("写入角色失败: {e}"))?;
        }

        self.insert_run_with_tx(
            &tx,
            InsertRunParams {
                run_id: &run_id,
                project_id: &request.project_id,
                mode: "characters",
                input_snapshot: json!({ "prompt": prompt }),
                output_snapshot: json!({ "raw": generated, "cards": cards }),
                model: &model_used,
                latency_ms,
                status: "success",
                error_message: None,
                created_at: now,
            },
        )?;

        tx.execute(
            "UPDATE novel_projects SET updated_at = ?1 WHERE id = ?2",
            params![now, &request.project_id],
        )
        .map_err(|e| format!("更新项目时间失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

        Ok(NovelGenerateResult {
            mode: "characters".to_string(),
            run_id,
            content: generated,
            chapter: None,
        })
    }

    async fn generate_and_upsert_chapter(
        &self,
        project_id: &str,
        mode: &str,
        prompt: String,
        chapter_no: i32,
        force_overwrite: bool,
        provider: Option<String>,
        model: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<NovelGenerateResult, String> {
        let (model_used, generated, latency_ms) = self
            .call_llm(
                &prompt,
                provider.as_deref(),
                model.as_deref(),
                temperature,
                max_tokens,
            )
            .await?;
        let (title, content) = split_title_and_content(&generated, chapter_no);
        let chapter_word_count = count_words(&content);
        let now = chrono::Utc::now().timestamp_millis();
        let run_id = Uuid::new_v4().to_string();

        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;
        let existing = tx
            .query_row(
                "SELECT id FROM novel_chapters WHERE project_id = ?1 AND chapter_no = ?2",
                params![project_id, chapter_no],
                |row| row.get::<_, String>(0),
            )
            .ok();

        let chapter = if let Some(existing_id) = existing {
            if !force_overwrite {
                return Err(format!(
                    "第 {} 章已存在，若要覆盖请设置 force_overwrite=true",
                    chapter_no
                ));
            }
            tx.execute(
                "UPDATE novel_chapters
                 SET title = ?1, content = ?2, word_count = ?3, status = 'draft', quality_score = NULL, updated_at = ?4
                 WHERE id = ?5",
                params![&title, &content, chapter_word_count, now, &existing_id],
            )
            .map_err(|e| format!("覆盖章节失败: {e}"))?;
            self.fetch_chapter_with_tx(&tx, &existing_id)?
        } else {
            let chapter_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO novel_chapters
                 (id, project_id, chapter_no, title, content, word_count, status, quality_score, metadata_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', NULL, NULL, ?7, ?8)",
                params![
                    &chapter_id,
                    project_id,
                    chapter_no,
                    &title,
                    &content,
                    chapter_word_count,
                    now,
                    now
                ],
            )
            .map_err(|e| format!("写入章节失败: {e}"))?;
            self.fetch_chapter_with_tx(&tx, &chapter_id)?
        };

        self.recalculate_project_word_count_with_tx(&tx, project_id, now)?;
        self.insert_run_with_tx(
            &tx,
            InsertRunParams {
                run_id: &run_id,
                project_id,
                mode,
                input_snapshot: json!({ "prompt": prompt, "chapter_no": chapter_no }),
                output_snapshot: json!({ "title": title, "content": content }),
                model: &model_used,
                latency_ms,
                status: "success",
                error_message: None,
                created_at: now,
            },
        )?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

        Ok(NovelGenerateResult {
            mode: mode.to_string(),
            run_id,
            content: generated,
            chapter: Some(chapter),
        })
    }

    async fn generate_and_update_chapter(
        &self,
        project_id: &str,
        mode: &str,
        prompt: String,
        source: &NovelChapterRecord,
        provider: Option<String>,
        model: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<NovelGenerateResult, String> {
        let (model_used, generated, latency_ms) = self
            .call_llm(
                &prompt,
                provider.as_deref(),
                model.as_deref(),
                temperature,
                max_tokens,
            )
            .await?;
        let (title, content) = split_title_and_content(&generated, source.chapter_no);
        let new_word_count = count_words(&content);
        let now = chrono::Utc::now().timestamp_millis();
        let run_id = Uuid::new_v4().to_string();

        let mut conn = lock_db(&self.db)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;

        tx.execute(
            "UPDATE novel_chapters
             SET title = ?1, content = ?2, word_count = ?3, status = 'draft', quality_score = NULL, updated_at = ?4
             WHERE id = ?5 AND project_id = ?6",
            params![&title, &content, new_word_count, now, &source.id, project_id],
        )
        .map_err(|e| format!("更新章节失败: {e}"))?;

        let chapter = self.fetch_chapter_with_tx(&tx, &source.id)?;
        self.recalculate_project_word_count_with_tx(&tx, project_id, now)?;
        self.insert_run_with_tx(
            &tx,
            InsertRunParams {
                run_id: &run_id,
                project_id,
                mode,
                input_snapshot: json!({
                    "prompt": prompt,
                    "chapter_id": source.id,
                    "chapter_no": source.chapter_no
                }),
                output_snapshot: json!({ "title": title, "content": content }),
                model: &model_used,
                latency_ms,
                status: "success",
                error_message: None,
                created_at: now,
            },
        )?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

        Ok(NovelGenerateResult {
            mode: mode.to_string(),
            run_id,
            content: generated,
            chapter: Some(chapter),
        })
    }

    fn fetch_chapter_with_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        chapter_id: &str,
    ) -> Result<NovelChapterRecord, String> {
        tx.query_row(
            "SELECT id, project_id, chapter_no, title, content, word_count, status, quality_score,
                    metadata_json, created_at, updated_at
             FROM novel_chapters WHERE id = ?1",
            params![chapter_id],
            row_to_chapter,
        )
        .map_err(|e| format!("读取章节失败: {e}"))
    }

    fn recalculate_project_word_count_with_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        project_id: &str,
        now: i64,
    ) -> Result<(), String> {
        let total_words: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(word_count), 0) FROM novel_chapters WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("统计章节字数失败: {e}"))?;

        tx.execute(
            "UPDATE novel_projects
             SET current_word_count = ?1, updated_at = ?2
             WHERE id = ?3",
            params![total_words, now, project_id],
        )
        .map_err(|e| format!("更新项目字数失败: {e}"))?;

        Ok(())
    }

    fn insert_run_with_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        params_data: InsertRunParams<'_>,
    ) -> Result<(), String> {
        let input_json = serde_json::to_string(&params_data.input_snapshot)
            .map_err(|e| format!("序列化 input_snapshot 失败: {e}"))?;
        let output_json = serde_json::to_string(&params_data.output_snapshot)
            .map_err(|e| format!("序列化 output_snapshot 失败: {e}"))?;
        let token_usage_json = serde_json::to_string(&json!({ "tracked": false }))
            .map_err(|e| format!("序列化 token_usage_json 失败: {e}"))?;

        tx.execute(
            "INSERT INTO novel_generation_runs
             (id, project_id, mode, input_snapshot_json, output_snapshot_json, provider, model,
              latency_ms, token_usage_json, result_status, error_message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'local_proxy', ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                params_data.run_id,
                params_data.project_id,
                params_data.mode,
                input_json,
                output_json,
                params_data.model,
                params_data.latency_ms,
                token_usage_json,
                params_data.status,
                params_data.error_message,
                params_data.created_at
            ],
        )
        .map_err(|e| format!("写入生成运行记录失败: {e}"))?;

        Ok(())
    }

    async fn call_llm(
        &self,
        prompt: &str,
        provider: Option<&str>,
        model: Option<&str>,
        _temperature: Option<f32>,
        _max_tokens: Option<u32>,
    ) -> Result<(String, String, i64), String> {
        let used_model = model.unwrap_or(DEFAULT_MODEL).to_string();
        let start = Instant::now();
        let pool_service = Arc::new(ProviderPoolService::new());
        let api_key_service = Arc::new(ApiKeyProviderService::new());
        let system_prompt =
            "你是专业中文长篇小说创作助手。严格遵守设定，输出稳定、连贯、可直接发布的文本。";
        let preferred_provider = normalize_provider(provider);

        let llm = if let Some(provider_name) = preferred_provider {
            ProxyCastLlmProvider::with_preferred_provider(
                pool_service,
                api_key_service,
                self.db.clone(),
                provider_name,
            )
        } else {
            ProxyCastLlmProvider::new(pool_service, api_key_service, self.db.clone())
        };

        let content = llm
            .chat(system_prompt, prompt, Some(&used_model))
            .await
            .map_err(|e| format!("调用模型失败: {e}"))?;

        if content.trim().is_empty() {
            return Err("模型返回空内容".to_string());
        }

        Ok((used_model, content, start.elapsed().as_millis() as i64))
    }
}

fn normalize_provider(provider: Option<&str>) -> Option<String> {
    provider
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
}

struct InsertRunParams<'a> {
    run_id: &'a str,
    project_id: &'a str,
    mode: &'a str,
    input_snapshot: Value,
    output_snapshot: Value,
    model: &'a str,
    latency_ms: i64,
    status: &'a str,
    error_message: Option<String>,
    created_at: i64,
}

fn query_next_version(
    tx: &rusqlite::Transaction<'_>,
    sql: &str,
    project_id: &str,
) -> Result<i32, String> {
    tx.query_row(sql, params![project_id], |row| row.get(0))
        .map_err(|e| format!("查询版本号失败: {e}"))
}

fn row_to_project(row: &rusqlite::Row<'_>) -> Result<NovelProject, rusqlite::Error> {
    let metadata_json: Option<String> = row.get(6)?;
    Ok(NovelProject {
        id: row.get(0)?,
        title: row.get(1)?,
        theme: row.get(2)?,
        target_words: row.get(3)?,
        status: row.get(4)?,
        current_word_count: row.get(5)?,
        metadata_json: metadata_json.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_settings(row: &rusqlite::Row<'_>) -> Result<NovelSettingsRecord, rusqlite::Error> {
    let settings_json: String = row.get(2)?;
    let parsed = serde_json::from_str::<Value>(&settings_json).unwrap_or_else(|_| json!({}));
    Ok(NovelSettingsRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        settings_json: normalize_settings_envelope_from_value(parsed),
        version: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn row_to_outline(row: &rusqlite::Row<'_>) -> Result<NovelOutlineRecord, rusqlite::Error> {
    let outline_json: Option<String> = row.get(3)?;
    Ok(NovelOutlineRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        outline_markdown: row.get(2)?,
        outline_json: outline_json.and_then(|s| serde_json::from_str(&s).ok()),
        version: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn row_to_character(row: &rusqlite::Row<'_>) -> Result<NovelCharacterRecord, rusqlite::Error> {
    let card_json: String = row.get(4)?;
    Ok(NovelCharacterRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        role_type: row.get(3)?,
        card_json: serde_json::from_str(&card_json).unwrap_or_else(|_| json!({})),
        version: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_chapter(row: &rusqlite::Row<'_>) -> Result<NovelChapterRecord, rusqlite::Error> {
    let metadata_json: Option<String> = row.get(8)?;
    Ok(NovelChapterRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        chapter_no: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        word_count: row.get(5)?,
        status: row.get(6)?,
        quality_score: row.get(7)?,
        metadata_json: metadata_json.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn row_to_run(row: &rusqlite::Row<'_>) -> Result<NovelGenerationRun, rusqlite::Error> {
    let input_snapshot_json: Option<String> = row.get(3)?;
    let output_snapshot_json: Option<String> = row.get(4)?;
    let token_usage_json: Option<String> = row.get(8)?;
    Ok(NovelGenerationRun {
        id: row.get(0)?,
        project_id: row.get(1)?,
        mode: row.get(2)?,
        input_snapshot_json: input_snapshot_json.and_then(|s| serde_json::from_str(&s).ok()),
        output_snapshot_json: output_snapshot_json.and_then(|s| serde_json::from_str(&s).ok()),
        provider: row.get(5)?,
        model: row.get(6)?,
        latency_ms: row.get(7)?,
        token_usage_json: token_usage_json.and_then(|s| serde_json::from_str(&s).ok()),
        result_status: row.get(9)?,
        error_message: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn parse_character_cards(raw: &str) -> Vec<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if let Some(cards) = parse_character_cards_from_json_text(trimmed) {
        return cards;
    }

    let fenced = extract_first_markdown_code_block(trimmed);
    if let Some(code) = fenced.as_ref() {
        if let Some(cards) = parse_character_cards_from_json_text(code) {
            return cards;
        }
    }

    if let Some(array_text) = extract_json_array_text(trimmed) {
        if let Some(cards) = parse_character_cards_from_json_text(&array_text) {
            return cards;
        }
    }

    if let Some(code) = fenced.as_ref() {
        if let Some(array_text) = extract_json_array_text(code) {
            if let Some(cards) = parse_character_cards_from_json_text(&array_text) {
                return cards;
            }
        }
    }

    // 兜底：按行解析成简单角色卡（过滤 JSON 噪音行）
    raw.lines()
        .filter_map(|line| {
            let name = sanitize_fallback_name(line)?;
            Some(json!({
                "name": name,
                "role_type": "support",
                "description": ""
            }))
        })
        .collect()
}

fn parse_character_cards_from_json_text(text: &str) -> Option<Vec<Value>> {
    let value = serde_json::from_str::<Value>(text).ok()?;
    extract_character_cards_from_value(&value)
}

fn extract_character_cards_from_value(value: &Value) -> Option<Vec<Value>> {
    if let Some(arr) = value.as_array() {
        return Some(
            arr.iter()
                .enumerate()
                .map(|(idx, item)| normalize_character_card(item, idx))
                .collect(),
        );
    }

    let obj = value.as_object()?;
    for key in [
        "characters",
        "character_cards",
        "cards",
        "result",
        "data",
        "roles",
    ] {
        if let Some(arr) = obj.get(key).and_then(Value::as_array) {
            return Some(
                arr.iter()
                    .enumerate()
                    .map(|(idx, item)| normalize_character_card(item, idx))
                    .collect(),
            );
        }
    }

    if obj.get("name").is_some() || obj.get("role_type").is_some() {
        return Some(vec![normalize_character_card(value, 0)]);
    }

    None
}

fn normalize_character_card(value: &Value, index: usize) -> Value {
    let mut obj = value.as_object().cloned().unwrap_or_default();
    let name = extract_character_name(&obj).unwrap_or_else(|| format!("角色{}", index + 1));
    let role_type = extract_role_type(&obj);
    obj.insert("name".to_string(), Value::String(name));
    obj.insert("role_type".to_string(), Value::String(role_type));
    Value::Object(obj)
}

fn extract_character_name(obj: &serde_json::Map<String, Value>) -> Option<String> {
    let candidate_keys = ["name", "character_name", "characterName", "角色名", "角色"];
    for key in candidate_keys {
        if let Some(raw_name) = obj.get(key).and_then(Value::as_str) {
            if let Some(name) = sanitize_candidate_name(raw_name) {
                return Some(name);
            }
        }
    }
    None
}

fn extract_role_type(obj: &serde_json::Map<String, Value>) -> String {
    let candidate_keys = ["role_type", "roleType", "type", "role", "角色类型"];
    for key in candidate_keys {
        if let Some(value) = obj.get(key).and_then(Value::as_str) {
            return normalize_role_type(value);
        }
    }
    "support".to_string()
}

fn normalize_role_type(raw: &str) -> String {
    let lowered = raw.trim().to_lowercase();
    if lowered.contains("main")
        || lowered.contains("protagonist")
        || lowered.contains("主角")
        || lowered.contains("主人公")
    {
        return "main".to_string();
    }
    if lowered.contains("antagonist")
        || lowered.contains("villain")
        || lowered.contains("反派")
        || lowered.contains("敌人")
    {
        return "antagonist".to_string();
    }
    "support".to_string()
}

fn extract_first_markdown_code_block(raw: &str) -> Option<String> {
    let start = raw.find("```")?;
    let remain = &raw[start + 3..];
    let content_start = remain.find('\n')?;
    let content = &remain[content_start + 1..];
    let end = content.find("```")?;
    Some(content[..end].trim().to_string())
}

fn extract_json_array_text(raw: &str) -> Option<String> {
    let mut depth = 0usize;
    let mut start_index: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;

    for (idx, ch) in raw.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '[' => {
                if depth == 0 {
                    start_index = Some(idx);
                }
                depth += 1;
            }
            ']' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(start) = start_index {
                        return Some(raw[start..idx + 1].to_string());
                    }
                }
            }
            _ => {}
        }
    }

    None
}

fn sanitize_fallback_name(line: &str) -> Option<String> {
    let mut normalized = line.trim();
    normalized = normalized
        .trim_start_matches('-')
        .trim_start_matches('*')
        .trim();
    if normalized.is_empty() {
        return None;
    }
    sanitize_candidate_name(normalized)
}

fn sanitize_candidate_name(raw: &str) -> Option<String> {
    let normalized = raw.trim().trim_matches('"').trim_end_matches(',').trim();
    if normalized.is_empty() {
        return None;
    }
    if looks_like_json_noise_line(normalized) {
        return None;
    }
    Some(normalized.to_string())
}

fn looks_like_json_noise_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if trimmed.starts_with("```")
        || trimmed.ends_with("```")
        || matches!(
            lowered.as_str(),
            "```" | "```json" | "```yaml" | "```yml" | "json" | "yaml" | "yml"
        )
    {
        return true;
    }
    if matches!(trimmed, "{" | "}" | "[" | "]" | ",") {
        return true;
    }
    if trimmed.starts_with("//") {
        return true;
    }
    if trimmed.contains("\":") || trimmed.ends_with(':') {
        return true;
    }
    false
}

fn split_title_and_content(raw: &str, chapter_no: i32) -> (String, String) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (format!("第{}章", chapter_no), String::new());
    }

    let mut lines = trimmed.lines();
    let first = lines.next().unwrap_or_default().trim();
    let normalized_title = first
        .trim_start_matches('#')
        .trim_start_matches('第')
        .trim()
        .to_string();

    let has_heading = first.starts_with('#') || first.starts_with("第");
    if has_heading && !normalized_title.is_empty() {
        let content = lines.collect::<Vec<_>>().join("\n").trim().to_string();
        let title = if first.starts_with('#') {
            first.trim_start_matches('#').trim().to_string()
        } else {
            first.to_string()
        };
        return (title, content);
    }

    (format!("第{}章", chapter_no), trimmed.to_string())
}

fn count_words(text: &str) -> i64 {
    let mut count = 0i64;
    let mut in_word = false;
    for c in text.chars() {
        if c.is_whitespace() {
            in_word = false;
        } else if c.is_ascii_alphanumeric() {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else if !c.is_ascii_punctuation() {
            count += 1;
            in_word = false;
        }
    }
    count
}

fn build_outline_prompt(settings: Option<&NovelSettingsEnvelope>) -> String {
    let settings_context = build_settings_context(settings);
    format!(
        "请根据以下小说设定生成结构化大纲，输出 Markdown。\n\n【设定】\n{}\n\n要求：\n1. 给出三幕式总结构。\n2. 拆分到至少 12 章。\n3. 每章包含目标、冲突、反转点。\n4. 保证人物弧线与世界规则一致。",
        settings_context
    )
}

fn build_characters_prompt(settings: Option<&NovelSettingsEnvelope>) -> String {
    let settings_context = build_settings_context(settings);
    format!(
        "请根据设定生成角色卡，输出 JSON 数组。\n\n每个元素至少包含：name、role_type、personality、background、motivation、relationship、arc、abilities。\n\n角色数量要求：\n1. 必须包含主角（role_type=main）。\n2. 包含 2-5 个关键配角（role_type=support）。\n3. 如有反派设定，至少包含 1 个 antagonist。\n\n【设定】\n{}",
        settings_context
    )
}

fn build_chapter_prompt(
    settings: Option<&NovelSettingsEnvelope>,
    outline: Option<&str>,
    characters: &[NovelCharacterRecord],
    chapters: &[NovelChapterRecord],
    chapter_no: i32,
) -> String {
    let settings_context = build_settings_context(settings);
    let recent_summary = summarize_recent_chapters(chapters, DEFAULT_RECENT_CHAPTERS);
    let target_words = extract_target_chapter_words(settings).unwrap_or(3000);
    let character_context = summarize_character_cards(characters);
    format!(
        "你正在创作长篇小说第 {chapter_no} 章。\n\n【创作设定】\n{settings}\n\n【大纲】\n{outline}\n\n【角色卡摘要】\n{characters}\n\n【前文摘要】\n{summary}\n\n写作要求：\n1. 严格遵守设定，不得破坏世界观规则。\n2. 重点推进当前章节冲突，并与前文连续。\n3. 章节目标字数约 {target_words} 字（允许小幅波动）。\n4. 第一行输出章节标题，后续输出正文，不要额外解释。",
        settings = settings_context,
        outline = outline.unwrap_or("暂无"),
        characters = character_context,
        summary = recent_summary
    )
}

fn build_continue_prompt(
    settings: Option<&NovelSettingsEnvelope>,
    outline: Option<&str>,
    characters: &[NovelCharacterRecord],
    chapters: &[NovelChapterRecord],
    chapter_no: i32,
) -> String {
    format!(
        "{}\n\n额外要求：保持与上一章情节连续，结尾留下钩子并引向下一章核心矛盾。",
        build_chapter_prompt(settings, outline, characters, chapters, chapter_no)
    )
}

fn build_rewrite_prompt(
    settings: Option<&NovelSettingsEnvelope>,
    source: &NovelChapterRecord,
    instructions: Option<&str>,
) -> String {
    let settings_context = build_settings_context(settings);
    format!(
        "请重写以下章节，保留核心剧情与关键信息点，但优化叙事节奏、人物一致性和可读性。\n\n【设定】\n{}\n\n【重写要求】\n{}\n\n【原章节标题】{}\n【原正文】\n{}\n\n输出要求：第一行标题，后续正文。",
        settings_context,
        instructions.unwrap_or("提升表现力，不改变关键事件。"),
        source.title,
        source.content
    )
}

fn build_polish_prompt(
    settings: Option<&NovelSettingsEnvelope>,
    source: &NovelChapterRecord,
    focus: Option<&str>,
) -> String {
    let settings_context = build_settings_context(settings);
    format!(
        "请润色以下章节，避免口水化和重复表达，修复语病，保持人物语气稳定。\n\n【设定】\n{}\n\n【润色重点】\n{}\n\n【章节标题】{}\n【正文】\n{}\n\n输出要求：第一行标题，后续正文。",
        settings_context,
        focus.unwrap_or("语言凝练、节奏顺滑、人物语气一致。"),
        source.title,
        source.content
    )
}

fn build_settings_context(settings: Option<&NovelSettingsEnvelope>) -> String {
    let Some(settings) = settings else {
        return "未提供创作设定。".to_string();
    };
    let s = &settings.data;
    let mut lines: Vec<String> = Vec::new();
    lines.push("你现在是一名经验丰富的中文网络小说作者，请严格按照以下设定创作：".to_string());
    lines.push(String::new());
    lines.push("【作品信息】".to_string());
    lines.push(format!(
        "题材：{}",
        if s.genres.is_empty() {
            "未指定".to_string()
        } else {
            s.genres.join("、")
        }
    ));
    lines.push(format!(
        "一句话简介：{}",
        if s.one_line_pitch.trim().is_empty() {
            "未填写".to_string()
        } else {
            s.one_line_pitch.clone()
        }
    ));
    lines.push(String::new());
    lines.push("【主角设定】".to_string());
    lines.push(format!(
        "姓名：{}，性别：{}，年龄：{}，性格：{}",
        value_or_placeholder(&s.main_character.name, "未命名"),
        value_or_placeholder(&s.main_character.gender, "未填写"),
        value_or_placeholder(&s.main_character.age, "未知"),
        value_or_placeholder(&s.main_character.personality, "未填写")
    ));
    lines.push(String::new());

    if !s.side_characters.is_empty() {
        lines.push("【配角设定】".to_string());
        for (idx, c) in s.side_characters.iter().enumerate() {
            lines.push(format_side_character_line(idx, c));
        }
        lines.push(String::new());
    }

    if !s.antagonists.is_empty() {
        lines.push("【反派 / 敌人】".to_string());
        for (idx, c) in s.antagonists.iter().enumerate() {
            lines.push(format_antagonist_line(idx, c));
        }
        lines.push(String::new());
    }

    lines.push("【世界观与规则】".to_string());
    lines.push(format!(
        "整体背景：{}",
        value_or_placeholder(&s.world_summary, "未填写")
    ));
    lines.push(format!(
        "核心冲突 / 主题：{}",
        value_or_placeholder(&s.conflict_theme, "未填写")
    ));
    lines.push(format!(
        "力量 / 科技 / 修炼体系：{}",
        value_or_placeholder(&s.world_details.power_system, "未填写")
    ));
    lines.push(format!(
        "社会结构与势力：{}",
        value_or_placeholder(&s.world_details.factions, "未填写")
    ));
    lines.push(format!(
        "历史重大事件：{}",
        value_or_placeholder(&s.world_details.history_events, "未填写")
    ));
    lines.push(format!(
        "重要地点：{}",
        value_or_placeholder(&s.world_details.important_locations, "未填写")
    ));
    lines.push(format!(
        "文化习俗与禁忌：{}",
        value_or_placeholder(&s.world_details.culture_and_taboos, "未填写")
    ));
    lines.push(String::new());

    lines.push("【情节大纲】".to_string());
    lines.push(format!(
        "开头（前 30%）：{}",
        value_or_placeholder(&s.opening, "未填写")
    ));
    if !s.middle_beats.is_empty() {
        lines.push("中段高潮与关键转折：".to_string());
        for (idx, beat) in s.middle_beats.iter().enumerate() {
            lines.push(format!(
                "{}. {}：{}",
                idx + 1,
                value_or_placeholder(&beat.title, "未命名节点"),
                value_or_placeholder(&beat.detail, "未填写")
            ));
        }
    }
    if !s.subplots.is_empty() {
        lines.push("主要副线：".to_string());
        for (idx, beat) in s.subplots.iter().enumerate() {
            lines.push(format!(
                "{}. {}：{}",
                idx + 1,
                value_or_placeholder(&beat.title, "未命名副线"),
                value_or_placeholder(&beat.detail, "未填写")
            ));
        }
    }
    lines.push(format!(
        "结局类型：{}",
        value_or_placeholder(&s.ending_type, "未指定")
    ));
    lines.push(String::new());

    lines.push("【写作风格与重点】".to_string());
    lines.push(format!(
        "叙述视角：{}",
        value_or_placeholder(&s.writing_style.narration, "第三人称有限")
    ));
    lines.push(format!(
        "整体语气：{}",
        if s.writing_style.tones.is_empty() {
            "未指定".to_string()
        } else {
            s.writing_style.tones.join("、")
        }
    ));
    lines.push(format!(
        "金手指程度：{}",
        value_or_placeholder(&s.writing_style.cheat_level, "稳步成长")
    ));
    lines.push(format!(
        "重点描写内容：{}",
        if s.writing_style.focus_areas.is_empty() {
            "未指定".to_string()
        } else {
            s.writing_style.focus_areas.join("、")
        }
    ));
    lines.push(format!(
        "建议篇幅：全书约 {} 字，每章约 {} 字，temperature≈{:.2}",
        s.total_words, s.writing_style.words_per_chapter, s.writing_style.temperature
    ));
    if s.nsfw {
        lines.push("允许适度 NSFW 内容。".to_string());
    }
    if s.system_novel {
        lines.push("这是系统文，主角拥有类似面板/系统等金手指。".to_string());
    }
    if s.harem {
        lines.push("允许存在后宫元素。".to_string());
    }
    lines.push(String::new());

    if !s.taboos.is_empty() {
        lines.push("【写作禁忌】".to_string());
        for (idx, taboo) in s.taboos.iter().enumerate() {
            if !taboo.content.trim().is_empty() {
                lines.push(format!("{}. {}", idx + 1, taboo.content.trim()));
            }
        }
        lines.push(String::new());
    }

    if !s.references.is_empty() {
        lines.push("【参考作品与借鉴点】".to_string());
        for (idx, reference) in s.references.iter().enumerate() {
            lines.push(format!(
                "{}. 《{}》：{}",
                idx + 1,
                value_or_placeholder(&reference.title, "未命名"),
                value_or_placeholder(&reference.inspiration, "未填写借鉴点")
            ));
        }
        lines.push(String::new());
    }

    lines.push(
        "请在创作过程中严格遵守以上所有设定，保证人物行为、世界观规则和情节发展前后一致。"
            .to_string(),
    );
    lines.join("\n")
}

fn format_side_character_line(index: usize, character: &SideCharacter) -> String {
    let relation = if character.relationship_custom.trim().is_empty() {
        value_or_placeholder(&character.relationship, "未填写关系")
    } else {
        character.relationship_custom.trim()
    };
    let tags = if character.personality_tags.is_empty() {
        "未填写性格".to_string()
    } else {
        character.personality_tags.join("、")
    };
    let arc = if character.arc_custom.trim().is_empty() {
        value_or_placeholder(&character.arc, "未填写")
    } else {
        character.arc_custom.trim()
    };

    format!(
        "{}. {}（{}）：性格【{}】，背景【{}】，能力/弱点【{}】，故事作用【{}】，人物弧光【{}】",
        index + 1,
        value_or_placeholder(&character.name, "未命名"),
        relation,
        tags,
        value_or_placeholder(&character.background, "未填写"),
        value_or_placeholder(&character.abilities, "未填写"),
        value_or_placeholder(&character.role, "未填写"),
        arc
    )
}

fn format_antagonist_line(index: usize, character: &Antagonist) -> String {
    let relation = if character.relationship_custom.trim().is_empty() {
        value_or_placeholder(&character.relationship, "未填写关系")
    } else {
        character.relationship_custom.trim()
    };
    let tags = if character.personality_tags.is_empty() {
        "未填写性格".to_string()
    } else {
        character.personality_tags.join("、")
    };
    let arc = if character.arc_custom.trim().is_empty() {
        value_or_placeholder(&character.arc, "未填写")
    } else {
        character.arc_custom.trim()
    };

    format!(
        "{}. {}（{}）：性格【{}】，背景【{}】，能力/弱点【{}】，动机【{}】，最终下场【{}】，人物弧光【{}】",
        index + 1,
        value_or_placeholder(&character.name, "未命名"),
        relation,
        tags,
        value_or_placeholder(&character.background, "未填写"),
        value_or_placeholder(&character.abilities, "未填写"),
        value_or_placeholder(&character.motive, "未填写"),
        value_or_placeholder(&character.fate, "未填写"),
        arc
    )
}

fn value_or_placeholder<'a>(value: &'a str, placeholder: &'a str) -> &'a str {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        placeholder
    } else {
        trimmed
    }
}

fn summarize_character_cards(characters: &[NovelCharacterRecord]) -> String {
    if characters.is_empty() {
        return "暂无角色卡".to_string();
    }
    characters
        .iter()
        .enumerate()
        .map(|(idx, c)| {
            let personality = c
                .card_json
                .get("personality")
                .and_then(Value::as_str)
                .unwrap_or("未填写");
            let background = c
                .card_json
                .get("background")
                .and_then(Value::as_str)
                .unwrap_or("未填写");
            format!(
                "{}. {}（{}）：性格={}，背景={}",
                idx + 1,
                c.name,
                c.role_type,
                personality,
                background
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn summarize_recent_chapters(chapters: &[NovelChapterRecord], limit: usize) -> String {
    if chapters.is_empty() {
        return "暂无前文".to_string();
    }
    chapters
        .iter()
        .rev()
        .take(limit)
        .map(|c| {
            let excerpt: String = c.content.chars().take(220).collect();
            format!("第{}章 {}：{}", c.chapter_no, c.title, excerpt)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn evaluate_consistency(
    chapter: &NovelChapterRecord,
    settings: Option<&NovelSettingsRecord>,
    characters: &[NovelCharacterRecord],
) -> Vec<NovelConsistencyIssue> {
    let mut issues = Vec::new();
    let content = chapter.content.trim();
    let char_len = content.chars().count();

    if char_len < 500 {
        issues.push(NovelConsistencyIssue {
            level: "warn".to_string(),
            code: "chapter_too_short".to_string(),
            message: "章节长度偏短，建议扩展冲突与场景细节".to_string(),
            details: Some(json!({ "current": char_len, "min": 500 })),
        });
    }

    if let Some(target) = extract_target_chapter_words(settings.map(|s| &s.settings_json)) {
        let lower = (target as f64 * 0.6).round() as usize;
        let upper = (target as f64 * 1.4).round() as usize;
        if char_len < lower || char_len > upper {
            issues.push(NovelConsistencyIssue {
                level: "info".to_string(),
                code: "chapter_word_target_deviation".to_string(),
                message: "章节字数偏离目标区间".to_string(),
                details: Some(json!({
                    "target": target,
                    "current": char_len,
                    "range": { "min": lower, "max": upper }
                })),
            });
        }
    }

    let taboo_words = extract_taboos(settings.map(|s| &s.settings_json));
    for taboo in taboo_words {
        if content.contains(&taboo) {
            issues.push(NovelConsistencyIssue {
                level: "error".to_string(),
                code: "taboo_violation".to_string(),
                message: format!("命中禁忌词: {}", taboo),
                details: None,
            });
        }
    }

    let mut main_names: Vec<String> = characters
        .iter()
        .filter(|c| c.role_type == "main")
        .map(|c| c.name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    if main_names.is_empty() {
        if let Some(settings) = settings {
            let fallback_name = settings.settings_json.data.main_character.name.trim();
            if !fallback_name.is_empty() {
                main_names.push(fallback_name.to_string());
            }
        }
    }

    if !main_names.is_empty() {
        let mentioned = main_names.iter().any(|name| content.contains(name));
        if !mentioned {
            issues.push(NovelConsistencyIssue {
                level: "warn".to_string(),
                code: "main_character_missing".to_string(),
                message: "本章未出现主要角色姓名，可能存在叙事脱节".to_string(),
                details: Some(json!({ "mainCharacters": main_names })),
            });
        }
    }

    issues
}

fn calculate_score(issues: &[NovelConsistencyIssue]) -> f64 {
    let mut score = 100.0f64;
    for issue in issues {
        match issue.level.as_str() {
            "error" => score -= 25.0,
            "warn" => score -= 12.0,
            "info" => score -= 5.0,
            _ => score -= 3.0,
        }
    }
    score.clamp(0.0, 100.0)
}

fn extract_target_chapter_words(settings: Option<&NovelSettingsEnvelope>) -> Option<usize> {
    let settings = settings?;
    let chapter_words = settings.data.chapter_words.max(0) as usize;
    if chapter_words > 0 {
        return Some(chapter_words);
    }
    let words_per_chapter = settings.data.writing_style.words_per_chapter.max(0) as usize;
    if words_per_chapter > 0 {
        return Some(words_per_chapter);
    }
    None
}

fn extract_taboos(settings: Option<&NovelSettingsEnvelope>) -> Vec<String> {
    let Some(settings) = settings else {
        return Vec::new();
    };
    settings
        .data
        .taboos
        .iter()
        .map(|taboo| taboo.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .collect()
}

fn normalize_settings_envelope_from_value(value: Value) -> NovelSettingsEnvelope {
    if let Some(obj) = value.as_object() {
        if let Some(data_value) = obj.get("data") {
            let schema_version =
                value_as_i32(obj.get("schema_version"), NOVEL_SETTINGS_SCHEMA_VERSION);
            return NovelSettingsEnvelope {
                schema_version,
                data: normalize_novel_settings_v1(data_value),
            };
        }
    }

    NovelSettingsEnvelope {
        schema_version: NOVEL_SETTINGS_SCHEMA_VERSION,
        data: normalize_novel_settings_v1(&value),
    }
}

fn normalize_novel_settings_v1(value: &Value) -> NovelSettingsV1 {
    let mut normalized = NovelSettingsV1::default();
    let Some(obj) = value.as_object() else {
        return normalized;
    };

    normalized.genres = value_as_string_array(obj.get("genres"));
    normalized.one_line_pitch =
        value_as_string(obj.get("oneLinePitch"), &normalized.one_line_pitch);
    normalized.main_character = normalize_main_character(obj.get("mainCharacter"));
    normalized.side_characters = value_as_array(obj.get("sideCharacters"))
        .iter()
        .map(|item| normalize_side_character(item))
        .collect();
    normalized.antagonists = value_as_array(obj.get("antagonists"))
        .iter()
        .map(|item| normalize_antagonist(item))
        .collect();
    normalized.world_summary = value_as_string(obj.get("worldSummary"), &normalized.world_summary);
    normalized.conflict_theme =
        value_as_string(obj.get("conflictTheme"), &normalized.conflict_theme);
    normalized.world_details = normalize_world_details(obj.get("worldDetails"));
    normalized.opening = value_as_string(obj.get("opening"), &normalized.opening);
    normalized.middle_beats = value_as_array(obj.get("middleBeats"))
        .iter()
        .map(|item| normalize_plot_beat(item))
        .collect();
    normalized.ending_type = value_as_string(obj.get("endingType"), &normalized.ending_type);
    normalized.subplots = value_as_array(obj.get("subplots"))
        .iter()
        .map(|item| normalize_plot_beat(item))
        .collect();
    normalized.writing_style = normalize_writing_style(obj.get("writingStyle"));
    normalized.total_words = value_as_i64(obj.get("totalWords"), normalized.total_words);
    normalized.chapter_words = value_as_i64(obj.get("chapterWords"), normalized.chapter_words);
    normalized.nsfw = value_as_bool(obj.get("nsfw"), normalized.nsfw);
    normalized.system_novel = value_as_bool(obj.get("systemNovel"), normalized.system_novel);
    normalized.harem = value_as_bool(obj.get("harem"), normalized.harem);
    normalized.taboos = value_as_array(obj.get("taboos"))
        .iter()
        .map(|item| normalize_taboo(item))
        .filter(|item| !item.content.trim().is_empty())
        .collect();
    normalized.references = value_as_array(obj.get("references"))
        .iter()
        .map(|item| normalize_reference(item))
        .filter(|item| !item.title.trim().is_empty() || !item.inspiration.trim().is_empty())
        .collect();

    if normalized.writing_style.words_per_chapter <= 0 {
        normalized.writing_style.words_per_chapter = 3000;
    }
    if normalized.chapter_words <= 0 {
        normalized.chapter_words = normalized.writing_style.words_per_chapter;
    }
    if normalized.total_words <= 0 {
        normalized.total_words = 100_000;
    }

    normalized
}

fn normalize_main_character(value: Option<&Value>) -> MainCharacter {
    let mut normalized = MainCharacter::default();
    let Some(obj) = value.and_then(Value::as_object) else {
        return normalized;
    };
    normalized.name = value_as_string(obj.get("name"), &normalized.name);
    normalized.gender = value_as_string(obj.get("gender"), &normalized.gender);
    normalized.age = value_as_string(obj.get("age"), &normalized.age);
    normalized.personality = value_as_string(obj.get("personality"), &normalized.personality);
    normalized
}

fn normalize_side_character(value: &Value) -> SideCharacter {
    let mut normalized = SideCharacter::default();
    let Some(obj) = value.as_object() else {
        return normalized;
    };
    normalized.id = value_as_string(obj.get("id"), &normalized.id);
    normalized.name = value_as_string(obj.get("name"), &normalized.name);
    normalized.nickname = value_as_string(obj.get("nickname"), &normalized.nickname);
    normalized.gender = value_as_string(obj.get("gender"), &normalized.gender);
    normalized.age = value_as_string(obj.get("age"), &normalized.age);
    normalized.relationship = value_as_string(obj.get("relationship"), &normalized.relationship);
    normalized.relationship_custom = value_as_string(
        obj.get("relationshipCustom"),
        &normalized.relationship_custom,
    );
    normalized.personality_tags = value_as_string_array(obj.get("personalityTags"));
    normalized.background = value_as_string(obj.get("background"), &normalized.background);
    normalized.abilities = value_as_string(obj.get("abilities"), &normalized.abilities);
    normalized.role = value_as_string(obj.get("role"), &normalized.role);
    normalized.arc = value_as_string(obj.get("arc"), &normalized.arc);
    normalized.arc_custom = value_as_string(obj.get("arcCustom"), &normalized.arc_custom);
    normalized
}

fn normalize_antagonist(value: &Value) -> Antagonist {
    let mut normalized = Antagonist::default();
    let Some(obj) = value.as_object() else {
        return normalized;
    };
    normalized.id = value_as_string(obj.get("id"), &normalized.id);
    normalized.name = value_as_string(obj.get("name"), &normalized.name);
    normalized.nickname = value_as_string(obj.get("nickname"), &normalized.nickname);
    normalized.gender = value_as_string(obj.get("gender"), &normalized.gender);
    normalized.age = value_as_string(obj.get("age"), &normalized.age);
    normalized.relationship = value_as_string(obj.get("relationship"), &normalized.relationship);
    normalized.relationship_custom = value_as_string(
        obj.get("relationshipCustom"),
        &normalized.relationship_custom,
    );
    normalized.personality_tags = value_as_string_array(obj.get("personalityTags"));
    normalized.background = value_as_string(obj.get("background"), &normalized.background);
    normalized.abilities = value_as_string(obj.get("abilities"), &normalized.abilities);
    normalized.role = value_as_string(obj.get("role"), &normalized.role);
    normalized.arc = value_as_string(obj.get("arc"), &normalized.arc);
    normalized.arc_custom = value_as_string(obj.get("arcCustom"), &normalized.arc_custom);
    normalized.motive = value_as_string(obj.get("motive"), &normalized.motive);
    normalized.fate = value_as_string(obj.get("fate"), &normalized.fate);
    normalized
}

fn normalize_world_details(value: Option<&Value>) -> WorldDetails {
    let mut normalized = WorldDetails::default();
    let Some(obj) = value.and_then(Value::as_object) else {
        return normalized;
    };
    normalized.power_system = value_as_string(obj.get("powerSystem"), &normalized.power_system);
    normalized.factions = value_as_string(obj.get("factions"), &normalized.factions);
    normalized.history_events =
        value_as_string(obj.get("historyEvents"), &normalized.history_events);
    normalized.important_locations = value_as_string(
        obj.get("importantLocations"),
        &normalized.important_locations,
    );
    normalized.culture_and_taboos =
        value_as_string(obj.get("cultureAndTaboos"), &normalized.culture_and_taboos);
    normalized
}

fn normalize_plot_beat(value: &Value) -> PlotBeat {
    let base = PlotBeat {
        id: Uuid::new_v4().to_string(),
        title: String::new(),
        detail: String::new(),
    };
    let Some(obj) = value.as_object() else {
        return base;
    };
    PlotBeat {
        id: value_as_string(obj.get("id"), &base.id),
        title: value_as_string(obj.get("title"), &base.title),
        detail: value_as_string(obj.get("detail"), &base.detail),
    }
}

fn normalize_writing_style(value: Option<&Value>) -> WritingStyle {
    let mut normalized = WritingStyle::default();
    let Some(obj) = value.and_then(Value::as_object) else {
        return normalized;
    };
    normalized.narration = value_as_string(obj.get("narration"), &normalized.narration);
    normalized.tones = value_as_string_array(obj.get("tones"));
    normalized.cheat_level = value_as_string(obj.get("cheatLevel"), &normalized.cheat_level);
    normalized.focus_areas = value_as_string_array(obj.get("focusAreas"));
    normalized.words_per_chapter =
        value_as_i64(obj.get("wordsPerChapter"), normalized.words_per_chapter);
    normalized.temperature = value_as_f64(obj.get("temperature"), normalized.temperature);
    normalized
}

fn normalize_taboo(value: &Value) -> TabooRule {
    if let Some(content) = value.as_str() {
        return TabooRule {
            id: Uuid::new_v4().to_string(),
            content: content.to_string(),
        };
    }
    let base = TabooRule {
        id: Uuid::new_v4().to_string(),
        content: String::new(),
    };
    let Some(obj) = value.as_object() else {
        return base;
    };
    TabooRule {
        id: value_as_string(obj.get("id"), &base.id),
        content: value_as_string(obj.get("content"), &base.content),
    }
}

fn normalize_reference(value: &Value) -> ReferenceWork {
    let base = ReferenceWork {
        id: Uuid::new_v4().to_string(),
        title: String::new(),
        inspiration: String::new(),
    };
    let Some(obj) = value.as_object() else {
        return base;
    };
    ReferenceWork {
        id: value_as_string(obj.get("id"), &base.id),
        title: value_as_string(obj.get("title"), &base.title),
        inspiration: value_as_string(obj.get("inspiration"), &base.inspiration),
    }
}

fn value_as_array(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

fn value_as_string(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .map(|v| v.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

fn value_as_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn value_as_bool(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}

fn value_as_i64(value: Option<&Value>, fallback: i64) -> i64 {
    let Some(value) = value else {
        return fallback;
    };
    value
        .as_i64()
        .or_else(|| value.as_u64().map(|v| v as i64))
        .or_else(|| value.as_f64().map(|v| v.round() as i64))
        .unwrap_or(fallback)
}

fn value_as_i32(value: Option<&Value>, fallback: i32) -> i32 {
    value_as_i64(value, fallback as i64) as i32
}

fn value_as_f64(value: Option<&Value>, fallback: f64) -> f64 {
    let Some(value) = value else {
        return fallback;
    };
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_u64().map(|v| v as f64))
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_character_cards_should_support_markdown_json_block() {
        let raw = r#"
这里是角色卡：
```json
[
  {
    "name": "顾清",
    "role_type": "main",
    "relationship": "主角"
  },
  {
    "name": "宿敌",
    "role_type": "antagonist"
  }
]
```
"#;

        let cards = parse_character_cards(raw);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["name"], Value::String("顾清".to_string()));
        assert_eq!(cards[0]["role_type"], Value::String("main".to_string()));
        assert_eq!(
            cards[1]["role_type"],
            Value::String("antagonist".to_string())
        );
    }

    #[test]
    fn parse_character_cards_should_filter_json_noise_in_fallback_lines() {
        let raw = r#"
{
  "relationship": "上司",
  "arc": "成长",
  "abilities": "强大的调查能力",
}
"#;

        let cards = parse_character_cards(raw);
        assert!(cards.is_empty());
    }

    #[test]
    fn parse_character_cards_should_ignore_markdown_fence_noise_in_fallback_lines() {
        let raw = r#"
```json
林舟
```
"#;

        let cards = parse_character_cards(raw);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0]["name"], Value::String("林舟".to_string()));
    }
}
