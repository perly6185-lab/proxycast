import React, { useState, useMemo, useEffect, useRef } from "react";
import { Bot, ChevronDown, Check, Box, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Navbar } from "../styles";
import { cn } from "@/lib/utils";
import { useProviderPool } from "@/hooks/useProviderPool";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import { getDefaultProvider } from "@/hooks/useTauri";

// OAuth 凭证类型到显示名称和 registry ID 的映射
const CREDENTIAL_TYPE_CONFIG: Record<
  string,
  { label: string; registryId: string }
> = {
  kiro: { label: "Kiro", registryId: "anthropic" },
  gemini: { label: "Gemini", registryId: "google" },
  qwen: { label: "通义千问", registryId: "alibaba" },
  antigravity: { label: "Antigravity", registryId: "google" },
  codex: { label: "Codex", registryId: "openai" },
  claude_oauth: { label: "Claude OAuth", registryId: "anthropic" },
  iflow: { label: "iFlow", registryId: "custom" },
  openai: { label: "OpenAI", registryId: "openai" },
  claude: { label: "Claude", registryId: "anthropic" },
  gemini_api_key: { label: "Gemini", registryId: "google" },
};

// API Key Provider ID 到 registry provider_id 的映射（仅用于特殊情况）
// 大多数 Provider 的 id 直接对应 model_registry 的 provider_id
const API_KEY_PROVIDER_REGISTRY_OVERRIDE: Record<string, string> = {
  // 云服务映射到原始厂商
  "azure-openai": "openai",
  vertexai: "google",
  // Google 的特殊映射
  gemini: "google",
};

/** 已配置的 Provider 信息 */
interface ConfiguredProvider {
  key: string;
  label: string;
  registryId: string;
}

interface ChatNavbarProps {
  providerType: string;
  setProviderType: (type: string) => void;
  model: string;
  setModel: (model: string) => void;
  isRunning: boolean;
  onToggleHistory: () => void;
  onToggleFullscreen: () => void;
  onToggleSettings?: () => void;
}

export const ChatNavbar: React.FC<ChatNavbarProps> = ({
  providerType,
  setProviderType,
  model,
  setModel,
  isRunning: _isRunning,
  onToggleHistory,
  onToggleFullscreen: _onToggleFullscreen,
  onToggleSettings,
}) => {
  const [open, setOpen] = useState(false);
  const [serverDefaultProvider, setServerDefaultProvider] = useState<
    string | null
  >(null);

  // 用于防止无限循环
  const hasInitialized = useRef(false);
  const prevProviderType = useRef(providerType);

  // 获取凭证池数据
  const { overview: oauthCredentials } = useProviderPool();
  const { providers: apiKeyProviders } = useApiKeyProvider();

  // 获取服务器默认 Provider
  useEffect(() => {
    const loadDefaultProvider = async () => {
      try {
        const dp = await getDefaultProvider();
        setServerDefaultProvider(dp);
      } catch (e) {
        console.error("Failed to get default provider:", e);
      }
    };
    loadDefaultProvider();
  }, []);

  // 获取模型注册表数据
  const { models: registryModels } = useModelRegistry({ autoLoad: true });

  // 计算已配置的 Provider 列表
  const configuredProviders = useMemo(() => {
    const providerMap = new Map<string, ConfiguredProvider>();

    // 从 OAuth 凭证提取 Provider
    oauthCredentials.forEach((overview) => {
      if (overview.credentials.length > 0) {
        const config = CREDENTIAL_TYPE_CONFIG[overview.provider_type];
        if (config && !providerMap.has(overview.provider_type)) {
          providerMap.set(overview.provider_type, {
            key: overview.provider_type,
            label: config.label,
            registryId: config.registryId,
          });
        }
      }
    });

    // 从 API Key Provider 提取（只包含有 API Key 的）
    // 使用 provider.id 而不是 provider.type，以支持 Deepseek 等自定义 Provider
    apiKeyProviders
      .filter((p) => p.api_key_count > 0 && p.enabled)
      .forEach((provider) => {
        // 使用 provider.id 作为唯一标识
        if (!providerMap.has(provider.id)) {
          // 获取 registry ID：优先使用 override 映射，否则使用 provider.id
          const registryId =
            API_KEY_PROVIDER_REGISTRY_OVERRIDE[provider.id] || provider.id;
          providerMap.set(provider.id, {
            key: provider.id,
            label: provider.name, // 使用 provider.name 作为显示名称
            registryId: registryId,
          });
        }
      });

    return Array.from(providerMap.values());
  }, [oauthCredentials, apiKeyProviders]);

  // 获取当前选中 Provider 的配置
  const selectedProvider = useMemo(() => {
    return configuredProviders.find((p) => p.key === providerType);
  }, [configuredProviders, providerType]);

  // 获取当前 Provider 的模型列表（从 model_registry 获取）
  const currentModels = useMemo(() => {
    if (!selectedProvider) return [];

    // 从 model_registry 获取模型
    return registryModels
      .filter((m) => m.provider_id === selectedProvider.registryId)
      .map((m) => m.id);
  }, [selectedProvider, registryModels]);

  // 初始化：优先选择服务器默认 Provider，否则选择第一个已配置的
  useEffect(() => {
    if (hasInitialized.current) return;
    if (configuredProviders.length === 0) return;
    if (serverDefaultProvider === null) return; // 等待服务器默认 Provider 加载完成

    // 检查服务器默认 Provider 是否在已配置列表中
    const serverDefaultInList = configuredProviders.find(
      (p) => p.key === serverDefaultProvider,
    );

    if (serverDefaultInList) {
      // 服务器默认 Provider 在列表中，使用它
      hasInitialized.current = true;
      if (providerType !== serverDefaultProvider) {
        setProviderType(serverDefaultProvider);
      }
    } else if (!selectedProvider) {
      // 服务器默认 Provider 不在列表中，使用第一个已配置的
      hasInitialized.current = true;
      setProviderType(configuredProviders[0].key);
    } else {
      hasInitialized.current = true;
    }
  }, [
    configuredProviders,
    selectedProvider,
    setProviderType,
    serverDefaultProvider,
    providerType,
  ]);

  // 当 Provider 切换时，自动选择第一个模型
  useEffect(() => {
    // 只在 Provider 真正变化时触发
    if (providerType === prevProviderType.current) return;
    prevProviderType.current = providerType;

    if (currentModels.length > 0 && !currentModels.includes(model)) {
      setModel(currentModels[0]);
    }
  }, [providerType, currentModels, model, setModel]);

  const selectedProviderLabel = selectedProvider?.label || providerType;

  return (
    <Navbar>
      <div className="flex items-center gap-2">
        {/* History Toggle (Left) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onToggleHistory}
        >
          <Box size={18} />
        </Button>
      </div>

      {/* Center: Model Selector */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              role="combobox"
              aria-expanded={open}
              className="h-9 px-3 gap-2 font-normal hover:bg-muted text-foreground"
            >
              <Bot size={16} className="text-primary" />
              <span className="font-medium">{selectedProviderLabel}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm">{model || "Select Model"}</span>
              <ChevronDown className="ml-1 h-3 w-3 text-muted-foreground opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[420px] p-0 bg-background/95 backdrop-blur-sm border-border shadow-lg"
            align="center"
          >
            {/* Provider/Model Selection */}
            <div className="flex h-[300px]">
              {/* Left Column: Providers (只显示已配置的) */}
              <div className="w-[140px] border-r bg-muted/30 p-2 flex flex-col gap-1 overflow-y-auto">
                <div className="text-xs font-semibold text-muted-foreground px-2 py-1.5 mb-1">
                  Providers
                </div>
                {configuredProviders.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    暂无已配置的 Provider
                  </div>
                ) : (
                  configuredProviders.map((provider) => {
                    // 判断是否是服务器默认 Provider
                    const isServerDefault =
                      serverDefaultProvider === provider.key;
                    const isSelected = providerType === provider.key;

                    return (
                      <button
                        key={provider.key}
                        onClick={() => {
                          setProviderType(provider.key);
                        }}
                        className={cn(
                          "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md transition-colors text-left",
                          isSelected
                            ? "bg-primary/10 text-primary font-medium"
                            : isServerDefault
                              ? "hover:bg-muted text-foreground hover:text-foreground"
                              : "hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground",
                        )}
                      >
                        {provider.label}
                        {isSelected && (
                          <div className="w-1 h-1 rounded-full bg-primary" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Right Column: Models */}
              <div className="flex-1 p-2 flex flex-col overflow-hidden">
                <div className="text-xs font-semibold text-muted-foreground px-2 py-1.5 mb-1">
                  Models
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-1 p-1">
                    {currentModels.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-2">
                        No models available
                      </div>
                    ) : (
                      currentModels.map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setModel(m);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md transition-colors text-left group",
                            model === m
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m}
                          {model === m && (
                            <Check size={14} className="text-primary" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Right: Status & Settings */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onToggleSettings}
        >
          <Settings2 size={18} />
        </Button>
      </div>
    </Navbar>
  );
};
