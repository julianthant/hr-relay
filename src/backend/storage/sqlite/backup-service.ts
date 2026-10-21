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
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import { inspectAuthorityBackupReadOnly, type AuthorityBackupSourceReadOnly } from "./backup-inspection.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import {
  AuthorityBackupManifestSchema,
  AuthorityBackupManifestV3Schema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  type AuthorityBackupManifest,
  type AuthorityBackupManifestV3,
  type AuthorityBackupRunReport,
} from "./recovery-contracts.js";

export const AuthorityBackupServiceOptionsSchema = z.strictObject({
  directory: z.string().min(1),
});

type AuthorityBackupSource = Pick<
  AuthorityBackupSourceReadOnly,
  "getMeta" | "getSourceDatabaseIdentity" | "onlineBackupTo"
>;

// Read-only WAL connections can create SQLite companions and cannot remove them on close.
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

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
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
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  await verifyBackupBytesAtPath(backupPath, manifest);
  const copyAdmission = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256);
  let inspection: ReturnType<typeof inspectAuthorityBackupReadOnly>;
  try { inspection = inspectAuthorityBackupReadOnly(copyAdmission, backupPath, manifest.schemaVersion); }
  finally { copyAdmission.release(); }
  removeReadOnlyInspectionCompanions(backupPath);
  for (const field of ["applicationId", "schemaVersion", "installationId", "profileId", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (inspection[field] !== manifest[field]) {
      throw new Error(`backup file ${manifest.backupFileName} ${field} does not match its manifest`);
    }
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
      const copyAdmission = this.#admission.verifiedReadOnlyCopy(temporaryBackupPath, await sha256File(temporaryBackupPath));
      let inspection: ReturnType<typeof inspectAuthorityBackupReadOnly>;
      try { inspection = inspectAuthorityBackupReadOnly(copyAdmission, temporaryBackupPath, this.#source.getMeta().schemaVersion); }
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
      fsyncPath(this.#directory);
      const verification = {
        state: "verified",
        observedFrom: "backup-copy",
        observedAt: this.#clock.now().toISOString(),
        applicationId: inspection.applicationId,
        schemaVersion: inspection.schemaVersion,
        ...(inspection.installationId === undefined ? {} : { installationId: inspection.installationId }),
        ...(inspection.profileId === undefined ? {} : { profileId: inspection.profileId }),
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
        ...(inspection.installationId === undefined ? {} : { installationId: inspection.installationId }),
        ...(inspection.profileId === undefined ? {} : { profileId: inspection.profileId }),
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
      fsyncPath(this.#directory);
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
