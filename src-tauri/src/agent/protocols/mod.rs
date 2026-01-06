//! 协议策略模块
//!
//! 使用策略模式处理不同 API 协议（OpenAI、Anthropic、Kiro、Gemini）

mod anthropic;
mod openai;

pub use anthropic::AnthropicProtocol;
pub use openai::OpenAIProtocol;

use crate::agent::types::{
    AgentConfig, AgentMessage, ImageData, ProviderType, StreamEvent, StreamResult,
};
use crate::models::openai::Tool;
use async_trait::async_trait;
use reqwest::Client;
use tokio::sync::mpsc;

/// 协议处理器 trait
///
/// 定义了所有协议必须实现的方法
#[async_trait]
pub trait Protocol: Send + Sync {
    /// 流式聊天
    ///
    /// 发送消息并通过 channel 返回流式响应
    async fn chat_stream(
        &self,
        client: &Client,
        base_url: &str,
        api_key: &str,
        messages: &[AgentMessage],
        user_message: &str,
        images: Option<&[ImageData]>,
        model: &str,
        config: &AgentConfig,
        tools: Option<&[Tool]>,
        tx: mpsc::Sender<StreamEvent>,
        provider_id: Option<&str>,
    ) -> Result<StreamResult, String>;

    /// 继续流式对话（工具调用后）
    ///
    /// 使用会话历史继续对话，不添加新的用户消息
    async fn chat_stream_continue(
        &self,
        client: &Client,
        base_url: &str,
        api_key: &str,
        messages: &[AgentMessage],
        model: &str,
        config: &AgentConfig,
        tools: Option<&[Tool]>,
        tx: mpsc::Sender<StreamEvent>,
        provider_id: Option<&str>,
    ) -> Result<StreamResult, String>;

    /// 获取 API 端点
    fn endpoint(&self) -> &'static str;
}

/// 根据 ProviderType 创建协议处理器
pub fn create_protocol(provider_type: ProviderType) -> Box<dyn Protocol> {
    match provider_type {
        // Claude 和 Kiro 都使用 Anthropic SSE 协议
        ProviderType::Claude | ProviderType::ClaudeOauth | ProviderType::Kiro => {
            Box::new(AnthropicProtocol)
        }
        // 其他使用 OpenAI 兼容协议
        _ => Box::new(OpenAIProtocol),
    }
}
