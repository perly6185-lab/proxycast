use chrono::Utc;
use proxycast_agent::TauriAgentEvent;
use proxycast_core::database::dao::agent_timeline::{
    AgentRequestOption, AgentRequestQuestion, AgentThreadItem, AgentThreadItemPayload,
    AgentThreadItemStatus, AgentThreadTurn, AgentThreadTurnStatus, AgentTimelineDao,
};
use proxycast_core::database::{lock_db, DbConnection};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const PROPOSED_PLAN_OPEN: &str = "<proposed_plan>";
const PROPOSED_PLAN_CLOSE: &str = "</proposed_plan>";

fn emit_event(app: &AppHandle, event_name: &str, event: &TauriAgentEvent) {
    if let Err(error) = app.emit(event_name, event) {
        tracing::error!("[AgentTimeline] 发送事件失败: {}", error);
    }
}

fn normalize_tool_name(name: &str) -> String {
    name.replace([' ', '-', '_'], "").to_lowercase()
}

fn parse_json_str(raw: Option<&str>) -> Option<Value> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(value).ok()
}

fn as_object(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.as_object()
}

fn pick_string_from_object(
    object: Option<&serde_json::Map<String, Value>>,
    keys: &[&str],
) -> Option<String> {
    let object = object?;
    for key in keys {
        if let Some(value) = object.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn extract_tool_query(arguments: Option<&Value>) -> Option<String> {
    pick_string_from_object(
        arguments.and_then(as_object),
        &["q", "query", "question", "search", "search_query", "url"],
    )
}

fn extract_command_text(arguments: Option<&Value>) -> Option<String> {
    pick_string_from_object(
        arguments.and_then(as_object),
        &["cmd", "command", "script", "text"],
    )
}

fn extract_file_paths(arguments: Option<&Value>, metadata: Option<&Value>) -> Vec<String> {
    let mut paths = Vec::new();
    for source in [arguments, metadata] {
        let Some(object) = source.and_then(as_object) else {
            continue;
        };
        for key in [
            "path",
            "file_path",
            "filePath",
            "output_file",
            "output_path",
            "outputPath",
            "artifact_path",
            "artifact_paths",
            "absolute_path",
            "absolutePath",
        ] {
            let Some(value) = object.get(key) else {
                continue;
            };
            match value {
                Value::String(text) => {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && !paths.iter().any(|item| item == trimmed) {
                        paths.push(trimmed.to_string());
                    }
                }
                Value::Array(items) => {
                    for item in items {
                        if let Some(text) = item.as_str() {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() && !paths.iter().any(|entry| entry == trimmed) {
                                paths.push(trimmed.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    paths
}

fn extract_proposed_plan_block(text: &str) -> Option<String> {
    let start = text.find(PROPOSED_PLAN_OPEN)?;
    let remainder = &text[start + PROPOSED_PLAN_OPEN.len()..];
    let end = remainder.find(PROPOSED_PLAN_CLOSE)?;
    let content = remainder[..end].trim();
    if content.is_empty() {
        None
    } else {
        Some(content.to_string())
    }
}

fn is_command_tool(name: &str) -> bool {
    matches!(
        normalize_tool_name(name).as_str(),
        "bash" | "execcommand" | "terminal" | "shell" | "runcommand"
    )
}

fn is_web_tool(name: &str) -> bool {
    let normalized = normalize_tool_name(name);
    normalized.contains("websearch")
        || normalized.contains("searchquery")
        || normalized.contains("webfetch")
        || normalized.contains("browser")
        || normalized.contains("playwright")
        || normalized == "search"
}

fn is_user_input_action(action_type: &str) -> bool {
    matches!(action_type, "ask_user" | "elicitation")
}

fn map_questions(raw: Option<&Value>) -> Option<Vec<AgentRequestQuestion>> {
    let items = raw?.as_array()?;
    let mut questions = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(question) = object.get("question").and_then(Value::as_str) else {
            continue;
        };

        let options = object
            .get("options")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| {
                        let object = value.as_object()?;
                        let label = object.get("label")?.as_str()?.trim().to_string();
                        if label.is_empty() {
                            return None;
                        }
                        Some(AgentRequestOption {
                            label,
                            description: object
                                .get("description")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string),
                        })
                    })
                    .collect::<Vec<_>>()
            });

        questions.push(AgentRequestQuestion {
            question: question.trim().to_string(),
            header: object
                .get("header")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            options: options.filter(|values| !values.is_empty()),
            multi_select: object.get("multi_select").and_then(Value::as_bool),
        });
    }

    if questions.is_empty() {
        None
    } else {
        Some(questions)
    }
}

#[derive(Debug)]
pub struct AgentTimelineRecorder {
    db: DbConnection,
    thread_id: String,
    turn_id: String,
    turn: AgentThreadTurn,
    sequence_counter: i64,
    item_sequences: HashMap<String, i64>,
    item_statuses: HashMap<String, AgentThreadItemStatus>,
    assistant_text: String,
    reasoning_text: String,
    plan_text: Option<String>,
}

impl AgentTimelineRecorder {
    pub fn create(
        db: DbConnection,
        thread_id: impl Into<String>,
        prompt_text: impl Into<String>,
    ) -> Result<Self, String> {
        let thread_id = thread_id.into();
        let prompt_text = prompt_text.into();
        let now = Utc::now().to_rfc3339();
        let turn = AgentThreadTurn {
            id: Uuid::new_v4().to_string(),
            thread_id: thread_id.clone(),
            prompt_text,
            status: AgentThreadTurnStatus::Running,
            started_at: now.clone(),
            completed_at: None,
            error_message: None,
            created_at: now.clone(),
            updated_at: now,
        };

        {
            let conn = lock_db(&db)?;
            AgentTimelineDao::create_turn(&conn, &turn)
                .map_err(|e| format!("创建 turn 失败: {e}"))?;
        }

        Ok(Self {
            db,
            thread_id,
            turn_id: turn.id.clone(),
            turn,
            sequence_counter: 0,
            item_sequences: HashMap::new(),
            item_statuses: HashMap::new(),
            assistant_text: String::new(),
            reasoning_text: String::new(),
            plan_text: None,
        })
    }

    pub fn thread_id(&self) -> &str {
        &self.thread_id
    }

    pub fn turn_id(&self) -> &str {
        &self.turn_id
    }

    pub fn emit_start(&mut self, app: &AppHandle, event_name: &str) -> Result<(), String> {
        emit_event(
            app,
            event_name,
            &TauriAgentEvent::ThreadStarted {
                thread_id: self.thread_id.clone(),
            },
        );
        emit_event(
            app,
            event_name,
            &TauriAgentEvent::TurnStarted {
                turn: self.turn.clone(),
            },
        );

        let user_item = self.build_item(
            format!("user:{}", self.turn_id),
            AgentThreadItemStatus::Completed,
            Some(self.turn.started_at.clone()),
            AgentThreadItemPayload::UserMessage {
                content: self.turn.prompt_text.clone(),
            },
        );
        self.persist_and_emit_item(app, event_name, user_item)?;
        Ok(())
    }

    pub fn record_legacy_event(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        event: &TauriAgentEvent,
        workspace_root: &str,
    ) -> Result<(), String> {
        match event {
            TauriAgentEvent::TextDelta { text } => {
                self.assistant_text.push_str(text);
                let item = self.build_item(
                    format!("assistant:{}", self.turn_id),
                    AgentThreadItemStatus::InProgress,
                    None,
                    AgentThreadItemPayload::AgentMessage {
                        text: self.assistant_text.clone(),
                        phase: None,
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;

                if let Some(plan_text) = extract_proposed_plan_block(&self.assistant_text) {
                    if self.plan_text.as_deref() != Some(plan_text.as_str()) {
                        self.plan_text = Some(plan_text.clone());
                    }
                    let plan_item = self.build_item(
                        format!("plan:{}", self.turn_id),
                        AgentThreadItemStatus::InProgress,
                        None,
                        AgentThreadItemPayload::Plan { text: plan_text },
                    );
                    self.persist_and_emit_item(app, event_name, plan_item)?;
                }
            }
            TauriAgentEvent::ThinkingDelta { text } => {
                self.reasoning_text.push_str(text);
                let item = self.build_item(
                    format!("reasoning:{}", self.turn_id),
                    AgentThreadItemStatus::InProgress,
                    None,
                    AgentThreadItemPayload::Reasoning {
                        text: self.reasoning_text.clone(),
                        summary: None,
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            TauriAgentEvent::ToolStart {
                tool_name,
                tool_id,
                arguments,
            } => {
                let arguments_value = parse_json_str(arguments.as_deref());
                let payload = if is_command_tool(tool_name) {
                    AgentThreadItemPayload::CommandExecution {
                        command: extract_command_text(arguments_value.as_ref())
                            .unwrap_or_else(|| tool_name.clone()),
                        cwd: workspace_root.to_string(),
                        aggregated_output: None,
                        exit_code: None,
                        error: None,
                    }
                } else if is_web_tool(tool_name) {
                    AgentThreadItemPayload::WebSearch {
                        query: extract_tool_query(arguments_value.as_ref()),
                        action: Some(tool_name.clone()),
                        output: None,
                    }
                } else {
                    AgentThreadItemPayload::ToolCall {
                        tool_name: tool_name.clone(),
                        arguments: arguments_value,
                        output: None,
                        success: None,
                        error: None,
                        metadata: None,
                    }
                };

                let item = self.build_item(
                    tool_id.clone(),
                    AgentThreadItemStatus::InProgress,
                    None,
                    payload,
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            TauriAgentEvent::ToolEnd { tool_id, result } => {
                let existing = {
                    let conn = lock_db(&self.db)?;
                    AgentTimelineDao::get_item(&conn, tool_id)
                        .map_err(|e| format!("读取工具 item 失败: {e}"))?
                };

                let metadata_value = result
                    .metadata
                    .as_ref()
                    .and_then(|metadata| serde_json::to_value(metadata).ok());
                let status = if result.success {
                    AgentThreadItemStatus::Completed
                } else {
                    AgentThreadItemStatus::Failed
                };

                let payload = match existing.map(|item| item.payload) {
                    Some(AgentThreadItemPayload::CommandExecution { command, cwd, .. }) => {
                        AgentThreadItemPayload::CommandExecution {
                            command,
                            cwd,
                            aggregated_output: Some(result.output.clone()),
                            exit_code: metadata_value
                                .as_ref()
                                .and_then(|value| value.get("exit_code"))
                                .and_then(Value::as_i64),
                            error: result.error.clone(),
                        }
                    }
                    Some(AgentThreadItemPayload::WebSearch { query, action, .. }) => {
                        AgentThreadItemPayload::WebSearch {
                            query,
                            action,
                            output: Some(result.output.clone()),
                        }
                    }
                    Some(AgentThreadItemPayload::ToolCall {
                        tool_name,
                        arguments,
                        ..
                    }) => AgentThreadItemPayload::ToolCall {
                        tool_name,
                        arguments,
                        output: Some(result.output.clone()),
                        success: Some(result.success),
                        error: result.error.clone(),
                        metadata: metadata_value.clone(),
                    },
                    _ => AgentThreadItemPayload::ToolCall {
                        tool_name: tool_id.clone(),
                        arguments: None,
                        output: Some(result.output.clone()),
                        success: Some(result.success),
                        error: result.error.clone(),
                        metadata: metadata_value.clone(),
                    },
                };

                let item = self.build_item(
                    tool_id.clone(),
                    status,
                    Some(Utc::now().to_rfc3339()),
                    payload,
                );
                self.persist_and_emit_item(app, event_name, item)?;

                for path in extract_file_paths(None, metadata_value.as_ref()) {
                    let file_item = self.build_item(
                        format!("artifact:{}:{}", tool_id, path),
                        AgentThreadItemStatus::Completed,
                        Some(Utc::now().to_rfc3339()),
                        AgentThreadItemPayload::FileArtifact {
                            path,
                            source: "tool_result".to_string(),
                            content: None,
                            metadata: metadata_value.clone(),
                        },
                    );
                    self.persist_and_emit_item(app, event_name, file_item)?;
                }
            }
            TauriAgentEvent::ActionRequired {
                request_id,
                action_type,
                data,
            } => {
                let payload = if is_user_input_action(action_type) {
                    AgentThreadItemPayload::RequestUserInput {
                        request_id: request_id.clone(),
                        action_type: action_type.clone(),
                        prompt: data
                            .get("prompt")
                            .or_else(|| data.get("message"))
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string),
                        questions: map_questions(data.get("questions")),
                        response: None,
                    }
                } else {
                    AgentThreadItemPayload::ApprovalRequest {
                        request_id: request_id.clone(),
                        action_type: action_type.clone(),
                        prompt: data
                            .get("prompt")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string),
                        tool_name: data
                            .get("tool_name")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string),
                        arguments: data.get("arguments").cloned(),
                        response: None,
                    }
                };

                let item = self.build_item(
                    request_id.clone(),
                    AgentThreadItemStatus::InProgress,
                    None,
                    payload,
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            TauriAgentEvent::Warning { code, message } => {
                let item = self.build_item(
                    format!("warning:{}:{}", self.turn_id, self.sequence_counter + 1),
                    AgentThreadItemStatus::Completed,
                    Some(Utc::now().to_rfc3339()),
                    AgentThreadItemPayload::Warning {
                        message: message.clone(),
                        code: code.clone(),
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            TauriAgentEvent::Error { message } => {
                let item = self.build_item(
                    format!("error:{}", self.turn_id),
                    AgentThreadItemStatus::Failed,
                    Some(Utc::now().to_rfc3339()),
                    AgentThreadItemPayload::Error {
                        message: message.clone(),
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            _ => {}
        }

        Ok(())
    }

    pub fn complete_turn_success(
        &mut self,
        app: &AppHandle,
        event_name: &str,
    ) -> Result<(), String> {
        self.complete_open_content_items(app, event_name, AgentThreadItemStatus::Completed)?;
        let now = Utc::now().to_rfc3339();
        self.turn.status = AgentThreadTurnStatus::Completed;
        self.turn.completed_at = Some(now.clone());
        self.turn.updated_at = now.clone();

        let conn = lock_db(&self.db)?;
        AgentTimelineDao::update_turn_status(
            &conn,
            &self.turn_id,
            AgentThreadTurnStatus::Completed,
            Some(&now),
            None,
            &now,
        )
        .map_err(|e| format!("更新 turn 完成状态失败: {e}"))?;
        drop(conn);

        emit_event(
            app,
            event_name,
            &TauriAgentEvent::TurnCompleted {
                turn: self.turn.clone(),
            },
        );
        Ok(())
    }

    pub fn fail_turn(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        message: &str,
    ) -> Result<(), String> {
        self.complete_open_content_items(app, event_name, AgentThreadItemStatus::Completed)?;
        let error_item = self.build_item(
            format!("error:{}", self.turn_id),
            AgentThreadItemStatus::Failed,
            Some(Utc::now().to_rfc3339()),
            AgentThreadItemPayload::Error {
                message: message.to_string(),
            },
        );
        self.persist_and_emit_item(app, event_name, error_item)?;

        let now = Utc::now().to_rfc3339();
        self.turn.status = AgentThreadTurnStatus::Failed;
        self.turn.completed_at = Some(now.clone());
        self.turn.error_message = Some(message.to_string());
        self.turn.updated_at = now.clone();

        let conn = lock_db(&self.db)?;
        AgentTimelineDao::update_turn_status(
            &conn,
            &self.turn_id,
            AgentThreadTurnStatus::Failed,
            Some(&now),
            Some(message),
            &now,
        )
        .map_err(|e| format!("更新 turn 失败状态失败: {e}"))?;
        drop(conn);

        emit_event(
            app,
            event_name,
            &TauriAgentEvent::TurnFailed {
                turn: self.turn.clone(),
            },
        );
        Ok(())
    }

    fn complete_open_content_items(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        status: AgentThreadItemStatus,
    ) -> Result<(), String> {
        if !self.assistant_text.is_empty() {
            let item = self.build_item(
                format!("assistant:{}", self.turn_id),
                status.clone(),
                Some(Utc::now().to_rfc3339()),
                AgentThreadItemPayload::AgentMessage {
                    text: self.assistant_text.clone(),
                    phase: None,
                },
            );
            self.persist_and_emit_item(app, event_name, item)?;
        }

        if !self.reasoning_text.is_empty() {
            let item = self.build_item(
                format!("reasoning:{}", self.turn_id),
                status.clone(),
                Some(Utc::now().to_rfc3339()),
                AgentThreadItemPayload::Reasoning {
                    text: self.reasoning_text.clone(),
                    summary: None,
                },
            );
            self.persist_and_emit_item(app, event_name, item)?;
        }

        if let Some(plan_text) = self.plan_text.clone() {
            let item = self.build_item(
                format!("plan:{}", self.turn_id),
                status,
                Some(Utc::now().to_rfc3339()),
                AgentThreadItemPayload::Plan { text: plan_text },
            );
            self.persist_and_emit_item(app, event_name, item)?;
        }

        Ok(())
    }

    fn build_item(
        &mut self,
        id: String,
        status: AgentThreadItemStatus,
        completed_at: Option<String>,
        payload: AgentThreadItemPayload,
    ) -> AgentThreadItem {
        let now = Utc::now().to_rfc3339();
        let started_at = self
            .item_statuses
            .get(&id)
            .map(|_| {
                let conn = lock_db(&self.db).ok()?;
                AgentTimelineDao::get_item(&conn, &id)
                    .ok()
                    .flatten()
                    .map(|item| item.started_at)
            })
            .flatten()
            .unwrap_or_else(|| now.clone());

        let sequence = if let Some(existing) = self.item_sequences.get(&id) {
            *existing
        } else {
            self.sequence_counter += 1;
            self.item_sequences
                .insert(id.clone(), self.sequence_counter);
            self.sequence_counter
        };

        AgentThreadItem {
            id,
            thread_id: self.thread_id.clone(),
            turn_id: self.turn_id.clone(),
            sequence,
            status,
            started_at,
            completed_at,
            updated_at: now,
            payload,
        }
    }

    fn persist_and_emit_item(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        item: AgentThreadItem,
    ) -> Result<(), String> {
        {
            let conn = lock_db(&self.db)?;
            AgentTimelineDao::upsert_item(&conn, &item)
                .map_err(|e| format!("保存 item 失败: {e}"))?;
        }

        let previous_status = self
            .item_statuses
            .insert(item.id.clone(), item.status.clone());
        let event = match (&previous_status, &item.status) {
            (None, AgentThreadItemStatus::InProgress) => {
                TauriAgentEvent::ItemStarted { item: item.clone() }
            }
            (None, _) => TauriAgentEvent::ItemCompleted { item: item.clone() },
            (_, AgentThreadItemStatus::Completed | AgentThreadItemStatus::Failed) => {
                TauriAgentEvent::ItemCompleted { item: item.clone() }
            }
            _ => TauriAgentEvent::ItemUpdated { item: item.clone() },
        };
        emit_event(app, event_name, &event);
        Ok(())
    }
}

pub fn complete_action_item(
    db: &DbConnection,
    request_id: &str,
    response: Option<Value>,
) -> Result<(), String> {
    let conn = lock_db(db)?;
    let Some(mut item) = AgentTimelineDao::get_item(&conn, request_id)
        .map_err(|e| format!("读取 action item 失败: {e}"))?
    else {
        return Ok(());
    };

    let payload = match item.payload {
        AgentThreadItemPayload::ApprovalRequest {
            request_id,
            action_type,
            prompt,
            tool_name,
            arguments,
            ..
        } => AgentThreadItemPayload::ApprovalRequest {
            request_id,
            action_type,
            prompt,
            tool_name,
            arguments,
            response,
        },
        AgentThreadItemPayload::RequestUserInput {
            request_id,
            action_type,
            prompt,
            questions,
            ..
        } => AgentThreadItemPayload::RequestUserInput {
            request_id,
            action_type,
            prompt,
            questions,
            response,
        },
        other => other,
    };

    let now = Utc::now().to_rfc3339();
    item.status = AgentThreadItemStatus::Completed;
    item.completed_at = Some(now.clone());
    item.updated_at = now;
    item.payload = payload;

    AgentTimelineDao::upsert_item(&conn, &item).map_err(|e| format!("更新 action item 失败: {e}"))
}

pub fn build_action_response_value(
    confirmed: bool,
    response: Option<&str>,
    user_data: Option<&Value>,
) -> Option<Value> {
    if let Some(value) = user_data {
        return Some(value.clone());
    }
    if !confirmed {
        return Some(json!({ "confirmed": false }));
    }
    response.map(|value| Value::String(value.to_string()))
}
