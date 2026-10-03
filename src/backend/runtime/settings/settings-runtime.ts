import { selectActiveRunSettings } from "../../runs/settings/run-settings.js";
import { executionConfigFromStored } from "../../../models/config/snapshot-generations.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { HostConfigFacts } from "../../../models/config/host-display.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import { resolveConfigWithProvenance, type AdmittedRuntimeStoragePair } from "../../app/config/resolve.js";
import {
  SettingsRuntimeStatusSchema, SETTINGS_SCHEMA_HASH,
  initialSettingsFileRecord, settingsRuntimeIdentity,
  type SettingsFileRecord, type SettingsRuntimeIdentity, type SettingsRuntimeStatus,
} from "../../../models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, protectedSettingsReadback, type ProtectedSettingsReadback, type ProtectedStoreRecord } from "../../../models/config/protected-settings.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

/** SQLite is the sole ordinary authority. Revision one exists only before durable settings history. */
export function readSettings(repositories: AuthorityRepositories): SettingsFileRecord {
  const current = repositories.settingsCurrent.get();
  if (current === undefined) {
    const initial = initialSettingsFileRecord();
    const active = repositories.runtimeConfig.get();
    if (repositories.settingsCurrent.hasHistory() || repositories.settingsCurrent.hasAuditHistory()
      || repositories.runtimeConfig.hasAdvancedHistory()
      || (active === undefined && repositories.runtimeConfig.hasHistory())
      || (active !== undefined && (active.settingsRevision !== initial.revision
        || active.settingsFingerprint !== initial.settingsFingerprint))) {
      throw new Error("settings-current-missing-with-history");
    }
    if (active !== undefined) repositories.runtimeConfig.requireActive({ settingsRevision: active.settingsRevision,
      settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint });
    return initial;
  }
  const command = repositories.commands.getSettingsHistory(current.commandId);
  if (command === undefined) throw new Error(`settings revision ${String(current.revision)} has no durable command journal`);
  if (command.family !== "settings" || command.type !== "apply-settings"
    || sha256Hex(`hrauto:settings-command:v1\0${canonicalJsonStringify(command)}`) !== current.commandFingerprint
    || command.target.expectedRevision !== current.revision - 1) {
    throw new Error(`settings revision ${String(current.revision)} does not match the full journaled command envelope`);
  }
  const audit = repositories.commandAudits.findSettingsHistory(current.commandId);
  const target = { family: "settings", revision: current.revision };
  if (audit === undefined) throw new Error(`settings revision ${String(current.revision)} has no durable audit`);
  if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || audit.result.state !== "applied" || audit.result.commandId !== current.commandId
    || typeof audit.result.restartRequired !== "boolean" || audit.result.settingsRevision !== current.revision
    || audit.result.settingsFingerprint !== current.settingsFingerprint
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{ target, before: command.target.expectedRevision, after: current.revision }])
    || audit.affectedDependencyIds.length !== 0 || audit.auditId !== current.auditId
    || audit.completedAt !== current.committedAt) {
    throw new Error(`settings revision ${String(current.revision)} has a mismatched durable audit`);
  }
  return Object.freeze({
    revision: current.revision,
    settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    settingsFingerprint: current.settingsFingerprint,
    settings: current.settings,
  });
}

/** Boot must not replace a missing active generation when durable Settings or snapshot history remains. */
export function readBootSettings(repositories: AuthorityRepositories): SettingsFileRecord {
  const record = readSettings(repositories);
  if (repositories.runtimeConfig.get() === undefined
    && (record.revision > 1 || repositories.runtimeConfig.hasHistory())) {
    throw new Error("dashboard settings/runtime authority is missing despite durable revision evidence");
  }
  return record;
}

export function requireCurrentSettings(record: SettingsFileRecord, repositories: AuthorityRepositories): void {
  const current = readSettings(repositories);
  if (canonicalJsonStringify(current) !== canonicalJsonStringify(record)) {
    throw new Error("settings changed after worker boot; restart activation is required");
  }
}

/** Credentials are read at next use; SQLite history never gates availability. */
export function createCredentialSecretSource(store: Pick<CredentialStore, "read">): Pick<CredentialStore, "read"> {
  return Object.freeze({ read: () => store.read() });
}

export interface ProtectedSettingsRuntimeSnapshot {
  readonly protectedSchemaHash: string;
  readonly readback: ProtectedSettingsReadback;
  readonly record: ProtectedStoreRecord;
}

export function createProtectedSettingsRuntimeReader(store: Pick<CredentialStore, "read">): Readonly<{ read(): ProtectedSettingsRuntimeSnapshot }> {
  return Object.freeze({ read: () => {
    const record = store.read();
    return Object.freeze({
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      readback: protectedSettingsReadback(record),
      record,
    });
  } });
}

export interface SettingsRuntimeSnapshot {
  readonly record: SettingsFileRecord;
  readonly runtimeStatus: SettingsRuntimeStatus;
}

export function createSettingsRuntimeReader(input: Readonly<{
  hostFacts: HostConfigFacts;
  clock: Clock;
  runtimeStoragePair?: AdmittedRuntimeStoragePair;
  active: SettingsRuntimeIdentity | ((repositories: AuthorityRepositories) => SettingsRuntimeIdentity);
}>): Readonly<{ read(repositories: AuthorityRepositories): SettingsRuntimeSnapshot }> {
  return Object.freeze({
    read: (repositories) => {
      const active = typeof input.active === "function" ? input.active(repositories) : input.active;
      repositories.runtimeConfig.requireActive({
        settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint,
        configFingerprint: active.configFingerprint,
      });
      const record = readSettings(repositories);
      const resolved = resolveConfigWithProvenance(record.settings, input.hostFacts, input.clock, input.runtimeStoragePair);
      const persisted = settingsRuntimeIdentity(record, resolved.fingerprint);
      const runtimeStatus = SettingsRuntimeStatusSchema.parse(
        canonicalJsonStringify(persisted) === canonicalJsonStringify(active)
          ? { state: "current", identity: active }
          : { state: "restart-required", active, persisted },
      );
      return Object.freeze({ record, runtimeStatus });
    },
  });
}

/** The caller's SQLite transaction excludes concurrent settings application. */
export function withCurrentSettings<Result>(
  repositories: AuthorityRepositories,
  expected: Readonly<{ revision: number; settingsFingerprint: string }>,
  work: () => Result,
): Result {
  const current = readSettings(repositories);
  if (current.revision !== expected.revision || current.settingsFingerprint !== expected.settingsFingerprint) {
    throw new Error("settings changed after worker boot; restart activation is required");
  }
  return work();
}

/** Dashboard reads follow the committed active identity; saved-only changes remain explicit. */
export function activeSettingsRuntimeIdentity(repositories: AuthorityRepositories): SettingsRuntimeIdentity {
 const active = repositories.runtimeConfig.get();
 if (active === undefined) throw new Error("settings-runtime-active-missing");
 return { settingsSchemaHash: SETTINGS_SCHEMA_HASH, settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
  configFingerprint: active.configFingerprint };
}
export function activeSettingsConfig(repositories: AuthorityRepositories) {
 return executionConfigFromStored(selectActiveRunSettings(repositories).config);
}
