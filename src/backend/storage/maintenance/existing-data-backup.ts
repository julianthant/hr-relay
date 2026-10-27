import { decodeStoredArtifact } from "../artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { verifyFlatBackupRecoveryManifest } from "../sqlite/backup-service.js";
import { observeRuntimeLockSnapshot, inspectRuntimeProcessOrphans, assertRuntimeRestoreAdmission, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";
import { enumerateFlatBackupRecoveryMembership, assertCredentialCopyResourcesClosed } from "./profile-inventory.js";
import { profileAuthorityFileWitnesses, unpublishedDraftAbortMembership } from "../configuration/credential-store.js";
import { FlatBackupRecoveryBindingSchema, MutexRecoveryReceiptSchema, MutexOwnerSchema, type RuntimeLocator } from "../admission/installation.js";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { RuntimeAdmission } from "../admission/admission.js";
import { readPrivateFile, writePrivateStage, fsyncPath, noSymlinkAncestry, statDirectory } from "../configuration/credential-safe-file.js";
import type { ExistingDataOwnerWitness } from "../configuration/credential-store.js";
import type { SignUpOperation } from "../../../models/profiles/profile.js";
import { FlatProfileClaimReceiptSchema } from "./flat-profile-claim.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const FileSchema = z.strictObject({ path: RelativePathSchema, digest: DigestSchema, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
const SourceRecordSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), sourceStateRoot: z.string().min(1),
  sourceFingerprint: DigestSchema, sourceGeneration: z.number().int().safe().nonnegative(),
  databases: z.array(z.strictObject({ suffix: z.enum(["", "-wal", "-shm", "-journal"]), file: FileSchema.omit({ path: true }).optional(), mode: z.number().int().nonnegative().optional() })),
  files: z.array(FileSchema.extend({ mode: z.number().int().nonnegative() })) });
const StorageBackupReferenceSchema = z.strictObject({ backupPath: z.string().min(1), backupDigest: DigestSchema });
const CoupledBackupSchema = z.strictObject({ authorityManifest: z.string().min(1), authorityDigest: DigestSchema, files: z.array(FileSchema) });
const StorageBackupSchema = CoupledBackupSchema.extend({ schemaVersion: z.literal(1), installationId: z.uuid(), sourceStateRoot: z.string().min(1), sourceDigest: DigestSchema });
const BackupSchema = CoupledBackupSchema.extend({ schemaVersion: z.literal(1), claimId: z.uuid(), installationId: z.uuid(), profileId: z.uuid(),
  storageBackup: StorageBackupReferenceSchema.optional(), sourceDigest: DigestSchema, sourceStateRoot: z.string().min(1).optional() });
const BackupIntentSchema = z.strictObject({ schemaVersion: z.literal(1), claimId: z.uuid(), installationId: z.uuid(), profileId: z.uuid(),
  credentialFile: FileSchema.omit({ path: true }), keyFile: FileSchema.omit({ path: true }).optional(), sourceStateRoot: z.string().min(1).optional(),
  sourceFingerprint: DigestSchema, sourceGeneration: z.number().int().safe().nonnegative(), registryDigest: DigestSchema.optional() }).refine(value => value.sourceStateRoot === undefined
    ? value.keyFile !== undefined && value.registryDigest !== undefined : value.keyFile === undefined && value.registryDigest === undefined,
  "existing-data-backup-source-shape-refused");
type ClaimBackup = z.infer<typeof BackupSchema>;
export type ExistingDataBackup = NonNullable<SignUpOperation["ownerClaim"]>;
const issuedBackups = new WeakMap<ExistingDataBackup, { owner: ExistingDataOwnerWitness; machine: RuntimeAdmission; source: readonly { path: string; file: z.infer<typeof FileSchema> }[]; census(): unknown; verifyOwner(): void }>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 512 * 1024 * 1024;

export function existingDataFileLabel(inventoryPath: string): "lock" | "authority database" | "managed data" {
  if (/^profile\/state\.db(?:-wal|-shm|-journal)?$/u.test(inventoryPath)) return "authority database";
  if (/^profile\/(?:browsers|artifacts|logs|scratch|files\/(?:reports|downloads|onboarding))\/(?!\.runtime-owner\.json$)/u.test(inventoryPath)
    || /^workspace-data\/(?:reports|downloads|onboarding)\//u.test(inventoryPath)) return "managed data";
  return "lock";
}

function file(path: string, label: "lock" | "authority database" | "managed data" = "lock") {
  noSymlinkAncestry(dirname(path), new Map());
  const value = readPrivateFile(path, { label, maxBytes });
  if (value === undefined) throw new Error("existing-data-backup-file-required");
  return value;
}

function inventory(root: string, prefix: string, excluded: ReadonlySet<string> = new Set()) {
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

function claimIntent(root: string, name: string) {
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

export function ownerClaimRecoveryCopies(machine: RuntimeAdmission, profileId: string, scope: "all" | "flat" = "all"): readonly string[] {
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const root = join(context.workspace, ".tracker", "control", "profile-owner-claims");
  if (lstatSync(root, { throwIfNoEntry: false }) === undefined) return [];
  noSymlinkAncestry(root, new Map());
  const copies: string[] = [];
  for (const name of readdirSync(root)) {
    z.uuid().parse(name);
    const path = join(root, name), intent = claimIntent(root, name);
    if (intent === undefined) continue;
    if (intent.claimId !== name || intent.installationId !== machine.locator.installationId) throw new Error("existing-data-backup-binding-refused");
    if (intent.profileId === profileId && (scope === "all" || intent.sourceStateRoot !== undefined)) copies.push(path);
  }
  if (scope === "all") {
    for (const path of [...copies]) {
      const backup = BackupSchema.parse(JSON.parse(file(join(path, "backup.json")).bytes.toString("utf8")));
      if (backup.storageBackup === undefined) continue;
      const reference = { claimId: backup.claimId, backupPath: join(path, "backup.json"), backupDigest: hash(file(join(path, "backup.json")).bytes) };
      const receipt = FlatProfileClaimReceiptSchema.parse(JSON.parse(file(join(path, "flat.json")).bytes.toString("utf8")));
      if (receipt.installationId !== machine.locator.installationId || receipt.profileId !== profileId
        || receipt.sourceStateRoot !== backup.sourceStateRoot || receipt.operation.profileId !== profileId || canonicalJsonStringify(receipt.operation.ownerClaim) !== canonicalJsonStringify(reference)) throw new Error("storage-backup-claim-binding-refused");
      const retained = retainedStorageBackup(machine, backup.storageBackup);
      if (retained === undefined) throw new Error("storage-backup-required");
      copies.push(dirname(retained.backupPath));
    }
  }
  return copies;
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

export async function backupExistingData(machine: RuntimeAdmission, admission: RuntimeAdmission, owner: ExistingDataOwnerWitness, claimId: string, clock: Clock): Promise<ExistingDataBackup> {
  const { verifyExistingDataOwner, profileAuthorityFileWitnesses } = await import("../configuration/credential-store.js");
  machine.assertExclusive(); admission.assertReadyStoppedProfileUpgradeOwner(machine);
  const ownership = verifyExistingDataOwner(owner, machine), context = machine.readInstallationContext();
  if (context === undefined || ownership.profileId !== undefined && ownership.profileId !== admission.profileBinding.profileId) throw new Error("existing-data-backup-owner-refused");
  const { current } = await inspectCoupledBackupSource(admission, ownership.profileId === undefined, clock);
  const controlRoot = join(context.workspace, ".tracker", "control"), claimsRoot = join(controlRoot, "profile-owner-claims");
  const flat = ownership.profileId === undefined;
  if (!flat && ownership.key === undefined) throw new Error("existing-data-backup-key-required");
  let intentSource = { schemaVersion: 1 as const, installationId: machine.locator.installationId, profileId: admission.profileBinding.profileId,
    credentialFile: ownership.file, ...(flat ? { sourceStateRoot: admission.stateRoot } : { keyFile: ownership.key?.file }), sourceFingerprint: current.authorityContentFingerprint,
    sourceGeneration: current.authorityGeneration, ...(flat ? {} : { registryDigest: hash(Buffer.from(canonicalJsonStringify(machine.readProfileRegistry()))) }) };
  let canonicalClaimId = z.uuid().parse(claimId).toLowerCase();
  if (lstatSync(claimsRoot, { throwIfNoEntry: false }) !== undefined) {
    noSymlinkAncestry(claimsRoot, new Map());
    const matching = readdirSync(claimsRoot).flatMap(name => {
      z.uuid().parse(name);
      const intent = claimIntent(claimsRoot, name);
      if (intent === undefined) return [];
      if (intent.claimId !== name || intent.installationId !== machine.locator.installationId) throw new Error("existing-data-backup-intent-refused");
      return [intent];
    }).filter(intent => flat ? intent.sourceStateRoot === admission.stateRoot : intent.profileId === intentSource.profileId);
    if (matching.length > 1) throw new Error("existing-data-backup-intent-ambiguous");
    const pending = matching[0];
    if (pending !== undefined) {
      if (flat) intentSource = { ...intentSource, profileId: pending.profileId };
      if (canonicalJsonStringify(pending) !== canonicalJsonStringify({ ...intentSource, claimId: pending.claimId })) throw new Error("existing-data-backup-source-changed");
      canonicalClaimId = pending.claimId;
    }
  }
  const root = join(claimsRoot, canonicalClaimId), intentPath = join(root, "intent.json");
  mkdirSync(root, { recursive: true, mode: 0o700 }); noSymlinkAncestry(root, new Map());
  if (lstatSync(intentPath, { throwIfNoEntry: false }) === undefined) writePrivateStage(intentPath, Buffer.from(canonicalJsonStringify({ ...intentSource, claimId: canonicalClaimId })));
  fsyncPath(root); fsyncPath(claimsRoot); fsyncPath(controlRoot);
  const coupled = await writeCoupledBackup(machine, admission, root, flat, clock);
  const { authorityManifest, source, census, databases } = coupled;
  const profileRoot = admission.stateRoot;
  const backup = BackupSchema.parse({ schemaVersion: 1, claimId: canonicalClaimId, installationId: machine.locator.installationId,
    profileId: intentSource.profileId, ...(flat ? { sourceStateRoot: admission.stateRoot } : {}), authorityManifest, authorityDigest: coupled.authorityDigest, sourceDigest: coupled.sourceDigest,
    ...(!flat || coupled.storageBackup === undefined ? {} : { storageBackup: coupled.storageBackup }), files: coupled.files });
  const bytes = Buffer.from(canonicalJsonStringify(backup)), backupPath = join(root, "backup.json");
  if (lstatSync(backupPath, { throwIfNoEntry: false }) === undefined) { writePrivateStage(backupPath, bytes); fsyncPath(root); fsyncPath(dirname(root)); }
  else if (hash(file(backupPath).bytes) !== hash(bytes)) throw new Error("existing-data-backup-copy-changed");
  const reference = Object.freeze({ claimId: canonicalClaimId, backupPath, backupDigest: hash(bytes) });
  issuedBackups.set(reference, { owner, machine, source, census, verifyOwner: () => {
    verifyExistingDataOwner(owner, machine); coupled.verifySource();
    if (canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot)) !== databases) throw new Error("existing-data-backup-source-changed");
  } });
  verifyExistingDataBackup(reference, owner, machine);
  return reference;
}

function verifyCopies(root: string, files: readonly z.infer<typeof FileSchema>[]) {
  const actual = inventory(join(root, "files"), "").map(entry => ({ path: entry.file.path, digest: entry.file.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = files.map(entry => ({ path: entry.path, digest: entry.digest })).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map(entry => entry.path)).size !== files.length || canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) throw new Error("existing-data-backup-changed");
}

async function inspectCoupledBackupSource(admission: RuntimeAdmission, flat: boolean, clock: Clock) {
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { assertCredentialCopyResourcesClosed, enumerateProfileCredentialMembership } = await import("./profile-inventory.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  const sourceFacts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
  assertCredentialCopyResourcesClosed(sourceFacts);
  if (flat && sourceFacts.slots.some(slot => slot.retiredAt === null)) throw new Error("existing-data-flat-worker-custody-unsupported");
  {
    const settings = sourceFacts.settingsAuthority.state === "initialized"
      ? sourceFacts.settingsAuthority.record.saved?.settings ?? sourceFacts.settingsAuthority.record.initialization.settings.settings : undefined;
    const membership = enumerateProfileCredentialMembership(admission, sourceFacts, settings?.paths?.browserProfileRoot ?? join(admission.stateRoot, "browsers"));
    const backups = membership.manifests.map(path => verifyStoppedBackupManifestAtPath(admission, path, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))));
    if (backups.length !== membership.backupPaths.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("existing-data-backup-source-membership-unproved");
    assertCoupledArtifacts(admission.artifactRoot, sourceFacts.artifactReferences);
  }
  const current = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
  if (flat) {
    if (admission.stateRoot !== join(context.workspace, rebuildRuntimeIsolation.stateRoot) || admission.artifactRoot !== join(admission.stateRoot, "artifacts")) throw new Error("flat-backup-source-refused");
    assertFlatBackupFacts(context.workspace, admission.stateRoot, admission.artifactRoot, sourceFacts);
  }
  return { current, processLockRoot };
}

async function writeCoupledBackup(machine: RuntimeAdmission, admission: RuntimeAdmission, root: string, flat: boolean, clock: Clock) {
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { backupStoppedAuthority } = await import("./upgrade.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const { profileAuthorityFileWitnesses } = await import("../configuration/credential-store.js");
  const { assertCredentialCopyResourcesClosed } = await import("./profile-inventory.js");
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const { current, processLockRoot } = await inspectCoupledBackupSource(admission, flat, clock);
  const authorityDirectory = join(admission.stateRoot, "backups", "authority"), controlRoot = join(context.workspace, ".tracker", "control");
  const sourcePath = join(root, "source.json");
  if (lstatSync(sourcePath, { throwIfNoEntry: false }) !== undefined) {
    const prior = SourceRecordSchema.parse(JSON.parse(file(sourcePath).bytes.toString("utf8")));
    if (prior.installationId !== machine.locator.installationId || prior.sourceStateRoot !== admission.stateRoot
      || prior.sourceFingerprint !== current.authorityContentFingerprint || prior.sourceGeneration !== current.authorityGeneration) throw new Error("existing-data-backup-source-changed");
  }
  const storageRoot = join(controlRoot, "storage-backups", machine.locator.installationId);
  const storageBackup = root === storageRoot ? undefined : retainedStorageBackup(machine);
  if (flat && storageBackup !== undefined) {
    const retained = StorageBackupSchema.parse(JSON.parse(file(storageBackup.backupPath).bytes.toString("utf8")));
    verifyStoppedBackupManifestAtPath(admission, retained.authorityManifest, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
    if (hash(file(retained.authorityManifest).bytes) !== retained.authorityDigest) throw new Error("storage-backup-authority-refused");
  }
  const profileRoot = admission.stateRoot;
  const databases = canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot));
  const recoveryHistory = root === storageRoot ? flatBackupRecoveryHistory(root, machine.locator.installationId, machine.locator.generation) : undefined;
  const census = () => {
    if (recoveryHistory !== undefined && flatBackupRecoveryHistory(root, machine.locator.installationId, machine.locator.generation).observation !== recoveryHistory.observation) throw new Error("flat-backup-recovery-history-changed");
    return coupledBackupCensus(context.workspace, admission.stateRoot, machine.stateRoot, flat,
      root === storageRoot || storageBackup !== undefined ? machine.locator.installationId : undefined, undefined, recoveryHistory?.excluded);
  };
  census();
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
    const backed = await backupStoppedAuthority(admission, admission.stateRoot, clock, processLockRoot, admission.maintenanceRestore() ?? machine.maintenanceRestore());
    if (backed.manifests.length !== 1 || backed.manifests[0] === undefined) throw new Error("existing-data-backup-single-authority-required");
    authorityManifest = join(authorityDirectory, `${backed.manifests[0].backupFileName}.manifest.json`);
  }
  verifyStoppedBackupManifestAtPath(admission, authorityManifest, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
  const afterBackup = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
  if (afterBackup.authorityContentFingerprint !== current.authorityContentFingerprint || afterBackup.authorityGeneration !== current.authorityGeneration) throw new Error("existing-data-backup-source-changed");
  const source = census();
  const sourceRecordBytes = () => coupledSourceRecord(machine.locator.installationId, admission.stateRoot, current, census);
  const sourceRecord = sourceRecordBytes();
  const verifySource = () => { if (!sourceRecordBytes().equals(sourceRecord)) throw new Error("existing-data-backup-source-changed"); };
  if (lstatSync(sourcePath, { throwIfNoEntry: false }) === undefined) {
    if (lstatSync(join(root, "files"), { throwIfNoEntry: false }) !== undefined || lstatSync(join(root, "backup.json"), { throwIfNoEntry: false }) !== undefined) throw new Error("existing-data-backup-source-required");
    writePrivateStage(sourcePath, sourceRecord); fsyncPath(root);
  } else if (!file(sourcePath).bytes.equals(sourceRecord)) throw new Error("existing-data-backup-source-changed");
  for (const entry of source) {
    const bytes = file(entry.path, existingDataFileLabel(entry.file.path)).bytes;
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
  verifyCopies(root, source.map(entry => entry.file));
  if (canonicalJsonStringify(census()) !== canonicalJsonStringify(source)
    || canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot)) !== databases) throw new Error("existing-data-backup-source-changed");
  verifySource(); admission.assertLive();
  assertCredentialCopyResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(admission));
  return { authorityManifest, authorityDigest: hash(file(authorityManifest).bytes), files: source.map(entry => entry.file),
    sourceDigest: hash(sourceRecord), source, census, databases, storageBackup, verifySource };
}

function storageBackupRoot(machine: RuntimeAdmission): string {
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  return join(context.workspace, ".tracker", "control", "storage-backups", machine.locator.installationId);
}

function retainedStorageBackup(machine: RuntimeAdmission, reference?: z.infer<typeof StorageBackupReferenceSchema>) {
  const root = storageBackupRoot(machine);
  if (lstatSync(dirname(root), { throwIfNoEntry: false }) === undefined) {
    if (reference !== undefined) throw new Error("storage-backup-required");
    return undefined;
  }
  noSymlinkAncestry(root, new Map());
  statDirectory(dirname(root), "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (canonicalJsonStringify(readdirSync(dirname(root))) !== canonicalJsonStringify([machine.locator.installationId])) throw new Error("storage-backup-membership-refused");
  const path = join(root, "backup.json"), bytes = file(path).bytes;
  const backup = StorageBackupSchema.parse(JSON.parse(bytes.toString("utf8")));
  const context = machine.readInstallationContext();
  if (context === undefined || backup.installationId !== machine.locator.installationId || backup.sourceStateRoot !== join(context.workspace, rebuildRuntimeIsolation.stateRoot)
    || reference !== undefined && (reference.backupPath !== path || reference.backupDigest !== hash(bytes))) throw new Error("storage-backup-binding-refused");
  if (hash(file(join(root, "source.json")).bytes) !== backup.sourceDigest) throw new Error("storage-backup-source-changed");
  if (canonicalJsonStringify(readdirSync(root).sort()) !== canonicalJsonStringify(["backup.json", "files", "source.json"])) throw new Error("storage-backup-membership-refused");
  verifyCopies(root, backup.files);
  const authorityDirectory = join(backup.sourceStateRoot, "backups", "authority");
  if (dirname(backup.authorityManifest) !== authorityDirectory) throw new Error("storage-backup-authority-refused");
  const copiedManifest = join(root, "files", "profile", "backups", "authority", basename(backup.authorityManifest));
  const manifestBytes = file(copiedManifest).bytes, manifest = AuthorityBackupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.schemaVersion !== 6 || manifest.installationId !== undefined || manifest.profileId !== undefined
    || basename(backup.authorityManifest) !== `${manifest.backupFileName}.manifest.json` || hash(manifestBytes) !== backup.authorityDigest
    || hash(file(join(dirname(copiedManifest), manifest.backupFileName)).bytes) !== manifest.sha256) throw new Error("storage-backup-authority-refused");
  return { backupPath: path, backupDigest: hash(bytes) };
}

export async function backupFlatStorage(admission: RuntimeAdmission, clock: Clock) {
  if (!admission.isFlatBackup()) throw new Error("flat-backup-authority-required");
  await inspectCoupledBackupSource(admission, true, clock);
  const root = storageBackupRoot(admission);
  mkdirSync(root, { recursive: true, mode: 0o700 }); noSymlinkAncestry(root, new Map());
  statDirectory(dirname(root), "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (readdirSync(dirname(root)).some(name => name !== admission.locator.installationId)
    || readdirSync(root).some(name => !["source.json", "files", "backup.json"].includes(name))) throw new Error("storage-backup-membership-refused");
  if (lstatSync(join(root, "backup.json"), { throwIfNoEntry: false }) !== undefined) retainedStorageBackup(admission);
  const coupled = await writeCoupledBackup(admission, admission, root, true, clock);
  const record = StorageBackupSchema.parse({ schemaVersion: 1, installationId: admission.locator.installationId,
    sourceStateRoot: admission.stateRoot, authorityManifest: coupled.authorityManifest, authorityDigest: coupled.authorityDigest,
    sourceDigest: coupled.sourceDigest, files: coupled.files });
  const bytes = Buffer.from(canonicalJsonStringify(record)), path = join(root, "backup.json");
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) { writePrivateStage(path, bytes); fsyncPath(root); fsyncPath(dirname(root)); }
  else if (!file(path).bytes.equals(bytes)) throw new Error("storage-backup-changed");
  retainedStorageBackup(admission);
  coupled.verifySource(); admission.assertLive();
  return { manifests: [AuthorityBackupManifestSchema.parse(JSON.parse(file(record.authorityManifest).bytes.toString("utf8")))],
    coupledBackup: { backupPath: path, backupDigest: hash(bytes) } };
}

function assertFlatBackupFacts(workspace: string, stateRoot: string, artifactRoot: string,
  sourceFacts: ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>) {
    const expectedPaths = { stateRoot, artifactRoot,
      browserProfileRoot: join(stateRoot, "browsers"), duoCredential: join(stateRoot, "credentials", "duo-webauthn.json"),
      reportsDir: join(workspace, "data", "reports"), downloadsDir: join(workspace, "data", "downloads"),
      onboardingDocsDir: join(workspace, "data", "onboarding"), i9CheckTrackerPath: join(workspace, "data", "reports", "i9-check-tracker.xlsx") };
    if (sourceFacts.configSnapshots.some(snapshot => {
      const { duoExtensionDir: _extension, ...paths } = snapshot.config.paths;
      return canonicalJsonStringify(paths) !== canonicalJsonStringify(expectedPaths);
    })) throw new Error("existing-data-flat-custom-paths-unsupported");
    const settings = sourceFacts.settingsAuthority;
    if (settings.state !== "initialized" || settings.record.active === null) throw new Error("existing-data-flat-settings-unavailable");
    const active = settings.record.active;
    if (Object.keys((settings.record.saved?.settings ?? settings.record.initialization.settings.settings).paths ?? {}).length !== 0) throw new Error("existing-data-flat-custom-paths-unsupported");
    if (!sourceFacts.configSnapshots.some(snapshot => snapshot.configSnapshotId === active.configSnapshotId && snapshot.fingerprint === active.configFingerprint)) throw new Error("existing-data-flat-settings-unavailable");
}

function coupledBackupCensus(workspace: string, profileRoot: string, machineRoot: string, flat: boolean,
  storageInstallationId?: string, recoveryReceipt?: string, recoveryMembers: readonly string[] = []) {
  return [
    ...inventory(profileRoot, "profile", new Set(["state.db", "state.db-wal", "state.db-shm", "state.db-journal", ...(flat ? ["locks"] : [])])),
    ...(flat ? [] : inventory(join(machineRoot, "machine"), "machine")),
    ...(flat && lstatSync(join(workspace, "data"), { throwIfNoEntry: false }) !== undefined ? inventory(join(workspace, "data"), "workspace-data") : []),
    ...inventory(join(workspace, ".tracker", "control"), "control", new Set(["leases", "admission-mutex", "profile-owner-claims",
      ...(storageInstallationId === undefined ? [] : [`storage-backups/${storageInstallationId}`]),
      ...(recoveryReceipt === undefined ? [] : [`admission-mutex-recovery/${recoveryReceipt}.json`]), ...recoveryMembers])),
  ];
}

function coupledSourceRecord(installationId: string, profileRoot: string,
  current: Pick<ReturnType<typeof AuthorityDatabase.inspectStoppedUpgrade>, "authorityContentFingerprint" | "authorityGeneration">,
  census: () => ReturnType<typeof inventory>) {
  return Buffer.from(canonicalJsonStringify({ schemaVersion: 1, installationId, sourceStateRoot: profileRoot,
    sourceFingerprint: current.authorityContentFingerprint, sourceGeneration: current.authorityGeneration,
    databases: profileAuthorityFileWitnesses(profileRoot).map(entry => ({ ...entry,
      ...(entry.file === undefined ? {} : { mode: file(join(profileRoot, `state.db${entry.suffix}`), "authority database").stat.mode }) })),
    files: census().map(entry => ({ ...entry.file, mode: file(entry.path, existingDataFileLabel(entry.file.path)).stat.mode })) }));
}

export function observeFlatBackupMutexRecovery(workspace: string, locator: RuntimeLocator, restore: RestoreAdmissionHandle,
  recoveryReceipt: string) {
  const stateRoot = join(workspace, rebuildRuntimeIsolation.stateRoot), artifactRoot = join(stateRoot, "artifacts");
  const control = join(workspace, ".tracker", "control"), processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  assertRuntimeRestoreAdmission(restore, processLockRoot);
  const locks = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")) });
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (Object.values(locks.processLocks).some(lock => lock.state !== "stopped") || orphans.staleServerRecords > 0 || orphans.staleWorkerRecords > 0) throw new Error("flat-backup-recovery-process-custody-refused");
  if (locator.stateRoot !== stateRoot || locator.artifactRoot !== artifactRoot
    || [join(stateRoot, "machine"), join(stateRoot, "profiles"), ...["profile-registry.json", "profile-flat-claim.json", "profile-publication.json", "profile-owner-claims"]
      .map(name => join(control, name))].some(path => lstatSync(path, { throwIfNoEntry: false }) !== undefined)) throw new Error("flat-backup-recovery-source-refused");
  noSymlinkAncestry(stateRoot, new Map()); noSymlinkAncestry(artifactRoot, new Map());
  const allocations = join(control, "storage-backups"), root = join(allocations, locator.installationId);
  statDirectory(allocations, "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (canonicalJsonStringify(readdirSync(allocations)) !== canonicalJsonStringify([locator.installationId])) throw new Error("flat-backup-recovery-membership-refused");
  const names = readdirSync(root).sort();
  if (names.some(name => !["source.json", "files", "backup.json"].includes(name))) throw new Error("flat-backup-recovery-membership-refused");
  const { inspection, facts } = AuthorityDatabase.readFlatBackupRecoveryInventory(join(stateRoot, "state.db"), restore);
  assertCredentialCopyResourcesClosed(facts);
  if (facts.slots.some(slot => slot.retiredAt === null)) throw new Error("flat-backup-recovery-worker-custody-refused");
  assertFlatBackupFacts(workspace, stateRoot, artifactRoot, facts);
  assertCoupledArtifacts(artifactRoot, facts.artifactReferences);
  const membership = enumerateFlatBackupRecoveryMembership(stateRoot, facts);
  const backups = membership.manifests.map(path => verifyFlatBackupRecoveryManifest(path, AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")), restore, processLockRoot));
  if (backups.length !== membership.backupPaths.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("flat-backup-recovery-authority-membership-refused");
  const recoveryHistory = flatBackupRecoveryHistory(root, locator.installationId, locator.generation, recoveryReceipt);
  const census = () => coupledBackupCensus(workspace, stateRoot, stateRoot, true, locator.installationId, recoveryReceipt, recoveryHistory.excluded);
  const source = census(), currentSource = coupledSourceRecord(locator.installationId, stateRoot, inspection, census);
  if (names.length !== 0) {
    if (!names.includes("source.json") || !file(join(root, "source.json")).bytes.equals(currentSource)) throw new Error("flat-backup-recovery-source-changed");
    const record = SourceRecordSchema.parse(JSON.parse(currentSource.toString("utf8")));
    const currentBackups = backups.filter(backup => backup.manifest.authorityContentFingerprint === record.sourceFingerprint && backup.manifest.authorityGeneration === record.sourceGeneration);
    if (currentBackups.length === 0) throw new Error("flat-backup-recovery-authority-required");
    const expected = record.files.map(entry => ({ path: entry.path, digest: entry.digest }));
    const copies = names.includes("files") ? inventory(join(root, "files"), "") : [];
    const prefix = expected.slice(0, copies.length);
    if (copies.some(copy => !prefix.some(entry => entry.path === copy.file.path && entry.digest === copy.file.digest))) throw new Error("flat-backup-recovery-copy-refused");
    const directories = new Set([""]);
    for (const entry of expected.slice(0, copies.length + 1)) for (let path = dirname(entry.path); path !== "."; path = dirname(path)) directories.add(path);
    if (names.includes("files") && unpublishedDraftAbortMembership(join(root, "files")).some(entry => entry.directory && !directories.has(entry.path))) throw new Error("flat-backup-recovery-copy-membership-refused");
    if (names.includes("backup.json")) {
      const receipt = StorageBackupSchema.parse(JSON.parse(file(join(root, "backup.json")).bytes.toString("utf8")));
      if (receipt.installationId !== locator.installationId || receipt.sourceStateRoot !== stateRoot || receipt.sourceDigest !== hash(currentSource)
        || canonicalJsonStringify(receipt.files) !== canonicalJsonStringify(source.map(entry => entry.file))
        || !currentBackups.some(backup => backup.manifestPath === receipt.authorityManifest && hash(file(backup.manifestPath).bytes) === receipt.authorityDigest)) throw new Error("flat-backup-recovery-receipt-refused");
      verifyCopies(root, receipt.files);
    }
  }
  const roots = [workspace, control, stateRoot, artifactRoot, allocations].map(path => {
    const value = lstatSync(path); return { path, device: value.dev, inode: value.ino, mode: value.mode, owner: value.uid };
  });
  assertRuntimeRestoreAdmission(restore, processLockRoot);
  const allocation = lstatSync(root);
  return { binding: FlatBackupRecoveryBindingSchema.parse({ kind: names.length === 0 ? "empty-allocation" : "source-record",
    allocationDevice: allocation.dev, allocationInode: allocation.ino, sourceDigest: hash(currentSource) }),
    observation: canonicalJsonStringify({ roots, source: currentSource.toString("base64"), allocation: unpublishedDraftAbortMembership(root),
      recoveryHistory: recoveryHistory.observation, files: inventory(root, ""), membership: membership.identities.filter(entry => entry.path !== processLockRoot), inspection }) };
}

function assertCoupledArtifacts(artifactRoot: string, references: ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>["artifactReferences"]) {
  for (const reference of references) {
    const stored = decodeStoredArtifact(JSON.parse(file(join(artifactRoot, `${reference.sha256}.artifact`), existingDataFileLabel(`profile/artifacts/${reference.sha256}.artifact`)).bytes.toString("utf8")), reference.sha256);
    if (canonicalJsonStringify(stored.ref) !== canonicalJsonStringify(reference)) throw new Error("existing-data-artifact-reference-mismatch");
  }
}

function flatBackupRecoveryHistory(root: string, installationId: string, generation: number, pendingId?: string) {
  const sourcePath = join(root, "source.json"), excluded: string[] = [], observed: unknown[] = [];
  if (lstatSync(sourcePath, { throwIfNoEntry: false }) === undefined) return { excluded, observation: canonicalJsonStringify(observed) };
  const sourceBytes = file(sourcePath).bytes, source = SourceRecordSchema.parse(JSON.parse(sourceBytes.toString("utf8")));
  if (source.installationId !== installationId) throw new Error("flat-backup-recovery-history-binding-refused");
  const allocation = lstatSync(root), history = join(dirname(dirname(root)), "admission-mutex-recovery");
  if (lstatSync(history, { throwIfNoEntry: false }) === undefined) return { excluded, observation: canonicalJsonStringify(observed) };
  noSymlinkAncestry(history, new Map()); statDirectory(history, "mutex recovery", 0o700);
  const prefix = "control/admission-mutex-recovery/", baseline = new Set(source.files.filter(entry => entry.path.startsWith(prefix)).map(entry => entry.path.slice(prefix.length).split("/")[0]));
  const allowed = new Set([...baseline, ...(pendingId === undefined ? [] : [pendingId, `${pendingId}.json`])]);
  for (const name of readdirSync(history).sort()) {
    if (baseline.has(name) || name === `${pendingId}.json` || !name.endsWith(".json")) continue;
    const path = join(history, name), raw = file(path), receipt = MutexRecoveryReceiptSchema.parse(JSON.parse(raw.bytes.toString("utf8")));
    const binding = receipt.flatBackup;
    if (name !== `${receipt.acquisitionId}.json` || receipt.installationId !== installationId || receipt.generation !== generation || binding === undefined
      || binding.kind !== "source-record" || binding.sourceDigest !== hash(sourceBytes)
      || binding.allocationDevice !== allocation.dev || binding.allocationInode !== allocation.ino) throw new Error("flat-backup-recovery-history-binding-refused");
    const archive = join(history, receipt.acquisitionId); statDirectory(archive, "mutex archive", 0o700);
    if ("pid" in receipt) {
      if (canonicalJsonStringify(readdirSync(archive)) !== canonicalJsonStringify([receipt.ownerFile])) throw new Error("flat-backup-recovery-history-membership-refused");
      const ownerFile = file(join(archive, receipt.ownerFile)), owner = MutexOwnerSchema.parse(JSON.parse(ownerFile.bytes.toString("utf8")));
      if (owner.acquisitionId !== receipt.acquisitionId || owner.pid !== receipt.pid
        || canonicalJsonStringify(owner.processIdentity) !== canonicalJsonStringify(receipt.processIdentity) || hash(ownerFile.bytes) !== receipt.ownerSha256) throw new Error("flat-backup-recovery-history-owner-refused");
    } else {
      const directory = lstatSync(archive);
      if (readdirSync(archive).length !== 0 || directory.dev !== receipt.directoryDevice || directory.ino !== receipt.directoryInode) throw new Error("flat-backup-recovery-history-owner-refused");
    }
    allowed.add(name); allowed.add(receipt.acquisitionId);
    excluded.push(`admission-mutex-recovery/${name}`, `admission-mutex-recovery/${receipt.acquisitionId}`);
    observed.push({ receipt: { ...raw.identity, digest: hash(raw.bytes) }, archive: unpublishedDraftAbortMembership(archive), files: inventory(archive, "") });
  }
  if (readdirSync(history).some(name => !allowed.has(name))) throw new Error("flat-backup-recovery-history-membership-refused");
  return { excluded, observation: canonicalJsonStringify(observed) };
}
