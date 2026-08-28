import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
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

export interface AppliedSettingsFileUpdate {
  readonly state: "applied";
  readonly record: SettingsFileRecord;
  /** Exact compensating write used only if the surrounding command transaction fails. */
  rollback(): void;
  /** Release exclusive authority only after the surrounding command transaction commits. */
  commit(): void;
}

export type SettingsFileApplyOutcome = AppliedSettingsFileUpdate | SettingsApplyRefusal;

export interface SettingsFileAuthority {
  read(): SettingsFileRecord;
  apply(input: unknown): SettingsFileApplyOutcome;
}

export interface SettingsFileAuthorityOptions {
  readonly path: string;
  readonly operations?: SettingsFileOperations;
}

let temporarySequence = 0;
export const MAX_SETTINGS_FILE_BYTES = 1_048_576;
const MAX_SETTINGS_LOCK_BYTES = 16_384;
const MAX_SETTINGS_INITIALIZATION_BYTES = 16_384;

const SettingsAuthorityLockRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  acquisitionId: z.uuid(),
  pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema,
  settingsPathFingerprint: FingerprintSchema,
});
type SettingsAuthorityLockRecord = z.infer<typeof SettingsAuthorityLockRecordSchema>;

const SettingsInitializationRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  settingsPathFingerprint: FingerprintSchema,
  settingsSchemaHash: FingerprintSchema,
  state: z.enum(["virgin", "initialized"]),
});
type SettingsInitializationRecord = z.infer<typeof SettingsInitializationRecordSchema>;

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

function readPrivateRegularBytes(
  path: string,
  label: string,
  maximumBytes: number,
): Uint8Array | undefined {
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
    if (status.nlink !== 1) {
      throw new Error(`${label} ${path} has multiple hard links; exactly one is required`);
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
    return bytes;
  } finally {
    closeSync(descriptor);
  }
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
): Readonly<{ commit(): void; rollback(): void }> {
  let settled = false;
  let rollbackCompleted = false;
  return Object.freeze({
    commit(): void {
      if (settled) return;
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

function acquireSettingsAuthorityLock(settingsPath: string): SettingsAuthorityLockHandle {
  const directory = dirname(settingsPath);
  const lockPath = `${settingsPath}.lock`;
  const pathFingerprint = settingsPathFingerprint(settingsPath);
  const observation = observeProcessIdentity(process.pid);
  if (observation.state === "gone") {
    throw new Error(`cannot claim settings authority for non-running pid ${String(process.pid)}`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  for (;;) {
    const record = SettingsAuthorityLockRecordSchema.parse({
      schemaVersion: 1,
      acquisitionId: randomUUID(),
      pid: process.pid,
      processIdentity: observation.identity,
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
      } catch (error) {
        if (errnoOf(error) !== "EEXIST") throw error;
      }
      if (linked) syncPath(directory);
    } finally {
      removeIfPresent(temporaryPath, unlinkSync);
    }

    if (linked) {
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

    const heldBytes = readPrivateRegularBytes(
      lockPath,
      "settings authority lock",
      MAX_SETTINGS_LOCK_BYTES,
    );
    if (heldBytes === undefined) continue;
    const held = parseSettingsLock(lockPath, heldBytes);
    if (held.settingsPathFingerprint !== pathFingerprint) {
      throw new Error(`settings authority lock ${lockPath} belongs to a different settings path`);
    }
    const heldObservation = observeProcessIdentity(held.pid);
    const ownerIsAlive = heldObservation.state === "alive"
      && heldObservation.identity.platform === held.processIdentity.platform
      && heldObservation.identity.startToken === held.processIdentity.startToken;
    if (ownerIsAlive) {
      throw new Error(
        `exclusive settings authority is held by live pid ${String(held.pid)} `
        + `(acquisition ${held.acquisitionId})`,
      );
    }
    const currentBytes = readPrivateRegularBytes(
      lockPath,
      "settings authority lock",
      MAX_SETTINGS_LOCK_BYTES,
    );
    if (!equalBytes(currentBytes, heldBytes)) continue;
    try {
      unlinkSync(lockPath);
      syncPath(directory);
    } catch (error) {
      if (isMissing(error)) continue;
      throw new Error(`stale settings authority lock ${lockPath} could not be archived`, {
        cause: error,
      });
    }
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
  const operations = options.operations ?? {};
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

  function readDestinationBytes(destinationPath: string): Uint8Array | undefined {
    return destinationPath === path ? readBytes(path) : readInitializationBytes();
  }

  function readState(): Readonly<{
    record: SettingsFileRecord;
    bytes: Uint8Array | undefined;
    initializationBytes: Uint8Array;
    initializationState: "virgin" | "initialized";
  }> {
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
    const lock = acquireSettingsAuthorityLock(path);
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

  return Object.freeze({
    read,
    apply(input: unknown): SettingsFileApplyOutcome {
      const request = SettingsApplyInputSchema.parse(input);
      const lock = acquireSettingsAuthorityLock(path);
      let priorBytes: Uint8Array | undefined;
      let priorInitializationBytes: Uint8Array | undefined;
      let replacementAttempted = false;
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
        const nextInitializationBytes = initializationBytes(path, "initialized");
        const restorePriorState = (): void => {
          if (priorInitializationBytes === undefined) {
            throw new Error(`settings rollback for ${path} has no initialization evidence snapshot`);
          }
          const liveInitializationBytes = readInitializationBytes();
          if (!equalBytes(liveInitializationBytes, priorInitializationBytes)) {
            replaceExactBytes(
              initializationPath,
              priorInitializationBytes,
              liveInitializationBytes,
            );
          }
          if (priorBytes === undefined) {
            restoreAbsence(nextBytes);
            return;
          }
          replaceExactBytes(path, priorBytes, nextBytes);
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
        const settlement = settingsSettlement(lock, restorePriorState);
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
            safeToRelease = equalBytes(readBytes(path), priorBytes)
              && priorInitializationBytes !== undefined
              && equalBytes(readInitializationBytes(), priorInitializationBytes);
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
