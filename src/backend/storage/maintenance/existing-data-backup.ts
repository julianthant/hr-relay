import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { RuntimeAdmission } from "../admission/admission.js";
import { ProfileSessionRefusedError } from "../../profiles/profile-errors.js";
import { readPrivateFile, writePrivateStage, fsyncPath, noSymlinkAncestry } from "../configuration/credential-safe-file.js";
import type { ExistingDataOwnerWitness } from "../configuration/credential-store.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const FileSchema = z.strictObject({ path: RelativePathSchema, digest: DigestSchema, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
const BackupSchema = z.strictObject({ schemaVersion: z.literal(1), claimId: z.uuid(), installationId: z.uuid(), profileId: z.uuid(),
  authorityManifest: z.string().min(1), authorityDigest: DigestSchema, files: z.array(FileSchema) });
type ClaimBackup = z.infer<typeof BackupSchema>;
export interface ExistingDataBackup { readonly claimId: string; readonly backupPath: string; readonly backupDigest: string; }
const issuedBackups = new WeakMap<ExistingDataBackup, { owner: ExistingDataOwnerWitness; machine: RuntimeAdmission; source: readonly { path: string; file: z.infer<typeof FileSchema> }[]; census(): unknown; verifyOwner(): void }>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 512 * 1024 * 1024;

function file(path: string) {
  noSymlinkAncestry(dirname(path), new Map());
  const value = readPrivateFile(path, { label: "lock", maxBytes });
  if (value === undefined) throw new Error("existing-data-backup-file-required");
  return value;
}

function inventory(root: string, prefix: string, excluded: ReadonlySet<string> = new Set()) {
  const result: Array<{ path: string; file: z.infer<typeof FileSchema> }> = [];
  const walk = (directory: string, relative: string) => {
    noSymlinkAncestry(directory, new Map());
    for (const name of readdirSync(directory).sort()) {
      const local = relative === "" ? name : `${relative}/${name}`;
      if (excluded.has(local)) continue;
      const path = join(directory, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, local);
      else {
        const current = file(path);
        result.push({ path, file: FileSchema.parse({ path: prefix === "" ? local : `${prefix}/${local}`, digest: hash(current.bytes), device: current.identity.device, inode: current.identity.inode }) });
      }
    }
  };
  walk(root, ""); return result;
}

export function verifyExistingDataBackupAtPath(machine: RuntimeAdmission, reference: ExistingDataBackup): ClaimBackup {
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  return verifyExistingDataBackupFiles(reference, context.workspace, machine.locator.installationId);
}

export function verifyExistingDataBackupFiles(reference: ExistingDataBackup, workspace: string, installationId: string): ClaimBackup {
  const root = join(workspace, ".tracker", "control", "profile-owner-claims", z.uuid().parse(reference.claimId));
  if (reference.backupPath !== join(root, "backup.json")) throw new Error("existing-data-backup-path-refused");
  const bytes = file(reference.backupPath).bytes;
  if (hash(bytes) !== reference.backupDigest) throw new Error("existing-data-backup-changed");
  const backup = BackupSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (backup.claimId !== reference.claimId || backup.installationId !== installationId
    || new Set(backup.files.map(entry => entry.path)).size !== backup.files.length) throw new Error("existing-data-backup-binding-refused");
  const copies = inventory(join(root, "files"), "").map(entry => ({ path: entry.file.path, digest: entry.file.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = backup.files.map(entry => ({ path: entry.path, digest: entry.digest })).sort((a, b) => a.path.localeCompare(b.path));
  if (canonicalJsonStringify(copies) !== canonicalJsonStringify(expected)) throw new Error("existing-data-backup-changed");
  const manifestRoot = join(workspace, rebuildRuntimeIsolation.stateRoot, "profiles", backup.profileId, "backups", "authority");
  if (dirname(backup.authorityManifest) !== manifestRoot
    || !/^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite\.manifest\.json$/u.test(basename(backup.authorityManifest))) throw new Error("existing-data-backup-path-refused");
  const authority = file(backup.authorityManifest);
  if (hash(authority.bytes) !== backup.authorityDigest) throw new Error("existing-data-backup-authority-changed");
  const manifest = AuthorityBackupManifestSchema.parse(JSON.parse(authority.bytes.toString("utf8")));
  if (backup.authorityManifest !== join(manifestRoot, `${manifest.backupFileName}.manifest.json`)
    || manifest.installationId !== backup.installationId || manifest.profileId !== backup.profileId
    || hash(file(join(dirname(backup.authorityManifest), manifest.backupFileName)).bytes) !== manifest.sha256) throw new Error("existing-data-backup-authority-changed");
  return backup;
}

export function assertNoRetainedOwnerClaimBackup(machine: RuntimeAdmission, profileId: string): void {
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const root = join(context.workspace, ".tracker", "control", "profile-owner-claims");
  if (lstatSync(root, { throwIfNoEntry: false }) === undefined) return;
  noSymlinkAncestry(root, new Map());
  for (const name of readdirSync(root)) {
    z.uuid().parse(name);
    const backup = BackupSchema.parse(JSON.parse(file(join(root, name, "backup.json")).bytes.toString("utf8")));
    if (backup.installationId !== machine.locator.installationId) throw new Error("existing-data-backup-binding-refused");
    if (backup.profileId === profileId) throw new ProfileSessionRefusedError("PROFILE_OWNER_CLAIM_BACKUP_RETAINED");
  }
}

export function verifyExistingDataBackup(reference: ExistingDataBackup, owner: ExistingDataOwnerWitness, machine: RuntimeAdmission) {
  const issued = issuedBackups.get(reference);
  if (issued === undefined || issued.owner !== owner || issued.machine !== machine) throw new Error("existing-data-backup-unissued");
  issued.verifyOwner();
  const backup = verifyExistingDataBackupAtPath(machine, reference);
  if (canonicalJsonStringify(issued.census()) !== canonicalJsonStringify(issued.source)) throw new Error("existing-data-backup-membership-changed");
  for (const entry of issued.source) {
    const current = file(entry.path);
    if (current.identity.device !== entry.file.device || current.identity.inode !== entry.file.inode || hash(current.bytes) !== entry.file.digest) throw new Error("existing-data-backup-source-changed");
  }
  return backup;
}

export async function backupExistingData(machine: RuntimeAdmission, admission: RuntimeAdmission, owner: ExistingDataOwnerWitness, claimId: string, clock: Clock): Promise<ExistingDataBackup> {
  const { verifyExistingDataOwner, profileAuthorityFileWitnesses } = await import("../configuration/credential-store.js");
  const { backupStoppedAuthority } = await import("./upgrade.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { assertCredentialCopyResourcesClosed } = await import("./profile-inventory.js");
  machine.assertExclusive(); admission.assertReadyStoppedProfileUpgradeOwner(machine);
  const ownership = verifyExistingDataOwner(owner, machine), context = machine.readInstallationContext();
  if (context === undefined || ownership.profileId !== admission.profileBinding.profileId) throw new Error("existing-data-backup-owner-refused");
  assertCredentialCopyResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(admission));
  const processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  const authorityDirectory = join(admission.stateRoot, "backups", "authority");
  const current = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
  let authorityManifest: string | undefined;
  if (lstatSync(authorityDirectory, { throwIfNoEntry: false }) !== undefined) {
    for (const name of readdirSync(authorityDirectory).sort()) {
      if (!name.endsWith(".manifest.json")) continue;
      const path = join(authorityDirectory, name), existing = verifyStoppedBackupManifestAtPath(admission, path,
        AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
      if (existing.manifest.authorityContentFingerprint === current.authorityContentFingerprint && existing.manifest.authorityGeneration === current.authorityGeneration) authorityManifest = path;
    }
  }
  if (authorityManifest === undefined) {
    const backed = await backupStoppedAuthority(admission, admission.stateRoot, clock, processLockRoot, machine.maintenanceRestore());
    if (backed.manifests.length !== 1 || backed.manifests[0] === undefined) throw new Error("existing-data-backup-single-authority-required");
    authorityManifest = join(authorityDirectory, `${backed.manifests[0].backupFileName}.manifest.json`);
  }
  verifyStoppedBackupManifestAtPath(admission, authorityManifest, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
  const afterBackup = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
  if (afterBackup.authorityContentFingerprint !== current.authorityContentFingerprint || afterBackup.authorityGeneration !== current.authorityGeneration) throw new Error("existing-data-backup-source-changed");
  const controlRoot = join(context.workspace, ".tracker", "control");
  const profileRoot = admission.stateRoot;
  const databases = canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot));
  const census = () => [
    ...inventory(profileRoot, "profile", new Set(["state.db", "state.db-wal", "state.db-shm", "state.db-journal"])),
    ...inventory(join(machine.stateRoot, "machine"), "machine"),
    ...inventory(controlRoot, "control", new Set(["leases", "admission-mutex", "profile-owner-claims"])),
  ];
  const source = census();
  const root = join(controlRoot, "profile-owner-claims", z.uuid().parse(claimId));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  noSymlinkAncestry(root, new Map());
  for (const entry of source) {
    const bytes = file(entry.path).bytes;
    if (hash(bytes) !== entry.file.digest) throw new Error("existing-data-backup-source-changed");
    const target = join(root, "files", entry.file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (lstatSync(target, { throwIfNoEntry: false }) === undefined) { writePrivateStage(target, bytes); fsyncPath(dirname(target)); }
    else {
      if (hash(file(target).bytes) !== entry.file.digest) throw new Error("existing-data-backup-copy-changed");
      fsyncPath(target);
    }
  }
  const directories = new Set([root, dirname(root), controlRoot]);
  for (const entry of source) {
    for (let directory = dirname(join(root, "files", entry.file.path)); directory.startsWith(`${root}/`); directory = dirname(directory)) directories.add(directory);
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) fsyncPath(directory);
  const backup = BackupSchema.parse({ schemaVersion: 1, claimId, installationId: machine.locator.installationId,
    profileId: admission.profileBinding.profileId, authorityManifest, authorityDigest: hash(file(authorityManifest).bytes), files: source.map(entry => entry.file) });
  const bytes = Buffer.from(canonicalJsonStringify(backup)), backupPath = join(root, "backup.json");
  if (lstatSync(backupPath, { throwIfNoEntry: false }) === undefined) { writePrivateStage(backupPath, bytes); fsyncPath(root); fsyncPath(dirname(root)); }
  else if (hash(file(backupPath).bytes) !== hash(bytes)) throw new Error("existing-data-backup-copy-changed");
  const reference = Object.freeze({ claimId, backupPath, backupDigest: hash(bytes) });
  issuedBackups.set(reference, { owner, machine, source, census, verifyOwner: () => {
    verifyExistingDataOwner(owner, machine);
    if (canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot)) !== databases) throw new Error("existing-data-backup-source-changed");
  } });
  verifyExistingDataBackup(reference, owner, machine);
  assertCredentialCopyResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(admission));
  return reference;
}
