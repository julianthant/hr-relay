import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../domain/ids.js";
import { LedgerEntrySchema } from "../../../domain/ledger.js";
import { SpanEventWireSchema, type SpanEventWire } from "../../../events/types.js";
import { TimelineAppendSchema, type TimelineAppend } from "../../../events/timeline.js";
import type { VerifiedBackup } from "../sqlite/backup-service.js";

const SourceFileSchema = z.strictObject({
  relativePath: z.string().regex(/^(?:spans|ledger)\/[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}\.jsonl$/),
  sha256: FingerprintSchema,
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
});
const ManifestFields = {
  sourceDatabaseIdentity: FingerprintSchema,
  backupSha256: FingerprintSchema,
  authorityGeneration: z.number().int().nonnegative(),
};
export const TimelineSourceManifestSchema = z.discriminatedUnion("version", [
  z.strictObject({ version: z.literal(1), ...ManifestFields, files: z.array(SourceFileSchema.extend({ relativePath: z.string().regex(/^spans\/[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}\.jsonl$/) })) }),
  z.strictObject({ version: z.literal(2), ...ManifestFields, files: z.array(SourceFileSchema) }),
]).superRefine(({ files }, context) => {
  const paths = files.map((file) => file.relativePath);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => index > 0 && path <= paths[index - 1])) {
    context.addIssue({ code: "custom", message: "timeline source files must be unique and sorted" });
  }
});
export type TimelineSourceManifest = z.infer<typeof TimelineSourceManifestSchema>;
export type TimelineSourceSnapshot = Readonly<{
  manifest: TimelineSourceManifest;
  digest: string;
  files: readonly Readonly<{ relativePath: string; bytes: Buffer }>[];
}>;

class TimelineSourceError extends Error {}

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceError(path: string, line?: number): Error {
  // Validation errors can contain private payload values; only provenance is public.
  return new TimelineSourceError(`timeline-source-invalid: ${digest(path).replace(/(.{4})(?=.)/gu, "$1-")}${line === undefined ? "" : `:${String(line)}`}`);
}

function parseLines(path: string, bytes: Buffer): readonly SpanEventWire[] {
  if (path.startsWith("ledger/")) { parseLedgerSource(path, bytes); return []; }
  if (bytes.length > 8 * 1024 * 1024) throw new TimelineSourceError("timeline-source-file-limit");
  const file = /^spans\/(.+)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(path);
  if (file === null || !z.iso.date().safeParse(file[2]).success) throw sourceError(path);
  if (bytes.length === 0) return [];
  if (bytes.at(-1) !== 10) throw sourceError(path);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw sourceError(path); }
  const rows = text.slice(0, -1).split("\n");
  if (rows.length > 100_000) throw new TimelineSourceError("timeline-source-line-count-limit");
  return rows.map((line, index) => {
    if (Buffer.byteLength(line, "utf8") > 256 * 1024) throw sourceError(path, index + 1);
    let event: SpanEventWire;
    try { event = SpanEventWireSchema.parse(JSON.parse(line)); }
    catch { throw sourceError(path, index + 1); }
    if (event.workflow !== file[1]) throw sourceError(path, index + 1);
    return event;
  });
}

/** Synchronous directory critical section: child reads resolve from a held cwd.
 * Node has no openat; verify the no-follow descriptor before reading any child.
 * No await or caller callback may enter this private helper.
 */
function withinSourceDirectory<T>(path: string, read: () => T): T {
  const absolute = resolve(path);
  const previous = process.cwd();
  let fd: number;
  try { fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY); }
  catch { throw new TimelineSourceError("timeline-source-directory-invalid"); }
  try {
    const before = fstatSync(fd);
    process.chdir(absolute);
    const held = statSync(".");
    if (!before.isDirectory() || held.dev !== before.dev || held.ino !== before.ino) throw new TimelineSourceError("timeline-source-directory-changed");
    const result = read();
    const named = lstatSync(absolute);
    if (named.isSymbolicLink() || named.dev !== held.dev || named.ino !== held.ino) throw new TimelineSourceError("timeline-source-directory-changed");
    return result;
  } catch (error) {
    if (error instanceof TimelineSourceError) throw error;
    throw new TimelineSourceError("timeline-source-directory-operation-failed");
  } finally {
    process.chdir(previous);
    closeSync(fd);
  }
}

function fileBytes(path: string): Buffer {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw sourceError(path); }
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new TimelineSourceError("timeline-source-not-regular");
    if (before.size > 8 * 1024 * 1024) throw new TimelineSourceError("timeline-source-file-limit");
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size = 0;
    for (;;) {
      const count = readSync(fd, buffer);
      if (count === 0) break;
      size += count;
      if (size > 8 * 1024 * 1024) throw new TimelineSourceError("timeline-source-file-limit");
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const bytes = Buffer.concat(chunks, size);
    const after = fstatSync(fd);
    const named = lstatSync(path);
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || named.dev !== after.dev || named.ino !== after.ino || named.isSymbolicLink()) {
      throw new TimelineSourceError("timeline-source-changed-during-read");
    }
    return bytes;
  } catch (error) {
    if (error instanceof TimelineSourceError) throw error;
    throw sourceError(path);
  } finally { closeSync(fd); }
}

/** Read-only preflight. The caller holds stopped-system admission before application. */
export function inspectTimelineSources(stateRoot: string, backup: VerifiedBackup): TimelineSourceSnapshot {
  const files = withinSourceDirectory(stateRoot, () => {
    let totalBytes = 0;
    return (backup.manifest.schemaVersion >= 38 ? ["ledger"] : ["spans", "ledger"]).flatMap((directory) => {
      if (!existsSync(directory)) return [];
      return withinSourceDirectory(directory, () => {
        const names = readdirSync(".").sort();
        if (names.length > 128) throw new TimelineSourceError("timeline-source-file-count-limit");
        return names.map((name) => {
          const relativePath = `${directory}/${name}`;
          if (!SourceFileSchema.shape.relativePath.safeParse(relativePath).success) throw sourceError(relativePath);
          const bytes = fileBytes(name); totalBytes += bytes.length;
          if (totalBytes > 16 * 1024 * 1024) throw new TimelineSourceError("timeline-source-corpus-limit");
          return { relativePath, bytes };
        });
      });
    }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  });
  const manifest = TimelineSourceManifestSchema.parse({
    version: 2,
    sourceDatabaseIdentity: backup.manifest.sourceDatabaseIdentity,
    backupSha256: backup.manifest.sha256,
    authorityGeneration: backup.manifest.authorityGeneration,
    files: files.map((file) => ({ relativePath: file.relativePath, sha256: digest(file.bytes),
      bytes: file.bytes.length, lines: sourceLineCount(file.relativePath, file.bytes) })),
  });
  return { manifest, digest: digest(canonicalJsonStringify(manifest)), files };
}

function validateSnapshot(snapshot: TimelineSourceSnapshot): void {
  const manifest = TimelineSourceManifestSchema.parse(snapshot.manifest);
  if (digest(canonicalJsonStringify(manifest)) !== FingerprintSchema.parse(snapshot.digest)
    || manifest.files.length !== snapshot.files.length || manifest.files.length > 128) {
    throw new TimelineSourceError("timeline-source-snapshot-mismatch");
  }
  let totalBytes = 0;
  for (const [index, file] of snapshot.files.entries()) {
    const expected = manifest.files[index];
    if (expected === undefined || expected.relativePath !== file.relativePath
      || !Buffer.isBuffer(file.bytes) || expected.bytes !== file.bytes.length
      || expected.sha256 !== digest(file.bytes) || expected.lines !== sourceLineCount(file.relativePath, file.bytes)) {
      throw new TimelineSourceError("timeline-source-snapshot-mismatch");
    }
    totalBytes += file.bytes.length;
    if (totalBytes > 16 * 1024 * 1024) throw new TimelineSourceError("timeline-source-corpus-limit");
  }
}

function fsync(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** A content-addressed recovery copy; partial copies never replace a verified set. */
export function preserveTimelineSources(snapshot: TimelineSourceSnapshot, backup: VerifiedBackup): string {
  validateSnapshot(snapshot);
  if (snapshot.manifest.backupSha256 !== backup.manifest.sha256
    || snapshot.manifest.sourceDatabaseIdentity !== backup.manifest.sourceDatabaseIdentity
    || snapshot.manifest.authorityGeneration !== backup.manifest.authorityGeneration) {
    throw new TimelineSourceError("timeline-source-backup-mismatch");
  }
  const backupDirectory = resolve(dirname(backup.manifestPath));
  const destination = join(backupDirectory, "timeline-sources", FingerprintSchema.parse(snapshot.digest));
  return withinSourceDirectory(backupDirectory, () => {
    if (!existsSync("timeline-sources")) mkdirSync("timeline-sources", { mode: 0o700 });
    return withinSourceDirectory("timeline-sources", () => {
      if (existsSync(snapshot.digest)) {
        readPreservedTimelineSources(snapshot.digest, snapshot.digest, backup);
        return destination;
      }
      const temporary = mkdtempSync(".pending-");
      try {
        withinSourceDirectory(temporary, () => {
          for (const directory of ["spans", "ledger"]) {
            mkdirSync(directory, { mode: 0o700 });
            withinSourceDirectory(directory, () => {
              for (const file of snapshot.files.filter((file) => file.relativePath.startsWith(`${directory}/`))) {
                const path = basename(file.relativePath);
                writeFileSync(path, file.bytes, { flag: "wx", mode: 0o400 }); fsync(path);
              }
              fsync(".");
            });
          }
          writeFileSync("manifest.json", canonicalJsonStringify(snapshot.manifest), { flag: "wx", mode: 0o400 });
          fsync("manifest.json");
          fsync(".");
        });
        readPreservedTimelineSources(temporary, snapshot.digest, backup);
        renameSync(temporary, snapshot.digest);
        fsync(".");
        return destination;
      } catch (error) {
        rmSync(temporary, { recursive: true, force: true });
        throw error;
      }
    });
  });
}

export function readPreservedTimelineSources(directory: string, expectedDigest: string, backup: VerifiedBackup): TimelineSourceSnapshot {
  return withinSourceDirectory(directory, () => {
    let manifest: TimelineSourceManifest;
    try { manifest = TimelineSourceManifestSchema.parse(JSON.parse(fileBytes("manifest.json").toString("utf8"))); }
    catch { throw new TimelineSourceError("timeline-source-copy-manifest-invalid"); }
    if (digest(canonicalJsonStringify(manifest)) !== expectedDigest
      || manifest.backupSha256 !== backup.manifest.sha256
      || manifest.sourceDatabaseIdentity !== backup.manifest.sourceDatabaseIdentity
      || manifest.authorityGeneration !== backup.manifest.authorityGeneration) throw new TimelineSourceError("timeline-source-copy-binding-mismatch");
    const files = ["ledger", "spans"].flatMap((directory) => {
      const expected = manifest.files.filter((file) => file.relativePath.startsWith(`${directory}/`));
      // Released span-only recovery copies predate the ledger directory.
      if (directory === "ledger" && expected.length === 0 && !existsSync(directory)) return [];
      return withinSourceDirectory(directory, () => {
        const names = readdirSync(".").sort().map((name) => `${directory}/${name}`);
        if (canonicalJsonStringify(names) !== canonicalJsonStringify(expected.map((file) => file.relativePath))) throw new TimelineSourceError("timeline-source-copy-membership-mismatch");
        return expected.map((file) => {
          const bytes = fileBytes(basename(file.relativePath));
          if (bytes.length !== file.bytes || digest(bytes) !== file.sha256 || sourceLineCount(file.relativePath, bytes) !== file.lines) throw new TimelineSourceError("timeline-source-copy-content-mismatch");
          return { relativePath: file.relativePath, bytes };
        });
      });
    });
    const snapshot = { manifest, digest: expectedDigest, files };
    validateSnapshot(snapshot);
    return snapshot;
  });
}

/** Explicit recovery selection is authenticated against this exact SQLite backup. */
export function timelineSourcesForUpgrade(stateRoot: string, backup: VerifiedBackup, selectedCopy?: string): TimelineSourceSnapshot {
  if (selectedCopy !== undefined) return readPreservedTimelineSources(selectedCopy, FingerprintSchema.parse(basename(selectedCopy)), backup);
  const original = inspectTimelineSources(stateRoot, backup);
  if (original.manifest.files.length > 0) return original;
  const copies = join(dirname(backup.manifestPath), "timeline-sources");
  if (!existsSync(copies)) return original;
  if (!lstatSync(copies).isDirectory() || lstatSync(copies).isSymbolicLink()) throw new TimelineSourceError("timeline-source-copy-parent-invalid");
  for (const name of readdirSync(copies)) {
    if (!FingerprintSchema.safeParse(name).success) continue; // interrupted private copies were never admitted
    const manifest = TimelineSourceManifestSchema.parse(JSON.parse(fileBytes(join(copies, name, "manifest.json")).toString("utf8")));
    if (manifest.backupSha256 === backup.manifest.sha256 && manifest.files.length > 0) {
      throw new TimelineSourceError("timeline-source-originals-missing: select the verified recovery copy with --timeline-from");
    }
  }
  return original;
}

/** Deterministic source identity includes line provenance, never timestamp/text alone. */
function importedEventId(fileDigest: string, relativePath: string, line: number): string {
  const hex = digest(`timeline-span-v1:${relativePath}:${fileDigest}:${String(line)}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function timelineImportRecords(snapshot: TimelineSourceSnapshot, recordedAt: string): readonly TimelineAppend[] {
  validateSnapshot(snapshot);
  IsoInstantSchema.parse(recordedAt);
  return snapshot.files.flatMap((file) => {
    const sha256 = digest(file.bytes);
    const retentionDate = file.relativePath.slice(-16, -6);
    return parseLines(file.relativePath, file.bytes).map((event, index) => TimelineAppendSchema.parse({
      schemaVersion: 1, eventId: importedEventId(sha256, file.relativePath, index + 1),
      workflow: event.workflow,
      scope: "runId" in event ? { kind: "run", runId: event.runId } : { kind: "worker", workerId: event.workerId },
      occurredAt: event.ts, recordedAt, retentionDate, payload: { kind: "span", event },
      source: { kind: "span-import", manifestDigest: snapshot.digest, relativePath: file.relativePath,
        fileDigest: sha256, line: index + 1 },
    }));
  });
}

function parseLedgerSource(path: string, bytes: Buffer) {
  if (bytes.length > 8 * 1024 * 1024) throw new TimelineSourceError("timeline-source-file-limit");
  const file = /^ledger\/(.+)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(path);
  if (file === null || !z.iso.date().safeParse(file[2]).success) throw sourceError(path);
  if (bytes.length === 0) return [];
  if (bytes.at(-1) !== 10) throw sourceError(path);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw sourceError(path); }
  return text.slice(0, -1).split("\n").map((line, index) => {
    try {
      const entry = LedgerEntrySchema.parse(JSON.parse(line));
      if (entry.payload.system !== file[1] || entry.seq !== index) throw sourceError(path, index + 1);
      return { entry, line, relativePath: path, sha256: digest(bytes), lineNumber: index + 1 };
    } catch { throw sourceError(path, index + 1); }
  });
}
function sourceLineCount(path: string, bytes: Buffer): number {
  return path.startsWith("ledger/") ? parseLedgerSource(path, bytes).length : parseLines(path, bytes).length;
}
export function historicalLedgerSources(snapshot: TimelineSourceSnapshot) {
  validateSnapshot(snapshot);
  return snapshot.files.filter((file) => file.relativePath.startsWith("ledger/")).flatMap((file) => parseLedgerSource(file.relativePath, file.bytes));
}
