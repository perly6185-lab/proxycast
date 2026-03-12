use crate::database::load_pending_general_messages;
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection};
use std::collections::HashSet;

const GENERAL_MODE_PATTERN: &str = "general:%";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemorySourceCandidate {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

pub fn load_memory_source_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
) -> Result<Vec<MemorySourceCandidate>, String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    load_pending_general_candidates(
        conn,
        from_timestamp,
        to_timestamp,
        limit,
        min_message_length,
        &mut candidates,
        &mut seen,
    )?;
    load_unified_general_candidates(
        conn,
        from_timestamp,
        to_timestamp,
        limit,
        min_message_length,
        &mut candidates,
        &mut seen,
    )?;
    load_non_general_agent_candidates(
        conn,
        from_timestamp,
        to_timestamp,
        limit,
        min_message_length,
        &mut candidates,
        &mut seen,
    )?;

    candidates.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    candidates.truncate(limit);

    Ok(candidates)
}

fn load_pending_general_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let rows = load_pending_general_messages(conn, from_timestamp, to_timestamp, limit)
        .map_err(|e| format!("读取待迁移 general 消息失败: {e}"))?;

    for row in rows {
        push_candidate(
            candidates,
            seen,
            row.session_id,
            row.role,
            row.content,
            normalize_timestamp(row.created_at),
            min_message_length,
        );
    }

    Ok(())
}

fn load_unified_general_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let from_datetime = from_timestamp.map(format_sqlite_datetime);
    let to_datetime = to_timestamp.map(format_sqlite_datetime);

    let mut stmt = conn
        .prepare(
            "SELECT m.session_id, m.role, m.content_json, m.timestamp
             FROM agent_messages m
             JOIN agent_sessions s ON s.id = m.session_id
             WHERE s.model LIKE ?1
               AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
               AND (?3 IS NULL OR datetime(m.timestamp) <= datetime(?3))
             ORDER BY datetime(m.timestamp) DESC
             LIMIT ?4",
        )
        .map_err(|e| format!("查询 unified general agent_messages 失败: {e}"))?;

    let rows = stmt
        .query_map(
            params![
                GENERAL_MODE_PATTERN,
                from_datetime,
                to_datetime,
                limit as i64
            ],
            |row| {
                let session_id: String = row.get(0)?;
                let role: String = row.get(1)?;
                let content_json: String = row.get(2)?;
                let timestamp: String = row.get(3)?;
                Ok((session_id, role, content_json, timestamp))
            },
        )
        .map_err(|e| format!("读取 unified general agent_messages 失败: {e}"))?;

    for row in rows.flatten() {
        if let Some(timestamp_ms) = parse_rfc3339_to_timestamp(&row.3) {
            push_candidate(
                candidates,
                seen,
                row.0,
                row.1,
                extract_text_from_content_json(&row.2),
                timestamp_ms,
                min_message_length,
            );
        }
    }

    Ok(())
}

fn load_non_general_agent_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let from_datetime = from_timestamp.map(format_sqlite_datetime);
    let to_datetime = to_timestamp.map(format_sqlite_datetime);

    let mut stmt = conn
        .prepare(
            "SELECT m.session_id, m.role, m.content_json, m.timestamp
             FROM agent_messages m
             JOIN agent_sessions s ON s.id = m.session_id
             WHERE s.model NOT LIKE ?1
               AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
               AND (?3 IS NULL OR datetime(m.timestamp) <= datetime(?3))
             ORDER BY datetime(m.timestamp) DESC
             LIMIT ?4",
        )
        .map_err(|e| format!("查询非通用 agent_messages 失败: {e}"))?;

    let rows = stmt
        .query_map(
            params![
                GENERAL_MODE_PATTERN,
                from_datetime,
                to_datetime,
                limit as i64
            ],
            |row| {
                let session_id: String = row.get(0)?;
                let role: String = row.get(1)?;
                let content_json: String = row.get(2)?;
                let timestamp: String = row.get(3)?;
                Ok((session_id, role, content_json, timestamp))
            },
        )
        .map_err(|e| format!("读取非通用 agent_messages 失败: {e}"))?;

    for row in rows.flatten() {
        if let Some(timestamp_ms) = parse_rfc3339_to_timestamp(&row.3) {
            push_candidate(
                candidates,
                seen,
                row.0,
                row.1,
                extract_text_from_content_json(&row.2),
                timestamp_ms,
                min_message_length,
            );
        }
    }

    Ok(())
}

fn push_candidate(
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
    session_id: String,
    role: String,
    content: String,
    created_at: i64,
    min_message_length: usize,
) {
    let normalized = normalize_candidate_content(&content);
    if normalized.len() < min_message_length {
        return;
    }

    let normalized_role = role.to_lowercase();
    if normalized_role != "user" && normalized_role != "assistant" {
        return;
    }

    let normalized_created_at = normalize_timestamp(created_at);
    let dedupe_key = format!(
        "{}:{}:{}:{}",
        session_id, normalized_role, normalized_created_at, normalized
    );

    if !seen.insert(dedupe_key) {
        return;
    }

    candidates.push(MemorySourceCandidate {
        session_id,
        role: normalized_role,
        content: normalized,
        created_at: normalized_created_at,
    });
}

fn normalize_candidate_content(content: &str) -> String {
    content
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_timestamp(ts: i64) -> i64 {
    if ts <= 0 {
        return chrono::Utc::now().timestamp_millis();
    }
    if ts > 1_000_000_000_000 {
        ts
    } else {
        ts * 1000
    }
}

fn format_sqlite_datetime(timestamp_ms: i64) -> String {
    let normalized = normalize_timestamp(timestamp_ms);
    Local
        .timestamp_millis_opt(normalized)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string())
}

fn parse_rfc3339_to_timestamp(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
        .or_else(|| parse_datetime_or_timestamp_to_millis(value))
}

fn parse_datetime_or_timestamp_to_millis(value: &str) -> Option<i64> {
    if let Ok(v) = value.parse::<i64>() {
        if v > 1_000_000_000_000 {
            return Some(v);
        }
        return Some(v * 1000);
    }

    chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .ok()
        .and_then(|naive| {
            Local
                .from_local_datetime(&naive)
                .single()
                .map(|dt| dt.timestamp_millis())
        })
}

fn extract_text_from_content_json(content_json: &str) -> String {
    if let Ok(text) = serde_json::from_str::<String>(content_json) {
        return text;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(content_json) {
        match value {
            serde_json::Value::Array(items) => {
                let texts = items
                    .iter()
                    .filter_map(extract_text_from_json_item)
                    .collect::<Vec<_>>();
                if !texts.is_empty() {
                    return texts.join(" ");
                }
            }
            serde_json::Value::Object(_) => {
                if let Some(text) = extract_text_from_json_item(&value) {
                    return text;
                }
            }
            _ => {}
        }
    }

    content_json.to_string()
}

fn extract_text_from_json_item(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.get("Text").and_then(|v| v.as_str()) {
        return Some(text.to_string());
    }

    if value.get("type").and_then(|v| v.as_str()) == Some("text") {
        if let Some(text) = value.get("text").and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
    }

    value
        .get("text")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::load_memory_source_candidates;
    use rusqlite::{params, Connection};

    fn create_test_schema(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_json TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                tool_calls_json TEXT,
                tool_call_id TEXT
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
        .expect("create test schema");
    }

    #[test]
    fn load_memory_source_candidates_merges_unified_and_legacy_without_duplicates() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "general:default",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "claude-sonnet-4",
                "2026-03-12T10:05:00+08:00",
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["general-migrated", "旧会话", 1_741_744_000_000i64, 1_741_744_000_000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-only", "旧会话2", 1_741_744_100_000i64, 1_741_744_100_000i64],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["g1", "general-migrated", "user", "这条消息已经迁移", 1_741_744_000_000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["g2", "legacy-only", "assistant", "这条消息仍在旧表中", 1_741_744_100_000i64],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "user",
                r#"[{"type":"text","text":"这条消息已经迁移"}]"#,
                "2025-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "assistant",
                r#"[{"type":"text","text":"这是一条 agent 消息"}]"#,
                "2025-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        let candidates =
            load_memory_source_candidates(&conn, None, None, 20, 1).expect("load candidates");

        let session_ids = candidates
            .iter()
            .map(|item| item.session_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(candidates.len(), 3);
        assert!(session_ids.contains(&"general-migrated"));
        assert!(session_ids.contains(&"legacy-only"));
        assert!(session_ids.contains(&"agent-1"));
    }

    #[test]
    fn load_memory_source_candidates_skips_legacy_general_after_migration_completed() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params!["migrated_general_chat_to_unified", "true"],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "general:default",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "claude-sonnet-4",
                "2026-03-12T10:05:00+08:00",
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-only", "旧会话", 1_741_744_100_000i64, 1_741_744_100_000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["g1", "legacy-only", "assistant", "这条消息不应再参与运行时候选", 1_741_744_100_000i64],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "user",
                r#"[{"type":"text","text":"这是 unified general 消息"}]"#,
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "assistant",
                r#"[{"type":"text","text":"这是 agent 消息"}]"#,
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        let candidates =
            load_memory_source_candidates(&conn, None, None, 20, 1).expect("load candidates");

        let session_ids = candidates
            .iter()
            .map(|item| item.session_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(candidates.len(), 2);
        assert!(session_ids.contains(&"general-migrated"));
        assert!(session_ids.contains(&"agent-1"));
        assert!(!session_ids.contains(&"legacy-only"));
    }
}
