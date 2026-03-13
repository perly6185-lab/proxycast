//! 统一运行时排队 turn 持久化 DAO
//!
//! 用于在应用重启后恢复会话级排队请求。

use rusqlite::{params, Connection};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRuntimeQueuedTurnRecord {
    pub id: i64,
    pub queued_turn_id: String,
    pub session_id: String,
    pub event_name: String,
    pub message_preview: String,
    pub message_text: String,
    pub payload_json: String,
    pub image_count: usize,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAgentRuntimeQueuedTurnRecord {
    pub queued_turn_id: String,
    pub session_id: String,
    pub event_name: String,
    pub message_preview: String,
    pub message_text: String,
    pub payload_json: String,
    pub image_count: usize,
    pub created_at: i64,
}

pub struct AgentRuntimeQueuedTurnDao;

impl AgentRuntimeQueuedTurnDao {
    pub fn insert(
        conn: &Connection,
        record: &NewAgentRuntimeQueuedTurnRecord,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT INTO agent_runtime_queued_turns (
                queued_turn_id,
                session_id,
                event_name,
                message_preview,
                message_text,
                payload_json,
                image_count,
                created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.queued_turn_id,
                record.session_id,
                record.event_name,
                record.message_preview,
                record.message_text,
                record.payload_json,
                record.image_count as i64,
                record.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn remove(conn: &Connection, queued_turn_id: &str) -> Result<bool, rusqlite::Error> {
        let changed = conn.execute(
            "DELETE FROM agent_runtime_queued_turns WHERE queued_turn_id = ?1",
            params![queued_turn_id],
        )?;
        Ok(changed > 0)
    }

    pub fn list_by_session(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<AgentRuntimeQueuedTurnRecord>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT
                id,
                queued_turn_id,
                session_id,
                event_name,
                message_preview,
                message_text,
                payload_json,
                image_count,
                created_at
             FROM agent_runtime_queued_turns
             WHERE session_id = ?1
             ORDER BY id ASC",
        )?;

        let rows = stmt.query_map(params![session_id], |row| {
            Ok(AgentRuntimeQueuedTurnRecord {
                id: row.get(0)?,
                queued_turn_id: row.get(1)?,
                session_id: row.get(2)?,
                event_name: row.get(3)?,
                message_preview: row.get(4)?,
                message_text: row.get(5)?,
                payload_json: row.get(6)?,
                image_count: row.get::<_, i64>(7)? as usize,
                created_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    pub fn list_distinct_session_ids(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT session_id
             FROM agent_runtime_queued_turns
             ORDER BY session_id ASC",
        )?;

        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE agent_runtime_queued_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                queued_turn_id TEXT NOT NULL UNIQUE,
                session_id TEXT NOT NULL,
                event_name TEXT NOT NULL,
                message_preview TEXT NOT NULL,
                message_text TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                image_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn should_insert_list_and_remove_queued_turn() {
        let conn = setup_conn();
        let first = NewAgentRuntimeQueuedTurnRecord {
            queued_turn_id: "queued-1".to_string(),
            session_id: "session-1".to_string(),
            event_name: "event-1".to_string(),
            message_preview: "preview-1".to_string(),
            message_text: "body-1".to_string(),
            payload_json: "{\"message\":\"body-1\"}".to_string(),
            image_count: 0,
            created_at: 1,
        };
        let second = NewAgentRuntimeQueuedTurnRecord {
            queued_turn_id: "queued-2".to_string(),
            session_id: "session-1".to_string(),
            event_name: "event-2".to_string(),
            message_preview: "preview-2".to_string(),
            message_text: "body-2".to_string(),
            payload_json: "{\"message\":\"body-2\"}".to_string(),
            image_count: 2,
            created_at: 2,
        };

        AgentRuntimeQueuedTurnDao::insert(&conn, &first).unwrap();
        AgentRuntimeQueuedTurnDao::insert(&conn, &second).unwrap();

        let rows = AgentRuntimeQueuedTurnDao::list_by_session(&conn, "session-1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].queued_turn_id, "queued-1");
        assert_eq!(rows[1].message_text, "body-2");

        let session_ids = AgentRuntimeQueuedTurnDao::list_distinct_session_ids(&conn).unwrap();
        assert_eq!(session_ids, vec!["session-1".to_string()]);

        assert!(AgentRuntimeQueuedTurnDao::remove(&conn, "queued-1").unwrap());
        assert!(!AgentRuntimeQueuedTurnDao::remove(&conn, "missing").unwrap());
    }
}
