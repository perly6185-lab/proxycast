# Skills 集成模块

本模块实现 aster-rust Skills 系统与 ProxyCast 的集成。

## 模块结构

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `llm_provider.rs` | 桥接层（纯逻辑已迁移到 `crates/skills/src/proxycast_llm_provider.rs`） |
| `execution_callback.rs` | TauriExecutionCallback 实现（保留在主 crate） |

## Skills 集成架构

### AI 自动调用 Skills（标准化后）

ProxyCast 通过以下机制让 AI 能够自动发现和调用 Skills：

1. **Agent 初始化时加载 Skills**
   - `AsterAgentState::init_agent_with_db()` 调用 `load_proxycast_skills()`
   - 技能包以 Agent Skills 标准 `SKILL.md` 为主格式
   - 默认从应用级 Skills 目录加载，并支持项目级 `./.agents/skills`
   - 注册到 aster-rust 的 `global_registry`

2. **SkillTool 自动注册**
   - aster-rust 的 `register_default_tools()` 自动注册 `SkillTool`
   - `SkillTool` 从 `global_registry` 读取可用 Skills
   - AI 可以通过 `Skill` 工具调用任意已注册的 Skill

3. **动态刷新**
   - 安装/卸载 Skills 后调用 `AsterAgentState::reload_proxycast_skills()`
   - 自动更新 `global_registry`，无需重启应用

### 数据流

```
用户安装 Skill
    ↓
skill_cmd.rs::install_skill_for_app()
    ↓
AsterAgentState::reload_proxycast_skills()
    ↓
aster::skills::global_registry 更新
    ↓
AI 通过 SkillTool 发现新 Skill
    ↓
用户对话时 AI 自动调用相关 Skill
```

## 核心组件

### ProxyCastLlmProvider

使用 ProviderPoolService 选择凭证并调用 LLM API。

**功能**：
- 通过 ProviderPoolService 选择可用凭证
- 支持指定 provider 类型和 model 参数
- 智能降级到 API Key Provider

### TauriExecutionCallback

通过 Tauri 事件系统向前端发送 Skill 执行进度更新。

**事件类型**：
- `skill:step_start`: 步骤开始
- `skill:step_complete`: 步骤完成
- `skill:step_error`: 步骤错误
- `skill:complete`: 执行完成

## 依赖关系

```
agent/aster_state.rs
├── load_proxycast_skills()
│   ├── aster::skills::load_skills_from_directory()
│   └── aster::skills::global_registry()
└── reload_proxycast_skills()

skills/
├── llm_provider.rs (桥接)
│   └── crates/skills/src/proxycast_llm_provider.rs
│       ├── ProviderPoolService (凭证池管理)
│       └── ApiKeyProviderService (API Key 服务)
└── execution_callback.rs
    └── tauri::AppHandle (事件发送)

commands/skill_cmd.rs
├── install_skill_for_app()
│   └── AsterAgentState::reload_proxycast_skills()
└── uninstall_skill_for_app()
    └── AsterAgentState::reload_proxycast_skills()
```

## 相关文档

- 设计文档: `.kiro/specs/skills-integration/design.md`
- 需求文档: `.kiro/specs/skills-integration/requirements.md`
- 路线图: `docs/roadmap/proxycast-skills-standardization-roadmap.md`

## 当前标准约定

- Agent Skills 是唯一标准格式
- ProxyCast 私有能力统一写入 `metadata.proxycast_*`
- Workflow 不再推荐使用 `steps-json` 内联，优先通过 `metadata.proxycast_workflow_ref` 指向 `references/` 下文件
- 服务层和执行层共用 `SkillService::inspect_*` inspection 结果作为标准合规事实源，并向前端暴露标准合规状态与资源摘要
- 无效 Skill 仍可在管理页中看到检查结果，但不会进入运行时自动加载和可执行列表
- 管理链路支持创建最小标准 Skill 脚手架，新建结果会立即经过统一 inspection 校验
