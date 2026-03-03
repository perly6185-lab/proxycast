# ProxyCast v0.78.0 Release Notes

## 🎯 主要功能

### Tool Calling 2.0
- 新增 Tool Calling 2.0 配置系统，支持统一控制编程式工具调用
- 支持动态过滤功能，优先过滤网页抓取噪音
- 支持原生 input_examples 透传
- 在实验性设置中新增 Tool Calling 配置面板

### 联网搜索增强
- 新增多种联网搜索提供商支持：
  - Tavily Search API
  - Multi Search Engine v2.0.1（支持 12+ 搜索引擎）
  - DuckDuckGo Instant Answer API（无需 API Key，默认启用）
  - Bing Search API
  - Google Custom Search API
- Multi Search Engine 支持自定义引擎优先级和启用/禁用控制
- 新增 Web Search Runtime Service 用于运行时搜索能力

### MCP 工具增强
- 改进 MCP 工具管理器，支持更灵活的工具转换
- 新增 MCP 工具类型定义和转换逻辑
- 优化 MCP 命令接口

### Provider 增强
- Claude Custom Provider 支持更丰富的工具调用配置
- OpenAI Custom Provider 增强工具调用能力
- 改进 Provider Calls 处理逻辑

## 🔧 改进

### Agent 系统
- 改进 Aster Agent 状态管理
- 优化事件转换器逻辑
- 增强 Agent 命令接口（新增 643 行代码）
- 改进 Unified Chat 命令处理

### UI/UX
- 优化 Agent Chat 界面
  - 改进空状态显示
  - 优化角色提及（Character Mention）组件
  - 改进输入栏交互
  - 优化流式渲染和工具调用显示
- 改进实验性设置界面布局
- 优化 Web Search 设置界面，支持多提供商配置

### 配置系统
- 新增 `tool_calling` 配置项到核心配置
- 新增 `WebSearchProvider` 枚举类型
- 新增 `MultiSearchEngineEntryConfig` 和 `MultiSearchConfig` 配置类型
- 改进配置测试覆盖

## 🐛 修复
- 修复版本号测试用例（0.77.0 → 0.78.0）
- 改进 Tauri Mock 核心逻辑
- 优化 API Server 页面

## 📊 统计
- 46 个文件修改
- +3622 行新增代码
- -323 行删除代码

## 🔗 依赖更新
- 更新 Aster 依赖到 v0.16.0（通过 git tag）
- 更新 Cargo.lock 依赖

---

**完整变更**: v0.77.0...v0.78.0
