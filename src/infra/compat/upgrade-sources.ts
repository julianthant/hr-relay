/** A0 migration-only sources. Phase 2.6 owns removal; never imported by runtime resolution. */
import { constants, openSync, closeSync, fstatSync, readFileSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { parseEnv } from "node:util";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../../domain/clock.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { SETTINGS_CATALOG, MIGRATED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "../../domain/config/catalog.js";
import { isRegisteredEnvironmentKey } from "../../domain/runtime-environment.js";
import { strictlyValidateLocalEnvironment } from "../../domain/secrets.js";
import { EditableSettingsOverrideSchema } from "../../domain/config/schema.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { SettingsFileRecordSchema, initialSettingsFileRecord, mergeSettingsPatch, SettingsPatchSchema, type SettingsFileRecord } from "../../domain/config/settings.js";
import { ProtectedSettingsPatchSchema, type ProtectedSettingsPatch } from "../../domain/config/protected-settings.js";
// D341: D331 protected bytes are read with the FROZEN legacy family, never the live one.
import {
  LegacyProtectedStoreRecordSchema as ProtectedStoreRecordSchema,
  RETIRED_TEST_TARGET_PROTECTED_NAMES,
  initialLegacyProtectedStoreRecord as initialProtectedStoreRecord,
  type LegacyProtectedStoreRecord as ProtectedStoreRecord,
} from "../../domain/config/protected-settings-legacy.js";
import { SettingsCurrentRecordSchema as HistoricalSettingsCurrentSchema } from "./d331-settings-current.js";
import { SettingsRootAuthoritySchema } from "./d331-settings-root.js";
import { CommandRequestSchema, CommandAuditRecordSchema } from "../../domain/commands.js";
import { ProtectedSettingsCurrentRecordSchema } from "../../domain/authority.js";
import { requireJournaledProtectedSettings } from "./d331-protected-journal.js";
import { recoverSettingsSources } from "./settings-source-recovery.js";
import { HistoricalProtectedSettingsAuditSchema, HistoricalProtectedSettingsCommandSchema, PreFloorSettingsCommandSchema, PreFloorCommandAuditSchema } from "../../domain/commands-history.js";
import { SettingsFileRecordSchema as PreFloorRecordSchema, SETTINGS_SCHEMA_HASH as PRE_FLOOR_SCHEMA_HASH } from "./pre-floor-settings.js";

/** D336 operator-approved historical names: report cleanup, never decode/import values. */
const CLEANUP_ONLY_ENVIRONMENT_KEYS = new Set([
  "I9_USER_ID", "I9_PASSWORD", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
]);

type MigrationSettingsRecord = SettingsFileRecord | z.infer<typeof PreFloorRecordSchema>;

const JsonObjectSchema = z.record(z.string(), z.unknown());
const JsonRowSchema = z.object({ record_json: z.string() });
const SidecarSchema = z.strictObject({
  schemaVersion: z.literal(1), settingsPathFingerprint: z.string(), settingsSchemaHash: z.literal(PRE_FLOOR_SCHEMA_HASH), state: z.enum(["virgin", "initialized"]),
});

/** Reject aliases and non-directory ancestry, including dangling links on optional inputs. */
export function requireMigrationSourcePath(path: string): void {
  let current = resolve(path);
  let leaf = true;
  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!leaf && !stat.isDirectory())) throw new Error(`source-integrity { file: ${basename(path)} }`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent; leaf = false;
  }
}

/** One no-follow descriptor; source bytes and permissions never change during import. */
export function readPrivateMigrationSource(path: string, maximumBytes = 4_194_304): string {
  requireMigrationSourcePath(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > maximumBytes) {
      throw new Error(`source-integrity { file: ${basename(path)} }`);
    }
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    requireMigrationSourcePath(path);
    const named = lstatSync(path);
    if (bytes.byteLength > maximumBytes || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ino !== after.ino || named.ino !== stat.ino || named.dev !== stat.dev || after.nlink !== 1 || after.mode !== stat.mode || after.uid !== stat.uid) {
      throw new Error(`source-changed { file: ${basename(path)} }`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { closeSync(fd); }
}

export function ordinaryLeaves(input: unknown, prefix = ""): Record<string, unknown> {
  const catalogKey = prefix.replace(/^annualDates\.FY\d{4}\./u, "annualDates.*.");
  if (SETTINGS_CATALOG.some((row) => row.sourceClass === "ordinary-settings" && row.key === catalogKey)) return { [prefix]: input };
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { [prefix]: input };
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) =>
    Object.entries(ordinaryLeaves(value, prefix === "" ? key : `${prefix}.${key}`))));
}

function equalProtectedSources(left: unknown, right: unknown): boolean {
  const a = Buffer.from(canonicalJsonStringify(left));
  const b = Buffer.from(canonicalJsonStringify(right));
  const limit = 4_194_304;
  if (a.length > limit || b.length > limit) throw new Error("source-integrity: protected comparison exceeds input bound");
  const paddedA = Buffer.alloc(limit + 4); const paddedB = Buffer.alloc(limit + 4);
  paddedA.writeUInt32BE(a.length); paddedB.writeUInt32BE(b.length);
  paddedA.set(a, 4); paddedB.set(b, 4);
  return timingSafeEqual(paddedA, paddedB);
}

function authenticateSource(record: MigrationSettingsRecord, database: DatabaseSync | undefined): void {
  const hasCurrent = database?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings_current'").get();
  const row = hasCurrent === undefined ? undefined : database?.prepare("SELECT * FROM settings_current WHERE record_key='current'").get();
  if (record.revision === 1) {
    if (row !== undefined) throw new Error("authority-deleted { file: settings.json }");
    return;
  }
  if (database === undefined || row === undefined || record.lastApplied === undefined) throw new Error("authority-unjournaled { file: settings.json }");
  const current = HistoricalSettingsCurrentSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json));
  const columns = JsonObjectSchema.parse(row);
  if (columns.revision !== current.revision || columns.settings_fingerprint !== current.settingsFingerprint
    || columns.command_id !== current.commandId || columns.command_fingerprint !== current.commandFingerprint
    || columns.audit_id !== current.auditId || columns.created_at !== current.committedAt) throw new Error("authority-current-columns-divergent");
  const commandRow = database.prepare("SELECT * FROM commands WHERE record_key=?").get(record.lastApplied.commandId);
  const auditRow = database.prepare("SELECT * FROM command_audits WHERE record_key=?").get(z.string().parse(current.auditId));
  if (commandRow === undefined || auditRow === undefined) throw new Error("authority-unjournaled { file: settings.json }");
  const rawCommand: unknown = JSON.parse(JsonRowSchema.parse(commandRow).record_json);
  const rawAudit: unknown = JSON.parse(JsonRowSchema.parse(auditRow).record_json);
  const command = record.settingsSchemaHash === PRE_FLOOR_SCHEMA_HASH ? PreFloorSettingsCommandSchema.parse(rawCommand) : CommandRequestSchema.parse(rawCommand);
  const audit = record.settingsSchemaHash === PRE_FLOOR_SCHEMA_HASH ? PreFloorCommandAuditSchema.parse(rawAudit) : CommandAuditRecordSchema.parse(rawAudit);
  if (command.family !== "settings" || command.type !== "apply-settings") throw new Error("authority-command-mismatch");
  const target = JsonObjectSchema.parse(command.target);
  const payload = JsonObjectSchema.parse(command.payload);
  const result = JsonObjectSchema.parse(audit.result);
  const appliedTarget = { family: "settings", revision: record.revision };
  if (commandRow.record_key !== command.commandId || commandRow.family !== command.family || commandRow.created_at !== command.requestedAt
    || auditRow.record_key !== audit.auditId || auditRow.command_id !== command.commandId || auditRow.created_at !== audit.completedAt) throw new Error("authority-journal-columns-divergent");
  if (current.revision !== record.revision || current.settingsFingerprint !== record.settingsFingerprint
    || current.commandId !== record.lastApplied.commandId || current.commandFingerprint !== record.lastApplied.commandFingerprint
    || command.type !== "apply-settings" || command.family !== "settings"
    || sha256Hex(`hrauto:settings-command:v1\0${canonicalJsonStringify(command)}`) !== record.lastApplied.commandFingerprint
    || target.expectedRevision !== record.lastApplied.expectedRevision
    || payload.settingsSchemaHash !== record.lastApplied.settingsSchemaHash || payload.patchFingerprint !== record.lastApplied.patchFingerprint
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || result.state !== "applied" || result.settingsRevision !== record.revision || result.settingsFingerprint !== record.settingsFingerprint
    || result.commandId !== command.commandId || result.restartRequired !== true
    || canonicalJsonStringify(result.affectedTargets) !== canonicalJsonStringify([appliedTarget])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{ target: appliedTarget, before: record.lastApplied.expectedRevision, after: record.revision }])
    || audit.affectedDependencyIds.length !== 0 || audit.auditId !== current.auditId
    || audit.completedAt !== current.committedAt) throw new Error("authority-uncertain { file: settings.json }");
}

function legacyJson(database: DatabaseSync | undefined, table: "commands" | "command_audits" | "protected_settings_current" | "settings_current", key: string): unknown {
  if (database?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) === undefined) return undefined;
  const rows = table === "command_audits"
    ? database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(key)
    : database.prepare(`SELECT * FROM ${table} WHERE record_key=?`).all(key);
  if (rows.length > 1) throw new Error("authority-journal-ambiguous");
  const row = rows[0];
  if (row === undefined) return undefined;
  const record = JsonObjectSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json));
  if (table === "commands") {
    if (row.record_key !== record.commandId || row.family !== record.family || row.created_at !== record.requestedAt) throw new Error("authority-journal-columns-divergent");
  } else if (table === "command_audits") {
    if (row.record_key !== record.auditId || row.command_id !== JsonObjectSchema.parse(record.request).commandId || row.created_at !== record.completedAt) throw new Error("authority-journal-columns-divergent");
  } else {
    if (row.record_key !== "current" || row.revision !== record.revision || row.command_id !== record.commandId
      || row.command_fingerprint !== record.commandFingerprint || row.audit_id !== record.auditId || row.created_at !== record.committedAt) throw new Error("authority-current-columns-divergent");
  }
  return record;
}
function authenticateProtected(record: ProtectedStoreRecord, database: DatabaseSync | undefined): void {
  requireJournaledProtectedSettings(record, {
    // D341: a pre-D341 journal names retired entries; read it through the frozen arm, then refuse by name below.
    commands: { get: (id) => { const row = legacyJson(database, "commands", id); return row === undefined ? undefined : z.union([CommandRequestSchema, HistoricalProtectedSettingsCommandSchema]).parse(row); } },
    commandAudits: { findByCommand: (id) => { const row = legacyJson(database, "command_audits", id); return row === undefined ? undefined : z.union([CommandAuditRecordSchema, HistoricalProtectedSettingsAuditSchema]).parse(row); } },
    protectedSettingsCurrent: { get: () => { const row = legacyJson(database, "protected_settings_current", "current"); return row === undefined ? undefined : ProtectedSettingsCurrentRecordSchema.parse(row); } },
  });
}

export interface UpgradeSources {
  readonly ordinary: MigrationSettingsRecord;
  readonly settings: z.infer<typeof EditableSettingsOverrideSchema>;
  readonly protectedRecord: ProtectedStoreRecord;
  readonly protectedPatch: ProtectedSettingsPatch;
  readonly sourceFiles: readonly string[];
  readonly importedKeys: readonly string[];
  readonly envKeysToRemove: readonly string[];
}

/** Strict source inventory and duplicate comparison precede every conversion effect. */
export function readUpgradeSources(stateRoot: string, environmentFile: string, database: DatabaseSync | undefined, clock: Clock): UpgradeSources {
  const files: string[] = [];
  const old = join(stateRoot, "settings.json");
  const oldAuthority = `${old}.authority.json`;
  const directory = join(stateRoot, "settings");
  for (const path of [directory, old, oldAuthority, `${old}.prepare.json`, `${old}.rollback.json`, `${old}.lock`, `${old}.lock.reaper`, environmentFile]) requireMigrationSourcePath(path);
  const d331 = existsSync(directory);
  if (d331) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) throw new Error("source-integrity { file: settings }");
    const names = ["settings.json", "protected.json", "authority.json", "prepare.json", "rollback.json", "settings.lock", "settings.lock.reaper"];
    for (const name of names) requireMigrationSourcePath(join(directory, name));
    const unrecognized = readdirSync(directory).filter((name) => !names.includes(name));
    if (unrecognized.length > 0) throw new Error("source-integrity: settings directory contains unrecognized migration evidence");
    if (existsSync(old) || existsSync(oldAuthority)) throw new Error("mixed-layout { files: settings,settings.json }");
  }
  let ordinary: MigrationSettingsRecord = initialSettingsFileRecord();
  let protectedRecord = initialProtectedStoreRecord();
  if (d331 || existsSync(oldAuthority)) {
    const ordinaryPath = d331 ? join(directory, "settings.json") : old;
    const pathFingerprint = sha256Hex(resolve(ordinaryPath));
    const parseOrdinary = (bytes: string | null): MigrationSettingsRecord => bytes === null ? initialSettingsFileRecord()
      : (d331 ? SettingsFileRecordSchema : PreFloorRecordSchema).parse(JSON.parse(bytes));
    const parseProtected = (bytes: string | null) => bytes === null ? initialProtectedStoreRecord() : ProtectedStoreRecordSchema.parse(JSON.parse(bytes));
    const parseAuthority = (bytes: string) => {
      if (d331) return SettingsRootAuthoritySchema.parse(JSON.parse(bytes));
      const parsed = SidecarSchema.parse(JSON.parse(bytes));
      if (parsed.settingsPathFingerprint !== pathFingerprint) throw new Error("source-path-mismatch { file: settings.json.authority.json }");
      return { ordinary: parsed.state, protected: "virgin" as const };
    };
    const selected = recoverSettingsSources({ d331, ordinaryPath, protectedPath: join(directory, "protected.json"),
      authorityPath: d331 ? join(directory, "authority.json") : oldAuthority,
      preparePath: d331 ? join(directory, "prepare.json") : `${old}.prepare.json`,
      rollbackPath: d331 ? join(directory, "rollback.json") : `${old}.rollback.json`,
      lockPath: d331 ? join(directory, "settings.lock") : `${old}.lock`, pathFingerprint,
      read: readPrivateMigrationSource, parseAuthority,
      parse: (target, bytes) => target === "ordinary" ? parseOrdinary(bytes) : parseProtected(bytes),
      authenticate: (target, bytes) => target === "ordinary" ? authenticateSource(parseOrdinary(bytes), database) : authenticateProtected(parseProtected(bytes), database),
      absentFor: (target, id) => legacyJson(database, "commands", id) === undefined && legacyJson(database, "command_audits", id) === undefined
        && JsonObjectSchema.optional().parse(legacyJson(database, target === "ordinary" ? "settings_current" : "protected_settings_current", "current"))?.commandId !== id,
    });
    const authority = parseAuthority(selected.authority);
    if ((selected.ordinary === null) !== (authority.ordinary === "virgin") || (selected.protected === null) !== (authority.protected === "virgin")) throw new Error("authority-deleted-or-uncertain");
    ordinary = parseOrdinary(selected.ordinary); protectedRecord = parseProtected(selected.protected); files.push(...selected.files);
  } else if ([old, `${old}.prepare.json`, `${old}.rollback.json`, `${old}.lock`].some(existsSync)) throw new Error("authority-unjournaled { file: settings.json }");
  authenticateSource(ordinary, database);
  authenticateProtected(protectedRecord, database);
  // D341: a retired test-target entry is refused BY NAME before any value is copied into a patch.
  for (const name of RETIRED_TEST_TARGET_PROTECTED_NAMES) {
    if (protectedRecord.entries[name] !== undefined) throw new Error(`retired-test-target { key: ${name} }; move it to config/test-data.local.json (D341), then re-run storage upgrade --plan`);
  }
  const leaves = ordinaryLeaves(ordinary.settings);
  const protectedEntries: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(protectedRecord.entries)) protectedEntries[name] = { set: entry.value };
  const envKeysToRemove: string[] = [];
  const importedKeys = [...Object.keys(leaves), ...Object.keys(protectedRecord.entries)];
  if (existsSync(environmentFile)) {
    files.push(basename(environmentFile));
    const bindings = new Map<string, string>();
    const names = strictlyValidateLocalEnvironment(readPrivateMigrationSource(environmentFile), (name, source) => bindings.set(name, source));
    const migrated = new Set<string>(MIGRATED_SETTINGS_ENVIRONMENT_KEYS);
    const retiredTestTarget = new Set<string>(RETIRED_TEST_TARGET_ENVIRONMENT_KEYS);
    const decoded = new Map<string, string>();
    for (const name of names) {
      // D341: retired canary names are refused by name before their value is decoded.
      if (retiredTestTarget.has(name)) throw new Error(`retired-test-target-env { key: ${name} }; move it to config/test-data.local.json (D341) and remove it from .env`);
      if (CLEANUP_ONLY_ENVIRONMENT_KEYS.has(name)) {
        envKeysToRemove.push(name);
        continue;
      }
      if (!isRegisteredEnvironmentKey(name)) throw new Error(`env-unknown-key { key: ${name} }`);
      if (!migrated.has(name)) continue; // Provider values remain unopened.
      envKeysToRemove.push(name);
      if (name.endsWith("_MODEL")) continue;
      const source = bindings.get(name);
      if (source === undefined) throw new Error("environment binding disappeared");
      const value = parseEnv(source)[name];
      if (value === undefined) throw new Error(`invalid-value { key: ${name} }`);
      decoded.set(name, value);
    }
    for (const row of SETTINGS_CATALOG) {
      const sources = row.currentSource.filter((source) => source.kind === "env" && decoded.has(source.name));
      if (sources.length === 0) continue;
      let key: string = row.key;
      let value: unknown;
      if (key === "activityPersonPseudonym") {
        if (sources.length !== 2) throw new Error("invalid-value { key: activityPersonPseudonym }");
        value = { keyHex: decoded.get("HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY"), keyGeneration: decoded.get("HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION") };
      } else {
        const source = sources[0];
        if (source === undefined) throw new Error("environment source disappeared");
        const raw = decoded.get(source.name);
        if (raw === undefined) throw new Error("environment value disappeared");
        if (row.sourceClass === "protected-store") value = raw;
        else if (key.endsWith(".models")) value = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
        else if (key.startsWith("annualDates.")) { key = key.replace("*", `FY${String(clock.fiscalYear())}`); value = raw; }
        else if (key.startsWith("features.")) {
          if (!['true', 'false', '1', '0'].includes(raw)) throw new Error(`invalid-value { key: ${key} }`);
          value = raw === "true" || raw === "1";
        } else if (key.startsWith("urls.")) {
          value = { [key.startsWith("urls.ucpath.") ? "smartHr" : "entry"]: raw };
        } else { if (!/^\d+$/u.test(raw)) throw new Error(`invalid-value { key: ${key} }`); value = Number(raw); }
      }
      try {
        if (row.sourceClass === "protected-store") ProtectedSettingsPatchSchema.parse({ [key]: { set: value } });
        else SettingsPatchSchema.parse({ [key]: { set: value } });
      } catch (cause) { throw new Error(`invalid-value { key: ${key} }`, { cause }); }
      const prior = row.sourceClass === "protected-store" ? protectedEntries[key] : leaves[key];
      if (key.startsWith("urls.") && prior !== undefined) {
        const priorRoutes = JsonObjectSchema.parse(prior); const nextRoutes = JsonObjectSchema.parse(value);
        for (const [route, nextRoute] of Object.entries(nextRoutes)) {
          if (priorRoutes[route] !== undefined && canonicalJsonStringify(priorRoutes[route]) !== canonicalJsonStringify(nextRoute)) throw new Error(`ambiguous-duplicate { key: ${key}.${route} }`);
        }
        value = { ...priorRoutes, ...nextRoutes };
      }
      const next = row.sourceClass === "protected-store" ? { set: value } : value;
      if (prior !== undefined && !key.startsWith("urls.") && !(row.sourceClass === "protected-store" ? equalProtectedSources(prior, next) : canonicalJsonStringify(prior) === canonicalJsonStringify(next))) throw new Error(`ambiguous-duplicate { key: ${key} }; make them equal or remove one, then re-run storage upgrade --plan`);
      if (row.sourceClass === "protected-store") protectedEntries[key] = next;
      else leaves[key] = next;
      importedKeys.push(key);
    }
  }
  const patch = Object.fromEntries(Object.entries(leaves).map(([key, value]) => [key, { set: value }]));
  const settings = Object.keys(patch).length === 0 ? EditableSettingsOverrideSchema.parse({}) : mergeSettingsPatch({}, SettingsPatchSchema.parse(patch));
  resolveConfigWithProvenance(settings, { primaryDisplay: null }, clock);
  const protectedPatch = Object.keys(protectedEntries).length === 0 ? {} : ProtectedSettingsPatchSchema.parse(protectedEntries);
  return { ordinary, settings, protectedRecord, protectedPatch, sourceFiles: files.map((path) => basename(path)), importedKeys: [...new Set(importedKeys)].sort(), envKeysToRemove: envKeysToRemove.sort() };
}
