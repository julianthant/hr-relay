import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AppSettingsSchema, type AppSettings } from "../../../domain/config/app-settings.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
export const APP_SETTINGS_DDL = `CREATE TABLE app_settings (
 record_key TEXT PRIMARY KEY CHECK(record_key='current'), record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 config_snapshot_id TEXT REFERENCES settings_snapshots(record_key) ON DELETE RESTRICT,
 command_id TEXT REFERENCES commands(record_key) ON DELETE RESTRICT,
 audit_id TEXT REFERENCES command_audits(record_key) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 CHECK(command_id IS json_extract(record_json,'$.saved.commandId')),
 CHECK(audit_id IS json_extract(record_json,'$.saved.auditId')),
 CHECK(config_snapshot_id IS json_extract(record_json,'$.active.configSnapshotId'))
) STRICT`;
export function readAppSettings(database: DatabaseSync): AppSettings | undefined {
 const row = database.prepare("SELECT record_json FROM app_settings WHERE record_key='current'").get();
 return row === undefined ? undefined : AppSettingsSchema.parse(JSON.parse(z.strictObject({record_json:z.string()}).parse(row).record_json));
}
export function writeAppSettings(database: DatabaseSync, input: AppSettings): void {
 const record = AppSettingsSchema.parse(input);
 const createdAt = record.saved?.committedAt ?? record.active?.activatedAt;
 if (createdAt === undefined) throw new Error("app-settings-empty-authority");
 database.prepare(`INSERT INTO app_settings(record_key,record_json,config_snapshot_id,command_id,audit_id,created_at) VALUES('current',?,?,?,?,?)
 ON CONFLICT(record_key) DO UPDATE SET record_json=excluded.record_json,config_snapshot_id=excluded.config_snapshot_id,command_id=excluded.command_id,audit_id=excluded.audit_id,created_at=excluded.created_at`)
 .run(canonicalJsonStringify(record),record.active?.configSnapshotId ?? null,record.saved?.commandId ?? null,record.saved?.auditId ?? null,createdAt);
}
export function convertAppSettings(database: DatabaseSync): void {
 const json = (table: "settings_current"|"runtime_config") => {
  const row = database.prepare(`SELECT record_json FROM ${table}`).get();
  return row === undefined ? null : JSON.parse(z.strictObject({record_json:z.string()}).parse(row).record_json) as unknown;
 };
 const saved=json("settings_current");const active=json("runtime_config");
 if(saved!==null||active!==null) writeAppSettings(database,AppSettingsSchema.parse({format:1,saved,active}));
}
