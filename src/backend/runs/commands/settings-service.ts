import { randomUUID } from "node:crypto";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { SettingsApplicationExecutor, SettingsCommand } from "./command-kernel.js";
import { ProtectedSettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../rules/commands/commands.js";
import { ResolvedConfigSchema, type ResolvedConfig } from "../../app/config/resolve.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import { ProtectedSettingsApplyInputSchema, protectedSettingsReadback } from "../../../models/config/protected-settings.js";
import { SETTINGS_SCHEMA_HASH, SettingsApplyRefusalSchema, deriveRawSettingsPatchFingerprint, derivePersistedSettingsFingerprint, mergeSettingsPatch, containsRetiredTestRoutePatch, type SettingsFileRecord } from "../../../models/config/settings.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { z } from "zod";
import { OrdinaryPathValidationError, validateOrdinaryPathChanges } from "./ordinary-path-validator.js";

const VALIDATED_PATHS = new Set(["paths.browserProfileRoot", "paths.duoCredential", "paths.duoExtensionDir"]);

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
  if (containsRetiredTestRoutePatch(command.payload.patch)) {
    return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "not-editable", message: "retired test routes cannot be edited" });
  }
  if (command.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
    return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "schema-mismatch", message: "settings schema-mismatch" });
  }
  if (deriveRawSettingsPatchFingerprint(command.payload.patch) !== command.payload.patchFingerprint) {
    return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "patch-fingerprint-mismatch", message: "settings patch-fingerprint-mismatch" });
  }
  return undefined;
}

/** Ordinary values are staged purely and committed by the kernel's SQLite transaction. */
export function createSettingsApplicationExecutor(
  resolveCandidate: (settings: SettingsFileRecord["settings"]) => ResolvedConfig,
  credentials: CredentialStore,
): SettingsApplicationExecutor {
  return Object.freeze({
    validateRequest(command: SettingsCommand) {
      if (command.type === "apply-settings") return ordinaryRequestRefusal(command);
      return undefined;
    },
    commitPrivate(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>) {
      const outcome = credentials.apply(protectedInput(command));
      return outcome.state === "applied" ? undefined : outcome;
    },
    applyOrdinary(command: Extract<SettingsCommand, { type: "apply-settings" }>, repositories: AuthorityRepositories, current: SettingsFileRecord) {
      const refusal = ordinaryRequestRefusal(command);
      if (refusal !== undefined) return refusal;
      if (current.revision !== command.target.expectedRevision) {
        return SettingsApplyRefusalSchema.parse({ state: "conflict", currentRevision: current.revision, message: "settings revision conflict" });
      }
      let settings: SettingsFileRecord["settings"];
      let resolved: ResolvedConfig;
      try {
        const currentConfig = ResolvedConfigSchema.parse(resolveCandidate(current.settings));
        settings = command.payload.assistantPermission === undefined ? mergeSettingsPatch(current.settings, command.payload.patch) : current.settings;
        resolved = ResolvedConfigSchema.parse(resolveCandidate(settings));
        if (sha256Hex(canonicalJsonStringify(resolved.config)) !== resolved.fingerprint) {
          throw new Error("settings-resolution-fingerprint-mismatch");
        }
        if (Object.keys(command.payload.patch).some(path => VALIDATED_PATHS.has(path))) {
          validateOrdinaryPathChanges(currentConfig.config, resolved.config);
        }
      } catch (error) {
        if (error instanceof OrdinaryPathValidationError) {
          return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "invalid-value",
            message: `${error.key}: ${error.reason}` });
        }
        const keys = error instanceof z.ZodError
          ? [...new Set(error.issues.map((issue) => issue.path.map(String).join(".")))].sort()
          : Object.keys(command.payload.patch).sort();
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "cross-field-invalid", message: `cross-field-invalid { keys: ${keys.join(", ")} }` });
      }
      if (Buffer.byteLength(canonicalJsonStringify(settings), "utf8") > 1_048_576) {
        return SettingsApplyRefusalSchema.parse({ state: "rejected", code: "document-too-large", message: "ordinary settings document-too-large" });
      }
      const revision = current.revision + 1;
      const settingsFingerprint = derivePersistedSettingsFingerprint(settings);
      const configSnapshotId = randomUUID();
      repositories.configSnapshots.insert({ configSnapshotId, revision, fingerprint: resolved.fingerprint,
        config: resolved.config, provenance: resolved.provenance,
        capturedAt: command.requestedAt, capturedBy: command.requestedBy });
      repositories.runtimeConfig.activate({ settingsRevision: revision, settingsFingerprint,
        configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: command.requestedAt });
      // The kernel journals the audit and saved row before committing this same transaction.
      return { state: "applied", revision, settings, restartRequired: false, settingsFingerprint };
    },
    reconcileReplay(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>) {
      const outcome = credentials.verifyReplay(protectedInput(command));
      if (outcome.state !== "applied") throw new Error("credential-replay-refused");
      return protectedSettingsReadback(outcome.record);
    },
  });
}
