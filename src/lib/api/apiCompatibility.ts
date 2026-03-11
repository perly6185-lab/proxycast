import { safeInvoke } from "@/lib/dev-bridge";

export interface ApiCheckResult {
  model: string;
  available: boolean;
  status: number;
  error_type: string | null;
  error_message: string | null;
  time_ms: number;
}

export interface ApiCompatibilityResult {
  provider: string;
  overall_status: string;
  checked_at: string;
  results: ApiCheckResult[];
  warnings: string[];
}

export async function checkApiCompatibility(
  provider: string,
): Promise<ApiCompatibilityResult> {
  return safeInvoke("check_api_compatibility", { provider });
}
