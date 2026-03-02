//! 服务器控制命令
//!
//! 包含服务器启动、停止、状态查询等命令。

use crate::app::types::{AppState, LogState};
use crate::app::TokenCacheServiceState;
use crate::commands::provider_pool_cmd::ProviderPoolServiceState;
use crate::commands::telemetry_cmd::TelemetryState;
use crate::database;
use chrono::{Duration, Utc};
use proxycast_infra::telemetry::RequestStatus;
use proxycast_server as server;
use std::collections::HashSet;

/// 启动服务器
#[tauri::command]
pub async fn start_server(
    state: tauri::State<'_, AppState>,
    logs: tauri::State<'_, LogState>,
    db: tauri::State<'_, database::DbConnection>,
    pool_service: tauri::State<'_, ProviderPoolServiceState>,
    token_cache: tauri::State<'_, TokenCacheServiceState>,
) -> Result<String, String> {
    let mut s = state.write().await;
    logs.write().await.add("info", "Starting server...");
    s.start(
        logs.inner().clone(),
        pool_service.0.clone(),
        token_cache.0.clone(),
        Some(db.inner().clone()),
    )
    .await
    .map_err(|e| e.to_string())?;

    // 使用 status() 获取实际使用的地址（可能已经自动切换到有效的 IP）
    let status = s.status();
    logs.write().await.add(
        "info",
        &format!("Server started on {}:{}", status.host, status.port),
    );
    Ok("Server started".to_string())
}

/// 停止服务器
#[tauri::command]
pub async fn stop_server(
    state: tauri::State<'_, AppState>,
    logs: tauri::State<'_, LogState>,
) -> Result<String, String> {
    let mut s = state.write().await;
    s.stop().await;
    logs.write().await.add("info", "Server stopped");
    Ok("Server stopped".to_string())
}

/// 获取服务器状态
#[tauri::command]
pub async fn get_server_status(
    state: tauri::State<'_, AppState>,
    db: tauri::State<'_, database::DbConnection>,
    pool_service: tauri::State<'_, ProviderPoolServiceState>,
    telemetry_state: tauri::State<'_, TelemetryState>,
) -> Result<server::ServerStatus, String> {
    let s = state.read().await;
    let mut status = s.status();

    // 从遥测系统获取真实请求计数
    let stats = telemetry_state.stats.read();
    let summary = stats.summary(None);
    status.requests = summary.total_requests;

    // 最近 1 分钟统计
    let one_minute_ago = Utc::now() - Duration::minutes(1);
    let recent_logs: Vec<_> = stats
        .get_all()
        .into_iter()
        .filter(|log| log.timestamp >= one_minute_ago)
        .collect();

    let total_1m = recent_logs.len() as u64;
    let error_count_1m = recent_logs
        .iter()
        .filter(|log| matches!(log.status, RequestStatus::Failed | RequestStatus::Timeout))
        .count() as u64;
    status.error_rate_1m = if total_1m == 0 {
        0.0
    } else {
        error_count_1m as f64 / total_1m as f64
    };

    let mut latencies: Vec<u64> = recent_logs.iter().map(|log| log.duration_ms).collect();
    latencies.sort_unstable();
    status.p95_latency_ms_1m = if latencies.is_empty() {
        None
    } else {
        let last_index = latencies.len().saturating_sub(1);
        let p95_index = (last_index * 95) / 100;
        latencies.get(p95_index).copied()
    };

    // 使用凭证健康状态近似熔断状态：统计当前不健康的上游类型数量
    status.open_circuit_count = match pool_service.0.get_all_credential_health(db.inner()) {
        Ok(health_list) => {
            let unhealthy_provider_count = health_list
                .into_iter()
                .filter(|item| !item.is_healthy)
                .map(|item| item.provider_type)
                .collect::<HashSet<_>>()
                .len();
            u32::try_from(unhealthy_provider_count).unwrap_or(u32::MAX)
        }
        Err(err) => {
            tracing::warn!("[SERVER_STATUS] 获取凭证健康状态失败: {}", err);
            0
        }
    };
    // 使用 Retry 状态日志作为活跃请求近似值
    status.active_requests = recent_logs
        .iter()
        .filter(|log| matches!(log.status, RequestStatus::Retrying))
        .count() as u64;
    status.capability_routing = s.capability_routing_metrics_store.snapshot();
    status.response_cache = s.response_cache_store.stats();
    status.request_dedup = s.request_dedup_store.stats();
    status.idempotency = s.idempotency_store.stats();

    Ok(status)
}

/// 获取服务器诊断信息（对标 /stats 与 /cache 端点）
#[tauri::command]
pub async fn get_server_diagnostics(
    state: tauri::State<'_, AppState>,
    telemetry_state: tauri::State<'_, TelemetryState>,
) -> Result<server::ServerDiagnostics, String> {
    let s = state.read().await;
    let status = s.status();
    let telemetry_summary = telemetry_state.stats.read().summary(None);

    Ok(server::build_server_diagnostics(
        status.running,
        status.host,
        status.port,
        telemetry_summary,
        status.capability_routing,
        s.response_cache_store.as_ref(),
        s.request_dedup_store.as_ref(),
        s.idempotency_store.as_ref(),
    ))
}
