//! 会话文件存储模块
//!
//! 为每个 Agent 会话提供独立的临时工作目录，
//!
//! ## 目录结构
//! ```text
//! {应用数据目录}/proxycast/sessions/
//! ├── {session-id}/
//! │   ├── .meta.json          # 会话元数据
//! │   ├── files/              # 生成的文件
//! │   │   ├── article.md
//! │   │   ├── song-spec.md
//! │   │   └── ...
//! │   └── canvas/             # 画布状态快照
//! └── ...
//! ```
//!
//! 默认会自动兼容旧 Home 历史目录中的 sessions 数据。

pub mod storage;
pub mod types;

pub use storage::SessionFileStorage;
pub use types::*;
