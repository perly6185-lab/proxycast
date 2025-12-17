//! 凭证同步服务
//!
//! 负责将凭证池变更同步到 YAML 配置文件
//! 实现凭证的添加、删除、更新操作与配置文件的同步

use crate::config::{
    expand_tilde, ApiKeyEntry, Config, ConfigError, ConfigManager, CredentialEntry, YamlService,
};
use crate::models::provider_pool_model::{CredentialData, PoolProviderType, ProviderCredential};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// 凭证同步服务错误类型
#[derive(Debug, Clone)]
pub enum SyncError {
    /// 配置错误
    ConfigError(String),
    /// IO 错误
    IoError(String),
    /// 凭证不存在
    CredentialNotFound(String),
    /// 无效的凭证类型
    InvalidCredentialType(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::ConfigError(msg) => write!(f, "配置错误: {}", msg),
            SyncError::IoError(msg) => write!(f, "IO 错误: {}", msg),
            SyncError::CredentialNotFound(id) => write!(f, "凭证不存在: {}", id),
            SyncError::InvalidCredentialType(msg) => write!(f, "无效的凭证类型: {}", msg),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<ConfigError> for SyncError {
    fn from(err: ConfigError) -> Self {
        SyncError::ConfigError(err.to_string())
    }
}

impl From<std::io::Error> for SyncError {
    fn from(err: std::io::Error) -> Self {
        SyncError::IoError(err.to_string())
    }
}

/// 凭证同步服务
///
/// 负责将凭证池变更同步到 YAML 配置文件
pub struct CredentialSyncService {
    /// 配置管理器
    config_manager: Arc<RwLock<ConfigManager>>,
}

impl CredentialSyncService {
    /// 创建新的凭证同步服务
    pub fn new(config_manager: Arc<RwLock<ConfigManager>>) -> Self {
        Self { config_manager }
    }

    /// 获取当前配置
    fn get_config(&self) -> Result<Config, SyncError> {
        let manager = self
            .config_manager
            .read()
            .map_err(|e| SyncError::ConfigError(format!("获取配置锁失败: {}", e)))?;
        Ok(manager.config().clone())
    }

    /// 更新配置并保存
    fn update_config(&self, config: Config) -> Result<(), SyncError> {
        let mut manager = self
            .config_manager
            .write()
            .map_err(|e| SyncError::ConfigError(format!("获取配置写锁失败: {}", e)))?;

        let config_path = manager.config_path().to_path_buf();
        manager.set_config(config.clone());

        // 使用 YamlService 保存配置，保留注释
        YamlService::save_preserve_comments(&config_path, &config)?;
        Ok(())
    }

    /// 获取 auth_dir 的绝对路径
    pub fn get_auth_dir(&self) -> Result<PathBuf, SyncError> {
        let config = self.get_config()?;
        Ok(expand_tilde(&config.auth_dir))
    }

    /// 确保 auth_dir 目录存在
    pub fn ensure_auth_dir(&self) -> Result<PathBuf, SyncError> {
        let auth_dir = self.get_auth_dir()?;
        std::fs::create_dir_all(&auth_dir)?;
        Ok(auth_dir)
    }

    /// 添加凭证并同步到配置
    ///
    /// # Arguments
    /// * `credential` - 要添加的凭证
    ///
    /// # Returns
    /// * `Ok(())` - 添加成功
    /// * `Err(SyncError)` - 添加失败
    pub fn add_credential(&self, credential: &ProviderCredential) -> Result<(), SyncError> {
        let mut config = self.get_config()?;

        match &credential.credential {
            // OAuth 凭证：保存 token 文件到 auth_dir，配置中只保存相对路径
            CredentialData::KiroOAuth { creds_file_path } => {
                let token_file =
                    self.save_oauth_token_file(creds_file_path, &credential.uuid, "kiro")?;
                let entry = CredentialEntry {
                    id: credential.uuid.clone(),
                    token_file,
                    disabled: credential.is_disabled,
                };
                config.credential_pool.kiro.push(entry);
            }
            CredentialData::GeminiOAuth {
                creds_file_path, ..
            } => {
                let token_file =
                    self.save_oauth_token_file(creds_file_path, &credential.uuid, "gemini")?;
                let entry = CredentialEntry {
                    id: credential.uuid.clone(),
                    token_file,
                    disabled: credential.is_disabled,
                };
                config.credential_pool.gemini.push(entry);
            }
            CredentialData::QwenOAuth { creds_file_path } => {
                let token_file =
                    self.save_oauth_token_file(creds_file_path, &credential.uuid, "qwen")?;
                let entry = CredentialEntry {
                    id: credential.uuid.clone(),
                    token_file,
                    disabled: credential.is_disabled,
                };
                config.credential_pool.qwen.push(entry);
            }
            CredentialData::AntigravityOAuth { .. } => {
                // Antigravity 暂不支持同步到配置
                return Err(SyncError::InvalidCredentialType(
                    "Antigravity 凭证暂不支持同步到配置".to_string(),
                ));
            }
            // API Key 凭证：直接保存到 YAML
            CredentialData::OpenAIKey { api_key, base_url } => {
                let entry = ApiKeyEntry {
                    id: credential.uuid.clone(),
                    api_key: api_key.clone(),
                    base_url: base_url.clone(),
                    disabled: credential.is_disabled,
                };
                config.credential_pool.openai.push(entry);
            }
            CredentialData::ClaudeKey { api_key, base_url } => {
                let entry = ApiKeyEntry {
                    id: credential.uuid.clone(),
                    api_key: api_key.clone(),
                    base_url: base_url.clone(),
                    disabled: credential.is_disabled,
                };
                config.credential_pool.claude.push(entry);
            }
        }

        self.update_config(config)
    }

    /// 保存 OAuth token 文件到 auth_dir
    ///
    /// # Arguments
    /// * `source_path` - 源 token 文件路径
    /// * `credential_id` - 凭证 ID
    /// * `provider` - Provider 名称
    ///
    /// # Returns
    /// * `Ok(String)` - 相对于 auth_dir 的 token 文件路径
    fn save_oauth_token_file(
        &self,
        source_path: &str,
        credential_id: &str,
        provider: &str,
    ) -> Result<String, SyncError> {
        let auth_dir = self.ensure_auth_dir()?;
        let provider_dir = auth_dir.join(provider);
        std::fs::create_dir_all(&provider_dir)?;

        // 生成 token 文件名
        let token_filename = format!("{}.json", credential_id);
        let token_path = provider_dir.join(&token_filename);

        // 展开源路径并复制文件
        let source = expand_tilde(source_path);
        if source.exists() {
            std::fs::copy(&source, &token_path)?;
        }

        // 返回相对路径
        Ok(format!("{}/{}", provider, token_filename))
    }

    /// 删除凭证并同步到配置
    ///
    /// # Arguments
    /// * `provider_type` - Provider 类型
    /// * `credential_id` - 凭证 ID
    ///
    /// # Returns
    /// * `Ok(())` - 删除成功
    /// * `Err(SyncError)` - 删除失败
    pub fn remove_credential(
        &self,
        provider_type: PoolProviderType,
        credential_id: &str,
    ) -> Result<(), SyncError> {
        let mut config = self.get_config()?;
        let mut found = false;

        match provider_type {
            PoolProviderType::Kiro => {
                if let Some(pos) = config
                    .credential_pool
                    .kiro
                    .iter()
                    .position(|e| e.id == credential_id)
                {
                    let entry = config.credential_pool.kiro.remove(pos);
                    self.delete_oauth_token_file(&entry.token_file)?;
                    found = true;
                }
            }
            PoolProviderType::Gemini => {
                if let Some(pos) = config
                    .credential_pool
                    .gemini
                    .iter()
                    .position(|e| e.id == credential_id)
                {
                    let entry = config.credential_pool.gemini.remove(pos);
                    self.delete_oauth_token_file(&entry.token_file)?;
                    found = true;
                }
            }
            PoolProviderType::Qwen => {
                if let Some(pos) = config
                    .credential_pool
                    .qwen
                    .iter()
                    .position(|e| e.id == credential_id)
                {
                    let entry = config.credential_pool.qwen.remove(pos);
                    self.delete_oauth_token_file(&entry.token_file)?;
                    found = true;
                }
            }
            PoolProviderType::OpenAI => {
                if let Some(pos) = config
                    .credential_pool
                    .openai
                    .iter()
                    .position(|e| e.id == credential_id)
                {
                    config.credential_pool.openai.remove(pos);
                    found = true;
                }
            }
            PoolProviderType::Claude => {
                if let Some(pos) = config
                    .credential_pool
                    .claude
                    .iter()
                    .position(|e| e.id == credential_id)
                {
                    config.credential_pool.claude.remove(pos);
                    found = true;
                }
            }
            PoolProviderType::Antigravity => {
                return Err(SyncError::InvalidCredentialType(
                    "Antigravity 凭证暂不支持同步到配置".to_string(),
                ));
            }
        }

        if !found {
            return Err(SyncError::CredentialNotFound(credential_id.to_string()));
        }

        self.update_config(config)
    }

    /// 删除 OAuth token 文件
    fn delete_oauth_token_file(&self, token_file: &str) -> Result<(), SyncError> {
        let auth_dir = self.get_auth_dir()?;
        let token_path = auth_dir.join(token_file);
        if token_path.exists() {
            std::fs::remove_file(&token_path)?;
        }
        Ok(())
    }

    /// 更新凭证并同步到配置
    ///
    /// # Arguments
    /// * `credential` - 更新后的凭证
    ///
    /// # Returns
    /// * `Ok(())` - 更新成功
    /// * `Err(SyncError)` - 更新失败
    pub fn update_credential(&self, credential: &ProviderCredential) -> Result<(), SyncError> {
        let mut config = self.get_config()?;
        let mut found = false;

        match &credential.credential {
            CredentialData::KiroOAuth { creds_file_path } => {
                if let Some(entry) = config
                    .credential_pool
                    .kiro
                    .iter_mut()
                    .find(|e| e.id == credential.uuid)
                {
                    entry.disabled = credential.is_disabled;
                    // 如果源文件路径变化，更新 token 文件
                    let new_token_file =
                        self.save_oauth_token_file(creds_file_path, &credential.uuid, "kiro")?;
                    entry.token_file = new_token_file;
                    found = true;
                }
            }
            CredentialData::GeminiOAuth {
                creds_file_path, ..
            } => {
                if let Some(entry) = config
                    .credential_pool
                    .gemini
                    .iter_mut()
                    .find(|e| e.id == credential.uuid)
                {
                    entry.disabled = credential.is_disabled;
                    let new_token_file =
                        self.save_oauth_token_file(creds_file_path, &credential.uuid, "gemini")?;
                    entry.token_file = new_token_file;
                    found = true;
                }
            }
            CredentialData::QwenOAuth { creds_file_path } => {
                if let Some(entry) = config
                    .credential_pool
                    .qwen
                    .iter_mut()
                    .find(|e| e.id == credential.uuid)
                {
                    entry.disabled = credential.is_disabled;
                    let new_token_file =
                        self.save_oauth_token_file(creds_file_path, &credential.uuid, "qwen")?;
                    entry.token_file = new_token_file;
                    found = true;
                }
            }
            CredentialData::AntigravityOAuth { .. } => {
                return Err(SyncError::InvalidCredentialType(
                    "Antigravity 凭证暂不支持同步到配置".to_string(),
                ));
            }
            CredentialData::OpenAIKey { api_key, base_url } => {
                if let Some(entry) = config
                    .credential_pool
                    .openai
                    .iter_mut()
                    .find(|e| e.id == credential.uuid)
                {
                    entry.api_key = api_key.clone();
                    entry.base_url = base_url.clone();
                    entry.disabled = credential.is_disabled;
                    found = true;
                }
            }
            CredentialData::ClaudeKey { api_key, base_url } => {
                if let Some(entry) = config
                    .credential_pool
                    .claude
                    .iter_mut()
                    .find(|e| e.id == credential.uuid)
                {
                    entry.api_key = api_key.clone();
                    entry.base_url = base_url.clone();
                    entry.disabled = credential.is_disabled;
                    found = true;
                }
            }
        }

        if !found {
            return Err(SyncError::CredentialNotFound(credential.uuid.clone()));
        }

        self.update_config(config)
    }

    /// 从配置加载凭证到池中
    ///
    /// 启动时从 YAML 配置加载凭证
    ///
    /// # Returns
    /// * `Ok(Vec<ProviderCredential>)` - 加载的凭证列表
    /// * `Err(SyncError)` - 加载失败
    pub fn load_from_config(&self) -> Result<Vec<ProviderCredential>, SyncError> {
        let config = self.get_config()?;
        let auth_dir = self.get_auth_dir()?;
        let mut credentials = Vec::new();

        // 加载 Kiro 凭证
        for entry in &config.credential_pool.kiro {
            let token_path = auth_dir.join(&entry.token_file);
            let cred = ProviderCredential::new(
                PoolProviderType::Kiro,
                CredentialData::KiroOAuth {
                    creds_file_path: token_path.to_string_lossy().to_string(),
                },
            );
            let mut cred = cred;
            cred.uuid = entry.id.clone();
            cred.is_disabled = entry.disabled;
            credentials.push(cred);
        }

        // 加载 Gemini 凭证
        for entry in &config.credential_pool.gemini {
            let token_path = auth_dir.join(&entry.token_file);
            let cred = ProviderCredential::new(
                PoolProviderType::Gemini,
                CredentialData::GeminiOAuth {
                    creds_file_path: token_path.to_string_lossy().to_string(),
                    project_id: None,
                },
            );
            let mut cred = cred;
            cred.uuid = entry.id.clone();
            cred.is_disabled = entry.disabled;
            credentials.push(cred);
        }

        // 加载 Qwen 凭证
        for entry in &config.credential_pool.qwen {
            let token_path = auth_dir.join(&entry.token_file);
            let cred = ProviderCredential::new(
                PoolProviderType::Qwen,
                CredentialData::QwenOAuth {
                    creds_file_path: token_path.to_string_lossy().to_string(),
                },
            );
            let mut cred = cred;
            cred.uuid = entry.id.clone();
            cred.is_disabled = entry.disabled;
            credentials.push(cred);
        }

        // 加载 OpenAI 凭证
        for entry in &config.credential_pool.openai {
            let cred = ProviderCredential::new(
                PoolProviderType::OpenAI,
                CredentialData::OpenAIKey {
                    api_key: entry.api_key.clone(),
                    base_url: entry.base_url.clone(),
                },
            );
            let mut cred = cred;
            cred.uuid = entry.id.clone();
            cred.is_disabled = entry.disabled;
            credentials.push(cred);
        }

        // 加载 Claude 凭证
        for entry in &config.credential_pool.claude {
            let cred = ProviderCredential::new(
                PoolProviderType::Claude,
                CredentialData::ClaudeKey {
                    api_key: entry.api_key.clone(),
                    base_url: entry.base_url.clone(),
                },
            );
            let mut cred = cred;
            cred.uuid = entry.id.clone();
            cred.is_disabled = entry.disabled;
            credentials.push(cred);
        }

        Ok(credentials)
    }

    /// 获取 OAuth token 文件的完整路径
    ///
    /// # Arguments
    /// * `token_file` - 相对于 auth_dir 的 token 文件路径
    ///
    /// # Returns
    /// * `Ok(PathBuf)` - 完整路径
    pub fn get_token_file_path(&self, token_file: &str) -> Result<PathBuf, SyncError> {
        let auth_dir = self.get_auth_dir()?;
        Ok(auth_dir.join(token_file))
    }

    /// 读取 OAuth token 文件内容
    ///
    /// # Arguments
    /// * `token_file` - 相对于 auth_dir 的 token 文件路径
    ///
    /// # Returns
    /// * `Ok(String)` - token 文件内容
    pub fn read_token_file(&self, token_file: &str) -> Result<String, SyncError> {
        let path = self.get_token_file_path(token_file)?;
        std::fs::read_to_string(&path).map_err(SyncError::from)
    }

    /// 写入 OAuth token 文件内容
    ///
    /// # Arguments
    /// * `token_file` - 相对于 auth_dir 的 token 文件路径
    /// * `content` - token 文件内容
    ///
    /// # Returns
    /// * `Ok(())` - 写入成功
    pub fn write_token_file(&self, token_file: &str, content: &str) -> Result<(), SyncError> {
        let path = self.get_token_file_path(token_file)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, content).map_err(SyncError::from)
    }
}
