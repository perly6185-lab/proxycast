# ProxyCast v0.79.0 Release Notes

## 🎯 主要功能

### Agent 与工具调用增强
- 新增 `request_tool_policy_prompt_service`，统一注入工具请求策略提示词
- 增强 Aster Agent 聊天链路，补齐工具调用偏好与策略处理
- 新增真实联网回归测试（Web Search policy / preflight）

### 内容创作工作流升级
- 新增活动日志能力（`ActivityLog` 组件、Hook、工具函数及测试）
- 新增社媒模板体系（行业分析、产品发布、技术分享、热点话题、视觉内容）
- 新增掘金与知乎平台适配
- 改进海报工作流与文档画布类型系统

### 聊天与工作台体验优化
- 优化 Agent Chat 输入区、空状态、工具入口与状态流转
- 改进 Unified Chat 与通用聊天面板交互
- 调整 Workbench 主内容区/右侧栏结构和导航逻辑

## 🔧 工程改进
- 新增应用版本一致性脚本：
  - `scripts/app-version.mjs`
  - `scripts/check-app-version-consistency.mjs`
- 版本统一升级到 `0.79.0`（`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`）
- 同步更新 Rust 锁文件与多模块实现

## 🐛 修复
- 修复版本解析相关测试用例（`appVersion`）
- 修复部分 Agent/Provider/MCP/Terminal 场景下的兼容与稳定性问题
- 改进 Live Sync 与命令处理链路的健壮性

## 📊 统计
- 89 个文件修改
- +6642 行新增代码
- -859 行删除代码

## 🔗 依赖更新
- Aster 依赖保持 `v0.16.0`
- 同步更新 `Cargo.lock`

---

**完整变更**: v0.78.0...v0.79.0
