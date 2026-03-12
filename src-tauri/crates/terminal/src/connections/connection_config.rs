//! 连接配置管理
//!
//! 管理用户保存的连接配置，支持本地和 SSH 连接。
//! 配置存储在 `~/.config/proxycast/connections.json`。
//!
//! ## 功能
//! - 加载/保存连接配置文件
//! - 读取系统 SSH 配置 (~/.ssh/config) 中的 Host 列表
//! - 合并用户配置和系统 SSH 配置
//!
//! ## 配置文件格式
//! ```json
//! {
//!   "connections": {
//!     "my-server": {
//!       "type": "ssh",
//!       "user": "root",
//!       "host": "192.168.1.100",
//!       "port": 22,
//!       "identityFile": "~/.ssh/id_rsa"
//!     }
//!   }
//! }
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use super::SSHConfigParser;

/// 连接类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionConfigType {
    /// 本地终端
    #[default]
    Local,
    /// SSH 远程连接
    Ssh,
    /// WSL 连接
    Wsl,
}

/// 单个连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    /// 连接类型
    #[serde(rename = "type", default)]
    pub conn_type: ConnectionConfigType,

    /// SSH 用户名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,

    /// SSH 主机名或 IP
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,

    /// SSH 端口（默认 22）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,

    /// 身份文件路径（私钥）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,

    /// 身份文件列表（多个私钥）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_files: Option<Vec<String>>,

    /// 跳板机配置 (ProxyJump)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,

    /// 显示顺序
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_order: Option<i32>,

    /// 是否隐藏
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,

    /// WSL 发行版名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wsl_distro: Option<String>,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            conn_type: ConnectionConfigType::Local,
            user: None,
            host: None,
            port: None,
            identity_file: None,
            identity_files: None,
            proxy_jump: None,
            display_order: None,
            hidden: None,
            wsl_distro: None,
        }
    }
}

impl ConnectionConfig {
    /// 创建本地连接配置
    pub fn local() -> Self {
        Self {
            conn_type: ConnectionConfigType::Local,
            ..Default::default()
        }
    }

    /// 创建 SSH 连接配置
    pub fn ssh(host: impl Into<String>) -> Self {
        Self {
            conn_type: ConnectionConfigType::Ssh,
            host: Some(host.into()),
            ..Default::default()
        }
    }

    /// 设置用户名
    pub fn with_user(mut self, user: impl Into<String>) -> Self {
        self.user = Some(user.into());
        self
    }

    /// 设置端口
    pub fn with_port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }

    /// 设置身份文件
    pub fn with_identity_file(mut self, path: impl Into<String>) -> Self {
        self.identity_file = Some(path.into());
        self
    }
}

/// 连接配置文件结构
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionsFile {
    /// 连接配置映射（名称 -> 配置）
    #[serde(default)]
    pub connections: HashMap<String, ConnectionConfig>,
}

impl ConnectionsFile {
    /// 创建空的配置文件
    pub fn new() -> Self {
        Self::default()
    }

    /// 添加连接
    pub fn add(&mut self, name: impl Into<String>, config: ConnectionConfig) {
        self.connections.insert(name.into(), config);
    }

    /// 移除连接
    pub fn remove(&mut self, name: &str) -> Option<ConnectionConfig> {
        self.connections.remove(name)
    }

    /// 获取连接
    pub fn get(&self, name: &str) -> Option<&ConnectionConfig> {
        self.connections.get(name)
    }

    /// 获取所有连接名称
    pub fn names(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }
}

/// 连接配置管理器
pub struct ConnectionConfigManager {
    /// 配置文件路径
    config_path: PathBuf,
}

impl ConnectionConfigManager {
    /// 创建配置管理器
    pub fn new() -> Self {
        Self {
            config_path: Self::default_config_path(),
        }
    }

    /// 使用自定义路径创建
    pub fn with_path(path: PathBuf) -> Self {
        Self { config_path: path }
    }

    /// 获取默认配置文件路径
    pub fn default_config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("proxycast")
            .join("connections.json")
    }

    /// 获取配置文件路径
    pub fn config_path(&self) -> &PathBuf {
        &self.config_path
    }

    /// 加载连接配置
    pub fn load(&self) -> Result<ConnectionsFile, String> {
        if !self.config_path.exists() {
            tracing::info!(
                "[ConnectionConfig] 配置文件不存在，返回空配置: {:?}",
                self.config_path
            );
            return Ok(ConnectionsFile::new());
        }

        let content =
            fs::read_to_string(&self.config_path).map_err(|e| format!("读取配置文件失败: {e}"))?;

        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {e}"))
    }

    /// 保存连接配置
    pub fn save(&self, config: &ConnectionsFile) -> Result<(), String> {
        // 确保父目录存在
        if let Some(parent) = self.config_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
            }
        }

        let content =
            serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {e}"))?;

        fs::write(&self.config_path, content).map_err(|e| format!("写入配置文件失败: {e}"))?;

        tracing::info!("[ConnectionConfig] 配置已保存: {:?}", self.config_path);
        Ok(())
    }

    /// 保存原始 JSON 内容
    pub fn save_raw(&self, content: &str) -> Result<(), String> {
        // 先验证 JSON 格式
        let _: ConnectionsFile =
            serde_json::from_str(content).map_err(|e| format!("无效的 JSON 格式: {e}"))?;

        // 确保父目录存在
        if let Some(parent) = self.config_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
            }
        }

        fs::write(&self.config_path, content).map_err(|e| format!("写入配置文件失败: {e}"))?;

        tracing::info!("[ConnectionConfig] 原始配置已保存: {:?}", self.config_path);
        Ok(())
    }

    /// 获取原始配置文件内容
    pub fn load_raw(&self) -> Result<String, String> {
        if !self.config_path.exists() {
            // 返回默认空配置
            return Ok(r#"{
  "connections": {}
}"#
            .to_string());
        }

        fs::read_to_string(&self.config_path).map_err(|e| format!("读取配置文件失败: {e}"))
    }

    /// 从系统 SSH 配置读取 Host 列表
    pub fn load_ssh_hosts(&self) -> Vec<SSHHostEntry> {
        let config_path = match SSHConfigParser::default_config_path() {
            Some(path) => path,
            None => return vec![],
        };

        if !config_path.exists() {
            return vec![];
        }

        let content = match fs::read_to_string(&config_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("[ConnectionConfig] 读取 SSH 配置失败: {}", e);
                return vec![];
            }
        };

        Self::parse_ssh_config_hosts(&content)
    }

    /// 解析 SSH 配置文件中的 Host 列表
    fn parse_ssh_config_hosts(content: &str) -> Vec<SSHHostEntry> {
        let mut hosts = Vec::new();
        let mut current_host: Option<SSHHostEntry> = None;

        for line in content.lines() {
            let line = line.trim();

            // 跳过空行和注释
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // 分割 key value
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            if parts.len() < 2 {
                continue;
            }

            let key = parts[0].to_lowercase();
            let value = parts[1].trim();

            match key.as_str() {
                "host" => {
                    // 保存之前的 Host
                    if let Some(host) = current_host.take() {
                        // 排除通配符 Host
                        if !host.pattern.contains('*') && !host.pattern.contains('?') {
                            hosts.push(host);
                        }
                    }

                    // 开始新的 Host
                    current_host = Some(SSHHostEntry {
                        pattern: value.to_string(),
                        hostname: None,
                        user: None,
                        port: None,
                        identity_file: None,
                    });
                }
                "hostname" => {
                    if let Some(ref mut host) = current_host {
                        host.hostname = Some(value.to_string());
                    }
                }
                "user" => {
                    if let Some(ref mut host) = current_host {
                        host.user = Some(value.to_string());
                    }
                }
                "port" => {
                    if let Some(ref mut host) = current_host {
                        host.port = value.parse().ok();
                    }
                }
                "identityfile" => {
                    if let Some(ref mut host) = current_host {
                        host.identity_file = Some(value.to_string());
                    }
                }
                _ => {}
            }
        }

        // 保存最后一个 Host
        if let Some(host) = current_host {
            if !host.pattern.contains('*') && !host.pattern.contains('?') {
                hosts.push(host);
            }
        }

        hosts
    }

    /// 获取所有可用连接（用户配置 + SSH 配置）
    pub fn list_all_connections(&self) -> Result<Vec<ConnectionListEntry>, String> {
        let mut entries = Vec::new();

        // 获取本地系统信息
        let local_user = whoami::username();
        let local_host = whoami::fallible::hostname().unwrap_or_else(|_| "localhost".to_string());
        let local_label = format!("{local_user}@{local_host}");

        // 添加本地连接
        entries.push(ConnectionListEntry {
            name: "local".to_string(),
            conn_type: ConnectionConfigType::Local,
            label: local_label,
            source: ConnectionSource::BuiltIn,
            host: Some(local_host),
            user: Some(local_user),
            port: None,
        });

        // 加载用户配置
        let config = self.load()?;
        for (name, conn) in config.connections {
            if conn.hidden == Some(true) {
                continue;
            }

            let label = match conn.conn_type {
                ConnectionConfigType::Ssh => {
                    let user = conn.user.as_deref().unwrap_or("user");
                    let host = conn.host.as_deref().unwrap_or("unknown");
                    let port = conn.port.unwrap_or(22);
                    if port == 22 {
                        format!("{user}@{host}")
                    } else {
                        format!("{user}@{host}:{port}")
                    }
                }
                ConnectionConfigType::Wsl => {
                    let distro = conn.wsl_distro.as_deref().unwrap_or("default");
                    format!("WSL: {distro}")
                }
                ConnectionConfigType::Local => "Local".to_string(),
            };

            entries.push(ConnectionListEntry {
                name: name.clone(),
                conn_type: conn.conn_type.clone(),
                label,
                source: ConnectionSource::UserConfig,
                host: conn.host,
                user: conn.user,
                port: conn.port,
            });
        }

        // 加载 SSH 配置
        let ssh_hosts = self.load_ssh_hosts();
        for host in ssh_hosts {
            // 检查是否已在用户配置中
            let already_exists = entries.iter().any(|e| e.name == host.pattern);
            if already_exists {
                continue;
            }

            let label = if let Some(ref user) = host.user {
                if let Some(ref hostname) = host.hostname {
                    format!("{user}@{hostname}")
                } else {
                    format!("{}@{}", user, host.pattern)
                }
            } else if let Some(ref hostname) = host.hostname {
                hostname.clone()
            } else {
                host.pattern.clone()
            };

            entries.push(ConnectionListEntry {
                name: host.pattern.clone(),
                conn_type: ConnectionConfigType::Ssh,
                label,
                source: ConnectionSource::SSHConfig,
                host: host.hostname,
                user: host.user,
                port: host.port,
            });
        }

        Ok(entries)
    }
}

impl Default for ConnectionConfigManager {
    fn default() -> Self {
        Self::new()
    }
}

/// SSH 配置中的 Host 条目
#[derive(Debug, Clone)]
pub struct SSHHostEntry {
    /// Host 模式
    pub pattern: String,
    /// 实际主机名
    pub hostname: Option<String>,
    /// 用户名
    pub user: Option<String>,
    /// 端口
    pub port: Option<u16>,
    /// 身份文件
    pub identity_file: Option<String>,
}

/// 连接来源
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionSource {
    /// 内置连接
    BuiltIn,
    /// 用户配置文件
    UserConfig,
    /// SSH 配置文件
    SSHConfig,
}

/// 连接列表条目（用于前端显示）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionListEntry {
    /// 连接名称/标识
    pub name: String,
    /// 连接类型
    #[serde(rename = "type")]
    pub conn_type: ConnectionConfigType,
    /// 显示标签
    pub label: String,
    /// 配置来源
    pub source: ConnectionSource,
    /// 主机名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// 用户名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// 端口
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_config_serialization() {
        let config = ConnectionConfig::ssh("192.168.1.100")
            .with_user("root")
            .with_port(22);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"type\":\"ssh\""));
        assert!(json.contains("\"user\":\"root\""));
        assert!(json.contains("\"host\":\"192.168.1.100\""));
    }

    #[test]
    fn test_connections_file() {
        let mut file = ConnectionsFile::new();
        file.add("test-server", ConnectionConfig::ssh("test.example.com"));

        assert_eq!(file.names().len(), 1);
        assert!(file.get("test-server").is_some());

        file.remove("test-server");
        assert!(file.get("test-server").is_none());
    }

    #[test]
    fn test_parse_ssh_config_hosts() {
        let content = r#"
Host my-server
    HostName 192.168.1.100
    User root
    Port 22

Host dev-*
    User developer

Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_key
"#;

        let hosts = ConnectionConfigManager::parse_ssh_config_hosts(content);

        // 应该有 2 个主机（排除了通配符 dev-*）
        assert_eq!(hosts.len(), 2);

        let my_server = hosts.iter().find(|h| h.pattern == "my-server").unwrap();
        assert_eq!(my_server.hostname.as_deref(), Some("192.168.1.100"));
        assert_eq!(my_server.user.as_deref(), Some("root"));
        assert_eq!(my_server.port, Some(22));

        let github = hosts.iter().find(|h| h.pattern == "github.com").unwrap();
        assert_eq!(github.user.as_deref(), Some("git"));
        assert!(github.identity_file.is_some());
    }
}
