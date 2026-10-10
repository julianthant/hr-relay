import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AppSettingsSchema, type AppSettings } from "../../../models/config/app-settings.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { SettingsInitializationAuditSchema } from "../../../models/config/settings-initialization.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { CommandRequestSchema, CommandAuditRecordSchema, deriveSettingsCommandFingerprint } from "../../../rules/commands/commands.js";
import { SettingsCurrentRecordSchema } from "../../../models/config/settings-current.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { commandFromRow } from "./command-record-row.js";

export function authenticateSavedSettings(currentInput:unknown,commandInput:unknown,auditInput:unknown){
  const current=SettingsCurrentRecordSchema.parse(currentInput),command=CommandRequestSchema.parse(commandInput),audit=CommandAuditRecordSchema.parse(auditInput);
  const result=audit.result;
  const target={family:"settings",revision:current.revision};
  if(command.family!=="settings" || command.type!=="apply-settings" || command.commandId!==current.commandId
    || command.target.expectedRevision!==current.revision-1 || deriveSettingsCommandFingerprint(command)!==current.commandFingerprint
    || audit.auditId!==current.auditId || canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)
    || result.state!=="applied" || result.commandId!==current.commandId
    || result.settingsRevision!==current.revision || result.settingsFingerprint!==current.settingsFingerprint
    || typeof result.restartRequired!=="boolean" || audit.completedAt!==current.committedAt
    || canonicalJsonStringify(result.affectedTargets)!==canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges)!==canonicalJsonStringify([{target,before:current.revision-1,after:current.revision}])
    || audit.affectedDependencyIds.length!==0)throw new Error("settings-current-command-audit-binding-mismatch");
  return {command,audit,result};
}

export function readAppSettings(database: DatabaseSync): AppSettings | undefined {
  const raw = database.prepare("SELECT * FROM settings WHERE id='current'").get();
  if (raw === undefined) {
    const history=database.prepare("SELECT 1 FROM commands WHERE family='settings' OR json_extract(request_json,'$.kind')='settings-initialization' LIMIT 1").get();
    if(history!==undefined || database.prepare("SELECT 1 FROM settings_snapshots LIMIT 1").get()!==undefined)throw new Error("settings-current-missing-with-history");
    return undefined;
  }
  const row = z.strictObject({ id: z.literal("current"), revision: z.number().int().positive(), snapshot_id: z.string(),
    command_id: z.string(), audit_id: z.string(), payload_json: z.string(), updated_at: z.string() }).parse(raw);
  const record = AppSettingsSchema.parse(JSON.parse(row.payload_json));
  const revision = record.saved?.revision ?? 1;
  const commandId = record.saved?.commandId ?? record.initialization.commandId;
  const auditId = record.saved?.auditId ?? record.initialization.auditId;
  const updatedAt = record.saved?.committedAt ?? record.active?.activatedAt ?? record.initialization.initializedAt;
  const snapshotId = record.active?.configSnapshotId ?? record.initialization.configSnapshotId;
  if (row.revision !== revision || row.command_id !== commandId || row.audit_id !== auditId
    || row.snapshot_id !== snapshotId || row.updated_at !== updatedAt) throw new Error("settings-row-identity-mismatch");
  const initialCommandRow = database.prepare("SELECT * FROM commands WHERE id=?").get(record.initialization.commandId);
  if (initialCommandRow === undefined) throw new Error("settings-initialization-command-missing");
  const initialCommand = commandFromRow(initialCommandRow);
  const initialAuditRow = database.prepare("SELECT * FROM command_audits WHERE id=?").get(record.initialization.auditId);
  if (initialAuditRow === undefined) throw new Error("settings-initialization-audit-missing");
  const audit = SettingsInitializationAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",initialAuditRow));
  if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(initialCommand)
    || canonicalJsonStringify({ commandId: audit.request.commandId, auditId: audit.auditId,
      configSnapshotId: audit.request.configSnapshotId, configFingerprint: audit.request.configFingerprint,
      initializedAt: audit.request.initializedAt, settings: audit.request.settings }) !== canonicalJsonStringify(record.initialization)) {
    throw new Error("settings-initialization-binding-mismatch");
  }
  if(record.saved!==null){
    const savedCommandRow=database.prepare("SELECT * FROM commands WHERE id=?").get(record.saved.commandId);
    const savedAuditRow=database.prepare("SELECT * FROM command_audits WHERE id=?").get(record.saved.auditId);
    if(savedCommandRow===undefined || savedAuditRow===undefined)throw new Error("settings-current-command-audit-missing");
    authenticateSavedSettings(record.saved,commandFromRow(savedCommandRow),nativeOrdinaryRecordFromRow("command_audits",savedAuditRow));
  }
  const snapshotRaw = database.prepare("SELECT payload_json FROM settings_snapshots WHERE id=?").get(snapshotId);
  if (snapshotRaw === undefined) throw new Error("settings-snapshot-missing");
  const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(z.strictObject({ payload_json: z.string() }).parse(snapshotRaw).payload_json));
  if (snapshot.configSnapshotId !== snapshotId || snapshot.fingerprint !== (record.active?.configFingerprint ?? record.initialization.configFingerprint)) throw new Error("settings-snapshot-binding-mismatch");
  return record;
}
export function writeAppSettings(database: DatabaseSync, input: AppSettings): void {
  const record = AppSettingsSchema.parse(input);
  database.prepare(`INSERT INTO settings(id,revision,snapshot_id,command_id,audit_id,payload_json,updated_at) VALUES('current',?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,snapshot_id=excluded.snapshot_id,command_id=excluded.command_id,audit_id=excluded.audit_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(record.saved?.revision ?? 1, record.active?.configSnapshotId ?? record.initialization.configSnapshotId,
      record.saved?.commandId ?? record.initialization.commandId, record.saved?.auditId ?? record.initialization.auditId,
      canonicalJsonStringify(record), record.saved?.committedAt ?? record.active?.activatedAt ?? record.initialization.initializedAt);
}
