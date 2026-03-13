//! Aster Agent 包装器
//!
//! 提供简化的接口来使用 Aster Agent。
//! 处理消息发送、事件流转换，并桥接会话存储服务。

use crate::agent::aster_state::{AsterAgentState, SessionConfigBuilder};
use crate::database::DbConnection;
use aster::conversation::message::Message;
use futures::StreamExt;
use proxycast_agent::{convert_agent_event, TauriAgentEvent, WriteArtifactEventEmitter};
use tauri::{AppHandle, Emitter};

pub use proxycast_agent::session_store::{SessionDetail, SessionInfo};

/// Aster Agent 包装器
///
/// 提供与 Tauri 集成的简化接口
pub struct AsterAgentWrapper;

impl AsterAgentWrapper {
    /// 发送消息并获取流式响应
    ///
    /// # Arguments
    /// * `state` - Aster Agent 状态
    /// * `db` - 数据库连接
    /// * `app` - Tauri AppHandle，用于发送事件
    /// * `message` - 用户消息文本
    /// * `session_id` - 会话 ID
    /// * `event_name` - 前端监听的事件名称
    ///
    /// # Returns
    /// 成功时返回 Ok(())，失败时返回错误信息
    pub async fn send_message(
        state: &AsterAgentState,
        db: &DbConnection,
        app: &AppHandle,
        message: String,
        session_id: String,
        event_name: String,
    ) -> Result<(), String> {
        if !state.is_initialized().await {
            state.init_agent_with_db(db).await?;
        }

        let cancel_token = state.create_cancel_token(&session_id).await;

        let user_message = Message::user().with_text(&message);
        let session_config = SessionConfigBuilder::new(&session_id)
            .include_context_trace(true)
            .build();

        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;

        let stream_result = agent
            .reply(user_message, session_config, Some(cancel_token.clone()))
            .await;
        let mut write_artifact_emitter = WriteArtifactEventEmitter::new(session_id.clone());

        match stream_result {
            Ok(mut stream) => {
                while let Some(event_result) = stream.next().await {
                    match event_result {
                        Ok(agent_event) => {
                            let tauri_events = convert_agent_event(agent_event);
                            for mut tauri_event in tauri_events {
                                let extra_events =
                                    write_artifact_emitter.process_event(&mut tauri_event);
                                for extra_event in &extra_events {
                                    if let Err(error) = app.emit(&event_name, extra_event) {
                                        tracing::error!(
                                            "[AsterAgentWrapper] 发送补充事件失败: {}",
                                            error
                                        );
                                    }
                                }
                                if let Err(error) = app.emit(&event_name, &tauri_event) {
                                    tracing::error!("[AsterAgentWrapper] 发送事件失败: {}", error);
                                }
                            }
                        }
                        Err(error) => {
                            let error_event = TauriAgentEvent::Error {
                                message: format!("Stream error: {error}"),
                            };
                            let _ = app.emit(&event_name, &error_event);
                        }
                    }
                }

                let done_event = TauriAgentEvent::FinalDone { usage: None };
                let _ = app.emit(&event_name, &done_event);
            }
            Err(error) => {
                let error_event = TauriAgentEvent::Error {
                    message: format!("Agent error: {error}"),
                };
                let _ = app.emit(&event_name, &error_event);
                return Err(format!("Agent error: {error}"));
            }
        }

        state.remove_cancel_token(&session_id).await;

        Ok(())
    }

    /// 停止当前会话
    pub async fn stop_session(state: &AsterAgentState, session_id: &str) -> bool {
        state.cancel_session(session_id).await
    }

    /// 创建新会话
    pub fn create_session_sync(
        db: &DbConnection,
        name: Option<String>,
        working_dir: Option<String>,
        workspace_id: String,
        execution_strategy: Option<String>,
    ) -> Result<String, String> {
        proxycast_agent::session_store::create_session_sync(
            db,
            name,
            working_dir,
            workspace_id,
            execution_strategy,
        )
    }

    /// 列出所有会话
    pub fn list_sessions_sync(db: &DbConnection) -> Result<Vec<SessionInfo>, String> {
        proxycast_agent::session_store::list_sessions_sync(db)
    }

    /// 获取会话详情
    pub fn get_session_sync(db: &DbConnection, session_id: &str) -> Result<SessionDetail, String> {
        proxycast_agent::session_store::get_session_sync(db, session_id)
    }

    /// 重命名会话
    pub fn rename_session_sync(
        db: &DbConnection,
        session_id: &str,
        name: &str,
    ) -> Result<(), String> {
        proxycast_agent::session_store::rename_session_sync(db, session_id, name)
    }

    /// 删除会话
    pub fn delete_session_sync(db: &DbConnection, session_id: &str) -> Result<(), String> {
        proxycast_agent::session_store::delete_session_sync(db, session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_session_config_builder() {
        let config = SessionConfigBuilder::new("test-session").build();
        assert_eq!(config.id, "test-session");
    }
}
