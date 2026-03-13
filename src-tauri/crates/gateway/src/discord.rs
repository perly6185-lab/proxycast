//! Discord Gateway 运行时
//!
//! 目标：将 Discord 作为标准渠道接入全局 Gateway。
//! 当前版本支持：
//! - 多账号启动/停止/状态/探测
//! - Discord Gateway 实时入站消息（MESSAGE_CREATE）
//! - 入站命令与普通文本触发 RPC Agent 执行并回包
//! - 会话路由、/new 会话旋转、核心命令

use chrono::Utc;
use futures::{SinkExt, StreamExt};
use proxycast_core::config::{
    Config, DiscordAccountConfig, DiscordActionsConfig, DiscordAgentComponentsConfig,
    DiscordAutoPresenceConfig, DiscordBotConfig, DiscordExecApprovalsConfig, DiscordGuildConfig,
    DiscordIntentsConfig, DiscordThreadBindingsConfig, DiscordUiConfig, DiscordVoiceConfig,
};
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
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use tokio::time::Duration;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const DISCORD_API_BASE: &str = "https://discord.com/api/v10";
const DISCORD_MAX_MESSAGE_LEN: usize = 1800;
const RUN_WAIT_TIMEOUT_MS: u64 = 1200;
const RUN_WAIT_MAX_ROUNDS: usize = 180;
const CONFIRMATION_TTL_SECS: i64 = 90;

type LogState = Arc<RwLock<LogStore>>;
type SessionRouteState = Arc<RwLock<HashMap<String, String>>>;
type PendingConfirmationState = Arc<RwLock<Option<PendingConfirmation>>>;

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscordGatewayAccountStatus {
    pub account_id: String,
    pub running: bool,
    pub connected: bool,
    pub bot_id: Option<String>,
    pub bot_username: Option<String>,
    pub application_id: Option<String>,
    pub message_content_intent: Option<String>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub last_event_at: Option<String>,
    pub last_message_at: Option<String>,
    pub last_disconnect: Option<String>,
    pub reconnect_attempts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscordGatewayStatus {
    pub running_accounts: usize,
    pub accounts: Vec<DiscordGatewayAccountStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordProbeResult {
    pub account_id: String,
    pub ok: bool,
    pub bot_id: Option<String>,
    pub username: Option<String>,
    pub application_id: Option<String>,
    pub message_content_intent: Option<String>,
    pub message: String,
}

pub struct DiscordGatewayState {
    inner: Arc<RwLock<DiscordGatewayRuntime>>,
}

struct DiscordGatewayRuntime {
    accounts: HashMap<String, AccountRuntimeHandle>,
}

struct AccountRuntimeHandle {
    stop_token: CancellationToken,
    task: JoinHandle<()>,
    status: Arc<RwLock<DiscordGatewayAccountStatus>>,
}

impl Default for DiscordGatewayState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(DiscordGatewayRuntime {
                accounts: HashMap::new(),
            })),
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct ResolvedDiscordAccount {
    account_id: String,
    bot_token: String,
    default_model: Option<String>,
    allowed_server_ids: HashSet<String>,
    dm_policy: String,
    allow_from: HashSet<String>,
    group_policy: String,
    group_allow_from: HashSet<String>,
    groups: HashMap<String, DiscordGuildConfig>,
    streaming: String,
    reply_to_mode: String,
    intents: DiscordIntentsConfig,
    actions: DiscordActionsConfig,
    thread_bindings: DiscordThreadBindingsConfig,
    auto_presence: DiscordAutoPresenceConfig,
    voice: DiscordVoiceConfig,
    agent_components: DiscordAgentComponentsConfig,
    ui: DiscordUiConfig,
    exec_approvals: DiscordExecApprovalsConfig,
    response_prefix: Option<String>,
    ack_reaction: Option<String>,
}

#[derive(Debug, Clone)]
struct InboundMessage {
    message_id: String,
    channel_id: String,
    guild_id: Option<String>,
    sender_id: String,
    text: String,
    mentioned_bot: bool,
}

#[derive(Debug, Clone)]
struct PendingConfirmation {
    token: String,
    command: DiscordCommand,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
enum DiscordCommand {
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

#[derive(Clone)]
struct DiscordRuntimeContext {
    account: ResolvedDiscordAccount,
    client: reqwest::Client,
    rpc_handler: Arc<RpcHandler>,
    logs: LogState,
    session_route_state: SessionRouteState,
    status: Arc<RwLock<DiscordGatewayAccountStatus>>,
    pending_confirmation: PendingConfirmationState,
    reply_to_mode: ReplyToMode,
}

#[derive(Debug, Deserialize)]
struct DiscordGatewayBotResponse {
    url: String,
}

#[derive(Debug, Deserialize, Clone)]
struct DiscordUser {
    id: String,
    username: Option<String>,
    bot: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DiscordApplication {
    id: Option<String>,
    flags: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DiscordGatewayPayload {
    op: u64,
    d: serde_json::Value,
    s: Option<u64>,
    t: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DiscordGatewayHello {
    heartbeat_interval: u64,
}

#[derive(Debug, Deserialize)]
struct DiscordGatewayReady {
    user: DiscordUser,
    application: Option<DiscordApplication>,
}

#[derive(Debug, Deserialize)]
struct DiscordMentionUser {
    id: String,
}

#[derive(Debug, Deserialize)]
struct DiscordMessageCreateEvent {
    id: String,
    channel_id: String,
    guild_id: Option<String>,
    content: Option<String>,
    author: DiscordUser,
    mentions: Option<Vec<DiscordMentionUser>>,
}

pub async fn start_gateway(
    state: &DiscordGatewayState,
    db: DbConnection,
    logs: LogState,
    config: Config,
    account_filter: Option<String>,
    _poll_timeout_secs: Option<u64>,
) -> Result<DiscordGatewayStatus, String> {
    let state = state.inner.clone();
    let accounts = resolve_discord_accounts(&config.channels.discord, account_filter.as_deref())?;
    if accounts.is_empty() {
        return Err("没有可启动的 Discord 账号，请检查 channels.discord 配置".to_string());
    }

    for account in accounts {
        let existing = {
            let runtime = state.read().await;
            runtime.accounts.contains_key(&account.account_id)
        };
        if existing {
            continue;
        }

        let status = Arc::new(RwLock::new(DiscordGatewayAccountStatus {
            account_id: account.account_id.clone(),
            running: true,
            connected: false,
            bot_id: None,
            bot_username: None,
            application_id: None,
            message_content_intent: None,
            started_at: Some(Utc::now().to_rfc3339()),
            last_error: None,
            last_event_at: None,
            last_message_at: None,
            last_disconnect: None,
            reconnect_attempts: 0,
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
    state: &DiscordGatewayState,
    account_filter: Option<String>,
) -> Result<DiscordGatewayStatus, String> {
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

    for handle in handles {
        handle.stop_token.cancel();
        if let Err(join_error) = handle.task.await {
            eprintln!("[DiscordGateway] 停止任务 join 失败: {}", join_error);
        }
    }

    snapshot_status(state).await
}

pub async fn status_gateway(state: &DiscordGatewayState) -> Result<DiscordGatewayStatus, String> {
    snapshot_status(state.inner.clone()).await
}

pub async fn probe_gateway_account(
    config: &Config,
    account_filter: Option<String>,
) -> Result<DiscordProbeResult, String> {
    let accounts = resolve_discord_accounts(&config.channels.discord, account_filter.as_deref())?;
    let account = accounts
        .into_iter()
        .next()
        .ok_or_else(|| "未找到可用 Discord 账号".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("创建 Discord probe client 失败: {e}"))?;

    let me_result = fetch_current_user(&client, &account.bot_token).await;
    let app_result = fetch_application(&client, &account.bot_token).await;

    match me_result {
        Ok(me) => {
            let (application_id, message_content_intent) = match app_result {
                Ok(app) => (
                    app.id.clone(),
                    app.flags.map(resolve_message_content_intent_status),
                ),
                Err(_) => (None, None),
            };
            Ok(DiscordProbeResult {
                account_id: account.account_id,
                ok: true,
                bot_id: Some(me.id),
                username: me.username,
                application_id,
                message_content_intent,
                message: "Discord API 探测成功".to_string(),
            })
        }
        Err(error) => Ok(DiscordProbeResult {
            account_id: account.account_id,
            ok: false,
            bot_id: None,
            username: None,
            application_id: None,
            message_content_intent: None,
            message: error,
        }),
    }
}

async fn snapshot_status(
    state: Arc<RwLock<DiscordGatewayRuntime>>,
) -> Result<DiscordGatewayStatus, String> {
    let handles = {
        let runtime = state.read().await;
        runtime
            .accounts
            .iter()
            .map(|(id, handle)| (id.clone(), handle.status.clone()))
            .collect::<Vec<_>>()
    };

    let mut accounts = Vec::new();
    for (account_id, status) in handles {
        let mut item = status.read().await.clone();
        if item.account_id.is_empty() {
            item.account_id = account_id;
        }
        accounts.push(item);
    }
    accounts.sort_by(|a, b| a.account_id.cmp(&b.account_id));

    Ok(DiscordGatewayStatus {
        running_accounts: accounts.iter().filter(|item| item.running).count(),
        accounts,
    })
}

async fn run_account_loop(
    _state: Arc<RwLock<DiscordGatewayRuntime>>,
    status: Arc<RwLock<DiscordGatewayAccountStatus>>,
    db: DbConnection,
    logs: LogState,
    account: ResolvedDiscordAccount,
    stop_token: CancellationToken,
) {
    let rpc_handler_state = RpcHandlerState::new(Some(db), None, logs.clone());
    let rpc_handler = Arc::new(RpcHandler::new(rpc_handler_state));
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let message = format!("创建 Discord client 失败: {error}");
            {
                let mut status_guard = status.write().await;
                status_guard.running = false;
                status_guard.connected = false;
                status_guard.last_error = Some(message.clone());
            }
            logs.write().await.add(
                "error",
                &format!(
                    "[DiscordGateway] account={} 初始化失败: {}",
                    account.account_id, message
                ),
            );
            return;
        }
    };

    let streaming_mode = parse_streaming_mode(&account.streaming);
    let reply_to_mode = parse_reply_to_mode(&account.reply_to_mode);
    let session_route_state: SessionRouteState = Arc::new(RwLock::new(HashMap::new()));
    let pending_confirmation: PendingConfirmationState = Arc::new(RwLock::new(None));
    let context = DiscordRuntimeContext {
        account: account.clone(),
        client,
        rpc_handler,
        logs: logs.clone(),
        session_route_state,
        status: status.clone(),
        pending_confirmation,
        reply_to_mode,
    };
    let streaming_mode_label = match streaming_mode {
        StreamingMode::Off => "off",
        StreamingMode::Partial => "partial",
        StreamingMode::Block => "block",
    };
    logs.write().await.add(
        "info",
        &format!(
            "[DiscordGateway] account={} 运行参数: streaming={} reply_to_mode={}",
            account.account_id, streaming_mode_label, account.reply_to_mode
        ),
    );

    let mut reconnect_attempts = 0u64;
    loop {
        if stop_token.is_cancelled() {
            break;
        }

        {
            let mut status_guard = status.write().await;
            status_guard.reconnect_attempts = reconnect_attempts;
        }

        match run_gateway_loop(&context, stop_token.clone()).await {
            Ok(_) => break,
            Err(error) => {
                reconnect_attempts = reconnect_attempts.saturating_add(1);
                {
                    let mut status_guard = status.write().await;
                    status_guard.connected = false;
                    status_guard.last_error = Some(error.clone());
                    status_guard.last_disconnect = Some(Utc::now().to_rfc3339());
                    status_guard.reconnect_attempts = reconnect_attempts;
                }
                logs.write().await.add(
                    "warn",
                    &format!(
                        "[DiscordGateway] account={} gateway 循环异常，准备重连: {}",
                        account.account_id, error
                    ),
                );

                let backoff_secs = reconnect_attempts.min(10).saturating_mul(2).max(2);
                tokio::select! {
                    _ = stop_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(backoff_secs)) => {}
                }
            }
        }
    }

    {
        let mut status_guard = status.write().await;
        status_guard.running = false;
        status_guard.connected = false;
        status_guard.last_disconnect = Some(Utc::now().to_rfc3339());
    }
}

async fn run_gateway_loop(
    context: &DiscordRuntimeContext,
    stop_token: CancellationToken,
) -> Result<(), String> {
    if !context.account.actions.messages {
        return Err("channels.discord.actions.messages=false，消息处理已禁用".to_string());
    }

    let gateway = fetch_gateway_bot_info(&context.client, &context.account.bot_token).await?;
    let ws_url = format!("{}?v=10&encoding=json", gateway.url.trim_end_matches('/'));
    let (ws_stream, _) = connect_async(ws_url)
        .await
        .map_err(|e| format!("连接 Discord gateway 失败: {e}"))?;

    let (write, mut read) = ws_stream.split();
    let writer = Arc::new(Mutex::new(write));
    let sequence = Arc::new(RwLock::new(None::<u64>));

    let hello_payload = tokio::time::timeout(Duration::from_secs(15), read.next())
        .await
        .map_err(|_| "等待 Discord HELLO 超时".to_string())?
        .ok_or_else(|| "Discord gateway 提前关闭".to_string())?
        .map_err(|e| format!("读取 Discord HELLO 失败: {e}"))?;
    let hello_text = match hello_payload {
        Message::Text(text) => text,
        other => return Err(format!("Discord HELLO 类型不匹配: {}", other.to_string())),
    };
    let hello_envelope: DiscordGatewayPayload =
        serde_json::from_str(&hello_text).map_err(|e| format!("解析 Discord HELLO 失败: {e}"))?;
    if hello_envelope.op != 10 {
        return Err(format!("Discord HELLO op 非法: {}", hello_envelope.op));
    }
    let hello_data: DiscordGatewayHello = serde_json::from_value(hello_envelope.d)
        .map_err(|e| format!("解析 Discord HELLO 数据失败: {e}"))?;

    send_gateway_json(
        &writer,
        json!({
            "op": 2,
            "d": {
                "token": context.account.bot_token,
                "intents": resolve_intents_bitmask(&context.account.intents),
                "properties": {
                    "os": std::env::consts::OS,
                    "browser": "proxycast",
                    "device": "proxycast"
                }
            }
        }),
    )
    .await?;

    let heartbeat_stop = CancellationToken::new();
    let heartbeat_stop_task = heartbeat_stop.clone();
    let heartbeat_writer = writer.clone();
    let heartbeat_seq = sequence.clone();
    let heartbeat_interval = hello_data.heartbeat_interval.max(5000);
    let heartbeat_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(heartbeat_interval));
        loop {
            tokio::select! {
                _ = heartbeat_stop_task.cancelled() => break,
                _ = interval.tick() => {
                    let seq = *heartbeat_seq.read().await;
                    let payload = json!({
                        "op": 1,
                        "d": seq
                    });
                    if send_gateway_json(&heartbeat_writer, payload).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut bot_id: Option<String> = None;
    loop {
        tokio::select! {
            _ = stop_token.cancelled() => {
                break;
            }
            next = read.next() => {
                let message = match next {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => {
                        heartbeat_stop.cancel();
                        let _ = heartbeat_task.await;
                        return Err(format!("Discord gateway 读取失败: {error}"));
                    }
                    None => {
                        heartbeat_stop.cancel();
                        let _ = heartbeat_task.await;
                        return Err("Discord gateway 连接已关闭".to_string());
                    }
                };

                match message {
                    Message::Text(text) => {
                        let envelope: DiscordGatewayPayload = serde_json::from_str(&text)
                            .map_err(|e| format!("解析 Discord gateway payload 失败: {e}"))?;
                        if let Some(seq) = envelope.s {
                            *sequence.write().await = Some(seq);
                        }
                        if envelope.op == 11 {
                            continue;
                        }
                        if envelope.op == 1 {
                            let seq = *sequence.read().await;
                            send_gateway_json(&writer, json!({"op":1, "d": seq})).await?;
                            continue;
                        }
                        if envelope.op == 7 {
                            heartbeat_stop.cancel();
                            let _ = heartbeat_task.await;
                            return Err("Discord gateway 请求重连".to_string());
                        }
                        if envelope.op == 9 {
                            heartbeat_stop.cancel();
                            let _ = heartbeat_task.await;
                            return Err("Discord gateway 会话失效（Invalid Session）".to_string());
                        }
                        if envelope.op != 0 {
                            continue;
                        }

                        let event_type = envelope.t.unwrap_or_default();
                        if event_type == "READY" {
                            let ready: DiscordGatewayReady = serde_json::from_value(envelope.d)
                                .map_err(|e| format!("解析 Discord READY 失败: {e}"))?;
                            let app_id = ready
                                .application
                                .as_ref()
                                .and_then(|item| item.id.clone());
                            let intent_state = ready
                                .application
                                .and_then(|item| item.flags)
                                .map(resolve_message_content_intent_status);
                            {
                                let mut status_guard = context.status.write().await;
                                status_guard.connected = true;
                                status_guard.bot_id = Some(ready.user.id.clone());
                                status_guard.bot_username = ready.user.username.clone();
                                status_guard.application_id = app_id;
                                status_guard.message_content_intent = intent_state;
                                status_guard.last_error = None;
                                status_guard.last_event_at = Some(Utc::now().to_rfc3339());
                            }
                            bot_id = Some(ready.user.id);
                            context.logs.write().await.add(
                                "info",
                                &format!(
                                    "[DiscordGateway] account={} READY connected",
                                    context.account.account_id
                                ),
                            );
                            continue;
                        }
                        if event_type == "MESSAGE_CREATE" {
                            let event: DiscordMessageCreateEvent = serde_json::from_value(envelope.d)
                                .map_err(|e| format!("解析 Discord MESSAGE_CREATE 失败: {e}"))?;
                            handle_message_event(context, &event, bot_id.as_deref()).await?;
                            continue;
                        }

                        {
                            let mut status_guard = context.status.write().await;
                            status_guard.last_event_at = Some(Utc::now().to_rfc3339());
                        }
                    }
                    Message::Close(frame) => {
                        heartbeat_stop.cancel();
                        let _ = heartbeat_task.await;
                        return Err(format!("Discord gateway 已关闭: {:?}", frame));
                    }
                    Message::Ping(payload) => {
                        let mut guard = writer.lock().await;
                        let _ = guard.send(Message::Pong(payload)).await;
                    }
                    _ => {}
                }
            }
        }
    }

    heartbeat_stop.cancel();
    let _ = heartbeat_task.await;
    let mut guard = writer.lock().await;
    let _ = guard.send(Message::Close(None)).await;
    Ok(())
}

async fn send_gateway_json(
    writer: &Arc<
        Mutex<
            futures::stream::SplitSink<
                tokio_tungstenite::WebSocketStream<
                    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
                >,
                Message,
            >,
        >,
    >,
    payload: serde_json::Value,
) -> Result<(), String> {
    let text =
        serde_json::to_string(&payload).map_err(|e| format!("序列化 Discord payload 失败: {e}"))?;
    let mut guard = writer.lock().await;
    guard
        .send(Message::Text(text))
        .await
        .map_err(|e| format!("发送 Discord payload 失败: {e}"))
}

async fn handle_message_event(
    context: &DiscordRuntimeContext,
    event: &DiscordMessageCreateEvent,
    bot_id: Option<&str>,
) -> Result<(), String> {
    if event.author.bot.unwrap_or(false) {
        return Ok(());
    }
    if let Some(my_id) = bot_id {
        if event.author.id == my_id {
            return Ok(());
        }
    }

    let text = event.content.clone().unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Ok(());
    }

    let inbound = InboundMessage {
        message_id: event.id.clone(),
        channel_id: event.channel_id.clone(),
        guild_id: event.guild_id.clone(),
        sender_id: event.author.id.clone(),
        text: text.clone(),
        mentioned_bot: resolve_mentioned_bot(event, bot_id),
    };
    authorize_message(&context.account, &inbound)?;

    let reply = if is_slash_command(&inbound.text) {
        let command = parse_discord_command(&inbound.text)?;
        handle_command(context, &inbound, command).await?
    } else {
        match handle_plain_text(
            &context.account,
            context.rpc_handler.as_ref(),
            &context.logs,
            &context.session_route_state,
            &inbound,
            text,
            None,
        )
        .await?
        {
            PlainTextReply::Message(value) => Some(value),
        }
    };

    if let Some(reply_text) = reply {
        send_text_chunks(
            &context.client,
            &context.account,
            &inbound.channel_id,
            &inbound.message_id,
            &reply_text,
            context.reply_to_mode,
        )
        .await?;
        let mut status_guard = context.status.write().await;
        status_guard.last_message_at = Some(Utc::now().to_rfc3339());
        status_guard.last_event_at = Some(Utc::now().to_rfc3339());
    }
    Ok(())
}

fn resolve_mentioned_bot(event: &DiscordMessageCreateEvent, bot_id: Option<&str>) -> bool {
    let Some(bot_id) = bot_id else {
        return false;
    };
    let mention_hit = event
        .mentions
        .as_ref()
        .map(|items| items.iter().any(|item| item.id == bot_id))
        .unwrap_or(false);
    if mention_hit {
        return true;
    }
    let content = event.content.as_deref().unwrap_or_default();
    content.contains(&format!("<@{}>", bot_id)) || content.contains(&format!("<@!{}>", bot_id))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PlainTextReply {
    Message(String),
}

fn resolve_intents_bitmask(intents: &DiscordIntentsConfig) -> u64 {
    const GUILDS: u64 = 1 << 0;
    const GUILD_MEMBERS: u64 = 1 << 1;
    const GUILD_PRESENCES: u64 = 1 << 8;
    const GUILD_MESSAGES: u64 = 1 << 9;
    const GUILD_MESSAGE_REACTIONS: u64 = 1 << 10;
    const DIRECT_MESSAGES: u64 = 1 << 12;
    const DIRECT_MESSAGE_REACTIONS: u64 = 1 << 13;
    const MESSAGE_CONTENT: u64 = 1 << 15;

    let mut bits = GUILDS
        | GUILD_MESSAGES
        | GUILD_MESSAGE_REACTIONS
        | DIRECT_MESSAGES
        | DIRECT_MESSAGE_REACTIONS;
    if intents.message_content {
        bits |= MESSAGE_CONTENT;
    }
    if intents.guild_members {
        bits |= GUILD_MEMBERS;
    }
    if intents.presence {
        bits |= GUILD_PRESENCES;
    }
    bits
}

fn resolve_message_content_intent_status(flags: u64) -> String {
    const MESSAGE_CONTENT_ENABLED: u64 = 1 << 18;
    const MESSAGE_CONTENT_LIMITED: u64 = 1 << 19;
    if flags & MESSAGE_CONTENT_ENABLED != 0 {
        "enabled".to_string()
    } else if flags & MESSAGE_CONTENT_LIMITED != 0 {
        "limited".to_string()
    } else {
        "disabled".to_string()
    }
}

async fn fetch_gateway_bot_info(
    client: &reqwest::Client,
    bot_token: &str,
) -> Result<DiscordGatewayBotResponse, String> {
    client
        .get(format!("{DISCORD_API_BASE}/gateway/bot"))
        .header("Authorization", format!("Bot {}", bot_token))
        .send()
        .await
        .map_err(|e| format!("调用 Discord gateway/bot 失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Discord gateway/bot 返回错误: {e}"))?
        .json::<DiscordGatewayBotResponse>()
        .await
        .map_err(|e| format!("解析 Discord gateway/bot 失败: {e}"))
}

async fn fetch_current_user(
    client: &reqwest::Client,
    bot_token: &str,
) -> Result<DiscordUser, String> {
    client
        .get(format!("{DISCORD_API_BASE}/users/@me"))
        .header("Authorization", format!("Bot {}", bot_token))
        .send()
        .await
        .map_err(|e| format!("调用 Discord users/@me 失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Discord users/@me 返回错误: {e}"))?
        .json::<DiscordUser>()
        .await
        .map_err(|e| format!("解析 Discord users/@me 失败: {e}"))
}

async fn fetch_application(
    client: &reqwest::Client,
    bot_token: &str,
) -> Result<DiscordApplication, String> {
    client
        .get(format!("{DISCORD_API_BASE}/oauth2/applications/@me"))
        .header("Authorization", format!("Bot {}", bot_token))
        .send()
        .await
        .map_err(|e| format!("调用 Discord oauth2/applications/@me 失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Discord oauth2/applications/@me 返回错误: {e}"))?
        .json::<DiscordApplication>()
        .await
        .map_err(|e| format!("解析 Discord oauth2/applications/@me 失败: {e}"))
}

fn normalize_allow_entry(raw: &str) -> String {
    let mut value = raw
        .trim()
        .trim_start_matches("discord:")
        .trim_start_matches("user:")
        .to_ascii_lowercase();
    if value.starts_with("<@") && value.ends_with('>') {
        value = value
            .trim_start_matches("<@")
            .trim_start_matches('!')
            .trim_end_matches('>')
            .to_string();
    }
    value
}

fn normalize_allow_set(input: &[String]) -> HashSet<String> {
    input
        .iter()
        .map(|item| normalize_allow_entry(item))
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>()
}

fn normalize_server_set(input: &[String]) -> HashSet<String> {
    input
        .iter()
        .map(|item| item.trim().to_string())
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

fn resolve_discord_accounts(
    discord: &DiscordBotConfig,
    account_filter: Option<&str>,
) -> Result<Vec<ResolvedDiscordAccount>, String> {
    if !discord.enabled {
        return Ok(Vec::new());
    }

    let mut resolved = Vec::new();
    if discord.accounts.is_empty() {
        if discord.bot_token.trim().is_empty() {
            return Ok(Vec::new());
        }
        resolved.push(ResolvedDiscordAccount {
            account_id: "default".to_string(),
            bot_token: discord.bot_token.trim().to_string(),
            default_model: normalize_optional_text(discord.default_model.as_deref()),
            allowed_server_ids: normalize_server_set(&discord.allowed_server_ids),
            dm_policy: normalize_dm_policy(&discord.dm_policy),
            allow_from: normalize_allow_set(&discord.allow_from),
            group_policy: normalize_group_policy(&discord.group_policy),
            group_allow_from: normalize_allow_set(&discord.group_allow_from),
            groups: discord.groups.clone(),
            streaming: normalize_streaming_mode(&discord.streaming),
            reply_to_mode: normalize_reply_to_mode(&discord.reply_to_mode),
            intents: discord.intents.clone(),
            actions: discord.actions.clone(),
            thread_bindings: discord.thread_bindings.clone(),
            auto_presence: discord.auto_presence.clone(),
            voice: discord.voice.clone(),
            agent_components: discord.agent_components.clone(),
            ui: discord.ui.clone(),
            exec_approvals: discord.exec_approvals.clone(),
            response_prefix: normalize_optional_text(discord.response_prefix.as_deref()),
            ack_reaction: normalize_optional_text(discord.ack_reaction.as_deref()),
        });
    } else {
        for (account_id, account) in &discord.accounts {
            if !account.enabled {
                continue;
            }
            let bot_token = resolve_account_bot_token(discord, account);
            if bot_token.is_empty() {
                continue;
            }

            let allow_from = if account.allow_from.is_empty() {
                normalize_allow_set(&discord.allow_from)
            } else {
                normalize_allow_set(&account.allow_from)
            };
            let group_allow_from = if account.group_allow_from.is_empty() {
                normalize_allow_set(&discord.group_allow_from)
            } else {
                normalize_allow_set(&account.group_allow_from)
            };
            let groups = if account.groups.is_empty() {
                discord.groups.clone()
            } else {
                account.groups.clone()
            };
            let allowed_server_ids = if account.allowed_server_ids.is_empty() {
                normalize_server_set(&discord.allowed_server_ids)
            } else {
                normalize_server_set(&account.allowed_server_ids)
            };

            resolved.push(ResolvedDiscordAccount {
                account_id: account_id.to_string(),
                bot_token,
                default_model: normalize_optional_text(
                    account
                        .default_model
                        .as_deref()
                        .or(discord.default_model.as_deref()),
                ),
                allowed_server_ids,
                dm_policy: normalize_dm_policy(
                    account
                        .dm_policy
                        .as_deref()
                        .unwrap_or(discord.dm_policy.as_str()),
                ),
                allow_from,
                group_policy: normalize_group_policy(
                    account
                        .group_policy
                        .as_deref()
                        .unwrap_or(discord.group_policy.as_str()),
                ),
                group_allow_from,
                groups,
                streaming: normalize_streaming_mode(
                    account
                        .streaming
                        .as_deref()
                        .unwrap_or(discord.streaming.as_str()),
                ),
                reply_to_mode: normalize_reply_to_mode(
                    account
                        .reply_to_mode
                        .as_deref()
                        .unwrap_or(discord.reply_to_mode.as_str()),
                ),
                intents: account
                    .intents
                    .clone()
                    .unwrap_or_else(|| discord.intents.clone()),
                actions: account
                    .actions
                    .clone()
                    .unwrap_or_else(|| discord.actions.clone()),
                thread_bindings: account
                    .thread_bindings
                    .clone()
                    .unwrap_or_else(|| discord.thread_bindings.clone()),
                auto_presence: account
                    .auto_presence
                    .clone()
                    .unwrap_or_else(|| discord.auto_presence.clone()),
                voice: account
                    .voice
                    .clone()
                    .unwrap_or_else(|| discord.voice.clone()),
                agent_components: account
                    .agent_components
                    .clone()
                    .unwrap_or_else(|| discord.agent_components.clone()),
                ui: account.ui.clone().unwrap_or_else(|| discord.ui.clone()),
                exec_approvals: account
                    .exec_approvals
                    .clone()
                    .unwrap_or_else(|| discord.exec_approvals.clone()),
                response_prefix: normalize_optional_text(
                    account
                        .response_prefix
                        .as_deref()
                        .or(discord.response_prefix.as_deref()),
                ),
                ack_reaction: normalize_optional_text(
                    account
                        .ack_reaction
                        .as_deref()
                        .or(discord.ack_reaction.as_deref()),
                ),
            });
        }

        if resolved.is_empty() && !discord.bot_token.trim().is_empty() {
            resolved.push(ResolvedDiscordAccount {
                account_id: "default".to_string(),
                bot_token: discord.bot_token.trim().to_string(),
                default_model: normalize_optional_text(discord.default_model.as_deref()),
                allowed_server_ids: normalize_server_set(&discord.allowed_server_ids),
                dm_policy: normalize_dm_policy(&discord.dm_policy),
                allow_from: normalize_allow_set(&discord.allow_from),
                group_policy: normalize_group_policy(&discord.group_policy),
                group_allow_from: normalize_allow_set(&discord.group_allow_from),
                groups: discord.groups.clone(),
                streaming: normalize_streaming_mode(&discord.streaming),
                reply_to_mode: normalize_reply_to_mode(&discord.reply_to_mode),
                intents: discord.intents.clone(),
                actions: discord.actions.clone(),
                thread_bindings: discord.thread_bindings.clone(),
                auto_presence: discord.auto_presence.clone(),
                voice: discord.voice.clone(),
                agent_components: discord.agent_components.clone(),
                ui: discord.ui.clone(),
                exec_approvals: discord.exec_approvals.clone(),
                response_prefix: normalize_optional_text(discord.response_prefix.as_deref()),
                ack_reaction: normalize_optional_text(discord.ack_reaction.as_deref()),
            });
        }
    }

    if let Some(filter) = account_filter {
        let selected = resolved
            .into_iter()
            .filter(|item| item.account_id == filter)
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Err(format!("未找到 Discord 账号: {}", filter));
        }
        return Ok(selected);
    }

    Ok(resolved)
}

fn resolve_account_bot_token(discord: &DiscordBotConfig, account: &DiscordAccountConfig) -> String {
    account
        .bot_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| discord.bot_token.trim())
        .to_string()
}

fn build_session_key(account: &ResolvedDiscordAccount, inbound: &InboundMessage) -> String {
    if inbound.guild_id.is_none() {
        return format!(
            "agent:main:discord:{}:direct:{}",
            account.account_id, inbound.sender_id
        );
    }
    format!(
        "agent:main:discord:{}:group:{}:{}",
        account.account_id,
        inbound.guild_id.as_deref().unwrap_or("unknown"),
        inbound.channel_id
    )
}

async fn resolve_active_session_id(
    account: &ResolvedDiscordAccount,
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
    account: &ResolvedDiscordAccount,
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
    account: &ResolvedDiscordAccount,
    inbound: &InboundMessage,
) -> Result<(), String> {
    if inbound.guild_id.is_none() {
        return authorize_dm(account, &inbound.sender_id);
    }
    authorize_group(account, inbound)
}

fn authorize_dm(account: &ResolvedDiscordAccount, sender_id: &str) -> Result<(), String> {
    let sender = normalize_allow_entry(sender_id);
    if sender.is_empty() {
        return Err("无法识别发送者 ID".to_string());
    }
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
            if account.allow_from.contains(&sender) || account.allow_from.contains("*") {
                Ok(())
            } else {
                Err(format!("发送者 {} 不在 DM allow_from", sender))
            }
        }
        _ => {
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
    account: &ResolvedDiscordAccount,
    inbound: &InboundMessage,
) -> Result<(), String> {
    let guild_id = inbound
        .guild_id
        .as_deref()
        .ok_or_else(|| "缺少 guild_id".to_string())?;
    if !account.allowed_server_ids.is_empty() && !account.allowed_server_ids.contains(guild_id) {
        return Err(format!("服务器 {} 不在 allowed_server_ids 中", guild_id));
    }

    let sender = normalize_allow_entry(&inbound.sender_id);
    if sender.is_empty() {
        return Err("无法识别群组发送者 ID".to_string());
    }

    let group_cfg = account
        .groups
        .get(guild_id)
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
        return Err(format!("服务器 {} 未加入 allowlist", guild_id));
    }

    let channel_cfg = group_cfg
        .and_then(|group| group.channels.get(&inbound.channel_id))
        .or_else(|| group_cfg.and_then(|group| group.channels.get("*")));
    let effective_channel_policy = channel_cfg
        .and_then(|channel| channel.group_policy.as_deref())
        .map(normalize_group_policy)
        .unwrap_or_else(|| effective_group_policy.clone());
    if effective_channel_policy == "disabled" {
        return Err("频道消息已禁用".to_string());
    }

    let require_mention = channel_cfg
        .and_then(|channel| channel.require_mention)
        .or_else(|| group_cfg.and_then(|group| group.require_mention))
        .unwrap_or(true);
    if require_mention && !is_slash_command(&inbound.text) && !inbound.mentioned_bot {
        return Err("群组消息需要 mention 触发".to_string());
    }

    match effective_channel_policy.as_str() {
        "open" => Ok(()),
        "disabled" => Err("群组消息已禁用".to_string()),
        _ => {
            let allow_from = if let Some(channel) = channel_cfg {
                if !channel.allow_from.is_empty() {
                    normalize_allow_set(&channel.allow_from)
                } else if let Some(group) = group_cfg {
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
                }
            } else if let Some(group) = group_cfg {
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

fn is_slash_command(text: &str) -> bool {
    text.trim_start().starts_with('/')
}

async fn handle_plain_text(
    account: &ResolvedDiscordAccount,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_route_state: &SessionRouteState,
    inbound: &InboundMessage,
    text: String,
    session_id_override: Option<String>,
) -> Result<PlainTextReply, String> {
    let session_id = match session_id_override {
        Some(value) => value,
        None => resolve_active_session_id(account, inbound, session_route_state).await,
    };
    logs.write().await.add(
        "info",
        &format!(
            "[DiscordGateway] account={} 收到文本消息: guild={:?} channel={} sender={} messageId={} session={} model={} search_mode=allowed",
            account.account_id,
            inbound.guild_id,
            inbound.channel_id,
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
            return Ok(PlainTextReply::Message(content));
        }
        if round % 3 == 0 {
            let _ = send_typing_indicator(account, inbound.channel_id.as_str()).await;
        }
    }

    Err("等待任务完成超时，请稍后使用 /status 查询".to_string())
}

async fn handle_command(
    context: &DiscordRuntimeContext,
    inbound: &InboundMessage,
    command: DiscordCommand,
) -> Result<Option<String>, String> {
    match command {
        DiscordCommand::Help => Ok(Some(help_text())),
        DiscordCommand::Cancel => {
            *context.pending_confirmation.write().await = None;
            Ok(Some("🧹 已取消待确认操作".to_string()))
        }
        DiscordCommand::Confirm(token) => {
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
        DiscordCommand::Run(prompt) => {
            match handle_plain_text(
                &context.account,
                context.rpc_handler.as_ref(),
                &context.logs,
                &context.session_route_state,
                inbound,
                prompt,
                None,
            )
            .await?
            {
                PlainTextReply::Message(text) => Ok(Some(text)),
            }
        }
        DiscordCommand::New(first_prompt) => {
            let new_session_id =
                rotate_active_session_id(&context.account, inbound, &context.session_route_state)
                    .await;
            if let Some(prompt) = first_prompt {
                match handle_plain_text(
                    &context.account,
                    context.rpc_handler.as_ref(),
                    &context.logs,
                    &context.session_route_state,
                    inbound,
                    prompt,
                    Some(new_session_id.clone()),
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

fn parse_discord_command(text: &str) -> Result<DiscordCommand, String> {
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
                Ok(DiscordCommand::Run(rest.to_string()))
            }
        }
        "/new" | "/reset" => {
            if rest.is_empty() {
                Ok(DiscordCommand::New(None))
            } else {
                Ok(DiscordCommand::New(Some(rest.to_string())))
            }
        }
        "/status" => {
            if rest.is_empty() {
                Err("❌ 用法：/status <run_id>".to_string())
            } else {
                Ok(DiscordCommand::Status(rest.to_string()))
            }
        }
        "/stop" => {
            if rest.is_empty() {
                Err("❌ 用法：/stop <run_id>".to_string())
            } else {
                Ok(DiscordCommand::Stop(rest.to_string()))
            }
        }
        "/cron_list" => Ok(DiscordCommand::CronList),
        "/cron_health" => Ok(DiscordCommand::CronHealth),
        "/cron_run" => {
            if rest.is_empty() {
                Err("❌ 用法：/cron_run <task_id>".to_string())
            } else {
                Ok(DiscordCommand::CronRun(rest.to_string()))
            }
        }
        "/sessions" => Ok(DiscordCommand::Sessions),
        "/session" => {
            if rest.is_empty() {
                Err("❌ 用法：/session <session_id>".to_string())
            } else {
                Ok(DiscordCommand::Session(rest.to_string()))
            }
        }
        "/confirm" => {
            if rest.is_empty() {
                Err("❌ 用法：/confirm <token>".to_string())
            } else {
                Ok(DiscordCommand::Confirm(rest.to_string()))
            }
        }
        "/cancel" => Ok(DiscordCommand::Cancel),
        "/help" | "/start" => Ok(DiscordCommand::Help),
        _ => Err(help_text()),
    }
}

fn requires_confirmation(command: &DiscordCommand) -> bool {
    matches!(
        command,
        DiscordCommand::Stop(_) | DiscordCommand::CronRun(_)
    )
}

fn danger_command_label(command: &DiscordCommand) -> &'static str {
    match command {
        DiscordCommand::Stop(_) => "/stop",
        DiscordCommand::CronRun(_) => "/cron_run",
        _ => "unknown",
    }
}

fn help_text() -> String {
    [
        "🤖 ProxyCast Discord Gateway 命令",
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
    command: DiscordCommand,
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
) -> Result<DiscordCommand, String> {
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
    command: DiscordCommand,
) -> Result<String, String> {
    let request = build_rpc_request(command)?;
    let response = rpc_handler.handle_request(request).await;
    format_rpc_response(response)
}

fn build_rpc_request(command: DiscordCommand) -> Result<GatewayRpcRequest, String> {
    let (method, params) = match command {
        DiscordCommand::Run(message) => (
            RpcMethod::AgentRun,
            Some(json!({
                "message": message,
                "stream": false,
                "web_search": true,
                "search_mode": "allowed"
            })),
        ),
        DiscordCommand::Status(run_id) => (
            RpcMethod::AgentWait,
            Some(json!({ "run_id": run_id, "timeout": 200 })),
        ),
        DiscordCommand::Stop(run_id) => (RpcMethod::AgentStop, Some(json!({ "run_id": run_id }))),
        DiscordCommand::CronList => (RpcMethod::CronList, None),
        DiscordCommand::CronHealth => (RpcMethod::CronHealth, None),
        DiscordCommand::CronRun(task_id) => {
            (RpcMethod::CronRun, Some(json!({ "task_id": task_id })))
        }
        DiscordCommand::Sessions => (RpcMethod::SessionsList, None),
        DiscordCommand::Session(session_id) => (
            RpcMethod::SessionsGet,
            Some(json!({ "session_id": session_id })),
        ),
        DiscordCommand::New(_) => return Err("内部错误：new 不应构造 RPC 请求".to_string()),
        DiscordCommand::Help => return Err("内部错误：help 不应构造 RPC 请求".to_string()),
        DiscordCommand::Confirm(_) => return Err("内部错误：confirm 不应构造 RPC 请求".to_string()),
        DiscordCommand::Cancel => return Err("内部错误：cancel 不应构造 RPC 请求".to_string()),
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
    if total_chars <= DISCORD_MAX_MESSAGE_LEN {
        return vec![text.to_string()];
    }
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + DISCORD_MAX_MESSAGE_LEN).min(chars.len());
        chunks.push(chars[start..end].iter().collect::<String>());
        start = end;
    }
    chunks
}

async fn send_discord_message(
    client: &reqwest::Client,
    token: &str,
    channel_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<(), String> {
    let mut payload = json!({
        "content": text,
        "allowed_mentions": {
            "parse": []
        }
    });
    if let Some(reply_id) = reply_to_message_id {
        payload["message_reference"] = json!({
            "message_id": reply_id,
            "fail_if_not_exists": false
        });
    }
    client
        .post(format!(
            "{DISCORD_API_BASE}/channels/{}/messages",
            urlencoding::encode(channel_id)
        ))
        .header("Authorization", format!("Bot {}", token))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("发送 Discord 消息失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Discord 发送消息返回错误: {e}"))?;
    Ok(())
}

async fn send_text_chunks(
    client: &reqwest::Client,
    account: &ResolvedDiscordAccount,
    channel_id: &str,
    inbound_message_id: &str,
    text: &str,
    reply_to_mode: ReplyToMode,
) -> Result<(), String> {
    let chunks = split_message_chunks(text);
    for (index, chunk) in chunks.iter().enumerate() {
        let reply_ref = match reply_to_mode {
            ReplyToMode::Off => None,
            ReplyToMode::First => {
                if index == 0 && !inbound_message_id.trim().is_empty() {
                    Some(inbound_message_id)
                } else {
                    None
                }
            }
            ReplyToMode::All => {
                if inbound_message_id.trim().is_empty() {
                    None
                } else {
                    Some(inbound_message_id)
                }
            }
        };
        send_discord_message(client, &account.bot_token, channel_id, chunk, reply_ref).await?;
    }
    Ok(())
}

async fn send_typing_indicator(
    account: &ResolvedDiscordAccount,
    channel_id: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 typing client 失败: {e}"))?;
    let _ = client
        .post(format!(
            "{DISCORD_API_BASE}/channels/{}/typing",
            urlencoding::encode(channel_id)
        ))
        .header("Authorization", format!("Bot {}", account.bot_token))
        .send()
        .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_account(
        dm_policy: &str,
        allow_from: &[&str],
        group_policy: &str,
    ) -> ResolvedDiscordAccount {
        let mut allow = HashSet::new();
        for item in allow_from {
            allow.insert((*item).to_string());
        }
        ResolvedDiscordAccount {
            account_id: "default".to_string(),
            bot_token: "token".to_string(),
            default_model: None,
            allowed_server_ids: HashSet::new(),
            dm_policy: dm_policy.to_string(),
            allow_from: allow,
            group_policy: group_policy.to_string(),
            group_allow_from: HashSet::new(),
            groups: HashMap::new(),
            streaming: "partial".to_string(),
            reply_to_mode: "off".to_string(),
            intents: DiscordIntentsConfig::default(),
            actions: DiscordActionsConfig::default(),
            thread_bindings: DiscordThreadBindingsConfig::default(),
            auto_presence: DiscordAutoPresenceConfig::default(),
            voice: DiscordVoiceConfig::default(),
            agent_components: DiscordAgentComponentsConfig::default(),
            ui: DiscordUiConfig::default(),
            exec_approvals: DiscordExecApprovalsConfig::default(),
            response_prefix: None,
            ack_reaction: None,
        }
    }

    #[test]
    fn parse_command_supports_new() {
        assert!(matches!(
            parse_discord_command("/new").expect("should parse"),
            DiscordCommand::New(None)
        ));
        assert!(matches!(
            parse_discord_command("/reset hi").expect("should parse"),
            DiscordCommand::New(Some(_))
        ));
    }

    #[test]
    fn authorize_message_dm_pairing_fail_closed_without_allow_from() {
        let account = build_account("pairing", &[], "allowlist");
        let inbound = InboundMessage {
            message_id: "m1".to_string(),
            channel_id: "c1".to_string(),
            guild_id: None,
            sender_id: "123".to_string(),
            text: "你好".to_string(),
            mentioned_bot: false,
        };
        let err = authorize_message(&account, &inbound).expect_err("should reject");
        assert!(err.contains("fail-closed"));
    }

    #[test]
    fn authorize_message_group_requires_mention_by_default() {
        let mut account = build_account("open", &["*"], "open");
        account.groups.insert(
            "g1".to_string(),
            DiscordGuildConfig {
                enabled: Some(true),
                require_mention: Some(true),
                group_policy: Some("open".to_string()),
                allow_from: vec!["*".to_string()],
                channels: HashMap::new(),
            },
        );
        let inbound = InboundMessage {
            message_id: "m2".to_string(),
            channel_id: "c2".to_string(),
            guild_id: Some("g1".to_string()),
            sender_id: "123".to_string(),
            text: "普通消息".to_string(),
            mentioned_bot: false,
        };
        let err = authorize_message(&account, &inbound).expect_err("should reject");
        assert!(err.contains("mention"));
    }
}
