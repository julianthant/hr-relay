import { randomUUID } from "node:crypto";
import { ProtectedSettingsCommandRequestSchema, deriveSettingsCommandFingerprint, markSettingsCommand } from "../../../src/domain/commands.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsNameSchema, protectedSettingsReadback } from "../../../src/domain/config/protected-settings.js";
import type { z } from "zod";
import type { ProtectedSettingsFileAuthority } from "../../../src/infra/config/settings-file.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";

/** Synthetic fixture publication with the same marked journal/audit/current identities as apply. */
export function journalProtectedSettings(
  database: AuthorityDatabase,
  file: ProtectedSettingsFileAuthority,
  entries: z.infer<typeof ProtectedSettingsCommandRequestSchema>["payload"]["entries"],
  now = "2026-08-28T12:00:00.000Z",
): void {
  const expectedRevision = file.read().revision;
  const command = ProtectedSettingsCommandRequestSchema.parse({
    commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-protected-settings", target: { expectedRevision },
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries },
  });
  const commandFingerprint = deriveSettingsCommandFingerprint(command);
  const outcome = file.apply({ ...command.payload, commandId: command.commandId,
    commandFingerprint, expectedRevision, updatedAt: now });
  if (outcome.state !== "applied") throw new Error("synthetic protected publication refused");
  try {
    database.withAuthorityTransaction((repositories) => {
      const marked = markSettingsCommand(command);
      const revision = outcome.record.revision;
      const target = { family: "protected-settings" as const, revision };
      const auditId = randomUUID();
      repositories.commands.insert(marked);
      repositories.commandAudits.insert({
        auditId, request: marked, completedAt: now,
        result: { state: "applied", commandId: command.commandId, affectedTargets: [target],
          restartRequired: false, revision, entries: protectedSettingsReadback(outcome.record).entries },
        versionChanges: [{ target, before: expectedRevision, after: revision }], affectedDependencyIds: [],
      });
      repositories.protectedSettingsCurrent.advanceInTransaction({
        revision, commandId: command.commandId, commandFingerprint, auditId, committedAt: now,
        entries: ProtectedSettingsNameSchema.options.flatMap((name) => {
          const entry = outcome.record.entries[name];
          return entry === undefined ? [] : [{ name, valueId: entry.valueId, updatedAt: entry.updatedAt }];
        }),
      });
    });
    outcome.commit();
  } catch (error) {
    outcome.rollback();
    throw error;
  }
}
