import { safeInvoke } from "@/lib/dev-bridge";

export interface TtsTestResult {
  success: boolean;
  error: string | null;
  audio_path: string | null;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
}

export async function testTts(
  service: string,
  voice: string,
): Promise<TtsTestResult> {
  return safeInvoke("test_tts", { service, voice });
}

export async function getAvailableVoices(
  service: string,
): Promise<VoiceOption[]> {
  return safeInvoke("get_available_voices", { service });
}
