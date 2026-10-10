
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  LegacyProtectedSettingsNameSchema as ProtectedSettingsNameSchema,
  legacyProtectedSettingsReadback as protectedSettingsReadback,
  type LegacyProtectedStoreRecord as ProtectedStoreRecord,
} from "../../../models/config/protected-settings-legacy.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import type { CommandAuditRecord } from "../../../rules/commands/commands.js";
import {
  deriveJournaledSettingsCommandFingerprint,
  journaledSettingsCommand,
  type HistoricalProtectedSettingsAudit,
  type HistoricalProtectedSettingsCommand,
} from "../../../rules/commands/commands-history.js";
import type { ProtectedSettingsCurrentRecord } from "../../../models/config/authority.js";

// Frozen test-target rows remain readable under the seven-name protected schema.
export type JournaledProtectedCommand = CommandRequest | HistoricalProtectedSettingsCommand;
export type JournaledProtectedAudit = CommandAuditRecord | HistoricalProtectedSettingsAudit;
export interface LegacyProtectedJournal {
  commands: { get(commandId: string): JournaledProtectedCommand | undefined };
  commandAudits: { findByCommand(commandId: string): JournaledProtectedAudit | undefined };
  protectedSettingsCurrent: { get(): ProtectedSettingsCurrentRecord | undefined };
}

function protectedCurrentEntries(record: ProtectedStoreRecord) {
  return ProtectedSettingsNameSchema.options.flatMap((name) => {
    const entry = record.entries[name];
    return entry === undefined ? [] : [{ name, valueId: entry.valueId, updatedAt: entry.updatedAt }];
  });
}

function requireMatchingProtectedCommand(
  record: ProtectedStoreRecord,
  applied: NonNullable<ProtectedStoreRecord["lastApplied"]>,
  command: JournaledProtectedCommand | undefined,
) {
  if (command === undefined) {
    throw new Error(
      `protected settings revision ${String(record.revision)} has no durable command journal for protected.json; `
      + "the protected file outlived its authority database — restore the state root, or delete protected.json "
      + "and re-enter every protected entry",
    );
  }
  if (command.family !== "settings" || command.type !== "apply-protected-settings") {
    throw new Error(
      `protected settings revision ${String(record.revision)} names non-protected-settings command ${applied.commandId}`,
    );
  }
  const commandFingerprint = deriveJournaledSettingsCommandFingerprint(command);
  if (commandFingerprint !== applied.commandFingerprint
    || command.target.expectedRevision !== applied.expectedRevision
    || command.payload.protectedSchemaHash !== applied.protectedSchemaHash
    || command.payload.writeId !== applied.writeId) {
    throw new Error(
      `protected settings revision ${String(record.revision)} does not match the full marked journaled command envelope `
      + applied.commandId,
    );
  }
  return command;
}

type ProtectedJournalAdmission = Readonly<
  | { kind: "required" }
  | { kind: "prepared" }
>;

export function observeJournaledProtectedSettings(
  record: ProtectedStoreRecord,
  repositories: LegacyProtectedJournal,
  admission: ProtectedJournalAdmission,
): "authenticated" | "absent-for-command" {
  const applied = record.lastApplied;
  if (applied === undefined) {
    throw new Error(`protected settings revision ${String(record.revision)} names no last applied command`);
  }
  const durableCommand = repositories.commands.get(applied.commandId);
  const audit = repositories.commandAudits.findByCommand(applied.commandId);
  const current = repositories.protectedSettingsCurrent.get();
  if (admission.kind === "prepared"
    && durableCommand === undefined
    && audit === undefined
    && current?.commandId !== applied.commandId) {
    return "absent-for-command";
  }
  const command = requireMatchingProtectedCommand(record, applied, durableCommand);
  if (current === undefined || record.revision > current.revision) {
    throw new Error(
      `authority-unjournaled: protected.json revision ${String(record.revision)} has no matching protected settings singleton`,
    );
  }
  if (record.revision < current.revision) {
    throw new Error(
      `authority-uncertain: protected.json revision ${String(record.revision)} is behind canonical revision `
      + `${String(current.revision)}; delete protected.json and re-enter every protected entry`,
    );
  }
  if (audit === undefined) {
    throw new Error(
      `protected settings revision ${String(record.revision)} command ${applied.commandId} has no durable audit`,
    );
  }
  const target = { family: "protected-settings" as const, revision: record.revision };
  const expectedVersionChanges = [{
    target,
    before: applied.expectedRevision,
    after: record.revision,
  }];
  const readback = protectedSettingsReadback(record);
  if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(journaledSettingsCommand(command))
    || audit.result.state !== "applied"
    || audit.result.commandId !== applied.commandId
    || audit.result.restartRequired !== false
    || audit.result.revision !== record.revision
    || canonicalJsonStringify(audit.result.entries) !== canonicalJsonStringify(readback.entries)
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify(expectedVersionChanges)
    || audit.affectedDependencyIds.length !== 0) {
    throw new Error(
      `protected settings revision ${String(record.revision)} command ${applied.commandId} has a mismatched durable audit`,
    );
  }
  const entries = protectedCurrentEntries(record);
  if (current.revision !== record.revision
    || current.commandId !== applied.commandId
    || current.commandFingerprint !== applied.commandFingerprint
    || current.auditId !== audit.auditId
    || current.committedAt !== audit.completedAt
    || canonicalJsonStringify(current.entries) !== canonicalJsonStringify(entries)) {
    throw new Error(
      `authority-uncertain: protected.json revision ${String(record.revision)} does not match its exact canonical current result; `
      + "delete protected.json and re-enter every protected entry",
    );
  }
  return "authenticated";
}

/** Prove the protected bytes against their value-free command, audit and singleton identities. */
export function requireJournaledProtectedSettings(
  record: ProtectedStoreRecord,
  repositories: LegacyProtectedJournal,
): void {
  const current = repositories.protectedSettingsCurrent.get();
  if (record.revision === 1) {
    if (current !== undefined) {
      throw new Error(
        `authority-uncertain: baseline protected.json is stale behind canonical current revision ${String(current.revision)}; `
        + "delete protected.json and re-enter every protected entry",
      );
    }
    return;
  }
  observeJournaledProtectedSettings(record, repositories, { kind: "required" });
}
