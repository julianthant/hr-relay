import { randomUUID } from "node:crypto";
import { AssistantReplyPartsSchema, type AssistantReplyPart, type AssistantValueSource } from "../../models/dashboard/assistant.js";
import type { NotificationRecord } from "../../models/notifications/notifications.js";
import type { CommandRequest, CommandResult } from "../../rules/commands/commands.js";
import { FingerprintSchema } from "../../rules/identity/ids.js";
import type { Clock } from "../../rules/time/clock.js";
import { canonicalJsonStringify, type JsonValue } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { AssistantAppliedEditInput } from "../storage/sqlite/assistant-applied-edits.js";
import type { WorkbookLibraryService } from "../workbooks/workbook-library-service.js";
import { AssistantToolRefusal, type AssistantChangeContext } from "./plugins/plugin.js";
import { operatorValueSpans } from "./references.js";

export type LocalEditCommand = Extract<CommandRequest, { family: "notification" } | { type: "apply-settings" }>;
type EditResult = Readonly<{ details: AssistantAppliedEditInput["details"]; label: string; before: string; after: string;
  source?: AssistantValueSource }>;
export interface AssistantEditOwner {
  apply(context: AssistantChangeContext, work: (owner: Readonly<{
    id: string; at: string;
    execute(command: LocalEditCommand): CommandResult;
  }>) => EditResult): AssistantReplyPart;
  notification(id: string): NotificationRecord | undefined;
  workbooks(): Pick<WorkbookLibraryService, "operatorOperation" | "localLibraryAction">;
}

export function observeEdit(context: { editReads?: Map<string, string> }, target: string, revision: string | number) {
  context.editReads?.set(target, String(revision));
}
export function requireEditRead(context: AssistantChangeContext, target: string, revision: string | number) {
  if (context.editReads.get(target) !== String(revision)) throw new AssistantToolRefusal("ASSISTANT_EDIT_STALE");
}

export function requireOperatorSource(context: AssistantChangeContext, source: string | null) {
  if (source === null || source.trim().length === 0) throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
  const spellings = [source, JSON.stringify(source)].map(value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const word = String.raw`[\p{L}\p{M}\p{N}\p{Pc}]`;
  const exact = new RegExp(`(?<!${word})(?:${spellings.join("|")})(?!${word})`, "u");
  if (!operatorValueSpans(context.operatorText).some(span => exact.test(span))) {
    throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
  }
  return source;
}

/** The owner names every operand in the one command it can authorize. */
export function requireOperatorEdit(context: AssistantChangeContext, commands: readonly string[]) {
  const text = context.operatorText.trim().replace(/^please\s+/iu, "");
  const command = text.charAt(0).toLowerCase() + text.slice(1);
  if (operatorValueSpans(text).length !== 1 || !commands.some(allowed => command === allowed || command === allowed + ".")) {
    throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
  }
}

export function editValueSpellings(value: string): readonly string[] {
  const quoted = JSON.stringify(value);
  return /^[\p{L}\p{M}\p{N}_ -]+$/u.test(value) && !/\b(?:and|or|if|unless|instead|then|but|except)\b/iu.test(value)
    ? [value, quoted] : [quoted];
}

function editDisplay(text: string): string {
  return text.length <= 2000 ? text : text.slice(0, 1999).replace(/[\uD800-\uDBFF]$/u, "") + "…";
}

export function operatorEditSource(context: AssistantChangeContext, value: JsonValue): AssistantValueSource {
  const turn = context.acceptedTurn;
  return { kind: "operator", profileId: turn.profileId, conversationId: turn.conversationId, messageId: turn.messageId,
    at: turn.acceptedAt, valueFingerprint: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(value))) };
}

export function createAssistantEditApply(options: Readonly<{
  clock: Clock;
  transaction<T>(work: () => T): T;
  execute(command: LocalEditCommand): CommandResult;
  record(input: AssistantAppliedEditInput): unknown;
}>): AssistantEditOwner["apply"] {
  return (context, work) => options.transaction(() => {
    context.assertCurrent();
    const id = randomUUID(), at = options.clock.now().toISOString();
    const { details, label, before, after, source } = work({ id, at, execute: options.execute });
    const reply: AssistantReplyPart = { kind: "text", editId: id, runs: [
      { kind: "plain", text: label + " to " }, { kind: "value", previous: editDisplay(before), value: editDisplay(after), ...(source === undefined ? {} : { source }) },
      { kind: "plain", text: "." },
    ] };
    AssistantReplyPartsSchema.parse([reply]);
    context.assertCurrent();
    options.record({ id, committedAt: at, turn: context.acceptedTurn, actorId: context.actorId, label, details,
      ...(source === undefined ? {} : { source }) });
    return reply;
  });
}
