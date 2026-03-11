import { safeInvoke } from "@/lib/dev-bridge";
import type {
  CreatePersonaRequest,
  Persona,
  PersonaTemplate,
  PersonaUpdate,
} from "@/types/persona";

export async function listPersonas(projectId: string): Promise<Persona[]> {
  return safeInvoke<Persona[]>("list_personas", { projectId });
}

export async function getDefaultPersona(
  projectId: string,
): Promise<Persona | null> {
  return safeInvoke<Persona | null>("get_default_persona", { projectId });
}

export async function createPersona(
  request: CreatePersonaRequest,
): Promise<Persona> {
  return safeInvoke<Persona>("create_persona", { req: request });
}

export async function updatePersona(
  id: string,
  update: PersonaUpdate,
): Promise<Persona> {
  return safeInvoke<Persona>("update_persona", { id, update });
}

export async function deletePersona(id: string): Promise<void> {
  await safeInvoke<void>("delete_persona", { id });
}

export async function setDefaultPersona(
  projectId: string,
  personaId: string,
): Promise<void> {
  await safeInvoke<void>("set_default_persona", { projectId, personaId });
}

export async function listPersonaTemplates(): Promise<PersonaTemplate[]> {
  return safeInvoke<PersonaTemplate[]>("list_persona_templates");
}
