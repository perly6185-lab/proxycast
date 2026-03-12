# Tauri 命令

## 概述

Tauri 命令是前端与 Rust 后端通信的边界，但前端业务代码**不应直接散落 `invoke`**。

推荐路径是：

`组件 / Hook -> src/lib/api/* 网关 -> safeInvoke -> Rust command`

这样做的目的不是“多包一层”，而是确保：

- 前端只有一个可治理的调用出口
- Rust 命令可以按 `current / compat / deprecated` 分类演进
- 新旧命令并存时，迁移边界清晰，不会继续扩散

## 治理约束

- 新的前端功能，禁止在页面、组件、普通 Hook 中直接调用 `invoke`。
- 新的 Rust 命令，必须同时落一个对应的 `src/lib/api/*` 网关文件或收口到现有网关。
- 旧命令如果暂时不能删，必须明确标记为 `compat` 或 `deprecated`，只允许保兼容，不允许继续长新逻辑。
- 当前端已经迁到新网关后，要继续用 ESLint、脚本或日志告警封住旧入口，避免 AI 回流。

## 当前事实源

- 聊天主命令：`chat_*`
- 旧 `general_chat_*` 前端 compat 网关与 Rust 命令已删除
- 当前剩余治理重点：统计、记忆等旁路仍在读取 `general_chat_*` 历史表

## 治理案例：记忆系统

以当前仓库里的记忆能力为例：

- `unified_memory_*`：现役统一记忆主链路，后续功能优先往这里收
- `memory_runtime_*`：现役 runtime / 上下文记忆主入口
- `memory_get_*` / `memory_toggle_auto`：当前仍在使用的治理配置入口
- `switch_prompt`：旧 prompt 切换命令已移除，统一使用 `enable_prompt`
- `get_legacy_api_key_credentials` 等迁移命令：前端与 Tauri 入口都已移除，避免 UI/AI 再接入历史迁移链路

这类场景下，AI 不应该再做一套“第三套记忆命令”，而应该：

1. 先判断当前需求属于主链路、兼容层，还是治理配置
2. 如果是统一沉淀记忆，优先补到 `unified_memory_*`
3. 如果是 runtime / 上下文记忆视图，优先补到 `memory_runtime_*`
4. 如果存在旧命令又无任何调用，就直接删掉命令注册、桥接和 mock，不要继续保留空兼容壳

同理，对话系统也不应该重新引回已经删除的 `general_chat_*` 命令；
后续如需扩展聊天能力，应继续收敛到 `chat_*` 与对应网关。

## 目录结构

```
src-tauri/src/commands/
├── mod.rs              # 模块入口
├── credential.rs       # 凭证管理命令
├── provider.rs         # Provider 命令
├── server.rs           # 服务器控制命令
├── flow.rs             # 流量监控命令
├── config.rs           # 配置命令
├── mcp.rs              # MCP 服务器命令
└── terminal.rs         # 终端命令
```

## 命令分类

### 凭证管理

```rust
#[tauri::command]
async fn add_credential(
    provider: String,
    file_path: String,
) -> Result<CredentialInfo, String>;

#[tauri::command]
async fn remove_credential(id: String) -> Result<(), String>;

#[tauri::command]
async fn list_credentials() -> Result<Vec<CredentialInfo>, String>;

#[tauri::command]
async fn refresh_credential(id: String) -> Result<(), String>;

#[tauri::command]
async fn get_credential_status(id: String) -> Result<CredentialStatus, String>;
```

### 服务器控制

```rust
#[tauri::command]
async fn start_server(config: ServerConfig) -> Result<(), String>;

#[tauri::command]
async fn stop_server() -> Result<(), String>;

#[tauri::command]
async fn get_server_status() -> Result<ServerStatus, String>;

#[tauri::command]
async fn update_server_config(config: ServerConfig) -> Result<(), String>;
```

### 流量监控

```rust
#[tauri::command]
async fn get_flow_records(query: FlowQuery) -> Result<PagedResult<FlowRecord>, String>;

#[tauri::command]
async fn get_flow_stats(time_range: TimeRange) -> Result<FlowStats, String>;

#[tauri::command]
async fn clear_flow_records(before: Option<i64>) -> Result<u64, String>;
```

## 前端调用

推荐写法不是在业务层直接 `invoke`，而是在 API 网关里集中调用：

```typescript
// src/lib/api/serverRuntime.ts
import { safeInvoke } from "@/lib/dev-bridge";

export async function getServerStatus() {
  return safeInvoke<ServerStatus>("get_server_status");
}
```

业务层只消费 API 网关：

```typescript
import { getServerStatus } from "@/lib/api/serverRuntime";

const status = await getServerStatus();
```

## 错误处理

```rust
// 命令返回 Result<T, String>
// 错误信息会传递到前端

#[tauri::command]
async fn example_command() -> Result<Data, String> {
    do_something()
        .await
        .map_err(|e| e.to_string())
}
```

## 相关文档

- [services.md](services.md) - 业务服务
- [hooks.md](hooks.md) - 前端 Hooks
