use crate::database::DbConnection;
use crate::models::prompt_model::Prompt;
use proxycast_services::prompt_service::PromptService;
use std::collections::HashMap;
use tauri::State;

/// Get all prompts for an app type (as HashMap for frontend)
#[tauri::command]
pub fn get_prompts(
    db: State<'_, DbConnection>,
    app: String,
) -> Result<HashMap<String, Prompt>, String> {
    PromptService::get_all_map(&db, &app)
}

/// Upsert a prompt (insert or update)
#[tauri::command]
pub fn upsert_prompt(
    db: State<'_, DbConnection>,
    app: String,
    id: String,
    prompt: Prompt,
) -> Result<(), String> {
    // Ensure the prompt has the correct app_type and id
    let mut prompt = prompt;
    prompt.app_type = app.clone();
    prompt.id = id;
    PromptService::upsert(&db, &app, prompt)
}

/// Add a new prompt
#[tauri::command]
pub fn add_prompt(db: State<'_, DbConnection>, prompt: Prompt) -> Result<(), String> {
    PromptService::add(&db, prompt)
}

/// Update an existing prompt
#[tauri::command]
pub fn update_prompt(db: State<'_, DbConnection>, prompt: Prompt) -> Result<(), String> {
    PromptService::update(&db, prompt)
}

/// Delete a prompt
#[tauri::command]
pub fn delete_prompt(db: State<'_, DbConnection>, app: String, id: String) -> Result<(), String> {
    PromptService::delete(&db, &app, &id)
}

/// Enable a prompt and sync to live file
#[tauri::command]
pub fn enable_prompt(db: State<'_, DbConnection>, app: String, id: String) -> Result<(), String> {
    PromptService::enable(&db, &app, &id)
}

/// Import prompt from live file
#[tauri::command]
pub fn import_prompt_from_file(db: State<'_, DbConnection>, app: String) -> Result<String, String> {
    PromptService::import_from_file(&db, &app)
}

/// Get current live prompt file content
#[tauri::command]
pub fn get_current_prompt_file_content(app: String) -> Result<Option<String>, String> {
    PromptService::get_live_content(&app)
}

/// Auto-import prompt from live file on first launch (if no prompts exist)
#[tauri::command]
pub fn auto_import_prompt(db: State<'_, DbConnection>, app: String) -> Result<usize, String> {
    PromptService::import_on_first_launch(&db, &app)
}
