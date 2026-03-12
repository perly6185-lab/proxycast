//! 控制器注册表
//!
//! 管理所有块控制器的注册和查找。
//!
//! ## 功能
//! - 按 block_id 注册控制器
//! - 按 block_id 查找控制器
//! - 删除控制器
//! - 列出所有控制器
//!
//! ## Requirements
//! - 1.6: 维护控制器注册表，支持按 block_id 查找控制器

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::traits::BlockController;

/// 控制器注册表
///
/// 使用 HashMap + RwLock 实现线程安全的控制器管理。
pub struct ControllerRegistry {
    /// 控制器映射表: block_id -> BlockController
    #[allow(clippy::type_complexity)]
    controllers: RwLock<HashMap<String, Arc<RwLock<Box<dyn BlockController>>>>>,
}

impl Default for ControllerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ControllerRegistry {
    /// 创建新的控制器注册表
    pub fn new() -> Self {
        Self {
            controllers: RwLock::new(HashMap::new()),
        }
    }

    /// 注册控制器
    ///
    /// # 参数
    /// - `block_id`: 块 ID
    /// - `controller`: 控制器实例
    ///
    /// # 返回
    /// 如果已存在同 block_id 的控制器，返回旧控制器
    pub async fn register(
        &self,
        block_id: String,
        controller: Box<dyn BlockController>,
    ) -> Option<Arc<RwLock<Box<dyn BlockController>>>> {
        let mut controllers = self.controllers.write().await;
        controllers.insert(block_id, Arc::new(RwLock::new(controller)))
    }

    /// 获取控制器
    ///
    /// # 参数
    /// - `block_id`: 块 ID
    ///
    /// # 返回
    /// 如果存在返回控制器的 Arc 引用，否则返回 None
    pub async fn get(&self, block_id: &str) -> Option<Arc<RwLock<Box<dyn BlockController>>>> {
        let controllers = self.controllers.read().await;
        controllers.get(block_id).cloned()
    }

    /// 删除控制器
    ///
    /// # 参数
    /// - `block_id`: 块 ID
    ///
    /// # 返回
    /// 如果存在返回被删除的控制器，否则返回 None
    pub async fn remove(&self, block_id: &str) -> Option<Arc<RwLock<Box<dyn BlockController>>>> {
        let mut controllers = self.controllers.write().await;
        controllers.remove(block_id)
    }

    /// 检查控制器是否存在
    ///
    /// # 参数
    /// - `block_id`: 块 ID
    ///
    /// # 返回
    /// 存在返回 true，否则返回 false
    pub async fn contains(&self, block_id: &str) -> bool {
        let controllers = self.controllers.read().await;
        controllers.contains_key(block_id)
    }

    /// 获取所有块 ID
    ///
    /// # 返回
    /// 所有已注册的块 ID 列表
    pub async fn list_block_ids(&self) -> Vec<String> {
        let controllers = self.controllers.read().await;
        controllers.keys().cloned().collect()
    }

    /// 获取控制器数量
    ///
    /// # 返回
    /// 已注册的控制器数量
    pub async fn len(&self) -> usize {
        let controllers = self.controllers.read().await;
        controllers.len()
    }

    /// 检查注册表是否为空
    ///
    /// # 返回
    /// 为空返回 true，否则返回 false
    pub async fn is_empty(&self) -> bool {
        let controllers = self.controllers.read().await;
        controllers.is_empty()
    }

    /// 清空所有控制器
    pub async fn clear(&self) {
        let mut controllers = self.controllers.write().await;
        controllers.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block_controller::traits::{
        BlockControllerRuntimeStatus, BlockInputUnion, BlockMeta, RuntimeOpts,
    };
    use crate::error::TerminalError;
    use async_trait::async_trait;

    /// 测试用的 Mock 控制器
    struct MockController {
        block_id: String,
        controller_type: String,
    }

    impl MockController {
        fn new(block_id: &str, controller_type: &str) -> Self {
            Self {
                block_id: block_id.to_string(),
                controller_type: controller_type.to_string(),
            }
        }
    }

    #[async_trait]
    impl BlockController for MockController {
        async fn start(
            &mut self,
            _block_meta: BlockMeta,
            _rt_opts: Option<RuntimeOpts>,
            _force: bool,
        ) -> Result<(), TerminalError> {
            Ok(())
        }

        async fn stop(
            &mut self,
            _graceful: bool,
            _new_status: String,
        ) -> Result<(), TerminalError> {
            Ok(())
        }

        fn get_runtime_status(&self) -> BlockControllerRuntimeStatus {
            BlockControllerRuntimeStatus::new(self.block_id.clone())
        }

        async fn send_input(&self, _input: &BlockInputUnion) -> Result<(), TerminalError> {
            Ok(())
        }

        fn controller_type(&self) -> &str {
            &self.controller_type
        }
    }

    #[tokio::test]
    async fn test_registry_register_and_get() {
        let registry = ControllerRegistry::new();
        let controller = MockController::new("block-1", "shell");

        // 注册控制器
        let old = registry
            .register("block-1".to_string(), Box::new(controller))
            .await;
        assert!(old.is_none());

        // 获取控制器
        let ctrl = registry.get("block-1").await;
        assert!(ctrl.is_some());

        // 验证控制器类型
        let ctrl = ctrl.unwrap();
        let ctrl_guard = ctrl.read().await;
        assert_eq!(ctrl_guard.controller_type(), "shell");
    }

    #[tokio::test]
    async fn test_registry_remove() {
        let registry = ControllerRegistry::new();
        let controller = MockController::new("block-2", "cmd");

        registry
            .register("block-2".to_string(), Box::new(controller))
            .await;
        assert!(registry.contains("block-2").await);

        // 删除控制器
        let removed = registry.remove("block-2").await;
        assert!(removed.is_some());
        assert!(!registry.contains("block-2").await);

        // 再次删除应返回 None
        let removed_again = registry.remove("block-2").await;
        assert!(removed_again.is_none());
    }

    #[tokio::test]
    async fn test_registry_list_and_len() {
        let registry = ControllerRegistry::new();

        assert!(registry.is_empty().await);
        assert_eq!(registry.len().await, 0);

        registry
            .register(
                "block-a".to_string(),
                Box::new(MockController::new("block-a", "shell")),
            )
            .await;
        registry
            .register(
                "block-b".to_string(),
                Box::new(MockController::new("block-b", "cmd")),
            )
            .await;

        assert!(!registry.is_empty().await);
        assert_eq!(registry.len().await, 2);

        let ids = registry.list_block_ids().await;
        assert!(ids.contains(&"block-a".to_string()));
        assert!(ids.contains(&"block-b".to_string()));
    }

    #[tokio::test]
    async fn test_registry_clear() {
        let registry = ControllerRegistry::new();

        registry
            .register(
                "block-x".to_string(),
                Box::new(MockController::new("block-x", "shell")),
            )
            .await;
        registry
            .register(
                "block-y".to_string(),
                Box::new(MockController::new("block-y", "shell")),
            )
            .await;

        assert_eq!(registry.len().await, 2);

        registry.clear().await;

        assert!(registry.is_empty().await);
        assert_eq!(registry.len().await, 0);
    }

    #[tokio::test]
    async fn test_registry_replace_controller() {
        let registry = ControllerRegistry::new();

        // 注册第一个控制器
        let ctrl1 = MockController::new("block-z", "shell");
        registry
            .register("block-z".to_string(), Box::new(ctrl1))
            .await;

        // 验证类型
        {
            let ctrl = registry.get("block-z").await.unwrap();
            let guard = ctrl.read().await;
            assert_eq!(guard.controller_type(), "shell");
        }

        // 替换为新控制器
        let ctrl2 = MockController::new("block-z", "cmd");
        let old = registry
            .register("block-z".to_string(), Box::new(ctrl2))
            .await;
        assert!(old.is_some());

        // 验证新类型
        {
            let ctrl = registry.get("block-z").await.unwrap();
            let guard = ctrl.read().await;
            assert_eq!(guard.controller_type(), "cmd");
        }
    }
}
