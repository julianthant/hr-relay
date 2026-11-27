import type { z } from "zod";
import type { AssistantReplyPart, AssistantSessionView } from "../../../models/dashboard/assistant.js";
import type { QueueStatusSchema } from "../../../models/dashboard/projection.js";

export type SessionChipState = "running" | "stopping" | "finished" | "failed";

/** A queued, blocked or waiting run is still live, so it keeps the running chip. */
export const SESSION_CHIP_STATE = {
  queued: "running", running: "running", blocked: "running", "awaiting-approval": "running",
  cancelling: "stopping", done: "finished", cancelled: "finished", partial: "finished", failed: "failed",
} as const satisfies Record<z.infer<typeof QueueStatusSchema>, SessionChipState>;

export type SessionStop = NonNullable<AssistantSessionView["stop"]>;

type SaidPart = Extract<AssistantReplyPart, { kind: "text" | "bullets" }>;
export type ReplyBlock = SaidPart[] | Exclude<AssistantReplyPart, SaidPart>;

/** Consecutive text and bullets are one assistant message; a session chip or an answered line stands alone. */
export function replyBlocks(parts: readonly AssistantReplyPart[]): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  for (const part of parts) {
    const last = blocks.at(-1);
    if (part.kind !== "text" && part.kind !== "bullets") blocks.push(part);
    else if (Array.isArray(last)) last.push(part);
    else blocks.push([part]);
  }
  return blocks;
}

type Inline = Extract<AssistantReplyPart, { kind: "text" }>["runs"][number];
const inlineText = (run: Inline) => run.kind === "value" ? run.value : run.kind === "link" ? run.label : run.text;
/** A reply's words as plain text, for a chat title or a caption. */
export function replyText(parts: readonly AssistantReplyPart[]): string {
  return parts.flatMap(part => part.kind === "text" ? [part.runs.map(inlineText).join("")]
    : part.kind === "bullets" ? part.items.map(runs => runs.map(inlineText).join("")) : part.kind === "session" ? [part.label] : []).join("\n");
}
