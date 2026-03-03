//! MCP 类型定义
//!
//! 本模块定义 MCP 协议相关的数据类型，包括：
//! - 服务器配置和状态
//! - 工具定义、调用和结果
//! - 提示词定义和结果
//! - 资源定义和内容
//! - 错误类型
//! - Tauri 事件 Payload

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// 服务器配置和状态
// ============================================================================

/// MCP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// 启动命令
    pub command: String,
    /// 命令参数
    #[serde(default)]
    pub args: Vec<String>,
    /// 环境变量
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 工作目录
    pub cwd: Option<String>,
    /// 超时时间（秒）
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30
}

/// MCP 服务器信息（包含运行状态）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub config: McpServerConfig,
    pub is_running: bool,
    pub server_info: Option<McpServerCapabilities>,
    pub enabled_proxycast: bool,
    pub enabled_claude: bool,
    pub enabled_codex: bool,
    pub enabled_gemini: bool,
}

/// MCP 服务器能力
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerCapabilities {
    pub name: String,
    pub version: String,
    pub supports_tools: bool,
    pub supports_prompts: bool,
    pub supports_resources: bool,
}

// ============================================================================
// 工具类型
// ============================================================================

/// MCP 工具定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub server_name: String,
    /// 是否延迟加载（不默认注入上下文）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_loading: Option<bool>,
    /// 是否始终可见（即使 deferred_loading=true 也可见）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_visible: Option<bool>,
    /// 允许调用方（如 assistant/code_execution/tool_search）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_callers: Option<Vec<String>>,
    /// 工具输入示例
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_examples: Option<Vec<serde_json::Value>>,
    /// 标签（用于工具搜索）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// MCP 工具调用请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

/// MCP 工具调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

/// MCP 内容类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource {
        uri: String,
        text: Option<String>,
        blob: Option<String>,
    },
}

// ============================================================================
// 提示词类型
// ============================================================================

/// MCP 提示词定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptDefinition {
    pub name: String,
    pub description: Option<String>,
    pub arguments: Vec<McpPromptArgument>,
    pub server_name: String,
}

/// MCP 提示词参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptArgument {
    pub name: String,
    pub description: Option<String>,
    pub required: bool,
}

/// MCP 提示词结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptResult {
    pub description: Option<String>,
    pub messages: Vec<McpPromptMessage>,
}

/// MCP 提示词消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptMessage {
    pub role: String,
    pub content: McpContent,
}

// ============================================================================
// 资源类型
// ============================================================================

/// MCP 资源定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourceDefinition {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub server_name: String,
}

/// MCP 资源内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourceContent {
    pub uri: String,
    pub mime_type: Option<String>,
    pub text: Option<String>,
    pub blob: Option<String>,
}

// ============================================================================
// 错误类型
// ============================================================================

/// MCP 错误类型
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("服务器配置不存在: {0}")]
    ConfigNotFound(String),

    #[error("服务器已在运行: {0}")]
    ServerAlreadyRunning(String),

    #[error("服务器未运行: {0}")]
    ServerNotRunning(String),

    #[error("无法启动服务器进程: {0}")]
    ProcessSpawnFailed(String),

    #[error("MCP 连接失败: {0}")]
    ConnectionFailed(String),

    #[error("工具不存在: {0}")]
    ToolNotFound(String),

    #[error("工具调用失败: {0}")]
    ToolCallFailed(String),

    #[error("操作超时")]
    Timeout,

    #[error("数据库错误: {0}")]
    DatabaseError(String),

    #[error("协议错误: {0}")]
    ProtocolError(String),
}

// ============================================================================
// Tauri 事件 Payload
// ============================================================================

/// 服务器启动事件
#[derive(Debug, Clone, Serialize)]
pub struct McpServerStartedPayload {
    pub server_name: String,
    pub server_info: Option<McpServerCapabilities>,
}

/// 服务器停止事件
#[derive(Debug, Clone, Serialize)]
pub struct McpServerStoppedPayload {
    pub server_name: String,
}

/// 服务器错误事件
#[derive(Debug, Clone, Serialize)]
pub struct McpServerErrorPayload {
    pub server_name: String,
    pub error: String,
}

/// 工具列表更新事件
#[derive(Debug, Clone, Serialize)]
pub struct McpToolsUpdatedPayload {
    pub tools: Vec<McpToolDefinition>,
}

// ============================================================================
// 状态类型
// ============================================================================

use std::sync::Arc;
use tokio::sync::Mutex;

/// MCP 客户端管理器状态
///
/// 使用 Arc<Mutex<McpClientManager>> 包装，支持跨线程共享和异步访问。
pub type McpManagerState = Arc<Mutex<super::manager::McpClientManager>>;
