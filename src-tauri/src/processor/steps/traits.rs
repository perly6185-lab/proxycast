//! 管道步骤 trait 定义
//!
//! 定义所有管道步骤必须实现的接口

use crate::processor::RequestContext;
use async_trait::async_trait;
use thiserror::Error;

/// 步骤错误
#[derive(Error, Debug, Clone)]
pub enum StepError {
    /// 认证错误
    #[error("认证错误: {0}")]
    Auth(String),

    /// 路由错误
    #[error("路由错误: {0}")]
    Routing(String),

    /// 注入错误
    #[error("注入错误: {0}")]
    Injection(String),

    /// Provider 错误
    #[error("Provider 错误: {0}")]
    Provider(String),

    /// 插件错误
    #[error("插件错误: {plugin_name} - {message}")]
    Plugin {
        plugin_name: String,
        message: String,
    },

    /// 遥测错误
    #[error("遥测错误: {0}")]
    Telemetry(String),

    /// 超时错误
    #[error("超时: {timeout_ms}ms")]
    Timeout { timeout_ms: u64 },

    /// 内部错误
    #[error("内部错误: {0}")]
    Internal(String),
}

impl StepError {
    /// 获取对应的 HTTP 状态码
    pub fn status_code(&self) -> u16 {
        match self {
            StepError::Auth(_) => 401,
            StepError::Routing(_) => 404,
            StepError::Injection(_) => 400,
            StepError::Provider(_) => 502,
            StepError::Plugin { .. } => 500,
            StepError::Telemetry(_) => 500,
            StepError::Timeout { .. } => 408,
            StepError::Internal(_) => 500,
        }
    }
}

/// 管道步骤 trait
///
/// 所有管道步骤必须实现此 trait
#[async_trait]
pub trait PipelineStep: Send + Sync {
    /// 执行步骤
    ///
    /// # Arguments
    /// * `ctx` - 请求上下文
    /// * `payload` - 请求/响应负载
    ///
    /// # Returns
    /// 成功返回 `Ok(())`，失败返回 `Err(StepError)`
    async fn execute(
        &self,
        ctx: &mut RequestContext,
        payload: &mut serde_json::Value,
    ) -> Result<(), StepError>;

    /// 获取步骤名称
    fn name(&self) -> &str;

    /// 检查步骤是否启用
    fn is_enabled(&self) -> bool {
        true
    }
}
