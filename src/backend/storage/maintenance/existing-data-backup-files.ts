import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { readPrivateFile, noSymlinkAncestry, statDirectory, unpublishedDraftAbortMembership } from "../configuration/credential-safe-file.js";
import { UnboundPredecessorBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const FileSchema = z.strictObject({ path: RelativePathSchema, digest: DigestSchema, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
export const SourceRecordSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), sourceStateRoot: z.string().min(1),
  sourceFingerprint: DigestSchema, sourceGeneration: z.number().int().safe().nonnegative(),
  databases: z.array(z.strictObject({ suffix: z.enum(["", "-wal", "-shm", "-journal"]), file: FileSchema.omit({ path: true }).optional(), mode: z.number().int().nonnegative().optional() })),
  files: z.array(FileSchema.extend({ mode: z.number().int().nonnegative() })) });
const CoupledBackupSchema = z.strictObject({ authorityManifest: z.string().min(1), authorityDigest: DigestSchema, files: z.array(FileSchema) });
export const StorageBackupSchema = CoupledBackupSchema.extend({ schemaVersion: z.literal(1), installationId: z.uuid(), sourceStateRoot: z.string().min(1), sourceDigest: DigestSchema });
export const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 512 * 1024 * 1024;

export function existingDataFileLabel(inventoryPath: string): "lock" | "authority database" | "managed data" {
  if (/^profile\/state\.db(?:-wal|-shm|-journal)?$/u.test(inventoryPath)) return "authority database";
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
  const walk = (directory: string, relative: string) => {
    noSymlinkAncestry(directory, new Map());
    if (prefix === "") statDirectory(directory, "backup copy", 0o700);
    for (const name of readdirSync(directory).sort()) {
      const local = relative === "" ? name : `${relative}/${name}`;
      if (excluded.has(local)) continue;
      const path = join(directory, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, local);
      else {
        const inventoryPath = prefix === "" ? local : `${prefix}/${local}`;
        const current = file(path, prefix === "" ? "lock" : existingDataFileLabel(inventoryPath));
        result.push({ path, file: FileSchema.parse({ path: inventoryPath, digest: hash(current.bytes), device: current.identity.device, inode: current.identity.inode }) });
      }
    }
  };
  walk(root, ""); return result;
}

export function verifyCopies(root: string, files: readonly z.infer<typeof FileSchema>[]) {
  const directories = new Set([""]);
  for (const entry of files) for (let path = dirname(entry.path); path !== "."; path = dirname(path)) directories.add(path);
  if (unpublishedDraftAbortMembership(join(root, "files")).some(entry => entry.directory && !directories.has(entry.path))) throw new Error("existing-data-backup-membership-changed");
  const actual = inventory(join(root, "files"), "").map(entry => ({ path: entry.file.path, digest: entry.file.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = files.map(entry => ({ path: entry.path, digest: entry.digest })).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map(entry => entry.path)).size !== files.length || canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) throw new Error("existing-data-backup-changed");
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
  const path = join(root, "backup.json"), bytes = file(path).bytes;
  const backup = StorageBackupSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (backup.installationId !== installationId || backup.sourceStateRoot !== join(workspace, rebuildRuntimeIsolation.stateRoot)
    || reference !== undefined && (reference.backupPath !== path || reference.backupDigest !== hash(bytes))) throw new Error("storage-backup-binding-refused");
  if (hash(file(join(root, "source.json")).bytes) !== backup.sourceDigest) throw new Error("storage-backup-source-changed");
  if (canonicalJsonStringify(readdirSync(root).sort()) !== canonicalJsonStringify(["backup.json", "files", "source.json"])) throw new Error("storage-backup-membership-refused");
  const source = SourceRecordSchema.parse(JSON.parse(file(join(root, "source.json")).bytes.toString("utf8")));
  if (source.installationId !== installationId || source.sourceStateRoot !== backup.sourceStateRoot
    || canonicalJsonStringify(source.files.map(({ mode: _mode, ...entry }) => entry)) !== canonicalJsonStringify(backup.files)) throw new Error("storage-backup-source-changed");
  verifyCopies(root, backup.files);
  const authorityDirectory = join(backup.sourceStateRoot, "backups", "authority");
  if (dirname(backup.authorityManifest) !== authorityDirectory) throw new Error("storage-backup-authority-refused");
  const copiedManifest = join(root, "files", "profile", "backups", "authority", basename(backup.authorityManifest));
  const manifestBytes = file(copiedManifest).bytes, manifest = UnboundPredecessorBackupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.schemaVersion !== 6 || manifest.installationId !== undefined || manifest.profileId !== undefined
    || manifest.authorityContentFingerprint !== source.sourceFingerprint || manifest.authorityGeneration !== source.sourceGeneration
    || basename(backup.authorityManifest) !== `${manifest.backupFileName}.manifest.json` || hash(manifestBytes) !== backup.authorityDigest
    || hash(file(join(dirname(copiedManifest), manifest.backupFileName)).bytes) !== manifest.sha256) throw new Error("storage-backup-authority-refused");
  return { backupPath: path, backupDigest: hash(bytes) };
}
