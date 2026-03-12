pub mod dao;
pub mod migration;
mod migration_support;
pub mod migration_v2;
pub mod migration_v3;
pub mod migration_v4;
mod pending_general_chat;
pub mod schema;
mod startup_migrations;
pub mod system_providers;

use crate::app_paths;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub type DbConnection = Arc<Mutex<Connection>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingGeneralMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

impl From<pending_general_chat::PendingGeneralMessageRow> for PendingGeneralMessage {
    fn from(message: pending_general_chat::PendingGeneralMessageRow) -> Self {
        Self {
            id: message.id,
            session_id: message.session_id,
            role: message.role,
            content: message.content,
            created_at: message.created_at,
        }
    }
}

fn run_pending_general_query<T, F>(
    conn: &Connection,
    empty_value: T,
    query: F,
) -> Result<T, rusqlite::Error>
where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
{
    if migration::is_general_chat_migration_completed(conn) {
        return Ok(empty_value);
    }

    query(conn)
}

pub fn load_pending_general_session_messages(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<PendingGeneralMessage>, rusqlite::Error> {
    run_pending_general_query(conn, Vec::new(), |tx| {
        pending_general_chat::load_pending_general_session_messages_raw(tx, session_id)
            .map(|messages| messages.into_iter().map(Into::into).collect())
    })
}

pub fn load_pending_general_messages(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
    limit: usize,
) -> Result<Vec<PendingGeneralMessage>, rusqlite::Error> {
    run_pending_general_query(conn, Vec::new(), |tx| {
        pending_general_chat::load_pending_general_messages_raw(
            tx,
            from_timestamp_ms,
            to_timestamp_ms,
            limit,
        )
        .map(|messages| messages.into_iter().map(Into::into).collect())
    })
}

pub fn count_pending_general_sessions(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    run_pending_general_query(conn, 0, |tx| {
        pending_general_chat::count_pending_general_sessions_raw(
            tx,
            from_timestamp_ms,
            to_timestamp_ms,
        )
    })
}

pub fn count_pending_general_messages(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    run_pending_general_query(conn, 0, |tx| {
        pending_general_chat::count_pending_general_messages_raw(
            tx,
            from_timestamp_ms,
            to_timestamp_ms,
        )
    })
}

pub fn sum_pending_general_message_chars(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    run_pending_general_query(conn, 0, |tx| {
        pending_general_chat::sum_pending_general_message_chars_raw(
            tx,
            from_timestamp_ms,
            to_timestamp_ms,
        )
    })
}

/// 获取数据库连接锁（自动处理 poisoned lock）
pub fn lock_db(db: &DbConnection) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    match db.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            tracing::warn!("[数据库] 检测到数据库锁被污染，尝试恢复: {}", poisoned);
            db.clear_poison();
            Ok(poisoned.into_inner())
        }
    }
}

/// 获取数据库文件路径
pub fn get_db_path() -> Result<PathBuf, String> {
    app_paths::resolve_database_path()
}

/// 初始化数据库连接
pub fn init_database() -> Result<DbConnection, String> {
    let db_path = get_db_path()?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // 设置 busy_timeout 为 5 秒，避免 "database is locked" 错误
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("设置 busy_timeout 失败: {e}"))?;

    // 启用 WAL 模式提升并发性能
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -64000;
         PRAGMA temp_store = MEMORY;",
    )
    .map_err(|e| format!("设置数据库优化参数失败: {e}"))?;

    tracing::info!("[数据库] 已启用 WAL 模式和性能优化参数");

    // 创建表结构
    schema::create_tables(&conn).map_err(|e| e.to_string())?;
    migration::migrate_from_json(&conn)?;
    startup_migrations::run_startup_migrations(&conn);

    Ok(Arc::new(Mutex::new(conn)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_completed_general_migration_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, 'true')",
            [migration::GENERAL_CHAT_MIGRATION_COMPLETED_KEY],
        )
        .unwrap();
        conn
    }

    #[test]
    fn pending_general_queries_short_circuit_after_migration_completed() {
        let conn = setup_completed_general_migration_db();

        let messages = load_pending_general_messages(&conn, None, None, 10).unwrap();
        let session_messages = load_pending_general_session_messages(&conn, "session-1").unwrap();
        let session_count = count_pending_general_sessions(&conn, None, None).unwrap();
        let message_count = count_pending_general_messages(&conn, None, None).unwrap();
        let char_count = sum_pending_general_message_chars(&conn, None, None).unwrap();

        assert!(messages.is_empty());
        assert!(session_messages.is_empty());
        assert_eq!(session_count, 0);
        assert_eq!(message_count, 0);
        assert_eq!(char_count, 0);
    }
}
