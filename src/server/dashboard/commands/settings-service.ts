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
import { z } from "zod";

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

function ordinaryRequestRefusal(command: Extract<SettingsCommand, { type: "apply-settings" }>) {
  if (command.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
    return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "schema-mismatch", message: "settings schema-mismatch" });
  }
  if (deriveSettingsPatchFingerprint(command.payload.patch) !== command.payload.patchFingerprint) {
    return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "patch-fingerprint-mismatch", message: "settings patch-fingerprint-mismatch" });
  }
  return undefined;
}

/** Ordinary values are staged purely and committed by the kernel's SQLite transaction. */
export function createSettingsApplicationExecutor(
  validateCandidate: (settings: SettingsFileRecord["settings"]) => void,
  credentials: CredentialStore,
): SettingsApplicationExecutor {
  return Object.freeze({
    prepare(command: SettingsCommand) {
      if (command.type !== "apply-protected-settings") return ordinaryRequestRefusal(command);
      const outcome = credentials.apply(protectedInput(command));
      return outcome.state === "applied" ? undefined : outcome;
    },
    apply(command: SettingsCommand, repositories: AuthorityRepositories) {
      if (command.type === "apply-protected-settings") {
        const outcome = credentials.verifyReplay(protectedInput(command));
        if (outcome.state !== "applied") return outcome;
        return { state: "applied", readback: protectedSettingsReadback(outcome.record) };
      }
      const refusal = ordinaryRequestRefusal(command);
      if (refusal !== undefined) return refusal;
      const current = readSettings(repositories);
      if (current.revision !== command.target.expectedRevision) {
        return SettingsApplyRefusalSchema.parse({ state: "conflict", currentRevision: current.revision, message: "settings revision conflict" });
      }
      let settings: SettingsFileRecord["settings"];
      try {
        settings = mergeSettingsPatch(current.settings, command.payload.patch);
        validateCandidate(settings);
      } catch (error) {
        const keys = error instanceof z.ZodError
          ? [...new Set(error.issues.map((issue) => issue.path.map(String).join(".")))].sort()
          : Object.keys(command.payload.patch).sort();
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "cross-field-invalid", message: `cross-field-invalid { keys: ${keys.join(", ")} }` });
      }
      if (Buffer.byteLength(canonicalJsonStringify(settings), "utf8") > 1_048_576) {
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "document-too-large", message: "ordinary settings document-too-large" });
      }
      return { state: "applied", revision: current.revision + 1, settings, restartRequired: true,
        settingsFingerprint: derivePersistedSettingsFingerprint(settings) };
    },
    reconcileReplay(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>) {
      const outcome = credentials.verifyReplay(protectedInput(command));
      if (outcome.state !== "applied") throw new Error("credential-replay-refused");
      return protectedSettingsReadback(outcome.record);
    },
  });
}
