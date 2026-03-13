export interface QueuedTurnSnapshot {
  queued_turn_id: string;
  message_preview: string;
  message_text: string;
  created_at: number;
  image_count: number;
  position: number;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildQueuedTurnPreview(messageText: string): string {
  const compact = messageText.split(/\s+/).filter(Boolean).join(" ");
  if (!compact) {
    return "空白输入";
  }

  const preview = Array.from(compact).slice(0, 80).join("");
  return compact.length > preview.length ? `${preview}...` : preview;
}

export function normalizeQueuedTurnSnapshot(
  snapshot: unknown,
): QueuedTurnSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const raw = snapshot as Record<string, unknown>;
  const queuedTurnId =
    readString(raw.queued_turn_id) ?? readString(raw.queuedTurnId);
  if (!queuedTurnId?.trim()) {
    return null;
  }

  const messagePreview =
    readString(raw.message_preview) ?? readString(raw.messagePreview) ?? "";
  const messageText =
    readString(raw.message_text) ??
    readString(raw.messageText) ??
    messagePreview;
  const normalizedMessageText = messageText.trim() ? messageText : "空白输入";
  const normalizedMessagePreview = messagePreview.trim()
    ? messagePreview
    : buildQueuedTurnPreview(normalizedMessageText);

  return {
    queued_turn_id: queuedTurnId,
    message_preview: normalizedMessagePreview,
    message_text: normalizedMessageText,
    created_at: readNumber(raw.created_at) ?? readNumber(raw.createdAt) ?? 0,
    image_count: readNumber(raw.image_count) ?? readNumber(raw.imageCount) ?? 0,
    position: readNumber(raw.position) ?? 0,
  };
}

export function normalizeQueuedTurnSnapshots(
  snapshots: unknown,
): QueuedTurnSnapshot[] {
  if (!Array.isArray(snapshots)) {
    return [];
  }

  return snapshots
    .map((snapshot) => normalizeQueuedTurnSnapshot(snapshot))
    .filter((snapshot): snapshot is QueuedTurnSnapshot => Boolean(snapshot));
}
