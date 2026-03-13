use rusqlite::{Connection, DatabaseName};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_DATA_DIR_NAME: &str = "proxycast";
const LEGACY_HOME_DIR_NAME: &str = ".proxycast";
const DATABASE_FILE_NAME: &str = "proxycast.db";
const MIGRATION_MARKER_FILE: &str = ".migration_completed";
const USER_SIGNAL_TABLES: &[&str] = &[
    "contents",
    "agent_sessions",
    "general_chat_sessions",
    "materials",
    "api_keys",
    "heartbeat_executions",
];

pub fn preferred_data_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "无法获取应用数据目录".to_string())?
        .join(APP_DATA_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录 {}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn legacy_home_dir() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "无法获取主目录".to_string())?
        .join(LEGACY_HOME_DIR_NAME))
}

pub fn preferred_database_path() -> Result<PathBuf, String> {
    Ok(preferred_data_dir()?.join(DATABASE_FILE_NAME))
}

pub fn legacy_database_path() -> Result<PathBuf, String> {
    Ok(legacy_home_dir()?.join(DATABASE_FILE_NAME))
}

pub fn resolve_database_path() -> Result<PathBuf, String> {
    with_app_roots(resolve_database_path_from_roots)
}

pub fn resolve_logs_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("logs")
}

pub fn resolve_request_logs_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("request_logs")
}

pub fn resolve_projects_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("projects")
}

pub fn resolve_sessions_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("sessions")
}

pub fn resolve_skills_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("skills")
}

pub fn resolve_project_skills_dir() -> Option<PathBuf> {
    std::env::current_dir()
        .ok()
        .map(|cwd| resolve_project_skills_dir_from_cwd(&cwd))
}

pub fn resolve_proxycast_skill_roots() -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    if let Some(project_dir) = resolve_project_skills_dir() {
        roots.push(project_dir);
    }
    roots.push(resolve_skills_dir()?);
    Ok(roots)
}

pub fn resolve_user_memory_path() -> Result<PathBuf, String> {
    with_app_roots(resolve_user_memory_path_from_roots)
}

pub fn resolve_default_project_dir() -> Result<PathBuf, String> {
    with_app_roots(resolve_default_project_dir_from_roots)
}

pub fn best_effort_runtime_subdir(subdir: &str) -> PathBuf {
    resolve_runtime_subdir(subdir).unwrap_or_else(|_| fallback_runtime_subdir(subdir))
}

pub fn best_effort_app_data_file(file_name: &str) -> PathBuf {
    preferred_data_dir()
        .unwrap_or_else(|_| fallback_app_data_dir())
        .join(file_name)
}

fn with_app_roots<T>(
    resolver: impl FnOnce(&Path, &Path) -> Result<T, String>,
) -> Result<T, String> {
    let preferred_root = preferred_data_dir()?;
    let legacy_root = legacy_home_dir()?;
    resolver(&preferred_root, &legacy_root)
}

fn resolve_runtime_subdir(subdir: &str) -> Result<PathBuf, String> {
    with_app_roots(|preferred_root, legacy_root| {
        resolve_subdir_with_legacy_copy_from_roots(preferred_root, legacy_root, subdir)
    })
}

fn fallback_runtime_subdir(subdir: &str) -> PathBuf {
    fallback_app_data_dir().join(subdir)
}

fn resolve_project_skills_dir_from_cwd(cwd: &Path) -> PathBuf {
    cwd.join(".agents").join("skills")
}

fn fallback_app_data_dir() -> PathBuf {
    std::env::temp_dir().join(APP_DATA_DIR_NAME)
}

fn resolve_default_project_dir_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    let default_dir =
        resolve_subdir_with_legacy_copy_from_roots(preferred_root, legacy_root, "projects")?
            .join("default");
    fs::create_dir_all(&default_dir)
        .map_err(|e| format!("无法创建默认项目目录 {}: {e}", default_dir.display()))?;
    Ok(default_dir)
}

fn resolve_user_memory_path_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    let preferred_path = preferred_root.join("AGENTS.md");
    if preferred_path.exists() {
        return Ok(preferred_path);
    }

    let legacy_path = legacy_root.join("AGENTS.md");
    if !legacy_path.exists() {
        return Ok(preferred_path);
    }

    if let Some(parent) = preferred_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建用户记忆目录 {}: {e}", parent.display()))?;
    }

    match fs::copy(&legacy_path, &preferred_path) {
        Ok(_) => Ok(preferred_path),
        Err(error) => {
            tracing::warn!(
                "[路径迁移] 用户记忆文件迁移失败，回退旧路径 {}: {}",
                legacy_path.display(),
                error
            );
            Ok(legacy_path)
        }
    }
}

fn resolve_database_path_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    fs::create_dir_all(preferred_root)
        .map_err(|e| format!("无法创建数据库目录 {}: {e}", preferred_root.display()))?;

    let preferred_path = preferred_root.join(DATABASE_FILE_NAME);
    let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);

    // 标记文件存在 → 迁移已完成，直接用 preferred 路径
    if marker_path.exists() {
        return Ok(preferred_path);
    }

    let legacy_path = legacy_root.join(DATABASE_FILE_NAME);

    // 无旧库 → 全新安装，写标记后直接返回
    if !legacy_path.exists() {
        write_migration_marker(&marker_path);
        return Ok(preferred_path);
    }

    // preferred 库不存在 → 首次迁移
    if !preferred_path.exists() {
        let result = migrate_or_fallback_to_legacy(&legacy_path, &preferred_path);
        if result
            .as_ref()
            .map(|p| p == &preferred_path)
            .unwrap_or(false)
        {
            write_migration_marker(&marker_path);
        }
        return result;
    }

    // 两个库都存在，检查是否需要用旧库覆盖空的新库
    let preferred_signal = inspect_database_signal(&preferred_path);
    let legacy_signal = inspect_database_signal(&legacy_path);

    if should_replace_preferred_with_legacy(
        preferred_path.as_path(),
        preferred_signal.as_ref(),
        legacy_path.as_path(),
        legacy_signal.as_ref(),
    ) {
        let result = migrate_or_fallback_to_legacy(&legacy_path, &preferred_path);
        if result
            .as_ref()
            .map(|p| p == &preferred_path)
            .unwrap_or(false)
        {
            write_migration_marker(&marker_path);
        }
        return result;
    }

    // preferred 库已有用户数据，迁移完成
    write_migration_marker(&marker_path);
    Ok(preferred_path)
}

fn write_migration_marker(marker_path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    if let Err(e) = fs::write(marker_path, timestamp) {
        tracing::warn!(
            "[路径迁移] 写入迁移标记失败 {}（下次启动会重新检测）: {e}",
            marker_path.display()
        );
    }
}

fn migrate_or_fallback_to_legacy(
    legacy_path: &Path,
    preferred_path: &Path,
) -> Result<PathBuf, String> {
    match migrate_legacy_database(legacy_path, preferred_path) {
        Ok(()) => {
            tracing::info!(
                "[路径迁移] 数据库已从旧路径迁移到 {}",
                preferred_path.display()
            );
            Ok(preferred_path.to_path_buf())
        }
        Err(error) => {
            tracing::warn!(
                "[路径迁移] 数据库迁移失败，回退旧路径 {}: {}",
                legacy_path.display(),
                error
            );
            Ok(legacy_path.to_path_buf())
        }
    }
}

fn resolve_subdir_with_legacy_copy_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
    subdir: &str,
) -> Result<PathBuf, String> {
    let preferred_dir = preferred_root.join(subdir);
    fs::create_dir_all(&preferred_dir)
        .map_err(|e| format!("无法创建目录 {}: {e}", preferred_dir.display()))?;

    // 标记文件存在 → 迁移已完成，跳过旧目录扫描
    let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
    if marker_path.exists() {
        return Ok(preferred_dir);
    }

    let legacy_dir = legacy_root.join(subdir);
    if legacy_dir.exists() {
        copy_dir_contents_if_missing(&legacy_dir, &preferred_dir)?;
    }

    Ok(preferred_dir)
}

fn migrate_legacy_database(legacy_path: &Path, preferred_path: &Path) -> Result<(), String> {
    if let Some(parent) = preferred_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建数据库目录 {}: {e}", parent.display()))?;
    }

    let source = Connection::open(legacy_path)
        .map_err(|e| format!("打开旧数据库失败 {}: {e}", legacy_path.display()))?;
    source
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("设置旧数据库 busy_timeout 失败: {e}"))?;
    let _ = source.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    backup_existing_database(preferred_path)?;
    remove_database_with_sidecars(preferred_path)?;

    match source.backup(DatabaseName::Main, preferred_path, None) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = remove_database_with_sidecars(preferred_path);
            Err(format!(
                "复制旧数据库 {} -> {} 失败: {error}",
                legacy_path.display(),
                preferred_path.display()
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DatabaseSignal {
    user_signal: u64,
    has_schema: bool,
}

fn inspect_database_signal(path: &Path) -> Option<DatabaseSignal> {
    if !path.exists() {
        return None;
    }

    let conn = Connection::open(path).ok()?;
    let has_schema = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get::<_, u64>(0),
        )
        .ok()
        .map(|count| count > 0)
        .unwrap_or(false);

    let user_signal = USER_SIGNAL_TABLES
        .iter()
        .map(|table| {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            conn.query_row(&sql, [], |row| row.get::<_, u64>(0))
                .unwrap_or(0)
        })
        .sum();

    Some(DatabaseSignal {
        user_signal,
        has_schema,
    })
}

fn should_replace_preferred_with_legacy(
    preferred_path: &Path,
    preferred_signal: Option<&DatabaseSignal>,
    legacy_path: &Path,
    legacy_signal: Option<&DatabaseSignal>,
) -> bool {
    let Some(legacy_signal) = legacy_signal else {
        return false;
    };

    let Some(preferred_signal) = preferred_signal else {
        return true;
    };

    if !preferred_signal.has_schema && legacy_signal.has_schema {
        tracing::warn!(
            "[路径迁移] 当前数据库 {} 无有效 schema，准备回退旧库 {}",
            preferred_path.display(),
            legacy_path.display()
        );
        return true;
    }

    if preferred_signal.user_signal == 0 && legacy_signal.user_signal > 0 {
        tracing::warn!(
            "[路径迁移] 当前数据库 {} 缺少用户数据，检测到旧库 {} 含历史数据，准备自动恢复",
            preferred_path.display(),
            legacy_path.display()
        );
        return true;
    }

    false
}

fn backup_existing_database(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let backup_path = path.with_file_name(format!(
        "{DATABASE_FILE_NAME}.bootstrap-backup-{suffix}.bak"
    ));
    fs::copy(path, &backup_path).map_err(|e| {
        format!(
            "备份当前数据库失败 {} -> {}: {e}",
            path.display(),
            backup_path.display()
        )
    })?;
    Ok(())
}

fn remove_database_with_sidecars(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("删除旧数据库文件失败 {}: {e}", path.display()))?;
    }

    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", path.display(), suffix));
        if sidecar.exists() {
            fs::remove_file(&sidecar)
                .map_err(|e| format!("删除数据库伴生文件失败 {}: {e}", sidecar.display()))?;
        }
    }

    Ok(())
}

fn copy_dir_contents_if_missing(from: &Path, to: &Path) -> Result<(), String> {
    let entries =
        fs::read_dir(from).map_err(|e| format!("读取目录失败 {}: {e}", from.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败 {}: {e}", from.display()))?;
        let source_path = entry.path();
        let target_path = to.join(entry.file_name());

        if source_path.is_dir() {
            fs::create_dir_all(&target_path)
                .map_err(|e| format!("创建目录失败 {}: {e}", target_path.display()))?;
            copy_dir_contents_if_missing(&source_path, &target_path)?;
            continue;
        }

        if target_path.exists() {
            continue;
        }

        fs::copy(&source_path, &target_path).map_err(|e| {
            format!(
                "复制文件失败 {} -> {}: {e}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_database_path_migrates_legacy_database() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        fs::create_dir_all(&legacy_root).unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let conn = Connection::open(&legacy_db).unwrap();
        conn.execute(
            "CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO sample (name) VALUES ('proxycast')", [])
            .unwrap();

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        assert_eq!(resolved, preferred_root.join(DATABASE_FILE_NAME));
        assert!(resolved.exists());

        let migrated = Connection::open(resolved).unwrap();
        let name: String = migrated
            .query_row("SELECT name FROM sample LIMIT 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "proxycast");
    }

    #[test]
    fn resolve_logs_dir_copies_legacy_files() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        let legacy_logs = legacy_root.join("logs");
        fs::create_dir_all(&legacy_logs).unwrap();
        fs::write(legacy_logs.join("proxycast.log"), "legacy log").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "logs")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("logs"));
        assert_eq!(
            fs::read_to_string(resolved.join("proxycast.log")).unwrap(),
            "legacy log"
        );
    }

    #[test]
    fn resolve_projects_dir_copies_legacy_project_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        let legacy_project_dir = legacy_root.join("projects").join("legacy-project");
        fs::create_dir_all(&legacy_project_dir).unwrap();
        fs::write(legacy_project_dir.join("note.md"), "legacy project").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "projects")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("projects"));
        assert_eq!(
            fs::read_to_string(resolved.join("legacy-project").join("note.md")).unwrap(),
            "legacy project"
        );
    }

    #[test]
    fn resolve_sessions_dir_copies_legacy_session_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        let legacy_session_dir = legacy_root
            .join("sessions")
            .join("legacy-session")
            .join("files");
        fs::create_dir_all(&legacy_session_dir).unwrap();
        fs::write(legacy_session_dir.join("note.md"), "legacy session").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "sessions")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("sessions"));
        assert_eq!(
            fs::read_to_string(
                resolved
                    .join("legacy-session")
                    .join("files")
                    .join("note.md")
            )
            .unwrap(),
            "legacy session"
        );
    }

    #[test]
    fn resolve_skills_dir_copies_legacy_skill_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        let legacy_skill_dir = legacy_root.join("skills").join("legacy-skill");
        fs::create_dir_all(&legacy_skill_dir).unwrap();
        fs::write(legacy_skill_dir.join("SKILL.md"), "legacy skill").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "skills")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("skills"));
        assert_eq!(
            fs::read_to_string(resolved.join("legacy-skill").join("SKILL.md")).unwrap(),
            "legacy skill"
        );
    }

    #[test]
    fn resolve_project_skills_dir_from_cwd_builds_agents_skills_path() {
        let cwd = Path::new("/tmp/workspace");
        let resolved = resolve_project_skills_dir_from_cwd(cwd);
        assert_eq!(resolved, cwd.join(".agents").join("skills"));
    }

    #[test]
    fn resolve_user_memory_path_copies_legacy_agents_file() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        fs::create_dir_all(&legacy_root).unwrap();
        fs::write(legacy_root.join("AGENTS.md"), "legacy agents").unwrap();

        let resolved = resolve_user_memory_path_from_roots(&preferred_root, &legacy_root).unwrap();

        let expected = preferred_root.join("AGENTS.md");
        assert_eq!(resolved, expected);
        assert_eq!(fs::read_to_string(expected).unwrap(), "legacy agents");
    }

    #[test]
    fn resolve_default_project_dir_creates_default_subdirectory() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");

        let resolved =
            resolve_default_project_dir_from_roots(&preferred_root, &legacy_root).unwrap();

        assert_eq!(resolved, preferred_root.join("projects").join("default"));
        assert!(resolved.exists());
        assert!(resolved.is_dir());
    }

    #[test]
    fn fallback_runtime_subdir_uses_proxycast_temp_namespace() {
        let fallback = fallback_runtime_subdir("logs");
        assert!(fallback.ends_with(Path::new(APP_DATA_DIR_NAME).join("logs")));
    }

    #[test]
    fn resolve_database_path_replaces_bootstrap_db_with_legacy_data() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        fs::create_dir_all(&preferred_root).unwrap();
        fs::create_dir_all(&legacy_root).unwrap();

        let preferred_db = preferred_root.join(DATABASE_FILE_NAME);
        let preferred_conn = Connection::open(&preferred_db).unwrap();
        preferred_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let legacy_conn = Connection::open(&legacy_db).unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY, name TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute("INSERT INTO contents (title) VALUES ('legacy')", [])
            .unwrap();

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        let conn = Connection::open(resolved).unwrap();
        let count: u64 = conn
            .query_row("SELECT COUNT(*) FROM contents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn resolve_database_path_keeps_preferred_when_it_has_user_data() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        fs::create_dir_all(&preferred_root).unwrap();
        fs::create_dir_all(&legacy_root).unwrap();

        let preferred_db = preferred_root.join(DATABASE_FILE_NAME);
        let preferred_conn = Connection::open(&preferred_db).unwrap();
        preferred_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        preferred_conn
            .execute("INSERT INTO contents (title) VALUES ('preferred')", [])
            .unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let legacy_conn = Connection::open(&legacy_db).unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute("INSERT INTO contents (title) VALUES ('legacy')", [])
            .unwrap();

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        let conn = Connection::open(resolved).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM contents LIMIT 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "preferred");
    }

    #[test]
    fn resolve_database_path_skips_migration_when_marker_exists() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        fs::create_dir_all(&preferred_root).unwrap();
        fs::create_dir_all(&legacy_root).unwrap();

        // preferred 库为空（只有 schema）
        let preferred_db = preferred_root.join(DATABASE_FILE_NAME);
        let preferred_conn = Connection::open(&preferred_db).unwrap();
        preferred_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        drop(preferred_conn);

        // 旧库有数据
        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let legacy_conn = Connection::open(&legacy_db).unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute("INSERT INTO contents (title) VALUES ('legacy')", [])
            .unwrap();
        drop(legacy_conn);

        // 写入标记文件 → 模拟已迁移过
        fs::write(preferred_root.join(MIGRATION_MARKER_FILE), "1700000000").unwrap();

        // 即使旧库有数据、新库为空，也不应触发迁移
        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        assert_eq!(resolved, preferred_db);

        let conn = Connection::open(&resolved).unwrap();
        let count: u64 = conn
            .query_row("SELECT COUNT(*) FROM contents", [], |row| row.get(0))
            .unwrap();
        // 新库仍为空，说明没有被旧库覆盖
        assert_eq!(count, 0);
    }

    #[test]
    fn resolve_database_path_writes_marker_after_successful_migration() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        fs::create_dir_all(&legacy_root).unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let conn = Connection::open(&legacy_db).unwrap();
        conn.execute(
            "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO contents (title) VALUES ('data')", [])
            .unwrap();
        drop(conn);

        let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
        assert!(!marker_path.exists());

        let _ = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();

        // 迁移成功后标记文件应存在
        assert!(marker_path.exists());
    }

    #[test]
    fn resolve_database_path_writes_marker_for_fresh_install() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("proxycast");
        let legacy_root = temp.path().join("home").join(".proxycast");
        // 不创建 legacy_root → 模拟全新安装

        let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
        assert!(!marker_path.exists());

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        assert_eq!(resolved, preferred_root.join(DATABASE_FILE_NAME));

        // 全新安装也应写标记
        assert!(marker_path.exists());
    }
}
