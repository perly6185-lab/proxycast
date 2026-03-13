//! Telegram Gateway 运行时
//!
//! 目标：将 Telegram 作为标准渠道接入，承载多账号轮询、路由与策略校验。

use chrono::Utc;
use proxycast_core::config::{
    Config, TelegramAccountConfig, TelegramBotConfig, TelegramGroupConfig,
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
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const TELEGRAM_API_BASE: &str = "https://api.telegram.org";
const DEFAULT_POLL_TIMEOUT_SECS: u64 = 25;
const TELEGRAM_MAX_MESSAGE_LEN: usize = 3800;
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
    AlreadySent,
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TelegramGatewayAccountStatus {
    pub account_id: String,
    pub running: bool,
    pub bot_username: Option<String>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub last_update_id: Option<i64>,
    pub last_message_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TelegramGatewayStatus {
    pub running_accounts: usize,
    pub accounts: Vec<TelegramGatewayAccountStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramProbeResult {
    pub account_id: String,
    pub ok: bool,
    pub bot_id: Option<i64>,
    pub username: Option<String>,
    pub message: String,
}

pub struct TelegramGatewayState {
    inner: Arc<RwLock<TelegramGatewayRuntime>>,
}

struct TelegramGatewayRuntime {
    accounts: HashMap<String, AccountRuntimeHandle>,
}

struct AccountRuntimeHandle {
    stop_token: CancellationToken,
    task: JoinHandle<()>,
    status: Arc<RwLock<TelegramGatewayAccountStatus>>,
}

impl Default for TelegramGatewayState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(TelegramGatewayRuntime {
                accounts: HashMap::new(),
            })),
        }
    }
}

#[derive(Debug, Clone)]
struct ResolvedTelegramAccount {
    account_id: String,
    bot_token: String,
    default_model: Option<String>,
    dm_policy: String,
    allow_from: HashSet<String>,
    group_policy: String,
    group_allow_from: HashSet<String>,
    groups: HashMap<String, TelegramGroupConfig>,
    streaming: String,
    reply_to_mode: String,
}

#[derive(Debug, Clone)]
struct InboundMessage {
    message_id: i64,
    chat_id: i64,
    chat_kind: String,
    sender_id: Option<i64>,
    text: String,
    message_thread_id: Option<i64>,
}

#[derive(Debug, Clone)]
struct PendingConfirmation {
    token: String,
    command: TelegramCommand,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
enum TelegramCommand {
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
    edited_message: Option<TelegramMessage>,
    callback_query: Option<TelegramCallbackQuery>,
}

#[derive(Debug, Deserialize, Clone)]
struct TelegramMessage {
    #[serde(default)]
    message_id: i64,
    chat: TelegramChat,
    from: Option<TelegramUser>,
    text: Option<String>,
    caption: Option<String>,
    message_thread_id: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
struct TelegramCallbackQuery {
    from: TelegramUser,
    data: Option<String>,
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize, Clone)]
struct TelegramUser {
    id: i64,
}

#[derive(Debug, Deserialize, Clone)]
struct TelegramChat {
    id: i64,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct TelegramMe {
    id: i64,
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramSendResult {
    message_id: i64,
}

pub async fn start_gateway(
    state: &TelegramGatewayState,
    db: DbConnection,
    logs: LogState,
    config: Config,
    account_filter: Option<String>,
    poll_timeout_secs: Option<u64>,
) -> Result<TelegramGatewayStatus, String> {
    let state = state.inner.clone();
    let accounts = resolve_telegram_accounts(&config.channels.telegram, account_filter.as_deref())?;
    if accounts.is_empty() {
        return Err("没有可启动的 Telegram 账号，请检查 channels.telegram 配置".to_string());
    }

    let poll_timeout = poll_timeout_secs
        .unwrap_or(DEFAULT_POLL_TIMEOUT_SECS)
        .clamp(5, 60);

    for account in accounts {
        let existing = {
            let runtime = state.read().await;
            runtime.accounts.contains_key(&account.account_id)
        };
        if existing {
            continue;
        }

        let status = Arc::new(RwLock::new(TelegramGatewayAccountStatus {
            account_id: account.account_id.clone(),
            running: true,
            bot_username: None,
            started_at: Some(Utc::now().to_rfc3339()),
            last_error: None,
            last_update_id: None,
            last_message_at: None,
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
                poll_timeout,
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
    state: &TelegramGatewayState,
    account_filter: Option<String>,
) -> Result<TelegramGatewayStatus, String> {
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

pub async fn status_gateway(state: &TelegramGatewayState) -> Result<TelegramGatewayStatus, String> {
    snapshot_status(state.inner.clone()).await
}

pub async fn probe_gateway_account(
    config: &Config,
    account_filter: Option<String>,
) -> Result<TelegramProbeResult, String> {
    let accounts = resolve_telegram_accounts(&config.channels.telegram, account_filter.as_deref())?;
    if accounts.is_empty() {
        return Err("未找到可用 Telegram 账号".to_string());
    }

    let account = if account_filter.is_none() {
        if let Some(default_account) = config.channels.telegram.default_account.as_deref() {
            accounts
                .iter()
                .find(|item| item.account_id == default_account)
                .cloned()
                .unwrap_or_else(|| accounts[0].clone())
        } else {
            accounts[0].clone()
        }
    } else {
        accounts[0].clone()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    match get_me(&client, &account.bot_token).await {
        Ok(me) => Ok(TelegramProbeResult {
            account_id: account.account_id,
            ok: true,
            bot_id: Some(me.id),
            username: me.username,
            message: "Telegram token 可用".to_string(),
        }),
        Err(error) => Ok(TelegramProbeResult {
            account_id: account.account_id,
            ok: false,
            bot_id: None,
            username: None,
            message: error,
        }),
    }
}

async fn snapshot_status(
    state: Arc<RwLock<TelegramGatewayRuntime>>,
) -> Result<TelegramGatewayStatus, String> {
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

    Ok(TelegramGatewayStatus {
        running_accounts: accounts.iter().filter(|item| item.running).count(),
        accounts,
    })
}

async fn run_account_loop(
    runtime_state: Arc<RwLock<TelegramGatewayRuntime>>,
    status: Arc<RwLock<TelegramGatewayAccountStatus>>,
    db: DbConnection,
    logs: LogState,
    account: ResolvedTelegramAccount,
    poll_timeout_secs: u64,
    stop_token: CancellationToken,
) {
    let streaming_mode = parse_streaming_mode(&account.streaming);
    let reply_to_mode = parse_reply_to_mode(&account.reply_to_mode);

    logs.write().await.add(
        "info",
        &format!(
            "[TelegramGateway] 启动账号轮询: account={} streaming={} replyToMode={}",
            account.account_id, account.streaming, account.reply_to_mode
        ),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(poll_timeout_secs + 10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    if let Ok(me) = get_me(&client, &account.bot_token).await {
        status.write().await.bot_username = me.username;
    }

    let rpc_state = RpcHandlerState::new(Some(db), None, logs.clone());
    let rpc_handler = Arc::new(RpcHandler::new(rpc_state));
    let session_route_state: SessionRouteState = Arc::new(RwLock::new(HashMap::new()));

    let mut offset = status.read().await.last_update_id.unwrap_or(0);
    let mut pending_confirmation: Option<PendingConfirmation> = None;

    loop {
        if stop_token.is_cancelled() {
            break;
        }

        let updates =
            match fetch_updates(&client, &account.bot_token, offset, poll_timeout_secs).await {
                Ok(items) => {
                    status.write().await.last_error = None;
                    items
                }
                Err(error) => {
                    status.write().await.last_error = Some(error.clone());
                    logs.write().await.add(
                        "warn",
                        &format!(
                            "[TelegramGateway] account={} 拉取更新失败: {}",
                            account.account_id, error
                        ),
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
            };

        for update in updates {
            offset = offset.max(update.update_id);
            status.write().await.last_update_id = Some(offset);

            let inbound = match to_inbound_message(update) {
                Some(value) => value,
                None => continue,
            };

            status.write().await.last_message_at = Some(Utc::now().to_rfc3339());

            let bot_username = status.read().await.bot_username.clone().unwrap_or_default();
            let text = inbound.text.trim();
            if text.is_empty() {
                continue;
            }
            let text_preview = summarize_text_preview(text, 64);
            let message_thread_id =
                sanitize_message_thread_id(&inbound.chat_kind, inbound.message_thread_id);

            logs.write().await.add(
                "info",
                &format!(
                    "[TelegramGateway] account={} 收到入站消息: chat={} kind={} sender={:?} messageId={} threadId={:?} text={}",
                    account.account_id,
                    inbound.chat_id,
                    inbound.chat_kind,
                    inbound.sender_id,
                    inbound.message_id,
                    inbound.message_thread_id,
                    text_preview
                ),
            );

            if let Err(reason) = authorize_message(&account, &inbound, &bot_username) {
                let _ = send_message_chunks(
                    &client,
                    &account.bot_token,
                    inbound.chat_id,
                    format!("❌ 拒绝访问: {}", reason),
                    message_thread_id,
                    reply_to_mode,
                    inbound.message_id,
                )
                .await;
                logs.write().await.add(
                    "warn",
                    &format!(
                        "[TelegramGateway] account={} 拒绝消息: chat={} sender={:?} reason={}",
                        account.account_id, inbound.chat_id, inbound.sender_id, reason
                    ),
                );
                continue;
            }

            let reply = if text.starts_with('/') {
                logs.write().await.add(
                    "info",
                    &format!(
                        "[TelegramGateway] account={} 识别命令: chat={} text={}",
                        account.account_id, inbound.chat_id, text_preview
                    ),
                );
                let command = match parse_telegram_command(text) {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = send_message_chunks(
                            &client,
                            &account.bot_token,
                            inbound.chat_id,
                            error,
                            message_thread_id,
                            reply_to_mode,
                            inbound.message_id,
                        )
                        .await;
                        logs.write().await.add(
                            "warn",
                            &format!(
                                "[TelegramGateway] account={} 命令解析失败: chat={} text={}",
                                account.account_id, inbound.chat_id, text_preview
                            ),
                        );
                        continue;
                    }
                };

                match command {
                    TelegramCommand::Run(prompt) => {
                        tokio::spawn(process_plain_text_update(
                            client.clone(),
                            account.clone(),
                            rpc_handler.clone(),
                            logs.clone(),
                            session_route_state.clone(),
                            inbound.clone(),
                            prompt,
                            streaming_mode,
                            reply_to_mode,
                        ));
                        None
                    }
                    other => match handle_command(
                        &client,
                        &account,
                        rpc_handler.as_ref(),
                        &logs,
                        &inbound,
                        other,
                        &session_route_state,
                        &mut pending_confirmation,
                    )
                    .await
                    {
                        Ok(text) => text,
                        Err(error) => Some(format!("❌ {}", error)),
                    },
                }
            } else {
                tokio::spawn(process_plain_text_update(
                    client.clone(),
                    account.clone(),
                    rpc_handler.clone(),
                    logs.clone(),
                    session_route_state.clone(),
                    inbound.clone(),
                    text.to_string(),
                    streaming_mode,
                    reply_to_mode,
                ));
                None
            };

            if let Some(reply_text) = reply {
                if let Err(error) = send_message_chunks(
                    &client,
                    &account.bot_token,
                    inbound.chat_id,
                    reply_text,
                    message_thread_id,
                    reply_to_mode,
                    inbound.message_id,
                )
                .await
                {
                    logs.write().await.add(
                        "warn",
                        &format!(
                            "[TelegramGateway] account={} 发送消息失败: {}",
                            account.account_id, error
                        ),
                    );
                }
            }
        }
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
        &format!(
            "[TelegramGateway] 账号轮询已停止: account={}",
            account.account_id
        ),
    );
}

fn resolve_telegram_accounts(
    telegram: &TelegramBotConfig,
    account_filter: Option<&str>,
) -> Result<Vec<ResolvedTelegramAccount>, String> {
    if !telegram.enabled {
        return Ok(Vec::new());
    }

    let mut resolved = Vec::new();
    let legacy_allow = telegram
        .allowed_user_ids
        .iter()
        .map(|item| normalize_allow_entry(item))
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>();

    if telegram.accounts.is_empty() {
        if telegram.bot_token.trim().is_empty() {
            return Ok(Vec::new());
        }
        let allow_from = merge_allow_from(&telegram.allow_from, &legacy_allow);
        resolved.push(ResolvedTelegramAccount {
            account_id: "default".to_string(),
            bot_token: telegram.bot_token.trim().to_string(),
            default_model: normalize_optional_text(telegram.default_model.as_deref()),
            dm_policy: normalize_dm_policy(&telegram.dm_policy),
            allow_from,
            group_policy: normalize_group_policy(&telegram.group_policy),
            group_allow_from: normalize_allow_set(&telegram.group_allow_from),
            groups: telegram.groups.clone(),
            streaming: normalize_streaming_mode(&telegram.streaming),
            reply_to_mode: normalize_reply_to_mode(&telegram.reply_to_mode),
        });
    } else {
        for (account_id, account) in &telegram.accounts {
            if !account.enabled {
                continue;
            }
            let token = resolve_account_token(telegram, account_id, account);
            if token.trim().is_empty() {
                continue;
            }
            let allow_from = if account.allow_from.is_empty() {
                merge_allow_from(&telegram.allow_from, &legacy_allow)
            } else {
                normalize_allow_set(&account.allow_from)
            };
            let group_allow_from = if account.group_allow_from.is_empty() {
                normalize_allow_set(&telegram.group_allow_from)
            } else {
                normalize_allow_set(&account.group_allow_from)
            };
            let groups = if account.groups.is_empty() {
                telegram.groups.clone()
            } else {
                account.groups.clone()
            };

            resolved.push(ResolvedTelegramAccount {
                account_id: account_id.to_string(),
                bot_token: token,
                default_model: normalize_optional_text(
                    account
                        .default_model
                        .as_deref()
                        .or(telegram.default_model.as_deref()),
                ),
                dm_policy: normalize_dm_policy(
                    account
                        .dm_policy
                        .as_deref()
                        .unwrap_or(telegram.dm_policy.as_str()),
                ),
                allow_from,
                group_policy: normalize_group_policy(
                    account
                        .group_policy
                        .as_deref()
                        .unwrap_or(telegram.group_policy.as_str()),
                ),
                group_allow_from,
                groups,
                streaming: normalize_streaming_mode(
                    account
                        .streaming
                        .as_deref()
                        .unwrap_or(telegram.streaming.as_str()),
                ),
                reply_to_mode: normalize_reply_to_mode(
                    account
                        .reply_to_mode
                        .as_deref()
                        .unwrap_or(telegram.reply_to_mode.as_str()),
                ),
            });
        }

        if resolved.is_empty() && !telegram.bot_token.trim().is_empty() {
            let allow_from = merge_allow_from(&telegram.allow_from, &legacy_allow);
            resolved.push(ResolvedTelegramAccount {
                account_id: "default".to_string(),
                bot_token: telegram.bot_token.trim().to_string(),
                default_model: normalize_optional_text(telegram.default_model.as_deref()),
                dm_policy: normalize_dm_policy(&telegram.dm_policy),
                allow_from,
                group_policy: normalize_group_policy(&telegram.group_policy),
                group_allow_from: normalize_allow_set(&telegram.group_allow_from),
                groups: telegram.groups.clone(),
                streaming: normalize_streaming_mode(&telegram.streaming),
                reply_to_mode: normalize_reply_to_mode(&telegram.reply_to_mode),
            });
        }
    }

    if let Some(filter) = account_filter {
        let selected = resolved
            .into_iter()
            .filter(|item| item.account_id == filter)
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Err(format!("未找到 Telegram 账号: {}", filter));
        }
        return Ok(selected);
    }

    Ok(resolved)
}

fn resolve_account_token(
    telegram: &TelegramBotConfig,
    account_id: &str,
    account: &TelegramAccountConfig,
) -> String {
    if let Some(token) = account.bot_token.as_ref() {
        if !token.trim().is_empty() {
            return token.trim().to_string();
        }
    }
    if let Some(token_file) = account.token_file.as_ref() {
        if let Some(token) = read_bot_token_from_file(token_file) {
            return token;
        }
    }
    if account_id == "default" {
        return telegram.bot_token.trim().to_string();
    }
    String::new()
}

fn read_bot_token_from_file(path: &str) -> Option<String> {
    let expanded = proxycast_core::config::expand_tilde(path);
    let content = std::fs::read_to_string(expanded).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        for key in ["bot_token", "token", "telegram_bot_token"] {
            if let Some(value) = json.get(key).and_then(|item| item.as_str()) {
                let candidate = value.trim();
                if !candidate.is_empty() {
                    return Some(candidate.to_string());
                }
            }
        }
    }

    Some(trimmed.to_string())
}

fn merge_allow_from(top_allow_from: &[String], legacy_allow: &HashSet<String>) -> HashSet<String> {
    let mut merged = normalize_allow_set(top_allow_from);
    merged.extend(legacy_allow.iter().cloned());
    merged
}

fn normalize_allow_set(input: &[String]) -> HashSet<String> {
    input
        .iter()
        .map(|item| normalize_allow_entry(item))
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>()
}

fn normalize_allow_entry(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("telegram:")
        .trim_start_matches("tg:")
        .to_ascii_lowercase()
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
        "progress" => "partial".to_string(),
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

fn resolve_reply_to_message_id(
    reply_to_mode: ReplyToMode,
    inbound_message_id: i64,
    is_first_chunk: bool,
) -> Option<i64> {
    if inbound_message_id <= 0 {
        return None;
    }

    match reply_to_mode {
        ReplyToMode::Off => None,
        ReplyToMode::First => {
            if is_first_chunk {
                Some(inbound_message_id)
            } else {
                None
            }
        }
        ReplyToMode::All => Some(inbound_message_id),
    }
}

fn to_inbound_message(update: TelegramUpdate) -> Option<InboundMessage> {
    if let Some(message) = update.message.or(update.edited_message) {
        let text = message.text.or(message.caption).unwrap_or_default();
        return Some(InboundMessage {
            message_id: message.message_id,
            chat_id: message.chat.id,
            chat_kind: message.chat.kind,
            sender_id: message.from.map(|item| item.id),
            text,
            message_thread_id: message.message_thread_id,
        });
    }

    if let Some(callback) = update.callback_query {
        let message = callback.message?;
        let data = callback.data.unwrap_or_default();
        if data.is_empty() {
            return None;
        }
        return Some(InboundMessage {
            message_id: message.message_id,
            chat_id: message.chat.id,
            chat_kind: message.chat.kind,
            sender_id: Some(callback.from.id),
            text: format!("callback_data:{}", data),
            message_thread_id: message.message_thread_id,
        });
    }

    None
}

fn authorize_message(
    account: &ResolvedTelegramAccount,
    inbound: &InboundMessage,
    bot_username: &str,
) -> Result<(), String> {
    if inbound.chat_kind == "private" {
        return authorize_dm(account, inbound.sender_id);
    }

    authorize_group(account, inbound, bot_username)
}

fn authorize_dm(account: &ResolvedTelegramAccount, sender_id: Option<i64>) -> Result<(), String> {
    let sender = sender_id
        .map(|id| id.to_string())
        .ok_or_else(|| "无法识别发送者 ID".to_string())?;

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
    account: &ResolvedTelegramAccount,
    inbound: &InboundMessage,
    bot_username: &str,
) -> Result<(), String> {
    let chat_id = inbound.chat_id.to_string();
    let sender = inbound
        .sender_id
        .map(|item| item.to_string())
        .ok_or_else(|| "无法识别群组发送者 ID".to_string())?;

    let group_cfg = account
        .groups
        .get(&chat_id)
        .or_else(|| account.groups.get("*"));

    let topic_cfg = group_cfg.and_then(|group| {
        inbound
            .message_thread_id
            .map(|thread_id| thread_id.to_string())
            .and_then(|thread_id| {
                group
                    .topics
                    .get(&thread_id)
                    .or_else(|| group.topics.get("*"))
            })
    });

    let effective_group_policy = topic_cfg
        .and_then(|topic| topic.group_policy.as_deref())
        .or_else(|| group_cfg.and_then(|group| group.group_policy.as_deref()))
        .map(normalize_group_policy)
        .unwrap_or_else(|| account.group_policy.clone());

    let group_allowed = match group_cfg {
        Some(group) => group.enabled.unwrap_or(true),
        None => effective_group_policy == "open",
    };
    if !group_allowed {
        return Err(format!("群组 {} 未加入 allowlist", chat_id));
    }

    let require_mention = topic_cfg
        .and_then(|topic| topic.require_mention)
        .or_else(|| group_cfg.and_then(|group| group.require_mention))
        .unwrap_or(true);

    if require_mention
        && !is_slash_command(&inbound.text)
        && !is_message_mentioning_bot(&inbound.text, bot_username)
    {
        return Err("群组消息需要 mention 触发".to_string());
    }

    match effective_group_policy.as_str() {
        "disabled" => Err("群组消息已禁用".to_string()),
        "open" => Ok(()),
        _ => {
            let allow_from = if let Some(topic) = topic_cfg {
                if !topic.allow_from.is_empty() {
                    normalize_allow_set(&topic.allow_from)
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

fn is_message_mentioning_bot(text: &str, bot_username: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }

    if bot_username.is_empty() {
        return text.trim_start().starts_with('/');
    }

    let lowered = text.to_ascii_lowercase();
    let mention = format!("@{}", bot_username.to_ascii_lowercase());
    lowered.contains(&mention)
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

fn sanitize_message_thread_id(chat_kind: &str, message_thread_id: Option<i64>) -> Option<i64> {
    if chat_kind == "supergroup" {
        return message_thread_id;
    }
    None
}

async fn handle_plain_text_with_mode(
    client: &reqwest::Client,
    account: &ResolvedTelegramAccount,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_route_state: &SessionRouteState,
    inbound: &InboundMessage,
    text: String,
    session_id_override: Option<String>,
    streaming_mode: StreamingMode,
    reply_to_mode: ReplyToMode,
) -> Result<PlainTextReply, String> {
    let session_id = match session_id_override {
        Some(value) => value,
        None => resolve_active_session_id(account, inbound, session_route_state).await,
    };
    let message_thread_id =
        sanitize_message_thread_id(&inbound.chat_kind, inbound.message_thread_id);
    let first_reply_to_message_id =
        resolve_reply_to_message_id(reply_to_mode, inbound.message_id, true);

    logs.write().await.add(
        "info",
        &format!(
            "[TelegramGateway] account={} 收到文本消息: chat={} sender={:?} messageId={} session={} streaming={:?} model={} search_mode=allowed",
            account.account_id,
            inbound.chat_id,
            inbound.sender_id,
            inbound.message_id,
            session_id,
            streaming_mode,
            account.default_model.as_deref().unwrap_or("<rpc-default>")
        ),
    );

    let mut progress_message_id = if streaming_mode == StreamingMode::Partial {
        match send_message_get_id(
            client,
            &account.bot_token,
            inbound.chat_id,
            "⏳ 正在处理请求...",
            message_thread_id,
            first_reply_to_message_id,
        )
        .await
        {
            Ok(message_id) => Some(message_id),
            Err(error) => {
                logs.write().await.add(
                    "warn",
                    &format!(
                        "[TelegramGateway] account={} 发送进度消息失败: {}",
                        account.account_id, error
                    ),
                );
                None
            }
        }
    } else {
        None
    };

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

    let run_value = match run_response.result {
        Some(value) => value,
        None => {
            let error = extract_rpc_error(run_response.error, "agent.run 失败");
            if let Some(message_id) = progress_message_id {
                let _ = edit_message(
                    client,
                    &account.bot_token,
                    inbound.chat_id,
                    message_id,
                    &format!("❌ {}", error),
                )
                .await;
                return Ok(PlainTextReply::AlreadySent);
            }
            return Err(error);
        }
    };
    let run_result: AgentRunResult = parse_result(run_value)?;
    logs.write().await.add(
        "info",
        &format!(
            "[TelegramGateway] account={} agent.run 已创建: runId={} session={}",
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

        let wait_value = match wait_response.result {
            Some(value) => value,
            None => {
                let error = extract_rpc_error(wait_response.error, "agent.wait 失败");
                if let Some(message_id) = progress_message_id {
                    let _ = edit_message(
                        client,
                        &account.bot_token,
                        inbound.chat_id,
                        message_id,
                        &format!("❌ {}", error),
                    )
                    .await;
                    return Ok(PlainTextReply::AlreadySent);
                }
                return Err(error);
            }
        };
        let wait_result: AgentWaitResult = parse_result(wait_value)?;

        if wait_result.completed {
            let content = wait_result
                .content
                .unwrap_or_else(|| "任务已完成，但无可展示输出".to_string());
            logs.write().await.add(
                "info",
                &format!(
                    "[TelegramGateway] account={} runId={} 已完成: contentLen={}",
                    account.account_id,
                    run_result.run_id,
                    content.chars().count()
                ),
            );
            if let Some(message_id) = progress_message_id {
                let chunks = split_message_chunks(&content);
                if let Some(first_chunk) = chunks.first() {
                    if edit_message(
                        client,
                        &account.bot_token,
                        inbound.chat_id,
                        message_id,
                        first_chunk,
                    )
                    .await
                    .is_ok()
                    {
                        for chunk in chunks.iter().skip(1) {
                            let reply_to = if reply_to_mode == ReplyToMode::All {
                                Some(inbound.message_id)
                            } else {
                                None
                            };
                            let _ = send_message(
                                client,
                                &account.bot_token,
                                inbound.chat_id,
                                chunk,
                                message_thread_id,
                                reply_to,
                            )
                            .await;
                        }
                        return Ok(PlainTextReply::AlreadySent);
                    }
                }
            }
            return Ok(PlainTextReply::Message(content));
        }

        if matches!(
            streaming_mode,
            StreamingMode::Partial | StreamingMode::Block
        ) && round % 3 == 0
        {
            let _ = send_chat_action(
                client,
                &account.bot_token,
                inbound.chat_id,
                "typing",
                message_thread_id,
            )
            .await;
        }

        if streaming_mode == StreamingMode::Partial && round % 5 == 0 {
            if let Some(message_id) = progress_message_id {
                let elapsed = ((round as u64) * RUN_WAIT_TIMEOUT_MS) / 1000;
                let progress_text = format!("⏳ 正在处理，请稍候... {}s", elapsed.max(1));
                if edit_message(
                    client,
                    &account.bot_token,
                    inbound.chat_id,
                    message_id,
                    &progress_text,
                )
                .await
                .is_err()
                {
                    progress_message_id = None;
                }
            }
        }

        if round % 20 == 0 {
            logs.write().await.add(
                "info",
                &format!(
                    "[TelegramGateway] account={} runId={} 等待中: round={} completed={}",
                    account.account_id, run_result.run_id, round, wait_result.completed
                ),
            );
        }
    }

    let timeout_message = "等待任务完成超时，请稍后使用 /status 查询".to_string();
    logs.write().await.add(
        "warn",
        &format!(
            "[TelegramGateway] account={} runId={} 等待超时: maxRounds={}",
            account.account_id, run_result.run_id, RUN_WAIT_MAX_ROUNDS
        ),
    );
    if let Some(message_id) = progress_message_id.take() {
        let _ = edit_message(
            client,
            &account.bot_token,
            inbound.chat_id,
            message_id,
            &format!("⏱️ {}", timeout_message),
        )
        .await;
        return Ok(PlainTextReply::AlreadySent);
    }

    Err(timeout_message)
}

async fn process_plain_text_update(
    client: reqwest::Client,
    account: ResolvedTelegramAccount,
    rpc_handler: Arc<RpcHandler>,
    logs: LogState,
    session_route_state: SessionRouteState,
    inbound: InboundMessage,
    text: String,
    streaming_mode: StreamingMode,
    reply_to_mode: ReplyToMode,
) {
    let message_thread_id =
        sanitize_message_thread_id(&inbound.chat_kind, inbound.message_thread_id);
    let reply = match handle_plain_text_with_mode(
        &client,
        &account,
        rpc_handler.as_ref(),
        &logs,
        &session_route_state,
        &inbound,
        text,
        None,
        streaming_mode,
        reply_to_mode,
    )
    .await
    {
        Ok(PlainTextReply::AlreadySent) => None,
        Ok(PlainTextReply::Message(text)) => Some(text),
        Err(error) => Some(format!("❌ {}", error)),
    };

    if let Some(reply_text) = reply {
        if let Err(error) = send_message_chunks(
            &client,
            &account.bot_token,
            inbound.chat_id,
            reply_text,
            message_thread_id,
            reply_to_mode,
            inbound.message_id,
        )
        .await
        {
            logs.write().await.add(
                "warn",
                &format!(
                    "[TelegramGateway] account={} 文本任务回包失败: {}",
                    account.account_id, error
                ),
            );
        }
    }
}

fn build_session_key(account: &ResolvedTelegramAccount, inbound: &InboundMessage) -> String {
    let thread_suffix = inbound
        .message_thread_id
        .map(|thread| format!(":topic:{}", thread))
        .unwrap_or_default();

    if inbound.chat_kind == "private" {
        return format!(
            "agent:main:telegram:{}:direct:{}{}",
            account.account_id, inbound.chat_id, thread_suffix
        );
    }

    format!(
        "agent:main:telegram:{}:group:{}{}",
        account.account_id, inbound.chat_id, thread_suffix
    )
}

async fn resolve_active_session_id(
    account: &ResolvedTelegramAccount,
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
    account: &ResolvedTelegramAccount,
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

async fn handle_command(
    client: &reqwest::Client,
    account: &ResolvedTelegramAccount,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    inbound: &InboundMessage,
    command: TelegramCommand,
    session_route_state: &SessionRouteState,
    pending_confirmation: &mut Option<PendingConfirmation>,
) -> Result<Option<String>, String> {
    match command {
        TelegramCommand::Help => Ok(Some(help_text())),
        TelegramCommand::Cancel => {
            *pending_confirmation = None;
            Ok(Some("🧹 已取消待确认操作".to_string()))
        }
        TelegramCommand::Confirm(token) => {
            let confirmed = take_pending_confirmation(pending_confirmation, &token)?;
            dispatch_command(rpc_handler, confirmed).await.map(Some)
        }
        cmd if requires_confirmation(&cmd) => {
            let token = set_pending_confirmation(pending_confirmation, cmd.clone());
            Ok(Some(format!(
                "⚠️ 检测到危险操作：{}\n请在 {} 秒内发送 /confirm {} 继续，或发送 /cancel 取消。",
                danger_command_label(&cmd),
                CONFIRMATION_TTL_SECS,
                token
            )))
        }
        TelegramCommand::Run(prompt) => {
            match handle_plain_text_with_mode(
                client,
                account,
                rpc_handler,
                logs,
                session_route_state,
                inbound,
                prompt,
                None,
                parse_streaming_mode(&account.streaming),
                parse_reply_to_mode(&account.reply_to_mode),
            )
            .await?
            {
                PlainTextReply::AlreadySent => Ok(None),
                PlainTextReply::Message(text) => Ok(Some(text)),
            }
        }
        TelegramCommand::New(first_prompt) => {
            let new_session_id =
                rotate_active_session_id(account, inbound, session_route_state).await;
            logs.write().await.add(
                "info",
                &format!(
                    "[TelegramGateway] account={} 开启新会话: chat={} session={}",
                    account.account_id, inbound.chat_id, new_session_id
                ),
            );

            if let Some(prompt) = first_prompt {
                match handle_plain_text_with_mode(
                    client,
                    account,
                    rpc_handler,
                    logs,
                    session_route_state,
                    inbound,
                    prompt,
                    Some(new_session_id.clone()),
                    parse_streaming_mode(&account.streaming),
                    parse_reply_to_mode(&account.reply_to_mode),
                )
                .await?
                {
                    PlainTextReply::AlreadySent => Ok(None),
                    PlainTextReply::Message(text) => Ok(Some(text)),
                }
            } else {
                Ok(Some(format!(
                    "🆕 已开启新对话\nsession_id: {}\n后续消息会在这个新会话中进行。",
                    new_session_id
                )))
            }
        }
        cmd => dispatch_command(rpc_handler, cmd).await.map(Some),
    }
}

fn set_pending_confirmation(
    pending_confirmation: &mut Option<PendingConfirmation>,
    command: TelegramCommand,
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
) -> Result<TelegramCommand, String> {
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
        TelegramCommand::New(_) => return Err("内部错误：new 不应构造 RPC 请求".to_string()),
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

fn extract_rpc_error(
    error: Option<proxycast_websocket::protocol::RpcError>,
    fallback: &str,
) -> String {
    if let Some(err) = error {
        return format!("{} (code={})", err.message, err.code);
    }
    fallback.to_string()
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
        "/new" | "/reset" => {
            if rest.is_empty() {
                Ok(TelegramCommand::New(None))
            } else {
                Ok(TelegramCommand::New(Some(rest.to_string())))
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

fn help_text() -> String {
    [
        "🤖 ProxyCast Telegram Gateway 命令",
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
            (
                "allowed_updates",
                r#"[\"message\",\"edited_message\",\"callback_query\",\"message_reaction\"]"#
                    .to_string(),
            ),
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

async fn get_me(client: &reqwest::Client, bot_token: &str) -> Result<TelegramMe, String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/getMe");
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求 getMe 失败: {e}"))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 getMe 响应失败: {e}"))?;
    let parsed: TelegramApiResponse<TelegramMe> =
        serde_json::from_str(&body).map_err(|e| format!("解析 getMe 响应失败: {e}"))?;
    if !parsed.ok {
        return Err(parsed
            .description
            .unwrap_or_else(|| "Telegram getMe 失败".to_string()));
    }
    parsed
        .result
        .ok_or_else(|| "Telegram getMe 缺少 result".to_string())
}

fn split_message_chunks(text: &str) -> Vec<String> {
    let total_chars = text.chars().count();
    if total_chars <= TELEGRAM_MAX_MESSAGE_LEN {
        return vec![text.to_string()];
    }

    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + TELEGRAM_MAX_MESSAGE_LEN).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        chunks.push(chunk);
        start = end;
    }

    chunks
}

fn build_send_message_payload(
    chat_id: i64,
    text: &str,
    message_thread_id: Option<i64>,
    reply_to_message_id: Option<i64>,
) -> serde_json::Value {
    let mut payload = serde_json::Map::new();
    payload.insert("chat_id".to_string(), json!(chat_id));
    payload.insert("text".to_string(), json!(truncate_message(text)));
    if let Some(thread_id) = message_thread_id {
        payload.insert("message_thread_id".to_string(), json!(thread_id));
    }
    if let Some(reply_id) = reply_to_message_id {
        payload.insert("reply_to_message_id".to_string(), json!(reply_id));
    }
    serde_json::Value::Object(payload)
}

fn is_thread_related_send_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("message thread")
        || lowered.contains("message_thread_id")
        || lowered.contains("topic")
}

fn is_reply_related_send_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("reply_to_message_id")
        || lowered.contains("message to be replied not found")
        || lowered.contains("reply message not found")
}

async fn do_send_message(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    text: &str,
    message_thread_id: Option<i64>,
    reply_to_message_id: Option<i64>,
) -> Result<(), String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/sendMessage");
    let payload = build_send_message_payload(chat_id, text, message_thread_id, reply_to_message_id);
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

async fn do_send_message_get_id(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    text: &str,
    message_thread_id: Option<i64>,
    reply_to_message_id: Option<i64>,
) -> Result<i64, String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/sendMessage");
    let payload = build_send_message_payload(chat_id, text, message_thread_id, reply_to_message_id);
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
    let parsed: TelegramApiResponse<TelegramSendResult> =
        serde_json::from_str(&body).map_err(|e| format!("响应解析失败: {e}"))?;
    if !parsed.ok {
        return Err(parsed
            .description
            .unwrap_or_else(|| "Telegram API 返回失败".to_string()));
    }
    parsed
        .result
        .map(|item| item.message_id)
        .ok_or_else(|| "Telegram sendMessage 缺少 message_id".to_string())
}

async fn send_message_chunks(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    text: String,
    message_thread_id: Option<i64>,
    reply_to_mode: ReplyToMode,
    inbound_message_id: i64,
) -> Result<(), String> {
    let chunks = split_message_chunks(&text);
    for (index, chunk) in chunks.iter().enumerate() {
        let reply_to = resolve_reply_to_message_id(reply_to_mode, inbound_message_id, index == 0);
        send_message(
            client,
            bot_token,
            chat_id,
            chunk,
            message_thread_id,
            reply_to,
        )
        .await?;
    }
    Ok(())
}

async fn send_message(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    text: &str,
    message_thread_id: Option<i64>,
    reply_to_message_id: Option<i64>,
) -> Result<(), String> {
    match do_send_message(
        client,
        bot_token,
        chat_id,
        text,
        message_thread_id,
        reply_to_message_id,
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(primary) => {
            if message_thread_id.is_some() && is_thread_related_send_error(&primary) {
                return do_send_message(
                    client,
                    bot_token,
                    chat_id,
                    text,
                    None,
                    reply_to_message_id,
                )
                .await
                .map_err(|fallback| {
                    format!("{}; 去掉 message_thread_id 重试失败: {}", primary, fallback)
                });
            }
            if reply_to_message_id.is_some() && is_reply_related_send_error(&primary) {
                return do_send_message(client, bot_token, chat_id, text, message_thread_id, None)
                    .await
                    .map_err(|fallback| {
                        format!(
                            "{}; 去掉 reply_to_message_id 重试失败: {}",
                            primary, fallback
                        )
                    });
            }
            Err(primary)
        }
    }
}

async fn send_message_get_id(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    text: &str,
    message_thread_id: Option<i64>,
    reply_to_message_id: Option<i64>,
) -> Result<i64, String> {
    match do_send_message_get_id(
        client,
        bot_token,
        chat_id,
        text,
        message_thread_id,
        reply_to_message_id,
    )
    .await
    {
        Ok(message_id) => Ok(message_id),
        Err(primary) => {
            if message_thread_id.is_some() && is_thread_related_send_error(&primary) {
                return do_send_message_get_id(
                    client,
                    bot_token,
                    chat_id,
                    text,
                    None,
                    reply_to_message_id,
                )
                .await
                .map_err(|fallback| {
                    format!("{}; 去掉 message_thread_id 重试失败: {}", primary, fallback)
                });
            }
            if reply_to_message_id.is_some() && is_reply_related_send_error(&primary) {
                return do_send_message_get_id(
                    client,
                    bot_token,
                    chat_id,
                    text,
                    message_thread_id,
                    None,
                )
                .await
                .map_err(|fallback| {
                    format!(
                        "{}; 去掉 reply_to_message_id 重试失败: {}",
                        primary, fallback
                    )
                });
            }
            Err(primary)
        }
    }
}

async fn edit_message(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    message_id: i64,
    text: &str,
) -> Result<(), String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/editMessageText");
    let payload = json!({
        "chat_id": chat_id,
        "message_id": message_id,
        "text": truncate_message(text),
    });
    let response = client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("编辑消息失败: {e}"))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let parsed: TelegramApiResponse<serde_json::Value> =
        serde_json::from_str(&body).map_err(|e| format!("响应解析失败: {e}"))?;
    if !parsed.ok {
        return Err(parsed
            .description
            .unwrap_or_else(|| "Telegram editMessageText 失败".to_string()));
    }
    Ok(())
}

async fn send_chat_action(
    client: &reqwest::Client,
    bot_token: &str,
    chat_id: i64,
    action: &str,
    message_thread_id: Option<i64>,
) -> Result<(), String> {
    let url = format!("{TELEGRAM_API_BASE}/bot{bot_token}/sendChatAction");
    let mut payload = serde_json::Map::new();
    payload.insert("chat_id".to_string(), json!(chat_id));
    payload.insert("action".to_string(), json!(action));
    if let Some(thread_id) = message_thread_id {
        payload.insert("message_thread_id".to_string(), json!(thread_id));
    }
    let response = client
        .post(url)
        .json(&serde_json::Value::Object(payload))
        .send()
        .await
        .map_err(|e| format!("发送 chat action 失败: {e}"))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let parsed: TelegramApiResponse<serde_json::Value> =
        serde_json::from_str(&body).map_err(|e| format!("响应解析失败: {e}"))?;
    if !parsed.ok {
        return Err(parsed
            .description
            .unwrap_or_else(|| "Telegram sendChatAction 失败".to_string()));
    }
    Ok(())
}

fn truncate_message(text: &str) -> String {
    if text.chars().count() <= TELEGRAM_MAX_MESSAGE_LEN {
        return text.to_string();
    }
    let truncated: String = text.chars().take(TELEGRAM_MAX_MESSAGE_LEN).collect();
    format!("{truncated}\n...[truncated]")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    fn build_account(token: Option<&str>) -> TelegramAccountConfig {
        let mut account = TelegramAccountConfig::default();
        account.enabled = true;
        account.bot_token = token.map(|item| item.to_string());
        account
    }

    #[test]
    fn resolve_accounts_keeps_all_enabled_accounts() {
        let mut telegram = TelegramBotConfig::default();
        telegram.enabled = true;
        telegram.default_account = Some("alpha".to_string());
        telegram
            .accounts
            .insert("alpha".to_string(), build_account(Some("token-alpha")));
        telegram
            .accounts
            .insert("beta".to_string(), build_account(Some("token-beta")));

        let resolved = resolve_telegram_accounts(&telegram, None).expect("账号解析失败");
        let mut ids = resolved
            .iter()
            .map(|item| item.account_id.clone())
            .collect::<Vec<_>>();
        ids.sort();

        assert_eq!(ids, vec!["alpha".to_string(), "beta".to_string()]);
    }

    #[test]
    fn resolve_account_supports_token_file_json() {
        let mut token_file = tempfile::NamedTempFile::new().expect("创建临时文件失败");
        writeln!(token_file, "{{\"bot_token\":\"token-from-file\"}}").expect("写入 token 文件失败");

        let mut telegram = TelegramBotConfig::default();
        telegram.enabled = true;
        let mut account = build_account(None);
        account.token_file = Some(token_file.path().to_string_lossy().to_string());
        telegram.accounts.insert("alpha".to_string(), account);

        let resolved = resolve_telegram_accounts(&telegram, Some("alpha")).expect("账号解析失败");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].bot_token, "token-from-file".to_string());
    }

    #[test]
    fn split_message_chunks_respects_limit() {
        let source = "x".repeat(TELEGRAM_MAX_MESSAGE_LEN + 12);
        let chunks = split_message_chunks(&source);

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].chars().count(), TELEGRAM_MAX_MESSAGE_LEN);
        assert_eq!(chunks[1].chars().count(), 12);
    }

    #[test]
    fn resolve_reply_to_message_id_by_mode() {
        assert_eq!(
            resolve_reply_to_message_id(ReplyToMode::Off, 99, true),
            None
        );
        assert_eq!(
            resolve_reply_to_message_id(ReplyToMode::First, 99, true),
            Some(99)
        );
        assert_eq!(
            resolve_reply_to_message_id(ReplyToMode::First, 99, false),
            None
        );
        assert_eq!(
            resolve_reply_to_message_id(ReplyToMode::All, 99, false),
            Some(99)
        );
    }

    #[test]
    fn authorize_group_allows_slash_command_without_mention() {
        let account = ResolvedTelegramAccount {
            account_id: "default".to_string(),
            bot_token: "token".to_string(),
            default_model: None,
            dm_policy: "allowlist".to_string(),
            allow_from: HashSet::new(),
            group_policy: "open".to_string(),
            group_allow_from: HashSet::new(),
            groups: HashMap::new(),
            streaming: "partial".to_string(),
            reply_to_mode: "off".to_string(),
        };
        let inbound = InboundMessage {
            message_id: 1,
            chat_id: -10012345,
            chat_kind: "group".to_string(),
            sender_id: Some(42),
            text: "/help".to_string(),
            message_thread_id: None,
        };

        let result = authorize_group(&account, &inbound, "proxycast_bot");
        assert!(result.is_ok(), "slash command 应该允许直接触发");
    }

    #[test]
    fn sanitize_message_thread_id_only_for_supergroup() {
        assert_eq!(sanitize_message_thread_id("private", Some(123)), None);
        assert_eq!(sanitize_message_thread_id("group", Some(123)), None);
        assert_eq!(
            sanitize_message_thread_id("supergroup", Some(123)),
            Some(123)
        );
    }

    #[test]
    fn send_error_classifier_detects_thread_and_reply_cases() {
        assert!(is_thread_related_send_error(
            "Bad Request: message thread not found"
        ));
        assert!(is_reply_related_send_error(
            "Bad Request: message to be replied not found"
        ));
    }

    #[test]
    fn parse_new_command_supports_optional_prompt() {
        assert!(matches!(
            parse_telegram_command("/new"),
            Ok(TelegramCommand::New(None))
        ));
        assert!(matches!(
            parse_telegram_command("/reset"),
            Ok(TelegramCommand::New(None))
        ));
        assert!(matches!(
            parse_telegram_command("/new 你好"),
            Ok(TelegramCommand::New(Some(prompt))) if prompt == "你好"
        ));
    }

    #[test]
    fn help_text_contains_new_command() {
        let text = help_text();
        assert!(text.contains("/new"));
    }

    #[tokio::test]
    async fn rotate_session_id_switches_active_session() {
        let account = ResolvedTelegramAccount {
            account_id: "default".to_string(),
            bot_token: "token".to_string(),
            default_model: None,
            dm_policy: "allowlist".to_string(),
            allow_from: HashSet::new(),
            group_policy: "open".to_string(),
            group_allow_from: HashSet::new(),
            groups: HashMap::new(),
            streaming: "partial".to_string(),
            reply_to_mode: "off".to_string(),
        };
        let inbound = InboundMessage {
            message_id: 1,
            chat_id: 42,
            chat_kind: "private".to_string(),
            sender_id: Some(42),
            text: "hello".to_string(),
            message_thread_id: None,
        };
        let state: SessionRouteState = Arc::new(RwLock::new(HashMap::new()));

        let before = resolve_active_session_id(&account, &inbound, &state).await;
        let rotated = rotate_active_session_id(&account, &inbound, &state).await;
        let after = resolve_active_session_id(&account, &inbound, &state).await;

        assert_eq!(after, rotated);
        assert_ne!(before, rotated);
    }
}
