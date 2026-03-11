import { safeInvoke } from "@/lib/dev-bridge";

export interface UploadResult {
  url: string;
  size: number;
}

export async function uploadAvatar(filePath: string): Promise<UploadResult> {
  return safeInvoke("upload_avatar", { filePath });
}

export async function deleteAvatar(url: string): Promise<void> {
  return safeInvoke("delete_avatar", { url });
}
