import { safeInvoke } from "@/lib/dev-bridge";

export interface EndpointProvidersConfig {
  cursor?: string | null;
  claude_code?: string | null;
  codex?: string | null;
  windsurf?: string | null;
  kiro?: string | null;
  other?: string | null;
}

export async function getEndpointProviders(): Promise<EndpointProvidersConfig> {
  return safeInvoke("get_endpoint_providers");
}

export async function setEndpointProvider(
  clientType: string,
  provider: string | null,
): Promise<string> {
  return safeInvoke("set_endpoint_provider", {
    endpoint: clientType,
    provider,
  });
}
