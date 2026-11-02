import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { readPrivateFile, noSymlinkAncestry, statDirectory, unpublishedDraftAbortMembership, type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { privatePathRejects, writePrivateStage, fsyncPath } from "../private-path.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { BrowserSystemIdSchema } from "../../../rules/identity/ids.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const DispositionSchema = z.enum(["copy", "auth-state", "runtime-state"]);
const FileSchema = z.strictObject({ path: RelativePathSchema, digest: DigestSchema, size: z.number().int().safe().nonnegative(), mode: z.number().int().nonnegative() });
const MemberSchema = z.discriminatedUnion("kind", [
  FileSchema.extend({ kind: z.literal("file"), disposition: DispositionSchema }),
  z.strictObject({ kind: z.literal("directory"), path: RelativePathSchema, disposition: DispositionSchema, mode: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("absent"), path: RelativePathSchema, disposition: DispositionSchema }),
]);
export const SourceRecordSchema = z.strictObject({ schemaVersion: z.literal(2), kind: z.literal("flat-native6-archive"),
  operationId: z.uuid(), installationId: z.uuid(), sourceStateRoot: z.string().refine(isAbsolute), members: z.array(MemberSchema) }).superRefine((source, context) => {
  const paths = source.members.map(member => member.path);
  if (new Set(paths).size !== paths.length || canonicalJsonStringify(paths) !== canonicalJsonStringify([...paths].sort())) context.addIssue({ code: "custom", message: "flat archive membership must be unique and sorted" });
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const member = source.members.find(member => member.path === `profile/state.db${suffix}`);
    if (member === undefined || member.disposition !== "copy" || member.kind === "directory" || suffix === "" && member.kind !== "file") context.addIssue({ code: "custom", message: "flat archive database membership required" });
  }
  for (const member of source.members) {
    if (!["profile", "control", "workspace-data"].some(prefix => member.path === prefix || member.path.startsWith(`${prefix}/`))) context.addIssue({ code: "custom", message: "flat archive namespace refused" });
    if (member.kind !== "absent" && member.path.includes("/") && !source.members.some(parent => parent.kind === "directory" && parent.path === dirname(member.path))) context.addIssue({ code: "custom", message: "flat archive parent required" });
    if (member.kind === "absent") {
      if (member.path !== "workspace-data" && !/^profile\/state\.db(?:-wal|-shm|-journal)?$/u.test(member.path) || member.disposition !== "copy") context.addIssue({ code: "custom", message: "flat archive absence refused" });
    } else {
      try { if (disposition(member.path, member.kind === "directory") !== member.disposition) throw new Error("flat archive disposition mismatch"); }
      catch { context.addIssue({ code: "custom", message: "flat archive member refused" }); }
    }
  }
});
export type FlatArchiveSource = z.infer<typeof SourceRecordSchema>;
export const StorageBackupSchema = z.strictObject({ schemaVersion: z.literal(2), kind: z.literal("flat-native6-archive"),
  operationId: z.uuid(), installationId: z.uuid(), sourceStateRoot: z.string().refine(isAbsolute), sourceDigest: DigestSchema, files: z.array(FileSchema) });
export const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 512 * 1024 * 1024;

export class StorageBackupSourceChangedError extends Error {
  readonly code = "STORAGE_BACKUP_SOURCE_CHANGED";
  constructor() { super(ERROR_CATALOG.STORAGE_BACKUP_SOURCE_CHANGED.text); this.name = "StorageBackupSourceChangedError"; }
}

export function existingDataFileLabel(inventoryPath: string): "lock" | "authority database" | "managed data" {
  if (/^profile\/state\.db(?:-wal|-shm|-journal)?$/u.test(inventoryPath) || /^profile\/backups\/authority\/.+\.sqlite$/u.test(inventoryPath)) return "authority database";
  if (/^profile\/(?:browsers|artifacts|logs|scratch|files\/(?:reports|downloads|onboarding))\/(?!\.runtime-owner\.json$)/u.test(inventoryPath)
    || /^workspace-data\/(?:reports|downloads|onboarding)\//u.test(inventoryPath)) return "managed data";
  return "lock";
}

export function profileAuthorityFileWitnesses(root: string) {
  return (["", "-wal", "-shm", "-journal"] as const).map(suffix => {
    const source = readPrivateFile(join(root, `state.db${suffix}`), { label: "authority database", maxBytes });
    return { suffix, ...(source === undefined ? {} : { file: { device: source.identity.device,
      inode: source.identity.inode, digest: hash(source.bytes) } }) };
  });
}

export function file(path: string, label: "lock" | "authority database" | "managed data" = "lock") {
  noSymlinkAncestry(dirname(path), new Map());
  const value = readPrivateFile(path, { label, maxBytes });
  if (value === undefined) throw new Error("existing-data-backup-file-required");
  return value;
}

export function inventory(root: string, prefix: string, excluded: ReadonlySet<string> = new Set()) {
  const result: Array<{ path: string; file: z.infer<typeof FileSchema> }> = [];
  const walk = (directory: string, local: string) => {
    noSymlinkAncestry(directory, new Map());
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || privatePathRejects(directory, metadata, prefix === "" ? "directory-0700" : "group-write")) throw new Error("existing-data-backup-directory-refused");
    for (const name of readdirSync(directory).sort()) {
      const child = local === "" ? name : `${local}/${name}`;
      if (excluded.has(child)) continue;
      const path = join(directory, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, child);
      else {
        const inventoryPath = prefix === "" ? child : `${prefix}/${child}`;
        const current = file(path, prefix === "" ? "lock" : existingDataFileLabel(inventoryPath));
        result.push({ path, file: { path: inventoryPath, digest: hash(current.bytes), size: current.bytes.byteLength, mode: current.stat.mode & 0o7777 } });
      }
    }
  };
  walk(root, ""); return result;
}

function disposition(path: string, directory: boolean): z.infer<typeof DispositionSchema> {
  const parts = path.split("/"), [namespace, top] = parts;
  if (parts.length === 1 && directory && ["profile", "control", "workspace-data"].includes(namespace ?? "")) return "copy";
  if (namespace === "workspace-data" && ["reports", "downloads", "onboarding"].includes(top ?? "") && (parts.length > 2 || directory)) return "copy";
  if (namespace === "control") {
    if (parts.length === 2 && ["installation.json", "locator.json"].includes(top ?? "") && !directory) return "copy";
    if (top === "relocation-receipts" && (parts.length === 2 && directory || parts.length === 3 && !directory && /^\d{12}-[0-9a-f-]{36}\.json$/u.test(parts[2] ?? ""))) return "copy";
    if (parts.length === 2 && top === ".installation-mutation.lock" && !directory) return "runtime-state";
  }
  if (namespace === "profile") {
    if (parts.length === 2 && /^state\.db(?:-wal|-shm|-journal)?$/u.test(top ?? "") && !directory) return "copy";
    if (parts.length === 2 && top === ".runtime-owner.json" && !directory || parts.length === 3 && top === "artifacts" && parts[2] === ".runtime-owner.json" && !directory) return "runtime-state";
    if (top === "locks") return "runtime-state";
    if (top === "credentials" && (parts.length === 2 && directory || parts.length === 3 && !directory && ["protected.json", "duo-webauthn.json", "chatgpt-account.json"].includes(parts[2] ?? ""))) return "auth-state";
    if (top === "browsers") {
      if (parts.length === 2 && directory || parts.length === 3 && directory && /^w[1-9]\d*$/u.test(parts[2] ?? "")
        || parts.length >= 4 && /^w[1-9]\d*$/u.test(parts[2] ?? "") && BrowserSystemIdSchema.safeParse(parts[3]).success
        || parts.length >= 3 && /^onboarding-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-){3}g[1-9]\d*$/u.test(parts[2] ?? "")) return "auth-state";
    }
    if (top === "artifacts" && (parts.length === 2 && directory || parts.length === 3 && !directory && /^[0-9a-f]{64}\.artifact$/u.test(parts[2] ?? ""))) return "copy";
    if (top === "logs" && (parts.length === 2 && directory || parts.length === 3 && parts[2] === "boot.jsonl" && !directory)) return "copy";
    if (top === "files" && (parts.length === 2 && directory || ["reports", "downloads", "onboarding"].includes(parts[2] ?? "") && (parts.length > 3 || directory))) return "copy";
    if (top === "scratch" && parts.length === 2 && directory) return "copy";
    if (top === "backups") {
      if (parts.length === 2 && directory || parts.length === 3 && directory && parts[2] === "authority") return "copy";
      if (parts[2] === "suspects") return "auth-state";
      if (parts.length === 4 && !directory && parts[2] === "authority" && /^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite(?:\.manifest\.json)?$/u.test(parts[3] ?? "")) return "copy";
    }
  }
  throw new Error("flat-archive-member-unsupported");
}

export function flatArchiveFiles(source: FlatArchiveSource): z.infer<typeof FileSchema>[] {
  return source.members.flatMap(member => member.kind === "file" && member.disposition === "copy"
    ? [{ path: member.path, digest: member.digest, size: member.size, mode: member.mode }] : []);
}

export function flatArchiveMemberPath(workspace: string, stateRoot: string, path: string): string {
  RelativePathSchema.parse(path);
  const [namespace, ...parts] = path.split("/");
  const root = namespace === "profile" ? stateRoot : namespace === "workspace-data" ? join(workspace, "data") : namespace === "control" ? join(workspace, ".tracker", "control") : undefined;
  if (root === undefined) throw new Error("flat-archive-namespace-refused");
  return join(root, ...parts);
}

export function captureFlatArchiveSource(input: Readonly<{ workspace: string; stateRoot: string; installationId: string; operationId: string }>) {
  if (input.stateRoot !== join(input.workspace, rebuildRuntimeIsolation.stateRoot)) throw new Error("flat-archive-root-refused");
  const ancestors = new Map<string, DirectoryIdentity>();
  const capture = () => {
    const members: FlatArchiveSource["members"] = [], identities: unknown[] = [];
    const walk = (path: string, name: string) => {
      noSymlinkAncestry(dirname(path), ancestors);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || privatePathRejects(path, stat, "group-write")) throw new Error("flat-archive-member-unsafe");
      const kind = stat.isDirectory() ? "directory" : "file", choice = disposition(name, kind === "directory");
      if (choice !== "copy" && privatePathRejects(path, stat, "private")) throw new Error("flat-archive-excluded-member-unsafe");
      identities.push({ path, device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid, links: stat.nlink });
      if (kind === "directory") {
        members.push({ path: name, kind, disposition: choice, mode: stat.mode & 0o7777 });
        for (const child of readdirSync(path).sort()) {
          if (name === "control" && child === "storage-backups") continue;
          walk(join(path, child), `${name}/${child}`);
        }
      } else {
        const current = file(path, choice === "copy" ? existingDataFileLabel(name) : "lock");
        members.push({ path: name, kind, disposition: choice, size: current.bytes.byteLength, digest: hash(current.bytes), mode: current.stat.mode & 0o7777 });
      }
    };
    for (const [path, namespace] of [[input.stateRoot, "profile"], [join(input.workspace, ".tracker", "control"), "control"], [join(input.workspace, "data"), "workspace-data"]] as const) {
      if (lstatSync(path, { throwIfNoEntry: false }) === undefined) members.push({ kind: "absent", path: namespace, disposition: "copy" });
      else walk(path, namespace);
    }
    for (const suffix of ["", "-wal", "-shm", "-journal"]) if (!members.some(member => member.path === `profile/state.db${suffix}`)) members.push({ kind: "absent", path: `profile/state.db${suffix}`, disposition: "copy" });
    const document = SourceRecordSchema.parse({ schemaVersion: 2, kind: "flat-native6-archive", operationId: input.operationId,
      installationId: input.installationId, sourceStateRoot: input.stateRoot,
      members: members.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) });
    return { document, identities };
  };
  const before = capture();
  return { document: before.document, assertCurrent(this: void) {
    const after = capture();
    if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new StorageBackupSourceChangedError();
  } };
}

export function verifyCopies(root: string, files: readonly z.infer<typeof FileSchema>[]) {
  const directories = new Set([""]);
  for (const entry of files) for (let path = dirname(entry.path); path !== "."; path = dirname(path)) directories.add(path);
  if (unpublishedDraftAbortMembership(join(root, "files")).some(entry => entry.directory && !directories.has(entry.path))) throw new Error("existing-data-backup-membership-changed");
  const actual = inventory(join(root, "files"), "").map(entry => ({ path: entry.file.path, digest: entry.file.digest, size: entry.file.size })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = files.map(entry => ({ path: entry.path, digest: entry.digest, size: entry.size })).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map(entry => entry.path)).size !== files.length || canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) throw new Error("existing-data-backup-changed");
}

export function writeFlatArchiveCopies(root: string, source: FlatArchiveSource, assertCurrent: () => void) {
  SourceRecordSchema.parse(source);
  const workspace = dirname(dirname(source.sourceStateRoot)), expected = join(workspace, ".tracker", "control", "storage-backups", source.installationId);
  if (root !== expected) throw new Error("flat-archive-destination-refused");
  const ancestors = new Map<string, DirectoryIdentity>();
  const assertDestination = () => { noSymlinkAncestry(root, ancestors); statDirectory(root, "flat archive", 0o700); };
  assertDestination();
  const files = flatArchiveFiles(source), copied = join(root, "files");
  if (lstatSync(copied, { throwIfNoEntry: false }) !== undefined) {
    const existing = inventory(copied, "");
    const directories = new Set([""]);
    for (const entry of existing) for (let path = dirname(entry.file.path); path !== "."; path = dirname(path)) directories.add(path);
    if (unpublishedDraftAbortMembership(copied).some(entry => entry.directory && !directories.has(entry.path))) throw new Error("flat-archive-copy-prefix-refused");
    const prefix = files.slice(0, existing.length);
    if (canonicalJsonStringify(existing.map(entry => ({ path: entry.file.path, digest: entry.file.digest, size: entry.file.size })))
      !== canonicalJsonStringify(prefix.map(entry => ({ path: entry.path, digest: entry.digest, size: entry.size })))) throw new Error("flat-archive-copy-prefix-refused");
  }
  for (const entry of files) {
    assertCurrent(); assertDestination();
    const bytes = file(flatArchiveMemberPath(workspace, source.sourceStateRoot, entry.path), existingDataFileLabel(entry.path)).bytes;
    if (bytes.byteLength !== entry.size || hash(bytes) !== entry.digest) throw new StorageBackupSourceChangedError();
    const target = join(copied, entry.path);
    noSymlinkAncestry(dirname(target), ancestors);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    noSymlinkAncestry(dirname(target), ancestors);
    if (lstatSync(target, { throwIfNoEntry: false }) === undefined) { writePrivateStage(target, bytes); fsyncPath(dirname(target)); }
    else if (hash(file(target).bytes) !== entry.digest) throw new Error("flat-archive-copy-changed");
    fsyncPath(target); assertDestination(); assertCurrent();
  }
  const directories = new Set([root, dirname(root), dirname(dirname(root))]);
  for (const entry of files) for (let path = dirname(join(copied, entry.path)); path.startsWith(`${root}/`); path = dirname(path)) directories.add(path);
  for (const path of [...directories].sort((a, b) => b.length - a.length)) fsyncPath(path);
  verifyCopies(root, files); assertCurrent();
}

export function retainedStorageBackup(workspace: string, installationId: string, reference?: Readonly<{ backupPath: string; backupDigest: string }>) {
  const root = join(workspace, ".tracker", "control", "storage-backups", installationId);
  if (lstatSync(dirname(root), { throwIfNoEntry: false }) === undefined) {
    if (reference !== undefined) throw new Error("storage-backup-required");
    return undefined;
  }
  noSymlinkAncestry(root, new Map());
  statDirectory(dirname(root), "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (canonicalJsonStringify(readdirSync(dirname(root))) !== canonicalJsonStringify([installationId])) throw new Error("storage-backup-membership-refused");
  const path = join(root, "backup.json"), bytes = file(path).bytes, backup = StorageBackupSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (backup.installationId !== installationId || backup.sourceStateRoot !== join(workspace, rebuildRuntimeIsolation.stateRoot)
    || reference !== undefined && (reference.backupPath !== path || reference.backupDigest !== hash(bytes))) throw new Error("storage-backup-binding-refused");
  const sourceBytes = file(join(root, "source.json")).bytes;
  if (hash(sourceBytes) !== backup.sourceDigest) throw new Error("storage-backup-source-changed");
  if (canonicalJsonStringify(readdirSync(root).sort()) !== canonicalJsonStringify(["backup.json", "files", "source.json"])) throw new Error("storage-backup-membership-refused");
  const source = SourceRecordSchema.parse(JSON.parse(sourceBytes.toString("utf8")));
  if (source.installationId !== installationId || source.operationId !== backup.operationId || source.sourceStateRoot !== backup.sourceStateRoot
    || canonicalJsonStringify(flatArchiveFiles(source)) !== canonicalJsonStringify(backup.files)) throw new Error("storage-backup-source-changed");
  verifyCopies(root, backup.files);
  return { backupPath: path, backupDigest: hash(bytes) };
}
