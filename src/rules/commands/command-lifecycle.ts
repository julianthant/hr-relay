import { z } from "zod";
import type { SettingsInitializationAuditSchema } from "../../models/config/settings-initialization.js";
import { deepFreeze } from "../validation/immutability.js";
import type { BulkRunCommandOutcome,CommandAuditRecord,CommandResult,RunLifecycleCommandAuditRecordSchema } from "./commands.js";

/** Did the command change anything? The one question every layer answers. */
export const COMMAND_EFFECTS = deepFreeze(["landed", "none", "unknown"] as const);
export type CommandEffect = (typeof COMMAND_EFFECTS)[number];

/** Rejection codes that do not prove "no effect": the command may have landed. */
export const UNKNOWN_EFFECT_CODES = deepFreeze(["bulk-child-errored"] as const);
const unknownEffectCodes: readonly string[] = UNKNOWN_EFFECT_CODES;

export type NativeCommandAudit = CommandAuditRecord
  | z.infer<typeof RunLifecycleCommandAuditRecordSchema>
  | z.infer<typeof SettingsInitializationAuditSchema>;

/** Wire single result → effect. */
export function commandResultEffect(result: CommandResult): CommandEffect {
  switch (result.state) {
    case "applied": case "already-applied": return "landed";
    case "conflict": case "confirmation-required": return "none";
    case "rejected": return unknownEffectCodes.includes(result.code) ? "unknown" : "none";
    case "pending": return "unknown";
  }
}

/** Every native audit → effect. The adapter the row writers use. */
export function nativeAuditEffect(audit: NativeCommandAudit): CommandEffect {
  if (!("kind" in audit)) return commandResultEffect(audit.result);
  // Every run-lifecycle result kind and settings initialization (initialized) is a landing.
  return "landed";
}

/** Wire single result → bulk child class. Callers add detail, replay and identity. */
export type BulkChildClass = BulkRunCommandOutcome["outcome"];
export function bulkChildClass(result: CommandResult): BulkChildClass {
  switch (result.state) {
    case "applied": case "already-applied": return "applied";
    case "conflict": return "conflict";
    case "rejected": return unknownEffectCodes.includes(result.code) ? "errored" : "refused";
    case "pending": case "confirmation-required": return "errored";
  }
}

export function bulkChildEffect(outcome: BulkChildClass): CommandEffect {
  switch (outcome) {
    case "applied": return "landed";
    case "conflict": case "refused": return "none";
    case "errored": return "unknown";
  }
}

/** Row vocabulary. `uncertain` is a settled row whose effect is unknown. */
export const COMMAND_ROW_STATES = deepFreeze(["admitted", "succeeded", "refused", "uncertain"] as const);
export const CommandRowStateSchema = z.enum(COMMAND_ROW_STATES);
export type CommandRowState = z.infer<typeof CommandRowStateSchema>;

/** Effect → settled row state. */
export function commandRowStateOf(effect: CommandEffect): Exclude<CommandRowState, "admitted"> {
  switch (effect) {
    case "landed": return "succeeded";
    case "none": return "refused";
    case "unknown": return "uncertain";
  }
}

/** Row → effect for any reader outside the executing call. A bulk parent has no own effect. */
export function commandRowEffect(row: { readonly state: CommandRowState; readonly bulkParent: boolean }): CommandEffect | "see-children" {
  if (row.bulkParent) return "see-children";
  switch (row.state) {
    case "admitted": case "uncertain": return "unknown";
    case "succeeded": return "landed";
    case "refused": return "none";
  }
}

export type CommandRowCurrent =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly state: CommandRowState; readonly settled: boolean; readonly bulkParent: boolean };
export type CommandRowEvent =
  | { readonly type: "admit"; readonly bulkParent: boolean; readonly sameRequest: boolean }
  | { readonly type: "settle"; readonly effect: CommandEffect; readonly sameOutcome: boolean };
export type CommandRowStep =
  | { readonly write: "insert" | "update"; readonly state: CommandRowState }
  | { readonly write: "none" }
  | { readonly refused: "command-identity-conflict" | "command-audit-request-mismatch" | "command-audit-outcome-conflict" | "commands-bulk-immutable" };

/** A stored non-bulk row must be `admitted` exactly when it has no outcome. */
export class CommandRowInvalidError extends Error {
  constructor(readonly state: CommandRowState, readonly settled: boolean) {
    super(`command-row-invalid: state ${state} with settled=${String(settled)}`);
    this.name = "CommandRowInvalidError";
  }
}

/** The row transition function both row writers call. The writers keep their guards and pass the verdicts in. */
export function commandRowTransition(current: CommandRowCurrent, event: CommandRowEvent): CommandRowStep {
  if (event.type === "admit") {
    if (current.kind === "absent") return { write: "insert", state: event.bulkParent ? "succeeded" : "admitted" };
    return event.sameRequest ? { write: "none" } : { refused: "command-identity-conflict" };
  }
  if (current.kind === "absent") return { refused: "command-audit-request-mismatch" };
  if (current.bulkParent) return { refused: "commands-bulk-immutable" };
  if (current.settled === (current.state === "admitted")) throw new CommandRowInvalidError(current.state, current.settled);
  if (!current.settled) return { write: "update", state: commandRowStateOf(event.effect) };
  return event.sameOutcome ? { write: "none" } : { refused: "command-audit-outcome-conflict" };
}
