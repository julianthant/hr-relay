import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";
import { commandFromRow } from "./command-record-row.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { projectStorageRelocationPlanHistory, type StorageRelocationHistoryRepositories } from "../maintenance/storage-relocation-plans.js";
import { CommandAuditRecordSchema, StorageRelocationCommandRequestSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import type { StorageRelocationPlanView } from "../../../rules/commands/commands.js";
import { withAuthorityDatabaseReadOnly } from "./readonly-authority-snapshot.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { AuthorityDatabase } from "./authority-database.js";
import type { VerifiedBackup } from "./backup-service.js";

const TextRow = z.strictObject({ id: z.string(), payload_json: z.string() });
const VersionRow = z.strictObject({ user_version: z.number().int() });

function refuse(reason: string): never { throw new Error(`relocation-restore-candidate: ${reason}`); }

function readHistory(database: DatabaseSync): StorageRelocationHistoryRepositories {
  const commands = database.prepare("SELECT * FROM commands WHERE family='storage-relocation' ORDER BY rowid")
    .all().map(raw=>StorageRelocationCommandRequestSchema.parse(commandFromRow(raw)));
  const audits = database.prepare(`SELECT audit.* FROM command_audits AS audit
    JOIN commands AS command ON command.id=audit.command_id
    WHERE command.family='storage-relocation' ORDER BY audit.rowid`)
    .all().map(raw=>CommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",raw)));
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
  if (input.verifiedBackup.manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) refuse("completed relocation requires the current native schema backup");
  if (input.verifiedBackup.manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(activeAuthorityPath)) {
    refuse("backup belongs to a former physical authority origin");
  }
  const backupPath = resolve(input.verifiedBackup.backupPath);
  const copyAdmission = admission.verifiedReadOnlyCopy(backupPath, input.verifiedBackup.manifest.sha256);
  try {
    return withAuthorityDatabaseReadOnly(copyAdmission, backupPath, (database) => {
      if (VersionRow.parse(database.prepare("PRAGMA user_version").get()).user_version !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
        refuse("candidate authority schema differs from verified manifest");
      }
      const history = readHistory(database);
      const view = projectStorageRelocationPlanHistory(history, context.locator, context.receipts, context.workspace);
      for (const receipt of context.receipts) {
        const rows = database.prepare("SELECT id, payload_json FROM settings_snapshots WHERE id = ?")
          .all(receipt.evidence.configSnapshotId);
        if (rows.length !== 1) refuse("activation snapshot missing or ambiguous");
        const row = TextRow.parse(rows[0]);
        const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(row.payload_json));
        const actualFingerprint = createHash("sha256").update(canonicalJsonStringify(snapshot.config)).digest("hex");
        if (row.id !== snapshot.configSnapshotId || snapshot.fingerprint !== actualFingerprint
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
