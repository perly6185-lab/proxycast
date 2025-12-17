import { useState, useEffect, useCallback } from "react";
import {
  providerPoolApi,
  ProviderPoolOverview,
  CredentialDisplay,
  PoolProviderType,
  HealthCheckResult,
  UpdateCredentialRequest,
  OAuthStatus,
} from "@/lib/api/providerPool";

export function useProviderPool() {
  const [overview, setOverview] = useState<ProviderPoolOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState<string | null>(null);
  const [refreshingToken, setRefreshingToken] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await providerPoolApi.getOverview();
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Add Kiro OAuth credential
  const addKiroOAuth = async (credsFilePath: string, name?: string) => {
    await providerPoolApi.addKiroOAuth(credsFilePath, name);
    await fetchOverview();
  };

  // Add Gemini OAuth credential
  const addGeminiOAuth = async (
    credsFilePath: string,
    projectId?: string,
    name?: string,
  ) => {
    await providerPoolApi.addGeminiOAuth(credsFilePath, projectId, name);
    await fetchOverview();
  };

  // Add Qwen OAuth credential
  const addQwenOAuth = async (credsFilePath: string, name?: string) => {
    await providerPoolApi.addQwenOAuth(credsFilePath, name);
    await fetchOverview();
  };

  // Add OpenAI API Key credential
  const addOpenAIKey = async (
    apiKey: string,
    baseUrl?: string,
    name?: string,
  ) => {
    await providerPoolApi.addOpenAIKey(apiKey, baseUrl, name);
    await fetchOverview();
  };

  // Add Claude API Key credential
  const addClaudeKey = async (
    apiKey: string,
    baseUrl?: string,
    name?: string,
  ) => {
    await providerPoolApi.addClaudeKey(apiKey, baseUrl, name);
    await fetchOverview();
  };

  // Update credential
  const updateCredential = async (
    uuid: string,
    request: UpdateCredentialRequest,
  ) => {
    await providerPoolApi.updateCredential(uuid, request);
    await fetchOverview();
  };

  // Delete credential
  const deleteCredential = async (
    uuid: string,
    providerType?: PoolProviderType,
  ) => {
    await providerPoolApi.deleteCredential(uuid, providerType);
    await fetchOverview();
  };

  // Toggle credential enabled/disabled
  const toggleCredential = async (uuid: string, isDisabled: boolean) => {
    await providerPoolApi.toggleCredential(uuid, isDisabled);
    await fetchOverview();
  };

  // Reset credential counters
  const resetCredential = async (uuid: string) => {
    await providerPoolApi.resetCredential(uuid);
    await fetchOverview();
  };

  // Reset health for all credentials of a type
  const resetHealth = async (providerType: PoolProviderType) => {
    await providerPoolApi.resetHealth(providerType);
    await fetchOverview();
  };

  // Check health of a single credential
  const checkCredentialHealth = async (
    uuid: string,
  ): Promise<HealthCheckResult> => {
    setCheckingHealth(uuid);
    try {
      const result = await providerPoolApi.checkCredentialHealth(uuid);
      await fetchOverview();
      return result;
    } finally {
      setCheckingHealth(null);
    }
  };

  // Check health of all credentials of a type
  const checkTypeHealth = async (
    providerType: PoolProviderType,
  ): Promise<HealthCheckResult[]> => {
    setCheckingHealth(providerType);
    try {
      const results = await providerPoolApi.checkTypeHealth(providerType);
      await fetchOverview();
      return results;
    } finally {
      setCheckingHealth(null);
    }
  };

  // Refresh OAuth token for a credential
  const refreshCredentialToken = async (uuid: string): Promise<string> => {
    setRefreshingToken(uuid);
    try {
      const result = await providerPoolApi.refreshCredentialToken(uuid);
      await fetchOverview();
      return result;
    } finally {
      setRefreshingToken(null);
    }
  };

  // Get OAuth status for a credential
  const getCredentialOAuthStatus = async (
    uuid: string,
  ): Promise<OAuthStatus> => {
    return providerPoolApi.getCredentialOAuthStatus(uuid);
  };

  // Get credentials for a specific provider type
  const getCredentialsByType = (
    providerType: PoolProviderType,
  ): CredentialDisplay[] => {
    const pool = overview.find((p) => p.provider_type === providerType);
    return pool?.credentials || [];
  };

  // Get stats for a specific provider type
  const getStatsByType = (providerType: PoolProviderType) => {
    const pool = overview.find((p) => p.provider_type === providerType);
    return pool?.stats;
  };

  return {
    overview,
    loading,
    error,
    checkingHealth,
    refreshingToken,
    refresh: fetchOverview,
    addKiroOAuth,
    addGeminiOAuth,
    addQwenOAuth,
    addOpenAIKey,
    addClaudeKey,
    updateCredential,
    deleteCredential,
    toggleCredential,
    resetCredential,
    resetHealth,
    checkCredentialHealth,
    checkTypeHealth,
    refreshCredentialToken,
    getCredentialOAuthStatus,
    getCredentialsByType,
    getStatsByType,
  };
}
