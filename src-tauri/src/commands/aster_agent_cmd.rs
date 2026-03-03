//! Aster Agent 命令模块
//!
//! 提供基于 Aster 框架的 Tauri 命令
//! 这是新的对话系统实现，与 native_agent_cmd.rs 并行存在
//! 支持从 ProxyCast 凭证池自动选择凭证

use crate::agent::aster_state::{ProviderConfig, SessionConfigBuilder};
use crate::agent::{
    AsterAgentState, AsterAgentWrapper, HeartbeatServiceAdapter, SessionDetail, SessionInfo,
    TauriAgentEvent,
};
use crate::commands::webview_cmd::{
    browser_execute_action_global, BrowserActionRequest, BrowserBackendType,
};
use crate::config::GlobalConfigManagerState;
use crate::database::dao::agent::AgentDao;
use crate::database::DbConnection;
use crate::mcp::{McpManagerState, McpServerConfig};
use crate::services::execution_tracker_service::{ExecutionTracker, RunFinalizeOptions, RunSource};
use crate::services::heartbeat_service::HeartbeatServiceState;
use crate::services::memory_profile_prompt_service::merge_system_prompt_with_memory_profile;
use crate::services::web_search_prompt_service::merge_system_prompt_with_web_search;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use crate::LogState;
use aster::agents::extension::{Envs, ExtensionConfig};
use aster::agents::{Agent, AgentEvent};
use aster::chrome_mcp::get_chrome_mcp_tools;
use aster::conversation::message::{Message, MessageContent};
use aster::permission::{
    ParameterRestriction, PermissionScope, RestrictionType, ToolPermission, ToolPermissionManager,
};
use aster::permission::{Permission, PermissionConfirmation, PrincipalType};
use aster::sandbox::{
    detect_best_sandbox, execute_in_sandbox, ResourceLimits, SandboxConfig as ProcessSandboxConfig,
};
use aster::tools::{
    BashTool, KillShellTool, PermissionBehavior, PermissionCheckResult, TaskManager,
    TaskOutputTool, TaskTool, Tool, ToolContext, ToolError, ToolOptions, ToolResult,
    MAX_OUTPUT_LENGTH,
};
use async_trait::async_trait;
use futures::StreamExt;
use proxycast_agent::event_converter::convert_agent_event;
use proxycast_services::mcp_service::McpService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

const DEFAULT_BASH_TIMEOUT_SECS: u64 = 300;
const MAX_BASH_TIMEOUT_SECS: u64 = 1800;
const CODE_EXECUTION_EXTENSION_NAME: &str = "code_execution";
const WORKSPACE_SANDBOX_ENABLED_ENV: &str = "PROXYCAST_WORKSPACE_SANDBOX_ENABLED";
const WORKSPACE_SANDBOX_STRICT_ENV: &str = "PROXYCAST_WORKSPACE_SANDBOX_STRICT";
const WORKSPACE_SANDBOX_NOTIFY_ENV: &str = "PROXYCAST_WORKSPACE_SANDBOX_NOTIFY_ON_FALLBACK";
const WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE: &str = "workspace_sandbox_fallback";
const WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE: &str = "workspace_path_auto_created";

static SHARED_TASK_MANAGER: OnceLock<Arc<TaskManager>> = OnceLock::new();

fn shared_task_manager() -> Arc<TaskManager> {
    SHARED_TASK_MANAGER
        .get_or_init(|| Arc::new(TaskManager::new()))
        .clone()
}

#[derive(Debug, Clone, Copy)]
struct WorkspaceSandboxPolicy {
    enabled: bool,
    strict: bool,
    notify_on_fallback: bool,
}

#[derive(Debug)]
enum WorkspaceSandboxApplyOutcome {
    Applied {
        sandbox_type: String,
    },
    DisabledByConfig,
    UnavailableFallback {
        warning_message: String,
        notify_user: bool,
    },
}

fn parse_bool_env(name: &str) -> Option<bool> {
    let raw = std::env::var(name).ok()?;
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn resolve_workspace_sandbox_policy(
    config_manager: &GlobalConfigManagerState,
) -> WorkspaceSandboxPolicy {
    let config = config_manager.config();
    let mut policy = WorkspaceSandboxPolicy {
        enabled: config.agent.workspace_sandbox.enabled,
        strict: config.agent.workspace_sandbox.strict,
        notify_on_fallback: config.agent.workspace_sandbox.notify_on_fallback,
    };

    if let Some(enabled) = parse_bool_env(WORKSPACE_SANDBOX_ENABLED_ENV) {
        policy.enabled = enabled;
    }
    if let Some(strict) = parse_bool_env(WORKSPACE_SANDBOX_STRICT_ENV) {
        policy.strict = strict;
    }
    if let Some(notify) = parse_bool_env(WORKSPACE_SANDBOX_NOTIFY_ENV) {
        policy.notify_on_fallback = notify;
    }

    policy
}

fn workspace_sandbox_platform_hint() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows 当前未检测到可用本地 sandbox 执行器，建议关闭该选项或使用非严格模式。"
    }
    #[cfg(target_os = "macos")]
    {
        "macOS 需提供 sandbox-exec。"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux 需安装 bwrap 或 firejail。"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "当前平台暂未集成本地 sandbox 执行器，建议关闭该选项。"
    }
}

fn build_workspace_sandbox_warning_message(reason: &str) -> String {
    format!("已启用 workspace 本地 sandbox，但当前环境不可用，已自动降级为普通执行。原因: {reason}")
}

/// Aster Agent 状态信息
#[derive(Debug, Serialize)]
pub struct AsterAgentStatus {
    pub initialized: bool,
    pub provider_configured: bool,
    pub provider_name: Option<String>,
    pub model_name: Option<String>,
    /// 凭证 UUID（来自凭证池）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_uuid: Option<String>,
}

/// Provider 配置请求
#[derive(Debug, Deserialize)]
pub struct ConfigureProviderRequest {
    pub provider_name: String,
    pub model_name: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
}

/// 从凭证池配置 Provider 的请求
#[derive(Debug, Deserialize)]
pub struct ConfigureFromPoolRequest {
    /// Provider 类型 (openai, anthropic, kiro, gemini 等)
    pub provider_type: String,
    /// 模型名称
    pub model_name: String,
}

/// 初始化 Aster Agent
#[tauri::command]
pub async fn aster_agent_init(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 初始化 Agent");

    state.init_agent_with_db(&db).await?;
    ensure_browser_mcp_tools_registered(state.inner()).await?;
    ensure_tool_search_tool_registered(state.inner()).await?;

    let provider_config = state.get_provider_config().await;

    tracing::info!("[AsterAgent] Agent 初始化成功");

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: provider_config.is_some(),
        provider_name: provider_config.as_ref().map(|c| c.provider_name.clone()),
        model_name: provider_config.as_ref().map(|c| c.model_name.clone()),
        credential_uuid: provider_config.and_then(|c| c.credential_uuid),
    })
}

/// 配置 Aster Agent 的 Provider
#[tauri::command]
pub async fn aster_agent_configure_provider(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: ConfigureProviderRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    tracing::info!(
        "[AsterAgent] 配置 Provider: {} / {}",
        request.provider_name,
        request.model_name
    );

    let config = ProviderConfig {
        provider_name: request.provider_name,
        model_name: request.model_name,
        api_key: request.api_key,
        base_url: request.base_url,
        credential_uuid: None,
    };

    state
        .configure_provider(config.clone(), &session_id, &db)
        .await?;

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: true,
        provider_name: Some(config.provider_name),
        model_name: Some(config.model_name),
        credential_uuid: None,
    })
}

/// 从凭证池配置 Aster Agent 的 Provider
///
/// 自动从 ProxyCast 凭证池选择可用凭证并配置 Aster Provider
#[tauri::command]
pub async fn aster_agent_configure_from_pool(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: ConfigureFromPoolRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    tracing::info!(
        "[AsterAgent] 从凭证池配置 Provider: {} / {}",
        request.provider_type,
        request.model_name
    );

    let aster_config = state
        .configure_provider_from_pool(
            &db,
            &request.provider_type,
            &request.model_name,
            &session_id,
        )
        .await?;

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: true,
        provider_name: Some(aster_config.provider_name),
        model_name: Some(aster_config.model_name),
        credential_uuid: Some(aster_config.credential_uuid),
    })
}

/// 获取 Aster Agent 状态
#[tauri::command]
pub async fn aster_agent_status(
    state: State<'_, AsterAgentState>,
) -> Result<AsterAgentStatus, String> {
    let provider_config = state.get_provider_config().await;
    Ok(AsterAgentStatus {
        initialized: state.is_initialized().await,
        provider_configured: provider_config.is_some(),
        provider_name: provider_config.as_ref().map(|c| c.provider_name.clone()),
        model_name: provider_config.as_ref().map(|c| c.model_name.clone()),
        credential_uuid: provider_config.and_then(|c| c.credential_uuid),
    })
}

/// 重置 Aster Agent
///
/// 清除当前 Provider 配置，下次对话时会重新从凭证池选择凭证。
/// 用于切换凭证后无需重启应用即可生效。
#[tauri::command]
pub async fn aster_agent_reset(
    state: State<'_, AsterAgentState>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 重置 Agent Provider 配置");

    // 清除当前 Provider 配置
    state.clear_provider_config().await;

    Ok(AsterAgentStatus {
        initialized: state.is_initialized().await,
        provider_configured: false,
        provider_name: None,
        model_name: None,
        credential_uuid: None,
    })
}

/// 发送消息请求参数
#[derive(Debug, Deserialize)]
pub struct AsterChatRequest {
    pub message: String,
    pub session_id: String,
    pub event_name: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub images: Option<Vec<ImageInput>>,
    /// Provider 配置（可选，如果未配置则使用当前配置）
    #[serde(default)]
    pub provider_config: Option<ConfigureProviderRequest>,
    /// 项目 ID（可选，用于注入项目上下文到 System Prompt）
    #[serde(default)]
    pub project_id: Option<String>,
    /// Workspace ID（必填，用于校验会话与工作区一致性）
    pub workspace_id: String,
    /// 执行策略（react / code_orchestrated / auto）
    #[serde(default)]
    pub execution_strategy: Option<AsterExecutionStrategy>,
}

/// Agent 执行策略
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AsterExecutionStrategy {
    React,
    CodeOrchestrated,
    Auto,
}

impl Default for AsterExecutionStrategy {
    fn default() -> Self {
        Self::Auto
    }
}

impl AsterExecutionStrategy {
    fn as_db_value(self) -> &'static str {
        match self {
            Self::React => "react",
            Self::CodeOrchestrated => "code_orchestrated",
            Self::Auto => "auto",
        }
    }

    fn from_db_value(value: Option<&str>) -> Self {
        match value {
            Some("code_orchestrated") => Self::CodeOrchestrated,
            Some("auto") => Self::Auto,
            _ => Self::Auto,
        }
    }

    fn effective_for_message(self, message: &str) -> Self {
        if should_force_react_for_message(message) {
            return Self::React;
        }

        match self {
            Self::Auto if should_use_code_orchestrated_for_message(message) => {
                Self::CodeOrchestrated
            }
            Self::Auto => Self::React,
            _ => self,
        }
    }
}

#[derive(Debug)]
struct ReplyAttemptError {
    message: String,
    emitted_any: bool,
}

fn should_force_react_for_message(message: &str) -> bool {
    let lowered = message.to_lowercase();
    let default_hints = [
        "tool_search",
        "调用 tool_search",
        "调用tool_search",
        "use tool_search",
        "call tool_search",
        "websearch",
        "web search",
        "web_search",
        "webfetch",
        "web fetch",
        "web_fetch",
        "联网搜索",
        "网络搜索",
        "实时新闻",
        "最新新闻",
        "今日要闻",
        "时事新闻",
        "breaking news",
        "news today",
    ];
    resolve_intent_hints("PROXYCAST_FORCE_REACT_HINTS", &default_hints)
        .iter()
        .any(|kw| lowered.contains(kw))
}

fn extract_inline_agent_provider_error(message: &Message) -> Option<String> {
    let text = message.as_concat_text();
    if !text.contains("Ran into this error:") {
        return None;
    }
    if !text.contains("Please retry if you think this is a transient or recoverable error.") {
        return None;
    }

    let after_prefix = text.split_once("Ran into this error:")?.1.trim();
    let detail = after_prefix
        .split_once("\n\nPlease retry if you think this is a transient or recoverable error.")
        .map(|(left, _)| left.trim())
        .unwrap_or(after_prefix)
        .trim_end_matches('.');

    if detail.is_empty() {
        return Some("Agent provider execution failed".to_string());
    }

    Some(format!("Agent provider execution failed: {detail}"))
}

fn should_use_code_orchestrated_for_message(message: &str) -> bool {
    let lowered = message.to_lowercase();
    // 默认不做消息关键词硬编码推断，Auto 模式优先走 ReAct。
    // 如需启用自动切换，可通过环境变量 PROXYCAST_CODE_ORCHESTRATED_HINTS 显式配置。
    resolve_intent_hints("PROXYCAST_CODE_ORCHESTRATED_HINTS", &[])
        .iter()
        .any(|kw| lowered.contains(kw))
}

fn resolve_intent_hints(env_key: &str, defaults: &[&str]) -> Vec<String> {
    if let Ok(raw) = std::env::var(env_key) {
        let parsed = raw
            .split(',')
            .map(|item| item.trim().to_lowercase())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        if !parsed.is_empty() {
            return parsed;
        }
    }

    defaults.iter().map(|item| item.to_string()).collect()
}

fn should_fallback_to_react_from_code_orchestrated(error: &ReplyAttemptError) -> bool {
    if !error.emitted_any {
        return true;
    }

    let lowered = error.message.to_lowercase();
    let recoverable_hints = ["unknown subscript", "tool_search_analysis", "web_scraping"];

    recoverable_hints.iter().any(|hint| lowered.contains(hint))
}

async fn ensure_code_execution_extension_enabled(agent: &Agent) -> Result<bool, String> {
    let extension_configs = agent.get_extension_configs().await;
    if extension_configs
        .iter()
        .any(|cfg| cfg.name() == CODE_EXECUTION_EXTENSION_NAME)
    {
        return Ok(false);
    }

    let extension = ExtensionConfig::Platform {
        name: CODE_EXECUTION_EXTENSION_NAME.to_string(),
        description: "Execute JavaScript code in a sandboxed environment".to_string(),
        bundled: Some(true),
        available_tools: vec![],
        deferred_loading: false,
        always_expose_tools: Vec::new(),
        allowed_caller: None,
    };

    agent
        .add_extension(extension)
        .await
        .map_err(|e| format!("启用 code_execution 扩展失败: {e}"))?;

    Ok(true)
}

async fn stream_reply_once(
    agent: &Agent,
    app: &AppHandle,
    event_name: &str,
    message_text: &str,
    session_config: aster::agents::SessionConfig,
    cancel_token: CancellationToken,
) -> Result<(), ReplyAttemptError> {
    let user_message = Message::user().with_text(message_text);
    let mut stream = agent
        .reply(user_message, session_config, Some(cancel_token))
        .await
        .map_err(|e| ReplyAttemptError {
            message: format!("Agent error: {e}"),
            emitted_any: false,
        })?;

    let mut emitted_any = false;
    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(agent_event) => {
                emitted_any = true;
                let inline_provider_error = match &agent_event {
                    AgentEvent::Message(message) => extract_inline_agent_provider_error(message),
                    _ => None,
                };
                let tauri_events = convert_agent_event(agent_event);
                for tauri_event in tauri_events {
                    if let Err(e) = app.emit(event_name, &tauri_event) {
                        tracing::error!("[AsterAgent] 发送事件失败: {}", e);
                    }
                }
                if let Some(message) = inline_provider_error {
                    tracing::warn!("[AsterAgent] 捕获到消息级 Provider 错误: {}", message);
                    return Err(ReplyAttemptError {
                        message,
                        emitted_any: true,
                    });
                }
            }
            Err(e) => {
                return Err(ReplyAttemptError {
                    message: format!("Stream error: {e}"),
                    emitted_any,
                });
            }
        }
    }

    Ok(())
}

/// 基于 aster::sandbox 的本地 bash 强隔离工具
#[derive(Debug)]
struct WorkspaceSandboxedBashTool {
    delegate: BashTool,
    sandbox_type_name: String,
    base_sandbox_config: ProcessSandboxConfig,
    auto_approve_warnings: bool,
}

impl WorkspaceSandboxedBashTool {
    fn new(workspace_root: &str, auto_approve_warnings: bool) -> Result<Self, String> {
        let workspace_root = workspace_root.trim();
        if workspace_root.is_empty() {
            return Err("workspace 根目录为空".to_string());
        }

        let sandbox_type = detect_best_sandbox();
        let sandbox_type_name = format!("{sandbox_type:?}");
        if sandbox_type_name == "None" {
            return Err(format!(
                "未检测到可用本地 sandbox 执行器。{}",
                workspace_sandbox_platform_hint()
            ));
        }

        let workspace_path = PathBuf::from(workspace_root);
        let mut read_only_paths = vec![
            PathBuf::from("/usr"),
            PathBuf::from("/bin"),
            PathBuf::from("/sbin"),
            PathBuf::from("/etc"),
            PathBuf::from("/System"),
            PathBuf::from("/Library"),
            workspace_path.clone(),
        ];
        read_only_paths.sort();
        read_only_paths.dedup();

        let mut writable_paths = vec![workspace_path.clone(), PathBuf::from("/tmp")];
        if cfg!(target_os = "macos") {
            writable_paths.push(PathBuf::from("/private/tmp"));
        }
        writable_paths.sort();
        writable_paths.dedup();

        let base_sandbox_config = ProcessSandboxConfig {
            enabled: true,
            sandbox_type,
            allowed_paths: vec![workspace_path],
            denied_paths: Vec::new(),
            network_access: false,
            environment_variables: HashMap::new(),
            read_only_paths,
            writable_paths,
            allow_dev_access: false,
            allow_proc_access: false,
            allow_sys_access: false,
            env_whitelist: Vec::new(),
            tmpfs_size: "64M".to_string(),
            unshare_all: true,
            die_with_parent: true,
            new_session: true,
            docker: None,
            custom_args: Vec::new(),
            audit_logging: None,
            resource_limits: None,
        };

        Ok(Self {
            delegate: BashTool::new(),
            sandbox_type_name,
            base_sandbox_config,
            auto_approve_warnings,
        })
    }

    fn sandbox_type(&self) -> &str {
        &self.sandbox_type_name
    }

    fn build_sandbox_config(
        &self,
        context: &ToolContext,
        timeout_secs: u64,
    ) -> ProcessSandboxConfig {
        let mut config = self.base_sandbox_config.clone();

        let mut environment_variables = HashMap::new();
        environment_variables.insert("ASTER_TERMINAL".to_string(), "1".to_string());
        for (key, value) in &context.environment {
            environment_variables.insert(key.clone(), value.clone());
        }
        if let Ok(path_env) = std::env::var("PATH") {
            environment_variables
                .entry("PATH".to_string())
                .or_insert(path_env);
        }

        config.environment_variables = environment_variables;
        config.resource_limits = Some(ResourceLimits {
            max_memory: Some(1024 * 1024 * 1024),
            max_cpu: Some(70),
            max_processes: Some(32),
            max_file_size: Some(50 * 1024 * 1024),
            max_execution_time: Some(timeout_secs.saturating_mul(1000)),
            max_file_descriptors: Some(256),
        });
        config
    }

    fn quote_shell(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }

    fn build_shell_command(&self, command: &str, context: &ToolContext) -> (String, Vec<String>) {
        #[cfg(target_os = "windows")]
        {
            return (
                "powershell".to_string(),
                vec![
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    command.to_string(),
                ],
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            let working_dir = context.working_directory.to_string_lossy().to_string();
            let wrapped_command = format!("cd {} && {}", Self::quote_shell(&working_dir), command);
            ("sh".to_string(), vec!["-lc".to_string(), wrapped_command])
        }
    }

    fn format_output(stdout: &str, stderr: &str, exit_code: i32) -> String {
        let mut output = String::new();

        if !stdout.is_empty() {
            output.push_str(stdout);
        }

        if !stderr.is_empty() {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            if !stdout.is_empty() {
                output.push_str("--- stderr ---\n");
            }
            output.push_str(stderr);
        }

        if exit_code != 0 && output.is_empty() {
            output = format!("Command exited with code {exit_code}");
        }

        if output.len() <= MAX_OUTPUT_LENGTH {
            return output;
        }

        let bytes = output.as_bytes();
        let truncated = String::from_utf8_lossy(&bytes[..MAX_OUTPUT_LENGTH]).to_string();
        format!(
            "{}\n\n[output truncated: {} bytes total]",
            truncated,
            output.len()
        )
    }
}

fn normalize_shell_command_params(params: &serde_json::Value) -> serde_json::Value {
    let mut normalized = params.clone();
    if let Some(object) = normalized.as_object_mut() {
        let has_command = object
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);

        if !has_command {
            if let Some(cmd_value) = object.get("cmd").cloned() {
                if cmd_value
                    .as_str()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false)
                {
                    object.insert("command".to_string(), cmd_value);
                }
            }
        }
    }
    normalized
}

fn normalize_workspace_tool_permission_behavior(
    permission: PermissionCheckResult,
    auto_approve_warnings: bool,
) -> PermissionCheckResult {
    if permission.behavior != PermissionBehavior::Ask {
        return permission;
    }

    let warning = permission
        .message
        .unwrap_or_else(|| "命令包含潜在风险操作".to_string());

    if auto_approve_warnings {
        tracing::warn!("[AsterAgent] Auto 模式自动通过 bash 风险提示: {}", warning);
        return PermissionCheckResult {
            behavior: PermissionBehavior::Allow,
            message: None,
            updated_params: permission.updated_params,
        };
    }

    PermissionCheckResult {
        behavior: PermissionBehavior::Deny,
        message: Some(format!(
            "{warning}。当前模式不支持交互确认，请切换到 Auto 模式或调整命令。"
        )),
        updated_params: permission.updated_params,
    }
}

#[async_trait]
impl Tool for WorkspaceSandboxedBashTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params = normalize_shell_command_params(params);
        let permission = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;
        normalize_workspace_tool_permission_behavior(permission, self.auto_approve_warnings)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_shell_command_params(&params);

        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        let permission = self.check_permissions(&normalized_params, context).await;
        match permission.behavior {
            PermissionBehavior::Allow => {}
            PermissionBehavior::Deny => {
                let message = permission
                    .message
                    .unwrap_or_else(|| "命令被安全策略拒绝".to_string());
                return Err(ToolError::permission_denied(message));
            }
            PermissionBehavior::Ask => {
                let message = permission
                    .message
                    .unwrap_or_else(|| "命令需要人工确认".to_string());
                return Err(ToolError::permission_denied(message));
            }
        }

        let command = normalized_params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: command"))?;

        let background = normalized_params
            .get("background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if background {
            return Err(ToolError::invalid_params(
                "本地 sandbox 模式不支持 background=true",
            ));
        }

        let timeout_secs = normalized_params
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_BASH_TIMEOUT_SECS)
            .min(MAX_BASH_TIMEOUT_SECS);

        let sandbox_config = self.build_sandbox_config(context, timeout_secs);
        let (entry, args) = self.build_shell_command(command, context);

        let execution = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            execute_in_sandbox(&entry, &args, &sandbox_config),
        )
        .await
        .map_err(|_| ToolError::timeout(Duration::from_secs(timeout_secs)))?
        .map_err(|e| ToolError::execution_failed(format!("sandbox 执行失败: {e}")))?;

        let output = Self::format_output(&execution.stdout, &execution.stderr, execution.exit_code);
        if execution.exit_code == 0 {
            Ok(ToolResult::success(output)
                .with_metadata("exit_code", serde_json::json!(execution.exit_code))
                .with_metadata("stdout_length", serde_json::json!(execution.stdout.len()))
                .with_metadata("stderr_length", serde_json::json!(execution.stderr.len()))
                .with_metadata("sandboxed", serde_json::json!(execution.sandboxed))
                .with_metadata(
                    "sandbox_type",
                    serde_json::json!(format!("{:?}", execution.sandbox_type)),
                ))
        } else {
            Ok(ToolResult::error(output)
                .with_metadata("exit_code", serde_json::json!(execution.exit_code))
                .with_metadata("stdout_length", serde_json::json!(execution.stdout.len()))
                .with_metadata("stderr_length", serde_json::json!(execution.stderr.len()))
                .with_metadata("sandboxed", serde_json::json!(execution.sandboxed))
                .with_metadata(
                    "sandbox_type",
                    serde_json::json!(format!("{:?}", execution.sandbox_type)),
                ))
        }
    }
}

/// 统一处理 Task 工具的 Ask 权限，避免缺少回调导致流程中断
struct WorkspaceTaskTool {
    delegate: TaskTool,
    auto_approve_warnings: bool,
}

impl WorkspaceTaskTool {
    fn new(auto_approve_warnings: bool, task_manager: Arc<TaskManager>) -> Self {
        Self {
            delegate: TaskTool::with_manager(task_manager),
            auto_approve_warnings,
        }
    }
}

#[async_trait]
impl Tool for WorkspaceTaskTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params = normalize_shell_command_params(params);
        let permission = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;
        normalize_workspace_tool_permission_behavior(permission, self.auto_approve_warnings)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_shell_command_params(&params);
        self.delegate.execute(normalized_params, context).await
    }
}

#[derive(Debug, Clone)]
struct ProxycastBrowserMcpTool {
    tool_name: String,
    action_name: String,
    description: String,
    input_schema: serde_json::Value,
}

impl ProxycastBrowserMcpTool {
    fn new(
        tool_name: String,
        action_name: String,
        description: String,
        input_schema: serde_json::Value,
    ) -> Self {
        Self {
            tool_name,
            action_name,
            description,
            input_schema,
        }
    }

    fn parse_backend(params: &serde_json::Value) -> Option<BrowserBackendType> {
        let raw = params.get("backend")?.as_str()?.trim().to_ascii_lowercase();
        match raw.as_str() {
            "aster_compat" => Some(BrowserBackendType::AsterCompat),
            "proxycast_extension_bridge" => Some(BrowserBackendType::ProxycastExtensionBridge),
            "cdp_direct" => Some(BrowserBackendType::CdpDirect),
            _ => None,
        }
    }

    fn extract_profile_key(params: &serde_json::Value, context: &ToolContext) -> Option<String> {
        if let Some(value) = params.get("profile_key").and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        context
            .environment
            .get("PROXYCAST_BROWSER_PROFILE_KEY")
            .cloned()
    }
}

#[async_trait]
impl Tool for ProxycastBrowserMcpTool {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        self.input_schema.clone()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(90))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let backend = Self::parse_backend(&params);
        let profile_key = Self::extract_profile_key(&params, _context);
        let timeout_ms = params.get("timeout_ms").and_then(|v| v.as_u64());
        let request = BrowserActionRequest {
            profile_key,
            backend,
            action: self.action_name.clone(),
            args: params,
            timeout_ms,
        };

        let result = browser_execute_action_global(request)
            .await
            .map_err(|e| ToolError::execution_failed(format!("浏览器动作执行失败: {e}")))?;

        let payload = serde_json::to_string_pretty(&result)
            .unwrap_or_else(|_| format!("{{\"success\": {}}}", result.success));

        if result.success {
            Ok(ToolResult::success(payload)
                .with_metadata("action", serde_json::json!(self.action_name))
                .with_metadata("selected_backend", serde_json::json!(result.backend))
                .with_metadata("attempt_count", serde_json::json!(result.attempts.len())))
        } else {
            Ok(ToolResult::error(
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| "浏览器动作执行失败".to_string()),
            )
            .with_metadata("action", serde_json::json!(self.action_name))
            .with_metadata("selected_backend", serde_json::json!(result.backend))
            .with_metadata("attempts", serde_json::json!(result.attempts))
            .with_metadata("result", serde_json::json!(result)))
        }
    }
}

struct ToolSearchBridgeTool {
    registry: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
}

impl ToolSearchBridgeTool {
    fn new(registry: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>) -> Self {
        Self { registry }
    }

    fn with_input_examples_in_schema(
        schema: &serde_json::Value,
        input_examples: &[serde_json::Value],
    ) -> serde_json::Value {
        if input_examples.is_empty() {
            return schema.clone();
        }

        let mut enriched = schema.clone();
        let Some(root) = enriched.as_object_mut() else {
            return schema.clone();
        };
        let extension = root
            .entry("x-proxycast".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let Some(extension_obj) = extension.as_object_mut() else {
            return schema.clone();
        };
        if extension_obj.get("input_examples").is_none()
            && extension_obj.get("inputExamples").is_none()
        {
            extension_obj.insert(
                "input_examples".to_string(),
                serde_json::Value::Array(input_examples.to_vec()),
            );
        }
        enriched
    }

    fn parse_schema_metadata(
        tool_name: &str,
        schema: &serde_json::Value,
    ) -> (
        bool,                   // deferred_loading
        bool,                   // always_visible
        Vec<String>,            // allowed_callers
        Vec<String>,            // tags
        Vec<serde_json::Value>, // input_examples
    ) {
        let extension = schema
            .get("x-proxycast")
            .or_else(|| schema.get("x_proxycast"))
            .unwrap_or(schema);

        let deferred_loading = extension
            .get("deferred_loading")
            .or_else(|| extension.get("deferredLoading"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let always_visible = extension
            .get("always_visible")
            .or_else(|| extension.get("alwaysVisible"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let allowed_callers = extension
            .get("allowed_callers")
            .or_else(|| extension.get("allowedCallers"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|v| v.trim().to_ascii_lowercase())
                    .filter(|v| !v.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let tags = extension
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|v| v.trim().to_ascii_lowercase())
                    .filter(|v| !v.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let input_examples =
            proxycast_core::tool_calling::resolve_tool_input_examples(tool_name, schema);

        (
            deferred_loading,
            always_visible,
            allowed_callers,
            tags,
            input_examples,
        )
    }

    fn score_match(name: &str, description: &str, tags: &[String], query: &str) -> i32 {
        if query.is_empty() {
            return 1;
        }
        let name_lc = name.to_ascii_lowercase();
        let description_lc = description.to_ascii_lowercase();

        let mut score = 0;
        if name_lc == query {
            score += 120;
        } else if name_lc.starts_with(query) {
            score += 90;
        } else if name_lc.contains(query) {
            score += 70;
        }
        if description_lc.contains(query) {
            score += 40;
        }
        for tag in tags {
            if tag == query {
                score += 35;
            } else if tag.contains(query) {
                score += 20;
            }
        }
        score
    }
}

#[async_trait]
impl Tool for ToolSearchBridgeTool {
    fn name(&self) -> &str {
        "tool_search"
    }

    fn description(&self) -> &str {
        "搜索当前会话可用工具；默认会过滤 deferred_loading 工具，并按调用方做 allowed_callers 约束。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "工具名称/描述关键词" },
                "caller": { "type": "string", "description": "调用方，例如 assistant/code_execution" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                "include_deferred": { "type": "boolean", "description": "是否包含延迟加载工具" },
                "include_schema": { "type": "boolean", "description": "是否返回完整输入 schema" }
            },
            "required": []
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(15))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let query = params
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let caller = params
            .get("caller")
            .and_then(|v| v.as_str())
            .unwrap_or("assistant")
            .trim()
            .to_ascii_lowercase();
        let include_deferred = params
            .get("include_deferred")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let include_schema = params
            .get("include_schema")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let limit = params
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v.clamp(1, 100) as usize)
            .unwrap_or(10);

        let registry = self.registry.read().await;
        let definitions = registry.get_definitions();

        let mut scored = definitions
            .into_iter()
            .filter(|d| d.name != self.name())
            .filter_map(|definition| {
                let (deferred_loading, always_visible, allowed_callers, tags, input_examples) =
                    Self::parse_schema_metadata(&definition.name, &definition.input_schema);
                if deferred_loading && !always_visible && !include_deferred {
                    return None;
                }
                if !allowed_callers.is_empty() && !allowed_callers.contains(&caller) {
                    return None;
                }

                let score =
                    Self::score_match(&definition.name, &definition.description, &tags, &query);
                if score <= 0 {
                    return None;
                }

                let item = if include_schema {
                    let enriched_schema = Self::with_input_examples_in_schema(
                        &definition.input_schema,
                        &input_examples,
                    );
                    serde_json::json!({
                        "name": definition.name,
                        "description": definition.description,
                        "input_schema": enriched_schema,
                        "deferred_loading": deferred_loading,
                        "always_visible": always_visible,
                        "allowed_callers": allowed_callers,
                        "input_examples": input_examples,
                        "tags": tags
                    })
                } else {
                    serde_json::json!({
                        "name": definition.name,
                        "description": definition.description,
                        "deferred_loading": deferred_loading,
                        "always_visible": always_visible,
                        "allowed_callers": allowed_callers,
                        "input_examples": input_examples,
                        "tags": tags
                    })
                };
                Some((score, item))
            })
            .collect::<Vec<_>>();

        scored.sort_by(|(a_score, a_item), (b_score, b_item)| {
            b_score.cmp(a_score).then_with(|| {
                a_item["name"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(b_item["name"].as_str().unwrap_or_default())
            })
        });

        let result = scored
            .into_iter()
            .take(limit)
            .map(|(_, item)| item)
            .collect::<Vec<_>>();
        let text = serde_json::to_string_pretty(&serde_json::json!({
            "query": query,
            "caller": caller,
            "count": result.len(),
            "tools": result
        }))
        .map_err(|e| ToolError::execution_failed(format!("tool_search 序列化失败: {e}")))?;

        Ok(ToolResult::success(text))
    }
}

fn browser_mcp_tool_names() -> Vec<String> {
    let mut names = Vec::new();
    for tool in get_chrome_mcp_tools() {
        names.push(format!("mcp__proxycast-browser__{}", tool.name));
    }
    names
}

fn register_browser_mcp_tools_to_registry(registry: &mut aster::tools::ToolRegistry) {
    let tool_defs = get_chrome_mcp_tools();
    for tool_def in tool_defs {
        for prefix in ["mcp__proxycast-browser__"] {
            let full_name = format!("{prefix}{}", tool_def.name);
            if registry.contains(&full_name) {
                continue;
            }
            let tool = ProxycastBrowserMcpTool::new(
                full_name,
                tool_def.name.clone(),
                tool_def.description.clone(),
                tool_def.input_schema.clone(),
            );
            registry.register(Box::new(tool));
        }
    }
}

fn register_tool_search_tool_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    registry_arc: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
) {
    if registry.contains("tool_search") {
        return;
    }
    registry.register(Box::new(ToolSearchBridgeTool::new(registry_arc)));
}

pub async fn ensure_browser_mcp_tools_registered(state: &AsterAgentState) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    register_browser_mcp_tools_to_registry(&mut registry);
    register_tool_search_tool_to_registry(&mut registry, registry_arc.clone());
    Ok(())
}

pub async fn ensure_tool_search_tool_registered(state: &AsterAgentState) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    register_tool_search_tool_to_registry(&mut registry, registry_arc.clone());
    Ok(())
}

fn build_workspace_shell_allow_pattern(
    escaped_root: &str,
    allow_extended_shell_commands: bool,
) -> String {
    if allow_extended_shell_commands {
        // Auto 模式放宽命令白名单，交由本地 sandbox 与 BashTool 安全检查兜底。
        // 这里使用 DOTALL 支持 heredoc 等多行命令（例如 python <<'EOF' ...）。
        return String::from(r"(?s)^\s*\S.*$");
    }

    format!(
        r"^\s*(?:cd\s+({escaped_root}|\.|\./|\.\./)|pwd|ls(?:\s+[^;&|]+)?|find\s+({escaped_root}|\.|\./|\.\./)[^;&|]*|rg\b[^;&|]*|grep\b[^;&|]*|cat\s+({escaped_root}|\.|\./|\.\./)[^;&|]*)\s*$"
    )
}

/// 为指定工作区生成本地 sandbox 权限模板
async fn apply_workspace_sandbox_permissions(
    state: &AsterAgentState,
    config_manager: &GlobalConfigManagerState,
    heartbeat_state: &HeartbeatServiceState,
    app_handle: &AppHandle,
    workspace_root: &str,
    execution_strategy: AsterExecutionStrategy,
) -> Result<WorkspaceSandboxApplyOutcome, String> {
    let workspace_root = workspace_root.trim();
    if workspace_root.is_empty() {
        return Err("workspace 根目录为空".to_string());
    }

    let sandbox_policy = resolve_workspace_sandbox_policy(config_manager);
    let auto_mode = execution_strategy == AsterExecutionStrategy::Auto;
    let mut sandboxed_bash_tool: Option<WorkspaceSandboxedBashTool> = None;
    let apply_outcome = if !sandbox_policy.enabled {
        WorkspaceSandboxApplyOutcome::DisabledByConfig
    } else {
        match WorkspaceSandboxedBashTool::new(workspace_root, auto_mode) {
            Ok(tool) => {
                let sandbox_type = tool.sandbox_type().to_string();
                sandboxed_bash_tool = Some(tool);
                WorkspaceSandboxApplyOutcome::Applied { sandbox_type }
            }
            Err(reason) => {
                if sandbox_policy.strict {
                    return Err(format!(
                        "workspace 本地 sandbox 严格模式已启用，初始化失败: {reason}"
                    ));
                }
                WorkspaceSandboxApplyOutcome::UnavailableFallback {
                    warning_message: build_workspace_sandbox_warning_message(&reason),
                    notify_user: sandbox_policy.notify_on_fallback,
                }
            }
        }
    };

    let escaped_root = regex::escape(workspace_root);
    let workspace_path_pattern = format!(r"^({escaped_root}|\.|\./|\.\./).*$");
    let workspace_abs_path_pattern = format!(r"^({escaped_root}).*$");
    let analyze_image_path_pattern = format!(
        r"^(base64:[A-Za-z0-9+/=]+|file://({escaped_root}).*|({escaped_root}|\.|\./|\.\./).*)$"
    );
    let safe_https_url_pattern = String::from(r"^https://[^\s]+$");
    let mut permissions = vec![
        ToolPermission {
            tool: "read".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: true,
                    description: Some("read.path 必须在 workspace 内或相对路径".to_string()),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许读取任意路径".to_string()
            } else {
                "仅允许读取当前 workspace 内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "write".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: true,
                    description: Some("write.path 必须在 workspace 内或相对路径".to_string()),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许写入任意路径".to_string()
            } else {
                "仅允许写入当前 workspace 内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "edit".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: true,
                    description: Some("edit.path 必须在 workspace 内或相对路径".to_string()),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许编辑任意路径".to_string()
            } else {
                "仅允许编辑当前 workspace 内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "glob".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("glob.path 必须在 workspace 内或相对路径".to_string()),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许任意路径搜索文件".to_string()
            } else {
                "仅允许在当前 workspace 搜索文件".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "grep".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("grep.path 必须在 workspace 内或相对路径".to_string()),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许任意路径搜索内容".to_string()
            } else {
                "仅允许在当前 workspace 搜索内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
    ];

    let allow_shell_pattern = build_workspace_shell_allow_pattern(&escaped_root, auto_mode);
    let shell_permission_description = if auto_mode {
        "Auto 模式：允许任意 bash.command"
    } else {
        "bash.command 仅允许 workspace 内安全读操作"
    };
    let shell_permission_reason = if auto_mode {
        "workspace 安全策略：Auto 模式允许任意命令（由本地 sandbox 兜底）"
    } else {
        "workspace 安全策略：bash 仅允许 workspace 内安全命令"
    };

    permissions.push(ToolPermission {
        tool: "bash".to_string(),
        allowed: true,
        priority: 90,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![
                ParameterRestriction {
                    parameter: "command".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(shell_permission_description.to_string()),
                },
                ParameterRestriction {
                    parameter: "cmd".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("bash.cmd 兼容参数名，规则与 command 一致".to_string()),
                },
            ]
        },
        scope: PermissionScope::Session,
        reason: Some(shell_permission_reason.to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    let task_permission_description = if auto_mode {
        "Auto 模式：允许任意 Task.command"
    } else {
        "Task.command 仅允许 workspace 内安全命令"
    };
    let task_permission_reason = if auto_mode {
        "workspace 安全策略：Auto 模式允许 Task 执行任意命令"
    } else {
        "workspace 安全策略：Task 仅允许 workspace 内安全命令"
    };

    permissions.push(ToolPermission {
        tool: "Task".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![
                ParameterRestriction {
                    parameter: "command".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(task_permission_description.to_string()),
                },
                ParameterRestriction {
                    parameter: "cmd".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("Task.cmd 兼容参数名，规则与 command 一致".to_string()),
                },
            ]
        },
        scope: PermissionScope::Session,
        reason: Some(task_permission_reason.to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "lsp".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "path".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(workspace_path_pattern.clone()),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some("lsp.path 必须在 workspace 内或相对路径".to_string()),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许任意 LSP 路径".to_string()
        } else {
            "允许在 workspace 内使用 LSP".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "NotebookEdit".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "notebook_path".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(workspace_abs_path_pattern.clone()),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some(
                    "NotebookEdit.notebook_path 必须是 workspace 内绝对路径".to_string(),
                ),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许编辑任意 Notebook 路径".to_string()
        } else {
            "允许编辑 workspace 内 Notebook".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "analyze_image".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "file_path".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(analyze_image_path_pattern),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some(
                    "analyze_image.file_path 仅允许 base64、workspace 内绝对路径或相对路径"
                        .to_string(),
                ),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许分析任意图片路径或 base64".to_string()
        } else {
            "允许分析 workspace 内图片或 base64 数据".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "WebFetch".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "url".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(safe_https_url_pattern),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some("WebFetch.url 仅允许 https 且禁止内网/本机地址".to_string()),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许任意 WebFetch URL".to_string()
        } else {
            "允许安全的 WebFetch 请求".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    if auto_mode {
        permissions.push(ToolPermission {
            tool: "*".to_string(),
            allowed: true,
            priority: 1000,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some("Auto 模式：允许所有工具与参数".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for tool_name in [
        "Skill",
        "TaskOutput",
        "KillShell",
        "TodoWrite",
        "EnterPlanMode",
        "ExitPlanMode",
        "WebSearch",
        "ask",
        "tool_search",
        "three_stage_workflow",
        "heartbeat",
    ] {
        permissions.push(ToolPermission {
            tool: tool_name.to_string(),
            allowed: true,
            priority: 88,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(format!("允许默认工具: {tool_name}")),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for tool_name in browser_mcp_tool_names() {
        permissions.push(ToolPermission {
            tool: tool_name,
            allowed: true,
            priority: 88,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some("允许浏览器 MCP 兼容工具".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    permissions.push(ToolPermission {
        tool: "*".to_string(),
        allowed: false,
        priority: 10,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        scope: PermissionScope::Session,
        reason: Some("workspace 安全策略：未显式授权的工具默认拒绝".to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    let mut permission_manager = ToolPermissionManager::new(None);
    if let Some(existing_manager) = registry.permission_manager() {
        for permission in existing_manager.get_permissions(None) {
            let scope = permission.scope;
            permission_manager.add_permission(permission, scope);
        }
    }

    for permission in permissions {
        permission_manager.add_permission(permission, PermissionScope::Session);
    }
    registry.set_permission_manager(Arc::new(permission_manager));

    let task_manager = shared_task_manager();
    registry.register(Box::new(WorkspaceTaskTool::new(
        auto_mode,
        task_manager.clone(),
    )));
    registry.register(Box::new(TaskOutputTool::with_manager(task_manager.clone())));
    registry.register(Box::new(KillShellTool::with_task_manager(task_manager)));

    if let Some(workspace_bash_tool) = sandboxed_bash_tool {
        registry.register(Box::new(workspace_bash_tool));
    }

    // 注册心跳工具
    let heartbeat_adapter =
        HeartbeatServiceAdapter::new(heartbeat_state.clone(), app_handle.clone());
    let heartbeat_tool = proxycast_agent::tools::HeartbeatTool::new(Arc::new(heartbeat_adapter));
    registry.register(Box::new(heartbeat_tool));

    // 注册浏览器 MCP 工具
    register_browser_mcp_tools_to_registry(&mut registry);

    Ok(apply_outcome)
}

/// 图片输入
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ImageInput {
    pub data: String,
    pub media_type: String,
}

/// 发送消息并获取流式响应
#[tauri::command]
pub async fn aster_agent_chat_stream(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    heartbeat_state: State<'_, HeartbeatServiceState>,
    request: AsterChatRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 发送流式消息: session={}, event={}",
        request.session_id,
        request.event_name
    );

    // 确保 Agent 已初始化（使用带数据库的版本，注入 SessionStore）
    let is_init = state.is_initialized().await;
    tracing::warn!("[AsterAgent] Agent 初始化状态: {}", is_init);
    if !is_init {
        tracing::warn!("[AsterAgent] Agent 未初始化，开始初始化...");
        state.init_agent_with_db(&db).await?;
        tracing::warn!("[AsterAgent] Agent 初始化完成");
    } else {
        tracing::warn!("[AsterAgent] Agent 已初始化，检查 session_store...");
        // 检查 session_store 是否存在
        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        if let Some(agent) = guard.as_ref() {
            let has_store = agent.session_store().is_some();
            tracing::warn!("[AsterAgent] session_store 存在: {}", has_store);
        }
    }

    // 直接使用前端传递的 session_id
    // ProxyCastSessionStore 会在 add_message 时自动创建不存在的 session
    // 同时 get_session 也会自动创建不存在的 session
    let session_id = &request.session_id;

    let workspace_id = request.workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        let message = "workspace_id 必填，请先选择项目工作区".to_string();
        logs.write()
            .await
            .add("error", &format!("[AsterAgent] {}", message));
        return Err(message);
    }

    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = match manager.get(&workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            let message = format!("Workspace 不存在: {workspace_id}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
        Err(error) => {
            let message = format!("读取 workspace 失败: {error}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let ensured = match ensure_workspace_ready_with_auto_relocate(&manager, &workspace) {
        Ok(result) => result,
        Err(message) => {
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let workspace_root = ensured.root_path.to_string_lossy().to_string();
    let runtime_config = config_manager.config();
    apply_web_search_runtime_env(&runtime_config);

    if ensured.repaired {
        let warning_message = ensured.warning.unwrap_or_else(|| {
            format!(
                "检测到工作区目录缺失，已自动创建并继续执行: {}",
                workspace_root
            )
        });
        logs.write()
            .await
            .add("warn", &format!("[AsterAgent] {}", warning_message));
        let warning_event = TauriAgentEvent::Warning {
            code: Some(WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE.to_string()),
            message: warning_message,
        };
        if let Err(error) = app.emit(&request.event_name, &warning_event) {
            tracing::error!("[AsterAgent] 发送工作区自动恢复提醒失败: {}", error);
        }
    }

    {
        let db_conn = db.lock().map_err(|e| format!("获取数据库连接失败: {e}"))?;
        if let Some(session) = AgentDao::get_session(&db_conn, session_id)
            .map_err(|e| format!("读取 session 失败: {e}"))?
        {
            let session_dir = session.working_dir.unwrap_or_default();
            if !session_dir.is_empty() && session_dir != workspace_root {
                tracing::info!(
                    "[AsterAgent] workspace 变更，自动更新 session working_dir: {} -> {}",
                    session_dir,
                    workspace_root
                );
                db_conn
                    .execute(
                        "UPDATE agent_sessions SET working_dir = ?1 WHERE id = ?2",
                        rusqlite::params![&workspace_root, session_id],
                    )
                    .map_err(|e| format!("更新 session working_dir 失败: {e}"))?;
            }
        }
    }

    // 启动并注入 MCP extensions 到 Aster Agent
    let (_start_ok, start_fail) = ensure_proxycast_mcp_servers_running(&db, &mcp_manager).await;
    if start_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP server 自动启动失败 ({} 失败)，后续可用工具可能不完整",
            start_fail
        );
    }

    let (_mcp_ok, mcp_fail) = inject_mcp_extensions(&state, &mcp_manager).await;
    if mcp_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP extension 注入失败 ({} 失败)，Agent 可能无法使用某些 MCP 工具",
            mcp_fail
        );
    }

    // 构建 system_prompt：优先使用项目上下文，其次使用 session 的 system_prompt
    // 同时读取会话已持久化的 execution_strategy
    let (system_prompt, persisted_strategy) = {
        let db_conn = db.lock().map_err(|e| format!("获取数据库连接失败: {e}"))?;
        let session = AgentDao::get_session(&db_conn, session_id)
            .map_err(|e| format!("读取 session 失败: {e}"))?;
        let persisted = session
            .as_ref()
            .map(|s| AsterExecutionStrategy::from_db_value(s.execution_strategy.as_deref()))
            .unwrap_or_default();

        // 1. 如果提供了 project_id，构建项目上下文
        let project_prompt = if let Some(ref project_id) = request.project_id {
            match AsterAgentState::build_project_system_prompt(&db, project_id) {
                Ok(prompt) => {
                    tracing::info!(
                        "[AsterAgent] 已加载项目上下文: project_id={}, prompt_len={}",
                        project_id,
                        prompt.len()
                    );
                    Some(prompt)
                }
                Err(e) => {
                    tracing::warn!(
                        "[AsterAgent] 加载项目上下文失败: {}, 继续使用 session prompt",
                        e
                    );
                    None
                }
            }
        } else {
            None
        };

        // 2. 如果没有项目上下文，尝试从 session 读取
        let resolved_prompt = if project_prompt.is_some() {
            project_prompt
        } else {
            match session {
                Some(session) => {
                    tracing::debug!(
                        "[AsterAgent] 找到 session，system_prompt: {:?}",
                        session.system_prompt.as_ref().map(|s| s.len())
                    );
                    session.system_prompt
                }
                None => {
                    tracing::debug!(
                        "[AsterAgent] ProxyCast 数据库中未找到 session: {}",
                        session_id
                    );
                    None
                }
            }
        };

        let merged_prompt = merge_system_prompt_with_web_search(
            merge_system_prompt_with_memory_profile(resolved_prompt, &runtime_config),
            &runtime_config,
        );

        (merged_prompt, persisted)
    };

    let requested_strategy = request.execution_strategy.unwrap_or(persisted_strategy);
    let effective_strategy = requested_strategy.effective_for_message(&request.message);

    if let Some(explicit_strategy) = request.execution_strategy {
        let db_conn = db.lock().map_err(|e| format!("获取数据库连接失败: {e}"))?;
        if AgentDao::session_exists(&db_conn, session_id).unwrap_or(false) {
            if let Err(e) = AgentDao::update_execution_strategy(
                &db_conn,
                session_id,
                explicit_strategy.as_db_value(),
            ) {
                tracing::warn!(
                    "[AsterAgent] 更新会话执行策略失败: session={}, strategy={}, error={}",
                    session_id,
                    explicit_strategy.as_db_value(),
                    e
                );
            }
        }
    }

    tracing::info!(
        "[AsterAgent] 执行策略: requested={:?}, effective={:?}",
        requested_strategy,
        effective_strategy
    );

    // 如果提供了 Provider 配置，则配置 Provider
    if let Some(provider_config) = &request.provider_config {
        tracing::info!(
            "[AsterAgent] 收到 provider_config: provider_name={}, model_name={}, has_api_key={}, base_url={:?}",
            provider_config.provider_name,
            provider_config.model_name,
            provider_config.api_key.is_some(),
            provider_config.base_url
        );
        let config = ProviderConfig {
            provider_name: provider_config.provider_name.clone(),
            model_name: provider_config.model_name.clone(),
            api_key: provider_config.api_key.clone(),
            base_url: provider_config.base_url.clone(),
            credential_uuid: None,
        };
        // 如果前端提供了 api_key，直接使用；否则从凭证池选择凭证
        if provider_config.api_key.is_some() {
            state.configure_provider(config, session_id, &db).await?;
        } else {
            // 没有 api_key，使用凭证池（provider_name 作为 provider_type）
            state
                .configure_provider_from_pool(
                    &db,
                    &provider_config.provider_name,
                    &provider_config.model_name,
                    session_id,
                )
                .await?;
        }
    }

    // 检查 Provider 是否已配置
    if !state.is_provider_configured().await {
        return Err("Provider 未配置，请先调用 aster_agent_configure_provider".to_string());
    }

    let sandbox_outcome = apply_workspace_sandbox_permissions(
        &state,
        config_manager.inner(),
        heartbeat_state.inner(),
        &app,
        &workspace_root,
        requested_strategy,
    )
    .await
    .map_err(|e| format!("注入 workspace 安全策略失败: {e}"))?;

    match sandbox_outcome {
        WorkspaceSandboxApplyOutcome::Applied { sandbox_type } => {
            tracing::info!(
                "[AsterAgent] 已启用 workspace 本地 sandbox: root={}, type={}",
                workspace_root,
                sandbox_type
            );
        }
        WorkspaceSandboxApplyOutcome::DisabledByConfig => {
            tracing::info!(
                "[AsterAgent] workspace 本地 sandbox 已关闭，继续使用普通执行模式: root={}",
                workspace_root
            );
        }
        WorkspaceSandboxApplyOutcome::UnavailableFallback {
            warning_message,
            notify_user,
        } => {
            tracing::warn!(
                "[AsterAgent] workspace 本地 sandbox 不可用，已降级为普通执行: root={}, warning={}",
                workspace_root,
                warning_message
            );
            if notify_user {
                let warning_event = TauriAgentEvent::Warning {
                    code: Some(WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE.to_string()),
                    message: warning_message,
                };
                if let Err(e) = app.emit(&request.event_name, &warning_event) {
                    tracing::error!("[AsterAgent] 发送 sandbox 降级提醒失败: {}", e);
                }
            }
        }
    }

    let tracker = ExecutionTracker::new(db.inner().clone());
    let cancel_token = state.create_cancel_token(session_id).await;

    // 获取 Agent Arc 并保持 guard 在整个流处理期间存活
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;

    let include_context_trace = runtime_config.memory.enabled;

    let build_session_config = || {
        let mut session_config_builder = SessionConfigBuilder::new(session_id);
        if let Some(prompt) = system_prompt.clone() {
            session_config_builder = session_config_builder.system_prompt(prompt);
        }
        session_config_builder =
            session_config_builder.include_context_trace(include_context_trace);
        session_config_builder.build()
    };

    let final_result = tracker
        .with_run(
            RunSource::Chat,
            Some("aster_agent_chat_stream".to_string()),
            Some(session_id.to_string()),
            Some(serde_json::json!({
                "workspace_id": workspace_id.clone(),
                "project_id": request.project_id.clone(),
                "event_name": request.event_name.clone(),
                "execution_strategy": format!("{:?}", effective_strategy).to_lowercase(),
                "message_length": request.message.chars().count(),
            })),
            RunFinalizeOptions {
                success_metadata: Some(serde_json::json!({
                    "execution_strategy": format!("{:?}", effective_strategy).to_lowercase(),
                    "workspace_id": workspace_id.clone(),
                })),
                error_code: Some("chat_stream_failed".to_string()),
                error_metadata: Some(serde_json::json!({
                    "execution_strategy": format!("{:?}", effective_strategy).to_lowercase(),
                    "workspace_id": workspace_id.clone(),
                })),
            },
            async {
                let mut added_code_execution = false;
                if effective_strategy == AsterExecutionStrategy::CodeOrchestrated {
                    added_code_execution = ensure_code_execution_extension_enabled(agent).await?;
                }

                let primary_result = stream_reply_once(
                    agent,
                    &app,
                    &request.event_name,
                    &request.message,
                    build_session_config(),
                    cancel_token.clone(),
                )
                .await;

                let run_result: Result<(), String> = match primary_result {
                    Ok(()) => Ok(()),
                    Err(primary_error)
                        if effective_strategy == AsterExecutionStrategy::CodeOrchestrated
                            && should_fallback_to_react_from_code_orchestrated(&primary_error) =>
                    {
                        tracing::warn!(
                            "[AsterAgent] 编排模式执行失败，自动降级到 ReAct: {}",
                            primary_error.message
                        );
                        if added_code_execution {
                            if let Err(e) =
                                agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await
                            {
                                tracing::warn!(
                                    "[AsterAgent] 降级前移除 code_execution 扩展失败: {}",
                                    e
                                );
                            }
                            added_code_execution = false;
                        }
                        stream_reply_once(
                            agent,
                            &app,
                            &request.event_name,
                            &request.message,
                            build_session_config(),
                            cancel_token.clone(),
                        )
                        .await
                        .map_err(|fallback_err| fallback_err.message)
                    }
                    Err(primary_error) => Err(primary_error.message),
                };

                if added_code_execution {
                    if let Err(e) = agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await {
                        tracing::warn!(
                            "[AsterAgent] 移除 code_execution 扩展失败，后续会话可能继续保留编排模式: {}",
                            e
                        );
                    }
                }

                run_result
            },
        )
        .await;

    match final_result {
        Ok(()) => {
            let done_event = TauriAgentEvent::FinalDone { usage: None };
            if let Err(e) = app.emit(&request.event_name, &done_event) {
                tracing::error!("[AsterAgent] 发送完成事件失败: {}", e);
            }
        }
        Err(e) => {
            let error_event = TauriAgentEvent::Error { message: e.clone() };
            if let Err(emit_err) = app.emit(&request.event_name, &error_event) {
                tracing::error!("[AsterAgent] 发送错误事件失败: {}", emit_err);
            }
            state.remove_cancel_token(session_id).await;
            return Err(e);
        }
    }

    // 清理取消令牌
    state.remove_cancel_token(session_id).await;

    Ok(())
}

/// 停止当前会话
#[tauri::command]
pub async fn aster_agent_stop(
    state: State<'_, AsterAgentState>,
    session_id: String,
) -> Result<bool, String> {
    tracing::info!("[AsterAgent] 停止会话: {}", session_id);
    Ok(state.cancel_session(&session_id).await)
}

/// 创建新会话
#[tauri::command]
pub async fn aster_session_create(
    db: State<'_, DbConnection>,
    working_dir: Option<String>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
) -> Result<String, String> {
    tracing::info!("[AsterAgent] 创建会话: name={:?}", name);

    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager
        .get(&workspace_id)
        .map_err(|e| format!("读取 workspace 失败: {e}"))?
        .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
    let workspace_root = ensured.root_path.to_string_lossy().to_string();

    if ensured.repaired {
        tracing::warn!(
            "[AsterAgent] 会话创建阶段检测到 workspace 目录异常并已修复: {}{}",
            workspace_root,
            if ensured.relocated {
                "（已迁移）"
            } else {
                ""
            }
        );
    }

    let resolved_working_dir = working_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| Some(workspace_root.clone()));

    AsterAgentWrapper::create_session_sync(
        &db,
        name,
        resolved_working_dir,
        workspace_id,
        Some(
            execution_strategy
                .unwrap_or(AsterExecutionStrategy::React)
                .as_db_value()
                .to_string(),
        ),
    )
}

/// 设置会话执行策略
#[tauri::command]
pub async fn aster_session_set_execution_strategy(
    db: State<'_, DbConnection>,
    session_id: String,
    execution_strategy: AsterExecutionStrategy,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    AgentDao::update_execution_strategy(&conn, &session_id, execution_strategy.as_db_value())
        .map_err(|e| format!("更新会话执行策略失败: {e}"))?;
    Ok(())
}

/// 列出所有会话
#[tauri::command]
pub async fn aster_session_list(db: State<'_, DbConnection>) -> Result<Vec<SessionInfo>, String> {
    tracing::info!("[AsterAgent] 列出会话");
    AsterAgentWrapper::list_sessions_sync(&db)
}

/// 获取会话详情
#[tauri::command]
pub async fn aster_session_get(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<SessionDetail, String> {
    tracing::info!("[AsterAgent] 获取会话: {}", session_id);
    AsterAgentWrapper::get_session_sync(&db, &session_id)
}

/// 重命名会话
#[tauri::command]
pub async fn aster_session_rename(
    db: State<'_, DbConnection>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    tracing::info!("[AsterAgent] 重命名会话: {}", session_id);
    AsterAgentWrapper::rename_session_sync(&db, &session_id, &name)
}

/// 删除会话
#[tauri::command]
pub async fn aster_session_delete(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<(), String> {
    tracing::info!("[AsterAgent] 删除会话: {}", session_id);
    AsterAgentWrapper::delete_session_sync(&db, &session_id)
}

/// 确认权限请求
#[derive(Debug, Deserialize)]
pub struct ConfirmRequest {
    pub request_id: String,
    pub confirmed: bool,
    #[allow(dead_code)]
    pub response: Option<String>,
}

/// 确认权限请求（用于工具调用确认等）
#[tauri::command]
pub async fn aster_agent_confirm(
    state: State<'_, AsterAgentState>,
    request: ConfirmRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 确认请求: id={}, confirmed={}",
        request.request_id,
        request.confirmed
    );

    let permission = if request.confirmed {
        Permission::AllowOnce
    } else {
        Permission::DenyOnce
    };

    let confirmation = PermissionConfirmation {
        principal_type: PrincipalType::Tool,
        permission,
    };

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;
    agent
        .handle_confirmation(request.request_id.clone(), confirmation)
        .await;

    Ok(())
}

/// Elicitation 回填请求
#[derive(Debug, Deserialize)]
pub struct SubmitElicitationResponseRequest {
    pub request_id: String,
    pub user_data: serde_json::Value,
}

fn validate_elicitation_submission(session_id: &str, request_id: &str) -> Result<String, String> {
    let trimmed_session_id = session_id.trim().to_string();
    if trimmed_session_id.is_empty() {
        return Err("session_id 不能为空".to_string());
    }
    if request_id.trim().is_empty() {
        return Err("request_id 不能为空".to_string());
    }
    Ok(trimmed_session_id)
}

/// 提交 elicitation 回答（用于 ask/lsp 等需要用户输入的流程）
#[tauri::command]
pub async fn aster_agent_submit_elicitation_response(
    state: State<'_, AsterAgentState>,
    session_id: String,
    request: SubmitElicitationResponseRequest,
) -> Result<(), String> {
    let session_id = validate_elicitation_submission(&session_id, &request.request_id)?;

    tracing::info!(
        "[AsterAgent] 提交 elicitation 响应: session={}, request_id={}",
        session_id,
        request.request_id
    );

    let message =
        Message::user().with_content(MessageContent::action_required_elicitation_response(
            request.request_id.clone(),
            request.user_data,
        ));

    let session_config = SessionConfigBuilder::new(&session_id)
        .include_context_trace(true)
        .build();

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;

    let mut stream = agent
        .reply(message, session_config, None)
        .await
        .map_err(|e| format!("提交 elicitation 响应失败: {e}"))?;

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(AgentEvent::Message(message)) => {
                let text = message.as_concat_text();
                if text.contains("Failed to submit elicitation response")
                    || text.contains("Request not found")
                {
                    return Err(format!("提交 elicitation 响应失败: {text}"));
                }
            }
            Ok(_) => {}
            Err(e) => {
                return Err(format!("提交 elicitation 响应失败: {e}"));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use regex::Regex;
    use std::path::PathBuf;

    struct DummyTool {
        name: String,
        description: String,
        schema: serde_json::Value,
    }

    impl DummyTool {
        fn new(name: &str, description: &str, schema: serde_json::Value) -> Self {
            Self {
                name: name.to_string(),
                description: description.to_string(),
                schema,
            }
        }
    }

    #[async_trait]
    impl Tool for DummyTool {
        fn name(&self) -> &str {
            &self.name
        }

        fn description(&self) -> &str {
            &self.description
        }

        fn input_schema(&self) -> serde_json::Value {
            self.schema.clone()
        }

        async fn execute(
            &self,
            _params: serde_json::Value,
            _context: &ToolContext,
        ) -> Result<ToolResult, ToolError> {
            Ok(ToolResult::success("ok"))
        }
    }

    #[test]
    fn test_aster_chat_request_deserialize() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test"
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.message, "Hello");
        assert_eq!(request.session_id, "test-session");
        assert_eq!(request.event_name, "agent_stream");
        assert_eq!(request.workspace_id, "workspace-test");
        assert_eq!(request.execution_strategy, None);
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_execution_strategy() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "execution_strategy": "code_orchestrated"
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.execution_strategy,
            Some(AsterExecutionStrategy::CodeOrchestrated)
        );
    }

    #[test]
    fn test_aster_execution_strategy_default_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::default(),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_from_db_value_none_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::from_db_value(None),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_from_db_value_unknown_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::from_db_value(Some("unknown")),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_auto_prefers_react_when_tool_search_explicit() {
        let strategy =
            AsterExecutionStrategy::Auto.effective_for_message("请先调用 tool_search 再继续");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_auto_prefers_react_for_generic_web_search() {
        let strategy =
            AsterExecutionStrategy::Auto.effective_for_message("帮我联网搜索今天的 AI 新闻");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_auto_defaults_react_for_code_task() {
        let strategy = AsterExecutionStrategy::Auto
            .effective_for_message("请抓取这个仓库并修复 Rust 编译错误，然后给出补丁");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_code_orchestrated_still_prefers_react_for_web_search() {
        let strategy = AsterExecutionStrategy::CodeOrchestrated
            .effective_for_message("请联网搜索今天的 AI 新闻并给出来源");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_code_orchestrated_forces_react_for_websearch_instruction() {
        let strategy = AsterExecutionStrategy::CodeOrchestrated
            .effective_for_message("请必须使用 WebSearch 工具检索，不要用已有知识回答");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_should_fallback_to_react_from_code_orchestrated_when_no_event_emitted() {
        let error = ReplyAttemptError {
            message: "Stream error: timeout".to_string(),
            emitted_any: false,
        };
        assert!(should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_should_fallback_to_react_from_code_orchestrated_when_unknown_subscript() {
        let error = ReplyAttemptError {
            message: "Agent provider execution failed: Unknown subscript 'web_scraping'"
                .to_string(),
            emitted_any: true,
        };
        assert!(should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_should_not_fallback_to_react_from_code_orchestrated_for_general_error() {
        let error = ReplyAttemptError {
            message: "Agent provider execution failed: quota exceeded".to_string(),
            emitted_any: true,
        };
        assert!(!should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_validate_elicitation_submission_rejects_empty_session_id() {
        let result = validate_elicitation_submission("   ", "req-1");
        assert_eq!(result, Err("session_id 不能为空".to_string()));
    }

    #[test]
    fn test_validate_elicitation_submission_rejects_empty_request_id() {
        let result = validate_elicitation_submission("session-1", "   ");
        assert_eq!(result, Err("request_id 不能为空".to_string()));
    }

    #[test]
    fn test_validate_elicitation_submission_trims_session_id() {
        let result = validate_elicitation_submission("  session-1  ", "req-1");
        assert_eq!(result, Ok("session-1".to_string()));
    }

    #[test]
    fn test_normalize_workspace_tool_permission_behavior_auto_mode_allows_warning() {
        let permission = PermissionCheckResult::ask("需要确认");
        let normalized = normalize_workspace_tool_permission_behavior(permission, true);
        assert_eq!(normalized.behavior, PermissionBehavior::Allow);
        assert!(normalized.message.is_none());
    }

    #[test]
    fn test_normalize_workspace_tool_permission_behavior_non_auto_denies_warning() {
        let permission = PermissionCheckResult::ask("需要确认");
        let normalized = normalize_workspace_tool_permission_behavior(permission, false);
        assert_eq!(normalized.behavior, PermissionBehavior::Deny);
        assert!(normalized
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("当前模式不支持交互确认"));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_strict_mode_rejects_python_command() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, false);
        let regex = Regex::new(&pattern).unwrap();

        assert!(regex.is_match("rg -n \"foo\" ."));
        assert!(!regex.is_match("python -m pip install playwright"));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_auto_mode_allows_common_commands() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, true);
        let regex = Regex::new(&pattern).unwrap();

        assert!(regex.is_match("python -m pip install playwright"));
        assert!(regex.is_match("npm install && npm run build"));
        assert!(regex.is_match("python3 <<'EOF'\nprint('hello')\nEOF"));
    }

    #[test]
    fn test_normalize_shell_command_params_accepts_cmd_alias() {
        let input = serde_json::json!({
            "cmd": "echo hello",
            "timeout": 10
        });

        let normalized = normalize_shell_command_params(&input);
        assert_eq!(
            normalized.get("command").and_then(|value| value.as_str()),
            Some("echo hello")
        );
    }

    #[test]
    fn test_normalize_shell_command_params_keeps_existing_command() {
        let input = serde_json::json!({
            "command": "pwd",
            "cmd": "echo should_not_override"
        });

        let normalized = normalize_shell_command_params(&input);
        assert_eq!(
            normalized.get("command").and_then(|value| value.as_str()),
            Some("pwd")
        );
    }

    #[test]
    fn test_shared_task_manager_returns_same_instance() {
        let first = shared_task_manager();
        let second = shared_task_manager();
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn test_tool_search_parse_schema_metadata() {
        let schema = serde_json::json!({
            "x-proxycast": {
                "deferred_loading": true,
                "always_visible": false,
                "allowed_callers": ["assistant", "code_execution"],
                "input_examples": [{"query":"rust"}],
                "tags": ["mcp", "filesystem"]
            }
        });
        let (deferred, always_visible, allowed_callers, tags, input_examples) =
            ToolSearchBridgeTool::parse_schema_metadata("docs_search", &schema);
        assert!(deferred);
        assert!(!always_visible);
        assert_eq!(
            allowed_callers,
            vec!["assistant".to_string(), "code_execution".to_string()]
        );
        assert_eq!(tags, vec!["mcp".to_string(), "filesystem".to_string()]);
        assert_eq!(input_examples, vec![serde_json::json!({"query":"rust"})]);
    }

    #[test]
    fn test_tool_search_parse_schema_metadata_infers_builtin_input_examples() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type":"string"}
            },
            "required": ["query"]
        });
        let (_, _, _, _, input_examples) =
            ToolSearchBridgeTool::parse_schema_metadata("WebSearch", &schema);
        assert!(!input_examples.is_empty());
        assert!(input_examples[0].get("query").is_some());
    }

    #[test]
    fn test_tool_search_score_match_prefers_exact_name() {
        let exact = ToolSearchBridgeTool::score_match(
            "web_fetch",
            "fetch webpage",
            &["web".to_string()],
            "web_fetch",
        );
        let partial = ToolSearchBridgeTool::score_match(
            "fetch_web",
            "web fetch helper",
            &["web".to_string()],
            "web_fetch",
        );
        assert!(exact > partial);
    }

    #[tokio::test]
    async fn test_tool_search_bridge_tool_end_to_end_filters_by_caller_and_deferred() {
        let registry = Arc::new(tokio::sync::RwLock::new(aster::tools::ToolRegistry::new()));
        {
            let mut guard = registry.write().await;
            guard.register(Box::new(DummyTool::new(
                "docs_search",
                "Search docs",
                serde_json::json!({
                    "type": "object",
                    "x-proxycast": {
                        "deferred_loading": true,
                        "allowed_callers": ["assistant"],
                        "tags": ["docs", "search"]
                    }
                }),
            )));
            guard.register(Box::new(DummyTool::new(
                "admin_secret",
                "Admin-only tool",
                serde_json::json!({
                    "type": "object",
                    "x-proxycast": {
                        "deferred_loading": true,
                        "allowed_callers": ["code_execution"],
                        "tags": ["admin"]
                    }
                }),
            )));
            guard.register(Box::new(DummyTool::new(
                "weather",
                "Weather by city",
                serde_json::json!({
                    "type": "object",
                    "x-proxycast": {
                        "deferred_loading": false,
                        "tags": ["weather"]
                    }
                }),
            )));
        }

        let tool = ToolSearchBridgeTool::new(registry.clone());
        let context = ToolContext::new(PathBuf::from("."));

        let hidden_result = tool
            .execute(
                serde_json::json!({
                    "query": "search",
                    "caller": "assistant",
                    "include_deferred": false,
                    "include_schema": true
                }),
                &context,
            )
            .await
            .expect("tool_search should succeed");
        let hidden_output = hidden_result.output.expect("tool_search output");
        let hidden_json: serde_json::Value =
            serde_json::from_str(&hidden_output).expect("parse tool_search output");
        assert_eq!(hidden_json["count"], serde_json::json!(0));

        let visible_result = tool
            .execute(
                serde_json::json!({
                    "query": "search",
                    "caller": "assistant",
                    "include_deferred": true,
                    "include_schema": true
                }),
                &context,
            )
            .await
            .expect("tool_search should succeed");
        let visible_output = visible_result.output.expect("tool_search output");
        let visible_json: serde_json::Value =
            serde_json::from_str(&visible_output).expect("parse tool_search output");
        let tools = visible_json["tools"]
            .as_array()
            .expect("tools should be array");

        assert_eq!(visible_json["count"], serde_json::json!(1));
        assert_eq!(tools[0]["name"], serde_json::json!("docs_search"));
        assert_eq!(tools[0]["deferred_loading"], serde_json::json!(true));
        assert!(tools[0].get("input_schema").is_some());
        assert!(tools[0]
            .get("input_examples")
            .and_then(|v| v.as_array())
            .is_some());
        assert!(tools.iter().all(|tool| tool["name"] != "admin_secret"));
    }
}

/// 将 ProxyCast 已运行的 MCP servers 注入到 Aster Agent 作为 extensions
///
/// 获取 McpClientManager 中所有已运行的 server 配置，
/// 转换为 Aster 的 ExtensionConfig::Stdio 并注册到 Agent。
///
/// 关键：将当前进程的 PATH 等环境变量合并到 MCP server 的 env 中，
/// 确保 Aster 启动的子进程能找到 npx/uvx 等命令。
///
/// 返回 (成功数, 失败数)
async fn inject_mcp_extensions(
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> (usize, usize) {
    let manager = mcp_manager.lock().await;
    let running_servers = manager.get_running_servers().await;

    if running_servers.is_empty() {
        tracing::debug!("[AsterAgent] 没有运行中的 MCP servers，跳过注入");
        return (0, 0);
    }

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = match guard.as_ref() {
        Some(a) => a,
        None => {
            tracing::warn!("[AsterAgent] Agent 未初始化，无法注入 MCP extensions");
            return (0, running_servers.len());
        }
    };

    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for server_name in &running_servers {
        // 检查是否已注册（避免重复注册）
        let ext_configs = agent.get_extension_configs().await;
        if ext_configs.iter().any(|c| c.name() == *server_name) {
            tracing::debug!("[AsterAgent] MCP extension '{}' 已注册，跳过", server_name);
            success_count += 1;
            continue;
        }

        if let Some(config) = manager.get_client_config(server_name).await {
            // 合并当前进程的关键环境变量到 MCP server 的 env 中
            // 确保子进程能找到 npx/uvx/node 等命令
            let mut merged_env = config.env.clone();
            for key in &["PATH", "HOME", "USER", "SHELL", "NODE_PATH", "NVM_DIR"] {
                if !merged_env.contains_key(*key) {
                    if let Ok(val) = std::env::var(key) {
                        merged_env.insert(key.to_string(), val);
                    }
                }
            }

            tracing::info!(
                "[AsterAgent] 注入 MCP extension '{}': cmd='{}', args={:?}, env_keys={:?}",
                server_name,
                config.command,
                config.args,
                merged_env.keys().collect::<Vec<_>>()
            );

            // 增加超时时间：npx 首次下载可能需要较长时间
            let timeout = std::cmp::max(config.timeout, 60);

            let extension = ExtensionConfig::Stdio {
                name: server_name.clone(),
                description: format!("MCP Server: {server_name}"),
                cmd: config.command.clone(),
                args: config.args.clone(),
                envs: Envs::new(merged_env),
                env_keys: vec![],
                timeout: Some(timeout),
                bundled: Some(false),
                available_tools: vec![],
                deferred_loading: false,
                always_expose_tools: Vec::new(),
                allowed_caller: None,
            };

            match agent.add_extension(extension).await {
                Ok(_) => {
                    tracing::info!("[AsterAgent] 成功注入 MCP extension: {}", server_name);
                    success_count += 1;
                }
                Err(e) => {
                    tracing::error!(
                        "[AsterAgent] 注入 MCP extension '{}' 失败: {}。\
                        cmd='{}', args={:?}。请检查命令是否在 PATH 中可用。",
                        server_name,
                        e,
                        config.command,
                        config.args
                    );
                    fail_count += 1;
                }
            }
        } else {
            tracing::warn!("[AsterAgent] 无法获取 MCP server '{}' 的配置", server_name);
            fail_count += 1;
        }
    }

    if fail_count > 0 {
        tracing::warn!(
            "[AsterAgent] MCP 注入结果: {} 成功, {} 失败",
            success_count,
            fail_count
        );
    } else {
        tracing::info!(
            "[AsterAgent] MCP 注入完成: {} 个 extension 全部成功",
            success_count
        );
    }

    (success_count, fail_count)
}

/// 确保 ProxyCast 可用的 MCP servers 已启动
///
/// 启动启用了 `enabled_proxycast` 的服务器。
async fn ensure_proxycast_mcp_servers_running(
    db: &DbConnection,
    mcp_manager: &McpManagerState,
) -> (usize, usize) {
    let servers = match McpService::get_all(db) {
        Ok(items) => items,
        Err(e) => {
            tracing::warn!("[AsterAgent] 读取 MCP 配置失败，跳过自动启动: {}", e);
            return (0, 0);
        }
    };

    if servers.is_empty() {
        return (0, 0);
    }

    let candidates: Vec<&crate::models::mcp_model::McpServer> =
        servers.iter().filter(|s| s.enabled_proxycast).collect();

    if candidates.is_empty() {
        return (0, 0);
    }

    let manager = mcp_manager.lock().await;
    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for server in candidates {
        if manager.is_server_running(&server.name).await {
            continue;
        }

        let parsed = server.parse_config();
        let config = McpServerConfig {
            command: parsed.command,
            args: parsed.args,
            env: parsed.env,
            cwd: parsed.cwd,
            timeout: parsed.timeout,
        };

        match manager.start_server(&server.name, &config).await {
            Ok(_) => {
                tracing::info!("[AsterAgent] MCP server 已自动启动: {}", server.name);
                success_count += 1;
            }
            Err(e) => {
                tracing::error!(
                    "[AsterAgent] MCP server 自动启动失败: {} => {}",
                    server.name,
                    e
                );
                fail_count += 1;
            }
        }
    }

    (success_count, fail_count)
}
