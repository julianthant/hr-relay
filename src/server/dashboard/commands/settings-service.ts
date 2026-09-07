import type { SettingsApplicationExecutor, SettingsCommand } from "../../../core/command-kernel.js";
import { ProtectedSettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../domain/commands.js";
import type { CredentialStore } from "../../../domain/config/credential-store.js";
import { ProtectedSettingsApplyInputSchema, protectedSettingsReadback } from "../../../domain/config/protected-settings.js";
import {
  SETTINGS_SCHEMA_HASH, SettingsApplyRefusalSchema, deriveSettingsPatchFingerprint,
  derivePersistedSettingsFingerprint, mergeSettingsPatch,
  type SettingsFileRecord,
} from "../../../domain/config/settings.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { readSettings } from "../../settings-runtime.js";

function protectedInput(command: SettingsCommand) {
  const request = ProtectedSettingsCommandRequestSchema.parse(command);
  return ProtectedSettingsApplyInputSchema.parse({
    commandId: request.commandId,
    commandFingerprint: deriveSettingsCommandFingerprint(request),
    expectedRevision: request.target.expectedRevision,
    protectedSchemaHash: request.payload.protectedSchemaHash,
    writeId: request.payload.writeId,
    entries: request.payload.entries,
    updatedAt: request.requestedAt,
  });
}

/** Ordinary values are staged purely and committed by the kernel's SQLite transaction. */
export function createSettingsApplicationExecutor(
  validateCandidate: (settings: SettingsFileRecord["settings"]) => void,
  credentials: CredentialStore,
): SettingsApplicationExecutor {
  return Object.freeze({
    prepare(command: SettingsCommand) {
      if (command.type !== "apply-protected-settings") return undefined;
      const outcome = credentials.apply(protectedInput(command));
      return outcome.state === "applied" ? undefined : outcome;
    },
    apply(command: SettingsCommand, repositories: AuthorityRepositories) {
      if (command.type === "apply-protected-settings") {
        const outcome = credentials.verifyReplay(protectedInput(command));
        if (outcome.state !== "applied") return outcome;
        return { state: "applied", readback: protectedSettingsReadback(outcome.record) };
      }
      if (command.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "schema-mismatch", message: "settings schema-mismatch" });
      }
      if (deriveSettingsPatchFingerprint(command.payload.patch) !== command.payload.patchFingerprint) {
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "patch-fingerprint-mismatch", message: "settings patch-fingerprint-mismatch" });
      }
      const current = readSettings(repositories);
      if (current.revision !== command.target.expectedRevision) {
        return SettingsApplyRefusalSchema.parse({ state: "conflict", currentRevision: current.revision, message: "settings revision conflict" });
      }
      const settings = mergeSettingsPatch(current.settings, command.payload.patch);
      try { validateCandidate(settings); }
      catch { return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "cross-field-invalid", message: "cross-field-invalid { keys: settings }" }); }
      if (Buffer.byteLength(canonicalJsonStringify(settings), "utf8") > 1_048_576) {
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "document-too-large", message: "ordinary settings document-too-large" });
      }
      return { state: "applied", revision: current.revision + 1, settings,
        settingsFingerprint: derivePersistedSettingsFingerprint(settings) };
    },
    reconcileReplay(repositories: AuthorityRepositories, command: SettingsCommand) {
      if (command.type === "apply-protected-settings") {
        const outcome = credentials.verifyReplay(protectedInput(command));
        if (outcome.state !== "applied") throw new Error("credential-replay-refused");
        return protectedSettingsReadback(outcome.record);
      }
      const record = repositories.settingsCurrent.get();
      if (record === undefined || record.revision !== command.target.expectedRevision + 1
        || record.commandId !== command.commandId
        || record.commandFingerprint !== deriveSettingsCommandFingerprint(command)) {
        throw new Error(`settings replay ${command.commandId} does not match the current result`);
      }
      return { revision: record.revision, settingsFingerprint: record.settingsFingerprint };
    },
  });
}
