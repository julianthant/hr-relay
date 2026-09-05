import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
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
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import {
  deriveSettingsCommandFingerprint,
  markSettingsCommand,
} from "../../domain/commands.js";
import {
  ProtectedSettingsNameSchema,
  protectedSettingsReadback,
  type ProtectedStoreRecord,
} from "../../domain/config/protected-settings.js";
import {
  SettingsFileRecordSchema,
  type SettingsFileRecord,
} from "../../domain/config/settings.js";
import { SettingsRootAuthoritySchema } from "../../domain/config/settings-root.js";
import {
  createSettingsFileAuthority,
  type SettingsRootBackupSnapshot,
} from "../config/settings-file.js";
import { AuthorityDatabase } from "./authority-database.js";
import {
  AuthorityBackupManifestSchema,
  AuthorityBackupManifestV2Schema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  ProtectedSettingsBackupPresenceSchema,
  type AuthorityBackupManifest,
  type AuthorityBackupManifestV2,
  type AuthorityBackupRunReport,
} from "./recovery-contracts.js";

export const AuthorityBackupServiceOptionsSchema = z.strictObject({
  directory: z.string().min(1),
  /** Explicit test/embedding seam; production derives `<stateRoot>/settings` from the backup root. */
  settingsRoot: z.string().min(1).optional(),
});

type AuthorityBackupSource = Pick<
  AuthorityDatabase,
  "getMeta" | "getSourceDatabaseIdentity" | "onlineBackupTo"
>;

/**
 * A read-only SQLite connection to a WAL-mode copy creates `-shm` (and `-wal`)
 * companions and cannot delete them when it closes. Nothing else ever opens a
 * backup copy, so after each inspection those companions are removed; an EMPTY
 * WAL is the only admissible state — bytes in it would mean the copy is not
 * self-contained, which is a refusal, not a cleanup. A current v2 backup set
 * contains the database, ordinary settings, settings-root authority, and its
 * manifest; strict legacy v1 database/manifest pairs remain readable.
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

function inferredSettingsRoot(backupDirectory: string): string {
  const parent = dirname(backupDirectory);
  return basename(backupDirectory) === "authority" && basename(parent) === "backups"
    ? join(dirname(parent), "settings")
    : join(parent, "settings");
}

function assertPrivateSettingsRoot(settingsRoot: string): void {
  let stats;
  try {
    stats = lstatSync(settingsRoot);
  } catch (error) {
    throw new Error("settings root is unavailable for verified backup", { cause: error });
  }
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== expectedUid
    || (stats.mode & 0o777) !== 0o700) {
    throw new Error("settings root is not a private directory owned by the runtime user");
  }
}

type SettingsBackupCapture = Readonly<{
  ordinaryBytes: Uint8Array;
  authorityBytes: Uint8Array;
  protectedSettings: z.infer<typeof ProtectedSettingsBackupPresenceSchema>;
}>;

function captureSettingsBackup(snapshot: SettingsRootBackupSnapshot): SettingsBackupCapture {
  const authority = SettingsRootAuthoritySchema.parse(JSON.parse(new TextDecoder().decode(snapshot.authorityBytes)));
  if (authority.ordinary !== "initialized" || authority.protected !== "initialized") {
    throw new Error("authority.json does not bind initialized settings.json and protected.json documents");
  }
  const protectedSettings = ProtectedSettingsBackupPresenceSchema.parse({
    revision: snapshot.protected.revision,
    entries: ProtectedSettingsNameSchema.options.flatMap((name) => {
      const entry = snapshot.protected.entries[name];
      return entry === undefined ? [] : [{ name, valueId: entry.valueId, updatedAt: entry.updatedAt }];
    }).toSorted((left, right) => left.name.localeCompare(right.name)),
  });
  return Object.freeze({
    ordinaryBytes: snapshot.ordinaryBytes,
    authorityBytes: snapshot.authorityBytes,
    protectedSettings,
  });
}

function authenticateOrdinarySettingsBackup(
  record: SettingsFileRecord,
  database: AuthorityDatabase,
): void {
  const repositories = database.authority;
  const current = repositories.settingsCurrent.get();
  if (record.revision === 1) {
    if (current !== undefined) {
      throw new Error(`authority-uncertain: baseline settings.json is behind canonical revision ${String(current.revision)}`);
    }
    return;
  }
  const applied = record.lastApplied;
  if (applied === undefined) throw new Error(`authority-uncertain: settings.json revision ${String(record.revision)} has no last command`);
  const command = repositories.commands.get(applied.commandId);
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
  const audit = repositories.commandAudits.findByCommand(applied.commandId);
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

function protectedCurrentEntries(record: ProtectedStoreRecord) {
  return ProtectedSettingsNameSchema.options.flatMap((name) => {
    const entry = record.entries[name];
    return entry === undefined ? [] : [{ name, valueId: entry.valueId, updatedAt: entry.updatedAt }];
  });
}

function authenticateProtectedSettingsBackup(
  record: ProtectedStoreRecord,
  database: AuthorityDatabase,
): void {
  const repositories = database.authority;
  const current = repositories.protectedSettingsCurrent.get();
  if (record.revision === 1) {
    if (current !== undefined) {
      throw new Error(`authority-uncertain: baseline protected.json is behind canonical revision ${String(current.revision)}`);
    }
    return;
  }
  const applied = record.lastApplied;
  if (applied === undefined) throw new Error(`authority-uncertain: protected.json revision ${String(record.revision)} has no last command`);
  const command = repositories.commands.get(applied.commandId);
  if (command === undefined) {
    throw new Error(`authority-unjournaled: protected settings revision ${String(record.revision)} has no durable command journal for protected.json`);
  }
  if (command.family !== "settings" || command.type !== "apply-protected-settings"
    || deriveSettingsCommandFingerprint(command) !== applied.commandFingerprint
    || command.target.expectedRevision !== applied.expectedRevision
    || command.payload.protectedSchemaHash !== applied.protectedSchemaHash
    || command.payload.writeId !== applied.writeId) {
    throw new Error(`authority-uncertain: protected.json revision ${String(record.revision)} does not match its marked command identity`);
  }
  const audit = repositories.commandAudits.findByCommand(applied.commandId);
  const target = { family: "protected-settings" as const, revision: record.revision };
  const readback = protectedSettingsReadback(record);
  if (audit === undefined
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(markSettingsCommand(command))
    || audit.result.state !== "applied"
    || audit.result.commandId !== applied.commandId
    || audit.result.restartRequired !== false
    || audit.result.revision !== record.revision
    || canonicalJsonStringify(audit.result.entries) !== canonicalJsonStringify(readback.entries)
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{
      target,
      before: applied.expectedRevision,
      after: record.revision,
    }])
    || audit.affectedDependencyIds.length !== 0
    || current === undefined
    || current.revision !== record.revision
    || current.commandId !== applied.commandId
    || current.commandFingerprint !== applied.commandFingerprint
    || current.auditId !== audit.auditId
    || current.committedAt !== audit.completedAt
    || canonicalJsonStringify(current.entries) !== canonicalJsonStringify(protectedCurrentEntries(record))) {
    throw new Error(`authority-uncertain: protected.json revision ${String(record.revision)} is not its authenticated current journal result`);
  }
}

function authenticateSettingsBackup(
  snapshot: SettingsRootBackupSnapshot,
  backupPath: string,
): void {
  const database = AuthorityDatabase.open({
    path: backupPath,
    busyTimeoutMs: 250,
    migrationOwner: "settings-backup-verifier",
    openMode: "storage-backup-read-only-no-migrate",
  });
  try {
    authenticateOrdinarySettingsBackup(snapshot.ordinary, database);
    authenticateProtectedSettingsBackup(snapshot.protected, database);
  } finally {
    database.close();
    removeReadOnlyInspectionCompanions(backupPath);
  }
}

function authenticateProtectedSettingsPresenceBackup(
  presence: z.infer<typeof ProtectedSettingsBackupPresenceSchema>,
  database: AuthorityDatabase,
): void {
  const repositories = database.authority;
  const current = repositories.protectedSettingsCurrent.get();
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
  const command = repositories.commands.get(current.commandId);
  const audit = repositories.commandAudits.findByCommand(current.commandId);
  const target = { family: "protected-settings" as const, revision: presence.revision };
  const entries = Object.fromEntries(ProtectedSettingsNameSchema.options.map((name) => {
    const entry = presence.entries.find((candidate) => candidate.name === name);
    return [name, entry === undefined
      ? { present: false }
      : { present: true, valueId: entry.valueId, updatedAt: entry.updatedAt }];
  }));
  if (command === undefined
    || command.family !== "settings"
    || command.type !== "apply-protected-settings"
    || command.target.expectedRevision !== presence.revision - 1
    || deriveSettingsCommandFingerprint(command) !== current.commandFingerprint
    || audit === undefined
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(markSettingsCommand(command))
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

function authenticateManifestSettingsBackup(
  ordinary: SettingsFileRecord,
  protectedSettings: z.infer<typeof ProtectedSettingsBackupPresenceSchema>,
  backupPath: string,
): void {
  const database = AuthorityDatabase.open({
    path: backupPath,
    busyTimeoutMs: 250,
    migrationOwner: "settings-backup-verifier",
    openMode: "storage-backup-read-only-no-migrate",
  });
  try {
    authenticateOrdinarySettingsBackup(ordinary, database);
    authenticateProtectedSettingsPresenceBackup(protectedSettings, database);
  } finally {
    database.close();
    removeReadOnlyInspectionCompanions(backupPath);
  }
}

async function persistBackupArtifact(
  temporaryPath: string,
  finalPath: string,
  bytes: Uint8Array,
): Promise<Readonly<{ backupFileName: string; byteSize: number; sha256: string }>> {
  try {
    writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, finalPath);
    const stats = statSync(finalPath);
    return Object.freeze({
      backupFileName: basename(finalPath),
      byteSize: stats.size,
      sha256: await sha256File(finalPath),
    });
  } catch (error) {
    if (existsSync(finalPath)) rmSync(finalPath);
    throw error;
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
  manifestPathInput: string,
  expectedSourceDatabaseIdentity?: string,
): Promise<VerifiedBackup> {
  const manifestPath = resolve(z.string().min(1).parse(manifestPathInput));
  if (!existsSync(manifestPath)) throw new Error(`backup manifest ${manifestPath} does not exist`);
  const manifest = parseBackupManifestFile(manifestPath);
  if (expectedSourceDatabaseIdentity !== undefined
    && manifest.sourceDatabaseIdentity !== expectedSourceDatabaseIdentity) {
    throw new Error(`backup manifest ${basename(manifestPath)} belongs to a different authority database`);
  }
  const identities = manifest.manifestVersion === 1
    ? [manifest]
    : manifest.files;
  for (const identity of identities) {
    const path = join(dirname(manifestPath), identity.backupFileName);
    if (basename(path) !== identity.backupFileName || !existsSync(path)) {
      throw new Error(`backup file ${identity.backupFileName} named by ${basename(manifestPath)} does not exist`);
    }
    await verifyBackupBytesAtPath(path, identity, `backup file ${identity.backupFileName}`);
  }
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  const inspection = AuthorityDatabase.inspectExistingReadOnly(backupPath);
  removeReadOnlyInspectionCompanions(backupPath);
  for (const field of ["applicationId", "schemaVersion", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (inspection[field] !== manifest[field]) {
      throw new Error(`backup file ${manifest.backupFileName} ${field} does not match its manifest`);
    }
  }
  if (manifest.manifestVersion === 2) {
    const ordinary = manifest.files[1];
    const authority = manifest.files[2];
    const ordinaryRecord = SettingsFileRecordSchema.parse(JSON.parse(readFileSync(
      join(dirname(manifestPath), ordinary.backupFileName),
      "utf8",
    )));
    const settingsAuthority = SettingsRootAuthoritySchema.parse(JSON.parse(readFileSync(
      join(dirname(manifestPath), authority.backupFileName),
      "utf8",
    )));
    if (settingsAuthority.ordinary !== "initialized" || settingsAuthority.protected !== "initialized") {
      throw new Error("backup authority.json does not bind initialized settings documents");
    }
    authenticateManifestSettingsBackup(ordinaryRecord, manifest.protectedSettings, backupPath);
  }
  return Object.freeze({ manifestPath, backupPath, manifest });
}

export class AuthorityBackupService {
  #source: AuthorityBackupSource;
  #directory: string;
  #settingsRoot: string;
  #clock: Clock;
  #inFlight: Promise<AuthorityBackupRunReport> | undefined;
  #requiredGeneration = 0;
  #coalescedRequests = 0;

  constructor(source: AuthorityBackupSource, input: unknown, clock: Clock = systemClock) {
    const options = AuthorityBackupServiceOptionsSchema.parse(input);
    this.#source = source;
    this.#directory = resolve(options.directory);
    this.#settingsRoot = resolve(options.settingsRoot ?? inferredSettingsRoot(this.#directory));
    this.#clock = clock;
  }

  request(input: unknown): Promise<AuthorityBackupRunReport> {
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
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const temporaryBackupPath = join(this.#directory, `.authority-${token}.sqlite.tmp`);
    const temporarySettingsPath = join(this.#directory, `.settings-${token}.json.tmp`);
    const temporaryAuthorityPath = join(this.#directory, `.settings-authority-${token}.json.tmp`);
    const temporaryManifestPath = join(this.#directory, `.authority-${token}.manifest.json.tmp`);
    const temporaryPaths = [
      temporaryBackupPath,
      temporarySettingsPath,
      temporaryAuthorityPath,
      temporaryManifestPath,
    ];
    const finalPaths: string[] = [];
    let finalManifestPath: string | undefined;
    try {
      assertPrivateSettingsRoot(this.#settingsRoot);
      const settingsAuthority = createSettingsFileAuthority({
        path: join(this.#settingsRoot, "settings.json"),
        validateCandidate: () => undefined,
      });
      const captured = await settingsAuthority.withRootBackupSnapshot(async (snapshot) => {
        await this.#source.onlineBackupTo(temporaryBackupPath);
        const inspection = AuthorityDatabase.inspectExistingReadOnly(temporaryBackupPath);
        removeReadOnlyInspectionCompanions(temporaryBackupPath);
        authenticateSettingsBackup(snapshot, temporaryBackupPath);
        return Object.freeze({ inspection, settings: captureSettingsBackup(snapshot) });
      });
      const { inspection, settings } = captured;
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
      const ordinaryIdentity = await persistBackupArtifact(
        temporarySettingsPath,
        join(this.#directory, `${stem}.settings.json`),
        settings.ordinaryBytes,
      );
      finalPaths.push(join(this.#directory, ordinaryIdentity.backupFileName));
      const authorityIdentity = await persistBackupArtifact(
        temporaryAuthorityPath,
        join(this.#directory, `${stem}.settings-authority.json`),
        settings.authorityBytes,
      );
      finalPaths.push(join(this.#directory, authorityIdentity.backupFileName));
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
        invariantViolations: inspection.invariants.violations,
        exactTableRegistry: true,
      };
      const manifest: AuthorityBackupManifestV2 = AuthorityBackupManifestV2Schema.parse({
        kind: "hrauto-authority-backup",
        manifestVersion: 2,
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
        files: [
          {
            role: "authority-database",
            sourceFileName: "state.db",
            backupFileName,
            byteSize: stats.size,
            sha256: digest,
          },
          {
            role: "ordinary-settings",
            sourceFileName: "settings.json",
            ...ordinaryIdentity,
          },
          {
            role: "settings-root-authority",
            sourceFileName: "authority.json",
            ...authorityIdentity,
          },
        ],
        protectedSettings: settings.protectedSettings,
      });
      const manifestFileName = `${backupFileName}.manifest.json`;
      finalManifestPath = join(this.#directory, manifestFileName);
      writeFileSync(temporaryManifestPath, `${canonicalJsonStringify(manifest)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fsyncPath(temporaryManifestPath);
      renameSync(temporaryManifestPath, finalManifestPath);
      finalPaths.push(finalManifestPath);
      fsyncDirectory(this.#directory);
      await verifyBackupManifestAtPath(finalManifestPath, this.#source.getSourceDatabaseIdentity());
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
