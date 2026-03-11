export {
  checkApiCompatibility,
  type ApiCheckResult,
  type ApiCompatibilityResult,
} from "@/lib/api/apiCompatibility";
export {
  getEndpointProviders,
  setEndpointProvider,
  type EndpointProvidersConfig,
} from "@/lib/api/endpointProviders";
export { revealPathInFinder as revealInFinder } from "@/lib/api/fileSystem";
export {
  ensureDefaultWorkspaceReady as workspaceEnsureDefaultReady,
  ensureWorkspaceReady as workspaceEnsureReady,
  type WorkspaceEnsureResult,
} from "@/lib/api/project";
export {
  checkAndReloadCredentials,
  checkAndReloadGeminiCredentials,
  checkAndReloadQwenCredentials,
  getClaudeCustomStatus,
  getEnvVariables,
  getGeminiCredentials,
  getGeminiEnvVariables,
  getGeminiTokenFileHash,
  getKiroCredentials,
  getOpenAICustomStatus,
  getQwenCredentials,
  getQwenEnvVariables,
  getQwenTokenFileHash,
  getTokenFileHash,
  refreshGeminiToken,
  refreshKiroToken,
  refreshQwenToken,
  reloadCredentials,
  reloadGeminiCredentials,
  reloadQwenCredentials,
  setClaudeCustomConfig,
  setOpenAICustomConfig,
} from "@/lib/api/providerRuntime";
export { getNetworkInfo, testApi } from "@/lib/api/serverTools";
export {
  discordChannelProbe,
  feishuChannelProbe,
  gatewayChannelStart,
  gatewayChannelStatus,
  gatewayChannelStop,
  gatewayTunnelCreate,
  gatewayTunnelDetectCloudflared,
  gatewayTunnelInstallCloudflared,
  gatewayTunnelProbe,
  gatewayTunnelRestart,
  gatewayTunnelStart,
  gatewayTunnelStatus,
  gatewayTunnelStop,
  gatewayTunnelSyncWebhookUrl,
  telegramChannelProbe,
} from "@/lib/api/channelsRuntime";
export { getAvailableModels } from "@/lib/api/modelCatalog";
export {
  getExperimentalConfig,
  saveExperimentalConfig,
  updateScreenshotShortcut,
  validateShortcut,
} from "@/lib/api/experimentalFeatures";
export {
  getDailyUsageTrends,
  getModelUsageRanking,
  getUsageStats,
} from "@/lib/api/usageStats";
export {
  exportSupportBundle,
  getLogStorageDiagnostics,
  getServerDiagnostics,
  getServerStatus,
  getWindowsStartupDiagnostics,
  startServer,
  stopServer,
} from "@/lib/api/serverRuntime";
export {
  deleteAvatar,
  type UploadResult,
  uploadAvatar,
} from "@/lib/api/profileAssets";
export {
  getConfig,
  getDefaultProvider,
  getEnvironmentPreview,
  saveConfig,
  setDefaultProvider,
  updateProviderEnvVars,
} from "@/lib/api/appConfig";
export type {
  AssistantConfig,
  ChatAppearanceConfig,
  Config,
  ContentCreatorConfig,
  CrashReportingConfig,
  EnvironmentConfig,
  EnvironmentPreview,
  EnvironmentPreviewEntry,
  EnvironmentVariableOverride,
  ImageGenConfig,
  MultiSearchConfig,
  MultiSearchEngineEntryConfig,
  NavigationConfig,
  QuotaExceededConfig,
  RemoteManagementConfig,
  ResponseCacheConfig,
  ShellImportPreview,
  TlsConfig,
  UserProfile,
  VoiceConfig,
} from "@/lib/api/appConfig";
export {
  clearDiagnosticLogHistory,
  clearLogs,
  getLogs,
  getPersistedLogsTail,
} from "@/lib/api/logs";
export {
  cleanupMemory,
  getMemoryStats,
  getMemoryAutoIndex,
  getMemoryEffectiveSources,
  getMemoryOverview,
  requestMemoryAnalysis,
  toggleMemoryAuto,
  updateMemoryAutoNote,
} from "@/lib/api/memoryRuntime";
export type { NetworkInfo, TestResult } from "@/lib/api/serverTools";
export type {
  AmpConfig,
  AmpModelMapping,
  ApiKeyEntry,
  CheckResult,
  ClaudeCustomStatus,
  CredentialEntry,
  CredentialPoolConfig,
  EnvVariable,
  GeminiApiKeyEntry,
  GeminiCredentialStatus,
  IFlowCredentialEntry,
  KiroCredentialStatus,
  OpenAICustomStatus,
  QwenCredentialStatus,
  VertexApiKeyEntry,
  VertexModelAlias,
} from "@/lib/api/providerRuntime";
export type {
  ExperimentalFeatures,
  SmartInputConfig,
  ToolCallingConfig,
} from "@/lib/api/experimentalFeatures";
export type { ModelInfo } from "@/lib/api/modelCatalog";
export type {
  DailyUsage,
  ModelUsage,
  UsageStatsResponse,
} from "@/lib/api/usageStats";
export type {
  AutoMemoryIndexResponse,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  EffectiveMemorySource,
  MemoryAnalysisResult,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemoryCategoryStat,
  MemoryConfig,
  MemoryEntryPreview,
  MemoryOverviewResponse,
  MemoryProfileConfig,
  MemoryResolveConfig,
  MemorySourcesConfig,
  MemoryStatsResponse,
} from "@/lib/api/memoryRuntime";
export type {
  ChannelsConfig,
  CloudflaredInstallResult,
  CloudflaredInstallStatus,
  CloudflareTunnelConfig,
  DiscordAccountConfig,
  DiscordActionsConfig,
  DiscordAgentComponentsConfig,
  DiscordAutoPresenceConfig,
  DiscordBotConfig,
  DiscordChannelConfig,
  DiscordExecApprovalsConfig,
  DiscordGatewayAccountStatus,
  DiscordGatewayStatus,
  DiscordGuildConfig,
  DiscordIntentsConfig,
  DiscordProbeResult,
  DiscordThreadBindingsConfig,
  DiscordUiComponentsConfig,
  DiscordUiConfig,
  DiscordVoiceAutoJoinConfig,
  DiscordVoiceConfig,
  FeishuAccountConfig,
  FeishuBotConfig,
  FeishuGatewayAccountStatus,
  FeishuGatewayStatus,
  FeishuGroupConfig,
  FeishuProbeResult,
  GatewayChannelStatusResponse,
  GatewayConfig,
  GatewayTunnelConfig,
  GatewayTunnelCreateResponse,
  GatewayTunnelProbeResult,
  GatewayTunnelStatus,
  GatewayTunnelSyncWebhookResponse,
  TelegramBotConfig,
  TelegramGatewayAccountStatus,
  TelegramGatewayStatus,
  TelegramProbeResult,
} from "@/lib/api/channelsRuntime";
export type {
  CapabilityRoutingMetricsSnapshot,
  IdempotencyConfig,
  IdempotencyDiagnostics,
  IdempotencyStats,
  LogArtifactEntry,
  LogStorageDiagnostics,
  RequestDedupConfig,
  RequestDedupDiagnostics,
  RequestDedupStats,
  ResponseCacheDiagnostics,
  ResponseCacheStats,
  ServerDiagnostics,
  ServerStatus,
  SupportBundleExportResult,
  TelemetrySummary,
  WindowsStartupCheck,
  WindowsStartupDiagnostics,
} from "@/lib/api/serverRuntime";
export type { LogEntry } from "@/lib/api/logs";
export {
  getAvailableVoices,
  testTts,
  type TtsTestResult,
  type VoiceOption,
} from "@/lib/api/voiceTools";

/**
 * 更新 Provider 的环境变量
 *
 * 当用户在团队共享网关页面选择一个 API Key Provider 时调用
 * 会更新 ~/.claude/settings.json 和 shell 配置文件中的环境变量
 *
 * @param providerType Provider 类型（如 "anthropic", "openai", "gemini"）
 * @param apiHost Provider 的 API Host
 * @param apiKey 可选的 API Key
 */
