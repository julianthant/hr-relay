import { z } from "zod";
import { ordinaryReadbackConfirms } from "./settings-draft-model.js";
import { CommandResultSchema, ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema, type CommandResult } from "../../../../rules/commands/commands.js";
import { ProtectedSettingsReadbackSchema } from "../../../../models/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
export { beforeEffectRefusal } from "../../../app/commands/command-result.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import type { CommandOutcome } from "../../../app/commands/command-executor.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";

export type OrdinarySettingsAttempt = z.infer<typeof SettingsCommandRequestSchema>;
export type ProtectedSettingsAttempt = z.infer<typeof ProtectedSettingsCommandRequestSchema>;
export type SettingsAttempt = OrdinarySettingsAttempt | ProtectedSettingsAttempt;
export type SettingsSaveState =
  | { readonly state: "idle" }
  | { readonly state: "saving" }
  | { readonly state: "applied"; readonly replayed: boolean }
  | { readonly state: "refused" | "conflict" | "unconfirmed"; readonly message: string; readonly code?: ErrorCatalogCode };
export type SettingsSaveNotice = Readonly<{ title: string; description?: string }>;
export type SettingsSaveListener = (notice: SettingsSaveNotice) => void;
export type SettingsSaveProblem = SettingsSaveNotice & Readonly<{ tone: "danger" | "warning" }>;
export type SettingsSaveProblemListener = (notice: SettingsSaveProblem) => void;
export function commandSaveState(outcome: CommandOutcome | undefined): SettingsSaveState {
  if (outcome === undefined) return { state: "refused", code: "DASHBOARD_AUTHORITY_REPLACED", message: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text };
  if (outcome.kind === "confirmed") return { state: "applied", replayed: outcome.reply !== undefined && "state" in outcome.reply && outcome.reply.state === "already-applied" };
  return { state: outcome.kind === "uncertain" ? "unconfirmed" : outcome.kind === "conflict" ? "conflict" : "refused", code: outcome.feedback.code, message: outcome.feedback.text };
}
export function settingsScopeRecoveryState(): SettingsSaveState {
  return { state: "unconfirmed", code: "DASHBOARD_AUTHORITY_REPLACED", message: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text };
}
export function settingsSaveProblem(save: SettingsSaveState, protectedStore = false): SettingsSaveProblem | undefined {
  const name = protectedStore ? "Credentials" : "Settings";
  if (save.state === "unconfirmed") return { tone: "warning", title: `${name} save unconfirmed`, description: "Your draft is retained. Retry the exact attempt to confirm the result." };
  if (save.state === "conflict") return { tone: "warning", title: `${name} changed`, description: "Your draft is retained. Review the current values before retrying." };
  if (save.state === "refused") return { tone: "danger", title: `${name} weren't saved`, description: "Your draft is retained. Review the save details before retrying." };
  return undefined;
}
export function settingsSaveNotice(labels: readonly string[], replayed: boolean, restartRequired = false): SettingsSaveNotice {
  return { title: `${replayed ? "Already saved" : "Saved"} ${labels.length === 1 ? labels[0] : "settings"}`,
    ...(restartRequired ? { description: "Restart required to use these changes." } : {}) };
}
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
export function ordinaryReadbackState(command: OrdinarySettingsAttempt, result: CommandResult, document: EditableSettingsWire): "confirmed" | "superseded" | "unresolved" {
  if ((result.state !== "applied" && result.state !== "already-applied") || result.commandId !== command.commandId
    || result.settingsRevision !== command.target.expectedRevision + 1 || result.settingsFingerprint === undefined
    || result.affectedTargets.length !== 1 || result.affectedTargets[0]?.family !== "settings"
    || result.affectedTargets[0]?.revision !== result.settingsRevision) return "unresolved";
  if (document.revision > result.settingsRevision) return "superseded";
  return document.revision === result.settingsRevision && document.settingsFingerprint === result.settingsFingerprint
    && ordinaryReadbackConfirms(document, command.payload.patch) ? "confirmed" : "unresolved";
}
