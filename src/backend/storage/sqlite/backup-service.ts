import { authoritySourceDatabaseIdentity, type AuthorityBackupExpectedSource } from "./database-identity.js";
import { privatePathRejects } from "../private-path.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, constants, fstatSync, lstatSync, readSync,
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
import { readPrivateFile } from "../configuration/credential-safe-file.js";
import { createReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { type Clock, systemClock } from "../../../rules/time/clock.js";
import { inspectAuthorityBackupReadOnly, type AuthorityBackupSourceReadOnly } from "./backup-inspection.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import {
  AuthorityBackupManifestSchema,
  StoppedAuthorityBackupManifestSchema,
  UnboundPredecessorBackupManifestSchema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  type AuthorityBackupManifest,
  type StoppedAuthorityBackupManifest,
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
  manifest: StoppedAuthorityBackupManifest;
}>;

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  let primary: { error: unknown } | undefined;
  let descriptorIdentity: ReturnType<typeof fstatSync> | undefined;
  try { descriptorIdentity = fstatSync(descriptor); fsyncSync(descriptor); }
  catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
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
): Promise<VerifiedBackup> {
  const admission = requireRuntimeAdmission(admissionInput);
  const manifestPath = resolve(z.string().min(1).parse(manifestPathInput));
  if (!existsSync(manifestPath)) throw new Error(`backup manifest ${manifestPath} does not exist`);
  const expected = admission.authorityBackupExpectedSource();
  if (expected.kind !== "profile") throw new Error("profile-backup-binding-required");
  const manifest = parseBackupManifestFile(manifestPath);
  if (manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity(expected)) {
    throw new Error(`backup manifest ${basename(manifestPath)} belongs to a different authority database`);
  }
  assertExpectedBackupSource(expected, manifest);
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  await verifyBackupBytesAtPath(backupPath, manifest);
  const copyAdmission = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256);
  let inspection: ReturnType<typeof inspectAuthorityBackupReadOnly>;
  try { inspection = inspectAuthorityBackupReadOnly(copyAdmission, backupPath, manifest.schemaVersion); }
  finally { copyAdmission.release(); }
  removeReadOnlyInspectionCompanions(backupPath);
  assertBackupInspection(manifest, inspection, expected);
  return Object.freeze({ manifestPath, backupPath, manifest });
}

function assertExpectedBackupSource(expected: AuthorityBackupExpectedSource,
  observed: Pick<StoppedAuthorityBackupManifest, "schemaVersion" | "installationId" | "profileId" | "authorityContentFingerprint">): void {
  if (expected.kind === "profile") {
    if (observed.installationId !== expected.binding.installationId || observed.profileId !== expected.binding.profileId) {
      throw new Error("backup-profile-binding-mismatch");
    }
  } else if (observed.schemaVersion !== expected.schemaVersion || observed.installationId !== undefined
    || observed.profileId !== undefined || observed.authorityContentFingerprint !== expected.authorityContentFingerprint) {
    throw new Error("backup-predecessor-source-mismatch");
  }
}

function assertBackupInspection(manifest: StoppedAuthorityBackupManifest, inspection: ReturnType<typeof inspectAuthorityBackupReadOnly>,
  expected: AuthorityBackupExpectedSource): void {
  assertExpectedBackupSource(expected, manifest);
  assertExpectedBackupSource(expected, inspection);
  for (const field of ["applicationId", "schemaVersion", "installationId", "profileId", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (inspection[field] !== manifest[field]) {
      throw new Error(`backup file ${manifest.backupFileName} ${field} does not match its manifest`);
    }
  }
}

export function verifyStoppedBackupManifestAtPath(admissionInput: RuntimeAdmission, manifestPathInput: string): VerifiedBackup {
  const admission = requireRuntimeAdmission(admissionInput), manifestPath = resolve(manifestPathInput);
  admission.assertReadOnlyAuthorityDatabase(join(admission.stateRoot, "state.db"));
  admission.assertStateRoot(manifestPath);
  return verifyStoppedManifest(manifestPath, admission.authorityBackupExpectedSource(), path => admission.assertStateRoot(path), (backupPath, manifest) => {
    const copy = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256);
    try { return inspectAuthorityBackupReadOnly(copy, backupPath, manifest.schemaVersion); }
    finally { copy.release(); }
  });
}

function verifyStoppedManifest(manifestPath: string, expected: AuthorityBackupExpectedSource, assertPath: (path: string) => void,
  inspect: (path: string, manifest: StoppedAuthorityBackupManifest) => ReturnType<typeof inspectAuthorityBackupReadOnly>): VerifiedBackup {
  const file = readPrivateFile(manifestPath, { label: "lock", maxBytes: 64_000 });
  if (file === undefined) throw new Error("profile-maintenance-backup-manifest-required");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  const manifest = expected.kind === "profile" ? AuthorityBackupManifestSchema.parse(value) : UnboundPredecessorBackupManifestSchema.parse(value);
  assertExpectedBackupSource(expected, manifest);
  if (expected.kind === "profile" && manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity(expected)) throw new Error("profile-maintenance-backup-source-mismatch");
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  assertPath(backupPath);
  const snapshot = createReadonlyAuthoritySnapshot(backupPath);
  let result: VerifiedBackup | undefined;
  const failures: unknown[] = [];
  try {
    const before = lstatSync(backupPath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || privatePathRejects(backupPath, before, "private") || before.size !== manifest.byteSize) throw new Error("profile-maintenance-backup-identity-invalid");
    const descriptor = openSync(backupPath, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash("sha256");
    let descriptorIdentity = before;
    let descriptorFailure: { error: unknown } | undefined;
    try {
      const opened = fstatSync(descriptor); descriptorIdentity = opened;
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("profile-maintenance-backup-changed");
      const chunk = Buffer.alloc(64 * 1024); let count = 0;
      for (;;) {
        const size = readSync(descriptor, chunk, 0, chunk.length, null);
        if (size === 0) break;
        count += size;
        if (count > manifest.byteSize) throw new Error("profile-maintenance-backup-size-invalid");
        hash.update(chunk.subarray(0, size));
      }
      if (count !== manifest.byteSize || hash.digest("hex") !== manifest.sha256) throw new Error("profile-maintenance-backup-digest-mismatch");
    } catch (error) { descriptorFailure = { error }; }
    try { closeSync(descriptor); }
    catch (error) { throw retainAuthoritySourceClosure(descriptorFailure === undefined ? [error] : [descriptorFailure.error, error],
      { snapshot, descriptor: { descriptor, identity: descriptorIdentity } }); }
    if (descriptorFailure !== undefined) throw descriptorFailure.error;
    snapshot.assertUnchanged();
    assertBackupInspection(manifest, inspect(backupPath, manifest), expected);
    snapshot.assertUnchanged();
    const after = readPrivateFile(manifestPath, { label: "lock", maxBytes: 64_000 });
    if (after === undefined || after.identity.device !== file.identity.device || after.identity.inode !== file.identity.inode || !after.bytes.equals(file.bytes)) throw new Error("profile-maintenance-backup-manifest-changed");
    result = Object.freeze({ manifestPath, backupPath, manifest });
  } catch (error) { failures.push(error); }
  if (failures.some(error => error instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(failures, { snapshot });
  try { snapshot.assertUnchanged(); } catch (error) { failures.push(error); }
  try { snapshot.dispose(); }
  catch (error) { throw retainAuthoritySourceClosure([...failures, error], { snapshot }); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "authority-backup-validation-failed", { cause: failures[0] });
  if (result === undefined) throw new Error("authority-backup-result-missing");
  return result;
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
    this.#admission.assertAuthorityBackupWrite(this.#directory);
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
    const manifests: StoppedAuthorityBackupManifest[] = [];
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

  async #createOne(): Promise<StoppedAuthorityBackupManifest> {
    this.#admission.assertAuthorityBackupWrite(this.#directory);
    const expected = this.#admission.authorityBackupExpectedSource();
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const temporaryBackupPath = join(this.#directory, `.authority-${token}.sqlite.tmp`);
    const temporaryManifestPath = join(this.#directory, `.authority-${token}.manifest.json.tmp`);
    const temporaryPaths = [temporaryBackupPath, temporaryManifestPath];
    const finalPaths: string[] = [];
    let finalManifestPath: string | undefined;
    let result: StoppedAuthorityBackupManifest | undefined;
    let primary: { error: unknown } | undefined;
    try {
      await this.#source.onlineBackupTo(temporaryBackupPath);
      this.#admission.assertAuthorityBackupWrite(this.#directory);
      const copyAdmission = this.#admission.verifiedReadOnlyCopy(temporaryBackupPath, await sha256File(temporaryBackupPath));
      let inspection: ReturnType<typeof inspectAuthorityBackupReadOnly>;
      try { inspection = inspectAuthorityBackupReadOnly(copyAdmission, temporaryBackupPath, this.#source.getMeta().schemaVersion); }
      finally { copyAdmission.release(); }
      assertExpectedBackupSource(expected, inspection);
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
      this.#admission.assertAuthorityBackupWrite(this.#directory);
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
      const manifest = StoppedAuthorityBackupManifestSchema.parse({
        kind: "hrauto-authority-backup",
        manifestVersion: expected.kind === "profile" ? 4 : 3,
        backupFileName,
        sourceDatabaseIdentity: authoritySourceDatabaseIdentity(expected),
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
      if (expected.kind === "profile") await verifyBackupManifestAtPath(this.#admission, finalManifestPath);
      else verifyStoppedBackupManifestAtPath(this.#admission, finalManifestPath);
      result = manifest;
    } catch (error) { primary = { error }; }
    if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw primary.error;
    const cleanupFailures: unknown[] = [];
    if (primary !== undefined) {
      try { if (finalManifestPath !== undefined && existsSync(finalManifestPath)) rmSync(finalManifestPath); }
      catch (error) { cleanupFailures.push(error); }
      for (const finalPath of finalPaths) {
        for (const path of [finalPath, `${finalPath}-wal`, `${finalPath}-shm`]) {
          try { if (existsSync(path)) rmSync(path); } catch (error) { cleanupFailures.push(error); }
        }
      }
    }
    for (const temporaryPath of temporaryPaths) {
      for (const path of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`]) {
        try { if (existsSync(path)) rmSync(path); } catch (error) { cleanupFailures.push(error); }
      }
    }
    if (cleanupFailures.length > 0) {
      if (primary !== undefined) throw new AggregateError([primary.error, ...cleanupFailures], "authority-backup-cleanup-failed", { cause: primary.error });
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
      throw new AggregateError(cleanupFailures, "authority-backup-cleanup-failed", { cause: cleanupFailures[0] });
    }
    if (primary !== undefined) throw primary.error;
    if (result === undefined) throw new Error("authority-backup-result-missing");
    return result;
  }
}
