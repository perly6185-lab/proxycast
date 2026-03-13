/**
 * @file ProviderModelList 组件
 * @description 显示 Provider 支持的模型列表，支持从 API 刷新
 * @module components/provider-pool/api-key/ProviderModelList
 */

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import {
  Eye,
  Wrench,
  Brain,
  Sparkles,
  Check,
  Loader2,
  RefreshCw,
  Cloud,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import { modelRegistryApi } from "@/lib/api/modelRegistry";
import {
  buildCatalogAliasMap,
  resolveRegistryProviderId,
} from "./providerTypeMapping";
import { getLatestSelectableModel } from "./ProviderConfigForm.utils";
import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderModelListProps {
  /** Provider ID，如 "deepseek", "openai", "anthropic" */
  providerId: string;
  /** Provider 类型（API 协议），如 "anthropic", "openai", "gemini" */
  providerType: string;
  /** 当前默认模型 ID */
  selectedModelId?: string | null;
  /** 推荐最新模型 ID */
  latestModelId?: string | null;
  /** 点击模型时设为默认模型 */
  onSelectModel?: (modelId: string) => void;
  /** 当前列表解析出的最新模型变化回调 */
  onLatestModelResolved?: (modelId: string | null) => void;
  /** 是否有可用的 API Key（用于显示刷新按钮） */
  hasApiKey?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 最大显示数量，默认显示全部 */
  maxItems?: number;
}

// ============================================================================
// API 响应类型
// ============================================================================

interface FetchModelsResult {
  models: EnhancedModelMetadata[];
  source: "Api" | "LocalFallback";
  error: string | null;
  request_url?: string | null;
  diagnostic_hint?: string | null;
  error_kind?:
    | "not_found"
    | "unauthorized"
    | "forbidden"
    | "network"
    | "invalid_response"
    | "other"
    | null;
  should_prompt_error?: boolean;
}

interface CachedProviderModels {
  models: EnhancedModelMetadata[];
  source: "Api" | "LocalFallback" | null;
  error: string | null;
  requestUrl: string | null;
  diagnosticHint: string | null;
  shouldPromptError: boolean;
}

const providerModelsCache = new Map<string, CachedProviderModels>();

function buildApiDiagnosticLines(result: {
  error: string | null;
  request_url?: string | null;
  diagnostic_hint?: string | null;
}): string[] {
  const lines: string[] = [];

  if (result.error?.trim()) {
    lines.push(result.error.trim());
  }

  if (result.request_url?.trim()) {
    lines.push(`请求地址：${result.request_url.trim()}`);
  }

  if (result.diagnostic_hint?.trim()) {
    lines.push(result.diagnostic_hint.trim());
  }

  return lines;
}

// ============================================================================
// 子组件
// ============================================================================

interface ModelItemProps {
  model: EnhancedModelMetadata;
  isDefault: boolean;
  isLatest: boolean;
  onSelect?: (modelId: string) => void;
}

/**
 * 单个模型项
 */
const ModelItem: React.FC<ModelItemProps> = ({
  model,
  isDefault,
  isLatest,
  onSelect,
}) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2 transition-colors",
        onSelect ? "cursor-pointer hover:bg-muted/50" : "hover:bg-muted/50",
        isDefault
          ? "border-primary/30 bg-primary/5"
          : "border-transparent bg-transparent",
      )}
      onClick={onSelect ? () => onSelect(model.id) : undefined}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(model.id);
              }
            }
          : undefined
      }
      data-testid={`model-item-${model.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {model.display_name}
          </span>
          {isLatest ? <Badge variant="outline">最新</Badge> : null}
          {isDefault ? <Badge variant="secondary">默认</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground truncate">{model.id}</div>
      </div>

      {/* 能力标签 */}
      <div className="flex items-center gap-1.5 ml-2">
        {isDefault && <Check className="h-3.5 w-3.5 text-primary" />}
        {model.capabilities.vision && (
          <span
            className="text-blue-500"
            title="支持视觉"
            data-testid="capability-vision"
          >
            <Eye className="h-3.5 w-3.5" />
          </span>
        )}
        {model.capabilities.tools && (
          <span
            className="text-orange-500"
            title="支持工具调用"
            data-testid="capability-tools"
          >
            <Wrench className="h-3.5 w-3.5" />
          </span>
        )}
        {model.capabilities.reasoning && (
          <span
            className="text-purple-500"
            title="支持推理"
            data-testid="capability-reasoning"
          >
            <Brain className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

/**
 * Provider 支持的模型列表组件
 *
 * 显示指定 Provider 支持的所有模型，包括模型名称和能力标签
 *
 * @example
 * ```tsx
 * <ProviderModelList providerType="anthropic" />
 * ```
 */
export const ProviderModelList: React.FC<ProviderModelListProps> = ({
  providerId,
  providerType,
  selectedModelId = null,
  latestModelId = null,
  onSelectModel,
  onLatestModelResolved,
  hasApiKey = false,
  className,
  maxItems,
}) => {
  const [catalogAliasMap, setCatalogAliasMap] = useState<Record<
    string,
    string
  > | null>(null);
  const [validRegistryProviderIds, setValidRegistryProviderIds] =
    useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const catalog = await apiKeyProviderApi.getSystemProviderCatalog();
        if (cancelled) {
          return;
        }
        setCatalogAliasMap(buildCatalogAliasMap(catalog));
      } catch {
        if (cancelled) {
          return;
        }
        setCatalogAliasMap(null);
      }
    };

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRegistryProviders = async () => {
      try {
        const providerIds =
          await modelRegistryApi.getModelRegistryProviderIds();
        if (cancelled) {
          return;
        }

        setValidRegistryProviderIds(new Set(providerIds));
      } catch {
        if (cancelled) {
          return;
        }
        setValidRegistryProviderIds(null);
      }
    };

    loadRegistryProviders();

    return () => {
      cancelled = true;
    };
  }, []);

  // 转换 Provider ID 为 registry ID（优先使用 providerId，回退到 providerType）
  const registryProviderId = useMemo(() => {
    return resolveRegistryProviderId(providerId, {
      providerType,
      catalogAliasMap,
      validRegistryProviders: validRegistryProviderIds ?? undefined,
    });
  }, [catalogAliasMap, providerId, providerType, validRegistryProviderIds]);

  // 获取模型数据
  const { models, loading, error } = useModelRegistry({
    autoLoad: true,
    providerFilter: [registryProviderId],
  });

  // 从 API 刷新状态
  const [refreshing, setRefreshing] = useState(false);
  const [apiModels, setApiModels] = useState<EnhancedModelMetadata[] | null>(
    null,
  );
  const [apiSource, setApiSource] = useState<"Api" | "LocalFallback" | null>(
    null,
  );
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiRequestUrl, setApiRequestUrl] = useState<string | null>(null);
  const [apiDiagnosticHint, setApiDiagnosticHint] = useState<string | null>(
    null,
  );
  const [apiShouldPromptError, setApiShouldPromptError] = useState(false);
  const cacheKey = `${providerId}:${providerType}`;

  useEffect(() => {
    const cached = providerModelsCache.get(cacheKey);
    if (!cached) {
      setApiModels(null);
      setApiSource(null);
      setApiError(null);
      setApiRequestUrl(null);
      setApiDiagnosticHint(null);
      setApiShouldPromptError(false);
      return;
    }

    setApiModels(cached.models);
    setApiSource(cached.source);
    setApiError(cached.error);
    setApiRequestUrl(cached.requestUrl);
    setApiDiagnosticHint(cached.diagnosticHint);
    setApiShouldPromptError(cached.shouldPromptError);
  }, [cacheKey]);

  // 从 API 获取模型列表（自动获取 API Key）
  const handleRefreshFromApi = useCallback(async () => {
    setRefreshing(true);
    setApiError(null);
    setApiRequestUrl(null);
    setApiDiagnosticHint(null);
    setApiShouldPromptError(false);

    try {
      const result = await invoke<FetchModelsResult>(
        "fetch_provider_models_auto",
        {
          providerId,
        },
      );

      if (result && result.models) {
        setApiModels(result.models);
        setApiSource(result.source);
        setApiRequestUrl(result.request_url ?? null);
        setApiDiagnosticHint(result.diagnostic_hint ?? null);
        setApiShouldPromptError(Boolean(result.should_prompt_error));
        if (result.error) {
          setApiError(result.error);
        } else {
          setApiError(null);
        }

        providerModelsCache.set(cacheKey, {
          models: result.models,
          source: result.source ?? null,
          error: result.error ?? null,
          requestUrl: result.request_url ?? null,
          diagnosticHint: result.diagnostic_hint ?? null,
          shouldPromptError: Boolean(result.should_prompt_error),
        });
      } else {
        setApiError("返回结果格式错误");
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [cacheKey, providerId]);

  // 使用 API 模型或本地模型
  const displayModelsSource = apiModels ?? models;
  const apiDiagnosticLines = buildApiDiagnosticLines({
    error: apiError,
    request_url: apiRequestUrl,
    diagnostic_hint: apiDiagnosticHint,
  });

  // 限制显示数量
  const displayModels = useMemo(() => {
    if (maxItems && maxItems > 0) {
      return displayModelsSource.slice(0, maxItems);
    }
    return displayModelsSource;
  }, [displayModelsSource, maxItems]);

  const hasMore = maxItems && displayModelsSource.length > maxItems;
  const resolvedLatestModelId =
    latestModelId ?? getLatestSelectableModel(displayModelsSource)?.id ?? null;
  const effectiveDefaultModelId = selectedModelId ?? resolvedLatestModelId;
  const resolvedLatestModelKey = resolvedLatestModelId?.toLowerCase() ?? null;
  const effectiveDefaultModelKey =
    effectiveDefaultModelId?.toLowerCase() ?? null;

  useEffect(() => {
    onLatestModelResolved?.(resolvedLatestModelId);
  }, [onLatestModelResolved, resolvedLatestModelId]);

  // 加载状态
  if (loading && !apiModels) {
    return (
      <div
        className={cn(
          "flex items-center justify-center py-8 text-muted-foreground",
          className,
        )}
        data-testid="provider-model-list-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">加载模型列表...</span>
      </div>
    );
  }

  // 错误状态
  if (error && !apiModels) {
    return (
      <div
        className={cn("py-4 text-center text-sm text-red-500", className)}
        data-testid="provider-model-list-error"
      >
        加载失败: {error}
      </div>
    );
  }

  // 空状态
  if (displayModelsSource.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center justify-between mb-2">
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              支持的模型
            </h4>
            {onSelectModel ? (
              <p className="text-xs text-muted-foreground">
                点击模型即可设为默认模型；未显式选择时，自动使用最新模型。
              </p>
            ) : null}
          </div>
          {hasApiKey && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshFromApi}
                    disabled={refreshing}
                    className="h-7 px-2"
                  >
                    {refreshing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>从 API 获取模型列表</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div
          className="py-4 text-center text-sm text-muted-foreground"
          data-testid="provider-model-list-empty"
        >
          暂无模型数据
          {hasApiKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshFromApi}
              disabled={refreshing}
              className="ml-1 h-auto p-0 text-primary underline-offset-4 hover:underline"
            >
              点击从 API 获取
            </Button>
          )}
        </div>
        {apiError && (
          <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-left text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
            {apiShouldPromptError ? (
              <div className="mb-1 font-semibold text-red-600 dark:text-red-400">
                检测到 Provider 配置错误，请优先修正 Base URL 或鉴权配置
              </div>
            ) : null}
            {apiDiagnosticLines.map((line) => (
              <div key={line} className="break-all leading-5">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("space-y-1", className)}
      data-testid="provider-model-list"
    >
      {/* 标题 */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          支持的模型
          <span className="text-xs text-muted-foreground font-normal">
            ({displayModelsSource.length})
          </span>
          {/* 数据来源标识 */}
          {apiSource && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded",
                      apiSource === "Api"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                    )}
                  >
                    {apiSource === "Api" ? (
                      <>
                        <Cloud className="h-3 w-3" />
                        API
                      </>
                    ) : (
                      <>
                        <HardDrive className="h-3 w-3" />
                        本地
                      </>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {apiSource === "Api"
                    ? "数据来自 Provider API"
                    : "API 获取失败，使用本地数据"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </h4>
        {/* 刷新按钮 */}
        {hasApiKey && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshFromApi}
                  disabled={refreshing}
                  className="h-7 px-2"
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>从 API 获取最新模型列表</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* API 错误提示 */}
      {apiError && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
          {apiShouldPromptError ? (
            <div className="mb-1 font-semibold text-red-600 dark:text-red-400">
              检测到 Provider 配置错误，请优先修正 Base URL 或鉴权配置
            </div>
          ) : null}
          {apiDiagnosticLines.map((line) => (
            <div key={line} className="break-all leading-5">
              {line}
            </div>
          ))}
        </div>
      )}

      {/* 模型列表 */}
      <div className="border rounded-md divide-y divide-border">
        {displayModels.map((model) => (
          <ModelItem
            key={model.id}
            model={model}
            isDefault={effectiveDefaultModelKey === model.id.toLowerCase()}
            isLatest={resolvedLatestModelKey === model.id.toLowerCase()}
            onSelect={onSelectModel}
          />
        ))}
      </div>

      {/* 显示更多提示 */}
      {hasMore && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          还有 {displayModelsSource.length - maxItems!} 个模型未显示
        </p>
      )}
    </div>
  );
};

export default ProviderModelList;
