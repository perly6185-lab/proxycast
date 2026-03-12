use rusqlite::{params, Connection};

use super::{is_true_setting, mark_true_setting};

const API_KEYS_TO_POOL_MIGRATED_KEY: &str = "migrated_api_keys_to_pool";
const PROVIDER_IDS_MIGRATED_KEY: &str = "migrated_provider_ids_v1";
const LEGACY_API_KEY_CREDENTIALS_CLEANED_KEY: &str = "cleaned_legacy_api_key_credentials";

/// 将 api_keys 表中的数据迁移到 provider_pool_credentials 表
///
/// 迁移逻辑：
/// 1. 读取 api_keys 表中的所有 API Key
/// 2. 根据 provider_id 查找对应的 api_key_providers 配置
/// 3. 将 API Key 转换为对应的新凭证结构
/// 4. 插入到 provider_pool_credentials 表
pub fn migrate_api_keys_to_pool(conn: &Connection) -> Result<usize, String> {
    if is_true_setting(conn, API_KEYS_TO_POOL_MIGRATED_KEY) {
        tracing::debug!("[迁移] API Keys 已迁移过，跳过");
        return Ok(0);
    }

    tracing::info!("[迁移] 开始将 api_keys 迁移到 provider_pool_credentials");

    let mut stmt = conn
        .prepare(
            "SELECT k.id, k.provider_id, k.api_key_encrypted, k.alias, k.enabled,
                    k.usage_count, k.error_count, k.last_used_at, k.created_at,
                    p.type, p.api_host, p.name as provider_name
             FROM api_keys k
             JOIN api_key_providers p ON k.provider_id = p.id
             ORDER BY k.created_at ASC",
        )
        .map_err(|e| format!("准备查询语句失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ApiKeyMigrationRow {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                api_key_encrypted: row.get(2)?,
                alias: row.get(3)?,
                enabled: row.get(4)?,
                usage_count: row.get::<_, i64>(5)? as u64,
                error_count: row.get::<_, i64>(6)? as u32,
                last_used_at: row.get(7)?,
                created_at: row.get(8)?,
                provider_type: row.get(9)?,
                api_host: row.get(10)?,
                provider_name: row.get(11)?,
            })
        })
        .map_err(|e| format!("查询 API Keys 失败: {e}"))?;

    let mut migrated_count = 0;
    let now = chrono::Utc::now().timestamp();

    for row_result in rows {
        let row = row_result.map_err(|e| format!("读取行数据失败: {e}"))?;

        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM provider_pool_credentials
                 WHERE credential_data LIKE ?1",
                params![format!("%{}%", row.api_key_encrypted)],
                |result_row| result_row.get(0),
            )
            .unwrap_or(false);

        if exists {
            tracing::debug!(
                "[迁移] 跳过已存在的 API Key: {} (provider: {})",
                row.alias.as_deref().unwrap_or(&row.id),
                row.provider_id
            );
            continue;
        }

        let (pool_provider_type, credential_data) = map_api_key_credential(&row);
        let name = row
            .alias
            .clone()
            .or_else(|| Some(format!("{} (迁移)", row.provider_name)));

        let created_at_ts = row
            .created_at
            .as_ref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|date_time| date_time.timestamp())
            .unwrap_or(now);

        let last_used_ts = row
            .last_used_at
            .as_ref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|date_time| date_time.timestamp());

        let uuid = uuid::Uuid::new_v4().to_string();
        let credential_json = credential_data.to_string();

        conn.execute(
            "INSERT INTO provider_pool_credentials
             (uuid, provider_type, credential_data, name, is_healthy, is_disabled,
              check_health, check_model_name, not_supported_models, usage_count, error_count,
              last_used, last_error_time, last_error_message, last_health_check_time,
              last_health_check_model, created_at, updated_at, source, proxy_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![
                uuid,
                pool_provider_type,
                credential_json,
                name,
                true,
                !row.enabled,
                true,
                Option::<String>::None,
                "[]",
                row.usage_count as i64,
                row.error_count as i32,
                last_used_ts,
                Option::<i64>::None,
                Option::<String>::None,
                Option::<i64>::None,
                Option::<String>::None,
                created_at_ts,
                now,
                "imported",
                Option::<String>::None,
            ],
        )
        .map_err(|e| format!("插入凭证失败: {e}"))?;

        tracing::info!(
            "[迁移] 已迁移 API Key: {} -> {} (provider_type: {})",
            row.alias.as_deref().unwrap_or(&row.id),
            uuid,
            pool_provider_type
        );

        migrated_count += 1;
    }

    mark_true_setting(conn, API_KEYS_TO_POOL_MIGRATED_KEY)?;

    tracing::info!("[迁移] API Keys 迁移完成，共迁移 {} 条记录", migrated_count);

    Ok(migrated_count)
}

/// 迁移旧的 Provider ID 到新的 ID
///
/// 修复 system_providers.rs 中 Provider ID 与模型注册表 JSON 文件名不匹配的问题。
/// 例如：silicon -> siliconflow, gemini -> google 等
pub fn migrate_provider_ids(conn: &Connection) -> Result<usize, String> {
    if is_true_setting(conn, PROVIDER_IDS_MIGRATED_KEY) {
        tracing::debug!("[迁移] Provider ID 已迁移过，跳过");
        return Ok(0);
    }

    tracing::info!("[迁移] 开始迁移旧的 Provider ID");

    let mut migrated_count = 0;

    for (old_id, new_id) in provider_id_mappings() {
        let old_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM api_key_providers WHERE id = ?1",
                params![old_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !old_exists {
            continue;
        }

        let new_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM api_key_providers WHERE id = ?1",
                params![new_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        let has_keys: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM api_keys WHERE provider_id = ?1",
                params![old_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if has_keys {
            if new_exists {
                conn.execute(
                    "UPDATE api_keys SET provider_id = ?1 WHERE provider_id = ?2",
                    params![new_id, old_id],
                )
                .map_err(|e| format!("迁移 API Keys 失败: {e}"))?;

                tracing::info!("[迁移] 已将 {} 的 API Keys 迁移到 {}", old_id, new_id);
            } else {
                conn.execute(
                    "UPDATE api_key_providers SET id = ?1 WHERE id = ?2",
                    params![new_id, old_id],
                )
                .map_err(|e| format!("更新 Provider ID 失败: {e}"))?;

                conn.execute(
                    "UPDATE api_keys SET provider_id = ?1 WHERE provider_id = ?2",
                    params![new_id, old_id],
                )
                .map_err(|e| format!("更新 API Keys provider_id 失败: {e}"))?;

                tracing::info!("[迁移] 已将 Provider {} 重命名为 {}", old_id, new_id);
                migrated_count += 1;
                continue;
            }
        }

        conn.execute(
            "DELETE FROM api_key_providers WHERE id = ?1",
            params![old_id],
        )
        .map_err(|e| format!("删除旧 Provider 失败: {e}"))?;

        tracing::info!("[迁移] 已删除旧 Provider: {}", old_id);
        migrated_count += 1;
    }

    mark_true_setting(conn, PROVIDER_IDS_MIGRATED_KEY)?;

    if migrated_count > 0 {
        tracing::info!(
            "[迁移] Provider ID 迁移完成，共处理 {} 个 Provider",
            migrated_count
        );
    }

    Ok(migrated_count)
}

/// 清理旧的 API Key 凭证（OpenAIKey 和 ClaudeKey 类型）
///
/// 这些凭证是通过旧的 UI 添加的，现在已经被新的 API Key Provider 系统取代。
/// 此函数会删除 provider_pool_credentials 表中的 openai_key 和 claude_key 类型凭证。
pub fn cleanup_legacy_api_key_credentials(conn: &Connection) -> Result<usize, String> {
    if is_true_setting(conn, LEGACY_API_KEY_CREDENTIALS_CLEANED_KEY) {
        tracing::debug!("[清理] 旧 API Key 凭证已清理过，跳过");
        return Ok(0);
    }

    tracing::info!("[清理] 开始清理旧的 API Key 凭证（openai_key, claude_key 类型）");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM provider_pool_credentials
             WHERE credential_data LIKE '%\"type\":\"openai_key\"%'
                OR credential_data LIKE '%\"type\":\"claude_key\"%'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if count == 0 {
        tracing::info!("[清理] 没有需要清理的旧 API Key 凭证");
        mark_true_setting(conn, LEGACY_API_KEY_CREDENTIALS_CLEANED_KEY)?;
        return Ok(0);
    }

    let mut stmt = conn
        .prepare(
            "SELECT uuid, name, provider_type
             FROM provider_pool_credentials
             WHERE credential_data LIKE '%\"type\":\"openai_key\"%'
                OR credential_data LIKE '%\"type\":\"claude_key\"%'",
        )
        .map_err(|e| format!("准备查询语句失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("查询旧凭证失败: {e}"))?;

    for (uuid, name, provider_type) in rows.into_iter().filter_map(Result::ok) {
        tracing::info!(
            "[清理] 将删除旧凭证: {} (name: {}, type: {})",
            uuid,
            name.as_deref().unwrap_or("未命名"),
            provider_type
        );
    }

    let deleted = conn
        .execute(
            "DELETE FROM provider_pool_credentials
             WHERE credential_data LIKE '%\"type\":\"openai_key\"%'
                OR credential_data LIKE '%\"type\":\"claude_key\"%'",
            [],
        )
        .map_err(|e| format!("删除旧凭证失败: {e}"))?;

    mark_true_setting(conn, LEGACY_API_KEY_CREDENTIALS_CLEANED_KEY)?;

    tracing::info!("[清理] 旧 API Key 凭证清理完成，共删除 {} 条记录", deleted);

    Ok(deleted)
}

fn map_api_key_credential(row: &ApiKeyMigrationRow) -> (&'static str, serde_json::Value) {
    match row.provider_type.to_lowercase().as_str() {
        "anthropic" => (
            "claude",
            serde_json::json!({
                "type": "claude_key",
                "api_key": row.api_key_encrypted,
                "base_url": if row.api_host.is_empty() { None } else { Some(&row.api_host) }
            }),
        ),
        "openai" | "openai-response" => (
            "openai",
            serde_json::json!({
                "type": "openai_key",
                "api_key": row.api_key_encrypted,
                "base_url": if row.api_host.is_empty() { None } else { Some(&row.api_host) }
            }),
        ),
        "gemini" => (
            "gemini_api_key",
            serde_json::json!({
                "type": "gemini_api_key",
                "api_key": row.api_key_encrypted,
                "base_url": if row.api_host.is_empty() { None } else { Some(&row.api_host) },
                "excluded_models": []
            }),
        ),
        "vertex" | "vertexai" => (
            "vertex",
            serde_json::json!({
                "type": "vertex_key",
                "api_key": row.api_key_encrypted,
                "base_url": if row.api_host.is_empty() { None } else { Some(&row.api_host) },
                "model_aliases": {}
            }),
        ),
        _ => (
            "openai",
            serde_json::json!({
                "type": "openai_key",
                "api_key": row.api_key_encrypted,
                "base_url": if row.api_host.is_empty() { None } else { Some(&row.api_host) }
            }),
        ),
    }
}

fn provider_id_mappings() -> &'static [(&'static str, &'static str)] {
    &[
        ("silicon", "siliconflow"),
        ("gemini", "google"),
        ("zhipu", "zhipuai"),
        ("dashscope", "alibaba"),
        ("moonshot", "moonshotai"),
        ("grok", "xai"),
        ("github", "github-models"),
        ("copilot", "github-copilot"),
        ("vertexai", "google-vertex"),
        ("aws-bedrock", "amazon-bedrock"),
        ("together", "togetherai"),
        ("fireworks", "fireworks-ai"),
        ("mimo", "xiaomi"),
    ]
}

struct ApiKeyMigrationRow {
    id: String,
    provider_id: String,
    api_key_encrypted: String,
    alias: Option<String>,
    enabled: bool,
    usage_count: u64,
    error_count: u32,
    last_used_at: Option<String>,
    created_at: Option<String>,
    provider_type: String,
    api_host: String,
    provider_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_api_key_migration_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE api_key_providers (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                api_host TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL
            );
            CREATE TABLE api_keys (
                id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL,
                api_key_encrypted TEXT NOT NULL,
                alias TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                usage_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT,
                created_at TEXT
            );
            CREATE TABLE provider_pool_credentials (
                uuid TEXT PRIMARY KEY,
                provider_type TEXT NOT NULL,
                credential_data TEXT NOT NULL,
                name TEXT,
                is_healthy INTEGER NOT NULL,
                is_disabled INTEGER NOT NULL,
                check_health INTEGER NOT NULL,
                check_model_name TEXT,
                not_supported_models TEXT NOT NULL,
                usage_count INTEGER NOT NULL,
                error_count INTEGER NOT NULL,
                last_used INTEGER,
                last_error_time INTEGER,
                last_error_message TEXT,
                last_health_check_time INTEGER,
                last_health_check_model TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT,
                proxy_url TEXT
            );
            ",
        )
        .unwrap();
        conn
    }

    fn insert_pool_credential(conn: &Connection, uuid: &str, credential_type: &str) {
        conn.execute(
            "INSERT INTO provider_pool_credentials
             (uuid, provider_type, credential_data, name, is_healthy, is_disabled,
              check_health, check_model_name, not_supported_models, usage_count, error_count,
              last_used, last_error_time, last_error_message, last_health_check_time,
              last_health_check_model, created_at, updated_at, source, proxy_url)
             VALUES (?1, ?2, ?3, ?4, 1, 0, 1, NULL, '[]', 0, 0, NULL, NULL, NULL, NULL, NULL, 0, 0, 'imported', NULL)",
            params![
                uuid,
                "openai",
                serde_json::json!({
                    "type": credential_type,
                    "api_key": format!("key-{uuid}")
                })
                .to_string(),
                format!("cred-{uuid}")
            ],
        )
        .unwrap();
    }

    #[test]
    fn migrate_api_keys_to_pool_is_idempotent() {
        let conn = setup_api_key_migration_db();

        conn.execute(
            "INSERT INTO api_key_providers (id, type, api_host, name) VALUES (?1, ?2, ?3, ?4)",
            params![
                "provider-1",
                "anthropic",
                "https://api.anthropic.com",
                "Anthropic"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO api_keys
             (id, provider_id, api_key_encrypted, alias, enabled, usage_count, error_count, last_used_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                "key-1",
                "provider-1",
                "secret-1",
                "主账号",
                true,
                9i64,
                1i64,
                "2026-03-01T00:00:00Z",
                "2026-02-01T00:00:00Z"
            ],
        )
        .unwrap();

        let migrated = migrate_api_keys_to_pool(&conn).unwrap();
        assert_eq!(migrated, 1);

        let stored: (String, String, Option<String>, bool) = conn
            .query_row(
                "SELECT provider_type, credential_data, name, is_disabled
                 FROM provider_pool_credentials",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(stored.0, "claude");
        assert!(stored.1.contains("\"type\":\"claude_key\""));
        assert_eq!(stored.2.as_deref(), Some("主账号"));
        assert!(!stored.3);

        let migrated_again = migrate_api_keys_to_pool(&conn).unwrap();
        assert_eq!(migrated_again, 0);
    }

    #[test]
    fn migrate_provider_ids_updates_keys_and_removes_old_provider() {
        let conn = setup_api_key_migration_db();

        conn.execute(
            "INSERT INTO api_key_providers (id, type, api_host, name) VALUES (?1, ?2, '', ?3)",
            params!["gemini", "gemini", "Gemini"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO api_keys (id, provider_id, api_key_encrypted) VALUES (?1, ?2, ?3)",
            params!["key-1", "gemini", "secret"],
        )
        .unwrap();

        let migrated = migrate_provider_ids(&conn).unwrap();
        assert_eq!(migrated, 1);

        let provider_id: String = conn
            .query_row(
                "SELECT provider_id FROM api_keys WHERE id = ?1",
                ["key-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(provider_id, "google");

        let old_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM api_key_providers WHERE id = 'gemini'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!old_exists);
    }

    #[test]
    fn cleanup_legacy_api_key_credentials_only_removes_legacy_types() {
        let conn = setup_api_key_migration_db();

        insert_pool_credential(&conn, "legacy-openai", "openai_key");
        insert_pool_credential(&conn, "legacy-claude", "claude_key");
        insert_pool_credential(&conn, "new-gemini", "gemini_api_key");

        let deleted = cleanup_legacy_api_key_credentials(&conn).unwrap();
        assert_eq!(deleted, 2);

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM provider_pool_credentials",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 1);

        let deleted_again = cleanup_legacy_api_key_credentials(&conn).unwrap();
        assert_eq!(deleted_again, 0);
    }
}
