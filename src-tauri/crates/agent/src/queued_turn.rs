use serde::{Deserialize, Serialize};

/// 会话内排队 turn 快照
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueuedTurnSnapshot {
    pub queued_turn_id: String,
    pub message_preview: String,
    pub message_text: String,
    pub created_at: i64,
    pub image_count: usize,
    pub position: usize,
}
