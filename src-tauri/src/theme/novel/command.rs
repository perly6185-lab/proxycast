//! 小说主题命令适配层
//!
//! 提供 novel tauri commands 的主题化实现入口。

use crate::database::DbConnection;
use crate::services::novel_service::{
    NovelCheckConsistencyRequest, NovelCreateProjectRequest, NovelDeleteCharacterRequest,
    NovelGenerateChapterRequest, NovelGenerateRequest, NovelGenerateResult, NovelGenerationRun,
    NovelListRunsRequest, NovelPolishChapterRequest, NovelProject, NovelProjectSnapshot,
    NovelRewriteChapterRequest, NovelSettingsRecord, NovelUpdateSettingsRequest,
};
use tauri::State;

fn service(db: &State<'_, DbConnection>) -> crate::services::novel_service::NovelService {
    crate::services::novel_service::NovelService::new(db.inner().clone())
}

pub async fn novel_create_project(
    db: State<'_, DbConnection>,
    request: NovelCreateProjectRequest,
) -> Result<NovelProject, String> {
    service(&db).create_project(request)
}

pub async fn novel_update_settings(
    db: State<'_, DbConnection>,
    request: NovelUpdateSettingsRequest,
) -> Result<NovelSettingsRecord, String> {
    service(&db).update_settings(request)
}

pub async fn novel_generate_outline(
    db: State<'_, DbConnection>,
    request: NovelGenerateRequest,
) -> Result<NovelGenerateResult, String> {
    service(&db).generate_outline(request).await
}

pub async fn novel_generate_characters(
    db: State<'_, DbConnection>,
    request: NovelGenerateRequest,
) -> Result<NovelGenerateResult, String> {
    service(&db).generate_characters(request).await
}

pub async fn novel_generate_chapter(
    db: State<'_, DbConnection>,
    request: NovelGenerateChapterRequest,
) -> Result<NovelGenerateResult, String> {
    service(&db).generate_chapter(request).await
}

pub async fn novel_continue_chapter(
    db: State<'_, DbConnection>,
    request: NovelGenerateRequest,
) -> Result<NovelGenerateResult, String> {
    service(&db).continue_chapter(request).await
}

pub async fn novel_rewrite_chapter(
    db: State<'_, DbConnection>,
    request: NovelRewriteChapterRequest,
) -> Result<NovelGenerateResult, String> {
    service(&db).rewrite_chapter(request).await
}

pub async fn novel_polish_chapter(
    db: State<'_, DbConnection>,
    request: NovelPolishChapterRequest,
) -> Result<NovelGenerateResult, String> {
    service(&db).polish_chapter(request).await
}

pub async fn novel_check_consistency(
    db: State<'_, DbConnection>,
    request: NovelCheckConsistencyRequest,
) -> Result<crate::services::novel_service::NovelConsistencyCheck, String> {
    service(&db).check_consistency(request)
}

pub async fn novel_get_project_snapshot(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<NovelProjectSnapshot, String> {
    service(&db).get_project_snapshot(&project_id)
}

pub async fn novel_list_runs(
    db: State<'_, DbConnection>,
    request: NovelListRunsRequest,
) -> Result<Vec<NovelGenerationRun>, String> {
    service(&db).list_runs(request)
}

pub async fn novel_delete_character(
    db: State<'_, DbConnection>,
    request: NovelDeleteCharacterRequest,
) -> Result<bool, String> {
    service(&db).delete_character(request)
}
