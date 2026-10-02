import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { projectStorageRelocationPlanHistory, type StorageRelocationHistoryRepositories } from "../maintenance/storage-relocation-plans.js";
import { CommandAuditRecordSchema, StorageRelocationCommandRequestSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import type { StorageRelocationPlanView } from "../../../rules/commands/commands.js";
import { withAuthorityDatabaseReadOnly } from "../compatibility/backup-inspection.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";
import { AuthorityDatabase } from "./authority-database.js";
import type { VerifiedBackup } from "./backup-service.js";

const TextRow = z.strictObject({ record_key: z.string(), record_json: z.string() });
const CommandRow = TextRow.extend({ family: z.string() });
const AuditRow = TextRow.extend({ command_id: z.string() });
const VersionRow = z.strictObject({ user_version: z.number().int() });

function refuse(reason: string): never { throw new Error(`relocation-restore-candidate: ${reason}`); }

function readHistory(database: DatabaseSync): StorageRelocationHistoryRepositories {
  const commands = database.prepare(`
    SELECT record_key, family, record_json FROM commands
    WHERE family = 'storage-relocation' OR json_extract(record_json, '$.family') = 'storage-relocation'
    ORDER BY rowid
  `)
    .all().map((raw) => {
      const row = CommandRow.parse(raw);
      const request = StorageRelocationCommandRequestSchema.parse(JSON.parse(row.record_json));
      if (row.record_key !== request.commandId || row.family !== request.family) refuse("command storage key mismatch");
      return request;
    });
  const audits = database.prepare(`
    SELECT audit.record_key, audit.command_id, audit.record_json FROM command_audits AS audit
    JOIN commands AS command ON command.record_key = audit.command_id
    WHERE command.family = 'storage-relocation' ORDER BY audit.rowid
  `).all().map((raw) => {
    const row = AuditRow.parse(raw);
    const audit = CommandAuditRecordSchema.parse(JSON.parse(row.record_json));
    if (row.record_key !== audit.auditId || row.command_id !== audit.request.commandId) refuse("audit storage key mismatch");
    return audit;
  });
  const byCommand = new Map<string, (typeof audits)[number]>();
  for (const audit of audits) {
    if (byCommand.has(audit.request.commandId)) refuse("duplicate relocation command audit");
    byCommand.set(audit.request.commandId, audit);
  }
  return {
    commands: { listStorageRelocationCommands: () => commands },
    commandAudits: { findByCommand: (commandId) => byCommand.get(commandId) },
  };
}

export function validateStorageRelocationRestoreCandidate(input: Readonly<{
  admission: RuntimeAdmission;
  activeAuthorityPath: string;
  verifiedBackup: VerifiedBackup;
}>): StorageRelocationPlanView | undefined {
  const admission = requireRuntimeAdmission(input.admission);
  const context = admission.readInstallationContext();
  if (context === undefined || context.locator.generation === 0) return undefined;
  const activeAuthorityPath = resolve(input.activeAuthorityPath);
  if (activeAuthorityPath !== join(context.locator.stateRoot, "state.db")) refuse("active authority path differs from locator");
  admission.assertAuthorityDatabase(activeAuthorityPath);
  if (context.receipts.length !== context.locator.generation) refuse("active receipt chain incomplete");
  if (input.verifiedBackup.manifest.schemaVersion !== 56) refuse("completed relocation requires schema 56 backup");
  if (input.verifiedBackup.manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(activeAuthorityPath)) {
    refuse("backup belongs to a former physical authority origin");
  }
  const backupPath = resolve(input.verifiedBackup.backupPath);
  const copyAdmission = admission.verifiedReadOnlyCopy(backupPath, input.verifiedBackup.manifest.sha256, "authority");
  try {
    return withAuthorityDatabaseReadOnly(copyAdmission, backupPath, (database) => {
      if (VersionRow.parse(database.prepare("PRAGMA user_version").get()).user_version !== 56) {
        refuse("candidate authority schema differs from verified manifest");
      }
      const history = readHistory(database);
      const view = projectStorageRelocationPlanHistory(history, context.locator, context.receipts, context.workspace);
      for (const receipt of context.receipts) {
        const rows = database.prepare("SELECT record_key, record_json FROM settings_snapshots WHERE record_key = ?")
          .all(receipt.evidence.configSnapshotId);
        if (rows.length !== 1) refuse("activation snapshot missing or ambiguous");
        const row = TextRow.parse(rows[0]);
        const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(row.record_json));
        const actualFingerprint = createHash("sha256").update(canonicalJsonStringify(snapshot.config)).digest("hex");
        if (row.record_key !== snapshot.configSnapshotId || snapshot.fingerprint !== actualFingerprint
          || snapshot.fingerprint !== receipt.evidence.configFingerprint
          || snapshot.config.paths.stateRoot !== receipt.destination.stateRoot
          || snapshot.config.paths.artifactRoot !== receipt.destination.artifactRoot) {
          refuse("activation snapshot fingerprint mismatch");
        }
      }
      return view;
    });
  } finally { copyAdmission.release(); }
}
