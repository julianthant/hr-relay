import { canonicalJsonStringify } from "../domain/canonical-json.js";
import type { SettingsFileRecord } from "../domain/config/settings.js";
import { deriveSettingsCommandFingerprint } from "../domain/commands.js";
import type {
  SettingsFileAuthority,
  SettingsPreparedUpdate,
} from "../infra/config/settings-file.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";

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
  const applied = record.lastApplied;
  if (applied === undefined) {
    throw new Error(`settings revision ${String(record.revision)} names no last applied command`);
  }
  const command = repositories.commands.get(applied.commandId);
  if (command === undefined) {
    throw new Error(
      `settings revision ${String(record.revision)} has no durable command journal for ${applied.commandId}`,
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
  const audit = repositories.commandAudits.findByCommand(applied.commandId);
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
}

function resolvePreparedSettings(
  prepared: SettingsPreparedUpdate,
  repositories: AuthorityRepositories,
): "committed" | "rollback" {
  const durableCommand = repositories.commands.get(prepared.command.commandId);
  const current = repositories.settingsCurrent.get();
  if (durableCommand !== undefined || current?.commandId === prepared.command.commandId) {
    requireJournaledSettings(prepared.next, repositories);
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
