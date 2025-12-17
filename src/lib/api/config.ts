import { invoke } from "@tauri-apps/api/core";

// Config types matching Rust backend
export interface ServerConfig {
  host: string;
  port: number;
  api_key: string;
}

export interface ProviderConfig {
  enabled: boolean;
  credentials_path?: string;
  region?: string;
  project_id?: string;
}

export interface CustomProviderConfig {
  enabled: boolean;
  api_key?: string;
  base_url?: string;
}

export interface ProvidersConfig {
  kiro: ProviderConfig;
  gemini: ProviderConfig;
  qwen: ProviderConfig;
  openai: CustomProviderConfig;
  claude: CustomProviderConfig;
}

export interface RoutingRuleConfig {
  pattern: string;
  provider: string;
  priority: number;
}

export interface RoutingConfig {
  default_provider: string;
  rules: RoutingRuleConfig[];
  model_aliases: Record<string, string>;
  exclusions: Record<string, string[]>;
}

export interface RetrySettings {
  max_retries: number;
  base_delay_ms: number;
  max_delay_ms: number;
  auto_switch_provider: boolean;
}

export interface LoggingConfig {
  enabled: boolean;
  level: string;
  retention_days: number;
  include_request_body: boolean;
}

// Credential pool types
export interface CredentialEntry {
  id: string;
  token_file: string;
  disabled: boolean;
}

export interface ApiKeyEntry {
  id: string;
  api_key: string;
  base_url?: string;
  disabled: boolean;
}

export interface CredentialPoolConfig {
  kiro: CredentialEntry[];
  gemini: CredentialEntry[];
  qwen: CredentialEntry[];
  openai: ApiKeyEntry[];
  claude: ApiKeyEntry[];
}

export interface Config {
  server: ServerConfig;
  providers: ProvidersConfig;
  default_provider: string;
  routing: RoutingConfig;
  retry: RetrySettings;
  logging: LoggingConfig;
  auth_dir: string;
  credential_pool: CredentialPoolConfig;
}

// Export result
export interface ExportResult {
  content: string;
  suggested_filename: string;
}

// Unified export options
export interface UnifiedExportOptions {
  include_config: boolean;
  include_credentials: boolean;
  redact_secrets: boolean;
}

// Unified export result
export interface UnifiedExportResult {
  content: string;
  suggested_filename: string;
  redacted: boolean;
  has_config: boolean;
  has_credentials: boolean;
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  version: string | null;
  redacted: boolean;
  has_config: boolean;
  has_credentials: boolean;
  errors: string[];
  warnings: string[];
}

// Import result
export interface ImportResult {
  success: boolean;
  config: Config;
  warnings: string[];
}

// Config path info
export interface ConfigPathInfo {
  yaml_path: string;
  json_path: string;
  yaml_exists: boolean;
  json_exists: boolean;
}

export const configApi = {
  // Export config to YAML
  async exportConfig(
    config: Config,
    redactSecrets: boolean,
  ): Promise<ExportResult> {
    return invoke("export_config", { config, redactSecrets });
  },

  // Export bundle (config + credentials)
  async exportBundle(
    config: Config,
    options: UnifiedExportOptions,
  ): Promise<UnifiedExportResult> {
    return invoke("export_bundle", { config, options });
  },

  // Validate import content (JSON bundle or YAML config)
  async validateImport(content: string): Promise<ValidationResult> {
    return invoke("validate_import", { content });
  },

  // Validate YAML config
  async validateConfigYaml(yamlContent: string): Promise<Config> {
    return invoke("validate_config_yaml", { yamlContent });
  },

  // Import config from YAML
  async importConfig(
    currentConfig: Config,
    yamlContent: string,
    merge: boolean,
  ): Promise<ImportResult> {
    return invoke("import_config", { currentConfig, yamlContent, merge });
  },

  // Import bundle (JSON bundle or YAML config)
  async importBundle(
    currentConfig: Config,
    content: string,
    merge: boolean,
  ): Promise<ImportResult> {
    return invoke("import_bundle", { currentConfig, content, merge });
  },

  // Get config file paths
  async getConfigPaths(): Promise<ConfigPathInfo> {
    return invoke("get_config_paths");
  },
};
