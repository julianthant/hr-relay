import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type {
  CredentialStore,
  CredentialStoreApplyOutcome,
} from "../../domain/config/credential-store.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  ProtectedSettingsLastAppliedSchema,
  ProtectedSettingsNameSchema,
  ProtectedSettingsPatchSchema,
  type ProtectedSettingsPatch,
  ProtectedStoreRecordSchema,
  initialProtectedStoreRecord,
  type ProtectedSettingsApplyInput,
  type ProtectedStoreRecord,
} from "../../domain/config/protected-settings.js";
import {
  SettingsApplyRefusalSchema,
  type SettingsApplyRejectionCode,
} from "../../domain/config/settings.js";
import { deepFreeze } from "../../domain/immutability.js";
import { PositiveIntSchema } from "../../domain/ids.js";
import {
  ProcessStartIdentitySchema,
  observeProcessIdentity,
  type ProcessIdentityObserver,
} from "../sqlite/runtime-process-locks.js";

const CREDENTIAL_DIRECTORY_MODE = 0o700;
const CREDENTIAL_FILE_MODE = 0o600;
const MAX_PRIVATE_REQUEST_BYTES = 64_000;
const MAX_CREDENTIAL_DOCUMENT_BYTES = 16 * 1024 * 1024;
const CREDENTIAL_FILE_NAME = "protected.json";
const CREDENTIAL_LOCK_NAME = ".protected.lock";
const CREDENTIAL_REAPER_NAME = ".protected.reaper";
const CREDENTIAL_REAPER_CLAIM_NAME = ".protected.reaper-claim";

const ProtectedSettingsApplyPreflightSchema = ProtectedSettingsApplyInputSchema
  .omit({ entries: true })
  .extend({ entries: z.unknown() });

const SetValueIdsSchema = z.strictObject({
  ucpathUserId: z.uuid().optional(),
  ucpathPassword: z.uuid().optional(),
  timekeeperName: z.uuid().optional(),
  sharepointOnboardingRosterUrl: z.uuid().optional(),
  activityPersonPseudonym: z.uuid().optional(),
  separationsKualiFinalizationCanaryDocumentNumber: z.uuid().optional(),
  personLookupCanaryEid: z.uuid().optional(),
});

const CredentialHistoryEntrySchema = z.strictObject({
  request: ProtectedSettingsApplyInputSchema,
  setValueIds: SetValueIdsSchema,
});

const CredentialUpgradeBindingSchema = z.strictObject({
  upgradeId: z.string().regex(/^[a-f0-9]{64}$/u),
  entries: ProtectedSettingsPatchSchema,
});

const CredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  record: ProtectedStoreRecordSchema,
  history: z.array(CredentialHistoryEntrySchema),
  upgradeBinding: CredentialUpgradeBindingSchema.optional(),
});

const CredentialLockRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(["writer", "reaper"]),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  acquisitionId: z.uuid(),
});

type CredentialHistoryEntry = z.infer<typeof CredentialHistoryEntrySchema>;
type CredentialDocument = z.infer<typeof CredentialDocumentSchema>;
type CredentialLockRecord = z.infer<typeof CredentialLockRecordSchema>;

export interface CredentialStoreIds {
  readonly randomUUID: () => string;
}

export interface CredentialStoreHooks {
  /** Test seam after the staged document is durable and before authority rename. */
  readonly beforeRename?: () => void;
  /** Test seam at the uncertain boundary after authority rename and before directory fsync. */
  readonly afterRename?: () => void;
  /** Existing runtime-lock observation seam, used to prove PID reuse without guessing liveness. */
  readonly observeProcessIdentity?: ProcessIdentityObserver;
}

export interface CredentialStoreOptions {
  readonly stateRoot: string;
  readonly ids?: CredentialStoreIds;
  readonly hooks?: CredentialStoreHooks;
}

/** The protected document was replaced, but the caller did not observe durable completion. */
export class CredentialStoreCommitUncertainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`credential-commit-uncertain: ${message}`, options);
    this.name = "CredentialStoreCommitUncertainError";
  }
}

class CredentialStoreLockUnavailableError extends Error {
  constructor() {
    super("credential store lock is unavailable");
    this.name = "CredentialStoreLockUnavailableError";
  }
}

interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}

interface ReadDocument {
  readonly bytes: Uint8Array;
  readonly document: CredentialDocument;
  readonly identity: DirectoryIdentity;
}

interface CurrentDocument {
  readonly bytes: Uint8Array | undefined;
  readonly document: CredentialDocument;
}

interface ReadLock {
  readonly bytes: Uint8Array;
  readonly record: CredentialLockRecord;
  readonly identity: DirectoryIdentity;
}

interface CredentialLockHandle {
  readonly record: CredentialLockRecord;
  readonly release: () => void;
}

interface LockedResult<Result> {
  readonly committed: boolean;
  readonly result: Result;
}

const expectedUid = typeof process.getuid === "function" ? process.getuid() : undefined;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function frozenRefusal(
  code: SettingsApplyRejectionCode,
  message: string,
): CredentialStoreApplyOutcome {
  return deepFreeze(SettingsApplyRefusalSchema.parse({ state: "rejected", code, message }));
}

function conflict(currentRevision: number, expectedRevision: number): CredentialStoreApplyOutcome {
  return deepFreeze(SettingsApplyRefusalSchema.parse({
    state: "conflict",
    currentRevision,
    message: `credential revision ${String(expectedRevision)} is stale; current revision is ${String(currentRevision)}`,
  }));
}

function admit(input: unknown): ProtectedSettingsApplyInput | CredentialStoreApplyOutcome {
  const preflight = ProtectedSettingsApplyPreflightSchema.safeParse(input);
  if (!preflight.success) {
    return frozenRefusal("invalid-value", "credential request is invalid");
  }
  if (preflight.data.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
    return frozenRefusal("schema-mismatch", "credential schema does not match the current catalog");
  }
  const parsed = ProtectedSettingsApplyInputSchema.safeParse(input);
  if (!parsed.success) {
    const isUnknownKey = parsed.error.issues.some((issue) => issue.code === "unrecognized_keys");
    return frozenRefusal(
      isUnknownKey ? "not-editable" : "invalid-value",
      isUnknownKey ? "credential request contains a non-editable key" : "credential request is invalid",
    );
  }
  return parsed.data;
}

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Verify each component before descendants; retain identities across every operation. */
function noSymlinkAncestry(path: string, identities: Map<string, DirectoryIdentity>): boolean {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split(/[/\\]+/u).filter((segment) => segment !== "");
  let cursor = root;
  const paths = [root, ...segments.map((segment) => { cursor = join(cursor, segment); return cursor; })];
  for (const component of paths) {
    const status = lstatSync(component, { throwIfNoEntry: false });
    const prior = identities.get(component);
    if (status === undefined) {
      if (prior !== undefined) throw new Error("directory-integrity: credential ancestor disappeared");
      return false;
    }
    if (status.isSymbolicLink()) throw new Error("directory-integrity: credential path ancestry contains a symbolic link");
    if (!status.isDirectory()) throw new Error("directory-integrity: credential path ancestry contains a non-directory");
    if (expectedUid === undefined || (status.uid !== expectedUid && status.uid !== 0)) {
      throw new Error("directory-integrity: credential ancestor has an untrusted owner");
    }
    if ((status.mode & 0o022) !== 0 && (status.mode & 0o1000) === 0) {
      throw new Error("directory-integrity: credential ancestor is group/world-writable without sticky protection");
    }
    const observed = { device: status.dev, inode: status.ino };
    if (prior !== undefined && !sameDirectory(prior, observed)) throw new Error("directory-integrity: credential ancestor identity changed");
    identities.set(component, observed);
  }
  return true;
}

function statDirectory(path: string, label: string, exactMode?: number): DirectoryIdentity {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    throw new Error(`directory-integrity: ${label} is unavailable`);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`directory-integrity: ${label} is not a private directory`);
  }
  if (expectedUid !== undefined && status.uid !== expectedUid) {
    throw new Error(`directory-integrity: ${label} is owned by another user`);
  }
  if (exactMode !== undefined && (status.mode & 0o7777) !== exactMode) {
    throw new Error(`directory-integrity: ${label} permissions must be 0700`);
  }
  return { device: status.dev, inode: status.ino };
}

function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function removeExactPath(
  path: string,
  expected: DirectoryIdentity,
  missingIsSettled: boolean,
  changedMessage: string,
): boolean {
  let status;
  try {
    status = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    throw new Error(changedMessage, { cause: error });
  }
  if (status === undefined) {
    if (missingIsSettled) return false;
    throw new Error(changedMessage);
  }
  if (!status.isFile() || status.isSymbolicLink()
    || status.dev !== expected.device || status.ino !== expected.inode
    || (expectedUid !== undefined && status.uid !== expectedUid)) {
    throw new Error(changedMessage);
  }
  unlinkSync(path);
  return true;
}

function ensureChildDirectory(
  parent: string,
  child: string,
  label: string,
  creationMode: number,
  requiredMode?: number,
): void {
  statDirectory(parent, `${label} parent`);
  try {
    mkdirSync(child, { mode: creationMode });
    fsyncPath(parent);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw new Error(`directory-integrity: ${label} could not be created`, { cause: error });
    }
  }
  statDirectory(child, label, requiredMode);
}

function encodePrivate(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJsonStringify(value)}\n`);
}

function privateEqual(left: unknown, right: unknown): boolean {
  const leftBytes = encodePrivate(left);
  const rightBytes = encodePrivate(right);
  if (leftBytes.byteLength > MAX_PRIVATE_REQUEST_BYTES
    || rightBytes.byteLength > MAX_PRIVATE_REQUEST_BYTES) {
    throw new Error("credential private comparison exceeds its fixed bound");
  }
  const leftPadded = Buffer.alloc(MAX_PRIVATE_REQUEST_BYTES + 4);
  const rightPadded = Buffer.alloc(MAX_PRIVATE_REQUEST_BYTES + 4);
  leftPadded.writeUInt32BE(leftBytes.byteLength);
  rightPadded.writeUInt32BE(rightBytes.byteLength);
  leftPadded.set(leftBytes, 4);
  rightPadded.set(rightBytes, 4);
  return timingSafeEqual(leftPadded, rightPadded);
}

function lastApplied(request: ProtectedSettingsApplyInput) {
  return ProtectedSettingsLastAppliedSchema.parse({
    commandId: request.commandId,
    commandFingerprint: request.commandFingerprint,
    expectedRevision: request.expectedRevision,
    protectedSchemaHash: request.protectedSchemaHash,
    writeId: request.writeId,
  });
}

function replayHistory(history: readonly CredentialHistoryEntry[]): ProtectedStoreRecord {
  let current = initialProtectedStoreRecord();
  const commandIds = new Set<string>();
  const writeIds = new Set<string>();
  const valueIds = new Set<string>();

  for (const entry of history) {
    const { request, setValueIds } = entry;
    if (request.expectedRevision !== current.revision
      || commandIds.has(request.commandId)
      || writeIds.has(request.writeId)) {
      throw new Error("credential history has a divergent command identity");
    }
    commandIds.add(request.commandId);
    writeIds.add(request.writeId);

    const entries = new Map<string, unknown>(Object.entries(current.entries));
    for (const name of ProtectedSettingsNameSchema.options) {
      const operation = request.entries[name];
      const valueId = setValueIds[name];
      if (operation === undefined || "clear" in operation) {
        if (valueId !== undefined) throw new Error("credential history has an unexpected value identity");
        if (operation !== undefined) entries.delete(name);
        continue;
      }
      if (valueId === undefined || valueIds.has(valueId)) {
        throw new Error("credential history has an invalid value identity");
      }
      valueIds.add(valueId);
      entries.set(name, { valueId, value: operation.set, updatedAt: request.updatedAt });
    }
    current = ProtectedStoreRecordSchema.parse({
      schemaVersion: 1,
      revision: current.revision + 1,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      entries: Object.fromEntries(entries),
      lastApplied: lastApplied(request),
    });
  }
  return current;
}

function authenticateDocument(input: unknown): CredentialDocument {
  const parsed = CredentialDocumentSchema.safeParse(input);
  if (!parsed.success) throw new Error("credential store protected.json is malformed");
  let replayed: ProtectedStoreRecord;
  try {
    replayed = replayHistory(parsed.data.history);
  } catch {
    throw new Error("credential store protected.json has malformed identity history");
  }
  if (!privateEqual(replayed, parsed.data.record)) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  return deepFreeze(parsed.data);
}

function initialDocument(): CredentialDocument {
  return deepFreeze(CredentialDocumentSchema.parse({
    schemaVersion: 1,
    record: initialProtectedStoreRecord(),
    history: [],
  }));
}

function readPrivateDocument(path: string): ReadDocument | undefined {
  let pathStatus;
  try {
    pathStatus = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    throw new Error("credential store protected.json is unavailable", { cause: error });
  }
  if (pathStatus === undefined) return undefined;
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink() || pathStatus.nlink !== 1
    || (expectedUid !== undefined && pathStatus.uid !== expectedUid)) {
    throw new Error("directory-integrity: protected.json must be one private regular file");
  }

  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new Error("credential store protected.json is unavailable");
  }
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o7777) !== CREDENTIAL_FILE_MODE
      || (expectedUid !== undefined && before.uid !== expectedUid)) {
      throw new Error("directory-integrity: protected.json permissions or identity are invalid");
    }
    if (before.size > MAX_CREDENTIAL_DOCUMENT_BYTES) {
      throw new Error("document-too-large: credential store protected.json exceeds its private bound");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const live = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mode !== after.mode || before.uid !== after.uid || before.nlink !== after.nlink
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || live.dev !== before.dev || live.ino !== before.ino || bytes.byteLength !== before.size) {
      throw new Error("directory-integrity: protected.json moved while it was read");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("credential store protected.json is malformed");
    }
    return {
      bytes,
      document: authenticateDocument(decoded),
      identity: { device: before.dev, inode: before.ino },
    };
  } finally {
    closeSync(descriptor);
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function readCredentialLock(
  path: string,
  kind: CredentialLockRecord["kind"],
  allowedLinkCounts: readonly number[] = [1],
): ReadLock | undefined {
  let pathStatus;
  try {
    pathStatus = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    throw new Error("directory-integrity: credential lock is unavailable", { cause: error });
  }
  if (pathStatus === undefined) return undefined;
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink() || !allowedLinkCounts.includes(pathStatus.nlink)
    || (pathStatus.mode & 0o7777) !== CREDENTIAL_FILE_MODE
    || (expectedUid !== undefined && pathStatus.uid !== expectedUid)) {
    throw new Error("directory-integrity: credential lock permissions or identity are invalid");
  }

  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw new Error("directory-integrity: credential lock is unavailable", { cause: error });
  }
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || !allowedLinkCounts.includes(before.nlink) || before.size > 4_096
      || (before.mode & 0o7777) !== CREDENTIAL_FILE_MODE
      || (expectedUid !== undefined && before.uid !== expectedUid)) {
      throw new Error("directory-integrity: credential lock permissions or identity are invalid");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const live = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mode !== after.mode || before.uid !== after.uid || before.nlink !== after.nlink
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || live.dev !== before.dev || live.ino !== before.ino || bytes.byteLength !== before.size) {
      throw new Error("directory-integrity: credential lock moved while it was read");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("directory-integrity: credential lock is malformed");
    }
    const parsed = CredentialLockRecordSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.kind !== kind) {
      throw new Error("directory-integrity: credential lock is malformed");
    }
    return {
      bytes,
      record: parsed.data,
      identity: { device: before.dev, inode: before.ino },
    };
  } finally {
    closeSync(descriptor);
  }
}

function releaseLock(
  lockPath: string,
  credentialDirectory: string,
  expected: CredentialLockRecord,
): void {
  const current = readCredentialLock(lockPath, expected.kind);
  if (current === undefined || !privateEqual(current.record, expected)) {
    throw new Error("directory-integrity: credential lock changed before release");
  }
  removeExactPath(
    lockPath,
    current.identity,
    false,
    "directory-integrity: credential lock changed before release",
  );
  fsyncPath(credentialDirectory);
}

function removeCreatedLock(
  path: string,
  credentialDirectory: string,
  expected: DirectoryIdentity,
): void {
  removeExactPath(
    path,
    expected,
    false,
    "directory-integrity: new credential lock changed during cleanup",
  );
  fsyncPath(credentialDirectory);
}

function removeTemporary(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw new Error("credential store temporary cleanup failed", { cause: error });
    }
  }
}

/**
 * Create D336's independent protected authority under
 * `<stateRoot>/credentials/protected.json`, where stateRoot is the `.tracker` root.
 */
/** Private migration binding; never served as a command or public readback. */
export interface CredentialUpgradeStore extends CredentialStore {
  bindUpgrade(upgradeId: string, entries: ProtectedSettingsPatch): void;
  /** Pre-SQL preflight admits a first import, but authenticates any surviving binding. */
  verifyUpgradePreflight(upgradeId: string, entries: ProtectedSettingsPatch): void;
  verifyUpgradeBinding(upgradeId: string, entries: ProtectedSettingsPatch): void;
}

export function createCredentialStore(options: CredentialStoreOptions): CredentialUpgradeStore {
  const rawStateRoot = z.string().min(1).parse(options.stateRoot);
  if (rawStateRoot.split(/[/\\]+/u).includes("..")) throw new Error("directory-integrity: raw credential path contains a '..' component");
  const stateRoot = resolve(rawStateRoot);
  const credentialDirectory = join(stateRoot, "credentials");
  const protectedPath = join(credentialDirectory, CREDENTIAL_FILE_NAME);
  const lockPath = join(credentialDirectory, CREDENTIAL_LOCK_NAME);
  const reaperPath = join(credentialDirectory, CREDENTIAL_REAPER_NAME);
  const reaperClaimPath = join(credentialDirectory, CREDENTIAL_REAPER_CLAIM_NAME);
  const ids = options.ids ?? { randomUUID };
  const hooks = options.hooks ?? {};
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  let directoryIdentity: DirectoryIdentity | undefined;
  const ancestorIdentities = new Map<string, DirectoryIdentity>();
  const ownTemporaryPaths = new Set<string>();

  function ensureDirectory(): void {
    noSymlinkAncestry(dirname(stateRoot), ancestorIdentities);
    try {
      mkdirSync(stateRoot, { recursive: true, mode: CREDENTIAL_DIRECTORY_MODE });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new Error("directory-integrity: state root could not be created", { cause: error });
      }
    }
    if (!noSymlinkAncestry(stateRoot, ancestorIdentities)) {
      throw new Error("directory-integrity: state root disappeared after creation");
    }
    statDirectory(stateRoot, "state root");
    ensureChildDirectory(
      stateRoot,
      credentialDirectory,
      "credential directory",
      CREDENTIAL_DIRECTORY_MODE,
      CREDENTIAL_DIRECTORY_MODE,
    );
    const observed = statDirectory(
      credentialDirectory,
      "credential directory",
      CREDENTIAL_DIRECTORY_MODE,
    );
    if (directoryIdentity !== undefined && !sameDirectory(directoryIdentity, observed)) {
      throw new Error("directory-integrity: credential directory identity changed");
    }
    directoryIdentity = observed;
    noSymlinkAncestry(credentialDirectory, ancestorIdentities);
  }

  function assertDirectory(): void {
    ensureDirectory();
    const expectedIdentity = directoryIdentity;
    if (expectedIdentity === undefined) throw new Error("directory-integrity: credential directory has no identity");
    const permitted = new Set([
      CREDENTIAL_FILE_NAME,
      CREDENTIAL_LOCK_NAME,
      CREDENTIAL_REAPER_NAME,
      CREDENTIAL_REAPER_CLAIM_NAME,
    ]);
    for (const temporaryPath of ownTemporaryPaths) {
      permitted.add(temporaryPath.slice(credentialDirectory.length + 1));
    }
    for (const name of readdirSync(credentialDirectory)) {
      if (!permitted.has(name)) {
        throw new Error(`directory-integrity: unexpected credential-store entry ${name}`);
      }
    }
    const after = statDirectory(credentialDirectory, "credential directory", CREDENTIAL_DIRECTORY_MODE);
    if (!sameDirectory(expectedIdentity, after)) {
      throw new Error("directory-integrity: credential directory moved during inspection");
    }
  }

  function ownerIsAlive(record: CredentialLockRecord): boolean {
    const observation = observer(record.pid);
    return observation.state === "alive"
      && observation.identity.platform === record.processIdentity.platform
      && observation.identity.startToken === record.processIdentity.startToken;
  }

  function ownLockRecord(kind: CredentialLockRecord["kind"]): CredentialLockRecord {
    const observation = observer(process.pid);
    if (observation.state === "gone") {
      throw new Error("credential lock refused because the current process identity is unavailable");
    }
    return CredentialLockRecordSchema.parse({
      schemaVersion: 1,
      kind,
      pid: process.pid,
      processIdentity: observation.identity,
      acquisitionId: z.uuid().parse(ids.randomUUID()),
    });
  }

  function createLock(path: string, record: CredentialLockRecord): boolean {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        CREDENTIAL_FILE_MODE,
      );
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw new Error("credential store lock could not be created", { cause: error });
    }
    if (descriptor === undefined) return false;
    const createdStatus = fstatSync(descriptor);
    const createdIdentity = { device: createdStatus.dev, inode: createdStatus.ino };
    let preparationError: Error | undefined;
    try {
      if (!createdStatus.isFile() || createdStatus.nlink !== 1
        || (createdStatus.mode & 0o777) !== CREDENTIAL_FILE_MODE
        || (expectedUid !== undefined && createdStatus.uid !== expectedUid)) {
        throw new Error("directory-integrity: new credential lock permissions or identity are invalid");
      }
      writeFileSync(descriptor, encodePrivate(record));
      fsyncSync(descriptor);
    } catch (error) {
      preparationError = error instanceof Error
        ? new Error("credential store lock could not be made durable", { cause: error })
        : new Error("credential store lock could not be made durable");
    } finally {
      closeSync(descriptor);
    }

    const failWithCleanup = (error: Error): never => {
      try {
        removeCreatedLock(path, credentialDirectory, createdIdentity);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "credential lock creation failed and its owned file could not be removed",
          { cause: cleanupError },
        );
      }
      throw error;
    };
    if (preparationError !== undefined) failWithCleanup(preparationError);

    try {
      fsyncPath(credentialDirectory);
      const observed = readCredentialLock(path, record.kind);
      if (observed === undefined || !privateEqual(observed.record, record)) {
        throw new Error("directory-integrity: credential lock differs after creation");
      }
    } catch (error) {
      failWithCleanup(error instanceof Error
        ? new Error("credential store lock could not be published exactly", { cause: error })
        : new Error("credential store lock could not be published exactly"));
    }
    return true;
  }

  function assertNoExistingReaperClaim(): void {
    const claim = readCredentialLock(reaperClaimPath, "reaper", [1, 2]);
    if (claim === undefined) return;
    const existing = readCredentialLock(reaperPath, "reaper", [1, 2]);
    if (existing !== undefined && !sameDirectory(existing.identity, claim.identity)) {
      throw new Error("directory-integrity: credential reaper changed while its stale inode was claimed");
    }
    if (existing !== undefined && !privateEqual(existing.record, claim.record)) {
      throw new Error("directory-integrity: credential reaper claim disagrees with its lock");
    }
    throw new CredentialStoreLockUnavailableError();
  }

  /**
   * The successful hard-link creator alone removes the claimed inode. Other
   * contenders refuse while the claim exists, so none can unlink a replacement
   * between identity comparison and unlink.
   */
  function reapStaleReaper(): boolean {
    let claimed = false;
    try {
      linkSync(reaperPath, reaperClaimPath);
      claimed = true;
      fsyncPath(credentialDirectory);
    } catch (error) {
      if (claimed || (errorCode(error) !== "EEXIST" && errorCode(error) !== "ENOENT")) throw new Error("credential stale-reaper claim could not be created", { cause: error });
    }
    if (!claimed) return false;
    const claim = readCredentialLock(reaperClaimPath, "reaper", [2]);
    const existing = readCredentialLock(reaperPath, "reaper", [2]);
    if (claim === undefined || existing === undefined
      || !sameDirectory(existing.identity, claim.identity)
      || !privateEqual(existing.record, claim.record)) {
      throw new Error("directory-integrity: claimed credential reaper changed before stale removal");
    }
    if (ownerIsAlive(claim.record)) {
      removeExactPath(
        reaperClaimPath,
        claim.identity,
        false,
        "directory-integrity: credential reaper claim changed before release",
      );
      fsyncPath(credentialDirectory);
      throw new CredentialStoreLockUnavailableError();
    }
    removeExactPath(
      reaperPath,
      existing.identity,
      false,
      "directory-integrity: claimed credential reaper changed before stale removal",
    );
    removeExactPath(
      reaperClaimPath,
      claim.identity,
      false,
      "directory-integrity: credential reaper claim changed before release",
    );
    fsyncPath(credentialDirectory);
    return true;
  }

  function acquireReaper(): CredentialLockRecord {
    for (;;) {
      assertNoExistingReaperClaim();
      const existing = readCredentialLock(reaperPath, "reaper", [1, 2]);
      if (existing !== undefined) {
        if (readCredentialLock(reaperClaimPath, "reaper", [1, 2]) !== undefined) {
          assertNoExistingReaperClaim();
        }
        if (ownerIsAlive(existing.record)) throw new CredentialStoreLockUnavailableError();
        reapStaleReaper();
        continue;
      }
      const record = ownLockRecord("reaper");
      if (!createLock(reaperPath, record)) continue;
      return record;
    }
  }

  function recoverDeadWriterTemporary(writer: CredentialLockRecord): void {
    const temporaryNames = readdirSync(credentialDirectory).filter((name) => (
      name.startsWith(".protected.") && name.endsWith(".tmp")
    ));
    if (temporaryNames.length === 0) return;
    if (temporaryNames.length !== 1) {
      throw new Error("directory-integrity: dead credential writer left ambiguous staged documents");
    }
    const [temporaryName] = temporaryNames;
    if (temporaryName === undefined) return;
    const match = /^\.protected\.([^.]+)\.([^.]+)\.tmp$/u.exec(temporaryName);
    if (match === null
      || !z.uuid().safeParse(match[1]).success
      || !z.uuid().safeParse(match[2]).success
      || match[1] !== writer.acquisitionId) {
      throw new Error("directory-integrity: staged credential document is not owned by the dead writer");
    }
    const temporaryPath = join(credentialDirectory, temporaryName);
    const staged = readPrivateDocument(temporaryPath);
    if (staged === undefined) {
      throw new Error("directory-integrity: dead credential writer staged document disappeared");
    }
    const current = readPrivateDocument(protectedPath);
    const prior = current?.document ?? initialDocument();
    const stagedPrefix = staged.document.history.slice(0, -1);
    const stagedRequest = staged.document.history.at(-1)?.request;
    const sameHistory = (left: readonly CredentialHistoryEntry[], right: readonly CredentialHistoryEntry[]) =>
      left.length === right.length && left.every((entry, index) => privateEqual(entry, right[index]));
    const sameBinding = prior.upgradeBinding === undefined ? staged.document.upgradeBinding === undefined
      : staged.document.upgradeBinding !== undefined && privateEqual(prior.upgradeBinding, staged.document.upgradeBinding);
    const application = staged.document.history.length === prior.history.length + 1
      && sameHistory(stagedPrefix, prior.history) && sameBinding
      && stagedRequest?.expectedRevision === prior.record.revision
      && staged.document.record.revision === prior.record.revision + 1;
    const reservation = prior.upgradeBinding === undefined && staged.document.upgradeBinding !== undefined
      && prior.record.revision === 1 && sameHistory(staged.document.history, prior.history)
      && privateEqual(staged.document.record, prior.record);
    if (!application && !reservation) {
      throw new Error("directory-integrity: dead credential writer staged document is not the next transition");
    }
    removeExactPath(
      temporaryPath,
      staged.identity,
      false,
      "directory-integrity: dead credential writer staged document changed before recovery",
    );
    fsyncPath(credentialDirectory);
  }

  function acquireLock(): CredentialLockHandle {
    ensureDirectory();
    assertNoExistingReaperClaim();
    for (;;) {
      const record = ownLockRecord("writer");
      if (createLock(lockPath, record)) {
        try {
          assertDirectory();
        } catch (error) {
          try {
            releaseLock(lockPath, credentialDirectory, record);
          } catch (releaseError) {
            throw new AggregateError(
              [error, releaseError],
              "credential lock acquisition failed and its new lock could not be released",
              { cause: releaseError },
            );
          }
          throw error;
        }
        return {
          record,
          release: () => { noSymlinkAncestry(credentialDirectory, ancestorIdentities); releaseLock(lockPath, credentialDirectory, record); },
        };
      }

      const existing = readCredentialLock(lockPath, "writer");
      if (existing === undefined) continue;
      if (ownerIsAlive(existing.record)) throw new CredentialStoreLockUnavailableError();
      const reaper = acquireReaper();
      try {
        const stale = readCredentialLock(lockPath, "writer");
        if (stale !== undefined) {
          if (ownerIsAlive(stale.record)) throw new CredentialStoreLockUnavailableError();
          recoverDeadWriterTemporary(stale.record);
          releaseLock(lockPath, credentialDirectory, stale.record);
        }
      } finally {
        releaseLock(reaperPath, credentialDirectory, reaper);
      }
    }
  }

  function withLock<Result>(
    work: (writer: CredentialLockRecord) => LockedResult<Result>,
  ): Result {
    const lock = acquireLock();
    let outcome: LockedResult<Result>;
    try {
      outcome = work(lock.record);
    } catch (error) {
      try {
        lock.release();
      } catch (releaseError) {
        if (error instanceof CredentialStoreCommitUncertainError) {
          throw new CredentialStoreCommitUncertainError(error.message, {
            cause: new AggregateError([error, releaseError], "credential commit and lock release are uncertain"),
          });
        }
        throw new AggregateError(
          [error, releaseError],
          "directory-integrity: credential operation failed and its lock could not be released",
          { cause: releaseError },
        );
      }
      throw error;
    }
    try {
      lock.release();
    } catch (error) {
      if (outcome.committed) {
        throw new CredentialStoreCommitUncertainError(
          "credential commit reached protected.json but lock release is uncertain",
          { cause: error },
        );
      }
      throw error;
    }
    return outcome.result;
  }

  function writeDocument(
    document: CredentialDocument,
    priorBytes: Uint8Array | undefined,
    commandRename: boolean,
    writer: CredentialLockRecord,
  ): Uint8Array {
    assertDirectory();
    const bytes = encodePrivate(document);
    if (bytes.byteLength > MAX_CREDENTIAL_DOCUMENT_BYTES) {
      throw new Error("document-too-large: credential store protected.json exceeds its private bound");
    }
    const temporaryId = z.uuid().parse(ids.randomUUID());
    const temporaryPath = join(
      credentialDirectory,
      `.protected.${writer.acquisitionId}.${temporaryId}.tmp`,
    );
    ownTemporaryPaths.add(temporaryPath);
    let renamed = false;
    try {
      try {
        writeFileSync(temporaryPath, bytes, { mode: CREDENTIAL_FILE_MODE, flag: "wx" });
        fsyncPath(temporaryPath);
      } catch (error) {
        throw new Error("credential store replacement could not be staged", { cause: error });
      }
      const live = readPrivateDocument(protectedPath);
      if (priorBytes === undefined ? live !== undefined : live === undefined || !sameBytes(live.bytes, priorBytes)) {
        throw new Error("credential store protected.json changed before replacement");
      }
      hooks.beforeRename?.();
      assertDirectory();
      try {
        renameSync(temporaryPath, protectedPath);
        renamed = true;
      } catch (error) {
        throw new Error("credential store protected.json could not be atomically replaced", { cause: error });
      }
      if (commandRename) {
        try {
          hooks.afterRename?.();
        } catch (error) {
          throw new CredentialStoreCommitUncertainError(
            "credential commit reached protected.json but completion is uncertain",
            { cause: error },
          );
        }
      }
      try {
        assertDirectory();
        fsyncPath(credentialDirectory);
      } catch (error) {
        throw new CredentialStoreCommitUncertainError(
          "credential commit reached protected.json but directory durability is uncertain",
          { cause: error },
        );
      }
      const readback = readPrivateDocument(protectedPath);
      if (readback === undefined || !sameBytes(readback.bytes, bytes)) {
        throw new CredentialStoreCommitUncertainError(
          "credential commit readback differs after replacement",
        );
      }
      return bytes;
    } catch (error) {
      if (renamed && !(error instanceof CredentialStoreCommitUncertainError)) {
        throw new CredentialStoreCommitUncertainError(
          "credential commit reached protected.json but completion is uncertain",
          { cause: error },
        );
      }
      throw error;
    } finally {
      noSymlinkAncestry(credentialDirectory, ancestorIdentities);
      ownTemporaryPaths.delete(temporaryPath);
      removeTemporary(temporaryPath);
    }
  }

  function readCurrentUnderLock(): CurrentDocument {
    assertDirectory();
    const current = readPrivateDocument(protectedPath);
    if (current !== undefined) return current;
    return { bytes: undefined, document: initialDocument() };
  }

  function observeCurrent(): CurrentDocument {
    const missing = (): CurrentDocument => ({ bytes: undefined, document: initialDocument() });
    if (!noSymlinkAncestry(stateRoot, ancestorIdentities)) return missing();
    statDirectory(stateRoot, "state root");
    if (!noSymlinkAncestry(credentialDirectory, ancestorIdentities)) return missing();
    const beforeIdentity = statDirectory(
      credentialDirectory,
      "credential directory",
      CREDENTIAL_DIRECTORY_MODE,
    );
    const beforeNames = readdirSync(credentialDirectory).sort();
    const permitted = new Set([
      CREDENTIAL_FILE_NAME,
      CREDENTIAL_LOCK_NAME,
      CREDENTIAL_REAPER_NAME,
      CREDENTIAL_REAPER_CLAIM_NAME,
    ]);
    if (beforeNames.some((name) => !permitted.has(name))) {
      throw new Error("directory-integrity: credential directory contains unsettled entries");
    }
    const first = readPrivateDocument(protectedPath);
    const afterNames = readdirSync(credentialDirectory).sort();
    const afterIdentity = statDirectory(
      credentialDirectory,
      "credential directory",
      CREDENTIAL_DIRECTORY_MODE,
    );
    const second = readPrivateDocument(protectedPath);
    noSymlinkAncestry(credentialDirectory, ancestorIdentities);
    if (!sameDirectory(beforeIdentity, afterIdentity)
      || canonicalJsonStringify(beforeNames) !== canonicalJsonStringify(afterNames)
      || (first === undefined) !== (second === undefined)
      || (first !== undefined && second !== undefined && !sameBytes(first.bytes, second.bytes))) {
      throw new Error("directory-integrity: credential authority moved during read-only observation");
    }
    return second ?? missing();
  }

  function divergent(): CredentialStoreApplyOutcome {
    return frozenRefusal(
      "command-divergent",
      "credential command or write identity differs from its persisted request",
    );
  }

  function exactLastReplay(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): "exact" | "divergent" | "none" {
    const latest = document.history.at(-1);
    if (latest === undefined) return "none";
    if (latest.request.commandId !== request.commandId) return "none";
    return privateEqual(latest.request, request) ? "exact" : "divergent";
  }

  function historyReusesIdentity(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): boolean {
    return document.history.some(({ request: historical }) => (
      historical.commandId === request.commandId || historical.writeId === request.writeId
    ));
  }

  function buildNext(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): CredentialDocument {
    const entries = new Map<string, unknown>(Object.entries(document.record.entries));
    const setValueIds: Record<string, string> = {};
    const allocated = new Set(Object.values(document.record.entries).map(({ valueId }) => valueId));
    for (const name of ProtectedSettingsNameSchema.options) {
      const operation = request.entries[name];
      if (operation === undefined) continue;
      if ("clear" in operation) {
        entries.delete(name);
        continue;
      }
      const valueId = z.uuid().parse(ids.randomUUID());
      if (allocated.has(valueId)) throw new Error("credential value identity generation collided");
      allocated.add(valueId);
      setValueIds[name] = valueId;
      entries.set(name, { valueId, value: operation.set, updatedAt: request.updatedAt });
    }
    return authenticateDocument({
      schemaVersion: 1,
      record: {
        schemaVersion: 1,
        revision: document.record.revision + 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        entries: Object.fromEntries(entries),
        lastApplied: lastApplied(request),
      },
      history: [...document.history, { request, setValueIds }],
      ...(document.upgradeBinding === undefined ? {} : { upgradeBinding: document.upgradeBinding }),
    });
  }

  function evaluateReplay(
    current: CurrentDocument,
    request: ProtectedSettingsApplyInput,
  ): CredentialStoreApplyOutcome | undefined {
    const directReplay = exactLastReplay(current.document, request);
    if (directReplay === "exact") {
      return deepFreeze({ state: "applied" as const, record: current.document.record });
    }
    if (directReplay === "divergent") return divergent();
    if (request.expectedRevision !== current.document.record.revision) {
      return conflict(current.document.record.revision, request.expectedRevision);
    }
    if (historyReusesIdentity(current.document, request)) return divergent();
    return undefined;
  }

  function applyAdmitted(request: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
    try {
      return withLock((writer) => {
        const current = readCurrentUnderLock();
        const replay = evaluateReplay(current, request);
        if (replay !== undefined) return { committed: false, result: replay };
        const next = buildNext(current.document, request);
        writeDocument(next, current.bytes, true, writer);
        return {
          committed: true,
          result: deepFreeze({ state: "applied" as const, record: next.record }),
        };
      });
    } catch (error) {
      if (error instanceof CredentialStoreLockUnavailableError) {
        return frozenRefusal("lock-unavailable", "credential store lock is unavailable");
      }
      throw error;
    }
  }

  function upgradeBinding(upgradeId: string, entries: ProtectedSettingsPatch) {
    const parsed = CredentialUpgradeBindingSchema.safeParse({ upgradeId, entries });
    if (!parsed.success || encodePrivate(parsed.data).byteLength > MAX_PRIVATE_REQUEST_BYTES) {
      throw new Error("credential-import-refused: invalid private upgrade binding");
    }
    return parsed.data;
  }

  function requireUpgradeBinding(document: CredentialDocument, binding: z.infer<typeof CredentialUpgradeBindingSchema>): void {
    if (document.upgradeBinding === undefined || !privateEqual(document.upgradeBinding, binding)) {
      throw new Error("credential-import-refused: private upgrade source binding is missing or divergent");
    }
  }

  return Object.freeze({
    bindUpgrade(upgradeId: string, entries: ProtectedSettingsPatch): void {
      const binding = upgradeBinding(upgradeId, entries);
      withLock((writer) => {
        const current = readCurrentUnderLock();
        if (current.document.upgradeBinding !== undefined) {
          requireUpgradeBinding(current.document, binding);
          return { committed: false, result: undefined };
        }
        if (current.document.record.revision !== 1) throw new Error("credential-import-refused: private authority already has applied credentials");
        const next = authenticateDocument({ ...current.document, upgradeBinding: binding });
        writeDocument(next, current.bytes, false, writer);
        return { committed: true, result: undefined };
      });
    },
    verifyUpgradeBinding(upgradeId: string, entries: ProtectedSettingsPatch): void {
      requireUpgradeBinding(observeCurrent().document, upgradeBinding(upgradeId, entries));
    },
    verifyUpgradePreflight(upgradeId: string, entries: ProtectedSettingsPatch): void {
      const document = observeCurrent().document;
      if (document.upgradeBinding !== undefined) {
        requireUpgradeBinding(document, upgradeBinding(upgradeId, entries));
      }
    },
    read(): ProtectedStoreRecord {
      return observeCurrent().document.record;
    },
    acceptedAt(commandId: string): string | undefined {
      const id = z.uuid().parse(commandId);
      return withLock(() => {
        const latest = readCurrentUnderLock().document.history.at(-1)?.request;
        return { committed: false, result: latest?.commandId === id ? latest.updatedAt : undefined };
      });
    },
    apply(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      const request = admit(input);
      if (!("commandId" in request)) return request;
      return applyAdmitted(request);
    },
    verifyReplay(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      const request = admit(input);
      if (!("commandId" in request)) return request;
      const replay = evaluateReplay(observeCurrent(), request);
      return replay ?? divergent();
    },
  });
}
