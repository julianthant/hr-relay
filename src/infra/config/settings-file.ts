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
  readlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsApplyInputSchema,
  SettingsApplyRefusalSchema,
  SettingsFileRecordSchema,
  derivePersistedSettingsFingerprint,
  initialSettingsFileRecord,
  mergeSettingsPatch,
  type SettingsApplyInput,
  type SettingsApplyRefusal,
  type SettingsFileRecord,
} from "../../domain/config/settings.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  ProtectedSettingsLastAppliedSchema,
  ProtectedStoreRecordSchema,
  ProtectedSettingsNameSchema,
  initialProtectedStoreRecord,
  type ProtectedSettingsApplyInput,
  type ProtectedStoreRecord,
} from "../../domain/config/protected-settings.js";
import {
  SettingsDocumentTargetSchema,
  SettingsRootAuthoritySchema,
  settingsRootAuthority,
  settingsRootPathsFromOrdinaryPath,
  type SettingsDocumentTarget,
  type SettingsRootAuthority,
} from "../../domain/config/settings-root.js";
import { deepFreeze } from "../../domain/immutability.js";
import { FingerprintSchema, PositiveIntSchema } from "../../domain/ids.js";
import { sha256Hex } from "../../domain/sha256.js";
import {
  ProcessStartIdentitySchema,
  observeProcessIdentity,
} from "../sqlite/runtime-process-locks.js";

export interface SettingsFileOperations {
  readonly writeExclusive?: (path: string, bytes: Uint8Array) => void;
  readonly syncPath?: (path: string) => void;
  readonly atomicReplace?: (source: string, destination: string) => void;
  readonly remove?: (path: string) => void;
}

export interface SettingsFileAuthorityHooks {
  /** Test-only crash seam after the atomic hard link exists and before twin cleanup. */
  readonly afterLockLinked?: () => void;
  /** Test-only crash seams around durability of a newly created stale-reaper claim. */
  readonly beforeReaperFsync?: () => void;
  readonly afterReaperFsync?: () => void;
  /** Test-only race seam immediately before a verified stale main lock is removed. */
  readonly beforeStaleLockRemoval?: () => void;
  /** Test-only crash seams around stale-reaper main-lock reacquisition. */
  readonly beforeMainLockReacquisition?: () => void;
  readonly afterMainLockReacquisition?: () => void;
  /** Test-only crash seams across the durable compensating rollback protocol. */
  readonly afterRollbackPrepared?: () => void;
  readonly afterRollbackSettingsRestored?: () => void;
  readonly afterRollbackInitializationRestored?: () => void;
  readonly afterRollbackCompleted?: () => void;
}

export interface AppliedSettingsFileUpdate {
  readonly state: "applied";
  readonly record: SettingsFileRecord;
  /** Exact compensating write used only if the surrounding command transaction fails. */
  rollback(): void;
  /** Release exclusive authority only after the surrounding command transaction commits. */
  commit(): void;
}

export type SettingsFileApplyOutcome = AppliedSettingsFileUpdate | SettingsApplyRefusal;

export interface SettingsPreparedUpdate {
  readonly prepareId: string;
  readonly command: Readonly<{
    commandId: string;
    commandFingerprint: string;
    expectedRevision: number;
    settingsSchemaHash: string;
    patchFingerprint: string;
  }>;
  readonly prior: SettingsFileRecord;
  readonly next: SettingsFileRecord;
}

export type SettingsPrepareResolution = "committed" | "rollback";

export interface SettingsFileAuthority {
  read(): SettingsFileRecord;
  pendingTarget(): SettingsDocumentTarget | undefined;
  reconcile(resolve: (prepared: SettingsPreparedUpdate) => SettingsPrepareResolution): SettingsFileRecord;
  /** Hold exclusive settings authority while work atomically consumes this exact boot identity. */
  withExactRecord<Result>(expected: unknown, work: () => Result): Result;
  /** Hold the shared lock while a backup consumer copies and authenticates this exact root snapshot. */
  withRootBackupSnapshot<Result>(
    this: void,
    work: (snapshot: SettingsRootBackupSnapshot) => Promise<Result>,
  ): Promise<Result>;
  apply(input: unknown): SettingsFileApplyOutcome;
}

export interface SettingsRootBackupSnapshot {
  readonly ordinaryBytes: Uint8Array;
  readonly authorityBytes: Uint8Array;
  readonly ordinary: SettingsFileRecord;
  readonly protected: ProtectedStoreRecord;
}

export interface SettingsFileAuthorityOptions {
  readonly path: string;
  /** Resolve the complete candidate through the composition's exact settings/host facts. */
  readonly validateCandidate: (settings: SettingsFileRecord["settings"]) => void;
  readonly operations?: SettingsFileOperations;
  readonly hooks?: SettingsFileAuthorityHooks;
}

let temporarySequence = 0;
export const MAX_SETTINGS_FILE_BYTES = 1_048_576;
const MAX_SETTINGS_LOCK_BYTES = 16_384;
const MAX_SETTINGS_INITIALIZATION_BYTES = 16_384;
const MAX_SETTINGS_ROLLBACK_BYTES = MAX_SETTINGS_FILE_BYTES * 3;
const MAX_SETTINGS_PREPARE_BYTES = MAX_SETTINGS_FILE_BYTES * 3;
export const MAX_PROTECTED_SETTINGS_BYTES = 64_000;

const SettingsApplyPreflightSchema = SettingsApplyInputSchema.extend({ patch: z.unknown() });
const ProtectedSettingsApplyPreflightSchema = ProtectedSettingsApplyInputSchema.extend({ entries: z.unknown() });

const SettingsFileExpectationSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsFingerprint: FingerprintSchema,
});

const SettingsAuthorityLockRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  acquisitionId: z.uuid(),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  settingsPathFingerprint: FingerprintSchema,
});
type SettingsAuthorityLockRecord = z.infer<typeof SettingsAuthorityLockRecordSchema>;

const SettingsStaleReaperRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reaperId: z.uuid(),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  settingsPathFingerprint: FingerprintSchema,
});
type SettingsStaleReaperRecord = z.infer<typeof SettingsStaleReaperRecordSchema>;

const SettingsInitializationRecordSchema = SettingsRootAuthoritySchema;
type SettingsInitializationRecord = SettingsRootAuthority;

const SettingsCommandIdentitySchema = z.union([
  z.strictObject({
    commandId: z.uuid(), commandFingerprint: FingerprintSchema,
    expectedRevision: PositiveIntSchema, settingsSchemaHash: FingerprintSchema,
    patchFingerprint: FingerprintSchema,
  }),
  ProtectedSettingsLastAppliedSchema,
]);
type SettingsCommandIdentity = z.infer<typeof SettingsCommandIdentitySchema>;
const Base64BytesSchema = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const SettingsRecoveryBytesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  target: SettingsDocumentTargetSchema,
  settingsPathFingerprint: FingerprintSchema,
  command: SettingsCommandIdentitySchema,
  priorSettingsBytesBase64: Base64BytesSchema.nullable(),
  nextSettingsBytesBase64: Base64BytesSchema,
  priorInitializationBytesBase64: Base64BytesSchema,
  nextInitializationBytesBase64: Base64BytesSchema,
}).superRefine((record, context) => {
  if ((record.target === "ordinary") !== ("settingsSchemaHash" in record.command)) {
    context.addIssue({ code: "custom", message: "recovery target does not match its command arm" });
  }
});
const SettingsPrepareRecordSchema = SettingsRecoveryBytesSchema.safeExtend({ prepareId: z.uuid() });
type SettingsPrepareRecord = z.infer<typeof SettingsPrepareRecordSchema>;
const SettingsRollbackRecordSchema = SettingsRecoveryBytesSchema.safeExtend({ rollbackId: z.uuid() });
type SettingsRollbackRecord = z.infer<typeof SettingsRollbackRecordSchema>;
type SettingsRecoveryRecord = z.infer<typeof SettingsRecoveryBytesSchema>;

type DocumentRecord = Readonly<{ revision: number; lastApplied?: SettingsCommandIdentity }>;
type DocumentRequest = Readonly<{ commandId: string; commandFingerprint: string; expectedRevision: number }>;
interface DocumentUpdate<Record> {
  readonly state: "applied";
  readonly record: Record;
  rollback(): void;
  commit(): void;
}
interface PreparedDocument<Record> {
  readonly prepareId: string;
  readonly target: SettingsDocumentTarget;
  readonly command: SettingsCommandIdentity;
  readonly prior: Record;
  readonly next: Record;
}
interface DocumentAuthority<Record> {
  read(this: void): Record;
  pendingTarget(this: void): SettingsDocumentTarget | undefined;
  reconcile(resolve: (prepared: PreparedDocument<Record>) => SettingsPrepareResolution): Record;
  withExactRecord<Result>(this: void, expected: unknown, work: () => Result): Result;
  withRootBackupSnapshot<Result>(
    this: void,
    work: (snapshot: SettingsRootBackupSnapshot) => Promise<Result>,
  ): Promise<Result>;
  withCurrentRecord<Result>(work: (record: Record) => Result): Result;
  apply(this: void, input: unknown): DocumentUpdate<Record> | SettingsApplyRefusal;
}
interface DocumentCodec<Record extends DocumentRecord, Request extends DocumentRequest> {
  readonly target: SettingsDocumentTarget;
  readonly maximumBytes: number;
  readonly schema: z.ZodType<Record>;
  initial(): Record;
  admit(input: unknown): Readonly<{ state: "admitted"; request: Request }> | SettingsApplyRefusal;
  command(request: Request): SettingsCommandIdentity;
  next(current: Record, request: Request): Record;
  verifyReplay(current: Record, request: Request): boolean;
  verifyExact(current: Record, expected: unknown): void;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

interface PrivateRegularFileRead {
  readonly bytes: Uint8Array;
  readonly device: number;
  readonly inode: number;
  readonly linkCount: number;
}

type PrivateRegularFileOpenResult =
  | Readonly<{ state: "opened"; descriptor: number }>
  | Readonly<{ state: "absent"; reason: "path-not-found" }>;

function openPrivateRegularFile(path: string, label: string): PrivateRegularFileOpenResult {
  try {
    return Object.freeze({
      state: "opened",
      descriptor: openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      ),
    });
  } catch (error) {
    // ENOENT is a valid, explicit observation for authority sidecars and the
    // virgin settings file. Every other open failure remains load-bearing.
    if (isMissing(error)) return Object.freeze({ state: "absent", reason: "path-not-found" });
    if (error instanceof Error && Reflect.get(error, "code") === "ELOOP") {
      throw new Error(`${label} ${path} is a symbolic link; no-follow authority refused it`, {
        cause: error,
      });
    }
    throw error;
  }
}

function readPrivateRegularFile(
  path: string,
  label: string,
  maximumBytes: number,
  allowedLinkCounts: readonly number[] = [1],
): PrivateRegularFileRead | undefined {
  const opened = openPrivateRegularFile(path, label);
  if (opened.state === "absent") return undefined;
  const descriptor = opened.descriptor;
  return withClosedDescriptor(descriptor, `${label} ${path}`, () => {
    const status = fstatSync(descriptor);
    if (!status.isFile()) {
      throw new Error(`${label} ${path} is not a regular file`);
    }
    if (!allowedLinkCounts.includes(status.nlink)) {
      throw new Error(
        `${label} ${path} has ${String(status.nlink)} hard links; `
        + `expected ${allowedLinkCounts.join(" or ")}`,
      );
    }
    const currentUid = process.getuid?.();
    if (currentUid === undefined) {
      throw new Error(`${label} ${path} ownership cannot be verified on this platform`);
    }
    if (status.uid !== currentUid) {
      throw new Error(
        `${label} ${path} is owned by uid ${String(status.uid)}, not runtime uid ${String(currentUid)}`,
      );
    }
    const permissions = status.mode & 0o7777;
    if (permissions !== 0o600) {
      throw new Error(
        `${label} ${path} permissions are ${permissions.toString(8)}; exactly 600 is required`,
      );
    }
    if (status.size > maximumBytes) {
      throw new Error(
        `${label} ${path} exceeds maximum ${String(maximumBytes)} bytes`,
      );
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength > maximumBytes) {
      throw new Error(
        `${label} ${path} read ${String(bytes.byteLength)} bytes; maximum is ${String(maximumBytes)}`,
      );
    }
    const afterRead = fstatSync(descriptor);
    if (afterRead.dev !== status.dev
      || afterRead.ino !== status.ino
      || afterRead.uid !== status.uid
      || afterRead.mode !== status.mode
      || afterRead.nlink !== status.nlink
      || afterRead.size !== status.size
      || bytes.byteLength !== status.size) {
      throw new Error(`${label} ${path} changed while its no-follow descriptor was being read`);
    }
    return Object.freeze({
      bytes,
      device: status.dev,
      inode: status.ino,
      linkCount: status.nlink,
    });
  });
}

function readPrivateRegularBytes(
  path: string,
  label: string,
  maximumBytes: number,
): Uint8Array | undefined {
  return readPrivateRegularFile(path, label, maximumBytes)?.bytes;
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function invalidRequest(message: string): never {
  throw new Error(message);
}

function rawSettingsPatchFingerprint(patch: unknown): string {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-patch:v2\0${canonicalJsonStringify(patch)}`,
  ));
}

function issuePath(issue: z.core.$ZodIssue): string {
  const path = issue.path.filter((part) => part !== "patch" && part !== "entries").join(".");
  return path === "" ? "document" : path;
}

function firstUnrecognizedKey(error: z.ZodError): string | undefined {
  for (const issue of error.issues) {
    if (issue.code !== "unrecognized_keys") continue;
    const [key] = issue.keys;
    if (key === undefined) continue;
    const prefix = issuePath(issue);
    return prefix === "document" ? key : `${prefix}.${key}`;
  }
  return undefined;
}

function firstNotEditableSettingsPath(error: z.ZodError): string | undefined {
  const unrecognized = firstUnrecognizedKey(error);
  if (unrecognized !== undefined) return unrecognized;
  for (const issue of error.issues) {
    if (!issue.message.includes("is not an editable ordinary setting")) continue;
    const path = issuePath(issue);
    if (path !== "document") return path;
  }
  return undefined;
}

function withClosedDescriptor<Result>(
  descriptor: number,
  label: string,
  operation: () => Result,
): Result {
  let result: Readonly<{ value: Result }> | undefined;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    result = { value: operation() };
  } catch (error) {
    primaryFailure = { error };
  }
  let closeFailure: Readonly<{ error: unknown }> | undefined;
  try {
    closeSync(descriptor);
  } catch (error) {
    closeFailure = { error };
  }
  if (primaryFailure !== undefined) {
    if (closeFailure !== undefined) {
      throw new AggregateError(
        [primaryFailure.error, closeFailure.error],
        `${label} operation failed and its descriptor could not close`,
        { cause: primaryFailure.error },
      );
    }
    throw primaryFailure.error;
  }
  if (closeFailure !== undefined) throw closeFailure.error;
  if (result === undefined) throw new Error(`${label} operation did not settle`);
  return result.value;
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  withClosedDescriptor(descriptor, `settings fsync ${path}`, () => {
    fsyncSync(descriptor);
  });
}

function writeExclusive(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
}

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function parseSettingsLock(path: string, bytes: Uint8Array): SettingsAuthorityLockRecord {
  try {
    return SettingsAuthorityLockRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    throw new Error(`settings authority lock ${path} is malformed`, { cause: error });
  }
}

function parseSettingsStaleReaper(path: string, bytes: Uint8Array): SettingsStaleReaperRecord {
  try {
    return SettingsStaleReaperRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    throw new Error(`settings stale-reaper claim ${path} is malformed`, { cause: error });
  }
}

function processRecordOwnerIsAlive(
  record: Readonly<{ pid: number; processIdentity: z.infer<typeof ProcessStartIdentitySchema> }>,
): boolean {
  const observation = observeProcessIdentity(record.pid);
  return observation.state === "alive"
    && observation.identity.platform === record.processIdentity.platform
    && observation.identity.startToken === record.processIdentity.startToken;
}

function parseSettingsInitialization(
  path: string,
  bytes: Uint8Array,
): SettingsInitializationRecord {
  try {
    return SettingsInitializationRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    throw new Error(`settings initialization evidence ${path} is malformed`, { cause: error });
  }
}

function parseSettingsRollback(path: string, bytes: Uint8Array): SettingsRollbackRecord {
  try {
    return SettingsRollbackRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error(`settings rollback evidence ${path} is malformed`);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string, label: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  if (encodeBase64(bytes) !== value) {
    throw new Error(`${label} is not canonical base64`);
  }
  return bytes;
}

function parseSettingsPrepare(path: string, bytes: Uint8Array): SettingsPrepareRecord {
  try {
    return SettingsPrepareRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error(`settings prepare evidence ${path} is malformed`);
  }
}

function settingsPathFingerprint(path: string): string {
  return FingerprintSchema.parse(sha256Hex(path));
}

function initializationBytes(ordinary: SettingsRootAuthority["ordinary"], protectedState: SettingsRootAuthority["protected"]): Uint8Array {
  return new TextEncoder().encode(`${canonicalJsonStringify(settingsRootAuthority(ordinary, protectedState))}\n`);
}

type SettingsDirectoryIdentity = ReadonlyMap<string, Readonly<{ device: number; inode: number }>>;

/**
 * POSIX mode-bit boundary against other UIDs, not root/same-UID or ACL interference.
 * Walk from the root BEFORE creating anything: a private leaf is replaceable when an
 * ancestor is writable. Sticky ancestors protect the trusted-owner child, but the
 * authority directory itself must never admit foreign entries. Root-owned system
 * symlinks (e.g. macOS /var) are allowed only under root-owned parents; their targets
 * undergo the same walk. Retain every pathname's inode across admissions/settlement.
 */
function verifySettingsDirectory(
  directory: string,
  prior?: SettingsDirectoryIdentity,
): SettingsDirectoryIdentity {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error(`settings directory ${directory} ownership cannot be verified on this platform`);
  }
  const identities = new Map<string, Readonly<{ device: number; inode: number }>>();
  const visiting = new Set<string>();
  function visit(path: string, authority: boolean): ReturnType<typeof lstatSync> {
    if (visiting.has(path)) throw new Error(`settings directory ${path} has a symbolic-link cycle`);
    visiting.add(path);
    const parentPath = dirname(path);
    const parent = path === parentPath ? undefined : visit(parentPath, false);
    let status;
    try {
      status = lstatSync(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (prior !== undefined) {
        throw new Error(`settings directory ${path} disappeared after its identity was bound`, { cause: error });
      }
      // All existing ancestors are already verified. Create only this missing
      // component; never chmod or remove pre-existing evidence.
      try {
        mkdirSync(path, { mode: 0o700 });
      } catch (creationError) {
        if (errnoOf(creationError) !== "EEXIST") throw creationError;
      }
      status = lstatSync(path);
    }
    const expected = prior?.get(path);
    if (prior !== undefined && (expected === undefined
      || status.dev !== expected.device || status.ino !== expected.inode)) {
      throw new Error(`settings directory ${path} changed pathname identity`);
    }
    identities.set(path, Object.freeze({ device: status.dev, inode: status.ino }));
    if (status.isSymbolicLink()) {
      if (status.uid !== 0 || parent?.uid !== 0) {
        throw new Error(`settings directory ${path} is a symbolic link outside a root-owned system path`);
      }
      const rawTarget = readlinkSync(path);
      // Lexical normalization of '..' can skip a preceding symlink that the OS follows.
      if (rawTarget.split("/").includes("..")) {
        throw new Error(`settings directory ${path} raw symbolic-link target contains a '..' path component`);
      }
      const target = resolve(parentPath, rawTarget);
      const targetStatus = visit(target, authority);
      visiting.delete(path);
      return targetStatus;
    }
    if (!status.isDirectory()) throw new Error(`settings directory ${path} is not a directory`);
    if (status.uid !== uid && (authority || status.uid !== 0)) {
      throw new Error(`settings directory ${path} has untrusted owner uid ${String(status.uid)}; runtime uid is ${String(uid)}`);
    }
    if (authority && (status.mode & 0o7777) !== 0o700) {
      throw new Error(`directory-integrity: settings directory ${path} must have mode 0700`);
    }
    const writable = (status.mode & 0o022) !== 0;
    const stickyAncestor = !authority && (status.mode & 0o1000) !== 0;
    if (writable && !stickyAncestor) {
      throw new Error(`settings directory ${path} is group/world-writable (mode ${(status.mode & 0o7777).toString(8)})`);
    }
    visiting.delete(path);
    return status;
  }
  visit(directory, true);
  return identities;
}

interface SettingsAuthorityLockHandle {
  release(): void;
}

function releaseAfter<T>(
  lock: SettingsAuthorityLockHandle,
  work: () => T,
  context: string,
): T {
  let result: T;
  try {
    result = work();
  } catch (error) {
    try {
      lock.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        `${context} failed and its exclusive settings authority could not release`,
        { cause: releaseError },
      );
    }
    throw error;
  }
  lock.release();
  return result;
}

async function releaseAfterAsync<T>(
  lock: SettingsAuthorityLockHandle,
  work: () => Promise<T>,
  context: string,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (error) {
    try {
      lock.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        `${context} failed and its exclusive settings authority could not release`,
        { cause: releaseError },
      );
    }
    throw error;
  }
  lock.release();
  return result;
}

function settingsSettlement(
  lock: SettingsAuthorityLockHandle,
  rollbackAction: () => void,
  settlementAction: () => void = () => undefined,
): Readonly<{ settle(): void; rollback(): void }> {
  let settled = false;
  let rollbackCompleted = false;
  return Object.freeze({
    settle(): void {
      if (settled) return;
      settlementAction();
      lock.release();
      settled = true;
    },
    rollback(): void {
      if (settled) return;
      if (!rollbackCompleted) {
        rollbackAction();
        rollbackCompleted = true;
      }
      lock.release();
      settled = true;
    },
  });
}

function acquireSettingsAuthorityLock(
  settingsPath: string,
  hooks: SettingsFileAuthorityHooks,
  assertDirectory: () => void,
): SettingsAuthorityLockHandle {
  assertDirectory();
  const directory = dirname(settingsPath);
  const lockPath = join(directory, "settings.lock");
  const reaperPath = `${lockPath}.reaper`;
  const pathFingerprint = settingsPathFingerprint(settingsPath);
  const observation = observeProcessIdentity(process.pid);
  if (observation.state === "gone") {
    throw new Error(`cannot claim settings authority for non-running pid ${String(process.pid)}`);
  }
  const processIdentity = observation.identity;

  function mainLockHandle(record: SettingsAuthorityLockRecord): SettingsAuthorityLockHandle {
    let released = false;
    return Object.freeze({
      release(): void {
        if (released) return;
        assertDirectory();
        const currentBytes = readPrivateRegularBytes(
          lockPath,
          "settings authority lock",
          MAX_SETTINGS_LOCK_BYTES,
        );
        if (currentBytes === undefined) {
          throw new Error(`exclusive settings authority ${record.acquisitionId} lost its lock file`);
        }
        const current = parseSettingsLock(lockPath, currentBytes);
        if (current.acquisitionId !== record.acquisitionId) {
          throw new Error(
            `exclusive settings authority ${record.acquisitionId} is no longer the lock owner`,
          );
        }
        unlinkSync(lockPath);
        syncPath(directory);
        released = true;
      },
    });
  }

  type StaleReaperHandle = Readonly<{
    record: SettingsStaleReaperRecord;
    kind: "claim" | "recovery";
    release(): void;
  }>;
  type DeadReaperRecoveryBarrier = Readonly<{
    path: string;
    record: SettingsStaleReaperRecord;
    file: PrivateRegularFileRead;
  }>;
  const recoveryPrefix = `.${basename(reaperPath)}.`;

  function recoveryPath(reaperId: string): string {
    return join(directory, `${recoveryPrefix}${reaperId}`);
  }

  function readRecoveryBarrier(): DeadReaperRecoveryBarrier | undefined {
    assertDirectory();
    const entryNames = readdirSync(directory)
      .filter((name) => name.startsWith(recoveryPrefix))
      .sort();
    if (entryNames.length > 1) {
      throw new Error(
        `settings stale-reaper recovery has multiple barriers: ${entryNames.join(", ")}`,
      );
    }
    const entryName = entryNames[0];
    if (entryName === undefined) return undefined;
    const reaperId = z.uuid().parse(
      entryName.slice(recoveryPrefix.length),
    );
    const path = join(directory, entryName);
    const file = readPrivateRegularFile(
      path,
      "settings stale-reaper recovery barrier",
      MAX_SETTINGS_LOCK_BYTES,
      [1, 2],
    );
    if (file === undefined) return readRecoveryBarrier();
    const record = parseSettingsStaleReaper(path, file.bytes);
    if (record.reaperId !== reaperId) {
      throw new Error(
        `settings stale-reaper recovery barrier ${path} names reaper ${record.reaperId}, `
        + `not its acquisition-named ${reaperId}`,
      );
    }
    if (record.settingsPathFingerprint !== pathFingerprint) {
      throw new Error(`settings stale-reaper recovery barrier ${path} belongs to another path`);
    }
    if (processRecordOwnerIsAlive(record)) {
      throw new Error(
        `settings stale-reaper recovery barrier ${path} names live pid ${String(record.pid)}`,
      );
    }
    if (file.linkCount === 2) {
      const reaper = readPrivateRegularFile(
        reaperPath,
        "settings stale-reaper claim",
        MAX_SETTINGS_LOCK_BYTES,
        [2],
      );
      if (reaper === undefined
        || reaper.device !== file.device
        || reaper.inode !== file.inode
        || !equalBytes(reaper.bytes, file.bytes)) {
        throw new Error(
          `settings stale-reaper recovery barrier ${path} has an unverified second hard link`,
        );
      }
    }
    return Object.freeze({ path, record, file });
  }

  function normalReaperHandle(record: SettingsStaleReaperRecord): StaleReaperHandle {
    let released = false;
    return Object.freeze({
      record,
      kind: "claim",
      release(): void {
        if (released) return;
        assertDirectory();
        const bytes = readPrivateRegularBytes(
          reaperPath,
          "settings stale-reaper claim",
          MAX_SETTINGS_LOCK_BYTES,
        );
        if (bytes === undefined) {
          throw new Error(`settings stale-reaper ${record.reaperId} lost its claim file`);
        }
        const current = parseSettingsStaleReaper(reaperPath, bytes);
        if (current.reaperId !== record.reaperId) {
          throw new Error(`settings stale-reaper ${record.reaperId} is no longer the claim owner`);
        }
        unlinkSync(reaperPath);
        syncPath(directory);
        released = true;
      },
    });
  }

  function adoptDeadReaperRecovery(
    barrier: DeadReaperRecoveryBarrier,
  ): StaleReaperHandle {
    assertDirectory();
    const currentReaper = readPrivateRegularFile(
      reaperPath,
      "settings stale-reaper claim",
      MAX_SETTINGS_LOCK_BYTES,
      [1, 2],
    );
    if (currentReaper !== undefined) {
      if (currentReaper.device !== barrier.file.device
        || currentReaper.inode !== barrier.file.inode
        || !equalBytes(currentReaper.bytes, barrier.file.bytes)) {
        throw new Error(
          `settings stale-reaper recovery barrier ${barrier.path} does not bind the live claim pathname`,
        );
      }
      unlinkSync(reaperPath);
      syncPath(directory);
    }
    const repaired = readPrivateRegularFile(
      barrier.path,
      "settings stale-reaper recovery barrier",
      MAX_SETTINGS_LOCK_BYTES,
    );
    if (repaired === undefined
      || repaired.device !== barrier.file.device
      || repaired.inode !== barrier.file.inode
      || !equalBytes(repaired.bytes, barrier.file.bytes)) {
      throw new Error(
        `settings stale-reaper recovery barrier ${barrier.path} changed during claim repair`,
      );
    }
    let released = false;
    return Object.freeze({
      record: barrier.record,
      kind: "recovery",
      release(): void {
        if (released) return;
        assertDirectory();
        const current = readPrivateRegularFile(
          barrier.path,
          "settings stale-reaper recovery barrier",
          MAX_SETTINGS_LOCK_BYTES,
        );
        if (current === undefined) {
          released = true;
          return;
        }
        if (current.device !== repaired.device
          || current.inode !== repaired.inode
          || !equalBytes(current.bytes, repaired.bytes)) {
          throw new Error(
            `settings stale-reaper recovery barrier ${barrier.path} changed before release`,
          );
        }
        unlinkSync(barrier.path);
        syncPath(directory);
        released = true;
      },
    });
  }

  function establishDeadReaperRecovery(
    held: PrivateRegularFileRead,
    record: SettingsStaleReaperRecord,
  ): StaleReaperHandle {
    assertDirectory();
    const path = recoveryPath(record.reaperId);
    let linked = false;
    try {
      linkSync(reaperPath, path);
      linked = true;
      syncPath(directory);
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") throw error;
    }
    const barrier = readRecoveryBarrier();
    if (barrier === undefined
      || barrier.path !== path
      || barrier.file.device !== held.device
      || barrier.file.inode !== held.inode
      || !equalBytes(barrier.file.bytes, held.bytes)) {
      if (linked) {
        removeIfPresent(path, unlinkSync);
        syncPath(directory);
      }
      throw new Error(
        `settings stale-reaper ${record.reaperId} could not establish its exact recovery barrier`,
      );
    }
    return adoptDeadReaperRecovery(barrier);
  }

  function claimStaleReaper(): StaleReaperHandle {
    const existingRecovery = readRecoveryBarrier();
    if (existingRecovery !== undefined) return adoptDeadReaperRecovery(existingRecovery);
    const record = SettingsStaleReaperRecordSchema.parse({
      schemaVersion: 1,
      reaperId: randomUUID(),
      pid: process.pid,
      processIdentity,
      settingsPathFingerprint: pathFingerprint,
    });
    const bytes = new TextEncoder().encode(`${canonicalJsonStringify(record)}\n`);
    let descriptor: number;
    try {
      descriptor = openSync(reaperPath, "wx", 0o600);
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") throw error;
      const racedRecovery = readRecoveryBarrier();
      if (racedRecovery !== undefined) return adoptDeadReaperRecovery(racedRecovery);
      const heldFile = readPrivateRegularFile(
        reaperPath,
        "settings stale-reaper claim",
        MAX_SETTINGS_LOCK_BYTES,
      );
      if (heldFile === undefined) return claimStaleReaper();
      const held = parseSettingsStaleReaper(reaperPath, heldFile.bytes);
      if (held.settingsPathFingerprint !== pathFingerprint) {
        throw new Error(`settings stale-reaper claim ${reaperPath} belongs to another path`, {
          cause: error,
        });
      }
      if (!processRecordOwnerIsAlive(held)) {
        return establishDeadReaperRecovery(heldFile, held);
      }
      throw new Error(
        `settings stale-lock reclamation is in progress; already claimed by `
        + `live pid ${String(held.pid)} `
        + `(reaper ${held.reaperId}); refusing concurrent pathname cleanup`,
        { cause: error },
      );
    }
    try {
      writeFileSync(descriptor, bytes);
      hooks.beforeReaperFsync?.();
      assertDirectory();
      fsyncSync(descriptor);
      hooks.afterReaperFsync?.();
      assertDirectory();
    } finally {
      closeSync(descriptor);
    }
    syncPath(directory);
    const handle = normalReaperHandle(record);
    const racedRecovery = readRecoveryBarrier();
    if (racedRecovery === undefined) return handle;
    handle.release();
    return adoptDeadReaperRecovery(racedRecovery);
  }

  function staleReaperExclusionExists(): boolean {
    if (readRecoveryBarrier() !== undefined) return true;
    const bytes = readPrivateRegularBytes(
      reaperPath,
      "settings stale-reaper claim",
      MAX_SETTINGS_LOCK_BYTES,
    );
    if (bytes === undefined) return false;
    const record = parseSettingsStaleReaper(reaperPath, bytes);
    if (record.settingsPathFingerprint !== pathFingerprint) {
      throw new Error(`settings stale-reaper claim ${reaperPath} belongs to another path`);
    }
    return true;
  }

  function tryClaimMain(ownsReaper: boolean): SettingsAuthorityLockHandle | undefined {
    assertDirectory();
    if (!ownsReaper && staleReaperExclusionExists()) {
      return undefined;
    }
    const record = SettingsAuthorityLockRecordSchema.parse({
      schemaVersion: 1,
      acquisitionId: randomUUID(),
      pid: process.pid,
      processIdentity,
      settingsPathFingerprint: pathFingerprint,
    });
    const bytes = new TextEncoder().encode(`${canonicalJsonStringify(record)}\n`);
    const temporaryPath = join(directory, `.${basename(lockPath)}.${record.acquisitionId}.tmp`);
    let linked = false;
    try {
      writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
      syncPath(temporaryPath);
      try {
        linkSync(temporaryPath, lockPath);
        linked = true;
        hooks.afterLockLinked?.();
      } catch (error) {
        if (errnoOf(error) !== "EEXIST") throw error;
      }
    } finally {
      assertDirectory();
      removeIfPresent(temporaryPath, unlinkSync);
    }
    if (linked) syncPath(directory);

    if (!linked) return undefined;
    const handle = mainLockHandle(record);
    if (!ownsReaper && staleReaperExclusionExists()) {
      handle.release();
      throw new Error("settings stale-lock reclamation won admission; new main lock was unwound");
    }
    return handle;
  }

  function readAndRepairMainLockTwin(): SettingsAuthorityLockRecord | undefined {
    assertDirectory();
    let main = readPrivateRegularFile(
      lockPath,
      "settings authority lock",
      MAX_SETTINGS_LOCK_BYTES,
      [1, 2],
    );
    if (main === undefined) return undefined;
    let record = parseSettingsLock(lockPath, main.bytes);
    if (main.linkCount === 2) {
      const twinPath = join(
        directory,
        `.${basename(lockPath)}.${record.acquisitionId}.tmp`,
      );
      const twin = readPrivateRegularFile(
        twinPath,
        "settings authority acquisition twin",
        MAX_SETTINGS_LOCK_BYTES,
        [2],
      );
      if (twin === undefined) {
        main = readPrivateRegularFile(
          lockPath,
          "settings authority lock",
          MAX_SETTINGS_LOCK_BYTES,
        );
        if (main === undefined) return undefined;
        return parseSettingsLock(lockPath, main.bytes);
      }
      if (main.device !== twin.device
        || main.inode !== twin.inode
        || !equalBytes(main.bytes, twin.bytes)) {
        throw new Error(
          `settings authority lock ${lockPath} has an unverified second hard link; `
          + `expected exact acquisition twin ${twinPath}`,
        );
      }
      unlinkSync(twinPath);
      syncPath(directory);
      const repaired = readPrivateRegularBytes(
        lockPath,
        "settings authority lock",
        MAX_SETTINGS_LOCK_BYTES,
      );
      if (repaired === undefined) {
        throw new Error(`settings authority lock ${lockPath} disappeared during twin recovery`);
      }
      record = parseSettingsLock(lockPath, repaired);
    }
    return record;
  }

  const immediate = tryClaimMain(false);
  if (immediate !== undefined) return immediate;

  const reaper = claimStaleReaper();
  let acquired: SettingsAuthorityLockHandle | undefined;
  try {
    const held = readAndRepairMainLockTwin();
    if (held !== undefined) {
      if (held.settingsPathFingerprint !== pathFingerprint) {
        throw new Error(`settings authority lock ${lockPath} belongs to a different settings path`);
      }
      if (processRecordOwnerIsAlive(held)) {
        const busyError = new Error(
          `exclusive settings authority is held by live pid ${String(held.pid)} `
          + `(acquisition ${held.acquisitionId})`,
        );
        if (reaper.kind === "recovery") {
          try {
            reaper.release();
          } catch (releaseError) {
            throw new AggregateError(
              [busyError, releaseError],
              `live settings authority was preserved but dead-reaper recovery could not release`,
              { cause: releaseError },
            );
          }
        }
        throw busyError;
      }
      hooks.beforeStaleLockRemoval?.();
      assertDirectory();
      const currentBytes = readPrivateRegularBytes(
        lockPath,
        "settings authority lock",
        MAX_SETTINGS_LOCK_BYTES,
      );
      if (currentBytes !== undefined) {
        const current = parseSettingsLock(lockPath, currentBytes);
        if (current.acquisitionId !== held.acquisitionId) {
          throw new Error(
            `settings authority lock changed from stale acquisition ${held.acquisitionId} `
            + `to ${current.acquisitionId} while stale-reaper ${reaper.record.reaperId} held admission`,
          );
        }
        unlinkSync(lockPath);
        syncPath(directory);
      }
    }
    hooks.beforeMainLockReacquisition?.();
    acquired = tryClaimMain(true);
    if (acquired === undefined) {
      throw new Error(
        `settings stale-reaper ${reaper.record.reaperId} removed the stale owner but did not reacquire the main lock`,
      );
    }
    hooks.afterMainLockReacquisition?.();
    assertDirectory();
    try {
      reaper.release();
    } catch (releaseError) {
      try {
        acquired.release();
      } catch (mainReleaseError) {
        throw new AggregateError(
          [releaseError, mainReleaseError],
          `settings stale-reaper ${reaper.record.reaperId} and its reacquired main lock could not release`,
          { cause: mainReleaseError },
        );
      }
      throw releaseError;
    }
    return acquired;
  } catch (error) {
    if (acquired !== undefined) throw error;
    if (reaper.kind === "recovery") throw error;
    try {
      reaper.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        `settings stale-lock reclamation failed and reaper ${reaper.record.reaperId} could not release`,
        { cause: releaseError },
      );
    }
    throw error;
  }
}

function removeIfPresent(path: string, remove: (path: string) => void): void {
  try {
    remove(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function throwWithCleanup(primary: Error, temporaryPath: string, remove: (path: string) => void): never {
  try {
    removeIfPresent(temporaryPath, remove);
  } catch (cleanupError) {
    throw new AggregateError(
      [primary, cleanupError],
      `settings write failed and temporary cleanup also failed for ${temporaryPath}`,
      { cause: cleanupError },
    );
  }
  throw primary;
}

function createDocumentAuthority<Record extends DocumentRecord, Request extends DocumentRequest>(
  options: Pick<SettingsFileAuthorityOptions, "path" | "operations" | "hooks">,
  codec: DocumentCodec<Record, Request>,
): DocumentAuthority<Record> {
  const paths = settingsRootPathsFromOrdinaryPath(options.path);
  const ordinaryPath = paths.ordinary;
  const protectedPath = paths.protected;
  const directory = paths.root;
  const path = codec.target === "ordinary" ? paths.ordinary : paths.protected;
  const initializationPath = paths.authority;
  const rollbackPath = paths.rollback;
  const preparePath = paths.prepare;
  const ownTemporaryPaths = new Set<string>();
  const recoverableTemporaryPaths = new Map<string, Readonly<{
    bytes: Uint8Array;
    maximumBytes: number;
  }>>();
  function parseRecord(recordPath: string, bytes: Uint8Array): Record {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error(`invalid-value: ${basename(recordPath)} is malformed JSON`);
    }
    const parsed = codec.schema.safeParse(value);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      // Only field names escape this boundary, never submitted values or parser causes.
      throw new Error(`invalid-value: ${basename(recordPath)} ${fields} is malformed`);
    }
    return deepFreeze(parsed.data);
  }

  function inspectRecoveryRecord(record: SettingsRecoveryRecord): Readonly<{
    target: SettingsDocumentTarget;
    documentPath: string;
    maximumBytes: number;
    priorDocumentBytes: Uint8Array | undefined;
    nextDocumentBytes: Uint8Array;
    priorInitializationBytes: Uint8Array;
    nextInitializationBytes: Uint8Array;
    priorInitialization: SettingsInitializationRecord;
  }> {
    const target = record.target;
    const documentPath = target === "ordinary" ? paths.ordinary : paths.protected;
    const maximumBytes = target === "ordinary" ? MAX_SETTINGS_FILE_BYTES : MAX_PROTECTED_SETTINGS_BYTES;
    const priorDocumentBytes = record.priorSettingsBytesBase64 === null
      ? undefined
      : decodeBase64(record.priorSettingsBytesBase64, "prepared prior settings bytes");
    const nextDocumentBytes = decodeBase64(record.nextSettingsBytesBase64, "prepared next settings bytes");
    const priorInitializationBytes = decodeBase64(
      record.priorInitializationBytesBase64,
      "prepared prior initialization bytes",
    );
    const nextInitializationBytes = decodeBase64(
      record.nextInitializationBytesBase64,
      "prepared next initialization bytes",
    );
    if ((priorDocumentBytes?.byteLength ?? 0) > maximumBytes
      || nextDocumentBytes.byteLength > maximumBytes
      || priorInitializationBytes.byteLength > MAX_SETTINGS_INITIALIZATION_BYTES
      || nextInitializationBytes.byteLength > MAX_SETTINGS_INITIALIZATION_BYTES) {
      throw new Error(`settings ${target} recovery evidence exceeds its target byte bound`);
    }

    function parseRecoveryDocument(bytes: Uint8Array | undefined): DocumentRecord {
      if (bytes === undefined) {
        return target === "ordinary" ? initialSettingsFileRecord() : initialProtectedStoreRecord();
      }
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new Error(`settings ${target} recovery document is malformed`);
      }
      const parsed = (target === "ordinary" ? SettingsFileRecordSchema : ProtectedStoreRecordSchema).safeParse(value);
      if (!parsed.success) throw new Error(`settings ${target} recovery document is malformed`);
      return parsed.data;
    }

    const prior = parseRecoveryDocument(priorDocumentBytes);
    const next = parseRecoveryDocument(nextDocumentBytes);
    const priorInitialization = parseSettingsInitialization(initializationPath, priorInitializationBytes);
    const nextInitialization = parseSettingsInitialization(initializationPath, nextInitializationBytes);
    const otherTarget = target === "ordinary" ? "protected" : "ordinary";
    if (nextInitialization[target] !== "initialized"
      || priorInitialization[otherTarget] !== nextInitialization[otherTarget]
      || (priorDocumentBytes !== undefined) !== (priorInitialization[target] === "initialized")
      || prior.revision !== record.command.expectedRevision
      || next.revision !== prior.revision + 1
      || next.lastApplied === undefined
      || canonicalJsonStringify(next.lastApplied) !== canonicalJsonStringify(record.command)
      || !equalBytes(
        nextDocumentBytes,
        new TextEncoder().encode(`${canonicalJsonStringify(next)}\n`),
      )
      || !equalBytes(
        priorInitializationBytes,
        initializationBytes(priorInitialization.ordinary, priorInitialization.protected),
      )
      || !equalBytes(
        nextInitializationBytes,
        initializationBytes(nextInitialization.ordinary, nextInitialization.protected),
      )) {
      throw new Error(`settings ${target} recovery evidence does not bind its exact transition`);
    }
    return Object.freeze({
      target,
      documentPath,
      maximumBytes,
      priorDocumentBytes,
      nextDocumentBytes,
      priorInitializationBytes,
      nextInitializationBytes,
      priorInitialization,
    });
  }

  function readDocumentBytes(): Uint8Array | undefined {
    assertDirectory();
    return readPrivateRegularBytes(path, basename(path), codec.maximumBytes);
  }
  const operations = options.operations ?? {};
  const hooks = options.hooks ?? {};
  let directoryIdentity: SettingsDirectoryIdentity | undefined;
  function assertDirectory(): void {
    directoryIdentity = verifySettingsDirectory(directory, directoryIdentity);
    const permitted = new Set(["settings.json", "protected.json", "authority.json", "prepare.json", "rollback.json", "settings.lock", "settings.lock.reaper"]);
    const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const transient = new RegExp(`^\\.settings\\.lock(?:\\.${uuid}\\.tmp|\\.reaper\\.${uuid})$`, "u");
    const documentTemporary = /^\.(settings|protected|authority|prepare|rollback)\.json\.([1-9]\d*)\.([1-9]\d*)\.tmp$/u;
    const names = readdirSync(directory);
    let observedLock: SettingsAuthorityLockRecord | null | undefined;
    function lockRecord(): SettingsAuthorityLockRecord | undefined {
      if (observedLock !== undefined) return observedLock ?? undefined;
      const bytes = readPrivateRegularFile(
        paths.lock,
        "settings authority lock",
        MAX_SETTINGS_LOCK_BYTES,
        [1, 2],
      )?.bytes;
      observedLock = bytes === undefined ? null : parseSettingsLock(paths.lock, bytes);
      if (observedLock !== null
        && observedLock.settingsPathFingerprint !== settingsPathFingerprint(ordinaryPath)) {
        throw new Error(`settings authority lock ${paths.lock} belongs to another settings path`);
      }
      return observedLock ?? undefined;
    }
    const documentTemporaryNames = names.filter((name) => documentTemporary.test(name));
    function admitCrashedDocumentTemporary(
      temporaryPath: string,
      document: string,
      owner: SettingsAuthorityLockRecord,
    ): boolean {
      if (processRecordOwnerIsAlive(owner) || documentTemporaryNames.length !== 1) return false;
      try {
        const prepareBytes = readPrivateRegularBytes(
          preparePath,
          "settings prepare evidence",
          MAX_SETTINGS_PREPARE_BYTES,
        );
        const rollbackBytes = readPrivateRegularBytes(
          rollbackPath,
          "settings rollback evidence",
          MAX_SETTINGS_ROLLBACK_BYTES,
        );
        const liveInitializationBytes = readPrivateRegularBytes(
          initializationPath,
          "settings initialization evidence",
          MAX_SETTINGS_INITIALIZATION_BYTES,
        );
        const otherDocumentIsPresent = (target: SettingsDocumentTarget): boolean => readPrivateRegularBytes(
          target === "ordinary" ? paths.protected : paths.ordinary,
          target === "ordinary" ? "protected.json" : "settings.json",
          target === "ordinary" ? MAX_PROTECTED_SETTINGS_BYTES : MAX_SETTINGS_FILE_BYTES,
        ) !== undefined;
        const bindRollback = (
          rollback: SettingsRollbackRecord,
          prepare: SettingsPrepareRecord,
        ): boolean => {
          const { rollbackId: _rollbackId, ...rollbackBody } = rollback;
          const { prepareId: _prepareId, ...prepareBody } = prepare;
          return canonicalJsonStringify(rollbackBody) === canonicalJsonStringify(prepareBody);
        };
        const admit = (bytes: Uint8Array, maximumBytes: number): true => {
          recoverableTemporaryPaths.set(temporaryPath, { bytes, maximumBytes });
          return true;
        };

        if (document === "prepare") {
          if (prepareBytes !== undefined || rollbackBytes !== undefined) return false;
          const staged = readPrivateRegularBytes(temporaryPath, "settings prepare temporary", MAX_SETTINGS_PREPARE_BYTES);
          if (staged === undefined) return false;
          const prepare = parseSettingsPrepare(temporaryPath, staged);
          const recovery = inspectRecoveryRecord(prepare);
          const liveDocument = readPrivateRegularBytes(
            recovery.documentPath,
            basename(recovery.documentPath),
            recovery.maximumBytes,
          );
          if (prepare.settingsPathFingerprint !== settingsPathFingerprint(ordinaryPath)
            || !equalBytes(staged, new TextEncoder().encode(`${canonicalJsonStringify(prepare)}\n`))
            || !equalBytes(liveDocument, recovery.priorDocumentBytes)
            || !equalBytes(liveInitializationBytes, recovery.priorInitializationBytes)
            || otherDocumentIsPresent(recovery.target)
              !== (recovery.priorInitialization[recovery.target === "ordinary" ? "protected" : "ordinary"] === "initialized")) {
            return false;
          }
          return admit(staged, MAX_SETTINGS_PREPARE_BYTES);
        }

        if (prepareBytes === undefined) {
          if (document !== "authority" || rollbackBytes !== undefined) return false;
          const staged = readPrivateRegularBytes(
            temporaryPath,
            "settings initialization temporary",
            MAX_SETTINGS_INITIALIZATION_BYTES,
          );
          const virgin = initializationBytes("virgin", "virgin");
          if (!equalBytes(staged, virgin)
            || liveInitializationBytes !== undefined
            || readPrivateRegularBytes(paths.ordinary, "settings.json", MAX_SETTINGS_FILE_BYTES) !== undefined
            || readPrivateRegularBytes(paths.protected, "protected.json", MAX_PROTECTED_SETTINGS_BYTES) !== undefined) {
            return false;
          }
          return admit(virgin, MAX_SETTINGS_INITIALIZATION_BYTES);
        }

        const prepare = parseSettingsPrepare(preparePath, prepareBytes);
        const recovery = inspectRecoveryRecord(prepare);
        if (prepare.settingsPathFingerprint !== settingsPathFingerprint(ordinaryPath)
          || !equalBytes(prepareBytes, new TextEncoder().encode(`${canonicalJsonStringify(prepare)}\n`))
          || otherDocumentIsPresent(recovery.target)
            !== (recovery.priorInitialization[recovery.target === "ordinary" ? "protected" : "ordinary"] === "initialized")) {
          return false;
        }
        const liveDocument = readPrivateRegularBytes(
          recovery.documentPath,
          basename(recovery.documentPath),
          recovery.maximumBytes,
        );
        let rollback: SettingsRollbackRecord | undefined;
        if (rollbackBytes !== undefined) {
          rollback = parseSettingsRollback(rollbackPath, rollbackBytes);
          if (!bindRollback(rollback, prepare)
            || !equalBytes(rollbackBytes, new TextEncoder().encode(`${canonicalJsonStringify(rollback)}\n`))) {
            return false;
          }
        }

        if (document === "rollback") {
          if (rollback !== undefined) return false;
          const staged = readPrivateRegularBytes(temporaryPath, "settings rollback temporary", MAX_SETTINGS_ROLLBACK_BYTES);
          if (staged === undefined) return false;
          const stagedRollback = parseSettingsRollback(temporaryPath, staged);
          if (!bindRollback(stagedRollback, prepare)
            || !equalBytes(staged, new TextEncoder().encode(`${canonicalJsonStringify(stagedRollback)}\n`))
            || (!equalBytes(liveDocument, recovery.priorDocumentBytes)
              && !equalBytes(liveDocument, recovery.nextDocumentBytes))
            || (!equalBytes(liveInitializationBytes, recovery.priorInitializationBytes)
              && !equalBytes(liveInitializationBytes, recovery.nextInitializationBytes))) {
            return false;
          }
          return admit(staged, MAX_SETTINGS_ROLLBACK_BYTES);
        }

        if (document === "settings" || document === "protected") {
          const expectedTarget = document === "settings" ? "ordinary" : "protected";
          if (recovery.target !== expectedTarget) return false;
          const staged = readPrivateRegularBytes(
            temporaryPath,
            "settings document temporary",
            recovery.maximumBytes,
          );
          if (staged === undefined) return false;
          const forward = rollback === undefined
            && equalBytes(staged, recovery.nextDocumentBytes)
            && equalBytes(liveDocument, recovery.priorDocumentBytes)
            && equalBytes(liveInitializationBytes, recovery.priorInitializationBytes);
          const restoring = rollback !== undefined
            && recovery.priorDocumentBytes !== undefined
            && equalBytes(staged, recovery.priorDocumentBytes)
            && equalBytes(liveDocument, recovery.nextDocumentBytes)
            && (equalBytes(liveInitializationBytes, recovery.priorInitializationBytes)
              || equalBytes(liveInitializationBytes, recovery.nextInitializationBytes));
          return forward || restoring ? admit(staged, recovery.maximumBytes) : false;
        }

        if (document === "authority") {
          const staged = readPrivateRegularBytes(
            temporaryPath,
            "settings initialization temporary",
            MAX_SETTINGS_INITIALIZATION_BYTES,
          );
          if (staged === undefined) return false;
          const advancing = rollback === undefined
            && equalBytes(staged, recovery.nextInitializationBytes)
            && equalBytes(liveInitializationBytes, recovery.priorInitializationBytes)
            && equalBytes(liveDocument, recovery.nextDocumentBytes);
          const restoring = rollback !== undefined
            && equalBytes(staged, recovery.priorInitializationBytes)
            && equalBytes(liveInitializationBytes, recovery.nextInitializationBytes)
            && equalBytes(liveDocument, recovery.priorDocumentBytes);
          return advancing || restoring ? admit(staged, MAX_SETTINGS_INITIALIZATION_BYTES) : false;
        }
        return false;
      } catch (error) {
        throw new Error(
          `directory-integrity: crashed settings temporary ${basename(temporaryPath)} could not authenticate its recovery evidence`,
          { cause: error },
        );
      }
    }
    for (const name of names) {
      const entryPath = join(directory, name);
      const ownTemporary = ownTemporaryPaths.has(entryPath);
      const admittedRecovery = recoverableTemporaryPaths.get(entryPath);
      const recoveryStillExact = admittedRecovery !== undefined
        && equalBytes(
          readPrivateRegularBytes(entryPath, "settings atomic temporary", admittedRecovery.maximumBytes),
          admittedRecovery.bytes,
        );
      const match = documentTemporary.exec(name);
      const owner = match === null ? undefined : lockRecord();
      const ownerTemporary = match !== null
        && documentTemporaryNames.length === 1
        && owner !== undefined
        && match[2] === String(owner.pid)
        && (processRecordOwnerIsAlive(owner)
          || admitCrashedDocumentTemporary(entryPath, match[1] ?? "", owner));
      if (!permitted.has(name) && !transient.test(name) && !ownTemporary && !recoveryStillExact && !ownerTemporary) {
        throw new Error(`directory-integrity: unexpected settings entry ${name}`);
      }
    }
  }

  function cleanupRecoverableTemporaries(): void {
    for (const [temporaryPath, expected] of recoverableTemporaryPaths) {
      const live = readPrivateRegularBytes(
        temporaryPath,
        "settings atomic temporary",
        expected.maximumBytes,
      );
      if (live === undefined) {
        recoverableTemporaryPaths.delete(temporaryPath);
        continue;
      }
      if (!equalBytes(live, expected.bytes)) {
        throw new Error(`directory-integrity: crashed settings temporary ${basename(temporaryPath)} changed before cleanup`);
      }
      unlinkSync(temporaryPath);
      syncPath(directory);
      recoverableTemporaryPaths.delete(temporaryPath);
    }
    assertDirectory();
  }

  function acquireDocumentAuthorityLock(): SettingsAuthorityLockHandle {
    const lock = acquireSettingsAuthorityLock(ordinaryPath, hooks, assertDirectory);
    try {
      cleanupRecoverableTemporaries();
      return lock;
    } catch (error) {
      try {
        lock.release();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "settings crashed-temporary cleanup failed and its authority lock could not release",
          { cause: releaseError },
        );
      }
      throw error;
    }
  }
  const write = (target: string, bytes: Uint8Array): void => {
    assertDirectory();
    (operations.writeExclusive ?? writeExclusive)(target, bytes);
  };
  const sync = (target: string): void => {
    assertDirectory();
    (operations.syncPath ?? syncPath)(target);
  };
  const replace = (source: string, target: string): void => {
    assertDirectory();
    (operations.atomicReplace ?? renameSync)(source, target);
  };
  const remove = (target: string): void => {
    assertDirectory();
    (operations.remove ?? unlinkSync)(target);
  };

  function readInitializationBytes(): Uint8Array | undefined {
    assertDirectory();
    return readPrivateRegularBytes(
      initializationPath,
      "settings initialization evidence",
      MAX_SETTINGS_INITIALIZATION_BYTES,
    );
  }

  function readRollbackBytes(): Uint8Array | undefined {
    assertDirectory();
    return readPrivateRegularBytes(
      rollbackPath,
      "settings rollback evidence",
      MAX_SETTINGS_ROLLBACK_BYTES,
    );
  }

  function readPrepareBytes(): Uint8Array | undefined {
    assertDirectory();
    return readPrivateRegularBytes(
      preparePath,
      "settings prepare evidence",
      MAX_SETTINGS_PREPARE_BYTES,
    );
  }

  function readDestinationBytes(destinationPath: string): Uint8Array | undefined {
    assertDirectory();
    if (destinationPath === ordinaryPath) {
      return readPrivateRegularBytes(ordinaryPath, "settings.json", MAX_SETTINGS_FILE_BYTES);
    }
    if (destinationPath === protectedPath) {
      return readPrivateRegularBytes(protectedPath, "protected.json", MAX_PROTECTED_SETTINGS_BYTES);
    }
    if (destinationPath === initializationPath) return readInitializationBytes();
    if (destinationPath === rollbackPath) return readRollbackBytes();
    if (destinationPath === preparePath) return readPrepareBytes();
    throw new Error(`settings authority cannot read undeclared destination ${destinationPath}`);
  }

  function readState(): Readonly<{
    record: Record;
    bytes: Uint8Array | undefined;
    initializationBytes: Uint8Array;
    initializationState: "virgin" | "initialized";
  }> {
    const rollbackBytes = readRollbackBytes();
    if (rollbackBytes !== undefined) {
      const rollback = parseSettingsRollback(rollbackPath, rollbackBytes);
      if (rollback.settingsPathFingerprint !== settingsPathFingerprint(ordinaryPath)) {
        throw new Error(`settings rollback evidence ${rollbackPath} belongs to another path`);
      }
      throw new Error(
        `interrupted settings rollback ${rollback.rollbackId} for command ${rollback.command.commandId} `
        + `left ${rollback.target} recovery evidence at ${rollbackPath}; `
        + `automatic settings reconciliation is refused`,
      );
    }
    const prepareBytes = readPrepareBytes();
    if (prepareBytes !== undefined) {
      const prepare = parseSettingsPrepare(preparePath, prepareBytes);
      throw new Error(
        `interrupted settings prepare ${prepare.prepareId} for command ${prepare.command.commandId} `
        + `requires exclusive journal reconciliation`,
      );
    }
    let ordinaryBytes = readPrivateRegularBytes(ordinaryPath, "settings.json", MAX_SETTINGS_FILE_BYTES);
    let protectedBytes = readPrivateRegularBytes(protectedPath, "protected.json", MAX_PROTECTED_SETTINGS_BYTES);
    let evidenceBytes = readInitializationBytes();
    if (evidenceBytes === undefined) {
      if (ordinaryBytes !== undefined || protectedBytes !== undefined) {
        throw new Error("authority-unjournaled: settings documents exist without authority.json");
      }
      evidenceBytes = initializationBytes("virgin", "virgin");
      replaceExactBytes(initializationPath, evidenceBytes, undefined);
    }
    let evidence = parseSettingsInitialization(initializationPath, evidenceBytes);
    const baselines = [
      {
        target: "ordinary" as const,
        path: ordinaryPath,
        bytes: new TextEncoder().encode(`${canonicalJsonStringify(initialSettingsFileRecord())}\n`),
      },
      {
        target: "protected" as const,
        path: protectedPath,
        bytes: new TextEncoder().encode(`${canonicalJsonStringify(initialProtectedStoreRecord())}\n`),
      },
    ];
    for (const baseline of baselines) {
      const liveBytes = baseline.target === "ordinary" ? ordinaryBytes : protectedBytes;
      if (evidence[baseline.target] === "virgin") {
        if (liveBytes !== undefined && !equalBytes(liveBytes, baseline.bytes)) {
          throw new Error(
            `authority-uncertain: ${baseline.target === "ordinary" ? "settings.json" : "protected.json"} `
            + "exists before its revision-1 baseline was initialized",
          );
        }
        if (liveBytes === undefined) replaceExactBytes(baseline.path, baseline.bytes, undefined);
        const nextEvidenceBytes = initializationBytes(
          baseline.target === "ordinary" ? "initialized" : evidence.ordinary,
          baseline.target === "protected" ? "initialized" : evidence.protected,
        );
        replaceExactBytes(initializationPath, nextEvidenceBytes, evidenceBytes);
        evidenceBytes = nextEvidenceBytes;
        evidence = parseSettingsInitialization(initializationPath, evidenceBytes);
        if (baseline.target === "ordinary") ordinaryBytes = baseline.bytes;
        else protectedBytes = baseline.bytes;
      } else if (liveBytes === undefined) {
        throw new Error(`authority-uncertain: ${baseline.target === "ordinary" ? "settings.json" : "protected.json"} presence does not match authority.json`);
      }
    }
    const bytes = codec.target === "ordinary" ? ordinaryBytes : protectedBytes;
    if (bytes === undefined) throw new Error(`authority-uncertain: ${basename(path)} baseline is absent after initialization`);
    const record = parseRecord(path, bytes);
    return Object.freeze({
      record,
      bytes,
      initializationBytes: evidenceBytes,
      initializationState: evidence[codec.target],
    });
  }

  function read(): Record {
    const lock = acquireDocumentAuthorityLock();
    return releaseAfter(lock, () => readState().record, `settings read for ${path}`);
  }

  function nextTemporaryPath(destinationPath: string): string {
    temporarySequence += 1;
    return join(
      directory,
      `.${basename(destinationPath)}.${String(process.pid)}.${String(temporarySequence)}.tmp`,
    );
  }

  function replaceExactBytes(
    destinationPath: string,
    bytes: Uint8Array,
    priorBytes: Uint8Array | undefined,
  ): void {
    assertDirectory();
    const temporaryPath = nextTemporaryPath(destinationPath);
    ownTemporaryPaths.add(temporaryPath);
    try {
      try {
        write(temporaryPath, bytes);
        sync(temporaryPath);
      } catch (error) {
        throwWithCleanup(
          new Error(`${destinationPath} could not stage a complete durable replacement`, { cause: error }),
          temporaryPath,
          remove,
        );
      }

      let liveBeforeReplace: Uint8Array | undefined;
      try {
        liveBeforeReplace = readDestinationBytes(destinationPath);
      } catch (error) {
        throwWithCleanup(
          new Error(`${destinationPath} live bytes could not be verified before replacement`, { cause: error }),
          temporaryPath,
          remove,
        );
      }
      if (!equalBytes(liveBeforeReplace, priorBytes)) {
        throwWithCleanup(
          new Error(`${destinationPath} live bytes changed before replacement; refusing to overwrite concurrent evidence`),
          temporaryPath,
          remove,
        );
      }
      try {
        replace(temporaryPath, destinationPath);
      } catch (error) {
        const liveBytes = readDestinationBytes(destinationPath);
        if (equalBytes(liveBytes, priorBytes)) {
          throwWithCleanup(
            new Error(`atomic settings replacement failed before changing ${destinationPath}`, { cause: error }),
            temporaryPath,
            remove,
          );
        }
        if (!equalBytes(liveBytes, bytes)) {
          throwWithCleanup(
            new Error(
              `atomic settings replacement failed and ${destinationPath} matches neither the prior nor staged bytes; outcome is uncertain`,
              { cause: error },
            ),
            temporaryPath,
            remove,
          );
        }
        // The replace took effect despite throwing; exact byte reconciliation is
        // the transition proof, so continue through the same directory fsync.
      }

      try {
        sync(directory);
      } catch (error) {
        throw new Error(
          `settings replacement reached ${destinationPath}, but its directory fsync failed; durability is uncertain`,
          { cause: error },
        );
      }
      if (!equalBytes(readDestinationBytes(destinationPath), bytes)) {
        throw new Error(`settings readback for ${destinationPath} differs from the exact bytes atomically replaced`);
      }
    } finally {
      ownTemporaryPaths.delete(temporaryPath);
    }
  }

  function restoreAbsence(expectedLiveBytes: Uint8Array): void {
    const liveBytes = readDocumentBytes();
    if (!equalBytes(liveBytes, expectedLiveBytes)) {
      throw new Error(`settings rollback refused because ${path} no longer contains the update being rolled back`);
    }
    try {
      remove(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    sync(directory);
    if (readDocumentBytes() !== undefined) {
      throw new Error(`settings rollback could not restore the valid absent-file baseline at ${path}`);
    }
  }

  function removeRollbackEvidence(expectedBytes: Uint8Array): void {
    const liveBytes = readRollbackBytes();
    if (!equalBytes(liveBytes, expectedBytes)) {
      throw new Error(
        `settings rollback completion refused because ${rollbackPath} no longer contains its exact evidence`,
      );
    }
    remove(rollbackPath);
    sync(directory);
    if (readRollbackBytes() !== undefined) {
      throw new Error(`settings rollback evidence ${rollbackPath} remained after durable completion`);
    }
  }

  function removePrepareEvidence(expectedBytes: Uint8Array, retryAfterAttempt = false): void {
    const liveBytes = readPrepareBytes();
    if (liveBytes === undefined && retryAfterAttempt) {
      sync(directory);
      if (readPrepareBytes() !== undefined) {
        throw new Error(`settings prepare evidence ${preparePath} reappeared during completion retry`);
      }
      return;
    }
    if (!equalBytes(liveBytes, expectedBytes)) {
      throw new Error(
        `settings prepare completion refused because ${preparePath} no longer contains its exact evidence`,
      );
    }
    remove(preparePath);
    sync(directory);
    if (readPrepareBytes() !== undefined) {
      throw new Error(`settings prepare evidence ${preparePath} remained after durable completion`);
    }
  }

  function inspectPreparedUpdate(prepareBytes: Uint8Array): Readonly<{
    record: SettingsPrepareRecord;
    publicUpdate: PreparedDocument<Record>;
    priorSettingsBytes: Uint8Array | undefined;
    nextSettingsBytes: Uint8Array;
    priorInitializationBytes: Uint8Array;
    nextInitializationBytes: Uint8Array;
  }> {
    const record = parseSettingsPrepare(preparePath, prepareBytes);
    if (record.target !== codec.target || record.settingsPathFingerprint !== settingsPathFingerprint(ordinaryPath)) {
      throw new Error(`settings prepare evidence ${preparePath} belongs to another path`);
    }
    const priorSettingsBytes = record.priorSettingsBytesBase64 === null
      ? undefined
      : decodeBase64(record.priorSettingsBytesBase64, "prepared prior settings bytes");
    const nextSettingsBytes = decodeBase64(
      record.nextSettingsBytesBase64,
      "prepared next settings bytes",
    );
    const priorInitializationBytes = decodeBase64(
      record.priorInitializationBytesBase64,
      "prepared prior initialization bytes",
    );
    const nextInitializationBytes = decodeBase64(
      record.nextInitializationBytesBase64,
      "prepared next initialization bytes",
    );
    const prior = priorSettingsBytes === undefined
      ? codec.initial()
      : parseRecord(path, priorSettingsBytes);
    const next = parseRecord(path, nextSettingsBytes);
    const priorInitialization = parseSettingsInitialization(
      initializationPath,
      priorInitializationBytes,
    );
    const nextInitialization = parseSettingsInitialization(
      initializationPath,
      nextInitializationBytes,
    );
    const otherTarget = codec.target === "ordinary" ? "protected" : "ordinary";
    if (nextInitialization[codec.target] !== "initialized"
      || priorInitialization[otherTarget] !== nextInitialization[otherTarget]
      || (priorSettingsBytes !== undefined) !== (priorInitialization[codec.target] === "initialized")) {
      throw new Error(`settings prepare evidence ${preparePath} has invalid initialization authority`);
    }
    const applied = next.lastApplied;
    if (prior.revision !== record.command.expectedRevision
      || next.revision !== prior.revision + 1
      || applied === undefined
      || canonicalJsonStringify(applied) !== canonicalJsonStringify(record.command)) {
      throw new Error(`settings prepare evidence ${preparePath} does not bind its exact prior, next, and command`);
    }
    return Object.freeze({
      record,
      publicUpdate: Object.freeze({
        prepareId: record.prepareId,
        target: codec.target,
        command: Object.freeze({ ...record.command }),
        prior,
        next,
      }),
      priorSettingsBytes,
      nextSettingsBytes,
      priorInitializationBytes,
      nextInitializationBytes,
    });
  }

  function restorePreparedSettings(
    liveBytes: Uint8Array | undefined,
    priorBytes: Uint8Array | undefined,
    nextBytes: Uint8Array,
  ): void {
    if (equalBytes(liveBytes, priorBytes)) return;
    if (!equalBytes(liveBytes, nextBytes)) {
      throw new Error(`settings prepare rollback found live bytes matching neither exact prior nor next`);
    }
    if (priorBytes === undefined) restoreAbsence(nextBytes);
    else replaceExactBytes(path, priorBytes, nextBytes);
  }

  return Object.freeze({
    read,
    pendingTarget(): SettingsDocumentTarget | undefined {
      const lock = acquireDocumentAuthorityLock();
      return releaseAfter(lock, () => {
        const prepareBytes = readPrepareBytes();
        const rollbackBytes = readRollbackBytes();
        if (prepareBytes === undefined) {
          if (rollbackBytes !== undefined) throw new Error("authority-uncertain: rollback.json has no prepare.json");
          return undefined;
        }
        const prepared = parseSettingsPrepare(preparePath, prepareBytes);
        if (prepared.settingsPathFingerprint !== settingsPathFingerprint(ordinaryPath)) {
          throw new Error("authority-uncertain: prepare.json belongs to another root");
        }
        return prepared.target;
      }, `settings recovery target for ${ordinaryPath}`);
    },
    reconcile(
      resolvePrepared: (prepared: PreparedDocument<Record>) => SettingsPrepareResolution,
    ): Record {
      const lock = acquireDocumentAuthorityLock();
      return releaseAfter(lock, () => {
        const prepareBytes = readPrepareBytes();
        if (prepareBytes === undefined) return readState().record;
        const prepared = inspectPreparedUpdate(prepareBytes);
        const resolution = resolvePrepared(prepared.publicUpdate);
        if (resolution === "committed") {
          if (readRollbackBytes() !== undefined) {
            throw new Error(`committed settings prepare ${prepared.record.prepareId} also has rollback evidence`);
          }
          const liveSettingsBytes = readDocumentBytes();
          if (!equalBytes(liveSettingsBytes, prepared.nextSettingsBytes)) {
            throw new Error(
              `committed settings prepare ${prepared.record.prepareId} does not have its exact next bytes live`,
            );
          }
          const liveInitializationBytes = readInitializationBytes();
          if (!equalBytes(liveInitializationBytes, prepared.nextInitializationBytes)) {
            if (!equalBytes(liveInitializationBytes, prepared.priorInitializationBytes)) {
              throw new Error(
                `committed settings prepare ${prepared.record.prepareId} has divergent initialization evidence`,
              );
            }
            replaceExactBytes(
              initializationPath,
              prepared.nextInitializationBytes,
              liveInitializationBytes,
            );
          }
          if (readRollbackBytes() !== undefined) {
            throw new Error(
              `committed settings prepare ${prepared.record.prepareId} also has rollback evidence`,
            );
          }
        } else if (resolution === "rollback") {
          const { prepareId: _prepareId, ...prepareBody } = prepared.record;
          let rollbackBytes = readRollbackBytes();
          if (rollbackBytes !== undefined) {
            const rollback = parseSettingsRollback(rollbackPath, rollbackBytes);
            const { rollbackId: _rollbackId, ...rollbackBody } = rollback;
            if (canonicalJsonStringify(rollbackBody) !== canonicalJsonStringify(prepareBody)) {
              throw new Error(`settings rollback evidence ${rollbackPath} does not bind prepare ${prepared.record.prepareId}`);
            }
          } else {
            rollbackBytes = new TextEncoder().encode(`${canonicalJsonStringify(SettingsRollbackRecordSchema.parse({
              ...prepareBody, rollbackId: randomUUID(),
            }))}\n`);
            replaceExactBytes(rollbackPath, rollbackBytes, undefined);
          }
          hooks.afterRollbackPrepared?.();
          restorePreparedSettings(readDocumentBytes(), prepared.priorSettingsBytes, prepared.nextSettingsBytes);
          hooks.afterRollbackSettingsRestored?.();
          const liveInitializationBytes = readInitializationBytes();
          if (!equalBytes(liveInitializationBytes, prepared.priorInitializationBytes)) {
            if (!equalBytes(liveInitializationBytes, prepared.nextInitializationBytes)) {
              throw new Error(`settings prepare ${prepared.record.prepareId} has divergent initialization evidence`);
            }
            replaceExactBytes(initializationPath, prepared.priorInitializationBytes, liveInitializationBytes);
          }
          hooks.afterRollbackInitializationRestored?.();
          removeRollbackEvidence(rollbackBytes);
        } else {
          throw new Error(`settings prepare resolver returned invalid resolution ${String(resolution)}`);
        }
        removePrepareEvidence(prepareBytes);
        const record = resolution === "committed"
          ? prepared.publicUpdate.next
          : prepared.publicUpdate.prior;
        const exactLive = readDocumentBytes();
        const expectedLive = resolution === "committed"
          ? prepared.nextSettingsBytes
          : prepared.priorSettingsBytes;
        if (!equalBytes(exactLive, expectedLive)) {
          throw new Error(`settings prepare ${prepared.record.prepareId} outcome changed before readback`);
        }
        return record;
      }, `settings prepare reconciliation for ${path}`);
    },
    withCurrentRecord<Result>(work: (record: Record) => Result): Result {
      const lock = acquireDocumentAuthorityLock();
      return releaseAfter(lock, () => work(readState().record), `settings record read for ${path}`);
    },
    withExactRecord<Result>(expectedInput: unknown, work: () => Result): Result {
      const lock = acquireDocumentAuthorityLock();
      return releaseAfter(lock, () => {
        codec.verifyExact(readState().record, expectedInput);
        return work();
      }, `exact settings fence for ${path}`);
    },
    withRootBackupSnapshot<Result>(
      work: (snapshot: SettingsRootBackupSnapshot) => Promise<Result>,
    ): Promise<Result> {
      const lock = acquireDocumentAuthorityLock();
      return releaseAfterAsync(lock, async () => {
        if (readPrepareBytes() !== undefined || readRollbackBytes() !== undefined) {
          throw new Error("authority-uncertain: settings recovery evidence blocks verified backup");
        }
        const ordinaryBytes = readPrivateRegularBytes(
          ordinaryPath,
          "settings.json",
          MAX_SETTINGS_FILE_BYTES,
        );
        const protectedBytes = readPrivateRegularBytes(
          protectedPath,
          "protected.json",
          MAX_PROTECTED_SETTINGS_BYTES,
        );
        const authorityBytes = readInitializationBytes();
        if (ordinaryBytes === undefined || protectedBytes === undefined || authorityBytes === undefined) {
          throw new Error("authority-unjournaled: verified backup requires both settings documents and authority.json");
        }
        const authority = parseSettingsInitialization(initializationPath, authorityBytes);
        if (authority.ordinary !== "initialized" || authority.protected !== "initialized") {
          throw new Error("authority.json does not bind initialized settings.json and protected.json documents");
        }
        const snapshot = Object.freeze({
          ordinaryBytes,
          authorityBytes,
          ordinary: SettingsFileRecordSchema.parse(JSON.parse(new TextDecoder().decode(ordinaryBytes))),
          protected: ProtectedStoreRecordSchema.parse(JSON.parse(new TextDecoder().decode(protectedBytes))),
        });
        return work(snapshot);
      }, `settings backup snapshot for ${ordinaryPath}`);
    },
    apply(input: unknown): DocumentUpdate<Record> | SettingsApplyRefusal {
      const admission = codec.admit(input);
      if (admission.state !== "admitted") return admission;
      const request = admission.request;
      const lock = acquireDocumentAuthorityLock();
      let priorBytes: Uint8Array | undefined;
      let priorInitializationBytes: Uint8Array | undefined;
      let replacementAttempted = false;
      let rollbackFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const currentState = readState();
        priorInitializationBytes = currentState.initializationBytes;
        const current = currentState.record;
        if (current.lastApplied?.commandId === request.commandId) {
          const isExactReplay = canonicalJsonStringify(current.lastApplied) === canonicalJsonStringify(codec.command(request))
            && current.revision === request.expectedRevision + 1
            && codec.verifyReplay(current, request);
          if (!isExactReplay) {
            throw new Error(
              `command-divergent: settings command ${request.commandId} differs from its persisted canonical envelope`,
            );
          }
          const settlement = settingsSettlement(lock, () => undefined);
          return Object.freeze({
            state: "applied",
            record: current,
            // The first attempt crossed the file boundary before its command
            // journal committed. Recovery journals it now and must not undo it
            // if that second journal attempt also fails.
            rollback: settlement.rollback,
            commit: settlement.settle,
          });
        }
        if (request.expectedRevision !== current.revision) {
          return releaseAfter(lock, () => deepFreeze(SettingsApplyRefusalSchema.parse({
            state: "conflict",
            currentRevision: current.revision,
            message: `settings revision ${String(request.expectedRevision)} is stale; current revision is ${String(current.revision)}`,
          })), `settings revision refusal for ${path}`);
        }

        const record = codec.next(current, request);
        priorBytes = currentState.bytes;
        const nextBytes = new TextEncoder().encode(`${canonicalJsonStringify(record)}\n`);
        if (nextBytes.byteLength > codec.maximumBytes) {
          throw new Error(
            `document-too-large: ${basename(path)} exceeds its maximum before replacement`,
          );
        }
        const priorAuthority = parseSettingsInitialization(initializationPath, currentState.initializationBytes);
        const nextInitializationBytes = initializationBytes(
          codec.target === "ordinary" ? "initialized" : priorAuthority.ordinary,
          codec.target === "protected" ? "initialized" : priorAuthority.protected,
        );
        if (priorInitializationBytes === undefined) {
          throw new Error(`settings apply for ${path} has no initialization evidence snapshot`);
        }
        const initializationSnapshot = priorInitializationBytes;
        const prepareRecord = SettingsPrepareRecordSchema.parse({
          schemaVersion: 1,
          prepareId: randomUUID(),
          settingsPathFingerprint: settingsPathFingerprint(ordinaryPath),
          target: codec.target,
          command: codec.command(request),
          priorSettingsBytesBase64: priorBytes === undefined ? null : encodeBase64(priorBytes),
          nextSettingsBytesBase64: encodeBase64(nextBytes),
          priorInitializationBytesBase64: encodeBase64(initializationSnapshot),
          nextInitializationBytesBase64: encodeBase64(nextInitializationBytes),
        });
        const prepareBytes = new TextEncoder().encode(
          `${canonicalJsonStringify(prepareRecord)}\n`,
        );
        replaceExactBytes(preparePath, prepareBytes, undefined);
        const { prepareId: _prepareId, ...recoveryBody } = prepareRecord;
        const rollbackRecord = SettingsRollbackRecordSchema.parse({ ...recoveryBody, rollbackId: randomUUID() });
        const rollbackBytes = new TextEncoder().encode(
          `${canonicalJsonStringify(rollbackRecord)}\n`,
        );
        const restorePriorState = (): void => {
          try {
            replaceExactBytes(rollbackPath, rollbackBytes, undefined);
            hooks.afterRollbackPrepared?.();
            if (priorBytes === undefined) {
              restoreAbsence(nextBytes);
            } else {
              replaceExactBytes(path, priorBytes, nextBytes);
            }
            hooks.afterRollbackSettingsRestored?.();
            const liveInitializationBytes = readInitializationBytes();
            if (!equalBytes(liveInitializationBytes, initializationSnapshot)) {
              replaceExactBytes(
                initializationPath,
                initializationSnapshot,
                liveInitializationBytes,
              );
            }
            hooks.afterRollbackInitializationRestored?.();
            removeRollbackEvidence(rollbackBytes);
            removePrepareEvidence(prepareBytes);
            hooks.afterRollbackCompleted?.();
          } catch (error) {
            rollbackFailure = Object.freeze({ error });
            throw error;
          }
        };
        replacementAttempted = true;
        replaceExactBytes(path, nextBytes, priorBytes);
        try {
          if (!equalBytes(priorInitializationBytes, nextInitializationBytes)) {
            replaceExactBytes(
              initializationPath,
              nextInitializationBytes,
              priorInitializationBytes,
            );
          }
        } catch (error) {
          try {
            restorePriorState();
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              `settings apply for ${path} could not persist initialization evidence or restore its prior state`,
              { cause: rollbackError },
            );
          }
          throw error;
        }
        const persisted = parseRecord(path, nextBytes);
        let prepareCleanupAttempted = false;
        const settlement = settingsSettlement(
          lock,
          restorePriorState,
          () => {
            const retryAfterAttempt = prepareCleanupAttempted;
            prepareCleanupAttempted = true;
            removePrepareEvidence(prepareBytes, retryAfterAttempt);
          },
        );
        return Object.freeze({
          state: "applied",
          record: persisted,
          rollback: settlement.rollback,
          commit: settlement.settle,
        });
      } catch (error) {
        let safeToRelease = !replacementAttempted;
        if (replacementAttempted) {
          let inspection:
            | Readonly<{ state: "verified"; safeToRelease: boolean }>
            | Readonly<{ state: "failed"; error: unknown }>;
          try {
            inspection = Object.freeze({
              state: "verified",
              safeToRelease: rollbackFailure === undefined
                && equalBytes(readDocumentBytes(), priorBytes)
                && priorInitializationBytes !== undefined
                && equalBytes(readInitializationBytes(), priorInitializationBytes)
                && readRollbackBytes() === undefined,
            });
          } catch (inspectionError) {
            inspection = Object.freeze({ state: "failed", error: inspectionError });
          }
          if (inspection.state === "failed") {
            throw new AggregateError(
              [error, inspection.error],
              `settings apply for ${path} failed and could not verify failure integrity; `
              + "exclusive authority remains held",
              { cause: error },
            );
          }
          safeToRelease = inspection.safeToRelease;
        }
        if (safeToRelease) {
          try {
            lock.release();
          } catch (releaseError) {
            throw new AggregateError(
              [error, releaseError],
              `settings apply for ${path} failed and exclusive authority could not release`,
              { cause: releaseError },
            );
          }
        }
        throw error;
      }
    },
  });
}

/** The ordinary and protected adapters share the exact same root protocol and lock pathname. */
export function createSettingsFileAuthority(options: SettingsFileAuthorityOptions): SettingsFileAuthority {
  const codec: DocumentCodec<SettingsFileRecord, SettingsApplyInput> = {
    target: "ordinary",
    maximumBytes: MAX_SETTINGS_FILE_BYTES,
    schema: SettingsFileRecordSchema,
    initial: initialSettingsFileRecord,
    admit(input) {
      const preflight = SettingsApplyPreflightSchema.safeParse(input);
      if (!preflight.success) {
        return invalidRequest(`invalid-value: settings request ${issuePath(preflight.error.issues[0])}`);
      }
      if (preflight.data.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
        return deepFreeze(SettingsApplyRefusalSchema.parse({
          state: "rejected", code: "schema-mismatch", message: "settings.json schema-mismatch",
        }));
      }
      let expectedPatchFingerprint: string;
      try {
        expectedPatchFingerprint = rawSettingsPatchFingerprint(preflight.data.patch);
      } catch {
        return invalidRequest("invalid-value: settings patch is not canonical JSON");
      }
      if (preflight.data.patchFingerprint !== expectedPatchFingerprint) {
        return deepFreeze(SettingsApplyRefusalSchema.parse({
          state: "rejected", code: "patch-fingerprint-mismatch", message: "patch-fingerprint-mismatch: settings patch fingerprint does not match its canonical value",
        }));
      }
      const parsed = SettingsApplyInputSchema.safeParse(input);
      if (!parsed.success) {
        const notEditable = firstNotEditableSettingsPath(parsed.error);
        if (notEditable !== undefined) return invalidRequest(`not-editable { key: ${notEditable} }`);
        return invalidRequest(`invalid-value { key: ${issuePath(parsed.error.issues[0])} }`);
      }
      return { state: "admitted", request: parsed.data };
    },
    command(request) {
      return SettingsCommandIdentitySchema.options[0].parse({
        commandId: request.commandId, commandFingerprint: request.commandFingerprint,
        expectedRevision: request.expectedRevision, settingsSchemaHash: request.settingsSchemaHash,
        patchFingerprint: request.patchFingerprint,
      });
    },
    next(current, request) {
      try {
        const settings = mergeSettingsPatch(current.settings, request.patch);
        options.validateCandidate(settings);
        return deepFreeze(SettingsFileRecordSchema.parse({
          revision: current.revision + 1, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          settingsFingerprint: derivePersistedSettingsFingerprint(settings), settings,
          lastApplied: codec.command(request),
        }));
      } catch (error) {
        const keys = error instanceof z.ZodError
          ? [...new Set(error.issues.map(issuePath))].sort().join(",")
          : "settings";
        throw new Error(`cross-field-invalid { keys: ${keys} }`, { cause: error });
      }
    },
    verifyReplay: () => true,
    verifyExact(current, expectedInput) {
      const expected = SettingsFileExpectationSchema.parse(expectedInput);
      if (current.revision !== expected.revision || current.settingsFingerprint !== expected.settingsFingerprint) {
        throw new Error("settings changed after worker boot; restart activation is required");
      }
    },
  };
  const authority = createDocumentAuthority(options, codec);
  return Object.freeze({
    read: authority.read,
    pendingTarget: authority.pendingTarget,
    apply: authority.apply,
    withExactRecord: authority.withExactRecord,
    withRootBackupSnapshot: authority.withRootBackupSnapshot,
    reconcile(resolvePrepared: (prepared: SettingsPreparedUpdate) => SettingsPrepareResolution) {
      return authority.reconcile((prepared) => resolvePrepared({
        ...prepared,
        command: SettingsCommandIdentitySchema.options[0].parse(prepared.command),
      }));
    },
  });
}

export interface ProtectedSettingsFileAuthorityOptions extends Pick<SettingsFileAuthorityOptions, "path" | "operations" | "hooks"> {
  /** Journal-backed uniqueness check, called only after revision CAS and while the shared lock is held. */
  readonly assertWriteIdAvailable: (writeId: string, commandId: string) => void;
}
export type ProtectedSettingsAdmissionOutcome =
  | Readonly<{ state: "admitted"; request: ProtectedSettingsApplyInput }>
  | SettingsApplyRefusal;
export type ProtectedSettingsFileAuthority = DocumentAuthority<ProtectedStoreRecord> & Readonly<{
  /** Pure request admission: performs no authority read, lock acquisition, or materialization. */
  admit(input: unknown): ProtectedSettingsAdmissionOutcome;
}>;

/** Fixed-size direct byte comparison; no value-derived surrogate leaves this stack frame. */
function protectedValueEquals(left: unknown, right: unknown): boolean {
  const leftBytes = Buffer.from(canonicalJsonStringify(left));
  const rightBytes = Buffer.from(canonicalJsonStringify(right));
  if (leftBytes.byteLength > MAX_PROTECTED_SETTINGS_BYTES || rightBytes.byteLength > MAX_PROTECTED_SETTINGS_BYTES) {
    throw new Error("invalid-value: protected entry exceeds its private comparison bound");
  }
  const leftPadded = Buffer.alloc(MAX_PROTECTED_SETTINGS_BYTES + 4);
  const rightPadded = Buffer.alloc(MAX_PROTECTED_SETTINGS_BYTES + 4);
  leftPadded.writeUInt32BE(leftBytes.byteLength);
  rightPadded.writeUInt32BE(rightBytes.byteLength);
  leftPadded.set(leftBytes, 4);
  rightPadded.set(rightBytes, 4);
  return timingSafeEqual(leftPadded, rightPadded);
}

export function createProtectedSettingsFileAuthority(options: ProtectedSettingsFileAuthorityOptions): ProtectedSettingsFileAuthority {
  const codec: DocumentCodec<ProtectedStoreRecord, ProtectedSettingsApplyInput> = {
    target: "protected",
    maximumBytes: MAX_PROTECTED_SETTINGS_BYTES,
    schema: ProtectedStoreRecordSchema,
    initial: initialProtectedStoreRecord,
    admit(input) {
      const preflight = ProtectedSettingsApplyPreflightSchema.safeParse(input);
      if (!preflight.success) {
        return invalidRequest(`invalid-value: protected request ${issuePath(preflight.error.issues[0])}`);
      }
      if (preflight.data.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
        return deepFreeze(SettingsApplyRefusalSchema.parse({
          state: "rejected", code: "schema-mismatch", message: "protected.json schema-mismatch",
        }));
      }
      const parsed = ProtectedSettingsApplyInputSchema.safeParse(input);
      if (!parsed.success) {
        const notEditable = firstUnrecognizedKey(parsed.error);
        if (notEditable !== undefined) return invalidRequest(`not-editable { key: ${notEditable} }`);
        return invalidRequest(`invalid-value { key: ${issuePath(parsed.error.issues[0])} }`);
      }
      return { state: "admitted", request: parsed.data };
    },
    command(request) {
      return ProtectedSettingsLastAppliedSchema.parse({
        commandId: request.commandId, commandFingerprint: request.commandFingerprint,
        expectedRevision: request.expectedRevision, protectedSchemaHash: request.protectedSchemaHash,
        writeId: request.writeId,
      });
    },
    next(current, request) {
      options.assertWriteIdAvailable(request.writeId, request.commandId);
      const entries = new Map<string, unknown>(Object.entries(current.entries));
      for (const name of ProtectedSettingsNameSchema.options) {
        const operation = request.entries[name];
        if (operation === undefined) continue;
        if ("clear" in operation) entries.delete(name);
        else entries.set(name, { valueId: randomUUID(), value: operation.set, updatedAt: request.updatedAt });
      }
      return deepFreeze(ProtectedStoreRecordSchema.parse({
        schemaVersion: 1, revision: current.revision + 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        entries: Object.fromEntries(entries), lastApplied: codec.command(request),
      }));
    },
    verifyReplay(current, request) {
      let equal = true;
      for (const name of ProtectedSettingsNameSchema.options) {
        const operation = request.entries[name];
        if (operation === undefined) continue;
        const stored = current.entries[name];
        if ("clear" in operation) equal = (stored === undefined) && equal;
        else {
          // Compare even when an earlier entry diverged. Presence itself is public metadata.
          const matches = protectedValueEquals(operation.set, stored === undefined ? null : stored.value);
          equal = matches && stored !== undefined && equal;
        }
      }
      return equal;
    },
    verifyExact(current, expectedInput) {
      const expected = ProtectedStoreRecordSchema.parse(expectedInput);
      if (!protectedValueEquals(current, expected)) {
        throw new Error("authority-uncertain: protected.json changed before its exact record fence");
      }
    },
  };
  const authority = createDocumentAuthority(options, codec);
  return Object.freeze({
    ...authority,
    admit: (input: unknown) => codec.admit(input),
  });
}
