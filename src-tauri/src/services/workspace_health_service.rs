use crate::workspace::{Workspace, WorkspaceManager, WorkspaceUpdate};
use proxycast_core::app_paths;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct WorkspaceReadyResult {
    pub root_path: PathBuf,
    pub existed: bool,
    pub created: bool,
    pub repaired: bool,
    pub relocated: bool,
    pub previous_root_path: Option<PathBuf>,
    pub warning: Option<String>,
}

/// 确保 workspace 根目录可用。
///
/// 返回值：
/// - `Ok(true)`: 目录原本不存在，已自动创建
/// - `Ok(false)`: 目录已存在且可用
/// - `Err(...)`: 路径非法/无权限等不可恢复错误
pub fn ensure_workspace_root_ready(workspace_root: &Path) -> Result<bool, String> {
    if workspace_root.exists() {
        if workspace_root.is_dir() {
            return Ok(false);
        }
        return Err(format!(
            "Workspace 路径存在但不是目录: {}。请删除同名文件或重新选择目录。",
            workspace_root.to_string_lossy()
        ));
    }

    std::fs::create_dir_all(workspace_root).map_err(|error| {
        let path_str = workspace_root.to_string_lossy();
        let hint = workspace_root
            .parent()
            .map(|parent| {
                if !parent.exists() {
                    format!("父目录 '{}' 不存在", parent.display())
                } else if std::fs::metadata(parent)
                    .map(|metadata| metadata.permissions().readonly())
                    .unwrap_or(false)
                {
                    format!("父目录 '{}' 无写入权限", parent.display())
                } else {
                    format!("错误: {error}")
                }
            })
            .unwrap_or_else(|| format!("错误: {error}"));
        format!(
            "Workspace 路径不存在，且自动创建失败: {path_str}。{hint}。请重新选择一个有效的本地目录。"
        )
    })?;

    Ok(true)
}

pub fn ensure_workspace_ready_with_auto_relocate(
    manager: &WorkspaceManager,
    workspace: &Workspace,
) -> Result<WorkspaceReadyResult, String> {
    let original_root = workspace.root_path.clone();

    match ensure_workspace_root_ready(&original_root) {
        Ok(created) => Ok(WorkspaceReadyResult {
            root_path: original_root,
            existed: !created,
            created,
            repaired: created,
            relocated: false,
            previous_root_path: None,
            warning: None,
        }),
        Err(primary_error) => {
            let fallback_root = build_workspace_fallback_root(workspace)?;
            if fallback_root == original_root {
                return Err(primary_error);
            }

            let fallback_created =
                ensure_workspace_root_ready(&fallback_root).map_err(|fallback_error| {
                    format!("{primary_error}；自动迁移到托管目录失败: {fallback_error}")
                })?;

            manager
                .update(
                    &workspace.id,
                    WorkspaceUpdate {
                        root_path: Some(fallback_root.clone()),
                        ..WorkspaceUpdate::default()
                    },
                )
                .map_err(|error| format!("Workspace 自动迁移后更新配置失败: {error}"))?;

            let warning = format!(
                "Workspace 原路径不可用，已自动迁移到托管目录: {} -> {}",
                original_root.display(),
                fallback_root.display()
            );

            tracing::warn!(
                "[WorkspaceHealth] {} (workspace_id={})",
                warning,
                workspace.id
            );

            Ok(WorkspaceReadyResult {
                root_path: fallback_root,
                existed: !fallback_created,
                created: fallback_created,
                repaired: true,
                relocated: true,
                previous_root_path: Some(original_root),
                warning: Some(warning),
            })
        }
    }
}

fn build_workspace_fallback_root(workspace: &Workspace) -> Result<PathBuf, String> {
    let recovered_root = app_paths::resolve_projects_dir()?.join("recovered");
    let workspace_name = sanitize_path_segment(&workspace.name);
    let short_id: String = workspace.id.chars().take(8).collect();
    let dir_name = if short_id.is_empty() {
        workspace_name
    } else {
        format!("{}-{}", workspace_name, short_id)
    };
    Ok(recovered_root.join(dir_name))
}

fn sanitize_path_segment(raw: &str) -> String {
    let sanitized: String = raw
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        })
        .collect();

    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed
    }
}
