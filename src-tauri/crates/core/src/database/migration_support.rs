use rusqlite::{params, Connection};

pub(crate) fn read_setting_value(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .ok()
}

pub(crate) fn is_true_setting(conn: &Connection, key: &str) -> bool {
    read_setting_value(conn, key)
        .map(|value| value == "true")
        .unwrap_or(false)
}

pub(crate) fn is_migration_completed(conn: &Connection, key: &str) -> bool {
    read_setting_value(conn, key)
        .map(|value| value == "true" || value == "1")
        .unwrap_or(false)
}

pub(crate) fn upsert_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| format!("写入 settings[{key}] 失败: {e}"))?;
    Ok(())
}

pub(crate) fn mark_true_setting(conn: &Connection, key: &str) -> Result<(), String> {
    upsert_setting(conn, key, "true")
}

pub(crate) fn mark_migration_completed(conn: &Connection, key: &str) -> Result<(), String> {
    mark_true_setting(conn, key)
}

pub(crate) fn clear_setting(conn: &Connection, key: &str) {
    let _ = conn.execute("DELETE FROM settings WHERE key = ?1", [key]);
}

pub(crate) fn run_in_transaction<T, F>(conn: &Connection, operation: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    conn.execute("BEGIN TRANSACTION", [])
        .map_err(|e| format!("开始事务失败: {e}"))?;

    match operation(conn) {
        Ok(value) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("提交事务失败: {e}"))?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_settings_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn migration_completed_accepts_legacy_and_new_markers() {
        let conn = setup_settings_db();

        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            ("legacy", "1"),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            ("current", "true"),
        )
        .unwrap();

        assert!(is_migration_completed(&conn, "legacy"));
        assert!(is_migration_completed(&conn, "current"));
        assert!(!is_migration_completed(&conn, "missing"));
    }

    #[test]
    fn run_in_transaction_rolls_back_on_error() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE demo (value TEXT NOT NULL)", [])
            .unwrap();

        let result: Result<(), String> = run_in_transaction(&conn, |tx| {
            tx.execute("INSERT INTO demo (value) VALUES ('should_rollback')", [])
                .map_err(|e| e.to_string())?;
            Err("boom".to_string())
        });

        assert_eq!(result.unwrap_err(), "boom");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM demo", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
