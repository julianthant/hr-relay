import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import {
  deriveSettingsCommandFingerprint,
  CommandAuditRecordSchema,
  MarkedProtectedSettingsCommandRequestSchema,
  SettingsCommandRequestSchema,
} from "../../domain/commands.js";
import {
  deriveJournaledSettingsCommandFingerprint,
  HistoricalProtectedSettingsAuditSchema,
  HistoricalProtectedSettingsCommandSchema,
  journaledSettingsCommand,
} from "../../domain/commands-history.js";
import {
  ProtectedSettingsNameSchema,
} from "../../domain/config/protected-settings.js";
import { LegacyProtectedSettingsNameSchema } from "../../domain/config/protected-settings-legacy.js";
import {
  SettingsFileRecordSchema,
  type SettingsFileRecord,
} from "../../domain/config/settings.js";
import { SettingsCurrentRecordSchema } from "../compat/d331-settings-current.js";
import { D350HistoricalSettingsFileRecordSchema, D350HistoricalSettingsRootAuthoritySchema } from "../compat/d350-settings-v2-backup.js";
import { ProtectedSettingsCurrentRecordSchema } from "../../domain/authority.js";
import { inspectAuthorityBackupReadOnly } from "../compat/backup-inspection.js";
import { AuthorityDatabase } from "./authority-database.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../runtime-control/admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";
import {
  AuthorityBackupManifestSchema,
  AuthorityBackupManifestV3Schema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  type AuthorityBackupManifest,
  type AuthorityBackupManifestV3,
  type AuthorityBackupRunReport,
  type ProtectedSettingsBackupPresence,
} from "./recovery-contracts.js";

export const AuthorityBackupServiceOptionsSchema = z.strictObject({
  directory: z.string().min(1),
});

type AuthorityBackupSource = Pick<
  AuthorityDatabase,
  "getMeta" | "getSourceDatabaseIdentity" | "onlineBackupTo"
>;

function inspectBackupCopy(
  admission: RuntimeAdmission,
  backupPath: string,
  expectedSchemaVersion?: number,
): ReturnType<typeof inspectAuthorityBackupReadOnly> {
  const inspection = inspectAuthorityBackupReadOnly(admission,backupPath, expectedSchemaVersion);
  if (inspection.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) {
    const current = AuthorityDatabase.inspectExistingReadOnly(admission, backupPath);
    for (const field of [
      "applicationId",
      "schemaVersion",
      "pageCount",
      "authorityGeneration",
      "authorityContentFingerprint",
    ] as const) {
      if (inspection[field] !== current[field]) {
        throw new Error(`current backup ${field} disagrees with the compatibility inspection`);
      }
    }
  }
  return inspection;
}

/**
 * A read-only SQLite connection to a WAL-mode copy creates `-shm` (and `-wal`)
 * companions and cannot delete them when it closes. Nothing else ever opens a
 * backup copy, so after each inspection those companions are removed; an EMPTY
 * WAL is the only admissible state — bytes in it would mean the copy is not
 * self-contained, which is a refusal, not a cleanup. A v3 backup set contains
 * only the database and manifest. Strict historical v1/v2 sets remain readable.
 */
function removeReadOnlyInspectionCompanions(backupPath: string): void {
  const walPath = `${backupPath}-wal`;
  if (existsSync(walPath)) {
    const size = statSync(walPath).size;
    if (size !== 0) {
      throw new Error(
        `backup copy ${basename(backupPath)} has a ${String(size)}-byte WAL after read-only inspection; `
        + "the copy is not self-contained",
      );
    }
    rmSync(walPath);
  }
  const shmPath = `${backupPath}-shm`;
  if (existsSync(shmPath)) rmSync(shmPath);
}

export type VerifiedBackup = Readonly<{
  manifestPath: string;
  backupPath: string;
  manifest: AuthorityBackupManifest;
}>;

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  fsyncPath(path);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const JsonRecordRowSchema = z.strictObject({ record_json: z.string() });

function readHistoricalRecord<Schema extends z.ZodType>(
  database: DatabaseSync,
  table: "commands" | "settings_current" | "protected_settings_current",
  recordKey: string,
  schema: Schema,
): z.infer<Schema> | undefined {
  const row = database.prepare(
    `SELECT record_json FROM ${table} WHERE record_key = ?`,
  ).get(recordKey);
  if (row === undefined) return undefined;
  return schema.parse(JSON.parse(JsonRecordRowSchema.parse(row).record_json));
}

function readHistoricalCommandAudit(database: DatabaseSync, commandId: string) {
  const rows = z.array(JsonRecordRowSchema).parse(database.prepare(`
    SELECT record_json FROM command_audits WHERE command_id = ? ORDER BY record_key
  `).all(commandId));
  if (rows.length > 1) {
    throw new Error(`historical backup has multiple audits for command ${commandId}`);
  }
  const row = rows[0];
  return row === undefined
    ? undefined
    // D341: a pre-D341 protected audit names retired entries in its marked request and readback.
    : z.union([CommandAuditRecordSchema, HistoricalProtectedSettingsAuditSchema]).parse(JSON.parse(row.record_json));
}

function authenticateHistoricalOrdinarySettings(
  record: SettingsFileRecord | z.infer<typeof D350HistoricalSettingsFileRecordSchema>,
  database: DatabaseSync,
): void {
  const current = readHistoricalRecord(
    database,
    "settings_current",
    "current",
    SettingsCurrentRecordSchema,
  );
  if (record.revision === 1) {
    if (current !== undefined) {
      throw new Error(`authority-uncertain: baseline settings.json is behind canonical revision ${String(current.revision)}`);
    }
    return;
  }
  const applied = record.lastApplied;
  if (applied === undefined) {
    throw new Error(`authority-uncertain: settings.json revision ${String(record.revision)} has no last command`);
  }
  const command = readHistoricalRecord(
    database,
    "commands",
    applied.commandId,
    SettingsCommandRequestSchema,
  );
  if (command === undefined) {
    throw new Error(`authority-unjournaled: settings revision ${String(record.revision)} has no durable command journal for settings.json`);
  }
  if (command.family !== "settings" || command.type !== "apply-settings"
    || deriveSettingsCommandFingerprint(command) !== applied.commandFingerprint
    || command.target.expectedRevision !== applied.expectedRevision
    || command.payload.settingsSchemaHash !== applied.settingsSchemaHash
    || command.payload.patchFingerprint !== applied.patchFingerprint) {
    throw new Error(`authority-uncertain: settings.json revision ${String(record.revision)} does not match its command identity`);
  }
  const audit = readHistoricalCommandAudit(database, applied.commandId);
  const target = { family: "settings" as const, revision: record.revision };
  if (audit === undefined
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || audit.result.state !== "applied"
    || audit.result.commandId !== applied.commandId
    || audit.result.restartRequired !== true
    || audit.result.settingsRevision !== record.revision
    || audit.result.settingsFingerprint !== record.settingsFingerprint
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{
      target,
      before: applied.expectedRevision,
      after: record.revision,
    }])
    || audit.affectedDependencyIds.length !== 0
    || current === undefined
    || current.revision !== record.revision
    || current.settingsFingerprint !== record.settingsFingerprint
    || current.commandId !== applied.commandId
    || current.commandFingerprint !== applied.commandFingerprint
    || current.auditId !== audit.auditId
    || current.committedAt !== audit.completedAt) {
    throw new Error(`authority-uncertain: settings.json revision ${String(record.revision)} is not its authenticated current journal result`);
  }
}

function authenticateHistoricalProtectedPresence(
  presence: ProtectedSettingsBackupPresence,
  database: DatabaseSync,
): void {
  const current = readHistoricalRecord(
    database,
    "protected_settings_current",
    "current",
    ProtectedSettingsCurrentRecordSchema,
  );
  if (presence.revision === 1) {
    if (presence.entries.length !== 0 || current !== undefined) {
      throw new Error("authority-uncertain: baseline protected settings backup does not match copied authority");
    }
    return;
  }
  const sortedCurrentEntries = current?.entries.toSorted((left, right) => left.name.localeCompare(right.name));
  if (current === undefined
    || current.revision !== presence.revision
    || canonicalJsonStringify(sortedCurrentEntries) !== canonicalJsonStringify(presence.entries)) {
    throw new Error(`authority-uncertain: protected settings backup revision ${String(presence.revision)} does not match its copied singleton`);
  }
  const command = readHistoricalRecord(
    database,
    "commands",
    current.commandId,
    z.union([MarkedProtectedSettingsCommandRequestSchema, HistoricalProtectedSettingsCommandSchema]),
  );
  const audit = readHistoricalCommandAudit(database, current.commandId);
  const target = { family: "protected-settings" as const, revision: presence.revision };
  // D341: a pre-D341 command's readback was recorded over the seven-name family; compare in that family.
  const historical = command !== undefined && HistoricalProtectedSettingsCommandSchema.safeParse(command).success;
  const readbackNames: readonly string[] = historical ? LegacyProtectedSettingsNameSchema.options : ProtectedSettingsNameSchema.options;
  const entries = Object.fromEntries(readbackNames.map((name) => {
    const entry = presence.entries.find((candidate) => candidate.name === name);
    return [name, entry === undefined
      ? { present: false }
      : { present: true, valueId: entry.valueId, updatedAt: entry.updatedAt }];
  }));
  if (command === undefined
    || command.family !== "settings"
    || command.type !== "apply-protected-settings"
    || command.target.expectedRevision !== presence.revision - 1
    || deriveJournaledSettingsCommandFingerprint(command) !== current.commandFingerprint
    || audit === undefined
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(journaledSettingsCommand(command))
    || audit.result.state !== "applied"
    || audit.result.commandId !== current.commandId
    || audit.result.restartRequired !== false
    || audit.result.revision !== presence.revision
    || canonicalJsonStringify(audit.result.entries) !== canonicalJsonStringify(entries)
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{
      target,
      before: presence.revision - 1,
      after: presence.revision,
    }])
    || audit.affectedDependencyIds.length !== 0
    || current.auditId !== audit.auditId
    || current.committedAt !== audit.completedAt) {
    throw new Error(`authority-uncertain: protected settings backup revision ${String(presence.revision)} is not authenticated by its copied journal`);
  }
}

function authenticateHistoricalV2Bindings(
  backupPath: string,
  ordinary: SettingsFileRecord | z.infer<typeof D350HistoricalSettingsFileRecordSchema>,
  protectedSettings: ProtectedSettingsBackupPresence,
): void {
  const database = new DatabaseSync(backupPath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: 250,
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  try {
    database.exec("PRAGMA query_only = ON");
    database.exec("BEGIN");
    try {
      authenticateHistoricalOrdinarySettings(ordinary, database);
      authenticateHistoricalProtectedPresence(protectedSettings, database);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
    removeReadOnlyInspectionCompanions(backupPath);
  }
}

export async function verifyBackupBytesAtPath(
  pathInput: string,
  manifest: Readonly<{ backupFileName: string; byteSize: number; sha256: string }>,
  description = `backup file ${manifest.backupFileName}`,
): Promise<void> {
  const path = resolve(pathInput);
  if (!existsSync(path)) throw new Error(`${description} does not exist`);
  const stats = statSync(path);
  if (!stats.isFile() || stats.size !== manifest.byteSize) {
    throw new Error(`${description} byte size does not match verified manifest`);
  }
  const digest = await sha256File(path);
  if (digest !== manifest.sha256) {
    throw new Error(`${description} checksum does not match verified manifest`);
  }
}

export function parseBackupManifestFile(manifestPath: string): AuthorityBackupManifest {
  const text = readFileSync(manifestPath, "utf8");
  return AuthorityBackupManifestSchema.parse(JSON.parse(text));
}

export async function verifyBackupManifestAtPath(
  admissionInput: RuntimeAdmission,
  manifestPathInput: string,
  expectedSourceDatabaseIdentity?: string,
): Promise<VerifiedBackup> {
  const admission = requireRuntimeAdmission(admissionInput);
  const manifestPath = resolve(z.string().min(1).parse(manifestPathInput));
  if (!existsSync(manifestPath)) throw new Error(`backup manifest ${manifestPath} does not exist`);
  const manifest = parseBackupManifestFile(manifestPath);
  if (expectedSourceDatabaseIdentity !== undefined
    && manifest.sourceDatabaseIdentity !== expectedSourceDatabaseIdentity) {
    throw new Error(`backup manifest ${basename(manifestPath)} belongs to a different authority database`);
  }
  const identities = manifest.manifestVersion === 2 ? manifest.files : [manifest];
  for (const identity of identities) {
    const path = join(dirname(manifestPath), identity.backupFileName);
    if (basename(path) !== identity.backupFileName || !existsSync(path)) {
      throw new Error(`backup file ${identity.backupFileName} named by ${basename(manifestPath)} does not exist`);
    }
    await verifyBackupBytesAtPath(path, identity, `backup file ${identity.backupFileName}`);
  }
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  const copyAdmission = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256, "authority");
  let inspection: ReturnType<typeof inspectBackupCopy>;
  try { inspection = inspectBackupCopy(copyAdmission, backupPath, manifest.schemaVersion); }
  finally { copyAdmission.release(); }
  removeReadOnlyInspectionCompanions(backupPath);
  for (const field of ["applicationId", "schemaVersion", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (inspection[field] !== manifest[field]) {
      throw new Error(`backup file ${manifest.backupFileName} ${field} does not match its manifest`);
    }
  }
  if (manifest.manifestVersion === 2) {
    const ordinary = manifest.files[1];
    const authority = manifest.files[2];
    const ordinaryBytes: unknown = JSON.parse(readFileSync(
      join(dirname(manifestPath), ordinary.backupFileName),
      "utf8",
    ));
    const currentOrdinaryRecord = SettingsFileRecordSchema.safeParse(ordinaryBytes);
    const ordinaryRecord = currentOrdinaryRecord.success
      ? currentOrdinaryRecord.data
      : D350HistoricalSettingsFileRecordSchema.parse(ordinaryBytes);
    const settingsAuthority = D350HistoricalSettingsRootAuthoritySchema.parse(JSON.parse(readFileSync(
      join(dirname(manifestPath), authority.backupFileName),
      "utf8",
    )));
    if (settingsAuthority.settingsSchemaHash !== ordinaryRecord.settingsSchemaHash) {
      throw new Error("backup authority.json does not bind the ordinary settings schema");
    }
    if (settingsAuthority.ordinary !== "initialized" || settingsAuthority.protected !== "initialized") {
      throw new Error("backup authority.json does not bind initialized settings documents");
    }
    authenticateHistoricalV2Bindings(backupPath, ordinaryRecord, manifest.protectedSettings);
  }
  return Object.freeze({ manifestPath, backupPath, manifest });
}

export class AuthorityBackupService {
  #admission: RuntimeAdmission;
  #source: AuthorityBackupSource;
  #directory: string;
  #clock: Clock;
  #inFlight: Promise<AuthorityBackupRunReport> | undefined;
  #requiredGeneration = 0;
  #coalescedRequests = 0;

  constructor(admissionInput: RuntimeAdmission, source: AuthorityBackupSource, input: unknown, clock: Clock = systemClock) {
    this.#admission = requireRuntimeAdmission(admissionInput);
    const options = AuthorityBackupServiceOptionsSchema.parse(input);
    this.#source = source;
    this.#directory = resolve(options.directory);
    this.#admission.assertStateRoot(this.#directory);
    this.#clock = clock;
  }

  request(input: unknown): Promise<AuthorityBackupRunReport> {
    this.#admission.assertWritable();
    const request = AuthorityBackupRequestSchema.parse(input);
    this.#requiredGeneration = Math.max(this.#requiredGeneration, request.requiredGeneration);
    this.#coalescedRequests += 1;
    if (this.#inFlight !== undefined) return this.#inFlight;
    const tracked = this.#runBatch().then(
      (report) => {
        this.#clearFlight();
        return report;
      },
      (error: unknown) => {
        this.#clearFlight();
        throw error;
      },
    );
    this.#inFlight = tracked;
    return tracked;
  }

  #clearFlight(): void {
    this.#inFlight = undefined;
    this.#requiredGeneration = 0;
    this.#coalescedRequests = 0;
  }

  async #runBatch(): Promise<AuthorityBackupRunReport> {
    const manifests: AuthorityBackupManifest[] = [];
    manifests.push(await this.#createOne());
    const requiredAfterFirst = Math.max(
      this.#requiredGeneration,
      this.#source.getMeta().authorityGeneration,
    );
    if (manifests[0].authorityGeneration < requiredAfterFirst) {
      manifests.push(await this.#createOne());
    }
    const requiredAtCompletion = Math.max(
      this.#requiredGeneration,
      this.#source.getMeta().authorityGeneration,
    );
    const finalGeneration = manifests.at(-1)?.authorityGeneration;
    if (finalGeneration === undefined || finalGeneration < requiredAtCompletion) {
      throw new Error(
        `verified follow-up backup generation ${String(finalGeneration)} is behind required authority generation ${String(requiredAtCompletion)}`,
      );
    }
    return AuthorityBackupRunReportSchema.parse({
      state: "verified",
      requestedGeneration: requiredAtCompletion,
      finalGeneration,
      coalescedRequests: this.#coalescedRequests,
      followUpPerformed: manifests.length === 2,
      manifests,
    });
  }

  async #createOne(): Promise<AuthorityBackupManifest> {
    this.#admission.assertWritable();
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const temporaryBackupPath = join(this.#directory, `.authority-${token}.sqlite.tmp`);
    const temporaryManifestPath = join(this.#directory, `.authority-${token}.manifest.json.tmp`);
    const temporaryPaths = [temporaryBackupPath, temporaryManifestPath];
    const finalPaths: string[] = [];
    let finalManifestPath: string | undefined;
    try {
      await this.#source.onlineBackupTo(temporaryBackupPath);
      this.#admission.assertWritable();
      const copyAdmission = this.#admission.verifiedReadOnlyCopy(temporaryBackupPath, await sha256File(temporaryBackupPath), "authority");
      let inspection: ReturnType<typeof inspectBackupCopy>;
      try { inspection = inspectBackupCopy(copyAdmission, temporaryBackupPath); }
      finally { copyAdmission.release(); }
      removeReadOnlyInspectionCompanions(temporaryBackupPath);
      chmodSync(temporaryBackupPath, 0o600);
      fsyncPath(temporaryBackupPath);
      const createdAt = this.#clock.now().toISOString();
      const compactTime = createdAt.replaceAll(/[^0-9]/g, "");
      const stem = `authority-g${String(inspection.authorityGeneration)}-${compactTime}-${token}`;
      const backupFileName = `${stem}.sqlite`;
      const finalBackupPath = join(this.#directory, backupFileName);
      renameSync(temporaryBackupPath, finalBackupPath);
      finalPaths.push(finalBackupPath);
      const stats = statSync(finalBackupPath);
      const digest = await sha256File(finalBackupPath);
      this.#admission.assertWritable();
      fsyncDirectory(this.#directory);
      const verification = {
        state: "verified",
        observedFrom: "backup-copy",
        observedAt: this.#clock.now().toISOString(),
        applicationId: inspection.applicationId,
        schemaVersion: inspection.schemaVersion,
        pageCount: inspection.pageCount,
        authorityGeneration: inspection.authorityGeneration,
        authorityContentFingerprint: inspection.authorityContentFingerprint,
        quickCheck: inspection.quickCheck,
        foreignKeyViolations: inspection.foreignKeyViolations,
        invariantViolations: inspection.invariantViolations,
        exactTableRegistry: inspection.exactTableRegistry,
      };
      const manifest: AuthorityBackupManifestV3 = AuthorityBackupManifestV3Schema.parse({
        kind: "hrauto-authority-backup",
        manifestVersion: 3,
        backupFileName,
        sourceDatabaseIdentity: this.#source.getSourceDatabaseIdentity(),
        applicationId: inspection.applicationId,
        schemaVersion: inspection.schemaVersion,
        pageCount: inspection.pageCount,
        authorityGeneration: inspection.authorityGeneration,
        authorityContentFingerprint: inspection.authorityContentFingerprint,
        createdAt,
        byteSize: stats.size,
        sha256: digest,
        verification,
      });
      const manifestFileName = `${backupFileName}.manifest.json`;
      finalManifestPath = join(this.#directory, manifestFileName);
      writeFileSync(temporaryManifestPath, `${canonicalJsonStringify(manifest)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fsyncPath(temporaryManifestPath);
      renameSync(temporaryManifestPath, finalManifestPath);
      finalPaths.push(finalManifestPath);
      fsyncDirectory(this.#directory);
      await verifyBackupManifestAtPath(this.#admission, finalManifestPath, this.#source.getSourceDatabaseIdentity());
      return manifest;
    } catch (error) {
      if (finalManifestPath !== undefined && existsSync(finalManifestPath)) rmSync(finalManifestPath);
      for (const finalPath of finalPaths) {
        for (const path of [finalPath, `${finalPath}-wal`, `${finalPath}-shm`]) {
          if (existsSync(path)) rmSync(path);
        }
      }
      throw error;
    } finally {
      for (const temporaryPath of temporaryPaths) {
        for (const path of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`]) {
          if (existsSync(path)) rmSync(path);
        }
      }
    }
  }
}
