import { canonicalJsonStringify } from "../domain/canonical-json.js";
import {
  SettingsRuntimeStatusSchema,
  settingsRuntimeIdentity,
  type SettingsFileRecord,
  type SettingsRuntimeIdentity,
  type SettingsRuntimeStatus,
} from "../domain/config/settings.js";
import type { Clock } from "../domain/clock.js";
import type { SettingsCurrentRecord } from "../domain/config/settings-current.js";
import { resolveConfigWithProvenance } from "../domain/config/resolve.js";
import type { CommandAuthority } from "../core/command-kernel.js";
import { deriveSettingsCommandFingerprint, type CommandRequest } from "../domain/commands.js";
import type {
  SettingsFileAuthority,
  SettingsPreparedUpdate,
} from "../infra/config/settings-file.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";

function requireMatchingSettingsCommand(
  record: SettingsFileRecord,
  applied: NonNullable<SettingsFileRecord["lastApplied"]>,
  command: CommandRequest | undefined,
) {
  if (command === undefined) {
    throw new Error(
      `settings revision ${String(record.revision)} has no durable command journal for ${applied.commandId}; `
      + "the settings file outlived its authority database (both live in the state root) — restore the state root, "
      + "or remove settings.json and its .authority.json sidecar there to boot from the never-applied baseline",
    );
  }
  if (command.family !== "settings" || command.type !== "apply-settings") {
    throw new Error(
      `settings revision ${String(record.revision)} names non-settings command ${applied.commandId}`,
    );
  }
  const commandFingerprint = deriveSettingsCommandFingerprint(command);
  if (commandFingerprint !== applied.commandFingerprint
    || command.target.expectedRevision !== applied.expectedRevision
    || command.payload.settingsSchemaHash !== applied.settingsSchemaHash
    || command.payload.patchFingerprint !== applied.patchFingerprint) {
    throw new Error(
      `settings revision ${String(record.revision)} does not match the full journaled command envelope `
      + `${applied.commandId}`,
    );
  }
  return command;
}

/**
 * Prove that the non-baseline settings bytes came from the exact command and
 * audit committed in the authority transaction. A file rename by itself is
 * never runtime activation authority.
 */
export function requireJournaledSettings(
  record: SettingsFileRecord,
  repositories: AuthorityRepositories,
): void {
  const current = repositories.settingsCurrent.get();
  if (record.revision === 1) {
    if (current !== undefined) {
      throw new Error(
        `baseline settings bytes are stale behind canonical current revision ${String(current.revision)}`,
      );
    }
    return;
  }
  observeJournaledSettings(record, repositories, { kind: "required", current });
}

/**
 * One read/authentication path. Recovery must observe all presence evidence
 * before classifying absence; ordinary admission must validate the command
 * before reading its audit. These orders preserve the callers' diagnostics.
 * Observations never escape this synchronous invocation or replace final verification.
 */
function observeJournaledSettings(
  record: SettingsFileRecord,
  repositories: AuthorityRepositories,
  admission: Readonly<
    | { kind: "required"; current: SettingsCurrentRecord | undefined }
    | { kind: "prepared" }
  >,
): "authenticated" | "absent-for-command" {
  const applied = record.lastApplied;
  if (applied === undefined) {
    throw new Error(`settings revision ${String(record.revision)} names no last applied command`);
  }
  const durableCommand = repositories.commands.get(applied.commandId);
  const commandObservation = admission.kind === "required"
    ? { kind: "authenticated" as const, command: requireMatchingSettingsCommand(record, applied, durableCommand) }
    : { kind: "observed" as const, command: durableCommand };
  const audit = repositories.commandAudits.findByCommand(applied.commandId);
  const current = admission.kind === "prepared" ? repositories.settingsCurrent.get() : admission.current;
  if (admission.kind === "prepared"
    && durableCommand === undefined
    && audit === undefined
    && current?.commandId !== applied.commandId) {
    return "absent-for-command";
  }
  const command = commandObservation.kind === "authenticated"
    ? commandObservation.command
    : requireMatchingSettingsCommand(record, applied, commandObservation.command);
  if (audit === undefined) {
    throw new Error(
      `settings revision ${String(record.revision)} command ${applied.commandId} has no durable audit`,
    );
  }
  const target = { family: "settings" as const, revision: record.revision };
  const expectedVersionChanges = [{
    target,
    before: applied.expectedRevision,
    after: record.revision,
  }];
  if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || audit.result.state !== "applied"
    || audit.result.commandId !== applied.commandId
    || audit.result.restartRequired !== true
    || audit.result.settingsRevision !== record.revision
    || audit.result.settingsFingerprint !== record.settingsFingerprint
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify(expectedVersionChanges)
    || audit.affectedDependencyIds.length !== 0) {
    throw new Error(
      `settings revision ${String(record.revision)} command ${applied.commandId} has a mismatched durable audit`,
    );
  }
  if (current === undefined
    || current.revision !== record.revision
    || current.settingsFingerprint !== record.settingsFingerprint
    || current.commandId !== applied.commandId
    || current.commandFingerprint !== applied.commandFingerprint
    || current.auditId !== audit.auditId
    || current.committedAt !== audit.completedAt) {
    throw new Error(
      `settings revision ${String(record.revision)} is not the exact canonical current settings result`,
    );
  }
  return "authenticated";
}

function resolvePreparedSettings(
  prepared: SettingsPreparedUpdate,
  repositories: AuthorityRepositories,
): "committed" | "rollback" {
  if (observeJournaledSettings(prepared.next, repositories, { kind: "prepared" }) === "authenticated") {
    return "committed";
  }
  requireJournaledSettings(prepared.prior, repositories);
  return "rollback";
}

/**
 * Reconcile a process-loss prepare under the settings lock, then prove the
 * resulting bytes are the exact singleton state committed by SQLite.
 */
export function readJournaledSettings(
  authority: SettingsFileAuthority,
  repositories: AuthorityRepositories,
): SettingsFileRecord {
  const record = authority.reconcile((prepared) =>
    resolvePreparedSettings(prepared, repositories));
  requireJournaledSettings(record, repositories);
  return record;
}

export interface SettingsRuntimeSnapshot {
  readonly record: SettingsFileRecord;
  readonly runtimeStatus: SettingsRuntimeStatus;
}

/** One verified snapshot for the existing editor wire; it owns no file or generation. */
export function createSettingsRuntimeReader(input: Readonly<{
  file: SettingsFileAuthority;
  database: CommandAuthority;
  environment: NodeJS.ProcessEnv;
  clock: Clock;
  active: SettingsRuntimeIdentity;
}>): Readonly<{ read(): SettingsRuntimeSnapshot }> {
  return Object.freeze({
    read: () => input.database.withAuthorityTransaction((repositories) => {
      // The wire describes THIS process, and must not borrow a newer process's activation.
      repositories.runtimeConfig.requireActive({
        settingsRevision: input.active.settingsRevision,
        settingsFingerprint: input.active.settingsFingerprint,
        configFingerprint: input.active.configFingerprint,
      });
      const record = readJournaledSettings(input.file, repositories);
      const resolved = resolveConfigWithProvenance(input.environment, record.settings, input.clock);
      const persisted = settingsRuntimeIdentity(record, resolved.fingerprint);
      const runtimeStatus = SettingsRuntimeStatusSchema.parse(
        canonicalJsonStringify(persisted) === canonicalJsonStringify(input.active)
          ? { state: "current", identity: input.active }
          : { state: "restart-required", active: input.active, persisted },
      );
      return Object.freeze({ record, runtimeStatus });
    }),
  });
}
