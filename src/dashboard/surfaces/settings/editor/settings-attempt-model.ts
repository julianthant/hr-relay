import { z } from "zod";
import { CommandResultSchema, ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema, type CommandResult } from "../../../../domain/commands.js";
import { ProtectedSettingsReadbackSchema } from "../../../../domain/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../../domain/canonical-json.js";
import { DashboardClientError } from "../../../client/errors.js";
import type { EditableSettingsWire } from "../../../../domain/dashboard/settings-editor.js";

export type OrdinarySettingsAttempt = z.infer<typeof SettingsCommandRequestSchema>;
export type ProtectedSettingsAttempt = z.infer<typeof ProtectedSettingsCommandRequestSchema>;
export type SettingsAttempt = OrdinarySettingsAttempt | ProtectedSettingsAttempt;
export type SettingsSaveState =
  | { readonly state: "idle" }
  | { readonly state: "saving" }
  | { readonly state: "applied"; readonly replayed: boolean }
  | { readonly state: "refused" | "conflict" | "unconfirmed"; readonly message: string; readonly code?: string };
export function checkedSettingsResult(command: SettingsAttempt, input: unknown): CommandResult {
  const result = CommandResultSchema.safeParse(input);
  if (!result.success || result.data.commandId !== command.commandId || result.data.state === "confirmation-required") throw new Error("settings-result-unconfirmed");
  if (result.data.state === "applied" || result.data.state === "already-applied") {
    const family = command.type === "apply-settings" ? "settings" : "protected-settings";
    const target = result.data.affectedTargets[0];
    if (result.data.affectedTargets.length !== 1 || target?.family !== family || target.revision !== command.target.expectedRevision + 1) throw new Error("settings-result-unconfirmed");
    if (command.type === "apply-protected-settings" && !ProtectedSettingsReadbackSchema.safeParse({ revision: result.data.revision, entries: result.data.entries }).success) throw new Error("settings-result-unconfirmed");
  }
  return result.data;
}
export function settingsRefusal(code: string): string {
  switch (code) {
    case "schema-mismatch": return "The settings schema changed. Reopen Settings before retrying.";
    case "patch-fingerprint-mismatch": case "envelope-fingerprint-mismatch": case "command-divergent": return "The command identity did not match. Review the draft before retrying.";
    case "not-editable": return "This document contains a setting that cannot be edited here.";
    case "invalid-value": case "cross-field-invalid": return "Check the draft values and all required fields in coupled records.";
    case "document-too-large": return "The settings document is too large. Reduce the draft.";
    case "directory-integrity": return "The credential store failed its integrity check. Check storage before retrying.";
    case "lock-unavailable": return "The credential store is busy. Retry when it is available.";
    case "write-id-reused": return "The write identity was already used. Retry with a fresh identity; your draft is retained.";
    case "authority-unjournaled": case "authority-uncertain": return "The write could not be confirmed. It may already be stored. Retry the exact attempt to resolve it.";
    default: return "The settings command was refused. Review the current document before retrying.";
  }
}
export function uncertainSettingsCode(code: string): boolean { return code === "authority-uncertain" || code === "authority-unjournaled"; }
/** Only typed admission refusals known to precede execution can claim no effect. */
export function beforeEffectRefusal(error: unknown): boolean {
  return error instanceof DashboardClientError && error.kind === "http"
    && ["OPERATOR_MUTATION_ORIGIN_REFUSED", "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED"].includes(error.code ?? "");
}
export function protectedReadbackConfirms(command: ProtectedSettingsAttempt, result: CommandResult, document: EditableSettingsWire): boolean {
  if ((result.state !== "applied" && result.state !== "already-applied") || document.protectedSettings.state !== "available") return false;
  const current = document.protectedSettings.readback;
  if (current.revision !== result.revision || current.revision !== command.target.expectedRevision + 1
    || canonicalJsonStringify(current.entries) !== canonicalJsonStringify(result.entries)) return false;
  // Ingress owns acceptedAt and stamps requestedAt. Bind its returned tuple, never the browser clock.
  return Object.entries(command.payload.entries).every(([name, operation]) => {
    if (operation === undefined) return false;
    const presence = current.entries[name as keyof typeof current.entries];
    return "clear" in operation ? !presence.present : presence.present;
  });
}
