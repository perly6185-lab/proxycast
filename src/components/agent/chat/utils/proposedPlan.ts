export interface ProposedPlanTextSegment {
  type: "text";
  content: string;
}

export interface ProposedPlanBlockSegment {
  type: "plan";
  content: string;
  isComplete: boolean;
}

export type ProposedPlanSegment =
  | ProposedPlanTextSegment
  | ProposedPlanBlockSegment;

const OPEN_TAG = "<proposed_plan>";
const CLOSE_TAG = "</proposed_plan>";

function pushTextSegment(
  segments: ProposedPlanSegment[],
  content: string,
): void {
  if (!content) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous?.type === "text") {
    previous.content += content;
    return;
  }

  segments.push({
    type: "text",
    content,
  });
}

export function splitProposedPlanSegments(text: string): ProposedPlanSegment[] {
  if (!text.includes(OPEN_TAG)) {
    return text ? [{ type: "text", content: text }] : [];
  }

  const segments: ProposedPlanSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openIndex = text.indexOf(OPEN_TAG, cursor);
    if (openIndex === -1) {
      pushTextSegment(segments, text.slice(cursor));
      break;
    }

    pushTextSegment(segments, text.slice(cursor, openIndex));

    const planStart = openIndex + OPEN_TAG.length;
    const closeIndex = text.indexOf(CLOSE_TAG, planStart);

    if (closeIndex === -1) {
      segments.push({
        type: "plan",
        content: text.slice(planStart).trim(),
        isComplete: false,
      });
      break;
    }

    segments.push({
      type: "plan",
      content: text.slice(planStart, closeIndex).trim(),
      isComplete: true,
    });
    cursor = closeIndex + CLOSE_TAG.length;
  }

  return segments.filter((segment) =>
    segment.type === "text"
      ? segment.content.trim().length > 0
      : segment.content.length > 0,
  );
}

export function stripProposedPlanBlocks(text: string): string {
  return splitProposedPlanSegments(text)
    .filter((segment) => segment.type === "text")
    .map((segment) => segment.content)
    .join("")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
