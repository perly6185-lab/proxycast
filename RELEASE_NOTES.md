## ProxyCast v0.86.0

### ✨ 新功能

- **Aster 集成升级**: 升级到 aster-rust v0.17.1，带来更稳定的 Agent 运行时支持
- **排队机制**: 新增 Agent 运行时排队系统，支持多轮对话请求的有序处理
- **Artifact 自动预览**: 实现 Artifact 自动预览同步机制，提升内容创作体验
- **搜索结果预览**: 新增搜索结果预览列表组件，优化 Web 搜索交互
- **Skill 脚手架**: 新增 Skill 创建脚手架对话框，简化自定义 Skill 开发流程
- **会话作用域存储**: 实现 Agent 会话级别的状态管理机制

### 🔧 优化与重构

- **Request Tool Policy 重构**: 大幅重构请求工具策略模块（+1176 行），提升 Web 搜索预调用的可靠性
- **Skill 服务增强**: 重构 Skill 加载器和匹配器，优化 Skill 发现和执行流程（+1064 行）
- **API Key Provider 优化**: 增强 API Key 提供商服务，改进凭证池管理（+433 行）
- **Skill Model 完善**: 新增 Skill 模型定义，规范化 Skill 元数据管理（+345 行）
- **Aster State 扩展**: 扩展 Agent 状态管理，支持更复杂的运行时场景（+367 行）
- **数据库 Schema 更新**: 新增 agent_runtime_queue 表，支持排队机制持久化

### 🐛 修复

- **Clippy 警告修复**: 修复多个 Rust clippy 警告，提升代码质量
  - 简化 `let...else` 为 `?` 操作符
  - 合并连续的字符串替换操作
  - 优化字符匹配模式
- **类型安全改进**: 修复前端类型定义，增强 TypeScript 类型检查

### 📦 依赖更新

- 升级 aster-rust 到 v0.17.1
- 更新相关 Rust 依赖包版本

### 🧪 测试

- 新增多个组件单元测试
  - Modal 组件测试
  - SearchResultPreviewList 测试
  - ArtifactRenderer UI 测试
  - SkillScaffoldDialog 测试
  - useArtifactAutoPreviewSync 测试
  - useArtifactDisplayState 测试
  - searchQueryGrouping 测试

### 📝 文档

- 新增设计语言文档 (design-language.md)
- 更新 AGENTS.md，补充跨平台兼容约束和 UI 指导
- 完善 aiprompts 文档索引

### 🛠️ 开发体验

- 新增本地 aster-rust 覆盖脚本 (setup-local-aster-override.mjs)
- 改进 legacy surfaces 报告脚本
- 优化开发工具链配置

---

**完整变更**: v0.85.0...v0.86.0
