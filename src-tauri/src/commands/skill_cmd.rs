use crate::agent::aster_state::AsterAgentState;
use crate::database::dao::skills::SkillDao;
use crate::database::DbConnection;
use crate::models::app_type::AppType;
use crate::models::skill_model::{
    Skill, SkillCatalogSource, SkillPackageInspection, SkillRepo, SkillState,
};
use chrono::Utc;
use proxycast_core::app_paths;
use proxycast_services::skill_service::SkillService;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::State;

/// 从指定目录扫描已安装的 Skills
///
/// 扫描给定目录，返回包含 SKILL.md 的子目录名列表。
/// 这是一个可测试的内部函数。
///
/// # Arguments
/// - `skills_dir`: Skills 目录路径
///
/// # Returns
/// - `Vec<String>`: 已安装的 Skill 目录名列表
pub fn scan_installed_skills(skills_dir: &Path) -> Vec<String> {
    if !skills_dir.exists() {
        return vec![];
    }

    let mut skills = Vec::new();

    if let Ok(entries) = std::fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let skill_md = entry.path().join("SKILL.md");
                if skill_md.exists() {
                    if let Some(name) = entry.file_name().to_str() {
                        skills.push(name.to_string());
                    }
                }
            }
        }
    }

    skills
}

fn get_skills_dir(app_type: &AppType) -> Result<PathBuf, String> {
    match app_type {
        AppType::ProxyCast => app_paths::resolve_skills_dir(),
        AppType::Claude => dirs::home_dir()
            .ok_or_else(|| "Failed to get home directory".to_string())
            .map(|home| home.join(".claude").join("skills")),
        AppType::Codex => dirs::home_dir()
            .ok_or_else(|| "Failed to get home directory".to_string())
            .map(|home| home.join(".codex").join("skills")),
        AppType::Gemini => dirs::home_dir()
            .ok_or_else(|| "Failed to get home directory".to_string())
            .map(|home| home.join(".gemini").join("skills")),
    }
}

fn get_skill_lookup_roots(app_type: &AppType) -> Result<Vec<PathBuf>, String> {
    match app_type {
        AppType::ProxyCast => app_paths::resolve_proxycast_skill_roots(),
        _ => Ok(vec![get_skills_dir(app_type)?]),
    }
}

fn validate_skill_directory(directory: &str) -> Result<(), String> {
    if directory.trim().is_empty() {
        return Err("Skill directory is required".to_string());
    }

    if directory.contains("..") || directory.contains('/') || directory.contains('\\') {
        return Err("Invalid skill directory".to_string());
    }

    let mut components = Path::new(directory).components();
    let first = components
        .next()
        .ok_or_else(|| "Skill directory is required".to_string())?;

    if components.next().is_some() {
        return Err("Invalid skill directory".to_string());
    }

    match first {
        Component::Normal(_) => Ok(()),
        _ => Err("Invalid skill directory".to_string()),
    }
}

fn try_resolve_local_skill_dir(
    skills_dir: &Path,
    directory: &str,
) -> Result<Option<PathBuf>, String> {
    validate_skill_directory(directory)?;

    if !skills_dir.exists() {
        return Ok(None);
    }

    let canonical_skills_dir = skills_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve skills directory: {e}"))?;

    let skill_dir = skills_dir.join(directory);
    if !skill_dir.exists() {
        return Ok(None);
    }

    let canonical_skill_dir = skill_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve skill directory: {e}"))?;

    if !canonical_skill_dir.starts_with(&canonical_skills_dir) {
        return Err("Invalid skill directory path".to_string());
    }

    let skill_md_path = canonical_skill_dir.join("SKILL.md");
    if !skill_md_path.is_file() {
        return Ok(None);
    }

    Ok(Some(canonical_skill_dir))
}

fn resolve_local_skill_dir(skill_roots: &[PathBuf], directory: &str) -> Result<PathBuf, String> {
    validate_skill_directory(directory)?;

    for root in skill_roots {
        if let Some(skill_dir) = try_resolve_local_skill_dir(root, directory)? {
            return Ok(skill_dir);
        }
    }

    Err(format!("Skill not found: {directory}"))
}

fn inspect_local_skill(
    skill_roots: &[PathBuf],
    directory: &str,
) -> Result<SkillPackageInspection, String> {
    let skill_dir = resolve_local_skill_dir(skill_roots, directory)?;
    SkillService::inspect_skill_dir(&skill_dir).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkillScaffoldTarget {
    Project,
    User,
}

impl SkillScaffoldTarget {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "project" => Ok(Self::Project),
            "user" => Ok(Self::User),
            _ => Err(format!("Unsupported scaffold target: {value}")),
        }
    }
}

#[derive(Serialize)]
struct SkillScaffoldFrontmatter<'a> {
    name: &'a str,
    description: &'a str,
}

fn resolve_skill_scaffold_root(
    app_type: &AppType,
    target: SkillScaffoldTarget,
) -> Result<PathBuf, String> {
    match target {
        SkillScaffoldTarget::User => get_skills_dir(app_type),
        SkillScaffoldTarget::Project => match app_type {
            AppType::ProxyCast => app_paths::resolve_project_skills_dir()
                .ok_or_else(|| "Failed to resolve project skills directory".to_string()),
            _ => Err("Project skill scaffold is only supported for proxycast".to_string()),
        },
    }
}

fn build_skill_scaffold_content(name: &str, description: &str) -> Result<String, String> {
    let frontmatter = serde_yaml::to_string(&SkillScaffoldFrontmatter { name, description })
        .map_err(|e| format!("Failed to build skill frontmatter: {e}"))?;
    let frontmatter = frontmatter.strip_prefix("---\n").unwrap_or(&frontmatter);

    Ok(format!(
        "---\n{frontmatter}---\n\n# {name}\n\n## 何时使用\n- 描述该 Skill 的适用场景。\n\n## 输入\n- 说明用户需要提供的上下文、约束和素材。\n\n## 执行要求\n1. 先明确目标、边界和输出格式。\n2. 如需引用资料，请将文件放到 `references/` 目录。\n3. 如需脚本或素材，请分别放到 `scripts/` 与 `assets/` 目录。\n\n## 输出\n- 说明最终交付物及验收标准。\n"
    ))
}

fn create_skill_scaffold_in_root(
    skills_root: &Path,
    directory: &str,
    name: &str,
    description: &str,
) -> Result<SkillPackageInspection, String> {
    validate_skill_directory(directory)?;

    let name = name.trim();
    if name.is_empty() {
        return Err("Skill name is required".to_string());
    }

    let description = description.trim();
    if description.is_empty() {
        return Err("Skill description is required".to_string());
    }

    fs::create_dir_all(skills_root).map_err(|e| {
        format!(
            "Failed to create skills root {}: {e}",
            skills_root.display()
        )
    })?;

    let skill_dir = skills_root.join(directory);
    if skill_dir.exists() {
        return Err(format!("Skill directory already exists: {directory}"));
    }

    fs::create_dir_all(&skill_dir).map_err(|e| {
        format!(
            "Failed to create skill directory {}: {e}",
            skill_dir.display()
        )
    })?;

    let skill_md_content = build_skill_scaffold_content(name, description)?;
    let skill_md_path = skill_dir.join("SKILL.md");
    if let Err(error) = fs::write(&skill_md_path, skill_md_content) {
        let _ = fs::remove_dir_all(&skill_dir);
        return Err(format!(
            "Failed to write scaffold file {}: {error}",
            skill_md_path.display()
        ));
    }

    match SkillService::inspect_skill_dir(&skill_dir) {
        Ok(inspection) => Ok(inspection),
        Err(error) => {
            let _ = fs::remove_dir_all(&skill_dir);
            Err(format!("Created scaffold failed inspection: {error}"))
        }
    }
}

/// 获取已安装的 ProxyCast Skills 目录列表
///
/// 扫描 ProxyCast Skills 目录，返回包含 SKILL.md 的子目录名列表。
/// 这些 Skills 将被传递给 aster 用于 AI Agent 功能。
///
/// # Returns
/// - `Ok(Vec<String>)`: 已安装的 Skill 目录名列表
/// - `Err(String)`: 错误信息
#[tauri::command]
pub async fn get_installed_proxycast_skills() -> Result<Vec<String>, String> {
    let skills_dir = get_skills_dir(&AppType::ProxyCast)?;
    Ok(scan_installed_skills(&skills_dir))
}

/// 获取本地已安装 Skill 的标准检查结果
///
/// 仅支持读取本地 Skills 目录下的文件，包含目录合法性、路径穿越防护、
/// Agent Skills 标准检查和 ProxyCast 扩展引用校验。
///
/// # Arguments
/// - `app`: 应用类型（proxycast/claude/codex/gemini）
/// - `directory`: Skill 目录名
///
/// # Returns
/// - `Ok(SkillPackageInspection)`: Skill 检查结果与原始内容
/// - `Err(String)`: 错误信息
#[tauri::command]
pub fn inspect_local_skill_for_app(
    app: String,
    directory: String,
) -> Result<SkillPackageInspection, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    let skill_roots = get_skill_lookup_roots(&app_type)?;
    inspect_local_skill(&skill_roots, &directory)
}

/// 创建标准 Skill 脚手架
///
/// 在项目级或用户级 Skills root 下创建一个最小 Agent Skills 标准包，
/// 并返回创建后的 inspection 结果，供 UI 立即预览。
#[tauri::command]
pub fn create_skill_scaffold_for_app(
    app: String,
    target: String,
    directory: String,
    name: String,
    description: String,
) -> Result<SkillPackageInspection, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    let target = SkillScaffoldTarget::parse(&target)?;
    let skills_root = resolve_skill_scaffold_root(&app_type, target)?;
    let inspection = create_skill_scaffold_in_root(&skills_root, &directory, &name, &description)?;

    if matches!(app_type, AppType::ProxyCast) {
        AsterAgentState::reload_proxycast_skills();
    }

    Ok(inspection)
}

/// 获取远程 Skill 包的标准检查结果
///
/// 直接从远程仓库读取目标 Skill 目录，返回标准检查结果与原始 SKILL.md，
/// 用于安装前预检和 workflow/reference 可见性。
#[tauri::command]
pub async fn inspect_remote_skill(
    skill_service: State<'_, SkillServiceState>,
    owner: String,
    name: String,
    branch: String,
    directory: String,
) -> Result<SkillPackageInspection, String> {
    validate_skill_directory(&directory)?;
    skill_service
        .0
        .inspect_remote_skill(&owner, &name, &branch, &directory)
        .await
        .map_err(|e| e.to_string())
}

pub struct SkillServiceState(pub Arc<SkillService>);

fn get_skill_key(app_type: &AppType, directory: &str) -> String {
    format!("{}:{}", app_type.to_string().to_lowercase(), directory)
}

/// 解析指定应用的技能列表（供 dispatcher 等非 Tauri command 场景调用）
pub async fn resolve_skills_for_app(
    db: &DbConnection,
    skill_service: &Arc<SkillService>,
    app_type: &AppType,
    _refresh_remote: bool,
) -> Result<Vec<Skill>, String> {
    let (repos, installed_states) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let repos = SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())?;
        let installed_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;
        (repos, installed_states)
    };

    let skills = skill_service
        .list_skills(app_type, &repos, &installed_states)
        .await
        .map_err(|e| e.to_string())?;

    Ok(skills)
}

#[tauri::command]
pub async fn get_skills(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
) -> Result<Vec<Skill>, String> {
    get_skills_for_app(db, skill_service, "proxycast".to_string()).await
}

#[tauri::command]
pub async fn get_skills_for_app(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    app: String,
) -> Result<Vec<Skill>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    // 获取仓库列表和已安装状态（在 await 之前完成）
    let (repos, installed_states) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let repos = SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())?;
        let installed_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;
        (repos, installed_states)
    };

    // 获取技能列表
    let skills = skill_service
        .0
        .list_skills(&app_type, &repos, &installed_states)
        .await
        .map_err(|e| e.to_string())?;

    // 自动同步本地已安装的 skills 到数据库
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let existing_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;

        for skill in &skills {
            if skill.installed && skill.catalog_source != SkillCatalogSource::Project {
                let key = get_skill_key(&app_type, &skill.directory);
                if !existing_states.contains_key(&key) {
                    let state = SkillState {
                        installed: true,
                        installed_at: Utc::now(),
                    };
                    SkillDao::update_skill_state(&conn, &key, &state).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(skills)
}

#[tauri::command]
pub fn get_local_skills_for_app(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    app: String,
) -> Result<Vec<Skill>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    let installed_states = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        SkillDao::get_skills(&conn).map_err(|e| e.to_string())?
    };

    skill_service
        .0
        .list_local_skills(&app_type, &installed_states)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_skill(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    directory: String,
) -> Result<bool, String> {
    install_skill_for_app(db, skill_service, "proxycast".to_string(), directory).await
}

#[tauri::command]
pub async fn install_skill_for_app(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    app: String,
    directory: String,
) -> Result<bool, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    // 获取技能信息（在 await 之前完成）
    let (repos, installed_states) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let repos = SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())?;
        let installed_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;
        (repos, installed_states)
    };

    let skills = skill_service
        .0
        .list_skills(&app_type, &repos, &installed_states)
        .await
        .map_err(|e| e.to_string())?;

    let skill = skills
        .iter()
        .find(|s| s.directory == directory)
        .ok_or_else(|| format!("Skill not found: {directory}"))?;

    let repo_owner = skill
        .repo_owner
        .as_ref()
        .ok_or_else(|| "Missing repo owner".to_string())?
        .clone();
    let repo_name = skill
        .repo_name
        .as_ref()
        .ok_or_else(|| "Missing repo name".to_string())?
        .clone();
    let repo_branch = skill
        .repo_branch
        .as_ref()
        .ok_or_else(|| "Missing repo branch".to_string())?
        .clone();

    // 安装技能
    skill_service
        .0
        .install_skill(&app_type, &repo_owner, &repo_name, &repo_branch, &directory)
        .await
        .map_err(|e| e.to_string())?;

    // 更新数据库
    let key = get_skill_key(&app_type, &directory);
    let state = SkillState {
        installed: true,
        installed_at: Utc::now(),
    };

    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        SkillDao::update_skill_state(&conn, &key, &state).map_err(|e| e.to_string())?;
    }

    // 刷新 aster-rust 的 global_registry，使 AI 能够发现新安装的 Skill
    AsterAgentState::reload_proxycast_skills();

    Ok(true)
}

#[tauri::command]
pub fn uninstall_skill(db: State<'_, DbConnection>, directory: String) -> Result<bool, String> {
    uninstall_skill_for_app(db, "proxycast".to_string(), directory)
}

#[tauri::command]
pub fn uninstall_skill_for_app(
    db: State<'_, DbConnection>,
    app: String,
    directory: String,
) -> Result<bool, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    // 卸载技能
    SkillService::uninstall_skill(&app_type, &directory).map_err(|e| e.to_string())?;

    // 更新数据库
    let key = get_skill_key(&app_type, &directory);
    let state = SkillState {
        installed: false,
        installed_at: Utc::now(),
    };

    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::update_skill_state(&conn, &key, &state).map_err(|e| e.to_string())?;

    // 刷新 aster-rust 的 global_registry，移除已卸载的 Skill
    AsterAgentState::reload_proxycast_skills();

    Ok(true)
}

#[tauri::command]
pub fn get_skill_repos(db: State<'_, DbConnection>) -> Result<Vec<SkillRepo>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_skill_repo(db: State<'_, DbConnection>, repo: SkillRepo) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::save_skill_repo(&conn, &repo).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn remove_skill_repo(
    db: State<'_, DbConnection>,
    owner: String,
    name: String,
) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::delete_skill_repo(&conn, &owner, &name).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn refresh_skill_cache(skill_service: State<'_, SkillServiceState>) -> Result<bool, String> {
    skill_service.0.refresh_cache();
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::HashSet;
    use tempfile::TempDir;

    /// 生成有效的 Skill 目录名（字母数字和连字符）
    fn skill_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,20}".prop_filter("non-empty", |s| !s.is_empty())
    }

    /// 生成 Skill 目录名列表
    fn skill_names_strategy() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec(skill_name_strategy(), 0..10).prop_filter("unique names", |names| {
            let set: HashSet<_> = names.iter().collect();
            set.len() == names.len()
        })
    }

    /// 创建测试用的 Skills 目录结构
    fn create_test_skills_dir(temp_dir: &TempDir, skill_names: &[String]) {
        let skills_dir = temp_dir.path();

        for name in skill_names {
            let skill_path = skills_dir.join(name);
            std::fs::create_dir_all(&skill_path).unwrap();
            let skill_md_path = skill_path.join("SKILL.md");
            std::fs::write(&skill_md_path, "# Test Skill\n").unwrap();
        }
    }

    // **Feature: skills-platform-mvp, Property 2: Installed Skills Discovery**
    // **Validates: Requirements 2.1, 2.2, 2.3**
    //
    // *For any* valid skills 目录 containing subdirectories
    // with SKILL.md files, calling `scan_installed_skills()` SHALL return a list
    // containing exactly those subdirectory names.
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn prop_installed_skills_discovery(skill_names in skill_names_strategy()) {
            // Arrange: 创建临时目录和 Skills 结构
            let temp_dir = TempDir::new().unwrap();
            create_test_skills_dir(&temp_dir, &skill_names);

            // Act: 扫描已安装的 Skills
            let discovered = scan_installed_skills(temp_dir.path());

            // Assert: 发现的 Skills 应该与创建的完全匹配
            let expected_set: HashSet<_> = skill_names.iter().cloned().collect();
            let discovered_set: HashSet<_> = discovered.iter().cloned().collect();

            prop_assert_eq!(
                expected_set,
                discovered_set,
                "Discovered skills should match created skills exactly"
            );
        }

        #[test]
        fn prop_empty_dir_returns_empty_list(skill_names in skill_names_strategy()) {
            // Arrange: 创建临时目录但不创建任何 Skills
            let temp_dir = TempDir::new().unwrap();

            // 创建目录但不添加 SKILL.md
            for name in &skill_names {
                let skill_path = temp_dir.path().join(name);
                std::fs::create_dir_all(&skill_path).unwrap();
                // 不创建 SKILL.md 文件
            }

            // Act: 扫描已安装的 Skills
            let discovered = scan_installed_skills(temp_dir.path());

            // Assert: 没有 SKILL.md 的目录不应该被发现
            prop_assert!(
                discovered.is_empty(),
                "Directories without SKILL.md should not be discovered"
            );
        }

        #[test]
        fn prop_nonexistent_dir_returns_empty_list(_dummy in 0..1i32) {
            // Arrange: 使用不存在的目录路径
            let nonexistent_path = std::path::Path::new("/nonexistent/path/to/skills");

            // Act: 扫描不存在的目录
            let discovered = scan_installed_skills(nonexistent_path);

            // Assert: 不存在的目录应该返回空列表
            prop_assert!(
                discovered.is_empty(),
                "Non-existent directory should return empty list"
            );
        }
    }

    #[test]
    fn test_scan_installed_skills_with_mixed_content() {
        // Arrange: 创建包含混合内容的目录
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path();

        // 创建有效的 Skill 目录（有 SKILL.md）
        let valid_skill = skills_dir.join("valid-skill");
        std::fs::create_dir_all(&valid_skill).unwrap();
        std::fs::write(valid_skill.join("SKILL.md"), "# Valid Skill").unwrap();

        // 创建无效的目录（没有 SKILL.md）
        let invalid_skill = skills_dir.join("invalid-skill");
        std::fs::create_dir_all(&invalid_skill).unwrap();

        // 创建文件（不是目录）
        std::fs::write(skills_dir.join("not-a-directory.txt"), "test").unwrap();

        // Act
        let discovered = scan_installed_skills(skills_dir);

        // Assert: 只有有效的 Skill 应该被发现
        assert_eq!(discovered.len(), 1);
        assert!(discovered.contains(&"valid-skill".to_string()));
    }

    #[test]
    fn test_inspect_local_skill_success() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        let skill_dir = skills_dir.join("demo-skill");
        let references_dir = skill_dir.join("references");
        std::fs::create_dir_all(&references_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: Demo Skill
description: Inspect me
metadata:
  proxycast_workflow_ref: references/workflow.yaml
---

# Demo Skill
content"#,
        )
        .unwrap();
        std::fs::write(
            references_dir.join("workflow.yaml"),
            "- id: draft\n  title: 起草\n",
        )
        .unwrap();

        let inspection = inspect_local_skill(&[skills_dir.clone()], "demo-skill").unwrap();
        assert!(inspection.content.contains("# Demo Skill"));
        assert!(inspection.resource_summary.has_references);
        assert!(inspection.standard_compliance.validation_errors.is_empty());
    }

    #[test]
    fn test_inspect_local_skill_rejects_traversal() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let err = inspect_local_skill(&[skills_dir.clone()], "../outside").unwrap_err();
        assert!(err.contains("Invalid skill directory"));
    }

    #[test]
    fn test_inspect_local_skill_missing_skill_md() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        let skill_dir = skills_dir.join("no-skill-md");
        std::fs::create_dir_all(&skill_dir).unwrap();

        let err = inspect_local_skill(&[skills_dir.clone()], "no-skill-md").unwrap_err();
        assert!(err.contains("Skill not found"));
    }

    #[cfg(unix)]
    #[test]
    fn test_inspect_local_skill_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let outside_dir = temp_dir.path().join("outside-skill");
        std::fs::create_dir_all(&outside_dir).unwrap();
        std::fs::write(outside_dir.join("SKILL.md"), "# Outside").unwrap();

        let symlink_dir = skills_dir.join("escape-skill");
        symlink(&outside_dir, &symlink_dir).unwrap();

        let err = inspect_local_skill(&[skills_dir.clone()], "escape-skill").unwrap_err();
        assert!(err.contains("Invalid skill directory path"));
    }

    #[test]
    fn test_inspect_local_skill_prefers_project_root_order() {
        let temp_dir = TempDir::new().unwrap();
        let project_skills_dir = temp_dir
            .path()
            .join("project")
            .join(".agents")
            .join("skills");
        let user_skills_dir = temp_dir.path().join("user-skills");
        let project_skill_dir = project_skills_dir.join("demo-skill");
        let user_skill_dir = user_skills_dir.join("demo-skill");

        std::fs::create_dir_all(&project_skill_dir).unwrap();
        std::fs::create_dir_all(&user_skill_dir).unwrap();
        std::fs::write(
            project_skill_dir.join("SKILL.md"),
            "---\nname: Project Skill\ndescription: project\n---\n",
        )
        .unwrap();
        std::fs::write(
            user_skill_dir.join("SKILL.md"),
            "---\nname: User Skill\ndescription: user\n---\n",
        )
        .unwrap();

        let inspection = inspect_local_skill(
            &[project_skills_dir.clone(), user_skills_dir.clone()],
            "demo-skill",
        )
        .unwrap();

        assert!(inspection.content.contains("Project Skill"));
        assert!(!inspection.content.contains("User Skill"));
    }

    #[test]
    fn test_create_skill_scaffold_in_root_creates_standard_package() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");

        let inspection = create_skill_scaffold_in_root(
            &skills_dir,
            "draft-skill",
            "Draft Skill",
            "Create a new draft",
        )
        .unwrap();

        let skill_md = skills_dir.join("draft-skill").join("SKILL.md");
        assert!(skill_md.is_file());
        assert!(inspection.standard_compliance.is_standard);
        assert!(inspection.content.contains("name: Draft Skill"));
        assert!(inspection.content.contains("# Draft Skill"));
    }

    #[test]
    fn test_create_skill_scaffold_in_root_rejects_existing_directory() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        std::fs::create_dir_all(skills_dir.join("draft-skill")).unwrap();

        let err = create_skill_scaffold_in_root(
            &skills_dir,
            "draft-skill",
            "Draft Skill",
            "Create a new draft",
        )
        .unwrap_err();

        assert!(err.contains("already exists"));
    }
}
