use rusqlite::Connection;

use super::{
    clear_setting, is_true_setting, mark_true_setting, read_setting_value, upsert_setting,
};

const MODEL_REGISTRY_VERSION: &str = "2026.01.16.1";
const MODEL_REGISTRY_REFRESH_NEEDED_KEY: &str = "model_registry_refresh_needed";
const MODEL_REGISTRY_VERSION_KEY: &str = "model_registry_version";

/// 标记需要刷新模型注册表
pub fn mark_model_registry_refresh_needed(conn: &Connection) {
    let _ = mark_true_setting(conn, MODEL_REGISTRY_REFRESH_NEEDED_KEY);
    tracing::info!("[迁移] 已标记需要刷新模型注册表");
}

/// 检查模型注册表版本，如果版本不匹配则标记需要刷新
pub fn check_model_registry_version(conn: &Connection) {
    let current_version = read_setting_value(conn, MODEL_REGISTRY_VERSION_KEY);

    if current_version.as_deref() != Some(MODEL_REGISTRY_VERSION) {
        tracing::info!(
            "[迁移] 模型注册表版本不匹配: {:?} -> {}，标记需要刷新",
            current_version,
            MODEL_REGISTRY_VERSION
        );
        mark_model_registry_refresh_needed(conn);
        let _ = upsert_setting(conn, MODEL_REGISTRY_VERSION_KEY, MODEL_REGISTRY_VERSION);
    }
}

/// 检查是否需要刷新模型注册表
pub fn is_model_registry_refresh_needed(conn: &Connection) -> bool {
    is_true_setting(conn, MODEL_REGISTRY_REFRESH_NEEDED_KEY)
}

/// 清除模型注册表刷新标记
pub fn clear_model_registry_refresh_flag(conn: &Connection) {
    clear_setting(conn, MODEL_REGISTRY_REFRESH_NEEDED_KEY);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model_registry_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn check_model_registry_version_marks_refresh_only_on_version_change() {
        let conn = setup_model_registry_db();

        check_model_registry_version(&conn);
        assert!(is_model_registry_refresh_needed(&conn));

        let stored_version: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [MODEL_REGISTRY_VERSION_KEY],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_version, MODEL_REGISTRY_VERSION);

        clear_model_registry_refresh_flag(&conn);
        assert!(!is_model_registry_refresh_needed(&conn));

        check_model_registry_version(&conn);
        assert!(!is_model_registry_refresh_needed(&conn));
    }
}
