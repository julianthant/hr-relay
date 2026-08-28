import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
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
  deriveSettingsPatchFingerprint,
  initialSettingsFileRecord,
  mergeSettingsPatch,
  type SettingsApplyRefusal,
  type SettingsFileRecord,
} from "../../domain/config/settings.js";
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
  reconcile(resolve: (prepared: SettingsPreparedUpdate) => SettingsPrepareResolution): SettingsFileRecord;
  /** Hold exclusive settings authority while work atomically consumes this exact boot identity. */
  withExactRecord<Result>(expected: unknown, work: () => Result): Result;
  apply(input: unknown): SettingsFileApplyOutcome;
}

export interface SettingsFileAuthorityOptions {
  readonly path: string;
  /** Resolve the complete candidate through the composition's exact env/clock precedence. */
  readonly validateCandidate: (settings: SettingsFileRecord["settings"]) => void;
  readonly operations?: SettingsFileOperations;
  readonly hooks?: SettingsFileAuthorityHooks;
}

let temporarySequence = 0;
export const MAX_SETTINGS_FILE_BYTES = 1_048_576;
const MAX_SETTINGS_LOCK_BYTES = 16_384;
const MAX_SETTINGS_INITIALIZATION_BYTES = 16_384;
const MAX_SETTINGS_ROLLBACK_BYTES = 16_384;
const MAX_SETTINGS_PREPARE_BYTES = MAX_SETTINGS_FILE_BYTES * 3;

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

const SettingsInitializationRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  settingsPathFingerprint: FingerprintSchema,
  settingsSchemaHash: FingerprintSchema,
  state: z.enum(["virgin", "initialized"]),
});
type SettingsInitializationRecord = z.infer<typeof SettingsInitializationRecordSchema>;

const SettingsRollbackRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rollbackId: z.uuid(),
  settingsPathFingerprint: FingerprintSchema,
  commandId: z.uuid(),
  appliedRevision: PositiveIntSchema,
  priorRevision: PositiveIntSchema,
  appliedSettingsBytesFingerprint: FingerprintSchema,
  priorSettingsBytesFingerprint: FingerprintSchema.nullable(),
  priorInitializationBytesFingerprint: FingerprintSchema,
}).superRefine((record, context) => {
  if (record.priorRevision + 1 !== record.appliedRevision) {
    context.addIssue({
      code: "custom",
      path: ["priorRevision"],
      message: "settings rollback must reverse exactly one applied revision",
    });
  }
});
type SettingsRollbackRecord = z.infer<typeof SettingsRollbackRecordSchema>;

const Base64BytesSchema = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const SettingsPrepareRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  prepareId: z.uuid(),
  settingsPathFingerprint: FingerprintSchema,
  command: z.strictObject({
    commandId: z.uuid(),
    commandFingerprint: FingerprintSchema,
    expectedRevision: PositiveIntSchema,
    settingsSchemaHash: FingerprintSchema,
    patchFingerprint: FingerprintSchema,
  }),
  priorSettingsBytesBase64: Base64BytesSchema.nullable(),
  nextSettingsBytesBase64: Base64BytesSchema,
  priorInitializationBytesBase64: Base64BytesSchema,
  nextInitializationBytesBase64: Base64BytesSchema,
});
type SettingsPrepareRecord = z.infer<typeof SettingsPrepareRecordSchema>;

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

interface PrivateRegularFileRead {
  readonly bytes: Uint8Array;
  readonly device: number;
  readonly inode: number;
  readonly linkCount: number;
}

function readPrivateRegularFile(
  path: string,
  label: string,
  maximumBytes: number,
  allowedLinkCounts: readonly number[] = [1],
): PrivateRegularFileRead | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof Error && Reflect.get(error, "code") === "ELOOP") {
      throw new Error(`${label} ${path} is a symbolic link; no-follow authority refused it`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
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
    const permissions = status.mode & 0o777;
    if (permissions !== 0o600) {
      throw new Error(
        `${label} ${path} permissions are ${permissions.toString(8)}; exactly 600 is required`,
      );
    }
    if (status.size > maximumBytes) {
      throw new Error(
        `${label} ${path} is ${String(status.size)} bytes; maximum is ${String(maximumBytes)}`,
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
  } finally {
    closeSync(descriptor);
  }
}

function readPrivateRegularBytes(
  path: string,
  label: string,
  maximumBytes: number,
): Uint8Array | undefined {
  return readPrivateRegularFile(path, label, maximumBytes)?.bytes;
}

function readBytes(path: string): Uint8Array | undefined {
  return readPrivateRegularBytes(path, "settings file", MAX_SETTINGS_FILE_BYTES);
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
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
  } catch (error) {
    throw new Error(`settings rollback evidence ${path} is malformed`, { cause: error });
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
  } catch (error) {
    throw new Error(`settings prepare evidence ${path} is malformed`, { cause: error });
  }
}

function bytesFingerprint(bytes: Uint8Array): string {
  return FingerprintSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}

function settingsPathFingerprint(path: string): string {
  return FingerprintSchema.parse(sha256Hex(path));
}

function initializationBytes(path: string, state: "virgin" | "initialized"): Uint8Array {
  const record = SettingsInitializationRecordSchema.parse({
    schemaVersion: 1,
    settingsPathFingerprint: settingsPathFingerprint(path),
    settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    state,
  });
  return new TextEncoder().encode(`${canonicalJsonStringify(record)}\n`);
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

function settingsSettlement(
  lock: SettingsAuthorityLockHandle,
  rollbackAction: () => void,
  commitAction: () => void = () => undefined,
): Readonly<{ commit(): void; rollback(): void }> {
  let settled = false;
  let rollbackCompleted = false;
  return Object.freeze({
    commit(): void {
      if (settled) return;
      commitAction();
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
  hooks: SettingsFileAuthorityHooks = {},
): SettingsAuthorityLockHandle {
  const directory = dirname(settingsPath);
  const lockPath = `${settingsPath}.lock`;
  const reaperPath = `${lockPath}.reaper`;
  const pathFingerprint = settingsPathFingerprint(settingsPath);
  const observation = observeProcessIdentity(process.pid);
  if (observation.state === "gone") {
    throw new Error(`cannot claim settings authority for non-running pid ${String(process.pid)}`);
  }
  const processIdentity = observation.identity;
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  function mainLockHandle(record: SettingsAuthorityLockRecord): SettingsAuthorityLockHandle {
    let released = false;
    return Object.freeze({
      release(): void {
        if (released) return;
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
  const recoverySuffix = ".recovery";

  function recoveryPath(reaperId: string): string {
    return join(directory, `${recoveryPrefix}${reaperId}${recoverySuffix}`);
  }

  function readRecoveryBarrier(): DeadReaperRecoveryBarrier | undefined {
    const entryNames = readdirSync(directory)
      .filter((name) => name.startsWith(recoveryPrefix) && name.endsWith(recoverySuffix))
      .sort();
    if (entryNames.length > 1) {
      throw new Error(
        `settings stale-reaper recovery has multiple barriers: ${entryNames.join(", ")}`,
      );
    }
    const entryName = entryNames[0];
    if (entryName === undefined) return undefined;
    const reaperId = z.uuid().parse(
      entryName.slice(recoveryPrefix.length, -recoverySuffix.length),
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
      fsyncSync(descriptor);
      hooks.afterReaperFsync?.();
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

function parseRecord(path: string, bytes: Uint8Array): SettingsFileRecord {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`settings file ${path} is not valid JSON`, { cause: error });
  }
  try {
    return deepFreeze(SettingsFileRecordSchema.parse(decoded));
  } catch (error) {
    throw new Error(`settings file ${path} does not satisfy the strict persisted settings contract`, {
      cause: error,
    });
  }
}

export function createSettingsFileAuthority(options: SettingsFileAuthorityOptions): SettingsFileAuthority {
  const path = resolve(options.path);
  const directory = dirname(path);
  const initializationPath = `${path}.authority.json`;
  const rollbackPath = `${path}.rollback.json`;
  const preparePath = `${path}.prepare.json`;
  const validateCandidate = options.validateCandidate;
  const operations = options.operations ?? {};
  const hooks = options.hooks ?? {};
  const write = operations.writeExclusive ?? writeExclusive;
  const sync = operations.syncPath ?? syncPath;
  const replace = operations.atomicReplace ?? renameSync;
  const remove = operations.remove ?? unlinkSync;

  function readInitializationBytes(): Uint8Array | undefined {
    return readPrivateRegularBytes(
      initializationPath,
      "settings initialization evidence",
      MAX_SETTINGS_INITIALIZATION_BYTES,
    );
  }

  function readRollbackBytes(): Uint8Array | undefined {
    return readPrivateRegularBytes(
      rollbackPath,
      "settings rollback evidence",
      MAX_SETTINGS_ROLLBACK_BYTES,
    );
  }

  function readPrepareBytes(): Uint8Array | undefined {
    return readPrivateRegularBytes(
      preparePath,
      "settings prepare evidence",
      MAX_SETTINGS_PREPARE_BYTES,
    );
  }

  function readDestinationBytes(destinationPath: string): Uint8Array | undefined {
    if (destinationPath === path) return readBytes(path);
    if (destinationPath === initializationPath) return readInitializationBytes();
    if (destinationPath === rollbackPath) return readRollbackBytes();
    if (destinationPath === preparePath) return readPrepareBytes();
    throw new Error(`settings authority cannot read undeclared destination ${destinationPath}`);
  }

  function readState(): Readonly<{
    record: SettingsFileRecord;
    bytes: Uint8Array | undefined;
    initializationBytes: Uint8Array;
    initializationState: "virgin" | "initialized";
  }> {
    const rollbackBytes = readRollbackBytes();
    if (rollbackBytes !== undefined) {
      const rollback = parseSettingsRollback(rollbackPath, rollbackBytes);
      if (rollback.settingsPathFingerprint !== settingsPathFingerprint(path)) {
        throw new Error(`settings rollback evidence ${rollbackPath} belongs to another path`);
      }
      throw new Error(
        `interrupted settings rollback ${rollback.rollbackId} for command ${rollback.commandId} `
        + `left revision ${String(rollback.appliedRevision)} recovery evidence at ${rollbackPath}; `
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
    const bytes = readBytes(path);
    let evidenceBytes = readInitializationBytes();
    let evidence: SettingsInitializationRecord;
    if (evidenceBytes === undefined) {
      evidenceBytes = initializationBytes(path, bytes === undefined ? "virgin" : "initialized");
      replaceExactBytes(initializationPath, evidenceBytes, undefined);
      evidence = parseSettingsInitialization(initializationPath, evidenceBytes);
    } else {
      evidence = parseSettingsInitialization(initializationPath, evidenceBytes);
      if (evidence.settingsPathFingerprint !== settingsPathFingerprint(path)) {
        throw new Error(`settings initialization evidence ${initializationPath} belongs to another path`);
      }
      if (evidence.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
        throw new Error(
          `settings initialization evidence ${initializationPath} names schema ${evidence.settingsSchemaHash}, `
          + `not this build's ${SETTINGS_SCHEMA_HASH}`,
        );
      }
    }
    if (bytes === undefined && evidence.state === "initialized") {
      throw new Error(`settings file ${path} is missing after settings authority was initialized`);
    }
    if (bytes !== undefined && evidence.state === "virgin") {
      const reconciledBytes = initializationBytes(path, "initialized");
      replaceExactBytes(initializationPath, reconciledBytes, evidenceBytes);
      evidenceBytes = reconciledBytes;
      evidence = parseSettingsInitialization(initializationPath, evidenceBytes);
    }
    return Object.freeze({
      record: bytes === undefined ? initialSettingsFileRecord() : parseRecord(path, bytes),
      bytes,
      initializationBytes: evidenceBytes,
      initializationState: evidence.state,
    });
  }

  function read(): SettingsFileRecord {
    const lock = acquireSettingsAuthorityLock(path, hooks);
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
    mkdirSync(directory, { recursive: true });
    const temporaryPath = nextTemporaryPath(destinationPath);
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
  }

  function restoreAbsence(expectedLiveBytes: Uint8Array): void {
    const liveBytes = readBytes(path);
    if (!equalBytes(liveBytes, expectedLiveBytes)) {
      throw new Error(`settings rollback refused because ${path} no longer contains the update being rolled back`);
    }
    try {
      remove(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    sync(directory);
    if (readBytes(path) !== undefined) {
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
    publicUpdate: SettingsPreparedUpdate;
    priorSettingsBytes: Uint8Array | undefined;
    nextSettingsBytes: Uint8Array;
    priorInitializationBytes: Uint8Array;
    nextInitializationBytes: Uint8Array;
  }> {
    const record = parseSettingsPrepare(preparePath, prepareBytes);
    if (record.settingsPathFingerprint !== settingsPathFingerprint(path)) {
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
      ? initialSettingsFileRecord()
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
    if (priorInitialization.settingsPathFingerprint !== record.settingsPathFingerprint
      || nextInitialization.settingsPathFingerprint !== record.settingsPathFingerprint
      || priorInitialization.settingsSchemaHash !== SETTINGS_SCHEMA_HASH
      || nextInitialization.settingsSchemaHash !== SETTINGS_SCHEMA_HASH
      || nextInitialization.state !== "initialized") {
      throw new Error(`settings prepare evidence ${preparePath} has invalid initialization authority`);
    }
    const applied = next.lastApplied;
    if (prior.revision !== record.command.expectedRevision
      || next.revision !== prior.revision + 1
      || applied === undefined
      || applied.commandId !== record.command.commandId
      || applied.commandFingerprint !== record.command.commandFingerprint
      || applied.expectedRevision !== record.command.expectedRevision
      || applied.settingsSchemaHash !== record.command.settingsSchemaHash
      || applied.patchFingerprint !== record.command.patchFingerprint) {
      throw new Error(`settings prepare evidence ${preparePath} does not bind its exact prior, next, and command`);
    }
    return Object.freeze({
      record,
      publicUpdate: Object.freeze({
        prepareId: record.prepareId,
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
    reconcile(
      resolvePrepared: (prepared: SettingsPreparedUpdate) => SettingsPrepareResolution,
    ): SettingsFileRecord {
      const lock = acquireSettingsAuthorityLock(path, hooks);
      return releaseAfter(lock, () => {
        const prepareBytes = readPrepareBytes();
        if (prepareBytes === undefined) return readState().record;
        const prepared = inspectPreparedUpdate(prepareBytes);
        const resolution = resolvePrepared(prepared.publicUpdate);
        if (resolution === "committed") {
          const liveSettingsBytes = readBytes(path);
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
          restorePreparedSettings(
            readBytes(path),
            prepared.priorSettingsBytes,
            prepared.nextSettingsBytes,
          );
          const liveInitializationBytes = readInitializationBytes();
          if (!equalBytes(liveInitializationBytes, prepared.priorInitializationBytes)) {
            if (!equalBytes(liveInitializationBytes, prepared.nextInitializationBytes)) {
              throw new Error(
                `settings prepare ${prepared.record.prepareId} has divergent initialization evidence`,
              );
            }
            replaceExactBytes(
              initializationPath,
              prepared.priorInitializationBytes,
              liveInitializationBytes,
            );
          }
          const rollbackBytes = readRollbackBytes();
          if (rollbackBytes !== undefined) {
            const rollback = parseSettingsRollback(rollbackPath, rollbackBytes);
            if (rollback.commandId !== prepared.record.command.commandId
              || rollback.appliedRevision !== prepared.publicUpdate.next.revision
              || rollback.priorRevision !== prepared.publicUpdate.prior.revision) {
              throw new Error(
                `settings rollback evidence ${rollbackPath} does not bind prepare ${prepared.record.prepareId}`,
              );
            }
            removeRollbackEvidence(rollbackBytes);
          }
        } else {
          throw new Error(`settings prepare resolver returned invalid resolution ${String(resolution)}`);
        }
        removePrepareEvidence(prepareBytes);
        const record = resolution === "committed"
          ? prepared.publicUpdate.next
          : prepared.publicUpdate.prior;
        const exactLive = readBytes(path);
        const expectedLive = resolution === "committed"
          ? prepared.nextSettingsBytes
          : prepared.priorSettingsBytes;
        if (!equalBytes(exactLive, expectedLive)) {
          throw new Error(`settings prepare ${prepared.record.prepareId} outcome changed before readback`);
        }
        return record;
      }, `settings prepare reconciliation for ${path}`);
    },
    withExactRecord<Result>(expectedInput: unknown, work: () => Result): Result {
      const expected = SettingsFileExpectationSchema.parse(expectedInput);
      const lock = acquireSettingsAuthorityLock(path, hooks);
      return releaseAfter(lock, () => {
        const current = readState().record;
        if (current.revision !== expected.revision
          || current.settingsFingerprint !== expected.settingsFingerprint) {
          throw new Error(
            `settings changed after worker boot; restart activation is required `
            + `(boot revision ${String(expected.revision)} at ${expected.settingsFingerprint}, `
            + `current revision ${String(current.revision)} at ${current.settingsFingerprint})`,
          );
        }
        return work();
      }, `exact settings fence for ${path}`);
    },
    apply(input: unknown): SettingsFileApplyOutcome {
      const request = SettingsApplyInputSchema.parse(input);
      const lock = acquireSettingsAuthorityLock(path, hooks);
      let priorBytes: Uint8Array | undefined;
      let priorInitializationBytes: Uint8Array | undefined;
      let replacementAttempted = false;
      let rollbackUncertain = false;
      try {
        const currentState = readState();
        priorInitializationBytes = currentState.initializationBytes;
        const current = currentState.record;
        if (request.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
          return releaseAfter(lock, () => deepFreeze(SettingsApplyRefusalSchema.parse({
            state: "rejected",
            code: "schema-mismatch",
            message: `settings schema ${request.settingsSchemaHash} does not match this build's ${SETTINGS_SCHEMA_HASH}`,
          })), `settings schema refusal for ${path}`);
        }
        const expectedPatchFingerprint = deriveSettingsPatchFingerprint(request.patch);
        if (request.patchFingerprint !== expectedPatchFingerprint) {
          return releaseAfter(lock, () => deepFreeze(SettingsApplyRefusalSchema.parse({
            state: "rejected",
            code: "schema-mismatch",
            message: `settings patch fingerprint ${request.patchFingerprint} does not match its strict patch value`,
          })), `settings fingerprint refusal for ${path}`);
        }
        if (current.lastApplied?.commandId === request.commandId) {
          const isExactReplay = current.lastApplied.commandFingerprint === request.commandFingerprint
            && current.lastApplied.expectedRevision === request.expectedRevision
            && current.lastApplied.settingsSchemaHash === request.settingsSchemaHash
            && current.lastApplied.patchFingerprint === request.patchFingerprint
            && current.revision === request.expectedRevision + 1;
          if (!isExactReplay) {
            throw new Error(
              `settings command ${request.commandId} is already persisted with a different full canonical command envelope`,
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
            commit: settlement.commit,
          });
        }
        if (request.expectedRevision !== current.revision) {
          return releaseAfter(lock, () => deepFreeze(SettingsApplyRefusalSchema.parse({
            state: "conflict",
            currentRevision: current.revision,
            message: `settings revision ${String(request.expectedRevision)} is stale; current revision is ${String(current.revision)}`,
          })), `settings revision refusal for ${path}`);
        }

        const settings = mergeSettingsPatch(current.settings, request.patch);
        try {
          validateCandidate(settings);
        } catch (error) {
          throw new Error(
            `settings candidate for ${path} does not satisfy the fully merged config contract`,
            { cause: error },
          );
        }
        const record = deepFreeze(SettingsFileRecordSchema.parse({
          revision: current.revision + 1,
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          settingsFingerprint: derivePersistedSettingsFingerprint(settings),
          settings,
          lastApplied: {
            commandId: request.commandId,
            commandFingerprint: request.commandFingerprint,
            expectedRevision: request.expectedRevision,
            settingsSchemaHash: request.settingsSchemaHash,
            patchFingerprint: request.patchFingerprint,
          },
        }));
        priorBytes = currentState.bytes;
        const nextBytes = new TextEncoder().encode(`${canonicalJsonStringify(record)}\n`);
        if (nextBytes.byteLength > MAX_SETTINGS_FILE_BYTES) {
          throw new Error(
            `settings candidate is ${String(nextBytes.byteLength)} bytes; `
            + `maximum is ${String(MAX_SETTINGS_FILE_BYTES)} before replacement`,
          );
        }
        const nextInitializationBytes = initializationBytes(path, "initialized");
        if (priorInitializationBytes === undefined) {
          throw new Error(`settings apply for ${path} has no initialization evidence snapshot`);
        }
        const initializationSnapshot = priorInitializationBytes;
        const prepareRecord = SettingsPrepareRecordSchema.parse({
          schemaVersion: 1,
          prepareId: randomUUID(),
          settingsPathFingerprint: settingsPathFingerprint(path),
          command: {
            commandId: request.commandId,
            commandFingerprint: request.commandFingerprint,
            expectedRevision: request.expectedRevision,
            settingsSchemaHash: request.settingsSchemaHash,
            patchFingerprint: request.patchFingerprint,
          },
          priorSettingsBytesBase64: priorBytes === undefined ? null : encodeBase64(priorBytes),
          nextSettingsBytesBase64: encodeBase64(nextBytes),
          priorInitializationBytesBase64: encodeBase64(initializationSnapshot),
          nextInitializationBytesBase64: encodeBase64(nextInitializationBytes),
        });
        const prepareBytes = new TextEncoder().encode(
          `${canonicalJsonStringify(prepareRecord)}\n`,
        );
        replaceExactBytes(preparePath, prepareBytes, undefined);
        const rollbackRecord = SettingsRollbackRecordSchema.parse({
          schemaVersion: 1,
          rollbackId: randomUUID(),
          settingsPathFingerprint: settingsPathFingerprint(path),
          commandId: request.commandId,
          appliedRevision: record.revision,
          priorRevision: current.revision,
          appliedSettingsBytesFingerprint: bytesFingerprint(nextBytes),
          priorSettingsBytesFingerprint: priorBytes === undefined
            ? null
            : bytesFingerprint(priorBytes),
          priorInitializationBytesFingerprint: bytesFingerprint(initializationSnapshot),
        });
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
            rollbackUncertain = true;
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
          commit: settlement.commit,
        });
      } catch (error) {
        let safeToRelease = !replacementAttempted;
        if (replacementAttempted) {
          try {
            safeToRelease = !rollbackUncertain
              && equalBytes(readBytes(path), priorBytes)
              && priorInitializationBytes !== undefined
              && equalBytes(readInitializationBytes(), priorInitializationBytes)
              && readRollbackBytes() === undefined;
          } catch {
            safeToRelease = false;
          }
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
