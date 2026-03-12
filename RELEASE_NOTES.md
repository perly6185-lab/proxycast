## ProxyCast v0.85.0

### ✨ 新功能
- 集成 AI 摘要到 SessionContextService，实现上下文智能管理 (621ab3ee)
- 新增 AI 摘要服务，用于上下文管理的 P0 阶段 1 实现 (75309bd2)
- 新增 Agent Timeline 服务，支持时间线视图
- 新增 Chat History 服务，统一聊天历史管理
- 新增多个 Agent 聊天相关组件（AgentPlanBlock、AgentRuntimeStrip、AgentThreadTimeline、SocialMediaHarnessCard）
- 新增社交媒体 Harness 工具集成

### 🔧 优化与重构
- 移除 general-chat 相关的遗留代码和组件，完成向统一 Agent 系统的迁移
- 清理 compat 兼容层代码（agentCompat、generalChatCompat）
- 重构数据库迁移结构，新增 migration_support 和 startup_migrations
- 优化 Agent 聊天 Hooks 架构，拆分为多个专职模块（agentChatActionState、agentChatCoreUtils、agentChatHistory 等）
- 完善测试覆盖率，新增 40+ 单元测试文件
- 优化 Artifact 渲染器，新增 DocumentRenderer
- 优化内容创作工作流，新增社交媒体 Harness 测试

### 📦 其他
- 更新多个 AI 提示词文档
- 新增 report-legacy-surfaces.mjs 脚本
- 更新 ESLint 配置

---

**完整变更**: v0.84.0...v0.85.0
