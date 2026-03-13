//! Telegram 远程触发命令
//!
//! 提供单通道（Telegram）入站能力，复用 WebSocket RPC 处理器，
//! 将 Telegram 命令映射到 `agent.run / agent.wait / agent.stop / cron.* / sessions.*`。

use crate::app::LogState;
use crate::database::DbConnection;
use chrono::Utc;
use proxycast_websocket::handlers::{RpcHandler, RpcHandlerState};
use proxycast_websocket::protocol::{
    AgentRunResult, AgentStopResult, AgentWaitResult, CronHealthResult, CronListResult,
    CronRunResult, GatewayRpcRequest, GatewayRpcResponse, RpcMethod, SessionGetResult,
    SessionsListResult,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const TELEGRAM_API_BASE: &str = "https://api.telegram.org";
const DEFAULT_POLL_TIMEOUT_SECS: u64 = 25;
const TELEGRAM_MAX_MESSAGE_LEN: usize = 3800;
const CONFIRMATION_TTL_SECS: i64 = 90;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTelegramRemoteRequest {
    pub bot_token: String,
    pub allowed_chat_id: String,
    pub poll_timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TelegramRemoteStatus {
    pub running: bool,
    pub allowed_chat_id: Option<String>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub last_update_id: Option<i64>,
    pub last_command_at: Option<String>,
    pub pending_confirmation_expires_at: Option<String>,
}

pub struct TelegramRemoteState {
    pub inner: Arc<RwLock<TelegramRemoteRuntime>>,
}

#[derive(Default)]
pub struct TelegramRemoteRuntime {
    pub task: Option<JoinHandle<()>>,
    pub stop_token: Option<CancellationToken>,
    pub status: TelegramRemoteStatus,
    pending_confirmation: Option<PendingConfirmation>,
}

impl Default for TelegramRemoteState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(TelegramRemoteRuntime::default())),
        }
    }
}

#[derive(Debug, Clone)]
enum TelegramCommand {
    Run(String),
    Status(String),
    Stop(String),
    CronList,
    CronHealth,
    CronRun(String),
    Sessions,
    Session(String),
    Confirm(String),
    Cancel,
    Help,
}

#[derive(Debug, Clone)]
struct PendingConfirmation {
    token: String,
    command: TelegramCommand,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct TelegramApiResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
struct TelegramMessage {
    chat: TelegramChat,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
}

#[tauri::command]
pub async fn start_telegram_remote(
    state: tauri::State<'_, TelegramRemoteState>,
    db: tauri::State<'_, DbConnection>,
    logs: tauri::State<'_, LogState>,
    request: StartTelegramRemoteRequest,
) -> Result<TelegramRemoteStatus, String> {
    let bot_token = request.bot_token.trim().to_string();
    let allowed_chat_id = request.allowed_chat_id.trim().to_string();
    if bot_token.is_empty() {
        return Err("bot_token 不能为空".to_string());
    }
    if allowed_chat_id.is_empty() {
        return Err("allowed_chat_id 不能为空".to_string());
    }

    {
        let runtime = state.inner.read().await;
        if runtime.status.running {
            return Err("Telegram 远程触发已在运行".to_string());
        }
    }

    let poll_timeout_secs = request
        .poll_timeout_secs
        .unwrap_or(DEFAULT_POLL_TIMEOUT_SECS)
        .clamp(5, 60);
    let stop_token = CancellationToken::new();

    {
        let mut runtime = state.inner.write().await;
        runtime.status = TelegramRemoteStatus {
            running: true,
            allowed_chat_id: Some(allowed_chat_id.clone()),
            started_at: Some(Utc::now().to_rfc3339()),
            last_error: None,
            last_update_id: runtime.status.last_update_id,
            last_command_at: None,
            pending_confirmation_expires_at: None,
        };
        runtime.stop_token = Some(stop_token.clone());
        runtime.pending_confirmation = None;
    }

    let runtime_state = state.inner.clone();
    let db_conn = db.inner().clone();
    let log_store = logs.inner().clone();
    let handle = tokio::spawn(async move {
        run_telegram_loop(
            runtime_state,
            db_conn,
            log_store,
            bot_token,
            allowed_chat_id,
            poll_timeout_secs,
            stop_token,
        )
        .await;
    });

    let current_status = {
        let mut runtime = state.inner.write().await;
        runtime.task = Some(handle);
        runtime.status.clone()
    };

    Ok(current_status)
}

#[tauri::command]
pub async fn stop_telegram_remote(
    state: tauri::State<'_, TelegramRemoteState>,
) -> Result<TelegramRemoteStatus, String> {
    let (stop_token, task) = {
        let mut runtime = state.inner.write().await;
        let token = runtime.stop_token.take();
        let task = runtime.task.take();
        runtime.status.running = false;
        runtime.status.pending_confirmation_expires_at = None;
        runtime.pending_confirmation = None;
        (token, task)
    };

    if let Some(token) = stop_token {
        token.cancel();
    }

    if let Some(task) = task {
        match tokio::time::timeout(std::time::Duration::from_secs(3), task).await {
            Ok(_) => {}
            Err(_) => {
                // 超时后直接取消任务
            }
        }
    }

    Ok(state.inner.read().await.status.clone())
}

#[tauri::command]
pub async fn get_telegram_remote_status(
    state: tauri::State<'_, TelegramRemoteState>,
) -> Result<TelegramRemoteStatus, String> {
    Ok(state.inner.read().await.status.clone())
}

async fn run_telegram_loop(
    runtime_state: Arc<RwLock<TelegramRemoteRuntime>>,
    db: DbConnection,
    logs: LogState,
    bot_token: String,
    allowed_chat_id: String,
    poll_timeout_secs: u64,
    stop_token: CancellationToken,
) {
    logs.write()
        .await
        .add("info", "[TelegramRemote] 开始轮询 Telegram 更新");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(poll_timeout_secs + 10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let rpc_state = RpcHandlerState::new(Some(db), None, logs.clone());
    let rpc_handler = RpcHandler::new(rpc_state);

    let mut offset = runtime_state
        .read()
        .await
        .status
        .last_update_id
        .unwrap_or(0);

    loop {
        if stop_token.is_cancelled() {
            break;
        }

        let updates = match fetch_updates(&client, &bot_token, offset, poll_timeout_secs).await {
            Ok(items) => {
                clear_runtime_error(&runtime_state).await;
                items
            }
            Err(error) => {
                logs.write()
                    .await
                    .add("warn", &format!("[TelegramRemote] 拉取更新失败: {}", error));
                set_runtime_error(&runtime_state, error).await;
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            }
        };

        for update in updates {
            offset = offset.max(update.update_id);
            set_last_update_id(&runtime_state, offset).await;

            let message = match update.message {
                Some(msg) => msg,
                None => continue,
            };

            let chat_id_str = message.chat.id.to_string();
            if chat_id_str != allowed_chat_id {
                let _ = send_message(
                    &client,
                    &bot_token,
                    message.chat.id,
                    "❌ 无权限：当前 chat_id 未被授权",
                )
                .await;
                continue;
            }

            let text = match message.text {
                Some(text) => text,
                None => continue,
            };

            set_last_command_at(&runtime_state).await;

            let command = match parse_telegram_command(&text) {
                Ok(cmd) => cmd,
                Err(error) => {
                    let _ = send_message(&client, &bot_token, message.chat.id, &error).await;
                    continue;
                }
            };

            let reply = match handle_command(&runtime_state, &rpc_handler, command).await {
                Ok(text) => text,
                Err(error) => format!("❌ {}", error),
            };

            if let Err(error) = send_message(&client, &bot_token, message.chat.id, &reply).await {
                logs.write()
                    .await
                    .add("warn", &format!("[TelegramRemote] 发送回复失败: {}", error));
            }
        }
    }

    {
        let mut runtime = runtime_state.write().await;
        runtime.status.running = false;
        runtime.stop_token = None;
        runtime.task = None;
    }
    logs.write()
        .await
        .add("info", "[TelegramRemote] 已停止轮询 Telegram 更新");
}

async fn fetch_updates(
    client: &reqwest::Client,
    bot_token: &str,
    current_offset: i64,
    timeout_secs: u64,
) -> Result<Vec<TelegramUpdate>, String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/getUpdates");
    let offset = current_offset.saturating_add(1);
    let response = client
        .get(url)
        .query(&[
            ("timeout", timeout_secs.to_string()),
            ("offset", offset.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {e}"))?;

    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let parsed: TelegramApiResponse<Vec<TelegramUpdate>> =
        serde_json::from_str(&body).map_err(|e| format!("响应解析失败: {e}"))?;

    if !parsed.ok {
        return Err(parsed
            .description
            .unwrap_or_else(|| "Telegram API 返回失败".to_string()));
    }

    Ok(parsed.result.unwrap_or_default())
}

async fn send_message(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    text: &str,
) -> Result<(), String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/sendMessage");
    let payload = json!({
        "chat_id": chat_id,
        "text": truncate_message(text),
    });
    let response = client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("发送消息失败: {e}"))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let parsed: TelegramApiResponse<serde_json::Value> =
        serde_json::from_str(&body).map_err(|e| format!("响应解析失败: {e}"))?;
    if !parsed.ok {
        return Err(parsed
            .description
            .unwrap_or_else(|| "Telegram API 返回失败".to_string()));
    }
    Ok(())
}

fn parse_telegram_command(text: &str) -> Result<TelegramCommand, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(help_text());
    }
    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let first = parts.next().unwrap_or_default();
    let rest = parts.next().unwrap_or_default().trim();
    let normalized_cmd = first
        .split('@')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    match normalized_cmd.as_str() {
        "/run" => {
            if rest.is_empty() {
                Err("❌ 用法：/run <任务内容>".to_string())
            } else {
                Ok(TelegramCommand::Run(rest.to_string()))
            }
        }
        "/status" => {
            if rest.is_empty() {
                Err("❌ 用法：/status <run_id>".to_string())
            } else {
                Ok(TelegramCommand::Status(rest.to_string()))
            }
        }
        "/stop" => {
            if rest.is_empty() {
                Err("❌ 用法：/stop <run_id>".to_string())
            } else {
                Ok(TelegramCommand::Stop(rest.to_string()))
            }
        }
        "/cron_list" => Ok(TelegramCommand::CronList),
        "/cron_health" => Ok(TelegramCommand::CronHealth),
        "/cron_run" => {
            if rest.is_empty() {
                Err("❌ 用法：/cron_run <task_id>".to_string())
            } else {
                Ok(TelegramCommand::CronRun(rest.to_string()))
            }
        }
        "/sessions" => Ok(TelegramCommand::Sessions),
        "/session" => {
            if rest.is_empty() {
                Err("❌ 用法：/session <session_id>".to_string())
            } else {
                Ok(TelegramCommand::Session(rest.to_string()))
            }
        }
        "/confirm" => {
            if rest.is_empty() {
                Err("❌ 用法：/confirm <token>".to_string())
            } else {
                Ok(TelegramCommand::Confirm(rest.to_string()))
            }
        }
        "/cancel" => Ok(TelegramCommand::Cancel),
        "/help" | "/start" => Ok(TelegramCommand::Help),
        _ => Err(help_text()),
    }
}

async fn handle_command(
    runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>,
    rpc_handler: &RpcHandler,
    command: TelegramCommand,
) -> Result<String, String> {
    match command {
        TelegramCommand::Help => Ok(help_text()),
        TelegramCommand::Confirm(token) => {
            let confirmed_command = take_confirmed_command(runtime_state, &token).await?;
            dispatch_command(rpc_handler, confirmed_command).await
        }
        TelegramCommand::Cancel => {
            cancel_pending_confirmation(runtime_state).await;
            Ok("🧹 已取消待确认操作".to_string())
        }
        command if requires_confirmation(&command) => {
            let label = danger_command_label(&command);
            let token = set_pending_confirmation(runtime_state, command).await;
            Ok(format!(
                "⚠️ 检测到危险操作：{}\n请在 {} 秒内发送 /confirm {} 继续，或发送 /cancel 取消。",
                label, CONFIRMATION_TTL_SECS, token
            ))
        }
        command => dispatch_command(rpc_handler, command).await,
    }
}

async fn dispatch_command(
    rpc_handler: &RpcHandler,
    command: TelegramCommand,
) -> Result<String, String> {
    let request = build_rpc_request(command)?;
    let response = rpc_handler.handle_request(request).await;
    format_rpc_response(response)
}

fn build_rpc_request(command: TelegramCommand) -> Result<GatewayRpcRequest, String> {
    let (method, params) = match command {
        TelegramCommand::Run(message) => (
            RpcMethod::AgentRun,
            Some(json!({
                "message": message,
                "stream": false,
                "web_search": true,
                "search_mode": "allowed"
            })),
        ),
        TelegramCommand::Status(run_id) => (
            RpcMethod::AgentWait,
            Some(json!({ "run_id": run_id, "timeout": 200 })),
        ),
        TelegramCommand::Stop(run_id) => (RpcMethod::AgentStop, Some(json!({ "run_id": run_id }))),
        TelegramCommand::CronList => (RpcMethod::CronList, None),
        TelegramCommand::CronHealth => (RpcMethod::CronHealth, None),
        TelegramCommand::CronRun(task_id) => {
            (RpcMethod::CronRun, Some(json!({ "task_id": task_id })))
        }
        TelegramCommand::Sessions => (RpcMethod::SessionsList, None),
        TelegramCommand::Session(session_id) => (
            RpcMethod::SessionsGet,
            Some(json!({ "session_id": session_id })),
        ),
        TelegramCommand::Help => return Err("内部错误：help 不应构造 RPC 请求".to_string()),
        TelegramCommand::Confirm(_) => {
            return Err("内部错误：confirm 不应构造 RPC 请求".to_string())
        }
        TelegramCommand::Cancel => return Err("内部错误：cancel 不应构造 RPC 请求".to_string()),
    };

    Ok(GatewayRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Uuid::new_v4().to_string(),
        method,
        params,
    })
}

fn format_rpc_response(response: GatewayRpcResponse) -> Result<String, String> {
    if let Some(error) = response.error {
        return Err(format!("{} (code={})", error.message, error.code));
    }

    let result_value = response
        .result
        .ok_or_else(|| "RPC 返回缺少 result".to_string())?;
    match response_id_hint(&result_value) {
        Some(ResponseHint::AgentRun) => {
            let payload: AgentRunResult = parse_result(result_value)?;
            Ok(format!(
                "✅ 已启动\nrun_id: {}\nsession_id: {}\ncompleted: {}",
                payload.run_id, payload.session_id, payload.completed
            ))
        }
        Some(ResponseHint::AgentWait) => {
            let payload: AgentWaitResult = parse_result(result_value)?;
            if payload.completed {
                Ok(format!(
                    "✅ 已完成\nrun_id: {}\n{}",
                    payload.run_id,
                    payload.content.unwrap_or_else(|| "无输出内容".to_string())
                ))
            } else {
                Ok(format!("⏳ 运行中\nrun_id: {}", payload.run_id))
            }
        }
        Some(ResponseHint::AgentStop) => {
            let payload: AgentStopResult = parse_result(result_value)?;
            Ok(format!(
                "{} run_id: {}",
                if payload.stopped {
                    "🛑 已停止"
                } else {
                    "ℹ️ 未找到活跃任务"
                },
                payload.run_id
            ))
        }
        Some(ResponseHint::CronList) => {
            let payload: CronListResult = parse_result(result_value)?;
            if payload.tasks.is_empty() {
                Ok("📭 当前无定时任务".to_string())
            } else {
                let lines = payload
                    .tasks
                    .iter()
                    .take(10)
                    .map(|item| {
                        format!(
                            "- {} | {} | enabled={}",
                            item.task_id, item.name, item.enabled
                        )
                    })
                    .collect::<Vec<_>>();
                Ok(format!(
                    "📌 定时任务（前 {} 条）\n{}",
                    lines.len(),
                    lines.join("\n")
                ))
            }
        }
        Some(ResponseHint::CronRun) => {
            let payload: CronRunResult = parse_result(result_value)?;
            Ok(format!(
                "✅ cron 已触发\ntask_id: {}\nexecution_id: {}",
                payload.task_id, payload.execution_id
            ))
        }
        Some(ResponseHint::CronHealth) => {
            let payload: CronHealthResult = parse_result(result_value)?;
            let risky = payload
                .top_risky_tasks
                .iter()
                .take(5)
                .map(|item| {
                    format!(
                        "- {} | status={} | fail={} | retry={}",
                        item.task_id, item.status, item.consecutive_failures, item.retry_count
                    )
                })
                .collect::<Vec<_>>();
            let risky_section = if risky.is_empty() {
                "无".to_string()
            } else {
                risky.join("\n")
            };
            let alerts = payload
                .alerts
                .iter()
                .take(3)
                .map(|item| format!("- [{}] {}", item.severity, item.message))
                .collect::<Vec<_>>();
            let alert_section = if alerts.is_empty() {
                "无".to_string()
            } else {
                alerts.join("\n")
            };
            Ok(format!(
                "📊 cron 健康概览\n总任务: {}\n待执行: {}\n运行中: {}\n失败: {}\n冷却中: {}\n悬挂运行: {}\n24h 失败: {}\n告警:\n{}\n高风险任务:\n{}",
                payload.total_tasks,
                payload.pending_tasks,
                payload.running_tasks,
                payload.failed_tasks,
                payload.cooldown_tasks,
                payload.stale_running_tasks,
                payload.failed_last_24h,
                alert_section,
                risky_section
            ))
        }
        Some(ResponseHint::SessionsList) => {
            let payload: SessionsListResult = parse_result(result_value)?;
            if payload.sessions.is_empty() {
                Ok("📭 当前无会话".to_string())
            } else {
                let lines = payload
                    .sessions
                    .iter()
                    .take(10)
                    .map(|item| {
                        format!(
                            "- {} | model={} | msgs={}",
                            item.session_id, item.model, item.message_count
                        )
                    })
                    .collect::<Vec<_>>();
                Ok(format!(
                    "🧵 会话列表（前 {} 条）\n{}",
                    lines.len(),
                    lines.join("\n")
                ))
            }
        }
        Some(ResponseHint::SessionGet) => {
            let payload: SessionGetResult = parse_result(result_value)?;
            Ok(format!(
                "🧵 会话详情\nsession_id: {}\nmodel: {}\nmessages: {}",
                payload.session_id, payload.model, payload.message_count
            ))
        }
        None => Ok(format!("✅ 已处理\n{}", result_value)),
    }
}

enum ResponseHint {
    AgentRun,
    AgentWait,
    AgentStop,
    CronList,
    CronRun,
    CronHealth,
    SessionsList,
    SessionGet,
}

fn response_id_hint(value: &serde_json::Value) -> Option<ResponseHint> {
    if value.get("runId").is_some() && value.get("sessionId").is_some() {
        return Some(ResponseHint::AgentRun);
    }
    if value.get("runId").is_some() && value.get("completed").is_some() {
        return Some(ResponseHint::AgentWait);
    }
    if value.get("runId").is_some() && value.get("stopped").is_some() {
        return Some(ResponseHint::AgentStop);
    }
    if value.get("tasks").is_some() {
        return Some(ResponseHint::CronList);
    }
    if value.get("taskId").is_some() && value.get("executionId").is_some() {
        return Some(ResponseHint::CronRun);
    }
    if value.get("totalTasks").is_some() && value.get("cooldownTasks").is_some() {
        return Some(ResponseHint::CronHealth);
    }
    if value.get("sessions").is_some() {
        return Some(ResponseHint::SessionsList);
    }
    if value.get("sessionId").is_some() && value.get("messageCount").is_some() {
        return Some(ResponseHint::SessionGet);
    }
    None
}

fn parse_result<T: DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("解析 RPC 结果失败: {e}"))
}

fn truncate_message(text: &str) -> String {
    if text.chars().count() <= TELEGRAM_MAX_MESSAGE_LEN {
        return text.to_string();
    }
    let truncated: String = text.chars().take(TELEGRAM_MAX_MESSAGE_LEN).collect();
    format!("{truncated}\n...[truncated]")
}

fn help_text() -> String {
    [
        "🤖 ProxyCast Telegram 远程命令",
        "/run <任务内容> - 启动一个 Agent 任务",
        "/status <run_id> - 查看任务状态",
        "/stop <run_id> - 停止任务（需确认）",
        "/cron_list - 列出定时任务",
        "/cron_health - 查看定时任务健康概览",
        "/cron_run <task_id> - 触发定时任务（需确认）",
        "/sessions - 列出会话",
        "/session <session_id> - 查看会话摘要",
        "/confirm <token> - 确认危险操作",
        "/cancel - 取消待确认操作",
        "/help - 查看帮助",
    ]
    .join("\n")
}

fn requires_confirmation(command: &TelegramCommand) -> bool {
    matches!(
        command,
        TelegramCommand::Stop(_) | TelegramCommand::CronRun(_)
    )
}

fn danger_command_label(command: &TelegramCommand) -> &'static str {
    match command {
        TelegramCommand::Stop(_) => "/stop",
        TelegramCommand::CronRun(_) => "/cron_run",
        _ => "unknown",
    }
}

async fn set_pending_confirmation(
    runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>,
    command: TelegramCommand,
) -> String {
    let token = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let expires_at = Utc::now() + chrono::Duration::seconds(CONFIRMATION_TTL_SECS);
    let mut runtime = runtime_state.write().await;
    runtime.pending_confirmation = Some(PendingConfirmation {
        token: token.clone(),
        command,
        expires_at,
    });
    runtime.status.pending_confirmation_expires_at = Some(expires_at.to_rfc3339());
    token
}

async fn take_confirmed_command(
    runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>,
    token: &str,
) -> Result<TelegramCommand, String> {
    let mut runtime = runtime_state.write().await;
    let pending = runtime
        .pending_confirmation
        .take()
        .ok_or_else(|| "当前没有待确认操作".to_string())?;
    runtime.status.pending_confirmation_expires_at = None;

    if Utc::now() > pending.expires_at {
        return Err("确认已过期，请重新发起命令".to_string());
    }
    if pending.token != token {
        runtime.pending_confirmation = Some(pending);
        runtime.status.pending_confirmation_expires_at = runtime
            .pending_confirmation
            .as_ref()
            .map(|item| item.expires_at.to_rfc3339());
        return Err("确认 token 不匹配".to_string());
    }
    if !requires_confirmation(&pending.command) {
        return Err("当前命令不需要确认".to_string());
    }
    Ok(pending.command)
}

async fn cancel_pending_confirmation(runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>) {
    let mut runtime = runtime_state.write().await;
    runtime.pending_confirmation = None;
    runtime.status.pending_confirmation_expires_at = None;
}

async fn set_runtime_error(runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>, error: String) {
    let mut runtime = runtime_state.write().await;
    runtime.status.last_error = Some(error);
}

async fn clear_runtime_error(runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>) {
    let mut runtime = runtime_state.write().await;
    runtime.status.last_error = None;
}

async fn set_last_update_id(runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>, update_id: i64) {
    let mut runtime = runtime_state.write().await;
    runtime.status.last_update_id = Some(update_id);
}

async fn set_last_command_at(runtime_state: &Arc<RwLock<TelegramRemoteRuntime>>) {
    let mut runtime = runtime_state.write().await;
    runtime.status.last_command_at = Some(Utc::now().to_rfc3339());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_command_should_support_run() {
        let command = parse_telegram_command("/run 你好，帮我总结今天任务").expect("解析失败");
        match command {
            TelegramCommand::Run(text) => assert!(text.contains("总结今天任务")),
            _ => panic!("命令类型错误"),
        }
    }

    #[test]
    fn parse_command_should_reject_empty_run() {
        let error = parse_telegram_command("/run").expect_err("应当返回错误");
        assert!(error.contains("用法"));
    }

    #[test]
    fn parse_command_should_support_bot_suffix() {
        let command = parse_telegram_command("/status@my_bot run-123").expect("解析失败");
        match command {
            TelegramCommand::Status(run_id) => assert_eq!(run_id, "run-123"),
            _ => panic!("命令类型错误"),
        }
    }

    #[test]
    fn parse_command_should_support_confirm() {
        let command = parse_telegram_command("/confirm abc123").expect("解析失败");
        match command {
            TelegramCommand::Confirm(token) => assert_eq!(token, "abc123"),
            _ => panic!("命令类型错误"),
        }
    }

    #[test]
    fn parse_command_should_support_cron_health() {
        let command = parse_telegram_command("/cron_health").expect("解析失败");
        match command {
            TelegramCommand::CronHealth => {}
            _ => panic!("命令类型错误"),
        }
    }

    #[test]
    fn stop_command_should_require_confirmation() {
        assert!(requires_confirmation(&TelegramCommand::Stop(
            "run-id".to_string()
        )));
        assert!(!requires_confirmation(&TelegramCommand::Run(
            "hello".to_string()
        )));
    }

    #[test]
    fn truncate_message_should_limit_length() {
        let long_text = "a".repeat(5000);
        let truncated = truncate_message(&long_text);
        assert!(truncated.chars().count() <= TELEGRAM_MAX_MESSAGE_LEN + 20);
        assert!(truncated.contains("[truncated]"));
    }
}
