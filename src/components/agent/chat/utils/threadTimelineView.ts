import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";

export interface MessageTurnTimeline {
  messageId: string;
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
}

export function compareThreadTurns(
  left: AgentThreadTurn,
  right: AgentThreadTurn,
): number {
  if (left.started_at !== right.started_at) {
    return left.started_at.localeCompare(right.started_at);
  }
  return left.id.localeCompare(right.id);
}

export function compareThreadItems(
  left: AgentThreadItem,
  right: AgentThreadItem,
): number {
  if (left.started_at !== right.started_at) {
    return left.started_at.localeCompare(right.started_at);
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.id.localeCompare(right.id);
}

export function sortThreadItems(items: AgentThreadItem[]): AgentThreadItem[] {
  return [...items].sort(compareThreadItems);
}

export function mergeThreadItems(
  ...itemGroups: Array<AgentThreadItem[] | undefined>
): AgentThreadItem[] {
  const merged = new Map<string, AgentThreadItem>();

  for (const items of itemGroups) {
    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      merged.set(item.id, item);
    }
  }

  return sortThreadItems(Array.from(merged.values()));
}

export function buildMessageTurnTimeline(
  messages: Message[],
  turns: AgentThreadTurn[],
  items: AgentThreadItem[],
): Map<string, MessageTurnTimeline> {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  if (assistantMessages.length === 0 || turns.length === 0) {
    return new Map();
  }

  const sortedTurns = [...turns].sort(compareThreadTurns);
  const effectiveTurns =
    sortedTurns.length > assistantMessages.length
      ? sortedTurns.slice(-assistantMessages.length)
      : sortedTurns;
  const effectiveAssistants =
    assistantMessages.length > effectiveTurns.length
      ? assistantMessages.slice(-effectiveTurns.length)
      : assistantMessages;

  const itemsByTurnId = new Map<string, AgentThreadItem[]>();
  for (const item of sortThreadItems(items)) {
    const existing = itemsByTurnId.get(item.turn_id);
    if (existing) {
      existing.push(item);
    } else {
      itemsByTurnId.set(item.turn_id, [item]);
    }
  }

  const timelineByMessageId = new Map<string, MessageTurnTimeline>();
  effectiveTurns.forEach((turn, index) => {
    const assistantMessage = effectiveAssistants[index];
    if (!assistantMessage) {
      return;
    }

    timelineByMessageId.set(assistantMessage.id, {
      messageId: assistantMessage.id,
      turn,
      items: itemsByTurnId.get(turn.id) || [],
    });
  });

  return timelineByMessageId;
}
