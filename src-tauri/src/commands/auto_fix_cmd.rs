//! 自动修复命令
//!
//! 提供自动检测和修复常见配置问题的功能

use crate::database::dao::provider_pool::ProviderPoolDao;
use crate::database::DbConnection;
use crate::models::provider_pool_model::PoolProviderType;
use crate::{config, AppState, LogState, ProviderType};
use serde::{Deserialize, Serialize};
use tauri::State;

/// 自动修复结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoFixResult {
    pub issues_found: Vec<String>,
    pub fixes_applied: Vec<String>,
    pub warnings: Vec<String>,
}

/// 自动检测并修复配置问题
#[tauri::command]
pub async fn auto_fix_configuration(
    state: State<'_, AppState>,
    logs: State<'_, LogState>,
    db: State<'_, DbConnection>,
) -> Result<AutoFixResult, String> {
    let mut result = AutoFixResult {
        issues_found: Vec::new(),
        fixes_applied: Vec::new(),
        warnings: Vec::new(),
    };

    logs.write()
        .await
        .add("info", "[自动修复] 开始检测配置问题...");

    // 检查默认Provider配置
    if let Err(e) = fix_default_provider_issue(&state, &logs, &db, &mut result).await {
        result
            .warnings
            .push(format!("修复默认Provider时出错: {}", e));
    }

    // 检查凭证池状态
    if let Err(e) = check_credential_pool_issues(&db, &mut result).await {
        result.warnings.push(format!("检查凭证池时出错: {}", e));
    }

    logs.write().await.add(
        "info",
        &format!(
            "[自动修复] 完成，发现 {} 个问题，修复 {} 个",
            result.issues_found.len(),
            result.fixes_applied.len()
        ),
    );

    Ok(result)
}

/// 修复默认Provider配置问题
async fn fix_default_provider_issue(
    state: &State<'_, AppState>,
    logs: &State<'_, LogState>,
    db: &State<'_, DbConnection>,
    result: &mut AutoFixResult,
) -> Result<(), String> {
    let current_default = {
        let s = state.read().await;
        s.config.default_provider.clone()
    };

    // 获取可用的凭证类型统计
    let credential_stats = get_credential_stats(db).await?;

    // 检查是否有Kiro凭证但默认Provider不是kiro
    if credential_stats.kiro_count > 0 && current_default != "kiro" {
        result.issues_found.push(format!(
            "默认Provider设置为 '{}' 但有 {} 个Kiro凭证可用",
            current_default, credential_stats.kiro_count
        ));

        // 自动修复：设置默认Provider为kiro
        if let Err(e) = set_default_provider_internal(state, logs, "kiro".to_string()).await {
            result
                .warnings
                .push(format!("无法自动修复默认Provider: {}", e));
        } else {
            result
                .fixes_applied
                .push("默认Provider已自动设置为 'kiro'".to_string());
            logs.write()
                .await
                .add("info", "[自动修复] 默认Provider已设置为kiro");
        }
    }
    // 检查是否默认Provider指向的凭证类型不可用
    else if !is_provider_available(&current_default, &credential_stats) {
        result
            .issues_found
            .push(format!("默认Provider '{}' 没有可用凭证", current_default));

        // 寻找最佳替代Provider
        if let Some(best_provider) = find_best_available_provider(&credential_stats) {
            if let Err(e) = set_default_provider_internal(state, logs, best_provider.clone()).await
            {
                result
                    .warnings
                    .push(format!("无法自动修复默认Provider: {}", e));
            } else {
                result
                    .fixes_applied
                    .push(format!("默认Provider已自动设置为 '{}'", best_provider));
                logs.write().await.add(
                    "info",
                    &format!("[自动修复] 默认Provider已设置为{}", best_provider),
                );
            }
        } else {
            result
                .warnings
                .push("没有找到可用的Provider作为默认选择".to_string());
        }
    }

    Ok(())
}

/// 获取凭证统计信息
#[derive(Debug, Default)]
struct CredentialStats {
    kiro_count: usize,
    gemini_count: usize,
    qwen_count: usize,
    openai_count: usize,
    claude_count: usize,
    total_count: usize,
}

async fn get_credential_stats(db: &State<'_, DbConnection>) -> Result<CredentialStats, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stats = CredentialStats::default();

    // 统计各类型凭证数量（只计算启用且健康的凭证）
    let all_credentials = ProviderPoolDao::get_all(&conn).map_err(|e| e.to_string())?;

    for cred in all_credentials
        .iter()
        .filter(|c| !c.is_disabled && c.is_healthy)
    {
        match cred.provider_type {
            PoolProviderType::Kiro => stats.kiro_count += 1,
            PoolProviderType::Gemini => stats.gemini_count += 1,
            PoolProviderType::Qwen => stats.qwen_count += 1,
            PoolProviderType::OpenAI => stats.openai_count += 1,
            PoolProviderType::Claude => stats.claude_count += 1,
            _ => {}
        }
        stats.total_count += 1;
    }

    tracing::info!(
        "[自动修复] 凭证统计: kiro={}, gemini={}, qwen={}, claude={}, openai={}, total={}",
        stats.kiro_count,
        stats.gemini_count,
        stats.qwen_count,
        stats.claude_count,
        stats.openai_count,
        stats.total_count
    );

    Ok(stats)
}

/// 检查Provider是否有可用凭证
fn is_provider_available(provider: &str, stats: &CredentialStats) -> bool {
    match provider {
        "kiro" => stats.kiro_count > 0,
        "gemini" => stats.gemini_count > 0,
        "qwen" => stats.qwen_count > 0,
        "openai" => stats.openai_count > 0,
        "claude" => stats.claude_count > 0,
        _ => false,
    }
}

/// 寻找最佳可用Provider
fn find_best_available_provider(stats: &CredentialStats) -> Option<String> {
    // 优先级：kiro > gemini > qwen > claude > openai
    if stats.kiro_count > 0 {
        Some("kiro".to_string())
    } else if stats.gemini_count > 0 {
        Some("gemini".to_string())
    } else if stats.qwen_count > 0 {
        Some("qwen".to_string())
    } else if stats.claude_count > 0 {
        Some("claude".to_string())
    } else if stats.openai_count > 0 {
        Some("openai".to_string())
    } else {
        None
    }
}

/// 内部设置默认Provider函数
async fn set_default_provider_internal(
    state: &State<'_, AppState>,
    _logs: &State<'_, LogState>,
    provider: String,
) -> Result<(), String> {
    // 验证provider
    let _provider_type: ProviderType = provider.parse().map_err(|e: String| e)?;

    let mut s = state.write().await;
    s.config.default_provider = provider.clone();

    // 同时更新运行中服务器的 default_provider_ref
    {
        let mut dp = s.default_provider_ref.write().await;
        *dp = provider.clone();
    }

    config::save_config(&s.config).map_err(|e| e.to_string())?;

    Ok(())
}

/// 检查凭证池问题
async fn check_credential_pool_issues(
    db: &State<'_, DbConnection>,
    result: &mut AutoFixResult,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let credentials = ProviderPoolDao::get_all(&conn).map_err(|e| e.to_string())?;

    // 检查是否有过期的token缓存
    let mut expired_tokens = 0;
    for cred in &credentials {
        if let Some(ref token_info) = cred.cached_token {
            if let Some(expiry) = token_info.expiry_time {
                if chrono::Utc::now() > expiry {
                    expired_tokens += 1;
                }
            }
        }
    }

    if expired_tokens > 0 {
        result
            .issues_found
            .push(format!("发现 {} 个过期的token缓存", expired_tokens));
        // 过期token会在使用时自动刷新，这里只是报告
    }

    // 检查是否有禁用的凭证
    let disabled_count = credentials.iter().filter(|c| c.is_disabled).count();
    if disabled_count > 0 {
        result
            .issues_found
            .push(format!("有 {} 个凭证被禁用", disabled_count));
    }

    Ok(())
}
