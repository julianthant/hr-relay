import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
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

export interface SettingsFileOperations {
  readonly writeExclusive?: (path: string, bytes: string) => void;
  readonly syncPath?: (path: string) => void;
  readonly atomicReplace?: (source: string, destination: string) => void;
  readonly remove?: (path: string) => void;
}

export interface AppliedSettingsFileUpdate {
  readonly state: "applied";
  readonly record: SettingsFileRecord;
  /** Exact compensating write used only if the surrounding command transaction fails. */
  rollback(): void;
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

function readBytes(path: string): Uint8Array | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
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

function writeExclusive(path: string, bytes: string): void {
  writeFileSync(path, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
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
  const path = options.path;
  const directory = dirname(path);
  const operations = options.operations ?? {};
  const write = operations.writeExclusive ?? writeExclusive;
  const sync = operations.syncPath ?? syncPath;
  const replace = operations.atomicReplace ?? renameSync;
  const remove = operations.remove ?? unlinkSync;

  function read(): SettingsFileRecord {
    const bytes = readBytes(path);
    return bytes === undefined ? initialSettingsFileRecord() : parseRecord(path, bytes);
  }

  function nextTemporaryPath(): string {
    temporarySequence += 1;
    return join(
      directory,
      `.${basename(path)}.${String(process.pid)}.${String(temporarySequence)}.tmp`,
    );
  }

  function replaceExactBytes(bytes: Uint8Array, priorBytes: Uint8Array | undefined): void {
    mkdirSync(directory, { recursive: true });
    const temporaryPath = nextTemporaryPath();
    const encoded = new TextDecoder().decode(bytes);
    try {
      write(temporaryPath, encoded);
      sync(temporaryPath);
    } catch (error) {
      throwWithCleanup(
        new Error(`settings file ${path} could not stage a complete durable replacement`, { cause: error }),
        temporaryPath,
        remove,
      );
    }

    try {
      replace(temporaryPath, path);
    } catch (error) {
      const liveBytes = readBytes(path);
      if (equalBytes(liveBytes, priorBytes)) {
        throwWithCleanup(
          new Error(`atomic settings replacement failed before changing ${path}`, { cause: error }),
          temporaryPath,
          remove,
        );
      }
      if (!equalBytes(liveBytes, bytes)) {
        throwWithCleanup(
          new Error(
            `atomic settings replacement failed and ${path} matches neither the prior nor staged bytes; outcome is uncertain`,
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
        `settings replacement reached ${path}, but its directory fsync failed; durability is uncertain`,
        { cause: error },
      );
    }
    if (!equalBytes(readBytes(path), bytes)) {
      throw new Error(`settings readback for ${path} differs from the exact bytes atomically replaced`);
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
      const current = read();
      if (request.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
        return deepFreeze(SettingsApplyRefusalSchema.parse({
          state: "rejected",
          code: "schema-mismatch",
          message: `settings schema ${request.settingsSchemaHash} does not match this build's ${SETTINGS_SCHEMA_HASH}`,
        }));
      }
      const expectedPatchFingerprint = deriveSettingsPatchFingerprint(request.patch);
      if (request.patchFingerprint !== expectedPatchFingerprint) {
        return deepFreeze(SettingsApplyRefusalSchema.parse({
          state: "rejected",
          code: "schema-mismatch",
          message: `settings patch fingerprint ${request.patchFingerprint} does not match its strict patch value`,
        }));
      }
      if (current.lastApplied?.commandId === request.commandId) {
        const isExactReplay = current.lastApplied.expectedRevision === request.expectedRevision
          && current.lastApplied.settingsSchemaHash === request.settingsSchemaHash
          && current.lastApplied.patchFingerprint === request.patchFingerprint
          && current.revision === request.expectedRevision + 1;
        if (!isExactReplay) {
          throw new Error(
            `settings command ${request.commandId} is already persisted with different revision or fingerprint bindings`,
          );
        }
        return Object.freeze({
          state: "applied",
          record: current,
          // The first attempt crossed the file boundary before its command
          // journal committed. Recovery journals it now and must not undo it
          // if that second journal attempt also fails.
          rollback: () => undefined,
        });
      }
      if (request.expectedRevision !== current.revision) {
        return deepFreeze(SettingsApplyRefusalSchema.parse({
          state: "conflict",
          currentRevision: current.revision,
          message: `settings revision ${String(request.expectedRevision)} is stale; current revision is ${String(current.revision)}`,
        }));
      }

      const settings = mergeSettingsPatch(current.settings, request.patch);
      const record = deepFreeze(SettingsFileRecordSchema.parse({
        revision: current.revision + 1,
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        settingsFingerprint: derivePersistedSettingsFingerprint(settings),
        settings,
        lastApplied: {
          commandId: request.commandId,
          expectedRevision: request.expectedRevision,
          settingsSchemaHash: request.settingsSchemaHash,
          patchFingerprint: request.patchFingerprint,
        },
      }));
      const priorBytes = readBytes(path);
      const nextBytes = new TextEncoder().encode(`${canonicalJsonStringify(record)}\n`);
      replaceExactBytes(nextBytes, priorBytes);
      const persisted = parseRecord(path, nextBytes);
      return Object.freeze({
        state: "applied",
        record: persisted,
        rollback: (): void => {
          if (priorBytes === undefined) {
            restoreAbsence(nextBytes);
            return;
          }
          replaceExactBytes(priorBytes, nextBytes);
        },
      });
    },
  });
}
