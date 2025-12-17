//! 插件钩子步骤
//!
//! 执行插件的前置和后置钩子

use super::traits::{PipelineStep, StepError};
use crate::plugin::PluginManager;
use crate::processor::RequestContext;
use crate::ProviderType;
use async_trait::async_trait;
use std::sync::Arc;

/// 插件前置钩子步骤
///
/// 在 Provider 调用前执行所有启用插件的 on_request 钩子
pub struct PluginPreStep {
    /// 插件管理器
    plugins: Arc<PluginManager>,
}

impl PluginPreStep {
    /// 创建新的插件前置步骤
    pub fn new(plugins: Arc<PluginManager>) -> Self {
        Self { plugins }
    }
}

#[async_trait]
impl PipelineStep for PluginPreStep {
    async fn execute(
        &self,
        ctx: &mut RequestContext,
        payload: &mut serde_json::Value,
    ) -> Result<(), StepError> {
        // 初始化插件上下文
        let provider = ctx.provider.unwrap_or(ProviderType::Kiro);
        ctx.init_plugin_context(provider);

        // 获取插件上下文的可变引用
        if let Some(plugin_ctx) = ctx.plugin_context_mut() {
            let results = self.plugins.run_on_request(plugin_ctx, payload).await;

            // 检查是否有失败的钩子
            for result in &results {
                if !result.success {
                    tracing::warn!("[PLUGIN] on_request hook failed: {:?}", result.error);
                    // 插件失败不阻止请求继续，只记录警告
                }
            }

            // 记录插件执行结果到元数据
            ctx.set_metadata(
                "plugin_pre_results",
                serde_json::json!(results
                    .iter()
                    .map(|r| serde_json::json!({
                        "success": r.success,
                        "modified": r.modified,
                        "duration_ms": r.duration_ms
                    }))
                    .collect::<Vec<_>>()),
            );
        }

        Ok(())
    }

    fn name(&self) -> &str {
        "plugin_pre"
    }
}

/// 插件后置钩子步骤
///
/// 在 Provider 调用后执行所有启用插件的 on_response 钩子
pub struct PluginPostStep {
    /// 插件管理器
    plugins: Arc<PluginManager>,
}

impl PluginPostStep {
    /// 创建新的插件后置步骤
    pub fn new(plugins: Arc<PluginManager>) -> Self {
        Self { plugins }
    }

    /// 执行错误钩子
    pub async fn run_on_error(&self, ctx: &mut RequestContext, error: &str) {
        if let Some(plugin_ctx) = ctx.plugin_context_mut() {
            let results = self.plugins.run_on_error(plugin_ctx, error).await;

            for result in &results {
                if !result.success {
                    tracing::warn!("[PLUGIN] on_error hook failed: {:?}", result.error);
                }
            }
        }
    }
}

#[async_trait]
impl PipelineStep for PluginPostStep {
    async fn execute(
        &self,
        ctx: &mut RequestContext,
        payload: &mut serde_json::Value,
    ) -> Result<(), StepError> {
        if let Some(plugin_ctx) = ctx.plugin_context_mut() {
            let results = self.plugins.run_on_response(plugin_ctx, payload).await;

            // 检查是否有失败的钩子
            for result in &results {
                if !result.success {
                    tracing::warn!("[PLUGIN] on_response hook failed: {:?}", result.error);
                }
            }

            // 记录插件执行结果到元数据
            ctx.set_metadata(
                "plugin_post_results",
                serde_json::json!(results
                    .iter()
                    .map(|r| serde_json::json!({
                        "success": r.success,
                        "modified": r.modified,
                        "duration_ms": r.duration_ms
                    }))
                    .collect::<Vec<_>>()),
            );
        }

        Ok(())
    }

    fn name(&self) -> &str {
        "plugin_post"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_plugin_pre_step_execute() {
        let plugins = Arc::new(PluginManager::with_defaults());
        let step = PluginPreStep::new(plugins);

        let mut ctx = RequestContext::new("model".to_string());
        ctx.set_provider(ProviderType::Kiro);
        let mut payload = serde_json::json!({"model": "model"});

        let result = step.execute(&mut ctx, &mut payload).await;
        assert!(result.is_ok());
        assert!(ctx.plugin_ctx.is_some());
    }

    #[tokio::test]
    async fn test_plugin_post_step_execute() {
        let plugins = Arc::new(PluginManager::with_defaults());
        let step = PluginPostStep::new(plugins);

        let mut ctx = RequestContext::new("model".to_string());
        ctx.set_provider(ProviderType::Kiro);
        ctx.init_plugin_context(ProviderType::Kiro);
        let mut payload = serde_json::json!({"response": "test"});

        let result = step.execute(&mut ctx, &mut payload).await;
        assert!(result.is_ok());
    }
}
