import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { RuntimeAdmission } from "../admission/admission.js";
import { readPrivateFile, writePrivateStage, fsyncPath, noSymlinkAncestry } from "../configuration/credential-safe-file.js";
import type { ExistingDataOwnerWitness } from "../configuration/credential-store.js";
import type { SignUpOperation } from "../../../models/profiles/profile.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const FileSchema = z.strictObject({ path: RelativePathSchema, digest: DigestSchema, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
const BackupSchema = z.strictObject({ schemaVersion: z.literal(1), claimId: z.uuid(), installationId: z.uuid(), profileId: z.uuid(),
  sourceStateRoot: z.string().min(1).optional(), authorityManifest: z.string().min(1), authorityDigest: DigestSchema, files: z.array(FileSchema) });
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
  const copies = inventory(join(root, "files"), "").map(entry => ({ path: entry.file.path, digest: entry.file.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = backup.files.map(entry => ({ path: entry.path, digest: entry.digest })).sort((a, b) => a.path.localeCompare(b.path));
  if (canonicalJsonStringify(copies) !== canonicalJsonStringify(expected)) throw new Error("existing-data-backup-changed");
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
  const { backupStoppedAuthority } = await import("./upgrade.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { assertCredentialCopyResourcesClosed, enumerateProfileCredentialMembership } = await import("./profile-inventory.js");
  machine.assertExclusive(); admission.assertReadyStoppedProfileUpgradeOwner(machine);
  const ownership = verifyExistingDataOwner(owner, machine), context = machine.readInstallationContext();
  if (context === undefined || ownership.profileId !== undefined && ownership.profileId !== admission.profileBinding.profileId) throw new Error("existing-data-backup-owner-refused");
  const sourceFacts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
  assertCredentialCopyResourcesClosed(sourceFacts);
  if (ownership.profileId === undefined && sourceFacts.slots.some(slot => slot.retiredAt === null)) throw new Error("existing-data-flat-worker-custody-unsupported");
  {
    const settings = sourceFacts.settingsAuthority.state === "initialized"
      ? sourceFacts.settingsAuthority.record.saved?.settings ?? sourceFacts.settingsAuthority.record.initialization.settings.settings : undefined;
    const membership = enumerateProfileCredentialMembership(admission, sourceFacts, settings?.paths?.browserProfileRoot ?? join(admission.stateRoot, "browsers"));
    const backups = membership.manifests.map(path => verifyStoppedBackupManifestAtPath(admission, path, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))));
    if (backups.length !== membership.backupPaths.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("existing-data-backup-source-membership-unproved");
    const { decodeStoredArtifact } = await import("../artifacts/content-addressed-artifact-writer.js");
    for (const reference of sourceFacts.artifactReferences) {
      const stored = decodeStoredArtifact(JSON.parse(file(join(admission.artifactRoot, `${reference.sha256}.artifact`), existingDataFileLabel(`profile/artifacts/${reference.sha256}.artifact`)).bytes.toString("utf8")), reference.sha256);
      if (canonicalJsonStringify(stored.ref) !== canonicalJsonStringify(reference)) throw new Error("existing-data-artifact-reference-mismatch");
    }
  }
  const processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  const authorityDirectory = join(admission.stateRoot, "backups", "authority");
  const current = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
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
  const profileRoot = admission.stateRoot;
  const databases = canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot));
  const census = () => [
    ...inventory(profileRoot, "profile", new Set(["state.db", "state.db-wal", "state.db-shm", "state.db-journal", ...(flat ? ["locks"] : [])])),
    ...(flat ? [] : inventory(join(machine.stateRoot, "machine"), "machine")),
    ...(flat && lstatSync(join(context.workspace, "data"), { throwIfNoEntry: false }) !== undefined ? inventory(join(context.workspace, "data"), "workspace-data") : []),
    ...inventory(controlRoot, "control", new Set(["leases", "admission-mutex", "profile-owner-claims"])),
  ];
  const source = census();
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
  const backup = BackupSchema.parse({ schemaVersion: 1, claimId: canonicalClaimId, installationId: machine.locator.installationId,
    profileId: intentSource.profileId, ...(flat ? { sourceStateRoot: admission.stateRoot } : {}), authorityManifest, authorityDigest: hash(file(authorityManifest).bytes), files: source.map(entry => entry.file) });
  const bytes = Buffer.from(canonicalJsonStringify(backup)), backupPath = join(root, "backup.json");
  if (lstatSync(backupPath, { throwIfNoEntry: false }) === undefined) { writePrivateStage(backupPath, bytes); fsyncPath(root); fsyncPath(dirname(root)); }
  else if (hash(file(backupPath).bytes) !== hash(bytes)) throw new Error("existing-data-backup-copy-changed");
  const reference = Object.freeze({ claimId: canonicalClaimId, backupPath, backupDigest: hash(bytes) });
  issuedBackups.set(reference, { owner, machine, source, census, verifyOwner: () => {
    verifyExistingDataOwner(owner, machine);
    if (canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot)) !== databases) throw new Error("existing-data-backup-source-changed");
  } });
  verifyExistingDataBackup(reference, owner, machine);
  assertCredentialCopyResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(admission));
  return reference;
}
