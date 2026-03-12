//! 修复 [object Promise] 路径污染问题 + 统一会话工作目录
//!
//! 历史 bug：
//! 1. 前端代码未正确 await Promise，导致 root_path 和 working_dir
//!    被存储为 "[object Promise]/Project-xxx" 格式的字符串。
//! 2. 旧会话的 working_dir 指向不同的项目目录，与默认 workspace 不匹配。
//!
//! 本迁移自动检测并修复这些问题。

use rusqlite::{params, Connection};

use crate::app_paths;

use super::migration_support::{
    is_migration_completed, mark_migration_completed, run_in_transaction,
};

/// 迁移设置键名
const MIGRATION_KEY_FIX_PROMISE_PATHS: &str = "migrated_fix_promise_paths_v1";
const MIGRATION_KEY_UNIFY_SESSION_DIRS: &str = "migrated_unify_session_dirs_v1";

/// 迁移结果
pub struct MigrationResult {
    /// 是否执行了迁移
    pub executed: bool,
    /// 修复的 workspace 数量
    pub fixed_workspaces: usize,
    /// 修复的 agent_session 数量
    pub fixed_sessions: usize,
    /// 统一到默认 workspace 的会话数量
    pub unified_sessions: usize,
}

/// 执行 [object Promise] 路径修复迁移
pub fn migrate_fix_promise_paths(conn: &Connection) -> Result<MigrationResult, String> {
    let promise_done = is_migration_completed(conn, MIGRATION_KEY_FIX_PROMISE_PATHS);
    let unify_done = is_migration_completed(conn, MIGRATION_KEY_UNIFY_SESSION_DIRS);

    if promise_done && unify_done {
        tracing::debug!("[迁移] Promise 路径修复和会话目录统一已执行过，跳过");
        return Ok(MigrationResult {
            executed: false,
            fixed_workspaces: 0,
            fixed_sessions: 0,
            unified_sessions: 0,
        });
    }

    let default_path = app_paths::resolve_projects_dir()?
        .to_string_lossy()
        .to_string();

    match run_in_transaction(conn, |tx| {
        let result = execute_migration(tx, &default_path, promise_done, unify_done)?;
        if !promise_done {
            mark_migration_completed(tx, MIGRATION_KEY_FIX_PROMISE_PATHS)?;
        }
        if !unify_done {
            mark_migration_completed(tx, MIGRATION_KEY_UNIFY_SESSION_DIRS)?;
        }
        Ok(result)
    }) {
        Ok((fixed_ws, fixed_sess, unified_sess)) => {
            if fixed_ws > 0 || fixed_sess > 0 {
                tracing::info!(
                    "[迁移] Promise 路径修复完成: 修复 workspaces={}, sessions={}",
                    fixed_ws,
                    fixed_sess
                );
            }
            if unified_sess > 0 {
                tracing::info!(
                    "[迁移] 会话目录统一完成: 统一 {} 个会话到默认 workspace",
                    unified_sess
                );
            }

            Ok(MigrationResult {
                executed: fixed_ws > 0 || fixed_sess > 0 || unified_sess > 0,
                fixed_workspaces: fixed_ws,
                fixed_sessions: fixed_sess,
                unified_sessions: unified_sess,
            })
        }
        Err(error) => {
            tracing::error!("[迁移] 路径修复和会话统一失败，已回滚: {}", error);
            Err(error)
        }
    }
}

fn execute_migration(
    conn: &Connection,
    default_path: &str,
    promise_done: bool,
    unify_done: bool,
) -> Result<(usize, usize, usize), String> {
    let mut fixed_ws = 0;
    let mut fixed_sess = 0;
    let mut unified_sess = 0;

    // 步骤 1: 修复 [object Promise] 路径污染（如果未完成）
    if !promise_done {
        let workspace_count = count_corrupted_workspaces(conn);
        let session_count = count_corrupted_sessions(conn);

        if workspace_count > 0 || session_count > 0 {
            tracing::info!(
                "[迁移] 发现 Promise 路径污染数据: workspaces={}, sessions={}，开始修复",
                workspace_count,
                session_count
            );

            // 修复 workspaces 表的 root_path
            fixed_ws = conn
                .execute(
                    "UPDATE workspaces SET root_path = REPLACE(root_path, '[object Promise]', ?1) \
                     WHERE root_path LIKE '%[object Promise]%'",
                    params![default_path],
                )
                .map_err(|e| format!("修复 workspaces.root_path 失败: {e}"))?;

            // 修复 agent_sessions 表的 working_dir
            fixed_sess = conn
                .execute(
                    "UPDATE agent_sessions SET working_dir = REPLACE(working_dir, '[object Promise]', ?1) \
                     WHERE working_dir LIKE '%[object Promise]%'",
                    params![default_path],
                )
                .map_err(|e| format!("修复 agent_sessions.working_dir 失败: {e}"))?;
        }
    }

    // 步骤 2: 统一所有会话的 working_dir 到默认 workspace（如果未完成）
    if !unify_done {
        // 获取默认 workspace 的 root_path
        let default_workspace_path = get_default_workspace_path(conn)?;

        if let Some(default_ws_path) = default_workspace_path {
            // 统计需要更新的会话数量
            let mismatched_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM agent_sessions \
                     WHERE working_dir IS NOT NULL \
                     AND working_dir != '' \
                     AND working_dir != ?1",
                    params![&default_ws_path],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if mismatched_count > 0 {
                tracing::info!(
                    "[迁移] 发现 {} 个会话的 working_dir 与默认 workspace 不匹配，开始统一",
                    mismatched_count
                );

                // 将所有会话的 working_dir 统一到默认 workspace
                unified_sess = conn
                    .execute(
                        "UPDATE agent_sessions SET working_dir = ?1 \
                         WHERE working_dir IS NOT NULL \
                         AND working_dir != '' \
                         AND working_dir != ?1",
                        params![&default_ws_path],
                    )
                    .map_err(|e| format!("统一会话 working_dir 失败: {e}"))?;
            }
        } else {
            tracing::warn!("[迁移] 未找到默认 workspace，跳过会话目录统一");
        }
    }

    Ok((fixed_ws, fixed_sess, unified_sess))
}

/// 获取默认 workspace 的 root_path
fn get_default_workspace_path(conn: &Connection) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT root_path FROM workspaces WHERE is_default = 1 LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(path) => Ok(Some(path)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("查询默认 workspace 失败: {e}")),
    }
}

fn count_corrupted_workspaces(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM workspaces WHERE root_path LIKE '%[object Promise]%'",
        [],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

fn count_corrupted_sessions(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM agent_sessions WHERE working_dir LIKE '%[object Promise]%'",
        [],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
}
