//! 凭证池管理模块
//!
//! 提供多凭证管理、负载均衡和健康检查功能

mod balancer;
mod health;
mod pool;
mod sync;
mod types;

pub use balancer::{BalanceStrategy, CooldownInfo, LoadBalancer};
pub use health::{HealthCheckConfig, HealthCheckResult, HealthChecker, HealthStatus};
pub use pool::{CredentialPool, PoolError, PoolStatus};
pub use sync::{CredentialSyncService, SyncError};
pub use types::{Credential, CredentialData, CredentialStats, CredentialStatus};

#[cfg(test)]
mod tests;
