import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { assertRuntimeRestoreAdmission } from "../sqlite/runtime-process-locks.js";
import { readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import type { Clock } from "../../../rules/time/clock.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { RuntimeLocator } from "../admission/installation.js";
import { readPrivateFile, noSymlinkAncestry, writePrivateStage, fsyncPath } from "../configuration/credential-safe-file.js";
import { verifyExistingDataOwner, type ExistingDataOwnerWitness } from "../configuration/credential-store.js";
import { emailKey } from "../configuration/synthetic-verifier.js";
import { existingDataFileLabel, ownerClaimRecoveryCopies, verifyExistingDataBackup, verifyExistingDataBackupFiles, type ExistingDataBackup } from "./existing-data-backup.js";
import { ActiveRuntimeConfigRecordSchema } from "../../../models/config/runtime-generation.js";
import { LogoutOperationSchema, SignUpOperationSchema, deriveProfileNames, type SignUpOperation } from "../../../models/profiles/profile.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativeSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const EntrySchema = z.strictObject({ path: z.string(), directory: z.boolean(), device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative(), digest: DigestSchema.optional() });
const MoveSchema = z.strictObject({ role: z.enum(["state", "data"]), source: RelativeSchema, destination: RelativeSchema, entries: z.array(EntrySchema).min(1) });
export const FlatProfileClaimSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(),
  sourceStateRoot: z.string().min(1), profileId: z.uuid(), operation: SignUpOperationSchema,
  pepper: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u), moves: z.array(MoveSchema).min(1), root: EntrySchema, dataRoot: EntrySchema.optional(),
  activationSnapshotId: z.uuid(), activationPrior: ActiveRuntimeConfigRecordSchema, claimedAt: z.iso.datetime() });
export const FlatProfileClaimReceiptSchema = FlatProfileClaimSchema.omit({ pepper: true }).extend({ pepperDigest: DigestSchema });
export type FlatProfileClaim = z.infer<typeof FlatProfileClaimSchema>;
export interface FlatProfileClaimWitness { readonly profileId: string; }
const issuedClaims = new WeakMap<FlatProfileClaimWitness, { machine: RuntimeAdmission; owner: ExistingDataOwnerWitness; backup: ExistingDataBackup; claim: FlatProfileClaim }>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function bytes(path: string, label: "lock" | "authority database" | "managed data" = "lock") {
  const file = readPrivateFile(path, { label, maxBytes: 512 * 1024 * 1024 });
  if (file === undefined) throw new Error("existing-data-transition-file-required");
  return file.bytes;
}

function entries(root: string, inventoryPath: string) {
  const result: z.infer<typeof EntrySchema>[] = [];
  const visit = (path: string) => {
    noSymlinkAncestry(dirname(path), new Map());
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink !== 1
      || process.getuid !== undefined && info.uid !== process.getuid() || (info.mode & 0o022) !== 0) throw new Error("existing-data-transition-path-unsafe");
    result.push({ path: relative(root, path), directory: info.isDirectory(), device: info.dev, inode: info.ino, mode: info.mode,
      ...(info.isDirectory() ? {} : { digest: hash(bytes(path, existingDataFileLabel(join(inventoryPath, relative(root, path))))) }) });
    if (info.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  visit(root); return result;
}

export function readFlatProfileClaimReceipt(admission: RuntimeAdmission, operation?: SignUpOperation) {
  requireRuntimeAdmission(admission).assertLive();
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-transition-installation-required");
  const profileId = operation?.profileId ?? admission.profileBinding.profileId;
  const references = operation?.ownerClaim === undefined ? ownerClaimRecoveryCopies(admission, profileId, "flat").map(root => {
    const path = join(root, "backup.json"), raw = bytes(path);
    return { claimId: z.uuid().parse(root.slice(root.lastIndexOf("/") + 1)), backupPath: path, backupDigest: hash(raw) };
  }) : [operation.ownerClaim];
  const receipts = references.flatMap(reference => {
    const backup = verifyExistingDataBackupFiles(reference, context.workspace, context.locator.installationId);
    if (backup.sourceStateRoot === undefined) return [];
    const receipt = FlatProfileClaimReceiptSchema.parse(JSON.parse(bytes(join(dirname(reference.backupPath), "flat.json")).toString("utf8")));
    if (receipt.installationId !== context.locator.installationId || receipt.profileId !== profileId || backup.profileId !== profileId
      || receipt.sourceStateRoot !== backup.sourceStateRoot || canonicalJsonStringify(receipt.operation.ownerClaim) !== canonicalJsonStringify(reference)) throw new Error("existing-data-flat-receipt-changed");
    if (operation !== undefined) {
      const identity = (value: SignUpOperation) => ({ operationId: value.operationId, profileId: value.profileId, commandId: value.commandId,
        writeId: value.writeId, commandFingerprint: value.commandFingerprint, expectedRevision: value.expectedRevision,
        firstName: value.firstName, lastName: value.lastName, emailKey: value.emailKey, createdAt: value.createdAt, ownerClaim: value.ownerClaim,
        mode: value.credentialInitialization?.mode, keyId: value.credentialInitialization?.keyId,
        source: value.credentialInitialization?.mode === "proven-v2" ? value.credentialInitialization.source : undefined });
      if (canonicalJsonStringify(identity(operation)) !== canonicalJsonStringify(identity(receipt.operation))) throw new Error("existing-data-flat-operation-changed");
    }
    return [receipt];
  });
  if (receipts.length > 1) throw new Error("existing-data-flat-receipt-ambiguous");
  return receipts[0];
}

export function claimedProfilePath(admission: RuntimeAdmission, path: string, receipt = readFlatProfileClaimReceipt(admission)): string {
  if (receipt === undefined) return path;
  if (path === admission.stateRoot || path.startsWith(`${admission.stateRoot}/`)) return path;
  return path === receipt.sourceStateRoot ? admission.stateRoot : path.startsWith(`${receipt.sourceStateRoot}/`)
    ? join(admission.stateRoot, path.slice(receipt.sourceStateRoot.length + 1)) : path;
}

export function assertRetainedFlatClaimFile(admission: RuntimeAdmission, path: string, receipt = readFlatProfileClaimReceipt(admission)): boolean {
  if (receipt === undefined) return false;
  const local = relative(admission.stateRoot, path), move = receipt.moves.find(value => local === value.destination || local.startsWith(`${value.destination}/`));
  if (move === undefined || move.destination.startsWith("state.db") || local === "credentials/protected.json") return false;
  const entry = move.entries.find(value => value.path === relative(join(admission.stateRoot, move.destination), path));
  if (entry === undefined || entry.directory) return false;
  const actual = entries(path, `profile/${local}`)[0];
  if (actual === undefined || actual.device !== entry.device || actual.inode !== entry.inode || actual.digest !== entry.digest || actual.mode !== entry.mode) throw new Error("existing-data-flat-retained-copy-changed");
  return true;
}

export async function prepareFlatProfileClaim(machine: RuntimeAdmission, owner: ExistingDataOwnerWitness, backup: ExistingDataBackup,
  fields: { firstName: string; lastName: string; createdAt: string }, sourceAdmission: RuntimeAdmission): Promise<FlatProfileClaimWitness> {
  machine.assertExclusive();
  const source = verifyExistingDataOwner(owner, machine), verified = verifyExistingDataBackup(backup, owner, machine);
  const context = machine.readInstallationContext();
  if (context === undefined || source.profileId !== undefined || verified.sourceStateRoot !== machine.stateRoot
    || machine.stateRoot !== join(context.workspace, rebuildRuntimeIsolation.stateRoot) || machine.artifactRoot !== join(machine.stateRoot, "artifacts")
    || !machine.requiresExistingDataClaim()) throw new Error("existing-data-flat-source-refused");
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  sourceAdmission.assertReadyStoppedProfileUpgradeOwner(machine);
  const facts = AuthorityDatabase.readProfileMaintenanceInventory(sourceAdmission), settings = facts.settingsAuthority;
  if (settings.state !== "initialized" || settings.record.active === null) throw new Error("existing-data-flat-settings-unavailable");
  const saved = settings.record.saved?.settings ?? settings.record.initialization.settings.settings;
  if (Object.keys(saved.paths ?? {}).length > 0) throw new Error("existing-data-flat-custom-paths-unsupported");
  const activationSource = facts.configSnapshots.find(snapshot => snapshot.configSnapshotId === settings.record.active?.configSnapshotId);
  if (activationSource === undefined || activationSource.fingerprint !== settings.record.active.configFingerprint) throw new Error("existing-data-flat-settings-unavailable");
  const names = deriveProfileNames(fields.firstName, fields.lastName);
  if (source.record.entries.timekeeperName?.value !== names.timekeeperName || source.record.entries.ucpathUserId === undefined) throw new Error("existing-data-owner-refused");
  const pepper = randomBytes(32), request = source.request;
  const operation = SignUpOperationSchema.parse({ schemaVersion: 1, kind: "sign-up", operationId: randomUUID(), profileId: verified.profileId,
    commandId: request.commandId, writeId: request.writeId, commandFingerprint: request.commandFingerprint, expectedRevision: request.expectedRevision,
    emailKey: emailKey(pepper, source.record.entries.ucpathUserId.value), firstName: names.firstName, lastName: names.lastName, createdAt: request.updatedAt,
    credentialInitialization: { mode: "proven-v2", phase: "admitted", keyId: randomUUID(), source: { schemaVersion: 2,
      revision: source.record.revision, ...source.file } },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [], duo: { profileId: verified.profileId, state: "never-initialized", revision: 0 } },
    ownerClaim: backup, phase: "applying" });
  const moves: FlatProfileClaim["moves"] = [];
  for (const name of readdirSync(machine.stateRoot).sort()) {
    if ([".runtime-owner.json", "locks", "artifacts"].includes(name)) continue;
    if (!["state.db", "state.db-wal", "state.db-shm", "credentials", "browsers", "backups", "logs", "scratch"].includes(name)) throw new Error("existing-data-flat-membership-refused");
    moves.push({ role: "state", source: name, destination: name, entries: entries(join(machine.stateRoot, name), `profile/${name}`) });
  }
  for (const name of readdirSync(machine.artifactRoot).sort()) {
    if (name === ".runtime-owner.json") continue;
    if (!/^[a-f0-9]{64}\.artifact$/u.test(name)) throw new Error("existing-data-flat-artifact-refused");
    moves.push({ role: "state", source: `artifacts/${name}`, destination: `artifacts/${name}`, entries: entries(join(machine.artifactRoot, name), `profile/artifacts/${name}`) });
  }
  const dataRoot = join(context.workspace, "data");
  if (lstatSync(dataRoot, { throwIfNoEntry: false }) !== undefined) {
    noSymlinkAncestry(dataRoot, new Map());
    for (const name of readdirSync(dataRoot).sort()) {
      if (!["reports", "downloads", "onboarding"].includes(name) || !lstatSync(join(dataRoot, name)).isDirectory()) throw new Error("existing-data-flat-data-membership-refused");
      moves.push({ role: "data", source: name, destination: `files/${name}`, entries: entries(join(dataRoot, name), `workspace-data/${name}`) });
    }
  }
  if (!moves.some(move => move.source === "state.db") || !moves.some(move => move.source === "credentials")) throw new Error("existing-data-flat-source-required");
  const root = entries(machine.stateRoot, "profile").find(entry => entry.path === "");
  const claim = FlatProfileClaimSchema.parse({ schemaVersion: 1, installationId: machine.locator.installationId, sourceStateRoot: machine.stateRoot,
    profileId: verified.profileId, operation, pepper: pepper.toString("base64"), moves, root,
    ...(lstatSync(dataRoot, { throwIfNoEntry: false }) === undefined ? {} : { dataRoot: entries(dataRoot, "workspace-data")[0] }), activationSnapshotId: randomUUID(),
    activationPrior: settings.record.active, claimedAt: fields.createdAt });
  if (claim.moves.some(move => move.entries.some(entry => entry.device !== claim.root.device))) throw new Error("existing-data-flat-cross-device-unsupported");
  const witness = Object.freeze({ profileId: claim.profileId });
  issuedClaims.set(witness, { machine, owner, backup, claim });
  return witness;
}

export function verifyFlatProfileClaim(witness: FlatProfileClaimWitness, locator: RuntimeLocator, machine: RuntimeAdmission): FlatProfileClaim {
  const issued = issuedClaims.get(witness);
  if (issued === undefined || issued.machine !== machine || issued.claim.installationId !== locator.installationId || issued.claim.sourceStateRoot !== locator.stateRoot) throw new Error("existing-data-flat-claim-unissued");
  verifyExistingDataOwner(issued.owner, issued.machine);
  const backup = issued.claim.operation.ownerClaim;
  if (backup === undefined) throw new Error("existing-data-backup-required");
  verifyExistingDataBackup(issued.backup, issued.owner, issued.machine);
  const context = issued.machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-transition-installation-required");
  for (const move of issued.claim.moves) if (canonicalJsonStringify(entries(join(move.role === "state" ? locator.stateRoot : join(context.workspace, "data"), move.source), `profile/${move.destination}`)) !== canonicalJsonStringify(move.entries)) throw new Error("existing-data-flat-source-changed");
  return issued.claim;
}

export function settleFlatProfileClaim(machine: RuntimeAdmission, claimInput: FlatProfileClaim, locator: RuntimeLocator, workspace: string,
  publish: (operation: SignUpOperation, pepper: Buffer) => void): void {
  requireStoppedFlatClaim(machine);
  if (machine.locator.installationId !== locator.installationId || machine.stateRoot !== locator.stateRoot
    || machine.artifactRoot !== locator.artifactRoot || machine.readInstallationContext()?.workspace !== workspace) throw new Error("existing-data-flat-stopped-owner-required");
  const claim = FlatProfileClaimSchema.parse(claimInput), backup = claim.operation.ownerClaim;
  if (backup === undefined || claim.operation.profileId !== claim.profileId || claim.installationId !== locator.installationId
    || claim.sourceStateRoot !== locator.stateRoot || locator.stateRoot !== join(workspace, rebuildRuntimeIsolation.stateRoot)
    || locator.artifactRoot !== join(locator.stateRoot, "artifacts")) throw new Error("existing-data-flat-binding-refused");
  const verified = verifyExistingDataBackupFiles(backup, workspace, locator.installationId);
  if (verified.profileId !== claim.profileId || verified.sourceStateRoot !== claim.sourceStateRoot) throw new Error("existing-data-flat-backup-refused");
  const root = lstatSync(locator.stateRoot);
  if (claim.moves.some(move => move.entries.some(entry => entry.device !== claim.root.device))) throw new Error("existing-data-flat-cross-device-unsupported");
  if (root.dev !== claim.root.device || root.ino !== claim.root.inode || root.mode !== claim.root.mode) throw new Error("existing-data-flat-root-changed");
  const allowedState = new Set([".runtime-owner.json", "locks", "artifacts", "profiles", "machine", ...claim.moves.filter(move => move.role === "state").map(move => move.source.split("/")[0])]);
  if (readdirSync(locator.stateRoot).some(name => !allowedState.has(name))) throw new Error("existing-data-flat-membership-changed");
  const allowedArtifacts = new Set([".runtime-owner.json", ...claim.moves.filter(move => move.source.startsWith("artifacts/")).map(move => move.source.slice("artifacts/".length))]);
  if (readdirSync(locator.artifactRoot).some(name => !allowedArtifacts.has(name))) throw new Error("existing-data-flat-artifact-membership-changed");
  const dataRoot = join(workspace, "data"), dataInfo = lstatSync(dataRoot, { throwIfNoEntry: false });
  if (claim.dataRoot === undefined ? dataInfo !== undefined : dataInfo === undefined || dataInfo.dev !== claim.dataRoot.device
    || dataInfo.ino !== claim.dataRoot.inode || dataInfo.mode !== claim.dataRoot.mode) throw new Error("existing-data-flat-data-root-changed");
  const dataNames = new Set(claim.moves.filter(move => move.role === "data").map(move => move.source));
  if (dataInfo !== undefined && readdirSync(dataRoot).some(name => !dataNames.has(name))) throw new Error("existing-data-flat-data-membership-changed");
  const target = join(locator.stateRoot, "profiles", claim.profileId);
  const ensure = (path: string) => {
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) { mkdirSync(path, { mode: 0o700 }); fsyncPath(dirname(path)); }
    noSymlinkAncestry(path, new Map());
    const info = lstatSync(path);
    if ((info.mode & 0o777) !== 0o700 || process.getuid !== undefined && info.uid !== process.getuid() || info.dev !== root.dev) throw new Error("existing-data-flat-target-refused");
  };
  ensure(join(locator.stateRoot, "profiles")); ensure(target); ensure(join(target, "artifacts"));
  if (readdirSync(join(locator.stateRoot, "profiles")).some(name => name !== claim.profileId)) throw new Error("existing-data-flat-target-refused");
  if (claim.moves.some(move => move.role === "data")) ensure(join(target, "files"));
  for (const move of claim.moves) {
    if (move.role === "data" ? !["reports", "downloads", "onboarding"].includes(move.source) || move.destination !== `files/${move.source}`
      : move.destination !== move.source || !["state.db", "state.db-wal", "state.db-shm", "credentials", "browsers", "backups", "logs", "scratch"].includes(move.source)
        && !/^artifacts\/[a-f0-9]{64}\.artifact$/u.test(move.source)) throw new Error("existing-data-flat-move-refused");
    const source = join(move.role === "state" ? locator.stateRoot : join(workspace, "data"), move.source), destination = join(target, move.destination);
    const from = lstatSync(source, { throwIfNoEntry: false }), to = lstatSync(destination, { throwIfNoEntry: false });
    if ((from === undefined) === (to === undefined)) throw new Error("existing-data-flat-move-uncertain");
    const current = from === undefined ? destination : source;
    if (canonicalJsonStringify(entries(current, `profile/${move.destination}`)) !== canonicalJsonStringify(move.entries)) throw new Error("existing-data-flat-move-changed");
    if (from !== undefined) { renameSync(source, destination); fsyncPath(dirname(source)); fsyncPath(dirname(destination)); }
  }
  if (dataInfo !== undefined && readdirSync(dataRoot).length !== 0) throw new Error("existing-data-flat-data-membership-changed");
  const expected = new Set(["", "artifacts", ...(claim.moves.some(move => move.role === "data") ? ["files"] : []),
    ...claim.moves.flatMap(move => move.entries.map(entry => entry.path === "" ? move.destination : `${move.destination}/${entry.path}`))]);
  const actual = entries(target, "profile");
  if (actual.length !== expected.size || actual.some(entry => !expected.has(entry.path))) throw new Error("existing-data-flat-target-membership-changed");
  for (const move of claim.moves) if (canonicalJsonStringify(entries(join(target, move.destination), `profile/${move.destination}`)) !== canonicalJsonStringify(move.entries)) throw new Error("existing-data-flat-move-changed");
  publish(claim.operation, Buffer.from(claim.pepper, "base64"));
  const { pepper, ...receiptFields } = claim;
  const receipt = FlatProfileClaimReceiptSchema.parse({ ...receiptFields, pepperDigest: hash(Buffer.from(pepper, "base64")) });
  const receiptPath = join(dirname(backup.backupPath), "flat.json"), receiptBytes = Buffer.from(canonicalJsonStringify(receipt));
  if (lstatSync(receiptPath, { throwIfNoEntry: false }) === undefined) { writePrivateStage(receiptPath, receiptBytes); fsyncPath(dirname(receiptPath)); }
  else if (!bytes(receiptPath).equals(receiptBytes)) throw new Error("existing-data-flat-receipt-changed");
}

export async function completeFlatProfileClaim(machine: RuntimeAdmission, operation: SignUpOperation, clock: Clock): Promise<void> {
  requireStoppedFlatClaim(machine);
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const { assertCredentialCopyResourcesClosed } = await import("../maintenance/profile-inventory.js");
  const receipt = readFlatProfileClaimReceipt(machine, operation), context = machine.readInstallationContext(), reference = operation.ownerClaim;
  if (receipt === undefined || context === undefined || reference === undefined) throw new Error("existing-data-flat-receipt-required");
  const backup = verifyExistingDataBackupFiles(reference, context.workspace, machine.locator.installationId);
  const profile = machine.admitProfile(machine.issueRegisteredProfileClaim(operation.profileId));
  const path = join(profile.stateRoot, "state.db"), processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  let upgrade: RuntimeAdmission | undefined;
  try {
    const binding = readProfileDatabaseBinding(path);
    if (binding.state === "unbound") {
      if (binding.schemaVersion !== 6) throw new Error("existing-data-flat-schema-refused");
      upgrade = profile.forStoppedProfileUpgrade();
      const before = AuthorityDatabase.inspectStoppedUpgrade(upgrade, path, processLockRoot, clock);
      const manifestPath = join(profile.stateRoot, "backups", "authority", backup.authorityManifest.slice(backup.authorityManifest.lastIndexOf("/") + 1));
      const verified = verifyStoppedBackupManifestAtPath(upgrade, manifestPath, AuthorityDatabase.sourceDatabaseIdentity(join(receipt.sourceStateRoot, "state.db")));
      if (verified.manifest.authorityContentFingerprint !== before.authorityContentFingerprint) throw new Error("existing-data-flat-backup-changed");
      AuthorityDatabase.upgradeStopped(upgrade, path, processLockRoot, clock, before.authorityContentFingerprint, verified);
      upgrade.release(); upgrade = undefined;
    }
    await AuthorityDatabase.rebaseClaimedProfileConfiguration(machine, profile, operation, processLockRoot, clock);
    assertCredentialCopyResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(profile));
    const configured = join(dirname(reference.backupPath), "configured.json"), bytes = Buffer.from(canonicalJsonStringify({ schemaVersion: 1,
      profileId: operation.profileId, operationId: operation.operationId, configSnapshotId: receipt.activationSnapshotId }));
    const existing = readPrivateFile(configured, { label: "lock", maxBytes: 4096 });
    if (existing === undefined) { writePrivateStage(configured, bytes); fsyncPath(dirname(configured)); }
    else if (!existing.bytes.equals(bytes)) throw new Error("existing-data-flat-configuration-receipt-changed");
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: { profile, upgrade } });
    upgrade?.release(); profile.release(); throw error;
  }
  profile.release();
}

export function flatProfileClaimNeedsRecovery(machine: RuntimeAdmission): boolean {
  requireRuntimeAdmission(machine).assertLive();
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-transition-installation-required");
  if (existsSync(join(context.workspace, ".tracker", "control", "profile-flat-claim.json"))) return true;
  if (machine.requiresExistingDataClaim()) return false;
  const root = join(machine.stateRoot, "machine", "operations");
  machine.readProfileRegistry();
  if (!existsSync(root)) return false;
  for (const name of readdirSync(root)) {
    const file = readPrivateFile(join(root, name), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) throw new Error("existing-data-transition-operation-required");
    const operation = z.union([SignUpOperationSchema, LogoutOperationSchema]).parse(JSON.parse(file.bytes.toString("utf8")));
    if (operation.kind !== "sign-up" || operation.ownerClaim === undefined) continue;
    const receipt = readFlatProfileClaimReceipt(machine, operation);
    if (receipt === undefined) continue;
    const configured = readPrivateFile(join(dirname(operation.ownerClaim.backupPath), "configured.json"), { label: "lock", maxBytes: 4096 });
    if (configured === undefined) return true;
    const expected = canonicalJsonStringify({ schemaVersion: 1, profileId: operation.profileId, operationId: operation.operationId, configSnapshotId: receipt.activationSnapshotId });
    if (configured.bytes.toString("utf8") !== expected) throw new Error("existing-data-flat-configuration-receipt-changed");
  }
  return false;
}

export async function resumeFlatProfileClaim(machine: RuntimeAdmission, clock: Clock): Promise<void> {
  requireStoppedFlatClaim(machine);
  const recovered = machine.recoverFlatProfileClaim();
  if (recovered !== undefined) { await completeFlatProfileClaim(machine, recovered, clock); return; }
  machine.readProfileRegistry();
  const root = join(machine.stateRoot, "machine", "operations");
  if (!existsSync(root)) throw new Error("existing-data-flat-operation-required");
  const matching: SignUpOperation[] = [];
  for (const name of readdirSync(root)) {
    const file = readPrivateFile(join(root, name), { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) throw new Error("existing-data-flat-operation-required");
    const operation = z.union([SignUpOperationSchema, LogoutOperationSchema]).parse(JSON.parse(file.bytes.toString("utf8")));
    if (operation.kind === "sign-up" && operation.ownerClaim !== undefined && readFlatProfileClaimReceipt(machine, operation) !== undefined) matching.push(operation);
  }
  if (matching.length !== 1 || matching[0] === undefined) throw new Error("existing-data-flat-operation-ambiguous");
  await completeFlatProfileClaim(machine, matching[0], clock);
}

function requireStoppedFlatClaim(machine: RuntimeAdmission): void {
  requireRuntimeAdmission(machine).assertExclusive();
  const context = machine.readInstallationContext(), restore = machine.maintenanceRestore();
  if (context === undefined || restore === undefined) throw new Error("existing-data-flat-stopped-owner-required");
  const processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  machine.assertFixedProcessLockRoot(context.workspace, processLockRoot);
  assertRuntimeRestoreAdmission(restore, processLockRoot);
}
