import { z } from "zod";
import { ordinaryReadbackConfirms } from "./settings-draft-model.js";
import { CommandResultSchema, ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema, type CommandResult } from "../../../../rules/commands/commands.js";
import { ProtectedSettingsReadbackSchema } from "../../../../models/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
export { beforeEffectRefusal } from "../../../app/commands/command-result.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import type { CommandOutcome } from "../../../app/commands/command-executor.js";
import { commandAttemptView } from "../../../app/commands/command-outcome.js";
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
/** A settled outcome never reads as pending; only a retained draft does. */
export class SettingsSaveOutcomePendingError extends Error {
  constructor(readonly commandId: string) { super(`settings-save-outcome-pending: command ${commandId}`); this.name = "SettingsSaveOutcomePendingError"; }
}
export function commandSaveState(outcome: CommandOutcome | undefined): SettingsSaveState {
  if (outcome === undefined) return { state: "refused", code: "DASHBOARD_AUTHORITY_REPLACED", message: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text };
  const attempt = commandAttemptView(outcome);
  switch (attempt.view) {
    case "landed": return { state: "applied", replayed: attempt.replayed };
    case "unknown": return { state: "unconfirmed", code: attempt.feedback.code, message: attempt.feedback.text };
    case "conflict": return { state: "conflict", code: attempt.feedback.code, message: attempt.feedback.text };
    // A landed command whose target moved on keeps the state its outcome kind gave it.
    case "superseded": return { state: outcome.kind === "conflict" ? "conflict" : "refused", code: attempt.feedback.code, message: attempt.feedback.text };
    case "bulk": return { state: attempt.kind === "conflict" ? "conflict" : "refused", code: attempt.feedback.code, message: attempt.feedback.text };
    case "pending": throw new SettingsSaveOutcomePendingError(outcome.commandId);
    default: return { state: "refused", code: attempt.feedback.code, message: attempt.feedback.text };
  }
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
