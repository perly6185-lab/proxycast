//! 统计记录步骤
//!
//! 记录请求统计和 Token 使用

use super::traits::{PipelineStep, StepError};
use crate::processor::RequestContext;
use crate::telemetry::{
    RequestLog, RequestStatus, StatsAggregator, TokenSource, TokenTracker, TokenUsageRecord,
};
use crate::ProviderType;
use async_trait::async_trait;
use parking_lot::RwLock;
use std::sync::Arc;

/// 统计记录步骤
///
/// 记录请求统计和 Token 使用信息
pub struct TelemetryStep {
    /// 统计聚合器（使用 parking_lot::RwLock 以支持与 TelemetryState 共享）
    stats: Arc<RwLock<StatsAggregator>>,
    /// Token 追踪器（使用 parking_lot::RwLock 以支持与 TelemetryState 共享）
    tokens: Arc<RwLock<TokenTracker>>,
}

impl TelemetryStep {
    /// 创建新的统计记录步骤
    pub fn new(stats: Arc<RwLock<StatsAggregator>>, tokens: Arc<RwLock<TokenTracker>>) -> Self {
        Self { stats, tokens }
    }

    /// 记录请求日志
    ///
    /// 请求完成后记录统计，按 Provider 和模型分组
    /// _需求: 4.1_
    pub fn record_request(
        &self,
        ctx: &RequestContext,
        status: RequestStatus,
        error_message: Option<String>,
    ) {
        let provider = ctx.provider.unwrap_or(ProviderType::Kiro);
        let mut log = RequestLog::new(
            ctx.request_id.clone(),
            provider,
            ctx.resolved_model.clone(),
            ctx.is_stream,
        );

        // 设置状态和持续时间
        match status {
            RequestStatus::Success => log.mark_success(ctx.elapsed_ms(), 200),
            RequestStatus::Failed => {
                log.mark_failed(ctx.elapsed_ms(), None, error_message.unwrap_or_default())
            }
            RequestStatus::Timeout => log.mark_timeout(ctx.elapsed_ms()),
            RequestStatus::Cancelled => log.mark_cancelled(ctx.elapsed_ms()),
            RequestStatus::Retrying => {
                log.duration_ms = ctx.elapsed_ms();
            }
        }

        // 设置凭证 ID
        if let Some(cred_id) = &ctx.credential_id {
            log.set_credential_id(cred_id.clone());
        }

        // 设置重试次数
        log.retry_count = ctx.retry_count;

        // 使用 parking_lot::RwLock 的同步写锁
        let stats = self.stats.write();
        stats.record(log);
    }

    /// 记录 Token 使用
    ///
    /// 从响应提取 Token 数，无 Token 时使用估算
    /// _需求: 4.2, 4.3_
    pub fn record_tokens(
        &self,
        ctx: &RequestContext,
        input_tokens: Option<u32>,
        output_tokens: Option<u32>,
        source: TokenSource,
    ) {
        let provider = ctx.provider.unwrap_or(ProviderType::Kiro);

        // 只有当至少有一个 Token 值时才记录
        if input_tokens.is_some() || output_tokens.is_some() {
            let record = TokenUsageRecord::new(
                uuid::Uuid::new_v4().to_string(),
                provider,
                ctx.resolved_model.clone(),
                input_tokens.unwrap_or(0),
                output_tokens.unwrap_or(0),
                source,
            )
            .with_request_id(ctx.request_id.clone());

            // 使用 parking_lot::RwLock 的同步写锁
            let tokens = self.tokens.write();
            tokens.record(record);
        }
    }

    /// 从响应中提取并记录 Token 使用
    ///
    /// 支持 OpenAI 和 Anthropic 两种响应格式
    pub fn record_tokens_from_response(&self, ctx: &RequestContext, response: &serde_json::Value) {
        // 尝试从 OpenAI 格式响应中提取 Token
        if let Some(usage) = response.get("usage") {
            let input_tokens = usage
                .get("prompt_tokens")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let output_tokens = usage
                .get("completion_tokens")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);

            if input_tokens.is_some() || output_tokens.is_some() {
                self.record_tokens(ctx, input_tokens, output_tokens, TokenSource::Actual);
                return;
            }
        }

        // 尝试从 Anthropic 格式响应中提取 Token
        if let Some(usage) = response.get("usage") {
            let input_tokens = usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let output_tokens = usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);

            if input_tokens.is_some() || output_tokens.is_some() {
                self.record_tokens(ctx, input_tokens, output_tokens, TokenSource::Actual);
            }
        }
    }
}

#[async_trait]
impl PipelineStep for TelemetryStep {
    async fn execute(
        &self,
        ctx: &mut RequestContext,
        payload: &mut serde_json::Value,
    ) -> Result<(), StepError> {
        // 记录成功的请求（同步方法，使用 parking_lot::RwLock）
        self.record_request(ctx, RequestStatus::Success, None);

        // 从响应中提取并记录 Token（同步方法）
        self.record_tokens_from_response(ctx, payload);

        tracing::info!(
            "[TELEMETRY] request_id={} provider={:?} model={} duration_ms={}",
            ctx.request_id,
            ctx.provider,
            ctx.resolved_model,
            ctx.elapsed_ms()
        );

        Ok(())
    }

    fn name(&self) -> &str {
        "telemetry"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telemetry_step_record_request() {
        let stats = Arc::new(RwLock::new(StatsAggregator::with_defaults()));
        let tokens = Arc::new(RwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats.clone(), tokens);

        let ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        step.record_request(&ctx, RequestStatus::Success, None);

        let stats_guard = stats.read();
        assert_eq!(stats_guard.len(), 1);
    }

    #[test]
    fn test_telemetry_step_record_tokens() {
        let stats = Arc::new(RwLock::new(StatsAggregator::with_defaults()));
        let tokens = Arc::new(RwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats, tokens.clone());

        let ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        step.record_tokens(&ctx, Some(100), Some(50), TokenSource::Actual);

        let tokens_guard = tokens.read();
        assert_eq!(tokens_guard.len(), 1);
    }

    #[test]
    fn test_telemetry_step_record_tokens_from_response() {
        let stats = Arc::new(RwLock::new(StatsAggregator::with_defaults()));
        let tokens = Arc::new(RwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats, tokens.clone());

        let ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        let response = serde_json::json!({
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50
            }
        });

        step.record_tokens_from_response(&ctx, &response);

        let tokens_guard = tokens.read();
        assert_eq!(tokens_guard.len(), 1);
    }

    #[tokio::test]
    async fn test_telemetry_step_execute() {
        let stats = Arc::new(RwLock::new(StatsAggregator::with_defaults()));
        let tokens = Arc::new(RwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats.clone(), tokens.clone());

        let mut ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        let mut payload = serde_json::json!({
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50
            }
        });

        let result = step.execute(&mut ctx, &mut payload).await;
        assert!(result.is_ok());

        let stats_guard = stats.read();
        assert_eq!(stats_guard.len(), 1);

        let tokens_guard = tokens.read();
        assert_eq!(tokens_guard.len(), 1);
    }
}
