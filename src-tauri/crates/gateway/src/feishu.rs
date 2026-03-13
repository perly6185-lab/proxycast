//! Feishu Gateway 运行时
//!
//! 目标：将 Feishu 作为标准渠道接入全局 Gateway。
//! 当前版本已支持：
//! - 多账号启动/停止/状态/探测
//! - Webhook 入站消息 -> RPC agent 执行 -> Feishu 回包
//! - 会话路由、/new 会话旋转、核心命令
//! - websocket 模式配置（当前为占位运行，后续替换为真实长连接实现）

use axum::body::Bytes;
use axum::extract::{OriginalUri, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::{Json, Router};
use chrono::Utc;
use proxycast_core::config::{Config, FeishuBotConfig, FeishuGroupConfig};
use proxycast_core::database::DbConnection;
use proxycast_core::logger::LogStore;
use proxycast_websocket::handlers::{RpcHandler, RpcHandlerState};
use proxycast_websocket::protocol::{
    AgentRunResult, AgentStopResult, AgentWaitResult, CronHealthResult, CronListResult,
    CronRunResult, GatewayRpcRequest, GatewayRpcResponse, RpcMethod, SessionGetResult,
    SessionsListResult,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const FEISHU_MAX_MESSAGE_LEN: usize = 1800;
const RUN_WAIT_TIMEOUT_MS: u64 = 1200;
const RUN_WAIT_MAX_ROUNDS: usize = 180;
const CONFIRMATION_TTL_SECS: i64 = 90;

type LogState = Arc<RwLock<LogStore>>;
type SessionRouteState = Arc<RwLock<HashMap<String, String>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamingMode {
    Off,
    Partial,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReplyToMode {
    Off,
    First,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PlainTextReply {
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeishuGatewayAccountStatus {
    pub account_id: String,
    pub running: bool,
    pub connection_mode: String,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub last_event_at: Option<String>,
    pub last_message_at: Option<String>,
    pub webhook_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeishuGatewayStatus {
    pub running_accounts: usize,
    pub accounts: Vec<FeishuGatewayAccountStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuProbeResult {
    pub account_id: String,
    pub ok: bool,
    pub app_id: Option<String>,
    pub message: String,
}

pub struct FeishuGatewayState {
    inner: Arc<RwLock<FeishuGatewayRuntime>>,
}

struct FeishuGatewayRuntime {
    accounts: HashMap<String, AccountRuntimeHandle>,
}

struct AccountRuntimeHandle {
    stop_token: CancellationToken,
    task: JoinHandle<()>,
    status: Arc<RwLock<FeishuGatewayAccountStatus>>,
}

impl Default for FeishuGatewayState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(FeishuGatewayRuntime {
                accounts: HashMap::new(),
            })),
        }
    }
}

#[derive(Debug, Clone)]
struct ResolvedFeishuAccount {
    account_id: String,
    app_id: String,
    app_secret: String,
    verification_token: Option<String>,
    encrypt_key: Option<String>,
    default_model: Option<String>,
    domain: String,
    connection_mode: String,
    webhook_host: String,
    webhook_port: u16,
    webhook_path: String,
    dm_policy: String,
    allow_from: HashSet<String>,
    group_policy: String,
    group_allow_from: HashSet<String>,
    groups: HashMap<String, FeishuGroupConfig>,
    streaming: String,
    reply_to_mode: String,
}

#[derive(Debug, Clone)]
struct InboundMessage {
    message_id: String,
    chat_id: String,
    chat_kind: String,
    sender_id: Option<String>,
    text: String,
    raw_content: Option<String>,
}

#[derive(Debug, Clone)]
struct ReceiveTarget {
    receive_id_type: &'static str,
    receive_id: String,
}

#[derive(Debug, Clone)]
struct PendingConfirmation {
    token: String,
    command: FeishuCommand,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
enum FeishuCommand {
    Run(String),
    New(Option<String>),
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
struct TenantTokenCacheEntry {
    token: String,
    expires_at_epoch: i64,
}

type TokenCacheState = Arc<RwLock<Option<TenantTokenCacheEntry>>>;

#[derive(Clone)]
struct WebhookContext {
    account: ResolvedFeishuAccount,
    client: reqwest::Client,
    rpc_handler: Arc<RpcHandler>,
    logs: LogState,
    session_route_state: SessionRouteState,
    token_cache: TokenCacheState,
    status: Arc<RwLock<FeishuGatewayAccountStatus>>,
    pending_confirmation: Arc<RwLock<Option<PendingConfirmation>>>,
    streaming_mode: StreamingMode,
    reply_to_mode: ReplyToMode,
}

pub async fn start_gateway(
    state: &FeishuGatewayState,
    db: DbConnection,
    logs: LogState,
    config: Config,
    account_filter: Option<String>,
    _poll_timeout_secs: Option<u64>,
) -> Result<FeishuGatewayStatus, String> {
    let state = state.inner.clone();
    let accounts = resolve_feishu_accounts(&config.channels.feishu, account_filter.as_deref())?;
    if accounts.is_empty() {
        return Err("没有可启动的 Feishu 账号，请检查 channels.feishu 配置".to_string());
    }

    validate_webhook_bind_conflicts(&accounts)?;

    for account in accounts {
        let existing = {
            let runtime = state.read().await;
            runtime.accounts.contains_key(&account.account_id)
        };
        if existing {
            continue;
        }

        let status = Arc::new(RwLock::new(FeishuGatewayAccountStatus {
            account_id: account.account_id.clone(),
            running: true,
            connection_mode: account.connection_mode.clone(),
            started_at: Some(Utc::now().to_rfc3339()),
            last_error: None,
            last_event_at: None,
            last_message_at: None,
            webhook_endpoint: None,
        }));
        let status_for_task = status.clone();
        let stop_token = CancellationToken::new();
        let stop_for_task = stop_token.clone();
        let account_for_task = account.clone();
        let state_for_task = state.clone();
        let db_for_task = db.clone();
        let logs_for_task = logs.clone();

        let task = tokio::spawn(async move {
            run_account_loop(
                state_for_task,
                status_for_task,
                db_for_task,
                logs_for_task,
                account_for_task,
                stop_for_task,
            )
            .await;
        });

        let mut runtime = state.write().await;
        runtime.accounts.insert(
            account.account_id.clone(),
            AccountRuntimeHandle {
                stop_token,
                task,
                status,
            },
        );
    }

    snapshot_status(state).await
}

pub async fn stop_gateway(
    state: &FeishuGatewayState,
    account_filter: Option<String>,
) -> Result<FeishuGatewayStatus, String> {
    let state = state.inner.clone();
    let mut handles = Vec::new();
    {
        let mut runtime = state.write().await;
        if let Some(account_id) = account_filter {
            if let Some(handle) = runtime.accounts.remove(&account_id) {
                handles.push(handle);
            }
        } else {
            handles = runtime.accounts.drain().map(|(_, handle)| handle).collect();
        }
    }

    for handle in &handles {
        handle.stop_token.cancel();
    }
    for handle in handles {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), handle.task).await;
    }

    snapshot_status(state).await
}

pub async fn status_gateway(state: &FeishuGatewayState) -> Result<FeishuGatewayStatus, String> {
    snapshot_status(state.inner.clone()).await
}

pub async fn probe_gateway_account(
    config: &Config,
    account_filter: Option<String>,
) -> Result<FeishuProbeResult, String> {
    let accounts = resolve_feishu_accounts(&config.channels.feishu, account_filter.as_deref())?;
    if accounts.is_empty() {
        return Err("未找到可用 Feishu 账号".to_string());
    }
    let account = if let Some(filter) = account_filter {
        accounts
            .into_iter()
            .find(|item| item.account_id == filter)
            .ok_or_else(|| format!("未找到 Feishu 账号: {filter}"))?
    } else {
        accounts[0].clone()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let cache: TokenCacheState = Arc::new(RwLock::new(None));

    match get_tenant_access_token(&client, &account, &cache).await {
        Ok(_) => Ok(FeishuProbeResult {
            account_id: account.account_id,
            ok: true,
            app_id: Some(account.app_id),
            message: "Feishu 凭证可用".to_string(),
        }),
        Err(error) => Ok(FeishuProbeResult {
            account_id: account.account_id,
            ok: false,
            app_id: Some(account.app_id),
            message: error,
        }),
    }
}

async fn snapshot_status(
    state: Arc<RwLock<FeishuGatewayRuntime>>,
) -> Result<FeishuGatewayStatus, String> {
    let handles = {
        let runtime = state.read().await;
        runtime
            .accounts
            .values()
            .map(|handle| handle.status.clone())
            .collect::<Vec<_>>()
    };
    let mut accounts = Vec::with_capacity(handles.len());
    for status in handles {
        accounts.push(status.read().await.clone());
    }
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    Ok(FeishuGatewayStatus {
        running_accounts: accounts.iter().filter(|item| item.running).count(),
        accounts,
    })
}

fn validate_webhook_bind_conflicts(accounts: &[ResolvedFeishuAccount]) -> Result<(), String> {
    let mut seen = HashSet::new();
    for account in accounts {
        if normalize_connection_mode(&account.connection_mode) != "webhook" {
            continue;
        }
        let key = format!(
            "{}:{}:{}",
            account.webhook_host,
            account.webhook_port,
            normalize_webhook_path(&account.webhook_path)
        );
        if !seen.insert(key.clone()) {
            return Err(format!(
                "Feishu webhook 监听冲突（host:port:path 重复）: {}",
                key
            ));
        }
    }
    Ok(())
}

async fn run_account_loop(
    runtime_state: Arc<RwLock<FeishuGatewayRuntime>>,
    status: Arc<RwLock<FeishuGatewayAccountStatus>>,
    db: DbConnection,
    logs: LogState,
    account: ResolvedFeishuAccount,
    stop_token: CancellationToken,
) {
    let streaming_mode = parse_streaming_mode(&account.streaming);
    let reply_to_mode = parse_reply_to_mode(&account.reply_to_mode);

    logs.write().await.add(
        "info",
        &format!(
            "[FeishuGateway] 启动账号: account={} mode={} streaming={} replyToMode={}",
            account.account_id, account.connection_mode, account.streaming, account.reply_to_mode
        ),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let rpc_state = RpcHandlerState::new(Some(db), None, logs.clone());
    let rpc_handler = Arc::new(RpcHandler::new(rpc_state));
    let session_route_state: SessionRouteState = Arc::new(RwLock::new(HashMap::new()));
    let token_cache: TokenCacheState = Arc::new(RwLock::new(None));
    let pending_confirmation: Arc<RwLock<Option<PendingConfirmation>>> =
        Arc::new(RwLock::new(None));

    let run_result = if normalize_connection_mode(&account.connection_mode) == "webhook" {
        run_webhook_server(
            WebhookContext {
                account: account.clone(),
                client: client.clone(),
                rpc_handler: rpc_handler.clone(),
                logs: logs.clone(),
                session_route_state: session_route_state.clone(),
                token_cache: token_cache.clone(),
                status: status.clone(),
                pending_confirmation: pending_confirmation.clone(),
                streaming_mode,
                reply_to_mode,
            },
            stop_token.clone(),
        )
        .await
    } else {
        run_websocket_placeholder(&account, &logs, &status, stop_token.clone()).await
    };

    if let Err(error) = run_result {
        status.write().await.last_error = Some(error.clone());
        logs.write().await.add(
            "warn",
            &format!(
                "[FeishuGateway] account={} 运行失败: {}",
                account.account_id, error
            ),
        );
    }

    {
        let mut s = status.write().await;
        s.running = false;
    }
    {
        let mut runtime = runtime_state.write().await;
        runtime.accounts.remove(&account.account_id);
    }
    logs.write().await.add(
        "info",
        &format!("[FeishuGateway] 账号已停止: account={}", account.account_id),
    );
}

async fn run_websocket_placeholder(
    account: &ResolvedFeishuAccount,
    logs: &LogState,
    status: &Arc<RwLock<FeishuGatewayAccountStatus>>,
    stop_token: CancellationToken,
) -> Result<(), String> {
    let message = "websocket 模式占位已启动（后续将替换为 Feishu 真实长连接实现）";
    status.write().await.last_error = Some(message.to_string());
    logs.write().await.add(
        "warn",
        &format!("[FeishuGateway] account={} {}", account.account_id, message),
    );

    while !stop_token.is_cancelled() {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    Ok(())
}

async fn run_webhook_server(
    context: WebhookContext,
    stop_token: CancellationToken,
) -> Result<(), String> {
    let endpoint = format!(
        "http://{}:{}{}",
        context.account.webhook_host,
        context.account.webhook_port,
        normalize_webhook_path(&context.account.webhook_path)
    );
    {
        let mut status = context.status.write().await;
        status.webhook_endpoint = Some(endpoint.clone());
    }
    context.logs.write().await.add(
        "info",
        &format!(
            "[FeishuGateway] account={} webhook 监听: {}",
            context.account.account_id, endpoint
        ),
    );

    let listener = tokio::net::TcpListener::bind(format!(
        "{}:{}",
        context.account.webhook_host, context.account.webhook_port
    ))
    .await
    .map_err(|e| format!("绑定 webhook 监听失败: {e}"))?;

    let app = Router::new()
        .route("/*path", any(feishu_webhook_handler))
        .with_state(Arc::new(context));

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(async move {
            stop_token.cancelled().await;
        })
        .await
        .map_err(|e| format!("webhook 服务异常退出: {e}"))
}

async fn feishu_webhook_handler(
    State(context): State<Arc<WebhookContext>>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    body: Bytes,
) -> Response {
    let expected_path = normalize_webhook_path(&context.account.webhook_path);
    if uri.path() != expected_path {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    if method != Method::POST && method != Method::GET {
        return (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response();
    }
    if body.len() > 2 * 1024 * 1024 {
        return (StatusCode::PAYLOAD_TOO_LARGE, "payload too large").into_response();
    }

    let payload: serde_json::Value = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(_) => {
                context.logs.write().await.add(
                    "warn",
                    &format!(
                        "[FeishuGateway] account={} webhook JSON 解析失败: path={} bytes={}",
                        context.account.account_id,
                        uri.path(),
                        body.len()
                    ),
                );
                return (StatusCode::BAD_REQUEST, "invalid json").into_response();
            }
        }
    };

    let event_type = payload
        .pointer("/header/event_type")
        .and_then(|value| value.as_str())
        .or_else(|| {
            payload
                .pointer("/event/type")
                .and_then(|value| value.as_str())
        })
        .unwrap_or("<empty>")
        .to_string();
    let has_encrypt = payload.get("encrypt").is_some();
    let has_challenge = payload.get("challenge").is_some();
    context.logs.write().await.add(
        "info",
        &format!(
            "[FeishuGateway] account={} webhook 请求: method={} path={} bytes={} eventType={} encrypt={} challenge={}",
            context.account.account_id,
            method.as_str(),
            uri.path(),
            body.len(),
            event_type,
            has_encrypt,
            has_challenge
        ),
    );

    if let Some(challenge) = payload.get("challenge").and_then(|value| value.as_str()) {
        return Json(json!({ "challenge": challenge })).into_response();
    }

    if has_encrypt {
        context.logs.write().await.add(
            "warn",
            &format!(
                "[FeishuGateway] account={} 收到加密事件（encrypt_key_configured={}），当前未启用 decrypt 实现",
                context.account.account_id,
                context.account.encrypt_key.is_some()
            ),
        );
        return (StatusCode::NOT_IMPLEMENTED, "encrypt not supported yet").into_response();
    }

    if let Some(expected_token) = context.account.verification_token.as_deref() {
        let actual_token = payload
            .pointer("/header/token")
            .and_then(|value| value.as_str())
            .or_else(|| payload.get("token").and_then(|value| value.as_str()))
            .unwrap_or_default();
        if !expected_token.trim().is_empty() && expected_token.trim() != actual_token {
            context.logs.write().await.add(
                "warn",
                &format!(
                    "[FeishuGateway] account={} verification token 不匹配: actual={}",
                    context.account.account_id, actual_token
                ),
            );
            return (StatusCode::FORBIDDEN, "verification token mismatch").into_response();
        }
    }

    context.status.write().await.last_event_at = Some(Utc::now().to_rfc3339());

    if let Some(inbound) = parse_inbound_message(&payload) {
        context.status.write().await.last_message_at = Some(Utc::now().to_rfc3339());
        let ctx = context.clone();
        tokio::spawn(async move {
            process_inbound_message(ctx, inbound).await;
        });
    } else if event_type != "<empty>" {
        context.logs.write().await.add(
            "info",
            &format!(
                "[FeishuGateway] account={} 忽略非消息事件: eventType={}",
                context.account.account_id, event_type
            ),
        );
    }

    Json(json!({ "code": 0 })).into_response()
}

async fn process_inbound_message(context: Arc<WebhookContext>, inbound: InboundMessage) {
    let text = inbound.text.trim();
    if text.is_empty() {
        return;
    }

    let text_preview = summarize_text_preview(text, 64);
    context.logs.write().await.add(
        "info",
        &format!(
            "[FeishuGateway] account={} 收到入站消息: chat={} kind={} sender={:?} messageId={} text={}",
            context.account.account_id,
            inbound.chat_id,
            inbound.chat_kind,
            inbound.sender_id,
            inbound.message_id,
            text_preview
        ),
    );

    if let Err(reason) = authorize_message(&context.account, &inbound) {
        if let Err(error) = send_text_chunks(
            &context.client,
            &context.account,
            &context.token_cache,
            &inbound,
            &format!("❌ 拒绝访问: {}", reason),
        )
        .await
        {
            context.logs.write().await.add(
                "warn",
                &format!(
                    "[FeishuGateway] account={} 拒绝提示发送失败: chat={} err={}",
                    context.account.account_id, inbound.chat_id, error
                ),
            );
        }
        context.logs.write().await.add(
            "warn",
            &format!(
                "[FeishuGateway] account={} 拒绝消息: chat={} sender={:?} reason={}",
                context.account.account_id, inbound.chat_id, inbound.sender_id, reason
            ),
        );
        return;
    }

    if text.starts_with('/') {
        let command = match parse_feishu_command(text) {
            Ok(value) => value,
            Err(error) => {
                if let Err(send_error) = send_text_chunks(
                    &context.client,
                    &context.account,
                    &context.token_cache,
                    &inbound,
                    &error,
                )
                .await
                {
                    context.logs.write().await.add(
                        "warn",
                        &format!(
                            "[FeishuGateway] account={} 命令错误提示发送失败: chat={} err={}",
                            context.account.account_id, inbound.chat_id, send_error
                        ),
                    );
                }
                return;
            }
        };
        let result = handle_command(&context, &inbound, command).await;
        if let Some(reply_text) = match result {
            Ok(Some(text)) => Some(text),
            Ok(None) => None,
            Err(error) => Some(format!("❌ {}", error)),
        } {
            if let Err(send_error) = send_text_chunks(
                &context.client,
                &context.account,
                &context.token_cache,
                &inbound,
                &reply_text,
            )
            .await
            {
                context.logs.write().await.add(
                    "warn",
                    &format!(
                        "[FeishuGateway] account={} 命令回包发送失败: chat={} err={}",
                        context.account.account_id, inbound.chat_id, send_error
                    ),
                );
            }
        }
        return;
    }

    let reply = match handle_plain_text(
        &context.client,
        &context.account,
        context.rpc_handler.as_ref(),
        &context.logs,
        &context.session_route_state,
        &inbound,
        text.to_string(),
        None,
        context.streaming_mode,
        context.reply_to_mode,
    )
    .await
    {
        Ok(PlainTextReply::Message(text)) => Some(text),
        Err(error) => Some(format!("❌ {}", error)),
    };

    if let Some(reply_text) = reply {
        if let Err(send_error) = send_text_chunks(
            &context.client,
            &context.account,
            &context.token_cache,
            &inbound,
            &reply_text,
        )
        .await
        {
            context.logs.write().await.add(
                "warn",
                &format!(
                    "[FeishuGateway] account={} 文本回包发送失败: chat={} err={}",
                    context.account.account_id, inbound.chat_id, send_error
                ),
            );
        }
    }
}

fn parse_inbound_message(payload: &serde_json::Value) -> Option<InboundMessage> {
    let event_type = payload
        .pointer("/header/event_type")
        .and_then(|value| value.as_str())
        .or_else(|| {
            payload
                .pointer("/event/type")
                .and_then(|value| value.as_str())
        })
        .unwrap_or_default();

    if event_type != "im.message.receive_v1" {
        return None;
    }

    let event = payload.get("event")?;
    let message = event.get("message")?;
    let chat_id = message.get("chat_id")?.as_str()?.trim().to_string();
    if chat_id.is_empty() {
        return None;
    }
    let chat_kind = message
        .get("chat_type")
        .and_then(|value| value.as_str())
        .unwrap_or("group")
        .to_string();
    let message_id = message
        .get("message_id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let message_type = message
        .get("message_type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let content_raw = message
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let sender_id = event
        .pointer("/sender/sender_id/open_id")
        .and_then(|value| value.as_str())
        .or_else(|| {
            event
                .pointer("/sender/sender_id/user_id")
                .and_then(|value| value.as_str())
        })
        .or_else(|| {
            event
                .pointer("/sender/sender_id/union_id")
                .and_then(|value| value.as_str())
        })
        .map(|value| value.to_string());

    let text = extract_text_from_message_content(message_type, &content_raw);
    if text.trim().is_empty() {
        return None;
    }

    Some(InboundMessage {
        message_id,
        chat_id,
        chat_kind,
        sender_id,
        text,
        raw_content: Some(content_raw),
    })
}

fn extract_text_from_message_content(message_type: &str, raw_content: &str) -> String {
    if raw_content.trim().is_empty() {
        return String::new();
    }
    match message_type {
        "text" => {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw_content) {
                return value
                    .get("text")
                    .and_then(|item| item.as_str())
                    .unwrap_or_default()
                    .to_string();
            }
            raw_content.to_string()
        }
        "post" => {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw_content) {
                let mut lines = Vec::new();
                if let Some(content) = value.pointer("/zh_cn/content").and_then(|v| v.as_array()) {
                    for row in content {
                        if let Some(cols) = row.as_array() {
                            for cell in cols {
                                if let Some(text) = cell.get("text").and_then(|v| v.as_str()) {
                                    if !text.trim().is_empty() {
                                        lines.push(text.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                return lines.join("\n");
            }
            raw_content.to_string()
        }
        _ => String::new(),
    }
}

fn normalize_connection_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "webhook" => "webhook".to_string(),
        _ => "websocket".to_string(),
    }
}

fn normalize_webhook_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "/feishu/events".to_string();
    }
    if trimmed.starts_with('/') {
        return trimmed.to_string();
    }
    format!("/{}", trimmed)
}

fn normalize_allow_entry(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("feishu:")
        .trim_start_matches("lark:")
        .trim_start_matches("open_id:")
        .to_ascii_lowercase()
}

fn normalize_allow_set(input: &[String]) -> HashSet<String> {
    input
        .iter()
        .map(|item| normalize_allow_entry(item))
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>()
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
}

fn normalize_dm_policy(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "allowlist" => "allowlist".to_string(),
        "open" => "open".to_string(),
        "disabled" => "disabled".to_string(),
        _ => "pairing".to_string(),
    }
}

fn normalize_group_policy(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "open" => "open".to_string(),
        "disabled" => "disabled".to_string(),
        _ => "allowlist".to_string(),
    }
}

fn normalize_streaming_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "off" => "off".to_string(),
        "block" => "block".to_string(),
        _ => "partial".to_string(),
    }
}

fn normalize_reply_to_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "first" => "first".to_string(),
        "all" => "all".to_string(),
        _ => "off".to_string(),
    }
}

fn parse_streaming_mode(raw: &str) -> StreamingMode {
    match normalize_streaming_mode(raw).as_str() {
        "off" => StreamingMode::Off,
        "block" => StreamingMode::Block,
        _ => StreamingMode::Partial,
    }
}

fn parse_reply_to_mode(raw: &str) -> ReplyToMode {
    match normalize_reply_to_mode(raw).as_str() {
        "first" => ReplyToMode::First,
        "all" => ReplyToMode::All,
        _ => ReplyToMode::Off,
    }
}

fn resolve_feishu_accounts(
    feishu: &FeishuBotConfig,
    account_filter: Option<&str>,
) -> Result<Vec<ResolvedFeishuAccount>, String> {
    if !feishu.enabled {
        return Ok(Vec::new());
    }

    let mut resolved = Vec::new();

    if feishu.accounts.is_empty() {
        if feishu.app_id.trim().is_empty() || feishu.app_secret.trim().is_empty() {
            return Ok(Vec::new());
        }
        resolved.push(ResolvedFeishuAccount {
            account_id: "default".to_string(),
            app_id: feishu.app_id.trim().to_string(),
            app_secret: feishu.app_secret.trim().to_string(),
            verification_token: normalize_optional_text(feishu.verification_token.as_deref()),
            encrypt_key: normalize_optional_text(feishu.encrypt_key.as_deref()),
            default_model: normalize_optional_text(feishu.default_model.as_deref()),
            domain: normalize_optional_text(Some(&feishu.domain))
                .unwrap_or_else(|| "feishu".to_string()),
            connection_mode: normalize_connection_mode(&feishu.connection_mode),
            webhook_host: normalize_optional_text(feishu.webhook_host.as_deref())
                .unwrap_or_else(|| "127.0.0.1".to_string()),
            webhook_port: feishu.webhook_port.unwrap_or(3000),
            webhook_path: normalize_webhook_path(feishu.webhook_path.as_deref().unwrap_or("")),
            dm_policy: normalize_dm_policy(&feishu.dm_policy),
            allow_from: normalize_allow_set(&feishu.allow_from),
            group_policy: normalize_group_policy(&feishu.group_policy),
            group_allow_from: normalize_allow_set(&feishu.group_allow_from),
            groups: feishu.groups.clone(),
            streaming: normalize_streaming_mode(&feishu.streaming),
            reply_to_mode: normalize_reply_to_mode(&feishu.reply_to_mode),
        });
    } else {
        for (account_id, account) in &feishu.accounts {
            if !account.enabled {
                continue;
            }
            let app_id = account
                .app_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| feishu.app_id.trim());
            let app_secret = account
                .app_secret
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| feishu.app_secret.trim());
            if app_id.is_empty() || app_secret.is_empty() {
                continue;
            }

            let allow_from = if account.allow_from.is_empty() {
                normalize_allow_set(&feishu.allow_from)
            } else {
                normalize_allow_set(&account.allow_from)
            };
            let group_allow_from = if account.group_allow_from.is_empty() {
                normalize_allow_set(&feishu.group_allow_from)
            } else {
                normalize_allow_set(&account.group_allow_from)
            };
            let groups = if account.groups.is_empty() {
                feishu.groups.clone()
            } else {
                account.groups.clone()
            };

            resolved.push(ResolvedFeishuAccount {
                account_id: account_id.to_string(),
                app_id: app_id.to_string(),
                app_secret: app_secret.to_string(),
                verification_token: normalize_optional_text(
                    account
                        .verification_token
                        .as_deref()
                        .or(feishu.verification_token.as_deref()),
                ),
                encrypt_key: normalize_optional_text(
                    account
                        .encrypt_key
                        .as_deref()
                        .or(feishu.encrypt_key.as_deref()),
                ),
                default_model: normalize_optional_text(
                    account
                        .default_model
                        .as_deref()
                        .or(feishu.default_model.as_deref()),
                ),
                domain: normalize_optional_text(account.domain.as_deref().or(Some(&feishu.domain)))
                    .unwrap_or_else(|| "feishu".to_string()),
                connection_mode: normalize_connection_mode(
                    account
                        .connection_mode
                        .as_deref()
                        .unwrap_or(feishu.connection_mode.as_str()),
                ),
                webhook_host: normalize_optional_text(
                    account
                        .webhook_host
                        .as_deref()
                        .or(feishu.webhook_host.as_deref()),
                )
                .unwrap_or_else(|| "127.0.0.1".to_string()),
                webhook_port: account.webhook_port.or(feishu.webhook_port).unwrap_or(3000),
                webhook_path: normalize_webhook_path(
                    account
                        .webhook_path
                        .as_deref()
                        .or(feishu.webhook_path.as_deref())
                        .unwrap_or(""),
                ),
                dm_policy: normalize_dm_policy(
                    account
                        .dm_policy
                        .as_deref()
                        .unwrap_or(feishu.dm_policy.as_str()),
                ),
                allow_from,
                group_policy: normalize_group_policy(
                    account
                        .group_policy
                        .as_deref()
                        .unwrap_or(feishu.group_policy.as_str()),
                ),
                group_allow_from,
                groups,
                streaming: normalize_streaming_mode(
                    account
                        .streaming
                        .as_deref()
                        .unwrap_or(feishu.streaming.as_str()),
                ),
                reply_to_mode: normalize_reply_to_mode(
                    account
                        .reply_to_mode
                        .as_deref()
                        .unwrap_or(feishu.reply_to_mode.as_str()),
                ),
            });
        }

        if resolved.is_empty()
            && !feishu.app_id.trim().is_empty()
            && !feishu.app_secret.trim().is_empty()
        {
            resolved.push(ResolvedFeishuAccount {
                account_id: "default".to_string(),
                app_id: feishu.app_id.trim().to_string(),
                app_secret: feishu.app_secret.trim().to_string(),
                verification_token: normalize_optional_text(feishu.verification_token.as_deref()),
                encrypt_key: normalize_optional_text(feishu.encrypt_key.as_deref()),
                default_model: normalize_optional_text(feishu.default_model.as_deref()),
                domain: normalize_optional_text(Some(&feishu.domain))
                    .unwrap_or_else(|| "feishu".to_string()),
                connection_mode: normalize_connection_mode(&feishu.connection_mode),
                webhook_host: normalize_optional_text(feishu.webhook_host.as_deref())
                    .unwrap_or_else(|| "127.0.0.1".to_string()),
                webhook_port: feishu.webhook_port.unwrap_or(3000),
                webhook_path: normalize_webhook_path(feishu.webhook_path.as_deref().unwrap_or("")),
                dm_policy: normalize_dm_policy(&feishu.dm_policy),
                allow_from: normalize_allow_set(&feishu.allow_from),
                group_policy: normalize_group_policy(&feishu.group_policy),
                group_allow_from: normalize_allow_set(&feishu.group_allow_from),
                groups: feishu.groups.clone(),
                streaming: normalize_streaming_mode(&feishu.streaming),
                reply_to_mode: normalize_reply_to_mode(&feishu.reply_to_mode),
            });
        }
    }

    if let Some(filter) = account_filter {
        let selected = resolved
            .into_iter()
            .filter(|item| item.account_id == filter)
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Err(format!("未找到 Feishu 账号: {}", filter));
        }
        return Ok(selected);
    }

    Ok(resolved)
}

fn build_session_key(account: &ResolvedFeishuAccount, inbound: &InboundMessage) -> String {
    if inbound.chat_kind == "p2p" || inbound.chat_kind == "private" {
        let sender = inbound
            .sender_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or(inbound.chat_id.as_str());
        return format!("agent:main:feishu:{}:direct:{}", account.account_id, sender);
    }
    format!(
        "agent:main:feishu:{}:group:{}",
        account.account_id, inbound.chat_id
    )
}

async fn resolve_active_session_id(
    account: &ResolvedFeishuAccount,
    inbound: &InboundMessage,
    session_route_state: &SessionRouteState,
) -> String {
    let scope_key = build_session_key(account, inbound);
    let state = session_route_state.read().await;
    state
        .get(&scope_key)
        .cloned()
        .unwrap_or_else(|| scope_key.to_string())
}

async fn rotate_active_session_id(
    account: &ResolvedFeishuAccount,
    inbound: &InboundMessage,
    session_route_state: &SessionRouteState,
) -> String {
    let scope_key = build_session_key(account, inbound);
    let suffix = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let rotated = format!("{scope_key}:new:{suffix}");
    let mut state = session_route_state.write().await;
    state.insert(scope_key, rotated.clone());
    rotated
}

fn authorize_message(
    account: &ResolvedFeishuAccount,
    inbound: &InboundMessage,
) -> Result<(), String> {
    if inbound.chat_kind == "p2p" || inbound.chat_kind == "private" {
        return authorize_dm(account, inbound.sender_id.as_deref());
    }
    authorize_group(account, inbound)
}

fn authorize_dm(account: &ResolvedFeishuAccount, sender_id: Option<&str>) -> Result<(), String> {
    let sender = sender_id
        .map(normalize_allow_entry)
        .filter(|item| !item.is_empty());

    match account.dm_policy.as_str() {
        "disabled" => Err("DM 已禁用".to_string()),
        "open" => {
            if account.allow_from.contains("*") {
                Ok(())
            } else {
                Err("dmPolicy=open 但 allow_from 缺少 '*'".to_string())
            }
        }
        "allowlist" => {
            let sender = sender.ok_or_else(|| "无法识别发送者 ID".to_string())?;
            if account.allow_from.contains(&sender) || account.allow_from.contains("*") {
                Ok(())
            } else {
                Err(format!("发送者 {} 不在 DM allow_from", sender))
            }
        }
        _ => {
            let sender = sender.ok_or_else(|| "无法识别发送者 ID".to_string())?;
            if account.allow_from.is_empty() {
                Err("dmPolicy=pairing 但未配置 allow_from（当前为 fail-closed）".to_string())
            } else if account.allow_from.contains(&sender) || account.allow_from.contains("*") {
                Ok(())
            } else {
                Err(format!("发送者 {} 未通过 pairing allow_from", sender))
            }
        }
    }
}

fn authorize_group(
    account: &ResolvedFeishuAccount,
    inbound: &InboundMessage,
) -> Result<(), String> {
    let chat_id = inbound.chat_id.as_str();
    let sender = inbound
        .sender_id
        .as_deref()
        .map(normalize_allow_entry)
        .filter(|item| !item.is_empty());

    let group_cfg = account
        .groups
        .get(chat_id)
        .or_else(|| account.groups.get("*"));
    let effective_group_policy = group_cfg
        .and_then(|group| group.group_policy.as_deref())
        .map(normalize_group_policy)
        .unwrap_or_else(|| account.group_policy.clone());
    let group_allowed = match group_cfg {
        Some(group) => group.enabled.unwrap_or(true),
        None => effective_group_policy == "open",
    };
    if !group_allowed {
        return Err(format!("群组 {} 未加入 allowlist", chat_id));
    }

    let require_mention = group_cfg
        .and_then(|group| group.require_mention)
        .unwrap_or(true);
    if require_mention
        && !is_slash_command(&inbound.text)
        && !is_message_mentioning_bot(&inbound.text, inbound.raw_content.as_deref())
    {
        return Err("群组消息需要 mention 触发".to_string());
    }

    match effective_group_policy.as_str() {
        "disabled" => Err("群组消息已禁用".to_string()),
        "open" => Ok(()),
        _ => {
            let sender = sender.ok_or_else(|| "无法识别群组发送者 ID".to_string())?;
            let allow_from = if let Some(group) = group_cfg {
                if !group.allow_from.is_empty() {
                    normalize_allow_set(&group.allow_from)
                } else if !account.group_allow_from.is_empty() {
                    account.group_allow_from.clone()
                } else {
                    account.allow_from.clone()
                }
            } else if !account.group_allow_from.is_empty() {
                account.group_allow_from.clone()
            } else {
                account.allow_from.clone()
            };
            if allow_from.contains(&sender) || allow_from.contains("*") {
                Ok(())
            } else {
                Err(format!("发送者 {} 不在群组 allow_from", sender))
            }
        }
    }
}

fn is_message_mentioning_bot(text: &str, raw_content: Option<&str>) -> bool {
    if text.contains('@') {
        return true;
    }
    raw_content
        .map(|raw| raw.contains("mentions") || raw.contains("<at "))
        .unwrap_or(false)
}

fn is_slash_command(text: &str) -> bool {
    text.trim_start().starts_with('/')
}

fn summarize_text_preview(text: &str, max_chars: usize) -> String {
    let mut preview: String = text.chars().take(max_chars).collect();
    if text.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

async fn handle_plain_text(
    client: &reqwest::Client,
    account: &ResolvedFeishuAccount,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_route_state: &SessionRouteState,
    inbound: &InboundMessage,
    text: String,
    session_id_override: Option<String>,
    _streaming_mode: StreamingMode,
    _reply_to_mode: ReplyToMode,
) -> Result<PlainTextReply, String> {
    let session_id = match session_id_override {
        Some(value) => value,
        None => resolve_active_session_id(account, inbound, session_route_state).await,
    };
    logs.write().await.add(
        "info",
        &format!(
            "[FeishuGateway] account={} 收到文本消息: chat={} sender={:?} messageId={} session={} model={} search_mode=allowed",
            account.account_id,
            inbound.chat_id,
            inbound.sender_id,
            inbound.message_id,
            session_id,
            account.default_model.as_deref().unwrap_or("<rpc-default>")
        ),
    );

    let run_response = rpc_handler
        .handle_request(GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: RpcMethod::AgentRun,
            params: Some(json!({
                "session_id": session_id,
                "message": text,
                "stream": false,
                "model": account.default_model.clone(),
                "web_search": true,
                "search_mode": "allowed",
            })),
        })
        .await;
    let run_value = run_response
        .result
        .ok_or_else(|| extract_rpc_error(run_response.error, "agent.run 失败"))?;
    let run_result: AgentRunResult = parse_result(run_value)?;
    logs.write().await.add(
        "info",
        &format!(
            "[FeishuGateway] account={} agent.run 已创建: runId={} session={}",
            account.account_id, run_result.run_id, run_result.session_id
        ),
    );

    for round in 0..RUN_WAIT_MAX_ROUNDS {
        let wait_response = rpc_handler
            .handle_request(GatewayRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Uuid::new_v4().to_string(),
                method: RpcMethod::AgentWait,
                params: Some(json!({
                    "run_id": run_result.run_id,
                    "timeout": RUN_WAIT_TIMEOUT_MS,
                })),
            })
            .await;
        let wait_value = wait_response
            .result
            .ok_or_else(|| extract_rpc_error(wait_response.error, "agent.wait 失败"))?;
        let wait_result: AgentWaitResult = parse_result(wait_value)?;
        if wait_result.completed {
            let content = wait_result
                .content
                .unwrap_or_else(|| "任务已完成，但无可展示输出".to_string());
            logs.write().await.add(
                "info",
                &format!(
                    "[FeishuGateway] account={} runId={} 已完成: contentLen={}",
                    account.account_id,
                    run_result.run_id,
                    content.chars().count()
                ),
            );
            return Ok(PlainTextReply::Message(content));
        }

        if round % 20 == 0 {
            logs.write().await.add(
                "info",
                &format!(
                    "[FeishuGateway] account={} runId={} 等待中: round={} completed={}",
                    account.account_id, run_result.run_id, round, wait_result.completed
                ),
            );
        }
        if round % 3 == 0 {
            let _ = send_chat_typing(client, account, &inbound.chat_id).await;
        }
    }

    Err("等待任务完成超时，请稍后使用 /status 查询".to_string())
}

async fn handle_command(
    context: &WebhookContext,
    inbound: &InboundMessage,
    command: FeishuCommand,
) -> Result<Option<String>, String> {
    match command {
        FeishuCommand::Help => Ok(Some(help_text())),
        FeishuCommand::Cancel => {
            *context.pending_confirmation.write().await = None;
            Ok(Some("🧹 已取消待确认操作".to_string()))
        }
        FeishuCommand::Confirm(token) => {
            let mut pending_guard = context.pending_confirmation.write().await;
            let confirmed = take_pending_confirmation(&mut pending_guard, &token)?;
            drop(pending_guard);
            dispatch_command(context.rpc_handler.as_ref(), confirmed)
                .await
                .map(Some)
        }
        cmd if requires_confirmation(&cmd) => {
            let mut pending_guard = context.pending_confirmation.write().await;
            let token = set_pending_confirmation(&mut pending_guard, cmd.clone());
            Ok(Some(format!(
                "⚠️ 检测到危险操作：{}\n请在 {} 秒内发送 /confirm {} 继续，或发送 /cancel 取消。",
                danger_command_label(&cmd),
                CONFIRMATION_TTL_SECS,
                token
            )))
        }
        FeishuCommand::Run(prompt) => {
            match handle_plain_text(
                &context.client,
                &context.account,
                context.rpc_handler.as_ref(),
                &context.logs,
                &context.session_route_state,
                inbound,
                prompt,
                None,
                context.streaming_mode,
                context.reply_to_mode,
            )
            .await?
            {
                PlainTextReply::Message(text) => Ok(Some(text)),
            }
        }
        FeishuCommand::New(first_prompt) => {
            let new_session_id =
                rotate_active_session_id(&context.account, inbound, &context.session_route_state)
                    .await;
            context.logs.write().await.add(
                "info",
                &format!(
                    "[FeishuGateway] account={} 开启新会话: chat={} session={}",
                    context.account.account_id, inbound.chat_id, new_session_id
                ),
            );
            if let Some(prompt) = first_prompt {
                match handle_plain_text(
                    &context.client,
                    &context.account,
                    context.rpc_handler.as_ref(),
                    &context.logs,
                    &context.session_route_state,
                    inbound,
                    prompt,
                    Some(new_session_id.clone()),
                    context.streaming_mode,
                    context.reply_to_mode,
                )
                .await?
                {
                    PlainTextReply::Message(text) => Ok(Some(text)),
                }
            } else {
                Ok(Some(format!(
                    "🆕 已开启新对话\nsession_id: {}\n后续消息会在这个新会话中进行。",
                    new_session_id
                )))
            }
        }
        cmd => dispatch_command(context.rpc_handler.as_ref(), cmd)
            .await
            .map(Some),
    }
}

fn parse_feishu_command(text: &str) -> Result<FeishuCommand, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(help_text());
    }
    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let first = parts.next().unwrap_or_default().to_ascii_lowercase();
    let rest = parts.next().unwrap_or_default().trim();
    match first.as_str() {
        "/run" => {
            if rest.is_empty() {
                Err("❌ 用法：/run <任务内容>".to_string())
            } else {
                Ok(FeishuCommand::Run(rest.to_string()))
            }
        }
        "/new" | "/reset" => {
            if rest.is_empty() {
                Ok(FeishuCommand::New(None))
            } else {
                Ok(FeishuCommand::New(Some(rest.to_string())))
            }
        }
        "/status" => {
            if rest.is_empty() {
                Err("❌ 用法：/status <run_id>".to_string())
            } else {
                Ok(FeishuCommand::Status(rest.to_string()))
            }
        }
        "/stop" => {
            if rest.is_empty() {
                Err("❌ 用法：/stop <run_id>".to_string())
            } else {
                Ok(FeishuCommand::Stop(rest.to_string()))
            }
        }
        "/cron_list" => Ok(FeishuCommand::CronList),
        "/cron_health" => Ok(FeishuCommand::CronHealth),
        "/cron_run" => {
            if rest.is_empty() {
                Err("❌ 用法：/cron_run <task_id>".to_string())
            } else {
                Ok(FeishuCommand::CronRun(rest.to_string()))
            }
        }
        "/sessions" => Ok(FeishuCommand::Sessions),
        "/session" => {
            if rest.is_empty() {
                Err("❌ 用法：/session <session_id>".to_string())
            } else {
                Ok(FeishuCommand::Session(rest.to_string()))
            }
        }
        "/confirm" => {
            if rest.is_empty() {
                Err("❌ 用法：/confirm <token>".to_string())
            } else {
                Ok(FeishuCommand::Confirm(rest.to_string()))
            }
        }
        "/cancel" => Ok(FeishuCommand::Cancel),
        "/help" | "/start" => Ok(FeishuCommand::Help),
        _ => Err(help_text()),
    }
}

fn requires_confirmation(command: &FeishuCommand) -> bool {
    matches!(command, FeishuCommand::Stop(_) | FeishuCommand::CronRun(_))
}

fn danger_command_label(command: &FeishuCommand) -> &'static str {
    match command {
        FeishuCommand::Stop(_) => "/stop",
        FeishuCommand::CronRun(_) => "/cron_run",
        _ => "unknown",
    }
}

fn help_text() -> String {
    [
        "🤖 ProxyCast Feishu Gateway 命令",
        "/run <任务内容> - 启动一个 Agent 任务",
        "/new [首条消息] - 开启新对话（/reset 同义）",
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

fn set_pending_confirmation(
    pending_confirmation: &mut Option<PendingConfirmation>,
    command: FeishuCommand,
) -> String {
    let token = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let expires_at = Utc::now() + chrono::Duration::seconds(CONFIRMATION_TTL_SECS);
    *pending_confirmation = Some(PendingConfirmation {
        token: token.clone(),
        command,
        expires_at,
    });
    token
}

fn take_pending_confirmation(
    pending_confirmation: &mut Option<PendingConfirmation>,
    token: &str,
) -> Result<FeishuCommand, String> {
    let pending = pending_confirmation
        .take()
        .ok_or_else(|| "当前没有待确认操作".to_string())?;
    if Utc::now() > pending.expires_at {
        return Err("确认已过期，请重新发起命令".to_string());
    }
    if pending.token != token {
        *pending_confirmation = Some(pending);
        return Err("确认 token 不匹配".to_string());
    }
    if !requires_confirmation(&pending.command) {
        return Err("当前命令不需要确认".to_string());
    }
    Ok(pending.command)
}

async fn dispatch_command(
    rpc_handler: &RpcHandler,
    command: FeishuCommand,
) -> Result<String, String> {
    let request = build_rpc_request(command)?;
    let response = rpc_handler.handle_request(request).await;
    format_rpc_response(response)
}

fn build_rpc_request(command: FeishuCommand) -> Result<GatewayRpcRequest, String> {
    let (method, params) = match command {
        FeishuCommand::Run(message) => (
            RpcMethod::AgentRun,
            Some(json!({
                "message": message,
                "stream": false,
                "web_search": true,
                "search_mode": "allowed"
            })),
        ),
        FeishuCommand::Status(run_id) => (
            RpcMethod::AgentWait,
            Some(json!({ "run_id": run_id, "timeout": 200 })),
        ),
        FeishuCommand::Stop(run_id) => (RpcMethod::AgentStop, Some(json!({ "run_id": run_id }))),
        FeishuCommand::CronList => (RpcMethod::CronList, None),
        FeishuCommand::CronHealth => (RpcMethod::CronHealth, None),
        FeishuCommand::CronRun(task_id) => {
            (RpcMethod::CronRun, Some(json!({ "task_id": task_id })))
        }
        FeishuCommand::Sessions => (RpcMethod::SessionsList, None),
        FeishuCommand::Session(session_id) => (
            RpcMethod::SessionsGet,
            Some(json!({ "session_id": session_id })),
        ),
        FeishuCommand::New(_) => return Err("内部错误：new 不应构造 RPC 请求".to_string()),
        FeishuCommand::Help => return Err("内部错误：help 不应构造 RPC 请求".to_string()),
        FeishuCommand::Confirm(_) => return Err("内部错误：confirm 不应构造 RPC 请求".to_string()),
        FeishuCommand::Cancel => return Err("内部错误：cancel 不应构造 RPC 请求".to_string()),
    };

    Ok(GatewayRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Uuid::new_v4().to_string(),
        method,
        params,
    })
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
            Ok(format!(
                "📊 cron 健康概览\n总任务: {}\n待执行: {}\n运行中: {}\n失败: {}\n冷却中: {}\n悬挂运行: {}\n24h 失败: {}",
                payload.total_tasks,
                payload.pending_tasks,
                payload.running_tasks,
                payload.failed_tasks,
                payload.cooldown_tasks,
                payload.stale_running_tasks,
                payload.failed_last_24h,
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

fn parse_result<T: DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("解析 RPC 结果失败: {e}"))
}

fn extract_rpc_error(
    error: Option<proxycast_websocket::protocol::RpcError>,
    fallback: &str,
) -> String {
    if let Some(err) = error {
        return format!("{} (code={})", err.message, err.code);
    }
    fallback.to_string()
}

fn split_message_chunks(text: &str) -> Vec<String> {
    let total_chars = text.chars().count();
    if total_chars <= FEISHU_MAX_MESSAGE_LEN {
        return vec![text.to_string()];
    }
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + FEISHU_MAX_MESSAGE_LEN).min(chars.len());
        chunks.push(chars[start..end].iter().collect::<String>());
        start = end;
    }
    chunks
}

fn resolve_api_base(domain: &str) -> String {
    let normalized = domain.trim().to_ascii_lowercase();
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        return domain.trim_end_matches('/').to_string();
    }
    if normalized == "lark" {
        "https://open.larksuite.com".to_string()
    } else {
        "https://open.feishu.cn".to_string()
    }
}

#[derive(Debug, Deserialize)]
struct FeishuTokenResponse {
    code: i32,
    msg: Option<String>,
    tenant_access_token: Option<String>,
    expire: Option<i64>,
}

async fn get_tenant_access_token(
    client: &reqwest::Client,
    account: &ResolvedFeishuAccount,
    token_cache: &TokenCacheState,
) -> Result<String, String> {
    let now = Utc::now().timestamp();
    if let Some(cached) = token_cache.read().await.clone() {
        if cached.expires_at_epoch > now + 30 {
            return Ok(cached.token);
        }
    }

    let base = resolve_api_base(&account.domain);
    let url = format!("{}/open-apis/auth/v3/tenant_access_token/internal", base);
    let response = client
        .post(url)
        .json(&json!({
            "app_id": account.app_id,
            "app_secret": account.app_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("获取 tenant_access_token 失败: {e}"))?;

    let parsed: FeishuTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 tenant_access_token 响应失败: {e}"))?;
    if parsed.code != 0 {
        return Err(format!(
            "获取 tenant_access_token 失败: {} (code={})",
            parsed.msg.unwrap_or_else(|| "unknown".to_string()),
            parsed.code
        ));
    }
    let token = parsed
        .tenant_access_token
        .ok_or_else(|| "tenant_access_token 缺失".to_string())?;
    let expire_secs = parsed.expire.unwrap_or(3600);
    *token_cache.write().await = Some(TenantTokenCacheEntry {
        token: token.clone(),
        expires_at_epoch: now + expire_secs,
    });
    Ok(token)
}

#[derive(Debug, Deserialize)]
struct FeishuApiResponse<T> {
    code: i32,
    msg: Option<String>,
    #[serde(rename = "data")]
    _data: Option<T>,
}

async fn send_text_message(
    client: &reqwest::Client,
    account: &ResolvedFeishuAccount,
    token_cache: &TokenCacheState,
    target: &ReceiveTarget,
    text: &str,
) -> Result<(), String> {
    let token = get_tenant_access_token(client, account, token_cache).await?;
    let base = resolve_api_base(&account.domain);
    let url = format!(
        "{}/open-apis/im/v1/messages?receive_id_type={}",
        base, target.receive_id_type
    );
    let content = serde_json::to_string(&json!({ "text": text }))
        .map_err(|e| format!("构造 Feishu 消息体失败: {e}"))?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .json(&json!({
            "receive_id": target.receive_id,
            "msg_type": "text",
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| format!("发送 Feishu 消息失败: {e}"))?;
    let parsed: FeishuApiResponse<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("解析 Feishu 发送响应失败: {e}"))?;
    if parsed.code != 0 {
        return Err(format!(
            "发送 Feishu 消息失败: {} (code={})",
            parsed.msg.unwrap_or_else(|| "unknown".to_string()),
            parsed.code
        ));
    }
    Ok(())
}

async fn send_text_reply_message(
    client: &reqwest::Client,
    account: &ResolvedFeishuAccount,
    token_cache: &TokenCacheState,
    message_id: &str,
    text: &str,
) -> Result<(), String> {
    let token = get_tenant_access_token(client, account, token_cache).await?;
    let base = resolve_api_base(&account.domain);
    let url = format!(
        "{}/open-apis/im/v1/messages/{}/reply",
        base,
        urlencoding::encode(message_id)
    );
    let content = serde_json::to_string(&json!({ "text": text }))
        .map_err(|e| format!("构造 Feishu 回复消息体失败: {e}"))?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .json(&json!({
            "msg_type": "text",
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| format!("发送 Feishu 回复消息失败: {e}"))?;
    let parsed: FeishuApiResponse<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("解析 Feishu 回复响应失败: {e}"))?;
    if parsed.code != 0 {
        return Err(format!(
            "发送 Feishu 回复消息失败: {} (code={})",
            parsed.msg.unwrap_or_else(|| "unknown".to_string()),
            parsed.code
        ));
    }
    Ok(())
}

fn resolve_receive_targets(inbound: &InboundMessage) -> Vec<ReceiveTarget> {
    let mut targets = Vec::new();
    let mut dedupe = HashSet::new();
    let mut push_target = |receive_id_type: &'static str, receive_id: String| {
        let key = format!("{}:{}", receive_id_type, receive_id);
        if dedupe.insert(key) {
            targets.push(ReceiveTarget {
                receive_id_type,
                receive_id,
            });
        }
    };

    push_target("chat_id", inbound.chat_id.clone());

    if (inbound.chat_kind == "p2p" || inbound.chat_kind == "private")
        && inbound.sender_id.as_deref().is_some()
    {
        let sender = inbound.sender_id.as_deref().unwrap_or_default().trim();
        if !sender.is_empty() {
            if sender.starts_with("ou_") {
                push_target("open_id", sender.to_string());
                push_target("user_id", sender.to_string());
            } else if sender.starts_with("on_") {
                push_target("union_id", sender.to_string());
                push_target("user_id", sender.to_string());
            } else {
                push_target("user_id", sender.to_string());
                push_target("open_id", sender.to_string());
            }
        }
    }

    targets
}

async fn send_text_chunks(
    client: &reqwest::Client,
    account: &ResolvedFeishuAccount,
    token_cache: &TokenCacheState,
    inbound: &InboundMessage,
    text: &str,
) -> Result<(), String> {
    let chunks = split_message_chunks(text);
    if chunks.is_empty() {
        return Ok(());
    }

    let mut errors = Vec::new();
    let message_id = inbound.message_id.trim();
    if !message_id.is_empty() {
        let mut reply_errors = Vec::new();
        for chunk in &chunks {
            if let Err(error) =
                send_text_reply_message(client, account, token_cache, message_id, chunk).await
            {
                reply_errors.push(error);
                break;
            }
        }
        if reply_errors.is_empty() {
            return Ok(());
        }
        errors.push(format!(
            "reply:{} => {}",
            message_id,
            reply_errors.join(" | ")
        ));
    }

    let targets = resolve_receive_targets(inbound);

    for target in targets {
        match send_text_message(client, account, token_cache, &target, &chunks[0]).await {
            Ok(_) => {
                for chunk in chunks.iter().skip(1) {
                    send_text_message(client, account, token_cache, &target, chunk).await?;
                }
                return Ok(());
            }
            Err(error) => {
                errors.push(format!(
                    "{}:{} => {}",
                    target.receive_id_type, target.receive_id, error
                ));
            }
        }
    }

    Err(format!(
        "发送 Feishu 消息失败（reply + receive_id 均失败）: {}",
        errors.join(" | ")
    ))
}

async fn send_chat_typing(
    client: &reqwest::Client,
    account: &ResolvedFeishuAccount,
    chat_id: &str,
) -> Result<(), String> {
    let token_cache: TokenCacheState = Arc::new(RwLock::new(None));
    let token = get_tenant_access_token(client, account, &token_cache).await?;
    let base = resolve_api_base(&account.domain);
    let url = format!("{}/open-apis/im/v1/chat", base);
    let _ = client
        .post(url)
        .bearer_auth(token)
        .json(&json!({
            "chat_id": chat_id,
            "action": "typing",
        }))
        .send()
        .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn build_account(
        dm_policy: &str,
        allow_from: &[&str],
        group_policy: &str,
    ) -> ResolvedFeishuAccount {
        let mut allow = HashSet::new();
        for item in allow_from {
            allow.insert((*item).to_string());
        }
        ResolvedFeishuAccount {
            account_id: "default".to_string(),
            app_id: "app_id".to_string(),
            app_secret: "app_secret".to_string(),
            verification_token: None,
            encrypt_key: None,
            default_model: None,
            domain: "feishu".to_string(),
            connection_mode: "webhook".to_string(),
            webhook_host: "127.0.0.1".to_string(),
            webhook_port: 3000,
            webhook_path: "/feishu/default".to_string(),
            dm_policy: dm_policy.to_string(),
            allow_from: allow,
            group_policy: group_policy.to_string(),
            group_allow_from: HashSet::new(),
            groups: HashMap::new(),
            streaming: "partial".to_string(),
            reply_to_mode: "off".to_string(),
        }
    }

    #[test]
    fn parse_command_supports_new() {
        assert!(matches!(
            parse_feishu_command("/new").expect("should parse"),
            FeishuCommand::New(None)
        ));
        assert!(matches!(
            parse_feishu_command("/reset hi").expect("should parse"),
            FeishuCommand::New(Some(_))
        ));
    }

    #[test]
    fn normalize_webhook_path_adds_prefix() {
        assert_eq!(normalize_webhook_path("feishu/events"), "/feishu/events");
        assert_eq!(normalize_webhook_path("/abc"), "/abc");
    }

    #[test]
    fn parse_inbound_message_extracts_text_message() {
        let payload = json!({
            "header": { "event_type": "im.message.receive_v1" },
            "event": {
                "message": {
                    "message_id": "om_1",
                    "chat_id": "oc_1",
                    "chat_type": "p2p",
                    "message_type": "text",
                    "content": "{\"text\":\"你好，proxycast\"}"
                },
                "sender": {
                    "sender_id": {
                        "open_id": "ou_xxx"
                    }
                }
            }
        });

        let inbound = parse_inbound_message(&payload).expect("should parse inbound");
        assert_eq!(inbound.message_id, "om_1");
        assert_eq!(inbound.chat_id, "oc_1");
        assert_eq!(inbound.chat_kind, "p2p");
        assert_eq!(inbound.sender_id.as_deref(), Some("ou_xxx"));
        assert_eq!(inbound.text, "你好，proxycast");
    }

    #[test]
    fn parse_inbound_message_extracts_union_id_sender() {
        let payload = json!({
            "header": { "event_type": "im.message.receive_v1" },
            "event": {
                "message": {
                    "message_id": "om_2",
                    "chat_id": "oc_2",
                    "chat_type": "p2p",
                    "message_type": "text",
                    "content": "{\"text\":\"hello\"}"
                },
                "sender": {
                    "sender_id": {
                        "union_id": "on_union_xxx"
                    }
                }
            }
        });

        let inbound = parse_inbound_message(&payload).expect("should parse inbound");
        assert_eq!(inbound.sender_id.as_deref(), Some("on_union_xxx"));
    }

    #[test]
    fn parse_inbound_message_ignores_non_message_event() {
        let payload = json!({
            "header": { "event_type": "im.message.message_read_v1" },
            "event": {}
        });
        assert!(parse_inbound_message(&payload).is_none());
    }

    #[test]
    fn authorize_message_dm_pairing_fail_closed_without_allow_from() {
        let account = build_account("pairing", &[], "allowlist");
        let inbound = InboundMessage {
            message_id: "m1".to_string(),
            chat_id: "c1".to_string(),
            chat_kind: "p2p".to_string(),
            sender_id: Some("ou_abc".to_string()),
            text: "你好".to_string(),
            raw_content: None,
        };
        let err = authorize_message(&account, &inbound).expect_err("should reject");
        assert!(err.contains("fail-closed"));
    }

    #[test]
    fn authorize_message_dm_allowlist_accepts_sender() {
        let account = build_account("allowlist", &["ou_abc"], "allowlist");
        let inbound = InboundMessage {
            message_id: "m1".to_string(),
            chat_id: "c1".to_string(),
            chat_kind: "private".to_string(),
            sender_id: Some("ou_abc".to_string()),
            text: "你好".to_string(),
            raw_content: None,
        };
        assert!(authorize_message(&account, &inbound).is_ok());
    }

    #[test]
    fn authorize_message_dm_open_allows_missing_sender_when_wildcard_enabled() {
        let account = build_account("open", &["*"], "allowlist");
        let inbound = InboundMessage {
            message_id: "m-open".to_string(),
            chat_id: "c-open".to_string(),
            chat_kind: "p2p".to_string(),
            sender_id: None,
            text: "你好".to_string(),
            raw_content: None,
        };
        assert!(authorize_message(&account, &inbound).is_ok());
    }

    #[test]
    fn authorize_message_group_open_allows_missing_sender() {
        let account = build_account("open", &["*"], "open");
        let inbound = InboundMessage {
            message_id: "m-group-open".to_string(),
            chat_id: "oc_group_open".to_string(),
            chat_kind: "group".to_string(),
            sender_id: None,
            text: "/status xxx".to_string(),
            raw_content: Some("{\"text\":\"/status xxx\"}".to_string()),
        };
        assert!(authorize_message(&account, &inbound).is_ok());
    }

    #[test]
    fn authorize_message_group_requires_mention_by_default() {
        let mut account = build_account("open", &["*"], "open");
        account.groups.insert(
            "oc_group_1".to_string(),
            FeishuGroupConfig {
                enabled: Some(true),
                require_mention: Some(true),
                group_policy: Some("open".to_string()),
                allow_from: vec!["*".to_string()],
            },
        );

        let inbound = InboundMessage {
            message_id: "m2".to_string(),
            chat_id: "oc_group_1".to_string(),
            chat_kind: "group".to_string(),
            sender_id: Some("ou_abc".to_string()),
            text: "普通消息".to_string(),
            raw_content: Some("{\"text\":\"普通消息\"}".to_string()),
        };
        let err = authorize_message(&account, &inbound).expect_err("should reject");
        assert!(err.contains("mention"));
    }

    #[test]
    fn resolve_receive_targets_for_p2p_includes_sender_fallbacks() {
        let inbound = InboundMessage {
            message_id: "m3".to_string(),
            chat_id: "oc_123".to_string(),
            chat_kind: "p2p".to_string(),
            sender_id: Some("ou_abc".to_string()),
            text: "hello".to_string(),
            raw_content: None,
        };
        let targets = resolve_receive_targets(&inbound);
        let pairs = targets
            .iter()
            .map(|item| format!("{}:{}", item.receive_id_type, item.receive_id))
            .collect::<Vec<_>>();
        assert!(pairs.contains(&"chat_id:oc_123".to_string()));
        assert!(pairs.contains(&"open_id:ou_abc".to_string()));
        assert!(pairs.contains(&"user_id:ou_abc".to_string()));
    }

    #[test]
    fn resolve_receive_targets_for_group_only_chat_id() {
        let inbound = InboundMessage {
            message_id: "m4".to_string(),
            chat_id: "oc_group_1".to_string(),
            chat_kind: "group".to_string(),
            sender_id: Some("ou_abc".to_string()),
            text: "hello".to_string(),
            raw_content: None,
        };
        let targets = resolve_receive_targets(&inbound);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].receive_id_type, "chat_id");
        assert_eq!(targets[0].receive_id, "oc_group_1");
    }
}
