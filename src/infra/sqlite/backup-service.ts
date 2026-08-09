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
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { AuthorityDatabase } from "./authority-database.js";
import {
  AuthorityBackupManifestSchema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  type AuthorityBackupManifest,
  type AuthorityBackupRunReport,
} from "./recovery-contracts.js";

export const AuthorityBackupServiceOptionsSchema = z.strictObject({
  directory: z.string().min(1),
});

type AuthorityBackupSource = Pick<
  AuthorityDatabase,
  "getMeta" | "getSourceDatabaseIdentity" | "onlineBackupTo"
>;

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
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  if (basename(backupPath) !== manifest.backupFileName || !existsSync(backupPath)) {
    throw new Error(`backup file ${manifest.backupFileName} named by ${basename(manifestPath)} does not exist`);
  }
  const stats = statSync(backupPath);
  if (!stats.isFile() || stats.size !== manifest.byteSize) {
    throw new Error(`backup file ${manifest.backupFileName} byte size does not match its manifest`);
  }
  const digest = await sha256File(backupPath);
  if (digest !== manifest.sha256) throw new Error(`backup file ${manifest.backupFileName} checksum does not match its manifest`);
  const inspection = AuthorityDatabase.inspectExistingReadOnly(backupPath);
  for (const field of ["applicationId", "schemaVersion", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (inspection[field] !== manifest[field]) {
      throw new Error(`backup file ${manifest.backupFileName} ${field} does not match its manifest`);
    }
  }
  return Object.freeze({ manifestPath, backupPath, manifest });
}

export class AuthorityBackupService {
  #source: AuthorityBackupSource;
  #directory: string;
  #clock: Clock;
  #inFlight: Promise<AuthorityBackupRunReport> | undefined;
  #requiredGeneration = 0;
  #coalescedRequests = 0;

  constructor(source: AuthorityBackupSource, input: unknown, clock: Clock = systemClock) {
    const options = AuthorityBackupServiceOptionsSchema.parse(input);
    this.#source = source;
    this.#directory = resolve(options.directory);
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
    const temporaryManifestPath = join(this.#directory, `.authority-${token}.manifest.json.tmp`);
    let finalBackupPath: string | undefined;
    let finalManifestPath: string | undefined;
    try {
      await this.#source.onlineBackupTo(temporaryBackupPath);
      const inspection = AuthorityDatabase.inspectExistingReadOnly(temporaryBackupPath);
      chmodSync(temporaryBackupPath, 0o600);
      fsyncPath(temporaryBackupPath);
      const createdAt = this.#clock.now().toISOString();
      const compactTime = createdAt.replaceAll(/[^0-9]/g, "");
      const backupFileName = `authority-g${String(inspection.authorityGeneration)}-${compactTime}-${token}.sqlite`;
      finalBackupPath = join(this.#directory, backupFileName);
      renameSync(temporaryBackupPath, finalBackupPath);
      fsyncDirectory(this.#directory);
      const stats = statSync(finalBackupPath);
      const digest = await sha256File(finalBackupPath);
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
      const manifest = AuthorityBackupManifestSchema.parse({
        kind: "hrauto-authority-backup",
        manifestVersion: 1,
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
      fsyncDirectory(this.#directory);
      await verifyBackupManifestAtPath(finalManifestPath, this.#source.getSourceDatabaseIdentity());
      return manifest;
    } catch (error) {
      if (finalManifestPath !== undefined && existsSync(finalManifestPath)) rmSync(finalManifestPath);
      if (finalBackupPath !== undefined) {
        for (const path of [finalBackupPath, `${finalBackupPath}-wal`, `${finalBackupPath}-shm`]) {
          if (existsSync(path)) rmSync(path);
        }
      }
      throw error;
    } finally {
      if (existsSync(temporaryManifestPath)) rmSync(temporaryManifestPath);
      for (const path of [temporaryBackupPath, `${temporaryBackupPath}-wal`, `${temporaryBackupPath}-shm`]) {
        if (existsSync(path)) rmSync(path);
      }
    }
  }
}
