import { getScopedStorageKey } from "./agentChatShared";

export interface AgentSessionScopedKeys {
  currentSessionKey: string;
  messagesKey: string;
  persistedSessionKey: string;
  turnsKey: string;
  itemsKey: string;
  currentTurnKey: string;
}

export function getAgentSessionScopedKeys(
  workspaceId: string,
): AgentSessionScopedKeys {
  return {
    currentSessionKey: getScopedStorageKey(workspaceId, "aster_curr_sessionId"),
    messagesKey: getScopedStorageKey(workspaceId, "aster_messages"),
    persistedSessionKey: getScopedStorageKey(
      workspaceId,
      "aster_last_sessionId",
    ),
    turnsKey: getScopedStorageKey(workspaceId, "aster_thread_turns"),
    itemsKey: getScopedStorageKey(workspaceId, "aster_thread_items"),
    currentTurnKey: getScopedStorageKey(workspaceId, "aster_curr_turnId"),
  };
}
