//! ProxyCast 终端模块
//!
//! 提供 PTY 管理和会话管理能力，独立于 Tauri 框架。
//!
//! ## 模块结构
//! - `emitter` - 事件发射器抽象 trait
//! - `emit_helper` - 事件发射辅助函数
//! - `error` - 错误类型定义
//! - `events` - 事件定义
//! - `pty_session` - PTY 会话封装
//! - `session_manager` - 会话管理器
//! - `persistence` - 持久化存储（块文件、会话元数据）
//! - `block_controller` - 块控制器抽象层
//! - `connections` - 连接模块（本地 PTY、SSH、WSL）
//! - `integration` - 集成模块（Shell 集成、OSC 解析、状态重同步）

#![allow(clippy::too_many_arguments)]
#![allow(clippy::manual_strip)]
#![allow(clippy::derivable_impls)]

// 核心抽象
pub mod emit_helper;
pub mod emitter;

// 基础类型
pub mod error;
pub mod events;

// 会话管理
pub mod pty_session;
pub mod session_manager;

// 持久化
pub mod persistence;

// 块控制器
pub mod block_controller;

// 连接
pub mod connections;

// 集成
pub mod integration;

#[cfg(test)]
mod tests;

// 重新导出常用类型
pub use emitter::{DynEmitter, NoOpEmitter, TerminalEventEmitter};
pub use error::TerminalError;
pub use events::{SessionStatus, TerminalOutputEvent, TerminalStatusEvent};
pub use pty_session::{PtySession, DEFAULT_COLS, DEFAULT_ROWS};
pub use session_manager::{SessionMetadata, TerminalSessionManager};

pub use block_controller::{
    BlockController, BlockControllerRuntimeStatus, BlockInputUnion, BlockMeta, ControllerRegistry,
    ControllerStatusEvent, RuntimeOpts, ShellController, TermSize, CONTROLLER_STATUS_EVENT,
};
pub use connections::ShellProc;
pub use integration::{
    resync_controller, ResyncController, ResyncOptions, ResyncResult, TERMINAL_RESET_SEQUENCE,
    TERMINAL_SOFT_RESET_SEQUENCE,
};
pub use persistence::{BlockFile, SessionMetadataStore, SessionRecord};
