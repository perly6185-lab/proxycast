//! 命令分发器
//!
//! 将 HTTP 请求路由到现有的 Tauri 命令函数。

use proxycast_server::AppState;
use proxycast_server_utils::load_model_registry_provider_ids_from_resources;
use serde_json::Value as JsonValue;

fn load_model_registry_provider_ids_from_db(
    state: &AppState,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let Some(db) = &state.db else {
        return Ok(vec![]);
    };

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT provider_id FROM model_registry WHERE provider_id IS NOT NULL ORDER BY provider_id",
    )?;

    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut provider_ids = Vec::new();
    for row in rows {
        provider_ids.push(row?);
    }

    Ok(provider_ids)
}

/// 处理 HTTP 桥接命令请求
///
/// 将命令名和参数分发到对应的命令处理函数
pub async fn handle_command(
    state: &AppState,
    cmd: &str,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    match cmd {
        // ========== P0 - 核心配置 ==========
        "get_config" => {
            // 从配置文件读取
            let config_path = proxycast_core::config::ConfigManager::default_config_path();
            let manager = proxycast_core::config::ConfigManager::load(&config_path)?;
            let config = manager.config();
            Ok(serde_json::to_value(config)?)
        }

        "save_config" => {
            // 保存配置到文件
            let config: proxycast_core::config::Config = serde_json::from_value(args.unwrap_or_default())?;
            proxycast_core::config::save_config(&config)?;
            Ok(serde_json::json!({ "success": true }))
        }

        "get_default_provider" => {
            let provider = state.default_provider.read().await.clone();
            // 直接返回字符串值，不是对象
            Ok(serde_json::json!(provider))
        }

        "get_endpoint_providers" => {
            let providers = state.endpoint_providers.read().await;
            Ok(serde_json::to_value(&*providers)?)
        }

        // ========== P0 - 服务器状态 ==========
        "get_server_status" => {
            // 解析 base_url 获取 host 和 port
            let url_parts: Vec<&str> = state.base_url.split(':').collect();
            let host = url_parts.get(2).unwrap_or(&"127.0.0.1");
            let port = url_parts.get(3).and_then(|p| p.parse::<u16>().ok()).unwrap_or(3030);

            let status = serde_json::json!({
                "running": true,  // HTTP 桥接可用说明服务器在运行
                "host": host,
                "port": port,
                "api_key": "***",  // 不暴露真实 API key
            });
            Ok(status)
        }

        "get_server_diagnostics" => {
            let (host, port) = if let Ok(url) = reqwest::Url::parse(&state.base_url) {
                (
                    url.host_str().unwrap_or("127.0.0.1").to_string(),
                    url.port_or_known_default().unwrap_or(3030),
                )
            } else {
                ("127.0.0.1".to_string(), 3030)
            };

            let telemetry_summary = state.processor.stats.read().summary(None);
            let diagnostics = proxycast_server::build_server_diagnostics(
                true,
                host,
                port,
                telemetry_summary,
                state.capability_routing_metrics_store.snapshot(),
                state.response_cache_store.as_ref(),
                state.request_dedup_store.as_ref(),
                state.idempotency_store.as_ref(),
            );
            Ok(serde_json::to_value(diagnostics)?)
        }

        // ========== P1 - 日志相关 ==========
        "get_logs" => {
            let logs = state.logs.read().await;
            let entries = logs.get_logs();
            // 限制返回最近 100 条
            let limit = entries.len().min(100);
            let recent: Vec<_> = entries.into_iter().rev().take(limit).map(|e| serde_json::json!({
                "timestamp": e.timestamp,
                "level": e.level,
                "message": e.message,
            })).collect();
            Ok(serde_json::to_value(recent)?)
        }

        "get_persisted_logs_tail" => {
            let requested = args
                .as_ref()
                .and_then(|value| value.get("lines"))
                .and_then(|value| value.as_u64())
                .map(|value| value as usize)
                .unwrap_or(200)
                .clamp(20, 1000);

            let logs = state.logs.read().await;
            let entries = logs.get_logs();
            let limit = entries.len().min(requested);
            let recent: Vec<_> = entries
                .into_iter()
                .rev()
                .take(limit)
                .map(|e| {
                    serde_json::json!({
                        "timestamp": e.timestamp,
                        "level": e.level,
                        "message": e.message,
                    })
                })
                .collect();
            Ok(serde_json::to_value(recent)?)
        }

        "clear_logs" => {
            state.logs.write().await.clear();
            Ok(serde_json::json!({ "success": true }))
        }

        // ========== Provider Pool ==========
        "get_provider_pool_overview" => {
            // 从数据库获取凭证池概览
            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| e.to_string())?;
                let credentials = crate::database::dao::provider_pool::ProviderPoolDao::get_all(&conn)
                    .unwrap_or_default();

                let overview: Vec<JsonValue> = credentials
                    .into_iter()
                    .map(|cred| serde_json::json!({
                        "uuid": cred.uuid,
                        "name": cred.name,
                        "provider_type": cred.provider_type,
                        "enabled": true,
                    }))
                    .collect();
                Ok(serde_json::to_value(overview)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_api_key_providers" => {
            // 从 API Key Provider 服务获取
            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| e.to_string())?;
                let providers = crate::database::dao::api_key_provider::ApiKeyProviderDao::get_all_providers(&conn)
                    .unwrap_or_default();
                Ok(serde_json::to_value(providers)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_system_provider_catalog" => {
            let catalog = crate::commands::api_key_provider_cmd::get_system_provider_catalog()
                .map_err(|e| format!("获取系统 Provider Catalog 失败: {e}"))?;
            Ok(serde_json::to_value(catalog)?)
        }

        "get_provider_pool_credentials" => {
            // 获取所有凭证详细信息
            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| e.to_string())?;
                let credentials = crate::database::dao::provider_pool::ProviderPoolDao::get_all(&conn)
                    .unwrap_or_default();
                Ok(serde_json::to_value(credentials)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "test_api" => {
            // 测试 API 连接
            // 从 args 获取 provider
            let args = args.ok_or("缺少参数")?;
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .ok_or("缺少 provider 参数")?;

            // 选择凭证
            let credential = if let Some(db) = &state.db {
                state
                    .pool_service
                    .select_credential(db, provider, None)
                    .ok()
                    .flatten()
            } else {
                None
            };

            match credential {
                Some(cred) => {
                    state
                        .logs
                        .write()
                        .await
                        .add("info", &format!("[DevBridge] 测试 API 使用凭证: {:?}", cred.name));

                    Ok(serde_json::json!({
                        "success": true,
                        "credential_name": cred.name,
                        "provider_type": cred.provider_type,
                    }))
                }
                None => Ok(serde_json::json!({
                    "success": false,
                    "error": "未找到可用凭证"
                })),
            }
        }

        // ========== 模型相关 ==========
        "get_models" => {
            // 返回可用模型列表
            Ok(serde_json::json!({
                "data": [
                    {"id": "claude-sonnet-4-20250514", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-opus-4-20250514", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-haiku-4-20250514", "object": "model", "owned_by": "anthropic"},
                    {"id": "gpt-4o", "object": "model", "owned_by": "openai"},
                    {"id": "gpt-4o-mini", "object": "model", "owned_by": "openai"},
                ]
            }))
        }

        "get_model_registry_provider_ids" => {
            match load_model_registry_provider_ids_from_resources() {
                Ok(provider_ids) => Ok(serde_json::to_value(provider_ids)?),
                Err(resource_error) => {
                    let fallback = load_model_registry_provider_ids_from_db(state)?;
                    if fallback.is_empty() {
                        Err(format!(
                            "获取模型 Provider ID 失败（resources 与数据库均不可用）: {resource_error}"
                        )
                        .into())
                    } else {
                        Ok(serde_json::to_value(fallback)?)
                    }
                }
            }
        }

        // ========== 网络信息 ==========
        "get_network_info" => {
            // 返回网络信息
            Ok(serde_json::json!({
                "localhost": "127.0.0.1",
                "lan_ip": null,
                "all_ips": ["127.0.0.1"]
            }))
        }

        // ========== Agent 会话管理 ==========
        "agent_create_session" => {
            let args = args.unwrap_or_default();
            let provider_type = args["provider_type"].as_str().unwrap_or("").to_string();
            let model = args["model"].as_str().map(|s| s.to_string());
            let system_prompt = args["system_prompt"].as_str().map(|s| s.to_string());
            let execution_strategy = args["execution_strategy"]
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| args["executionStrategy"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "react".to_string());

            if let Some(db) = &state.db {
                // 简化版本：直接创建会话，不需要 agent_state
                use crate::database::dao::agent::AgentDao;
                use proxycast_core::agent::types::AgentSession;

                let session_id = uuid::Uuid::new_v4().to_string();
                let model_name = model.clone().unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
                let now = chrono::Utc::now().to_rfc3339();

                let session = AgentSession {
                    id: session_id.clone(),
                    model: model_name.clone(),
                    messages: Vec::new(),
                    system_prompt,
                    title: None, // 初始会话没有标题，后续会自动生成
                    working_dir: None,
                    execution_strategy: Some(execution_strategy.clone()),
                    created_at: now.clone(),
                    updated_at: now,
                };

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                AgentDao::create_session(&conn, &session)
                    .map_err(|e| format!("创建会话失败: {e}"))?;

                Ok(serde_json::json!({
                    "session_id": session_id,
                    "credential_name": "ProxyCast",
                    "credential_uuid": null,
                    "provider_type": provider_type,
                    "model": model_name,
                    "execution_strategy": execution_strategy
                }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_list_sessions" => {
            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let sessions = AgentDao::list_sessions(&conn)
                    .map_err(|e| format!("获取会话列表失败: {e}"))?;

                let result: Vec<serde_json::Value> = sessions
                    .into_iter()
                    .map(|s| {
                        let messages_count = AgentDao::get_message_count(&conn, &s.id).unwrap_or(0);
                        serde_json::json!({
                            "session_id": s.id,
                            "provider_type": "aster",
                            "model": s.model,
                            "created_at": s.created_at,
                            "last_activity": s.updated_at,
                            "messages_count": messages_count
                        })
                    })
                    .collect();

                Ok(serde_json::json!(result))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_get_session" => {
            let args = args.unwrap_or_default();
            // 支持 session_id 和 sessionId 两种格式
            let session_id = args["session_id"].as_str()
                .or_else(|| args["sessionId"].as_str())
                .unwrap_or("").to_string();

            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let session = AgentDao::get_session(&conn, &session_id)
                    .map_err(|e| format!("获取会话失败: {e}"))?
                    .ok_or("会话不存在")?;

                let messages_count = AgentDao::get_message_count(&conn, &session_id).unwrap_or(0);

                Ok(serde_json::json!({
                    "session_id": session.id,
                    "provider_type": "aster",
                    "model": session.model,
                    "created_at": session.created_at,
                    "last_activity": session.updated_at,
                    "messages_count": messages_count
                }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_delete_session" => {
            let args = args.unwrap_or_default();
            // 支持 session_id 和 sessionId 两种格式
            let session_id = args["session_id"].as_str()
                .or_else(|| args["sessionId"].as_str())
                .unwrap_or("").to_string();

            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                AgentDao::delete_session(&conn, &session_id)
                    .map_err(|e| format!("删除会话失败: {e}"))?;

                Ok(serde_json::json!({ "success": true }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_get_session_messages" => {
            let args = args.unwrap_or_default();
            // 支持 session_id 和 sessionId 两种格式
            let session_id = args["session_id"].as_str()
                .or_else(|| args["sessionId"].as_str())
                .unwrap_or("").to_string();

            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let messages = AgentDao::get_messages(&conn, &session_id)
                    .map_err(|e| format!("获取消息失败: {e}"))?;

                Ok(serde_json::to_value(messages)?)
            } else {
                Err("Database not initialized".into())
            }
        }

        _ => Err(format!(
            "[DevBridge] 未知命令: '{cmd}'. 如需此命令，请将其添加到 dispatcher.rs 的 handle_command 函数中。"
        )
        .into()),
    }
}
