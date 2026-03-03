//! Claude Custom Provider (自定义 Claude API)
use proxycast_core::models::anthropic::AnthropicMessagesRequest;
use proxycast_core::models::openai::{ChatCompletionRequest, ContentPart, MessageContent};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClaudeCustomConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub enabled: bool,
}

pub struct ClaudeCustomProvider {
    pub config: ClaudeCustomConfig,
    pub client: Client,
}

/// 创建配置好的 HTTP 客户端
///
/// 配置说明：
/// - connect_timeout: 连接超时 30 秒
/// - timeout: 总超时 10 分钟（流式响应可能很长）
/// - 不设置 pool_idle_timeout 以保持连接活跃
fn create_http_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600)) // 10 分钟总超时，支持长时间流式响应
        .tcp_keepalive(Duration::from_secs(60)) // TCP keepalive 保持连接活跃
        .gzip(true) // 自动解压 gzip 响应
        .brotli(true) // 自动解压 brotli 响应
        .deflate(true) // 自动解压 deflate 响应
        .build()
        .unwrap_or_else(|_| Client::new())
}

impl Default for ClaudeCustomProvider {
    fn default() -> Self {
        Self {
            config: ClaudeCustomConfig::default(),
            client: create_http_client(),
        }
    }
}

impl ClaudeCustomProvider {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用 API key 和 base_url 创建 Provider
    pub fn with_config(api_key: String, base_url: Option<String>) -> Self {
        Self {
            config: ClaudeCustomConfig {
                api_key: Some(api_key),
                base_url,
                enabled: true,
            },
            client: create_http_client(),
        }
    }

    pub fn get_base_url(&self) -> String {
        self.config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.anthropic.com".to_string())
    }

    pub fn is_configured(&self) -> bool {
        self.config.api_key.is_some() && self.config.enabled
    }

    /// 构建完整的 API URL
    /// 智能处理用户输入的 base_url，无论是否带 /v1 都能正确工作
    fn build_url(&self, endpoint: &str) -> String {
        let base = self.get_base_url();
        let base = base.trim_end_matches('/');

        // 如果用户输入了带 /v1 的 URL，直接拼接 endpoint
        // 否则拼接 /v1/endpoint
        if base.ends_with("/v1") {
            format!("{base}/{endpoint}")
        } else {
            format!("{base}/v1/{endpoint}")
        }
    }

    /// 将 OpenAI 图片 URL 格式转换为 Claude 图片格式
    ///
    /// 支持两种格式：
    /// 1. data URL: `data:image/jpeg;base64,xxxxx` -> Claude base64 格式
    /// 2. HTTP URL: `https://...` -> 作为文本提示（Claude 不直接支持 URL）
    fn convert_image_url_to_claude(url: &str) -> Option<serde_json::Value> {
        if url.starts_with("data:") {
            // 解析 data URL: data:image/jpeg;base64,xxxxx
            let parts: Vec<&str> = url.splitn(2, ',').collect();
            if parts.len() == 2 {
                let header = parts[0]; // data:image/jpeg;base64
                let data = parts[1]; // base64 数据

                // 提取 media_type: image/jpeg, image/png, image/gif, image/webp
                let media_type = header
                    .strip_prefix("data:")
                    .and_then(|s| s.split(';').next())
                    .unwrap_or("image/jpeg");

                tracing::debug!("[CLAUDE_IMAGE] 转换 base64 图片: media_type={}", media_type);

                return Some(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data
                    }
                }));
            }
        } else if url.starts_with("http://") || url.starts_with("https://") {
            // Claude 不直接支持 URL 图片，转为文本提示
            tracing::warn!("[CLAUDE_IMAGE] Claude 不支持 URL 图片，转为文本: {}", url);
            return Some(serde_json::json!({
                "type": "text",
                "text": format!("[Image: {}]", url)
            }));
        }

        tracing::warn!("[CLAUDE_IMAGE] 无法解析图片 URL: {}", url);
        None
    }

    fn convert_openai_tool_to_anthropic(
        tool: &proxycast_core::models::openai::Tool,
    ) -> Option<serde_json::Value> {
        match tool {
            proxycast_core::models::openai::Tool::Function { function } => {
                let input_schema = function
                    .parameters
                    .clone()
                    .unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}}));
                let extension = input_schema
                    .get("x-proxycast")
                    .or_else(|| input_schema.get("x_proxycast"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let mut input_examples = extension
                    .get("input_examples")
                    .or_else(|| extension.get("inputExamples"))
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if input_examples.is_empty() {
                    input_examples = proxycast_core::tool_calling::resolve_tool_input_examples(
                        &function.name,
                        &input_schema,
                    );
                }
                let allowed_callers = extension
                    .get("allowed_callers")
                    .or_else(|| extension.get("allowedCallers"))
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .map(|v| v.trim().to_string())
                            .filter(|v| !v.is_empty())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                let mut description = function.description.clone().unwrap_or_default();
                if !input_examples.is_empty() && !description.contains("[InputExamples]") {
                    let rendered = input_examples
                        .iter()
                        .take(3)
                        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()))
                        .collect::<Vec<_>>()
                        .join(" | ");
                    description.push_str("\n\n[InputExamples] ");
                    description.push_str(&rendered);
                }
                if !allowed_callers.is_empty() && !description.contains("[AllowedCallers]") {
                    description.push_str("\n\n[AllowedCallers] ");
                    description.push_str(&allowed_callers.join(", "));
                }

                let mut anthropic_tool = serde_json::json!({
                    "name": function.name,
                    "description": description,
                    "input_schema": input_schema
                });
                if !input_examples.is_empty() {
                    anthropic_tool["input_examples"] = serde_json::Value::Array(input_examples);
                }
                if !allowed_callers.is_empty() {
                    anthropic_tool["allowed_callers"] = serde_json::json!(allowed_callers);
                }
                Some(anthropic_tool)
            }
            _ => None,
        }
    }

    fn convert_openai_tool_choice_to_anthropic(
        tool_choice: &Option<serde_json::Value>,
    ) -> Option<serde_json::Value> {
        let Some(tool_choice) = tool_choice else {
            return None;
        };
        match tool_choice {
            serde_json::Value::String(s) => match s.as_str() {
                "none" => Some(serde_json::json!({"type":"none"})),
                "auto" => Some(serde_json::json!({"type":"auto"})),
                "required" | "any" => Some(serde_json::json!({"type":"any"})),
                _ => None,
            },
            serde_json::Value::Object(obj) => {
                if let Some(func) = obj.get("function") {
                    func.get("name")
                        .and_then(|n| n.as_str())
                        .map(|name| serde_json::json!({"type":"tool","name":name}))
                } else if let Some(t) = obj.get("type").and_then(|t| t.as_str()) {
                    match t {
                        "any" | "tool" => Some(serde_json::json!({"type":"any"})),
                        "auto" => Some(serde_json::json!({"type":"auto"})),
                        "none" => Some(serde_json::json!({"type":"none"})),
                        _ => None,
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// 调用 Anthropic API（原生格式）
    pub async fn call_api(
        &self,
        request: &AnthropicMessagesRequest,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages");

        // 打印请求 URL 和模型用于调试
        tracing::info!(
            "[CLAUDE_API] 发送请求: url={} model={} stream={}",
            url,
            request.model,
            request.stream
        );

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(request)
            .send()
            .await?;

        // 打印响应状态
        tracing::info!(
            "[CLAUDE_API] 响应状态: status={} model={}",
            resp.status(),
            request.model
        );

        Ok(resp)
    }

    /// 调用 OpenAI 格式的 API（内部转换为 Anthropic 格式）
    pub async fn call_openai_api(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        // 手动转换 OpenAI 请求为 Anthropic 格式
        let mut anthropic_messages = Vec::new();
        let mut system_content = None;

        for msg in &request.messages {
            let role = &msg.role;

            // 提取消息内容，转换为 Anthropic 格式的 content 数组
            let content_blocks: Vec<serde_json::Value> = match &msg.content {
                Some(MessageContent::Text(text)) => {
                    if text.is_empty() {
                        vec![]
                    } else {
                        vec![serde_json::json!({"type": "text", "text": text})]
                    }
                }
                Some(MessageContent::Parts(parts)) => {
                    parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::Text { text } => {
                                if text.is_empty() {
                                    None
                                } else {
                                    Some(serde_json::json!({"type": "text", "text": text}))
                                }
                            }
                            ContentPart::ImageUrl { image_url } => {
                                // 转换 OpenAI 图片格式为 Claude 图片格式
                                Self::convert_image_url_to_claude(&image_url.url)
                            }
                        })
                        .collect()
                }
                None => vec![],
            };

            if role == "system" {
                // system 消息只提取文本
                let text = content_blocks
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("");
                system_content = Some(text);
            } else if !content_blocks.is_empty() {
                let anthropic_role = if role == "assistant" {
                    "assistant"
                } else {
                    "user"
                };
                anthropic_messages.push(serde_json::json!({
                    "role": anthropic_role,
                    "content": content_blocks
                }));
            }
        }

        let mut anthropic_body = serde_json::json!({
            "model": request.model,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "messages": anthropic_messages
        });

        if let Some(sys) = system_content {
            anthropic_body["system"] = serde_json::json!(sys);
        }

        if let Some(ref tools) = request.tools {
            let anthropic_tools: Vec<serde_json::Value> = tools
                .iter()
                .filter_map(Self::convert_openai_tool_to_anthropic)
                .collect();
            if !anthropic_tools.is_empty() {
                anthropic_body["tools"] = serde_json::json!(anthropic_tools);
            }
        }
        if let Some(tc) = Self::convert_openai_tool_choice_to_anthropic(&request.tool_choice) {
            anthropic_body["tool_choice"] = tc;
        }

        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages");

        // 打印请求 URL 和模型用于调试
        tracing::info!(
            "[CLAUDE_API] 发送请求 (OpenAI 格式转换): url={} model={} stream={}",
            url,
            request.model,
            request.stream
        );

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&anthropic_body)
            .send()
            .await?;

        // 打印响应状态
        let status = resp.status();
        tracing::info!(
            "[CLAUDE_API] 响应状态: status={} model={}",
            status,
            request.model
        );

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();

            // 检查是否是 Claude Code 专用凭证限制错误
            if body.contains("only authorized for use with Claude Code") {
                return Err(format!(
                    "凭证限制错误: 当前 Claude 凭证只能用于 Claude Code，不能用于通用 API 调用。\
                    请使用通用的 Claude API Key 或 Anthropic API Key。\
                    错误详情: {status} - {body}"
                )
                .into());
            }

            return Err(format!("Claude API error: {status} - {body}").into());
        }

        let anthropic_resp: serde_json::Value = resp.json().await?;

        // 转换回 OpenAI 格式
        let content = anthropic_resp["content"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|block| block["text"].as_str())
            .unwrap_or("");

        Ok(serde_json::json!({
            "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
            "object": "chat.completion",
            "created": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            "model": request.model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": anthropic_resp["usage"]["input_tokens"].as_u64().unwrap_or(0),
                "completion_tokens": anthropic_resp["usage"]["output_tokens"].as_u64().unwrap_or(0),
                "total_tokens": 0
            }
        }))
    }

    pub async fn messages(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages");

        // 打印请求 URL 用于调试
        let model = request
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");
        let stream = request
            .get("stream")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);
        tracing::info!(
            "[CLAUDE_API] 发送请求 (原始 JSON): url={} model={} stream={}",
            url,
            model,
            stream
        );

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(request)
            .send()
            .await?;

        // 打印响应状态
        tracing::info!(
            "[CLAUDE_API] 响应状态: status={} model={}",
            resp.status(),
            model
        );

        Ok(resp)
    }

    pub async fn count_tokens(
        &self,
        request: &serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages/count_tokens");

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(request)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Failed to count tokens: {status} - {body}").into());
        }

        let data: serde_json::Value = resp.json().await?;
        Ok(data)
    }
}

// ============================================================================
// StreamingProvider Trait 实现
// ============================================================================

use crate::providers::ProviderError;
use crate::streaming::traits::{
    reqwest_stream_to_stream_response, StreamFormat, StreamResponse, StreamingProvider,
};
use async_trait::async_trait;

#[async_trait]
impl StreamingProvider for ClaudeCustomProvider {
    /// 发起流式 API 调用
    ///
    /// 使用 reqwest 的 bytes_stream 返回字节流，支持真正的端到端流式传输。
    /// Claude 使用 Anthropic SSE 格式。
    ///
    /// # 需求覆盖
    /// - 需求 1.2: ClaudeCustomProvider 流式支持
    async fn call_api_stream(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<StreamResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref().ok_or_else(|| {
            ProviderError::ConfigurationError("Claude API key not configured".to_string())
        })?;

        // 转换 OpenAI 请求为 Anthropic 格式
        let mut anthropic_messages = Vec::new();
        let mut system_content = None;
        // 收集 tool 角色消息的 tool_result，稍后合并到 user 消息中
        let mut pending_tool_results: Vec<serde_json::Value> = Vec::new();

        for msg in &request.messages {
            let role = &msg.role;

            // 处理 tool 角色消息（工具调用结果）
            if role == "tool" {
                // 转换为 Anthropic tool_result content block
                let tool_call_id = msg.tool_call_id.clone().unwrap_or_default();
                let content = msg.get_content_text();
                pending_tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": content
                }));
                continue;
            }

            // 如果有待处理的 tool_results 且当前不是 assistant 消息，先添加一个 user 消息
            if !pending_tool_results.is_empty() && role != "assistant" {
                anthropic_messages.push(serde_json::json!({
                    "role": "user",
                    "content": pending_tool_results.clone()
                }));
                pending_tool_results.clear();
            }

            // 提取消息内容，转换为 Anthropic 格式的 content 数组
            let mut content_blocks: Vec<serde_json::Value> = match &msg.content {
                Some(MessageContent::Text(text)) => {
                    if text.is_empty() {
                        vec![]
                    } else {
                        vec![serde_json::json!({"type": "text", "text": text})]
                    }
                }
                Some(MessageContent::Parts(parts)) => {
                    parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::Text { text } => {
                                if text.is_empty() {
                                    None
                                } else {
                                    Some(serde_json::json!({"type": "text", "text": text}))
                                }
                            }
                            ContentPart::ImageUrl { image_url } => {
                                // 转换 OpenAI 图片格式为 Claude 图片格式
                                Self::convert_image_url_to_claude(&image_url.url)
                            }
                        })
                        .collect()
                }
                None => vec![],
            };

            // 处理 assistant 消息中的 tool_calls
            if role == "assistant" {
                if let Some(ref tool_calls) = msg.tool_calls {
                    for tc in tool_calls {
                        // 解析 arguments JSON
                        let input: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                            .unwrap_or(serde_json::json!({}));
                        content_blocks.push(serde_json::json!({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.function.name,
                            "input": input
                        }));
                    }
                }
            }

            if role == "system" {
                // system 消息只提取文本
                let text = content_blocks
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("");
                system_content = Some(text);
            } else if !content_blocks.is_empty() {
                let anthropic_role = if role == "assistant" {
                    "assistant"
                } else {
                    "user"
                };
                anthropic_messages.push(serde_json::json!({
                    "role": anthropic_role,
                    "content": content_blocks
                }));
            }
        }

        // 处理末尾的 tool_results
        if !pending_tool_results.is_empty() {
            anthropic_messages.push(serde_json::json!({
                "role": "user",
                "content": pending_tool_results
            }));
        }

        let mut anthropic_body = serde_json::json!({
            "model": request.model,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "messages": anthropic_messages,
            "stream": true
        });

        if let Some(sys) = system_content {
            anthropic_body["system"] = serde_json::json!(sys);
        }

        // 转换 tools: OpenAI 格式 -> Anthropic 格式
        if let Some(ref tools) = request.tools {
            let anthropic_tools: Vec<serde_json::Value> = tools
                .iter()
                .filter_map(Self::convert_openai_tool_to_anthropic)
                .collect();

            if !anthropic_tools.is_empty() {
                anthropic_body["tools"] = serde_json::json!(anthropic_tools);
                tracing::info!(
                    "[CLAUDE_STREAM] 添加 {} 个工具到请求",
                    anthropic_tools.len()
                );
            }
        }

        // 转换 tool_choice: OpenAI 格式 -> Anthropic 格式
        if let Some(tc) = Self::convert_openai_tool_choice_to_anthropic(&request.tool_choice) {
            anthropic_body["tool_choice"] = tc;
            tracing::info!(
                "[CLAUDE_STREAM] 设置 tool_choice: {:?}",
                anthropic_body["tool_choice"]
            );
        }

        let url = self.build_url("messages");

        tracing::info!(
            "[CLAUDE_STREAM] 发起流式请求: url={} model={}",
            url,
            request.model
        );

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .json(&anthropic_body)
            .send()
            .await
            .map_err(|e| ProviderError::from_reqwest_error(&e))?;

        // 检查响应状态
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            tracing::error!("[CLAUDE_STREAM] 请求失败: {} - {}", status, body);
            return Err(ProviderError::from_http_status(status.as_u16(), &body));
        }

        tracing::info!("[CLAUDE_STREAM] 流式响应开始: status={}", status);

        // 将 reqwest 响应转换为 StreamResponse
        Ok(reqwest_stream_to_stream_response(resp))
    }

    fn supports_streaming(&self) -> bool {
        self.is_configured()
    }

    fn provider_name(&self) -> &'static str {
        "ClaudeCustomProvider"
    }

    fn stream_format(&self) -> StreamFormat {
        StreamFormat::AnthropicSse
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::models::openai::{FunctionDef, Tool};

    #[test]
    fn test_convert_openai_tool_to_anthropic_keeps_metadata() {
        let tool = Tool::Function {
            function: FunctionDef {
                name: "create_ticket".to_string(),
                description: Some("Create support ticket".to_string()),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"}
                    },
                    "x-proxycast": {
                        "input_examples": [{"title":"Billing issue"}],
                        "allowed_callers": ["assistant", "code_execution"]
                    }
                })),
            },
        };

        let converted = ClaudeCustomProvider::convert_openai_tool_to_anthropic(&tool)
            .expect("tool should be converted");
        let description = converted
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        assert_eq!(converted["name"], serde_json::json!("create_ticket"));
        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert_eq!(
            converted["input_examples"],
            serde_json::json!([{"title":"Billing issue"}])
        );
        assert_eq!(
            converted["allowed_callers"],
            serde_json::json!(["assistant", "code_execution"])
        );
    }

    #[test]
    fn test_convert_openai_tool_choice_to_anthropic_variants() {
        assert_eq!(
            ClaudeCustomProvider::convert_openai_tool_choice_to_anthropic(&Some(
                serde_json::json!("required")
            )),
            Some(serde_json::json!({"type":"any"}))
        );
        assert_eq!(
            ClaudeCustomProvider::convert_openai_tool_choice_to_anthropic(&Some(
                serde_json::json!({"type":"function","function":{"name":"create_ticket"}})
            )),
            Some(serde_json::json!({"type":"tool","name":"create_ticket"}))
        );
        assert_eq!(
            ClaudeCustomProvider::convert_openai_tool_choice_to_anthropic(&Some(
                serde_json::json!({"type":"none"})
            )),
            Some(serde_json::json!({"type":"none"}))
        );
    }

    #[test]
    fn test_convert_openai_tool_to_anthropic_uses_builtin_input_examples_fallback() {
        let tool = Tool::Function {
            function: FunctionDef {
                name: "WebSearch".to_string(),
                description: Some("允许 Claude 搜索网络并使用结果来提供响应。".to_string()),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer"}
                    },
                    "required": ["query"]
                })),
            },
        };

        let converted = ClaudeCustomProvider::convert_openai_tool_to_anthropic(&tool)
            .expect("tool should be converted");
        let description = converted
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        assert!(description.contains("[InputExamples]"));
        assert!(converted
            .get("input_examples")
            .and_then(|v| v.as_array())
            .map(|arr| !arr.is_empty())
            .unwrap_or(false));
    }
}
