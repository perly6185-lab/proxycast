//! OpenAI Custom Provider (自定义 OpenAI 兼容 API)
use proxycast_core::models::openai::ChatCompletionRequest;
use reqwest::Client;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenAICustomConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub enabled: bool,
}

pub struct OpenAICustomProvider {
    pub config: OpenAICustomConfig,
    pub client: Client,
}

/// 创建配置好的 HTTP 客户端
fn create_http_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600)) // 10 分钟总超时
        .tcp_keepalive(Duration::from_secs(60))
        .gzip(true) // 自动解压 gzip 响应
        .brotli(true) // 自动解压 brotli 响应
        .deflate(true) // 自动解压 deflate 响应
        .build()
        .unwrap_or_else(|_| Client::new())
}

impl Default for OpenAICustomProvider {
    fn default() -> Self {
        Self {
            config: OpenAICustomConfig::default(),
            client: create_http_client(),
        }
    }
}

impl OpenAICustomProvider {
    fn tool_calling_v2_enabled() -> bool {
        proxycast_core::tool_calling::tool_calling_v2_enabled()
    }

    fn native_input_examples_enabled() -> bool {
        proxycast_core::tool_calling::tool_calling_native_input_examples_enabled()
    }

    fn normalize_openai_request_payload(&self, payload: &mut serde_json::Value) {
        if !Self::tool_calling_v2_enabled() {
            return;
        }

        let Some(tools) = payload.get_mut("tools").and_then(|v| v.as_array_mut()) else {
            return;
        };

        for tool in tools.iter_mut() {
            let tool_type = tool
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if tool_type != "function" {
                continue;
            }

            let Some(function) = tool.get_mut("function").and_then(|v| v.as_object_mut()) else {
                continue;
            };

            let parameters = function
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let extension = parameters
                .get("x-proxycast")
                .or_else(|| parameters.get("x_proxycast"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));

            let mut input_examples = extension
                .get("input_examples")
                .or_else(|| extension.get("inputExamples"))
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if input_examples.is_empty() {
                let tool_name = function
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                input_examples = proxycast_core::tool_calling::resolve_tool_input_examples(
                    tool_name,
                    &parameters,
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
            let deferred_loading = extension
                .get("deferred_loading")
                .or_else(|| extension.get("deferredLoading"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let description = function
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut enhanced_description = description.clone();

            if !input_examples.is_empty() && !enhanced_description.contains("[InputExamples]") {
                let rendered = input_examples
                    .iter()
                    .take(3)
                    .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()))
                    .collect::<Vec<_>>()
                    .join(" | ");
                enhanced_description.push_str("\n\n[InputExamples] ");
                enhanced_description.push_str(&rendered);
            }

            if !allowed_callers.is_empty() && !enhanced_description.contains("[AllowedCallers]") {
                enhanced_description.push_str("\n\n[AllowedCallers] ");
                enhanced_description.push_str(&allowed_callers.join(", "));
            }

            if deferred_loading && !enhanced_description.contains("[DeferredLoading]") {
                enhanced_description.push_str("\n\n[DeferredLoading] true");
            }

            function.insert(
                "description".to_string(),
                serde_json::Value::String(enhanced_description),
            );

            if !input_examples.is_empty() && Self::native_input_examples_enabled() {
                function.insert(
                    "input_examples".to_string(),
                    serde_json::Value::Array(input_examples.clone()),
                );
            }
        }
    }

    fn maybe_log_protocol_mismatch_hint(url: &str, status: StatusCode) {
        if (status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN)
            && url.contains("/api/anthropic")
        {
            eprintln!(
                "[OPENAI_CUSTOM] 提示: URL '{url}' 返回 {status}，疑似协议不匹配。若上游是 Anthropic 兼容网关，请改用 /v1/messages + x-api-key。"
            );
        }
    }

    pub fn new() -> Self {
        Self::default()
    }

    /// 使用 API key 和 base_url 创建 Provider
    pub fn with_config(api_key: String, base_url: Option<String>) -> Self {
        Self {
            config: OpenAICustomConfig {
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
            .unwrap_or_else(|| "https://api.openai.com".to_string())
    }

    pub fn is_configured(&self) -> bool {
        self.config.api_key.is_some() && self.config.enabled
    }

    /// 构建完整的 API URL
    /// 智能处理用户输入的 base_url，支持多种 API 版本格式
    ///
    /// 支持的格式：
    /// - `https://api.openai.com` -> `https://api.openai.com/v1/chat/completions`
    /// - `https://api.openai.com/v1` -> `https://api.openai.com/v1/chat/completions`
    /// - `https://open.bigmodel.cn/api/paas/v4` -> `https://open.bigmodel.cn/api/paas/v4/chat/completions`
    /// - `https://api.deepseek.com/v1` -> `https://api.deepseek.com/v1/chat/completions`
    fn build_url(&self, endpoint: &str) -> String {
        let base = self.get_base_url();
        let base = base.trim_end_matches('/');

        // 检查是否已经包含版本号路径（/v1, /v2, /v3, /v4 等）
        // 使用正则匹配 /v 后跟数字的模式
        let has_version = base
            .rsplit('/')
            .next()
            .map(|last_segment| {
                last_segment.starts_with('v')
                    && last_segment.len() >= 2
                    && last_segment[1..].chars().all(|c| c.is_ascii_digit())
            })
            .unwrap_or(false);

        if has_version {
            // 已有版本号，直接拼接 endpoint
            format!("{base}/{endpoint}")
        } else {
            // 没有版本号，添加 /v1
            format!("{base}/v1/{endpoint}")
        }
    }

    fn build_url_fallback_without_v1(&self, endpoint: &str) -> Option<String> {
        let url = self.build_url(endpoint);
        if url.contains("/v1/") {
            Some(url.replacen("/v1/", "/", 1))
        } else {
            None
        }
    }

    fn build_url_from_base(base_url: &str, endpoint: &str) -> String {
        let base = base_url.trim_end_matches('/');

        let has_version = base
            .rsplit('/')
            .next()
            .map(|last_segment| {
                last_segment.starts_with('v')
                    && last_segment.len() >= 2
                    && last_segment[1..].chars().all(|c| c.is_ascii_digit())
            })
            .unwrap_or(false);

        if has_version {
            format!("{base}/{endpoint}")
        } else {
            format!("{base}/v1/{endpoint}")
        }
    }

    fn base_url_parent(&self) -> Option<String> {
        let base = self.get_base_url();
        let base = base.trim();

        let mut url = Url::parse(base)
            .or_else(|_| Url::parse(&format!("http://{base}")))
            .ok()?;

        let path = url.path().trim_end_matches('/');
        if path.is_empty() || path == "/" {
            return None;
        }

        let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        if segments.is_empty() {
            return None;
        }
        segments.pop();

        let new_path = if segments.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", segments.join("/"))
        };

        url.set_path(&new_path);
        url.set_query(None);
        url.set_fragment(None);

        Some(url.to_string().trim_end_matches('/').to_string())
    }

    fn build_urls_with_fallbacks(&self, endpoint: &str) -> Vec<String> {
        let mut urls: Vec<String> = Vec::new();

        let primary = self.build_url(endpoint);
        urls.push(primary.clone());

        if let Some(no_v1) = self.build_url_fallback_without_v1(endpoint) {
            if no_v1 != primary {
                urls.push(no_v1);
            }
        }

        if let Some(parent_base) = self.base_url_parent() {
            let u = Self::build_url_from_base(&parent_base, endpoint);
            if !urls.iter().any(|x| x == &u) {
                urls.push(u.clone());
            }

            if u.contains("/v1/") {
                let u2 = u.replacen("/v1/", "/", 1);
                if !urls.iter().any(|x| x == &u2) {
                    urls.push(u2);
                }
            }
        }

        urls
    }

    /// 调用 OpenAI API（使用类型化请求）
    pub async fn call_api(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let urls = self.build_urls_with_fallbacks("chat/completions");
        let mut last_resp: Option<reqwest::Response> = None;

        eprintln!(
            "[OPENAI_CUSTOM] call_api testing with model: {}",
            request.model
        );

        let mut payload =
            serde_json::to_value(request).map_err(|e| format!("序列化 OpenAI 请求失败: {e}"))?;
        self.normalize_openai_request_payload(&mut payload);

        for url in &urls {
            eprintln!("[OPENAI_CUSTOM] call_api trying URL: {url}");
            let resp = self
                .client
                .post(url)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await?;

            Self::maybe_log_protocol_mismatch_hint(url, resp.status());

            if resp.status() != StatusCode::NOT_FOUND {
                return Ok(resp);
            }
            last_resp = Some(resp);
        }

        Ok(last_resp.ok_or("Request failed")?)
    }

    pub async fn chat_completions(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let url = self.build_url("chat/completions");

        eprintln!("[OPENAI_CUSTOM] chat_completions URL: {url}");
        eprintln!(
            "[OPENAI_CUSTOM] chat_completions base_url: {}",
            self.get_base_url()
        );

        let mut payload = request.clone();
        self.normalize_openai_request_payload(&mut payload);

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        Self::maybe_log_protocol_mismatch_hint(&url, resp.status());

        if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback_url) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback_url != url {
                    let resp2 = self
                        .client
                        .post(&fallback_url)
                        .header("Authorization", format!("Bearer {api_key}"))
                        .header("Content-Type", "application/json")
                        .json(&payload)
                        .send()
                        .await?;
                    Self::maybe_log_protocol_mismatch_hint(&fallback_url, resp2.status());
                    return Ok(resp2);
                }
            }
        }

        Ok(resp)
    }

    pub async fn list_models(&self) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let urls = self.build_urls_with_fallbacks("models");
        let mut tried_urls: Vec<String> = Vec::new();
        let mut resp: Option<reqwest::Response> = None;

        for url in urls {
            eprintln!("[OPENAI_CUSTOM] list_models URL: {url}");
            tried_urls.push(url.clone());
            let r = self
                .client
                .get(&url)
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await?;
            Self::maybe_log_protocol_mismatch_hint(&url, r.status());
            if r.status() != StatusCode::NOT_FOUND {
                resp = Some(r);
                break;
            }
            resp = Some(r);
        }

        let resp = resp.ok_or("Request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("[OPENAI_CUSTOM] list_models 失败: {status} - {body}");
            return Err(format!(
                "Failed to list models: {status} - {body} (tried: {})",
                tried_urls.join(", ")
            )
            .into());
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
impl StreamingProvider for OpenAICustomProvider {
    /// 发起流式 API 调用
    ///
    /// 使用 reqwest 的 bytes_stream 返回字节流，支持真正的端到端流式传输。
    /// OpenAI 使用 OpenAI SSE 格式。
    ///
    /// # 需求覆盖
    /// - 需求 1.3: OpenAICustomProvider 流式支持
    async fn call_api_stream(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<StreamResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref().ok_or_else(|| {
            ProviderError::ConfigurationError("OpenAI API key not configured".to_string())
        })?;

        // 确保请求启用流式
        let mut stream_request = request.clone();
        stream_request.stream = true;
        let mut payload = serde_json::to_value(&stream_request)
            .map_err(|e| ProviderError::ConfigurationError(format!("序列化流式请求失败: {e}")))?;
        self.normalize_openai_request_payload(&mut payload);

        let url = self.build_url("chat/completions");

        tracing::info!(
            "[OPENAI_STREAM] 发起流式请求: url={} model={}",
            url,
            request.model
        );

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .json(&payload)
            .send()
            .await
            .map_err(|e| ProviderError::from_reqwest_error(&e))?;

        let resp = if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback_url) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback_url != url {
                    self.client
                        .post(&fallback_url)
                        .header("Authorization", format!("Bearer {api_key}"))
                        .header("Content-Type", "application/json")
                        .header("Accept", "text/event-stream")
                        .json(&payload)
                        .send()
                        .await
                        .map_err(|e| ProviderError::from_reqwest_error(&e))?
                } else {
                    resp
                }
            } else {
                resp
            }
        } else {
            resp
        };

        // 检查响应状态
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            tracing::error!("[OPENAI_STREAM] 请求失败: {} - {}", status, body);
            return Err(ProviderError::from_http_status(status.as_u16(), &body));
        }

        tracing::info!("[OPENAI_STREAM] 流式响应开始: status={}", status);

        // 将 reqwest 响应转换为 StreamResponse
        Ok(reqwest_stream_to_stream_response(resp))
    }

    fn supports_streaming(&self) -> bool {
        self.is_configured()
    }

    fn provider_name(&self) -> &'static str {
        "OpenAICustomProvider"
    }

    fn stream_format(&self) -> StreamFormat {
        StreamFormat::OpenAiSse
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, http::header, response::IntoResponse, routing::post, Json, Router};
    use futures::StreamExt;
    use proxycast_core::models::openai::{ChatMessage, FunctionDef, MessageContent, Tool};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    async fn start_mock_openai_server(
        captured: Arc<Mutex<Vec<serde_json::Value>>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        async fn handle_chat(
            State(captured): State<Arc<Mutex<Vec<serde_json::Value>>>>,
            Json(payload): Json<serde_json::Value>,
        ) -> impl IntoResponse {
            captured.lock().await.push(payload.clone());

            if payload
                .get("stream")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                (
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"choices\":[]}\n\ndata: [DONE]\n\n",
                )
                    .into_response()
            } else {
                Json(serde_json::json!({
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "choices": [{
                        "index": 0,
                        "message": {"role":"assistant","content":"ok"},
                        "finish_reason": "stop"
                    }],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}
                }))
                .into_response()
            }
        }

        let app = Router::new()
            .route("/v1/chat/completions", post(handle_chat))
            .with_state(captured);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let addr = listener.local_addr().expect("read mock server local addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("mock server should run");
        });
        (format!("http://{}", addr), server)
    }

    fn build_tool_calling_request() -> ChatCompletionRequest {
        ChatCompletionRequest {
            model: "deepseek-chat".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Some(MessageContent::Text("hi".to_string())),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            }],
            temperature: None,
            max_tokens: Some(128),
            top_p: None,
            stream: false,
            tools: Some(vec![Tool::Function {
                function: FunctionDef {
                    name: "search_docs".to_string(),
                    description: Some("Search docs".to_string()),
                    parameters: Some(serde_json::json!({
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x-proxycast": {
                            "input_examples":[{"query":"rust async"}],
                            "allowed_callers":["assistant","code_execution"],
                            "deferred_loading": true
                        }
                    })),
                },
            }]),
            tool_choice: None,
            reasoning_effort: None,
        }
    }

    #[test]
    fn test_normalize_openai_request_payload_injects_fallback_description() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"search_docs",
                    "description":"Search docs",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x-proxycast": {
                            "input_examples":[{"query":"rust async"}],
                            "allowed_callers":["assistant","code_execution"],
                            "deferred_loading":true
                        }
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert!(description.contains("[DeferredLoading]"));
    }

    #[test]
    fn test_normalize_openai_request_payload_supports_x_proxycast_alias() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"search_docs",
                    "description":"Search docs",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x_proxycast": {
                            "inputExamples":[{"query":"tool search"}],
                            "allowedCallers":["tool_search"]
                        }
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default();

        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert!(description.contains("tool_search"));
    }

    #[test]
    fn test_normalize_openai_request_payload_ignores_non_function_tools() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{"type":"web_search_20250305"}]
        });

        provider.normalize_openai_request_payload(&mut payload);

        assert_eq!(
            payload["tools"][0],
            serde_json::json!({"type":"web_search_20250305"})
        );
    }

    #[test]
    fn test_normalize_openai_request_payload_uses_builtin_input_examples_fallback() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"WebSearch",
                    "description":"允许 Claude 搜索网络并使用结果来提供响应。",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"},"limit":{"type":"integer"}},
                        "required":["query"]
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default();

        assert!(description.contains("[InputExamples]"));
    }

    #[tokio::test]
    async fn test_openai_compatible_non_stream_and_stream_both_normalized() {
        if !OpenAICustomProvider::tool_calling_v2_enabled() {
            return;
        }

        let captured = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let (base_url, server_handle) = start_mock_openai_server(captured.clone()).await;
        let mut provider = OpenAICustomProvider::with_config("sk-test".to_string(), Some(base_url));
        provider.client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("build test client without proxy");
        let request = build_tool_calling_request();

        let resp = provider
            .call_api(&request)
            .await
            .expect("non-stream call should succeed");
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            panic!("non-stream call failed: status={status}, body={body}");
        }

        let mut stream = provider
            .call_api_stream(&request)
            .await
            .expect("stream call should succeed");
        let first_chunk = stream
            .next()
            .await
            .expect("stream should return at least one chunk")
            .expect("first stream chunk should be ok");
        let chunk_text = String::from_utf8(first_chunk.to_vec()).expect("chunk should be utf8");
        assert!(chunk_text.contains("data:"));

        let bodies = captured.lock().await;
        assert_eq!(bodies.len(), 2);
        assert_eq!(bodies[1]["stream"], serde_json::json!(true));

        for body in bodies.iter() {
            let description = body["tools"][0]["function"]["description"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            assert!(description.contains("[InputExamples]"));
            assert!(description.contains("[AllowedCallers]"));
            assert!(description.contains("[DeferredLoading]"));
        }

        server_handle.abort();
    }
}
