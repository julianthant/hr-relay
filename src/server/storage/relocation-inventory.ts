import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  readSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { readPreservedTimelineSources } from "../../infra/events/timeline-import.js";
import { readPreservedGeneratedSources } from "../../infra/sqlite/generated-conversion.js";
import { ArtifactRefSchema } from "../../domain/artifacts.js";
import { NoteWireSchema, SpanEventWireSchema } from "../../events/types.js";
import type { RuntimeAdmission } from "../../infra/runtime-control/admission.js";
import type { RuntimeRelocationOperation } from "../../infra/runtime-control/admission.js";
import type { RuntimePair } from "../../infra/runtime-control/installation.js";
import { verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { ArchiveDatabase } from "../../infra/sqlite/archive-database.js";
import { backupPendingCaptureFiles } from "../../infra/compat/backup-inspection.js";
import { createCredentialStore } from "../../infra/config/credential-store.js";
import { SettingsRootAuthoritySchema } from "../../infra/compat/d331-settings-root.js";
import { D350HistoricalSettingsFileRecordSchema, D350HistoricalSettingsRootAuthoritySchema } from "../../infra/compat/d350-settings-v2-backup.js";
import { SettingsFileRecordSchema } from "../../domain/config/settings.js";
import { ProtectedStoreRecordSchema } from "../../domain/config/protected-settings.js";
import { verifyLifecyclePair } from "../../infra/sqlite/lifecycle-storage.js";

const DIGEST = /^[0-9a-f]{64}$/u;
const ARTIFACT = /^([0-9a-f]{64})\.artifact$/u;
const EVENT = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}\.jsonl$/u;
const SUSPECT = /^suspect-\d{17}-[0-9a-f-]{36}\.sqlite$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ROOT_FILES = new Set(["state.db", "state.db-wal", "state.db-shm", "archive.sqlite", "archive.sqlite-wal",
  "archive.sqlite-shm", "explorer-overrides.json"]);
const ROOT_DIRECTORIES = new Set(["archive-files", "backups", "credentials", "settings", "spans", "notes",
  "suspects", "verified-byte-scratch"]);
const SETTINGS_FILES = new Set(["settings.json", "protected.json", "authority.json", "prepare.json", "rollback.json",
  "settings.lock", "settings.lock.reaper"]);
const CREDENTIAL_FILES = new Set(["protected.json", ".protected.lock", ".protected.reaper", ".protected.reaper-claim"]);
const StoredArtifactSchema = z.strictObject({ ref: ArtifactRefSchema, payloadBase64: z.string() });
const issuedInventories = new WeakSet<object>();

export interface RelocationInventoryFile {
  readonly role: "state" | "artifact";
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly size: number;
}
export interface RelocationInventoryDirectory {
  readonly role: "state" | "artifact";
  readonly relativePath: string;
}
export interface RelocationFileInventory {
  readonly source: RuntimePair;
  readonly destination: RuntimePair;
  readonly stateEntries: readonly Readonly<{ name: string; kind: "file" | "directory" }>[];
  readonly directories: readonly RelocationInventoryDirectory[];
  readonly files: readonly RelocationInventoryFile[];
}

function inside(parent: string, path: string): boolean {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

function assertOwned(path: string, kind: "file" | "directory"): Stats {
  const info = lstatSync(path);
  if (info === undefined) throw new Error(`relocation-inventory: missing ${kind} at ${path}`);
  if (info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0
    || (kind === "file" ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) {
    throw new Error(`relocation-inventory: unsafe ${kind} shape at ${path}`);
  }
  return info;
}

function safeBytes(path: string): Buffer {
  const named = assertOwned(path, "file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size) {
      throw new Error("relocation-inventory: file changed before read");
    }
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || bytes.length !== opened.size) {
      throw new Error("relocation-inventory: file changed during read");
    }
    return bytes;
  } finally { closeSync(fd); }
}

function validateArtifact(path: string, name: string): void {
  const expected = ARTIFACT.exec(name)?.[1];
  if (expected === undefined) throw new Error(`relocation-inventory: unknown artifact ${name}`);
  const stored = StoredArtifactSchema.parse(JSON.parse(safeBytes(path).toString("utf8")));
  const bytes = Buffer.from(stored.payloadBase64, "base64");
  if (bytes.toString("base64") !== stored.payloadBase64 || stored.ref.sha256 !== expected
    || stored.ref.bytes !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`relocation-inventory: artifact bytes disagree with ${name}`);
  }
}

function verifyArtifactReference(root: string, reference: z.infer<typeof ArtifactRefSchema>): void {
  const path = join(root, `${reference.sha256}.artifact`);
  const stored = StoredArtifactSchema.parse(JSON.parse(safeBytes(path).toString("utf8")));
  validateArtifact(path, basename(path));
  if (stored.ref.id !== reference.id || stored.ref.bytes !== reference.bytes
    || stored.ref.mediaType !== reference.mediaType) throw new Error("relocation-inventory: referenced artifact identity mismatch");
}

/** All durable physical references must resolve before a root can be copied. */
export function verifyRelocationLiveReferences(input: Readonly<{ admission: RuntimeAdmission; source: RuntimePair }>): void {
  input.admission.assertExclusive();
  if (input.admission.stateRoot !== input.source.stateRoot || input.admission.artifactRoot !== input.source.artifactRoot) {
    throw new Error("relocation-inventory: live reference admission pair mismatch");
  }
  const authorityPath = join(input.source.stateRoot, "state.db");
  const authority = AuthorityDatabase.open(input.admission, { path: authorityPath, busyTimeoutMs: 5000,
    migrationOwner: "storage-relocation-inventory", openMode: "storage-doctor-read-only-no-migrate" });
  try {
    for (const reference of authority.readManagedArtifactReferences()) {
      verifyArtifactReference(input.source.artifactRoot, reference);
    }
    const pending = backupPendingCaptureFiles(input.admission, authorityPath);
    const archivePath = join(input.source.stateRoot, "archive.sqlite");
    if (lstatSync(archivePath, { throwIfNoEntry: false }) === undefined) {
      if (pending.length > 0) throw new Error("relocation-inventory: pending archive file has no archive database");
    } else {
      const archive = new ArchiveDatabase(input.admission, archivePath, { readOnly: true });
      try {
        for (const reference of [...archive.fileReferences(false), ...pending]) archive.readFile(reference);
      } finally { archive.close(); }
    }
  } finally { authority.close(); }
  const credentialPath = join(input.source.stateRoot, "credentials", "protected.json");
  if (lstatSync(credentialPath, { throwIfNoEntry: false }) !== undefined) {
    createCredentialStore({ admission: input.admission, stateRoot: input.source.stateRoot }).read();
  }
  const settingsRoot = join(input.source.stateRoot, "settings");
  for (const [name, schema] of [
    ["settings.json", z.union([SettingsFileRecordSchema, D350HistoricalSettingsFileRecordSchema])],
    ["protected.json", ProtectedStoreRecordSchema],
    ["authority.json", z.union([SettingsRootAuthoritySchema, D350HistoricalSettingsRootAuthoritySchema])],
  ] as const) {
    const path = join(settingsRoot, name);
    if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) schema.parse(JSON.parse(safeBytes(path).toString("utf8")));
  }
}

function validateName(role: "state" | "artifact", relativePath: string, kind: "file" | "directory", path: string): void {
  const parts = relativePath.split(sep);
  const [top, name] = parts;
  if (role === "artifact") {
    if (parts.length !== 1 || kind !== "file" || top === undefined) throw new Error("relocation-inventory: unknown artifact entry");
    validateArtifact(path, top);
    return;
  }
  if (top === undefined) throw new Error("relocation-inventory: empty state entry");
  if (parts.length === 1) {
    if (kind === "file" ? ROOT_FILES.has(top) : ROOT_DIRECTORIES.has(top)) return;
    throw new Error(`relocation-inventory: unknown state entry ${top}`);
  }
  const knownPrivateName = name !== undefined && (top === "credentials" && CREDENTIAL_FILES.has(name)
    || top === "settings" && SETTINGS_FILES.has(name));
  if (name === undefined || (!SAFE_NAME.test(name) && !knownPrivateName) || parts.length > 8) {
    throw new Error(`relocation-inventory: unsafe state descendant ${relativePath}`);
  }
  if (top === "archive-files") {
    if (parts.length !== 2 || kind !== "file" || !DIGEST.test(name)) throw new Error("relocation-inventory: unknown archive file");
    if (createHash("sha256").update(safeBytes(path)).digest("hex") !== name) throw new Error("relocation-inventory: archive file digest mismatch");
    return;
  }
  if (top === "credentials" || top === "settings") {
    if (parts.length !== 2 || kind !== "file" || !(top === "credentials" ? CREDENTIAL_FILES : SETTINGS_FILES).has(name)) {
      throw new Error(`relocation-inventory: unknown ${top} entry`);
    }
    if (top === "credentials" && name !== "protected.json") throw new Error("relocation-inventory: credential write lock is present");
    if (top === "settings" && (name === "settings.lock" || name === "settings.lock.reaper"
      || name === "prepare.json" || name === "rollback.json")) {
      throw new Error("relocation-inventory: settings write or recovery is pending");
    }
    return;
  }
  if (top === "spans" || top === "notes") {
    const eventFile = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(name);
    if (parts.length !== 2 || kind !== "file" || !EVENT.test(name) || eventFile === null
      || !z.iso.date().safeParse(eventFile[2]).success) throw new Error("relocation-inventory: unknown event stream entry");
    const bytes = safeBytes(path).toString("utf8");
    if (bytes !== "" && !bytes.endsWith("\n")) throw new Error("relocation-inventory: incomplete event stream line");
    for (const line of bytes.split("\n").slice(0, -1)) {
      if (line === "") throw new Error("relocation-inventory: empty event stream line");
      try {
        const record = top === "spans" ? SpanEventWireSchema.parse(JSON.parse(line)) : NoteWireSchema.parse(JSON.parse(line));
        if (record.workflow !== eventFile[1]) throw new Error("event workflow differs from file");
      } catch { throw new Error("relocation-inventory: invalid event stream record"); }
    }
    return;
  }
  if (top === "suspects") {
    if (parts.length !== 2 || kind !== "file" || !SUSPECT.test(name)) throw new Error("relocation-inventory: unknown suspect entry");
    return;
  }
  if (top === "verified-byte-scratch") throw new Error("relocation-inventory: scratch directory is not empty");
  if (top === "backups") {
    if (parts[1] !== "authority" || !parts.every((part) => SAFE_NAME.test(part))) {
      throw new Error("relocation-inventory: unknown backup entry");
    }
    return;
  }
  throw new Error(`relocation-inventory: unknown state descendant ${relativePath}`);
}

export async function verifyRelocationBackupTree(input: Readonly<{ admission: RuntimeAdmission; operation: RuntimeRelocationOperation;
  stateRoot: string }>): Promise<void> {
  input.admission.assertStateRoot(input.stateRoot);
  const inventory = input.operation.inventory();
  const witness = input.operation.verifiedSourceControlEntries();
  if (inventory.source.stateRoot !== input.stateRoot || witness.source.stateRoot !== input.stateRoot
    || input.admission.stateRoot !== input.stateRoot) throw new Error("relocation-inventory: backup source is not operation-bound");
  const allowedSourceIdentities = new Set([inventory.source,
    ...input.operation.readPriorReceipts().map((receipt) => receipt.source)]
    .map((pair) => AuthorityDatabase.sourceDatabaseIdentity(join(pair.stateRoot, "state.db"))));
  const backups = join(input.stateRoot, "backups");
  if (lstatSync(backups, { throwIfNoEntry: false }) === undefined) return;
  assertOwned(backups, "directory");
  const top = readdirSync(backups);
  if (top.some((name) => name !== "authority")) throw new Error("relocation-inventory: unknown backup root entry");
  const root = join(backups, "authority");
  if (lstatSync(root, { throwIfNoEntry: false }) === undefined) return;
  assertOwned(root, "directory");
  const names = readdirSync(root).sort();
  const expected = new Set<string>();
  const verifiedBackups: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".manifest.json"))) {
    const verified = await verifyBackupManifestAtPath(input.admission, join(root, name));
    verifiedBackups.push(verified);
    if (!allowedSourceIdentities.has(verified.manifest.sourceDatabaseIdentity)) {
      throw new Error("relocation-inventory: backup belongs to an unrecognized source identity");
    }
    expected.add(name);
    expected.add(verified.manifest.backupFileName);
    if (verified.manifest.manifestVersion === 2) {
      for (const file of verified.manifest.files) expected.add(file.backupFileName);
    }
    const paired = `${name}.lifecycle.json`;
    if (!names.includes(paired)) continue;
    const pair = await verifyLifecyclePair(input.admission, join(root, paired));
    if (pair.pair.sourceDatabaseIdentity !== verified.manifest.sourceDatabaseIdentity
      || pair.pair.liveManifest !== name) throw new Error("relocation-inventory: paired backup source mismatch");
    expected.add(paired);
    expected.add(pair.pair.archiveFile);
    expected.add(pair.pair.fileDirectory);
    const fileRoot = join(root, pair.pair.fileDirectory);
    assertOwned(fileRoot, "directory");
    const files = readdirSync(fileRoot).sort();
    const referenced = [...new Set(pair.pair.files.map((file) => file.digest))].sort();
    if (files.join("\0") !== referenced.join("\0")) throw new Error("relocation-inventory: paired archive file membership mismatch");
  }
  for (const preserved of ["timeline-sources", "generated-sources"] as const) {
    if (!names.includes(preserved)) continue;
    expected.add(preserved);
    const parent = join(root, preserved);
    assertOwned(parent, "directory");
    for (const digest of readdirSync(parent)) {
      if (!DIGEST.test(digest)) throw new Error("relocation-inventory: uncommitted preserved source copy");
      const directory = join(parent, digest);
      assertOwned(directory, "directory");
      const admitted = verifiedBackups.some((backup) => {
        try {
          if (preserved === "timeline-sources") readPreservedTimelineSources(directory, digest, backup);
          else readPreservedGeneratedSources(directory, digest, backup);
          return true;
        } catch { return false; }
      });
      if (!admitted) throw new Error(`relocation-inventory: unbound ${preserved} copy`);
    }
  }
  for (const name of names) {
    if (!expected.has(name)) throw new Error(`relocation-inventory: unreferenced backup entry ${name}`);
  }
}

function walk(root: string, role: "state" | "artifact", skip: ReadonlySet<string>,
  directories: RelocationInventoryDirectory[], files: RelocationInventoryFile[]): void {
  assertOwned(root, "directory");
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (skip.has(path)) continue;
      const rel = relative(root, path);
      const info = lstatSync(path);
      const kind = info.isDirectory() ? "directory" : "file";
      assertOwned(path, kind);
      validateName(role, rel, kind, path);
      if (kind === "directory") {
        directories.push(Object.freeze({ role, relativePath: rel }));
        visit(path);
      } else files.push(Object.freeze({ role, relativePath: rel, sourcePath: path, size: info.size }));
    }
  };
  visit(root);
}

export function inspectRelocationFiles(input: Readonly<{ admission: RuntimeAdmission; source: RuntimePair;
  destination: RuntimePair; fixedLockRoot: string;
  operation?: RuntimeRelocationOperation }>): RelocationFileInventory {
  input.admission.assertExclusive();
  input.admission.assertStorageRootsSafe();
  if (input.admission.stateRoot !== input.source.stateRoot || input.admission.artifactRoot !== input.source.artifactRoot) {
    throw new Error("relocation-inventory: admission source pair mismatch");
  }
  const stateMoved = input.source.stateRoot !== input.destination.stateRoot;
  const artifactMoved = input.source.artifactRoot !== input.destination.artifactRoot;
  if (!stateMoved && !artifactMoved) throw new Error("relocation-inventory: unchanged pair");
  if (stateMoved && !artifactMoved && inside(input.source.stateRoot, input.source.artifactRoot)) {
    throw new Error("relocation-inventory: state-only move would strand nested artifacts");
  }
  const directories: RelocationInventoryDirectory[] = [];
  const files: RelocationInventoryFile[] = [];
  const stateEntries: { name: string; kind: "file" | "directory" }[] = [];
  const control = input.operation?.inventory();
  const witness = input.operation?.verifiedSourceControlEntries();
  const locator = control === undefined ? undefined : input.admission.locator;
  if (control !== undefined && (locator?.installationId !== control.installationId || witness === undefined
    || witness.source.stateRoot !== input.source.stateRoot || witness.source.artifactRoot !== input.source.artifactRoot
    || control.destination.stateRoot !== input.destination.stateRoot || control.destination.artifactRoot !== input.destination.artifactRoot
    )) {
    throw new Error("relocation-inventory: operation context mismatch");
  }
  if (witness === undefined) {
    for (const root of [input.source.stateRoot, input.source.artifactRoot]) {
      if (lstatSync(join(root, ".runtime-owner.json"), { throwIfNoEntry: false }) !== undefined) {
        throw new Error("relocation-inventory: unvalidated ownership witness");
      }
    }
  }
  if (stateMoved) {
    const excluded = new Set(witness?.state ?? []);
    if (witness === undefined && inside(input.source.stateRoot, input.fixedLockRoot)) {
      excluded.add(relative(input.source.stateRoot, input.fixedLockRoot).split(sep)[0] ?? "");
    }
    for (const name of readdirSync(input.source.stateRoot).sort()) {
      if (excluded.has(name)) continue;
      const path = join(input.source.stateRoot, name);
      const info = lstatSync(path);
      stateEntries.push(Object.freeze({ name, kind: info.isDirectory() ? "directory" : "file" }));
    }
    const skipped = new Set([...excluded].map((name) => join(input.source.stateRoot, name)));
    if (artifactMoved && inside(input.source.stateRoot, input.source.artifactRoot)) skipped.add(input.source.artifactRoot);
    walk(input.source.stateRoot, "state", skipped, directories, files);
  }
  if (artifactMoved) walk(input.source.artifactRoot, "artifact",
    new Set((witness?.artifact ?? []).map((name) => join(input.source.artifactRoot, name))), directories, files);
  const inventory = Object.freeze({ source: Object.freeze({ ...input.source }), destination: Object.freeze({ ...input.destination }),
    stateEntries: Object.freeze(stateEntries), directories: Object.freeze(directories), files: Object.freeze(files) });
  issuedInventories.add(inventory);
  return inventory;
}

function byteDigest(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let amount = 0;
    while ((amount = readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, amount));
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("relocation-inventory: file changed during verification");
    }
    return digest.digest("hex");
  } finally { closeSync(fd); }
}

const NATIVE_DATABASE_ENTRIES = new Set(["state.db", "state.db-wal", "state.db-shm",
  "archive.sqlite", "archive.sqlite-wal", "archive.sqlite-shm"]);

/** Secret-bearing bytes are compared in memory and never placed in a receipt. */
export function verifyRelocationFileCopies(input: Readonly<{ sourceAdmission: RuntimeAdmission;
  destinationAdmission: RuntimeAdmission; inventory: RelocationFileInventory }>): void {
  input.sourceAdmission.assertLive();
  input.destinationAdmission.assertLive();
  if (!issuedInventories.has(input.inventory)
    || input.sourceAdmission.stateRoot !== input.inventory.source.stateRoot
    || input.sourceAdmission.artifactRoot !== input.inventory.source.artifactRoot
    || input.destinationAdmission.stateRoot !== input.inventory.destination.stateRoot
    || input.destinationAdmission.artifactRoot !== input.inventory.destination.artifactRoot) {
    throw new Error("relocation-inventory: unissued verification pair");
  }
  for (const directory of input.inventory.directories) {
    if (directory.role === "state" && input.inventory.source.stateRoot === input.inventory.destination.stateRoot) continue;
    const root = directory.role === "state" ? input.inventory.destination.stateRoot : input.inventory.destination.artifactRoot;
    assertOwned(join(root, directory.relativePath), "directory");
  }
  for (const file of input.inventory.files) {
    if (file.role === "state" && (input.inventory.source.stateRoot === input.inventory.destination.stateRoot
      || NATIVE_DATABASE_ENTRIES.has(file.relativePath))) continue;
    const destinationRoot = file.role === "state" ? input.inventory.destination.stateRoot : input.inventory.destination.artifactRoot;
    const target = join(destinationRoot, file.relativePath);
    if (file.role === "state") input.destinationAdmission.assertStateRoot(target);
    else input.destinationAdmission.assertArtifactRoot(target);
    const source = assertOwned(file.sourcePath, "file");
    const destination = assertOwned(target, "file");
    if (source.size !== file.size || destination.size !== source.size || byteDigest(file.sourcePath) !== byteDigest(target)) {
      throw new Error("relocation-inventory: copied file bytes changed");
    }
  }
}

export function verifyRetainedRelocationCopies(input: Readonly<{ operation: RuntimeRelocationOperation;
  sourceAdmission: RuntimeAdmission; destinationAdmission: RuntimeAdmission }>): void {
  const pending = input.operation.inventory();
  if (pending.phase !== "retained" && pending.phase !== "switched") {
    throw new Error("relocation-inventory: retained source verification requires complete retention");
  }
  const witness = input.operation.verifiedSourceControlEntries();
  if (input.sourceAdmission.stateRoot !== witness.source.stateRoot
    || input.sourceAdmission.artifactRoot !== witness.source.artifactRoot
    || input.destinationAdmission.stateRoot !== pending.destination.stateRoot
    || input.destinationAdmission.artifactRoot !== pending.destination.artifactRoot) {
    throw new Error("relocation-inventory: retained verification pair mismatch");
  }
  input.sourceAdmission.assertStorageRootsSafe();
  input.destinationAdmission.assertStorageRootsSafe();
  for (const role of ["state", "artifact"] as const) {
    const original = pending.source[`${role}Root`];
    const target = pending.destination[`${role}Root`];
    if (original === target) continue;
    const root = witness.source[`${role}Root`];
    const directories: RelocationInventoryDirectory[] = [];
    const files: RelocationInventoryFile[] = [];
    const skipped = new Set((role === "state" ? witness.state : witness.artifact).map((name) => join(root, name)));
    if (role === "state" && pending.source.artifactRoot !== pending.destination.artifactRoot
      && inside(pending.source.stateRoot, pending.source.artifactRoot)) {
      skipped.add(witness.source.artifactRoot);
    }
    walk(root, role, skipped, directories, files);
    for (const directory of directories) assertOwned(join(target, directory.relativePath), "directory");
    for (const file of files) {
      if (role === "state" && NATIVE_DATABASE_ENTRIES.has(file.relativePath)) continue;
      const destination = join(target, file.relativePath);
      if (role === "state") input.destinationAdmission.assertStateRoot(destination);
      else input.destinationAdmission.assertArtifactRoot(destination);
      const destinationInfo = assertOwned(destination, "file");
      if (destinationInfo.size !== file.size || byteDigest(file.sourcePath) !== byteDigest(destination)) {
        throw new Error("relocation-inventory: retained source and destination bytes differ");
      }
    }
  }
}

function ensureDestinationDirectory(root: string, relativeDirectory: string): void {
  assertOwned(root, "directory");
  let parent = root;
  for (const part of relativeDirectory.split(sep).filter(Boolean)) {
    if (!SAFE_NAME.test(part)) throw new Error("relocation-inventory: unsafe destination directory name");
    parent = join(parent, part);
    if (lstatSync(parent, { throwIfNoEntry: false }) === undefined) mkdirSync(parent, { mode: 0o700 });
    assertOwned(parent, "directory");
  }
}

export function prepareRelocationDirectories(input: Readonly<{ destinationAdmission: RuntimeAdmission;
  inventory: RelocationFileInventory }>): void {
  input.destinationAdmission.assertWritable();
  if (!issuedInventories.has(input.inventory)
    || input.destinationAdmission.stateRoot !== input.inventory.destination.stateRoot
    || input.destinationAdmission.artifactRoot !== input.inventory.destination.artifactRoot) {
    throw new Error("relocation-inventory: directory inventory is not destination-bound");
  }
  for (const directory of input.inventory.directories) {
    if (directory.role === "state" && input.inventory.source.stateRoot === input.inventory.destination.stateRoot) continue;
    const root = directory.role === "state" ? input.inventory.destination.stateRoot : input.inventory.destination.artifactRoot;
    if (directory.role === "state") input.destinationAdmission.assertStateRoot(join(root, directory.relativePath));
    else input.destinationAdmission.assertArtifactRoot(join(root, directory.relativePath));
    ensureDestinationDirectory(root, directory.relativePath);
  }
}

export function copyRelocationFile(input: Readonly<{ sourceAdmission: RuntimeAdmission; destinationAdmission: RuntimeAdmission;
  inventory: RelocationFileInventory; file: RelocationInventoryFile; operationId: string;
  hooks?: Readonly<{ beforePublish?(): void; afterPublish?(): void }> }>): void {
  input.sourceAdmission.assertLive();
  input.destinationAdmission.assertWritable();
  if (!issuedInventories.has(input.inventory) || !input.inventory.files.includes(input.file)) {
    throw new Error("relocation-inventory: unissued file inventory");
  }
  z.uuid().parse(input.operationId);
  if (input.sourceAdmission.stateRoot !== input.inventory.source.stateRoot
    || input.sourceAdmission.artifactRoot !== input.inventory.source.artifactRoot
    || input.destinationAdmission.stateRoot !== input.inventory.destination.stateRoot
    || input.destinationAdmission.artifactRoot !== input.inventory.destination.artifactRoot) {
    throw new Error("relocation-inventory: copy admission pair mismatch");
  }
  const sourceRoot = input.file.role === "state" ? input.inventory.source.stateRoot : input.inventory.source.artifactRoot;
  const destinationRoot = input.file.role === "state" ? input.inventory.destination.stateRoot : input.inventory.destination.artifactRoot;
  if (input.file.relativePath.split(sep).some((part) => part === "" || part === "." || part === "..")
    || input.file.sourcePath !== join(sourceRoot, input.file.relativePath)) {
    throw new Error("relocation-inventory: copy source path mismatch");
  }
  const destinationPath = join(destinationRoot, input.file.relativePath);
  if (input.file.role === "state") input.destinationAdmission.assertStateRoot(destinationPath);
  else input.destinationAdmission.assertArtifactRoot(destinationPath);
  const source = assertOwned(input.file.sourcePath, "file");
  if (source.size !== input.file.size) throw new Error("relocation-inventory: source size changed");
  const parent = dirname(resolve(destinationPath));
  ensureDestinationDirectory(destinationRoot, relative(destinationRoot, parent));
  const temporaryPath = join(parent, `.relocation-${input.operationId}-${basename(destinationPath)}.tmp`);
  const existing = lstatSync(destinationPath, { throwIfNoEntry: false });
  if (existing !== undefined) {
    const temporary = lstatSync(temporaryPath, { throwIfNoEntry: false });
    if (existing.nlink === 2 && temporary !== undefined && temporary.nlink === 2
      && existing.isFile() && temporary.isFile() && !existing.isSymbolicLink() && !temporary.isSymbolicLink()
      && existing.dev === temporary.dev && existing.ino === temporary.ino
      && (process.getuid === undefined || existing.uid === process.getuid()) && (existing.mode & 0o022) === 0) {
      if (existing.size !== source.size || byteDigest(input.file.sourcePath) !== byteDigest(destinationPath)) {
        throw new Error("relocation-inventory: published destination bytes disagree with source");
      }
      unlinkSync(temporaryPath);
      const directory = openSync(parent, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      assertOwned(destinationPath, "file");
      return;
    }
    assertOwned(destinationPath, "file");
    if (existing.size !== source.size || byteDigest(input.file.sourcePath) !== byteDigest(destinationPath)) {
      throw new Error("relocation-inventory: existing destination bytes disagree with source");
    }
    if (temporary !== undefined) throw new Error("relocation-inventory: ambiguous completed temporary copy");
    return;
  }
  const abandoned = lstatSync(temporaryPath, { throwIfNoEntry: false });
  if (abandoned !== undefined) {
    assertOwned(temporaryPath, "file");
    unlinkSync(temporaryPath);
  }
  const from = openSync(input.file.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let to: number | undefined;
  try {
    const opened = fstatSync(from);
    if (opened.dev !== source.dev || opened.ino !== source.ino || opened.size !== source.size) {
      throw new Error("relocation-inventory: source changed before copy");
    }
    to = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let count = 0;
    while ((count = readSync(from, buffer, 0, buffer.length, null)) > 0) {
      input.sourceAdmission.assertLive();
      input.destinationAdmission.assertWritable();
      let offset = 0;
      while (offset < count) offset += writeSync(to, buffer, offset, count - offset);
    }
    fsyncSync(to);
    const after = fstatSync(from);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || byteDigest(input.file.sourcePath) !== byteDigest(temporaryPath)) {
      throw new Error("relocation-inventory: copied bytes disagree with source");
    }
    input.hooks?.beforePublish?.();
    linkSync(temporaryPath, destinationPath);
    input.hooks?.afterPublish?.();
    const directory = openSync(parent, constants.O_RDONLY);
    try { fsyncSync(directory); unlinkSync(temporaryPath); fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    closeSync(from);
    if (to !== undefined) closeSync(to);
  }
}
