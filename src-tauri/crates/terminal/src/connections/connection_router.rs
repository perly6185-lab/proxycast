//! 连接类型路由模块
//!
//! 根据连接名称自动选择连接类型，实现连接工厂模式。
//!
//! ## 功能
//! - 根据连接名称自动路由到正确的连接类型
//! - 提供连接工厂函数创建相应的连接
//! - 支持本地 PTY、SSH、WSL 三种连接类型
//!
//! ## Requirements
//! - 1.4: 创建 SSH 终端时使用 SSH_Connection 建立远程连接
//! - 1.5: 创建 WSL 终端时使用 WSL_Connection 建立连接

use serde::{Deserialize, Serialize};

use super::{is_local_conn_name, is_ssh_conn_name, is_wsl_conn_name};
use crate::error::TerminalError;

// ============================================================================
// 连接类型枚举
// ============================================================================

/// 连接类型
///
/// 表示终端会话可以使用的连接类型。
///
/// _Requirements: 1.4, 1.5_
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionType {
    /// 本地 PTY 连接
    #[default]
    Local,
    /// SSH 远程连接
    SSH,
    /// WSL 连接（仅 Windows）
    WSL,
}

impl std::fmt::Display for ConnectionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "local"),
            Self::SSH => write!(f, "ssh"),
            Self::WSL => write!(f, "wsl"),
        }
    }
}

impl std::str::FromStr for ConnectionType {
    type Err = TerminalError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "local" | "" => Ok(Self::Local),
            "ssh" => Ok(Self::SSH),
            "wsl" => Ok(Self::WSL),
            _ => Err(TerminalError::InvalidConnectionType(s.to_string())),
        }
    }
}

// ============================================================================
// 连接路由器
// ============================================================================

/// 连接路由器
///
/// 根据连接名称自动选择连接类型。
///
/// ## 路由规则
/// 1. 空字符串或 "local" → Local
/// 2. 以 "wsl://" 开头或等于 "wsl" → WSL
/// 3. 以 "ssh://" 开头、包含 "@" 或其他非本地/WSL 格式 → SSH
///
/// _Requirements: 1.4, 1.5_
pub struct ConnectionRouter;

impl ConnectionRouter {
    /// 根据连接名称确定连接类型
    ///
    /// # 参数
    /// - `conn_name`: 连接名称
    ///
    /// # 返回
    /// 对应的连接类型
    ///
    /// # 示例
    /// ```ignore
    /// use proxycast_terminal::connections::{ConnectionRouter, ConnectionType};
    ///
    /// assert_eq!(ConnectionRouter::route(""), ConnectionType::Local);
    /// assert_eq!(ConnectionRouter::route("local"), ConnectionType::Local);
    /// assert_eq!(ConnectionRouter::route("wsl://Ubuntu"), ConnectionType::WSL);
    /// assert_eq!(ConnectionRouter::route("user@host"), ConnectionType::SSH);
    /// ```
    ///
    /// _Requirements: 1.4, 1.5_
    pub fn route(conn_name: &str) -> ConnectionType {
        let conn_name = conn_name.trim();

        // 1. 检查是否为本地连接
        if is_local_conn_name(conn_name) {
            return ConnectionType::Local;
        }

        // 2. 检查是否为 WSL 连接
        if is_wsl_conn_name(conn_name) {
            return ConnectionType::WSL;
        }

        // 3. 检查是否为 SSH 连接
        if is_ssh_conn_name(conn_name) {
            return ConnectionType::SSH;
        }

        // 4. 默认为本地连接
        ConnectionType::Local
    }

    /// 验证连接名称格式是否有效
    ///
    /// # 参数
    /// - `conn_name`: 连接名称
    ///
    /// # 返回
    /// - `Ok(ConnectionType)`: 连接名称有效，返回对应的连接类型
    /// - `Err(TerminalError)`: 连接名称无效
    pub fn validate(conn_name: &str) -> Result<ConnectionType, TerminalError> {
        let conn_name = conn_name.trim();
        let conn_type = Self::route(conn_name);

        // 对于 SSH 连接，验证格式
        if conn_type == ConnectionType::SSH {
            // 尝试解析 SSH 连接字符串
            use super::SSHOpts;
            SSHOpts::parse(conn_name)?;
        }

        // 对于 WSL 连接，验证格式
        if conn_type == ConnectionType::WSL {
            use super::WSLOpts;
            WSLOpts::parse(conn_name)?;
        }

        Ok(conn_type)
    }

    /// 检查连接类型是否在当前平台上可用
    ///
    /// # 参数
    /// - `conn_type`: 连接类型
    ///
    /// # 返回
    /// 连接类型是否可用
    pub fn is_available(conn_type: ConnectionType) -> bool {
        match conn_type {
            ConnectionType::Local => true,
            ConnectionType::SSH => true, // SSH 在所有平台上可用
            ConnectionType::WSL => cfg!(target_os = "windows"), // WSL 仅在 Windows 上可用
        }
    }

    /// 获取连接类型的描述
    ///
    /// # 参数
    /// - `conn_type`: 连接类型
    ///
    /// # 返回
    /// 连接类型的人类可读描述
    pub fn description(conn_type: ConnectionType) -> &'static str {
        match conn_type {
            ConnectionType::Local => "本地终端",
            ConnectionType::SSH => "SSH 远程连接",
            ConnectionType::WSL => "Windows Subsystem for Linux",
        }
    }
}

// ============================================================================
// 连接信息
// ============================================================================

/// 连接信息
///
/// 包含解析后的连接详情。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    /// 原始连接名称
    pub conn_name: String,
    /// 连接类型
    pub conn_type: ConnectionType,
    /// 是否在当前平台可用
    pub available: bool,
    /// 连接描述
    pub description: String,
}

impl ConnectionInfo {
    /// 从连接名称创建连接信息
    ///
    /// # 参数
    /// - `conn_name`: 连接名称
    ///
    /// # 返回
    /// 连接信息
    pub fn from_conn_name(conn_name: &str) -> Self {
        let conn_type = ConnectionRouter::route(conn_name);
        Self {
            conn_name: conn_name.to_string(),
            conn_type,
            available: ConnectionRouter::is_available(conn_type),
            description: ConnectionRouter::description(conn_type).to_string(),
        }
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // ConnectionType 测试
    // ========================================================================

    mod connection_type_tests {
        use super::*;

        #[test]
        fn test_default() {
            assert_eq!(ConnectionType::default(), ConnectionType::Local);
        }

        #[test]
        fn test_display() {
            assert_eq!(ConnectionType::Local.to_string(), "local");
            assert_eq!(ConnectionType::SSH.to_string(), "ssh");
            assert_eq!(ConnectionType::WSL.to_string(), "wsl");
        }

        #[test]
        fn test_from_str() {
            assert_eq!(
                "local".parse::<ConnectionType>().unwrap(),
                ConnectionType::Local
            );
            assert_eq!("".parse::<ConnectionType>().unwrap(), ConnectionType::Local);
            assert_eq!(
                "ssh".parse::<ConnectionType>().unwrap(),
                ConnectionType::SSH
            );
            assert_eq!(
                "SSH".parse::<ConnectionType>().unwrap(),
                ConnectionType::SSH
            );
            assert_eq!(
                "wsl".parse::<ConnectionType>().unwrap(),
                ConnectionType::WSL
            );
            assert_eq!(
                "WSL".parse::<ConnectionType>().unwrap(),
                ConnectionType::WSL
            );
        }

        #[test]
        fn test_from_str_invalid() {
            assert!("invalid".parse::<ConnectionType>().is_err());
        }
    }

    // ========================================================================
    // ConnectionRouter 测试
    // ========================================================================

    mod connection_router_tests {
        use super::*;

        #[test]
        fn test_route_local() {
            assert_eq!(ConnectionRouter::route(""), ConnectionType::Local);
            assert_eq!(ConnectionRouter::route("local"), ConnectionType::Local);
            assert_eq!(ConnectionRouter::route("  "), ConnectionType::Local);
            assert_eq!(ConnectionRouter::route("  local  "), ConnectionType::Local);
        }

        #[test]
        fn test_route_wsl() {
            assert_eq!(ConnectionRouter::route("wsl://Ubuntu"), ConnectionType::WSL);
            assert_eq!(ConnectionRouter::route("wsl://Debian"), ConnectionType::WSL);
            assert_eq!(ConnectionRouter::route("wsl://"), ConnectionType::WSL);
            assert_eq!(ConnectionRouter::route("wsl"), ConnectionType::WSL);
            assert_eq!(ConnectionRouter::route("WSL"), ConnectionType::WSL);
            assert_eq!(
                ConnectionRouter::route("  wsl://Ubuntu  "),
                ConnectionType::WSL
            );
        }

        #[test]
        fn test_route_ssh() {
            assert_eq!(ConnectionRouter::route("user@host"), ConnectionType::SSH);
            assert_eq!(ConnectionRouter::route("user@host:22"), ConnectionType::SSH);
            assert_eq!(
                ConnectionRouter::route("ssh://user@host"),
                ConnectionType::SSH
            );
            assert_eq!(ConnectionRouter::route("ssh://host"), ConnectionType::SSH);
            assert_eq!(ConnectionRouter::route("example.com"), ConnectionType::SSH);
            assert_eq!(ConnectionRouter::route("192.168.1.1"), ConnectionType::SSH);
        }

        #[test]
        fn test_route_with_whitespace() {
            assert_eq!(
                ConnectionRouter::route("  user@host  "),
                ConnectionType::SSH
            );
            assert_eq!(
                ConnectionRouter::route("  wsl://Ubuntu  "),
                ConnectionType::WSL
            );
            assert_eq!(ConnectionRouter::route("  local  "), ConnectionType::Local);
        }

        #[test]
        fn test_validate_local() {
            assert_eq!(
                ConnectionRouter::validate("").unwrap(),
                ConnectionType::Local
            );
            assert_eq!(
                ConnectionRouter::validate("local").unwrap(),
                ConnectionType::Local
            );
        }

        #[test]
        fn test_validate_ssh() {
            assert_eq!(
                ConnectionRouter::validate("user@host").unwrap(),
                ConnectionType::SSH
            );
            assert_eq!(
                ConnectionRouter::validate("user@host:22").unwrap(),
                ConnectionType::SSH
            );
        }

        #[test]
        fn test_validate_wsl() {
            assert_eq!(
                ConnectionRouter::validate("wsl://Ubuntu").unwrap(),
                ConnectionType::WSL
            );
            assert_eq!(
                ConnectionRouter::validate("wsl").unwrap(),
                ConnectionType::WSL
            );
        }

        #[test]
        fn test_is_available() {
            assert!(ConnectionRouter::is_available(ConnectionType::Local));
            assert!(ConnectionRouter::is_available(ConnectionType::SSH));
            // WSL 可用性取决于平台
            #[cfg(target_os = "windows")]
            assert!(ConnectionRouter::is_available(ConnectionType::WSL));
            #[cfg(not(target_os = "windows"))]
            assert!(!ConnectionRouter::is_available(ConnectionType::WSL));
        }

        #[test]
        fn test_description() {
            assert_eq!(
                ConnectionRouter::description(ConnectionType::Local),
                "本地终端"
            );
            assert_eq!(
                ConnectionRouter::description(ConnectionType::SSH),
                "SSH 远程连接"
            );
            assert_eq!(
                ConnectionRouter::description(ConnectionType::WSL),
                "Windows Subsystem for Linux"
            );
        }
    }

    // ========================================================================
    // ConnectionInfo 测试
    // ========================================================================

    mod connection_info_tests {
        use super::*;

        #[test]
        fn test_from_conn_name_local() {
            let info = ConnectionInfo::from_conn_name("");
            assert_eq!(info.conn_name, "");
            assert_eq!(info.conn_type, ConnectionType::Local);
            assert!(info.available);
        }

        #[test]
        fn test_from_conn_name_ssh() {
            let info = ConnectionInfo::from_conn_name("user@host");
            assert_eq!(info.conn_name, "user@host");
            assert_eq!(info.conn_type, ConnectionType::SSH);
            assert!(info.available);
        }

        #[test]
        fn test_from_conn_name_wsl() {
            let info = ConnectionInfo::from_conn_name("wsl://Ubuntu");
            assert_eq!(info.conn_name, "wsl://Ubuntu");
            assert_eq!(info.conn_type, ConnectionType::WSL);
            // WSL 可用性取决于平台
            #[cfg(target_os = "windows")]
            assert!(info.available);
            #[cfg(not(target_os = "windows"))]
            assert!(!info.available);
        }
    }
}
