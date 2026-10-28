import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { ExistingDataOwnerWitness } from "../configuration/credential-store.js";
import type { SignUpOperation } from "../../../models/profiles/profile.js";
import { readPrivateFile, noSymlinkAncestry, statDirectory, unpublishedDraftAbortMembership } from "../configuration/credential-safe-file.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const FileSchema = z.strictObject({ path: RelativePathSchema, digest: DigestSchema, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
export const SourceRecordSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), sourceStateRoot: z.string().min(1),
  sourceFingerprint: DigestSchema, sourceGeneration: z.number().int().safe().nonnegative(),
  databases: z.array(z.strictObject({ suffix: z.enum(["", "-wal", "-shm", "-journal"]), file: FileSchema.omit({ path: true }).optional(), mode: z.number().int().nonnegative().optional() })),
  files: z.array(FileSchema.extend({ mode: z.number().int().nonnegative() })) });
const StorageBackupReferenceSchema = z.strictObject({ backupPath: z.string().min(1), backupDigest: DigestSchema });
const CoupledBackupSchema = z.strictObject({ authorityManifest: z.string().min(1), authorityDigest: DigestSchema, files: z.array(FileSchema) });
export const StorageBackupSchema = CoupledBackupSchema.extend({ schemaVersion: z.literal(1), installationId: z.uuid(), sourceStateRoot: z.string().min(1), sourceDigest: DigestSchema });
export const BackupSchema = CoupledBackupSchema.extend({ schemaVersion: z.literal(1), claimId: z.uuid(), installationId: z.uuid(), profileId: z.uuid(),
  storageBackup: StorageBackupReferenceSchema.optional(), sourceDigest: DigestSchema, sourceStateRoot: z.string().min(1).optional() });
const BackupIntentSchema = z.strictObject({ schemaVersion: z.literal(1), claimId: z.uuid(), installationId: z.uuid(), profileId: z.uuid(),
  credentialFile: FileSchema.omit({ path: true }), keyFile: FileSchema.omit({ path: true }).optional(), sourceStateRoot: z.string().min(1).optional(),
  sourceFingerprint: DigestSchema, sourceGeneration: z.number().int().safe().nonnegative(), registryDigest: DigestSchema.optional() }).refine(value => value.sourceStateRoot === undefined
    ? value.keyFile !== undefined && value.registryDigest !== undefined : value.keyFile === undefined && value.registryDigest === undefined,
  "existing-data-backup-source-shape-refused");
type ClaimBackup = z.infer<typeof BackupSchema>;
export type ExistingDataBackup = NonNullable<SignUpOperation["ownerClaim"]>;
type IssuedBackup = { owner: ExistingDataOwnerWitness; machine: RuntimeAdmission; source: readonly { path: string; file: z.infer<typeof FileSchema> }[]; census(): unknown; verifyOwner(): void };
const issuedBackups = new WeakMap<ExistingDataBackup, IssuedBackup>();
export const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 512 * 1024 * 1024;

export function existingDataFileLabel(inventoryPath: string): "lock" | "authority database" | "managed data" {
  if (/^profile\/state\.db(?:-wal|-shm|-journal)?$/u.test(inventoryPath)) return "authority database";
  if (/^profile\/(?:browsers|artifacts|logs|scratch|files\/(?:reports|downloads|onboarding))\/(?!\.runtime-owner\.json$)/u.test(inventoryPath)
    || /^workspace-data\/(?:reports|downloads|onboarding)\//u.test(inventoryPath)) return "managed data";
  return "lock";
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

export function verifyExistingDataBackupFiles(reference: ExistingDataBackup, workspace: string, installationId: string): ClaimBackup {
  const root = join(workspace, ".tracker", "control", "profile-owner-claims", z.uuid().parse(reference.claimId));
  if (reference.backupPath !== join(root, "backup.json")) throw new Error("existing-data-backup-path-refused");
  const bytes = file(reference.backupPath).bytes;
  if (hash(bytes) !== reference.backupDigest) throw new Error("existing-data-backup-changed");
  const backup = BackupSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (backup.claimId !== reference.claimId || backup.installationId !== installationId
    || new Set(backup.files.map(entry => entry.path)).size !== backup.files.length) throw new Error("existing-data-backup-binding-refused");
  verifyCopies(root, backup.files);
  if (hash(file(join(root, "source.json")).bytes) !== backup.sourceDigest) throw new Error("existing-data-backup-source-changed");
  const machineRoot = join(workspace, rebuildRuntimeIsolation.stateRoot);
  if (backup.sourceStateRoot !== undefined && backup.sourceStateRoot !== machineRoot) throw new Error("existing-data-backup-path-refused");
  const manifestRoot = join(backup.sourceStateRoot ?? join(machineRoot, "profiles", backup.profileId), "backups", "authority");
  if (dirname(backup.authorityManifest) !== manifestRoot
    || !/^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite\.manifest\.json$/u.test(basename(backup.authorityManifest))) throw new Error("existing-data-backup-path-refused");
  const relocatedManifest = join(machineRoot, "profiles", backup.profileId, "backups", "authority", basename(backup.authorityManifest));
  const authorityPath = backup.sourceStateRoot !== undefined && lstatSync(backup.authorityManifest, { throwIfNoEntry: false }) === undefined
    ? relocatedManifest : backup.authorityManifest;
  const authority = file(authorityPath);
  if (hash(authority.bytes) !== backup.authorityDigest) throw new Error("existing-data-backup-authority-changed");
  const manifest = AuthorityBackupManifestSchema.parse(JSON.parse(authority.bytes.toString("utf8")));
  if (backup.authorityManifest !== join(manifestRoot, `${manifest.backupFileName}.manifest.json`)
    || (backup.sourceStateRoot === undefined ? manifest.installationId !== backup.installationId || manifest.profileId !== backup.profileId
      : manifest.schemaVersion !== 6 || manifest.installationId !== undefined || manifest.profileId !== undefined)
    || hash(file(join(dirname(authorityPath), manifest.backupFileName)).bytes) !== manifest.sha256) throw new Error("existing-data-backup-authority-changed");
  return backup;
}

export function claimIntent(root: string, name: string) {
  const path = join(root, z.uuid().parse(name));
  noSymlinkAncestry(path, new Map());
  const info = lstatSync(path);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("existing-data-backup-allocation-unsafe");
  const intent = readPrivateFile(join(path, "intent.json"), { label: "lock", maxBytes: 16 * 1024 });
  if (intent === undefined) {
    if (readdirSync(path).length === 0) return undefined;
    throw new Error("existing-data-backup-intent-required");
  }
  return BackupIntentSchema.parse(JSON.parse(intent.bytes.toString("utf8")));
}

export function verifyExistingDataBackup(reference: ExistingDataBackup, owner: ExistingDataOwnerWitness, machine: RuntimeAdmission) {
  const issued = issuedBackups.get(reference);
  if (issued === undefined || issued.owner !== owner || issued.machine !== machine) throw new Error("existing-data-backup-unissued");
  issued.verifyOwner();
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const backup = verifyExistingDataBackupFiles(reference, context.workspace, machine.locator.installationId);
  if (canonicalJsonStringify(issued.census()) !== canonicalJsonStringify(issued.source)) throw new Error("existing-data-backup-membership-changed");
  for (const entry of issued.source) {
    const current = file(entry.path, existingDataFileLabel(entry.file.path));
    if (current.identity.device !== entry.file.device || current.identity.inode !== entry.file.inode || hash(current.bytes) !== entry.file.digest) throw new Error("existing-data-backup-source-changed");
  }
  return backup;
}

export function verifyCopies(root: string, files: readonly z.infer<typeof FileSchema>[]) {
  const directories = new Set([""]);
  for (const entry of files) for (let path = dirname(entry.path); path !== "."; path = dirname(path)) directories.add(path);
  if (unpublishedDraftAbortMembership(join(root, "files")).some(entry => entry.directory && !directories.has(entry.path))) throw new Error("existing-data-backup-membership-changed");
  const actual = inventory(join(root, "files"), "").map(entry => ({ path: entry.file.path, digest: entry.file.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = files.map(entry => ({ path: entry.path, digest: entry.digest })).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map(entry => entry.path)).size !== files.length || canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) throw new Error("existing-data-backup-changed");
}

export function retainedStorageBackup(workspace: string, installationId: string, reference?: z.infer<typeof StorageBackupReferenceSchema>) {
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
  const manifestBytes = file(copiedManifest).bytes, manifest = AuthorityBackupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.schemaVersion !== 6 || manifest.installationId !== undefined || manifest.profileId !== undefined
    || manifest.authorityContentFingerprint !== source.sourceFingerprint || manifest.authorityGeneration !== source.sourceGeneration
    || basename(backup.authorityManifest) !== `${manifest.backupFileName}.manifest.json` || hash(manifestBytes) !== backup.authorityDigest
    || hash(file(join(dirname(copiedManifest), manifest.backupFileName)).bytes) !== manifest.sha256) throw new Error("storage-backup-authority-refused");
  return { backupPath: path, backupDigest: hash(bytes) };
}


export function issueExistingDataBackup(reference: ExistingDataBackup, issued: IssuedBackup): ExistingDataBackup {
  Object.freeze(reference);
  issuedBackups.set(reference, issued);
  verifyExistingDataBackup(reference, issued.owner, issued.machine);
  return reference;
}
