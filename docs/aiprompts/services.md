# 业务服务

## 概述

业务服务层封装核心业务逻辑，被 Tauri 命令调用。

## 目录结构

```
src-tauri/src/services/
├── mod.rs                      # 模块入口
├── provider_pool_service.rs    # 凭证池服务
├── token_cache_service.rs      # Token 缓存
├── mcp_service.rs              # MCP 服务器管理
├── prompt_service.rs           # Prompt 管理
├── skill_service.rs            # 技能管理
├── usage_service.rs            # 使用量统计
├── backup_service.rs           # 备份服务
├── update_check_service.rs     # 自动更新检查
```

## 核心服务

> 注意：`general_chat/` 兼容壳已删除。
> 新功能与新治理都应直接落到 unified chat / `chat_*` 体系，不要重新引回旧入口。
> `ProviderPoolService::select_credential_with_fallback_legacy` 也已删除，凭证选择统一走现役 `select_credential_with_fallback`。

### ProviderPoolService

```rust
pub struct ProviderPoolService {
    pools: HashMap<ProviderType, CredentialPool>,
    health_checker: HealthChecker,
}

impl ProviderPoolService {
    /// 获取下一个可用凭证
    pub async fn next_credential(&self, provider: ProviderType) -> Option<Credential>;
    
    /// 添加凭证到池
    pub async fn add_credential(&self, credential: Credential) -> Result<()>;
    
    /// 移除凭证
    pub async fn remove_credential(&self, id: &str) -> Result<()>;
    
    /// 启动健康检查
    pub fn start_health_check(&self);
}
```

### TokenCacheService

```rust
pub struct TokenCacheService {
    cache: DashMap<String, CachedToken>,
    db: Arc<Database>,
}

impl TokenCacheService {
    /// 获取或刷新 Token
    pub async fn get_or_refresh(&self, credential_id: &str) -> Result<String>;
    
    /// 使 Token 失效
    pub async fn invalidate(&self, credential_id: &str);
}
```

### McpService

```rust
pub struct McpService {
    servers: HashMap<String, McpServer>,
}

impl McpService {
    /// 启动 MCP 服务器
    pub async fn start_server(&self, config: McpConfig) -> Result<()>;
    
    /// 停止 MCP 服务器
    pub async fn stop_server(&self, name: &str) -> Result<()>;
    
    /// 列出工具
    pub async fn list_tools(&self, server: &str) -> Result<Vec<Tool>>;
}
```

## 服务注入

```rust
// 在 main.rs 中初始化
let pool_service = Arc::new(ProviderPoolService::new());
let token_cache = Arc::new(TokenCacheService::new(db.clone()));

app.manage(pool_service);
app.manage(token_cache);

// 在命令中使用
#[tauri::command]
async fn add_credential(
    pool: State<'_, Arc<ProviderPoolService>>,
    // ...
) -> Result<(), String> {
    pool.add_credential(credential).await
}
```

## 相关文档

- [commands.md](commands.md) - Tauri 命令
- [credential-pool.md](credential-pool.md) - 凭证池管理
