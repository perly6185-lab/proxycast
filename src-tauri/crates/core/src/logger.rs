//! 日志管理模块
use crate::app_paths;
use crate::config::LoggingConfig;
use chrono::{Duration, Local, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct LogStoreConfig {
    pub max_logs: usize,
    pub retention_days: u32,
    pub max_file_size: u64,
    pub enable_file_logging: bool,
}

impl Default for LogStoreConfig {
    fn default() -> Self {
        Self {
            max_logs: 1000,
            retention_days: 7,
            max_file_size: 10 * 1024 * 1024,
            enable_file_logging: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

pub struct LogStore {
    logs: VecDeque<LogEntry>,
    max_logs: usize,
    config: LogStoreConfig,
    log_file_path: Option<PathBuf>,
}

impl Default for LogStore {
    fn default() -> Self {
        let log_dir = app_paths::best_effort_runtime_subdir("logs");
        let _ = fs::create_dir_all(&log_dir);
        let log_file = log_dir.join("proxycast.log");
        let config = LogStoreConfig::default();
        Self {
            logs: VecDeque::new(),
            max_logs: config.max_logs,
            config,
            log_file_path: Some(log_file),
        }
    }
}

impl LogStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义配置创建 LogStore
    pub fn with_custom_config(retention_days: u32, enabled: bool) -> Self {
        let mut store = Self::default();
        store.config.retention_days = retention_days;
        store.config.enable_file_logging = enabled;
        store.max_logs = store.config.max_logs;
        store
    }

    pub fn add(&mut self, level: &str, message: &str) {
        let sanitized = sanitize_log_message(message);
        let now = Utc::now();
        let entry = LogEntry {
            timestamp: now.to_rfc3339(),
            level: level.to_string(),
            message: sanitized.clone(),
        };
        self.logs.push_back(entry.clone());
        if self.config.enable_file_logging {
            if let Some(ref path) = self.log_file_path {
                self.rotate_log_file_if_needed(path);
                let local_time = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
                let log_line = format!("{} [{}] {}\n", local_time, level.to_uppercase(), sanitized);
                if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
                    let _ = file.write_all(log_line.as_bytes());
                }
                self.prune_old_logs(path);
            }
        }
        if self.logs.len() > self.max_logs {
            self.logs.pop_front();
        }
    }

    /// 记录原始响应到单独的文件（用于调试）
    pub fn log_raw_response(&self, request_id: &str, body: &str) {
        if let Some(ref log_path) = self.log_file_path {
            let log_dir = log_path.parent().unwrap_or(std::path::Path::new("."));
            let raw_file = log_dir.join(format!("raw_response_{request_id}.txt"));
            let sanitized = sanitize_log_message(body);
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&raw_file)
            {
                let _ = file.write_all(sanitized.as_bytes());
            }
        }
    }

    pub fn get_logs(&self) -> Vec<LogEntry> {
        self.logs.iter().cloned().collect()
    }

    pub fn clear(&mut self) {
        self.logs.clear();
        if let Some(ref path) = self.log_file_path {
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(path)
            {
                let _ = file.write_all(b"");
            }
        }
    }

    pub fn get_log_file_path(&self) -> Option<String> {
        self.log_file_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
    }

    fn rotate_log_file_if_needed(&self, path: &Path) {
        let Ok(metadata) = fs::metadata(path) else {
            return;
        };
        if metadata.len() <= self.config.max_file_size {
            return;
        }
        let suffix = Local::now().format("%Y%m%d-%H%M%S");
        let rotated = path.with_file_name(format!(
            "{}.{}",
            path.file_name().unwrap_or_default().to_string_lossy(),
            suffix
        ));
        let _ = fs::rename(path, &rotated);
        self.prune_old_logs(path);
    }

    fn prune_old_logs(&self, path: &Path) {
        let Some(dir) = path.parent() else { return };
        self.archive_old_logs(path);
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let cutoff = Utc::now() - Duration::days(self.config.retention_days as i64);
        let prefix = format!(
            "{}.",
            path.file_name().unwrap_or_default().to_string_lossy()
        );
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if !file_name.starts_with(&prefix) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let Ok(modified) = metadata.modified() else {
                continue;
            };
            let modified = chrono::DateTime::<Utc>::from(modified);
            if modified < cutoff {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    fn archive_old_logs(&self, path: &Path) {
        let Some(dir) = path.parent() else { return };
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let archive_cutoff = Utc::now() - Duration::days(7);
        let delete_cutoff = Utc::now() - Duration::days(30);
        let prefix = format!(
            "{}.",
            path.file_name().unwrap_or_default().to_string_lossy()
        );
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if !file_name.starts_with(&prefix) {
                continue;
            }
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let Ok(modified) = metadata.modified() else {
                continue;
            };
            let modified = chrono::DateTime::<Utc>::from(modified);
            // 删除超过 30 天的 gz 文件
            if file_name.ends_with(".gz") {
                if modified < delete_cutoff {
                    let _ = fs::remove_file(path);
                }
                continue;
            }
            // 跳过不到 7 天的文件
            if modified >= archive_cutoff {
                continue;
            }
            // 压缩超过 7 天的日志文件
            let mut input = Vec::new();
            if let Ok(mut file) = fs::File::open(&path) {
                if file.read_to_end(&mut input).is_err() {
                    continue;
                }
            } else {
                continue;
            }
            let gz_path = path.with_extension(format!(
                "{}.gz",
                path.extension().unwrap_or_default().to_string_lossy()
            ));
            if let Ok(gz_file) = fs::File::create(&gz_path) {
                let mut encoder =
                    flate2::write::GzEncoder::new(gz_file, flate2::Compression::default());
                if encoder.write_all(&input).is_ok() && encoder.finish().is_ok() {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

pub type SharedLogStore = Arc<parking_lot::RwLock<LogStore>>;

pub fn create_log_store_from_config(logging: &LoggingConfig) -> LogStore {
    LogStore::with_custom_config(logging.retention_days, logging.enabled)
}

/// P2 安全修复：扩展日志脱敏规则，覆盖更多敏感字段
pub fn sanitize_log_message(message: &str) -> String {
    let patterns = [
        (r"Bearer\s+[A-Za-z0-9._-]+", "Bearer ***"),
        (
            r#"api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+"#,
            "api_key: ***",
        ),
        (r#"token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+"#, "token: ***"),
        (
            r#"access[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+"#,
            "access_token: ***",
        ),
        (
            r#"refresh[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+"#,
            "refresh_token: ***",
        ),
        (
            r#"client[_-]?secret["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+"#,
            "client_secret: ***",
        ),
        (
            r#"[Aa]uthorization["']?\s*[:=]\s*["']?[A-Za-z0-9._\s-]+"#,
            "authorization: ***",
        ),
        (r#"password["']?\s*[:=]\s*["']?[^\s"',}]+"#, "password: ***"),
        (
            r#"secret["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+"#,
            "secret: ***",
        ),
    ];
    let mut sanitized = message.to_string();
    for (pattern, replacement) in patterns {
        if let Ok(re) = Regex::new(pattern) {
            sanitized = re.replace_all(&sanitized, replacement).to_string();
        }
    }
    sanitized
}

#[cfg(test)]
mod tests {
    use super::sanitize_log_message;

    #[test]
    fn test_sanitize_bearer_token() {
        let input = "Authorization: Bearer abcDEF123._-XYZ";
        let output = sanitize_log_message(input);
        assert!(!output.contains("abcDEF123"));
        assert!(output.contains("***"));
    }

    #[test]
    fn test_sanitize_api_key() {
        let input = r#"request api_key="sk-test_123.456-ABC" end"#;
        let output = sanitize_log_message(input);
        assert!(output.contains("api_key: ***"));
        assert!(!output.contains("sk-test_123"));
    }

    #[test]
    fn test_sanitize_access_token() {
        let input = "access_token=atk_12345";
        let output = sanitize_log_message(input);
        assert!(output.contains("access_token: ***"));
        assert!(!output.contains("atk_12345"));
    }

    #[test]
    fn test_sanitize_refresh_token() {
        let input = "refresh_token: rtk_ABCDE-123";
        let output = sanitize_log_message(input);
        assert!(output.contains("refresh_token: ***"));
        assert!(!output.contains("rtk_ABCDE"));
    }

    #[test]
    fn test_sanitize_client_secret() {
        let input = "client_secret = \"cs_SeCreT-999\"";
        let output = sanitize_log_message(input);
        assert!(output.contains("client_secret: ***"));
        assert!(!output.contains("cs_SeCreT"));
    }

    #[test]
    fn test_sanitize_password() {
        let input = r#"{"password":"p@ssW0rd!"}"#;
        let output = sanitize_log_message(input);
        assert!(output.contains("password: ***"));
        assert!(!output.contains("p@ssW0rd!"));
    }

    #[test]
    fn test_plain_text_unchanged() {
        let input = "这是一段普通日志，不包含任何敏感字段。";
        let output = sanitize_log_message(input);
        assert_eq!(output, input);
    }
}
