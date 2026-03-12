use rusqlite::Connection;

use super::{is_true_setting, mark_true_setting};

const MCP_PROXYCAST_ENABLED_MIGRATED_KEY: &str = "migrated_mcp_proxycast_enabled";
const MCP_CREATED_AT_INTEGER_MIGRATED_KEY: &str = "migrated_mcp_created_at_to_integer";

/// 修复历史 MCP 导入数据：补齐 enabled_proxycast
///
/// 早期版本从 Claude/Codex/Gemini 导入 MCP 时，默认写入 enabled_proxycast=0，
/// 导致 ProxyCast 本身不会使用这些服务器。
///
/// 迁移策略：
/// - 仅处理 enabled_proxycast=0 的记录
/// - 且至少在一个外部应用中启用（enabled_claude/codex/gemini 任一为 1）
/// - 将 enabled_proxycast 设为 1
pub fn migrate_mcp_proxycast_enabled(conn: &Connection) -> Result<usize, String> {
    if is_true_setting(conn, MCP_PROXYCAST_ENABLED_MIGRATED_KEY) {
        tracing::debug!("[迁移] MCP proxycast 启用状态已迁移过，跳过");
        return Ok(0);
    }

    let updated = conn
        .execute(
            "UPDATE mcp_servers
             SET enabled_proxycast = 1
             WHERE enabled_proxycast = 0
               AND (enabled_claude = 1 OR enabled_codex = 1 OR enabled_gemini = 1)",
            [],
        )
        .map_err(|e| format!("修复 MCP enabled_proxycast 失败: {e}"))?;

    mark_true_setting(conn, MCP_PROXYCAST_ENABLED_MIGRATED_KEY)?;

    tracing::info!(
        "[迁移] MCP proxycast 启用状态修复完成，更新 {} 条记录",
        updated
    );

    Ok(updated)
}

/// 归一化 mcp_servers.created_at 字段为 INTEGER 时间戳
///
/// 历史版本曾写入 RFC3339 文本，导致下游按 i64 读取时出现类型异常。
/// 迁移策略：
/// - 纯数字文本 -> CAST 为 INTEGER
/// - RFC3339 文本 -> strftime('%s', ...) 转为秒级时间戳
/// - 其余值保持不变（由 DAO 兼容读取）
pub fn migrate_mcp_created_at_to_integer(conn: &Connection) -> Result<usize, String> {
    if is_true_setting(conn, MCP_CREATED_AT_INTEGER_MIGRATED_KEY) {
        tracing::debug!("[迁移] MCP created_at 类型已归一化，跳过");
        return Ok(0);
    }

    let updated_numeric = conn
        .execute(
            "UPDATE mcp_servers
             SET created_at = CAST(TRIM(created_at) AS INTEGER)
             WHERE typeof(created_at) = 'text'
               AND TRIM(created_at) != ''
               AND TRIM(created_at) NOT GLOB '*[^0-9]*'",
            [],
        )
        .map_err(|e| format!("归一化 MCP created_at 数字文本失败: {e}"))?;

    let updated_rfc3339 = conn
        .execute(
            "UPDATE mcp_servers
             SET created_at = CAST(strftime('%s', created_at) AS INTEGER)
             WHERE typeof(created_at) = 'text'
               AND strftime('%s', created_at) IS NOT NULL",
            [],
        )
        .map_err(|e| format!("归一化 MCP created_at RFC3339 文本失败: {e}"))?;

    mark_true_setting(conn, MCP_CREATED_AT_INTEGER_MIGRATED_KEY)?;

    let total = updated_numeric + updated_rfc3339;
    tracing::info!("[迁移] MCP created_at 归一化完成，更新 {} 条记录", total);

    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_mcp_migration_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE mcp_servers (
                id TEXT PRIMARY KEY,
                enabled_proxycast INTEGER NOT NULL DEFAULT 0,
                enabled_claude INTEGER NOT NULL DEFAULT 0,
                enabled_codex INTEGER NOT NULL DEFAULT 0,
                enabled_gemini INTEGER NOT NULL DEFAULT 0,
                created_at
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn migrate_mcp_proxycast_enabled_updates_only_imported_rows() {
        let conn = setup_mcp_migration_db();

        conn.execute(
            "INSERT INTO mcp_servers (id, enabled_proxycast, enabled_claude) VALUES (?1, 0, 1)",
            ["server-1"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mcp_servers (id, enabled_proxycast, enabled_claude) VALUES (?1, 0, 0)",
            ["server-2"],
        )
        .unwrap();

        let updated = migrate_mcp_proxycast_enabled(&conn).unwrap();
        assert_eq!(updated, 1);

        let enabled_proxycast: i64 = conn
            .query_row(
                "SELECT enabled_proxycast FROM mcp_servers WHERE id = ?1",
                ["server-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enabled_proxycast, 1);

        let untouched: i64 = conn
            .query_row(
                "SELECT enabled_proxycast FROM mcp_servers WHERE id = ?1",
                ["server-2"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(untouched, 0);

        let updated_again = migrate_mcp_proxycast_enabled(&conn).unwrap();
        assert_eq!(updated_again, 0);
    }

    #[test]
    fn migrate_mcp_created_at_to_integer_normalizes_text_values() {
        let conn = setup_mcp_migration_db();

        conn.execute(
            "INSERT INTO mcp_servers (id, created_at) VALUES (?1, ?2)",
            ("numeric", "1700000000"),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mcp_servers (id, created_at) VALUES (?1, ?2)",
            ("rfc3339", "2026-03-01T00:00:00Z"),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mcp_servers (id, created_at) VALUES (?1, ?2)",
            ("invalid", "not-a-date"),
        )
        .unwrap();

        let updated = migrate_mcp_created_at_to_integer(&conn).unwrap();
        assert_eq!(updated, 2);

        let numeric_type: String = conn
            .query_row(
                "SELECT typeof(created_at) FROM mcp_servers WHERE id = 'numeric'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(numeric_type, "integer");

        let rfc_timestamp: i64 = conn
            .query_row(
                "SELECT created_at FROM mcp_servers WHERE id = 'rfc3339'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(rfc_timestamp > 0);

        let invalid_type: String = conn
            .query_row(
                "SELECT typeof(created_at) FROM mcp_servers WHERE id = 'invalid'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(invalid_type, "text");
    }
}
