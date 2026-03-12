use crate::general_chat::{ChatMessage, ContentBlock, MessageRole};
use rusqlite::{params, Connection};

const GENERAL_MODE_PATTERN: &str = "general:%";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PendingGeneralMessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

fn get_pending_general_messages(
    conn: &Connection,
    session_id: &str,
    limit: Option<i32>,
    before_id: Option<&str>,
) -> Result<Vec<ChatMessage>, rusqlite::Error> {
    if !has_pending_general_messages_table(conn)? {
        return Ok(Vec::new());
    }

    let before_filter = r#"
        AND (
            NOT EXISTS (
                SELECT 1
                FROM general_chat_messages before_message
                WHERE before_message.session_id = ?1
                  AND before_message.id = ?2
            )
            OR created_at < (
                SELECT before_message.created_at
                FROM general_chat_messages before_message
                WHERE before_message.session_id = ?1
                  AND before_message.id = ?2
            )
            OR (
                created_at = (
                    SELECT before_message.created_at
                    FROM general_chat_messages before_message
                    WHERE before_message.session_id = ?1
                      AND before_message.id = ?2
                )
                AND id < ?2
            )
        )
    "#;

    let query = match (limit, before_id) {
        (Some(lim), Some(_)) => {
            format!(
                "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                 FROM general_chat_messages
                 WHERE session_id = ?1
                 {before_filter}
                 ORDER BY created_at DESC, id DESC
                 LIMIT {lim}"
            )
        }
        (Some(lim), None) => {
            format!(
                "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                 FROM general_chat_messages
                 WHERE session_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT {lim}"
            )
        }
        (None, Some(_)) => {
            format!(
                "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                 FROM general_chat_messages
                 WHERE session_id = ?1
                 {before_filter}
                 ORDER BY created_at ASC, id ASC"
            )
        }
        (None, None) => "SELECT id, session_id, role, content, blocks, status, created_at, metadata
             FROM general_chat_messages
             WHERE session_id = ?1
             ORDER BY created_at ASC, id ASC"
            .to_string(),
    };

    let mut stmt = conn.prepare(&query)?;
    let rows = if before_id.is_some() {
        stmt.query_map(
            params![session_id, before_id],
            map_pending_general_chat_message_row,
        )?
    } else {
        stmt.query_map(params![session_id], map_pending_general_chat_message_row)?
    };

    let mut messages = rows.collect::<Result<Vec<_>, _>>()?;
    if limit.is_some() {
        messages.reverse();
    }

    Ok(messages)
}

fn has_pending_general_messages_table(conn: &Connection) -> Result<bool, rusqlite::Error> {
    table_exists(conn, "general_chat_messages")
}

fn has_pending_general_sessions_table(conn: &Connection) -> Result<bool, rusqlite::Error> {
    table_exists(conn, "general_chat_sessions")
}

pub(super) fn load_pending_general_session_messages_raw(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<PendingGeneralMessageRow>, rusqlite::Error> {
    get_pending_general_messages(conn, session_id, None, None).map(|messages| {
        messages
            .into_iter()
            .map(|message| PendingGeneralMessageRow {
                id: message.id,
                session_id: message.session_id,
                role: stringify_message_role(&message.role).to_string(),
                content: message.content,
                created_at: message.created_at,
            })
            .collect()
    })
}

pub(super) fn load_pending_general_messages_raw(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
    limit: usize,
) -> Result<Vec<PendingGeneralMessageRow>, rusqlite::Error> {
    if !has_pending_general_messages_table(conn)? {
        return Ok(Vec::new());
    }

    let has_agent_sessions = table_exists(conn, "agent_sessions")?;
    let mut stmt = if has_agent_sessions {
        conn.prepare(
            "SELECT m.id, m.session_id, m.role, m.content, m.created_at
             FROM general_chat_messages m
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM agent_sessions s
                 WHERE s.id = m.session_id
                   AND s.model LIKE ?1
             )
               AND (?2 IS NULL OR m.created_at >= ?2)
               AND (?3 IS NULL OR m.created_at <= ?3)
             ORDER BY m.created_at DESC
             LIMIT ?4",
        )?
    } else {
        conn.prepare(
            "SELECT m.id, m.session_id, m.role, m.content, m.created_at
             FROM general_chat_messages m
             WHERE (?1 IS NULL OR m.created_at >= ?1)
               AND (?2 IS NULL OR m.created_at <= ?2)
             ORDER BY m.created_at DESC
             LIMIT ?3",
        )?
    };

    let rows = if has_agent_sessions {
        stmt.query_map(
            params![
                GENERAL_MODE_PATTERN,
                from_timestamp_ms,
                to_timestamp_ms,
                limit as i64
            ],
            map_pending_general_message_row,
        )?
    } else {
        stmt.query_map(
            params![from_timestamp_ms, to_timestamp_ms, limit as i64],
            map_pending_general_message_row,
        )?
    };

    rows.collect()
}

pub(super) fn count_pending_general_sessions_raw(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    if !has_pending_general_sessions_table(conn)? {
        return Ok(0);
    }

    if table_exists(conn, "agent_sessions")? {
        return conn.query_row(
            "SELECT COUNT(*)
             FROM general_chat_sessions s
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM agent_sessions unified
                 WHERE unified.id = s.id
                   AND unified.model LIKE ?1
             )
               AND (?2 IS NULL OR s.created_at >= ?2)
               AND (?3 IS NULL OR s.created_at < ?3)",
            params![GENERAL_MODE_PATTERN, from_timestamp_ms, to_timestamp_ms],
            |row| row.get(0),
        );
    }

    conn.query_row(
        "SELECT COUNT(*)
         FROM general_chat_sessions s
         WHERE (?1 IS NULL OR s.created_at >= ?1)
           AND (?2 IS NULL OR s.created_at < ?2)",
        params![from_timestamp_ms, to_timestamp_ms],
        |row| row.get(0),
    )
}

pub(super) fn count_pending_general_messages_raw(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    if !has_pending_general_messages_table(conn)? {
        return Ok(0);
    }

    if table_exists(conn, "agent_sessions")? {
        return conn.query_row(
            "SELECT COUNT(*)
             FROM general_chat_messages m
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM agent_sessions unified
                 WHERE unified.id = m.session_id
                   AND unified.model LIKE ?1
             )
               AND (?2 IS NULL OR m.created_at >= ?2)
               AND (?3 IS NULL OR m.created_at < ?3)",
            params![GENERAL_MODE_PATTERN, from_timestamp_ms, to_timestamp_ms],
            |row| row.get(0),
        );
    }

    conn.query_row(
        "SELECT COUNT(*)
         FROM general_chat_messages m
         WHERE (?1 IS NULL OR m.created_at >= ?1)
           AND (?2 IS NULL OR m.created_at < ?2)",
        params![from_timestamp_ms, to_timestamp_ms],
        |row| row.get(0),
    )
}

pub(super) fn sum_pending_general_message_chars_raw(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    if !has_pending_general_messages_table(conn)? {
        return Ok(0);
    }

    if table_exists(conn, "agent_sessions")? {
        return conn.query_row(
            "SELECT COALESCE(SUM(LENGTH(m.content)), 0)
             FROM general_chat_messages m
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM agent_sessions unified
                 WHERE unified.id = m.session_id
                   AND unified.model LIKE ?1
             )
               AND (?2 IS NULL OR m.created_at >= ?2)
               AND (?3 IS NULL OR m.created_at < ?3)",
            params![GENERAL_MODE_PATTERN, from_timestamp_ms, to_timestamp_ms],
            |row| row.get(0),
        );
    }

    conn.query_row(
        "SELECT COALESCE(SUM(LENGTH(m.content)), 0)
         FROM general_chat_messages m
         WHERE (?1 IS NULL OR m.created_at >= ?1)
           AND (?2 IS NULL OR m.created_at < ?2)",
        params![from_timestamp_ms, to_timestamp_ms],
        |row| row.get(0),
    )
}

fn map_pending_general_message_row(
    row: &rusqlite::Row,
) -> Result<PendingGeneralMessageRow, rusqlite::Error> {
    Ok(PendingGeneralMessageRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_pending_general_chat_message_row(
    row: &rusqlite::Row,
) -> Result<ChatMessage, rusqlite::Error> {
    let role_str: String = row.get(2)?;
    let blocks_json: Option<String> = row.get(4)?;
    let blocks: Option<Vec<ContentBlock>> = blocks_json
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?;

    let metadata_json: Option<String> = row.get(7)?;
    let metadata = metadata_json
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e))
        })?;

    Ok(ChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: parse_message_role(&role_str),
        content: row.get(3)?,
        blocks,
        status: row.get(5)?,
        created_at: row.get(6)?,
        metadata,
    })
}

fn parse_message_role(role: &str) -> MessageRole {
    match role {
        "assistant" => MessageRole::Assistant,
        "system" => MessageRole::System,
        _ => MessageRole::User,
    }
}

fn stringify_message_role(role: &MessageRole) -> &'static str {
    match role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::System => "system",
    }
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, rusqlite::Error> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table_name],
        |row| row.get(0),
    )?;

    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_schema(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE general_chat_sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE TABLE general_chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                blocks TEXT,
                status TEXT NOT NULL DEFAULT 'complete',
                created_at INTEGER NOT NULL,
                metadata TEXT
            );
            ",
        )
        .unwrap();
    }

    #[test]
    fn pending_messages_support_limit_blocks_and_pagination() {
        let conn = Connection::open_in_memory().unwrap();
        create_test_schema(&conn);

        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["session-1", "测试会话", now, now],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, blocks, status, created_at, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "msg-0",
                "session-1",
                "assistant",
                "这是一段代码：",
                r#"[{"type":"code","content":"fn main() {}","language":"rust"}]"#,
                "complete",
                now,
                Option::<String>::None,
            ],
        )
        .unwrap();

        for index in 1..=5 {
            conn.execute(
                "INSERT INTO general_chat_messages (id, session_id, role, content, blocks, status, created_at, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    format!("msg-{index}"),
                    "session-1",
                    "user",
                    format!("消息 {index}"),
                    Option::<String>::None,
                    "complete",
                    now + index as i64,
                    Option::<String>::None,
                ],
            )
            .unwrap();
        }

        let limited = get_pending_general_messages(&conn, "session-1", Some(3), None).unwrap();
        assert_eq!(limited.len(), 3);
        assert_eq!(limited[0].id, "msg-3");
        assert_eq!(limited[2].id, "msg-5");

        let before =
            get_pending_general_messages(&conn, "session-1", Some(10), Some("msg-3")).unwrap();
        let before_ids = before
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(before_ids, vec!["msg-0", "msg-1", "msg-2"]);

        let with_blocks = get_pending_general_messages(&conn, "session-1", None, None).unwrap();
        assert_eq!(
            with_blocks[0]
                .blocks
                .as_ref()
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.language.as_deref()),
            Some("rust")
        );
    }

    #[test]
    fn pending_messages_exclude_migrated_sessions() {
        let conn = Connection::open_in_memory().unwrap();
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-only", "legacy", 1000i64, 1000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["migrated", "migrated", 2000i64, 2000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["gm-1", "legacy-only", "user", "legacy message", 1000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["gm-2", "migrated", "assistant", "migrated message", 2000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "migrated",
                "general:default",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();

        let messages = load_pending_general_messages_raw(&conn, None, None, 20).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].session_id, "legacy-only");
    }

    #[test]
    fn counters_return_zero_when_legacy_tables_are_missing() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            [],
        )
        .unwrap();

        assert_eq!(
            count_pending_general_sessions_raw(&conn, None, None).unwrap(),
            0
        );
        assert_eq!(
            count_pending_general_messages_raw(&conn, None, None).unwrap(),
            0
        );
        assert_eq!(
            sum_pending_general_message_chars_raw(&conn, None, None).unwrap(),
            0
        );
        assert!(load_pending_general_session_messages_raw(&conn, "missing")
            .unwrap()
            .is_empty());
    }
}
