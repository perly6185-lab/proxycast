import { invoke } from "@tauri-apps/api/core";

interface AutoFixResult {
  issues_found: string[];
  fixes_applied: string[];
  warnings: string[];
}

export const useAutoFix = () => {
  const runAutoFix = async (): Promise<AutoFixResult> => {
    return await invoke("auto_fix_configuration");
  };

  return {
    runAutoFix,
  };
};
