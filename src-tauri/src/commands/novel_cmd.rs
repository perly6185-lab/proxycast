//! 小说创作命令
//!
//! 兼容层：对外保持 tauri command 名称不变，内部转发到主题模块实现。

use crate::database::DbConnection;
use crate::services::novel_service::{
    NovelCheckConsistencyRequest, NovelCreateProjectRequest, NovelDeleteCharacterRequest,
    NovelGenerateChapterRequest, NovelGenerateRequest, NovelGenerateResult, NovelGenerationRun,
    NovelListRunsRequest, NovelPolishChapterRequest, NovelProject, NovelProjectSnapshot,
    NovelRewriteChapterRequest, NovelSettingsRecord, NovelUpdateSettingsRequest,
};
use tauri::State;

/// 创建小说项目
#[tauri::command]
pub async fn novel_create_project(
    db: State<'_, DbConnection>,
    request: NovelCreateProjectRequest,
) -> Result<NovelProject, String> {
    crate::theme::novel::command::novel_create_project(db, request).await
}

/// 更新小说设定（自动版本递增）
#[tauri::command]
pub async fn novel_update_settings(
    db: State<'_, DbConnection>,
    request: NovelUpdateSettingsRequest,
) -> Result<NovelSettingsRecord, String> {
    crate::theme::novel::command::novel_update_settings(db, request).await
}

/// 生成小说大纲
#[tauri::command]
pub async fn novel_generate_outline(
    db: State<'_, DbConnection>,
    request: NovelGenerateRequest,
) -> Result<NovelGenerateResult, String> {
    crate::theme::novel::command::novel_generate_outline(db, request).await
}

/// 生成角色卡
#[tauri::command]
pub async fn novel_generate_characters(
    db: State<'_, DbConnection>,
    request: NovelGenerateRequest,
) -> Result<NovelGenerateResult, String> {
    crate::theme::novel::command::novel_generate_characters(db, request).await
}

/// 生成章节
#[tauri::command]
pub async fn novel_generate_chapter(
    db: State<'_, DbConnection>,
    request: NovelGenerateChapterRequest,
) -> Result<NovelGenerateResult, String> {
    crate::theme::novel::command::novel_generate_chapter(db, request).await
}

/// 续写下一章
#[tauri::command]
pub async fn novel_continue_chapter(
    db: State<'_, DbConnection>,
    request: NovelGenerateRequest,
) -> Result<NovelGenerateResult, String> {
    crate::theme::novel::command::novel_continue_chapter(db, request).await
}

/// 重写章节
#[tauri::command]
pub async fn novel_rewrite_chapter(
    db: State<'_, DbConnection>,
    request: NovelRewriteChapterRequest,
) -> Result<NovelGenerateResult, String> {
    crate::theme::novel::command::novel_rewrite_chapter(db, request).await
}

/// 润色章节
#[tauri::command]
pub async fn novel_polish_chapter(
    db: State<'_, DbConnection>,
    request: NovelPolishChapterRequest,
) -> Result<NovelGenerateResult, String> {
    crate::theme::novel::command::novel_polish_chapter(db, request).await
}

/// 章节一致性检查
#[tauri::command]
pub async fn novel_check_consistency(
    db: State<'_, DbConnection>,
    request: NovelCheckConsistencyRequest,
) -> Result<crate::services::novel_service::NovelConsistencyCheck, String> {
    crate::theme::novel::command::novel_check_consistency(db, request).await
}

/// 获取项目完整快照
#[tauri::command]
pub async fn novel_get_project_snapshot(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<NovelProjectSnapshot, String> {
    crate::theme::novel::command::novel_get_project_snapshot(db, project_id).await
}

/// 获取生成运行记录
#[tauri::command]
pub async fn novel_list_runs(
    db: State<'_, DbConnection>,
    request: NovelListRunsRequest,
) -> Result<Vec<NovelGenerationRun>, String> {
    crate::theme::novel::command::novel_list_runs(db, request).await
}

/// 删除单个角色
#[tauri::command]
pub async fn novel_delete_character(
    db: State<'_, DbConnection>,
    request: NovelDeleteCharacterRequest,
) -> Result<bool, String> {
    crate::theme::novel::command::novel_delete_character(db, request).await
}
