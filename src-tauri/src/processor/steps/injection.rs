//! 参数注入步骤
//!
//! 根据配置的规则注入请求参数

use super::traits::{PipelineStep, StepError};
use crate::injection::Injector;
use crate::processor::RequestContext;
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 参数注入步骤
///
/// 根据模型匹配规则注入请求参数
pub struct InjectionStep {
    /// 注入器
    injector: Arc<RwLock<Injector>>,
    /// 是否启用
    enabled: Arc<RwLock<bool>>,
}

impl InjectionStep {
    /// 创建新的注入步骤
    pub fn new(injector: Arc<RwLock<Injector>>) -> Self {
        Self {
            injector,
            enabled: Arc::new(RwLock::new(true)),
        }
    }

    /// 设置是否启用
    pub fn with_enabled(self, enabled: Arc<RwLock<bool>>) -> Self {
        Self { enabled, ..self }
    }

    /// 检查是否启用
    pub async fn is_injection_enabled(&self) -> bool {
        *self.enabled.read().await
    }
}

#[async_trait]
impl PipelineStep for InjectionStep {
    async fn execute(
        &self,
        ctx: &mut RequestContext,
        payload: &mut serde_json::Value,
    ) -> Result<(), StepError> {
        if !self.is_injection_enabled().await {
            return Ok(());
        }

        let injector = self.injector.read().await;
        let result = injector.inject(&ctx.resolved_model, payload);

        if result.has_injections() {
            tracing::info!(
                "[INJECT] request_id={} applied_rules={:?} injected_params={:?}",
                ctx.request_id,
                result.applied_rules,
                result.injected_params
            );

            // 记录注入信息到元数据
            ctx.set_metadata(
                "injection_result",
                serde_json::json!({
                    "applied_rules": result.applied_rules,
                    "injected_params": result.injected_params
                }),
            );
        }

        Ok(())
    }

    fn name(&self) -> &str {
        "injection"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::injection::InjectionRule;

    #[tokio::test]
    async fn test_injection_step_execute() {
        let mut injector = Injector::new();
        injector.add_rule(InjectionRule::new(
            "test-rule",
            "claude-*",
            serde_json::json!({"temperature": 0.7}),
        ));

        let step = InjectionStep::new(Arc::new(RwLock::new(injector)));
        let mut ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        let mut payload = serde_json::json!({"model": "claude-sonnet-4-5"});

        let result = step.execute(&mut ctx, &mut payload).await;
        assert!(result.is_ok());
        assert_eq!(payload["temperature"], 0.7);
    }

    #[tokio::test]
    async fn test_injection_step_disabled() {
        let mut injector = Injector::new();
        injector.add_rule(InjectionRule::new(
            "test-rule",
            "claude-*",
            serde_json::json!({"temperature": 0.7}),
        ));

        let step = InjectionStep::new(Arc::new(RwLock::new(injector)))
            .with_enabled(Arc::new(RwLock::new(false)));
        let mut ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        let mut payload = serde_json::json!({"model": "claude-sonnet-4-5"});

        let result = step.execute(&mut ctx, &mut payload).await;
        assert!(result.is_ok());
        // 参数不应该被注入
        assert!(payload.get("temperature").is_none());
    }
}
