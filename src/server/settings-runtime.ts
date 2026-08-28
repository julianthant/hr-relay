import { canonicalJsonStringify } from "../domain/canonical-json.js";
import type { SettingsFileRecord } from "../domain/config/settings.js";
import { deriveSettingsCommandFingerprint } from "../domain/commands.js";
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
  if (record.revision === 1) return;
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
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify(expectedVersionChanges)
    || audit.affectedDependencyIds.length !== 0) {
    throw new Error(
      `settings revision ${String(record.revision)} command ${applied.commandId} has a mismatched durable audit`,
    );
  }
}
