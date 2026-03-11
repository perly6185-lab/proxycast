import { safeInvoke } from "@/lib/dev-bridge";
import type {
  ColorMood,
  CreatePosterMetadataRequest,
  ImageCategory,
  LayoutCategory,
  PosterMaterial,
  PosterMaterialMetadata,
} from "@/types/poster-material";

export async function getPosterMaterial(
  materialId: string,
): Promise<PosterMaterial | null> {
  return safeInvoke<PosterMaterial | null>("get_poster_material", {
    materialId,
  });
}

export async function createPosterMetadata(
  request: CreatePosterMetadataRequest,
): Promise<PosterMaterialMetadata> {
  return safeInvoke<PosterMaterialMetadata>("create_poster_metadata", {
    req: request,
  });
}

export async function updatePosterMetadata(
  materialId: string,
  request: CreatePosterMetadataRequest,
): Promise<PosterMaterialMetadata> {
  return safeInvoke<PosterMaterialMetadata>("update_poster_metadata", {
    materialId,
    req: request,
  });
}

export async function deletePosterMetadata(materialId: string): Promise<void> {
  await safeInvoke<void>("delete_poster_metadata", { materialId });
}

export async function listPosterMaterialsByImageCategory(
  projectId: string,
  category?: ImageCategory | null,
): Promise<PosterMaterial[]> {
  return safeInvoke<PosterMaterial[]>("list_by_image_category", {
    projectId,
    category: category ?? null,
  });
}

export async function listPosterMaterialsByLayoutCategory(
  projectId: string,
  category?: LayoutCategory | null,
): Promise<PosterMaterial[]> {
  return safeInvoke<PosterMaterial[]>("list_by_layout_category", {
    projectId,
    category: category ?? null,
  });
}

export async function listPosterMaterialsByMood(
  projectId: string,
  mood?: ColorMood | null,
): Promise<PosterMaterial[]> {
  return safeInvoke<PosterMaterial[]>("list_by_mood", {
    projectId,
    mood: mood ?? null,
  });
}
