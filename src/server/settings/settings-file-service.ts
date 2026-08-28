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
import { systemClock, type Clock } from "../../domain/clock.js";
import { deepFreeze } from "../../domain/immutability.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  SettingsApplyInputSchema,
  SettingsFileRecordSchema,
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
  initialSettingsFileRecord,
  mergeSettingsPatch,
  type SettingsFileRecord,
} from "../../domain/config/settings.js";

export interface SettingsFileOperations {
  readonly writeExclusive?: (path: string, bytes: string) => void;
  readonly syncPath?: (path: string) => void;
  readonly atomicReplace?: (source: string, destination: string) => void;
  readonly remove?: (path: string) => void;
}

export interface SettingsFileService {
  read(): SettingsFileRecord;
  apply(input: unknown): SettingsFileApplyOutcome;
}

export type SettingsFileApplyOutcome =
  | Readonly<{ state: "conflict"; currentRevision: number }>
  | Readonly<{ state: "applied"; revision: number; rollback: () => void }>;

export interface SettingsFileServiceOptions {
  readonly path: string;
  readonly validationEnvironment?: NodeJS.ProcessEnv;
  readonly validationClock?: Clock;
  readonly operations?: SettingsFileOperations;
}

interface PersistedSettingsApplication {
  readonly record: SettingsFileRecord;
  readonly rollback: () => void;
}

interface SettingsFileSnapshot {
  readonly bytes: Uint8Array | undefined;
  readonly record: SettingsFileRecord;
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

function throwWithCleanup(primary: unknown, temporaryPath: string, remove: (path: string) => void): never {
  try {
    removeIfPresent(temporaryPath, remove);
  } catch (cleanupError) {
    throw new AggregateError(
      [primary, cleanupError],
      `settings write failed and temporary cleanup also failed for ${temporaryPath}`,
      { cause: cleanupError },
    );
  }
  const message = primary instanceof Error ? primary.message : `settings write failed for ${temporaryPath}`;
  throw new Error(message, { cause: primary });
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

export function createSettingsFileService(options: SettingsFileServiceOptions): SettingsFileService {
  const path = options.path;
  const directory = dirname(path);
  const operations = options.operations ?? {};
  const write = operations.writeExclusive ?? writeExclusive;
  const sync = operations.syncPath ?? syncPath;
  const replace = operations.atomicReplace ?? renameSync;
  const remove = operations.remove ?? unlinkSync;
  const validationEnvironment = options.validationEnvironment ?? {};
  const validationClock = options.validationClock ?? systemClock;

  function readSnapshot(): SettingsFileSnapshot {
    const bytes = readBytes(path);
    return {
      bytes,
      record: bytes === undefined ? initialSettingsFileRecord() : parseRecord(path, bytes),
    };
  }

  function read(): SettingsFileRecord {
    return readSnapshot().record;
  }

  function nextTemporaryPath(purpose: "apply" | "rollback"): string {
    temporarySequence += 1;
    return join(
      directory,
      `.${basename(path)}.${String(process.pid)}.${String(temporarySequence)}.${purpose}.tmp`,
    );
  }

  function replaceBytes(
    nextBytes: string,
    expectedPriorBytes: Uint8Array | undefined,
    purpose: "apply" | "rollback",
  ): void {
    mkdirSync(directory, { recursive: true });
    const observedPriorBytes = readBytes(path);
    if (!equalBytes(observedPriorBytes, expectedPriorBytes)) {
      throw new Error(
        `${purpose} of settings file ${path} refused because its live bytes changed before replacement`,
      );
    }
    const temporaryPath = nextTemporaryPath(purpose);
    const encoded = new TextEncoder().encode(nextBytes);
    try {
      write(temporaryPath, nextBytes);
      sync(temporaryPath);
    } catch (error) {
      throwWithCleanup(
        new Error(`settings file ${path} could not stage a complete durable ${purpose}`, { cause: error }),
        temporaryPath,
        remove,
      );
    }

    const beforeReplaceBytes = readBytes(path);
    if (!equalBytes(beforeReplaceBytes, expectedPriorBytes)) {
      throwWithCleanup(
        new Error(`${purpose} of settings file ${path} refused because its live bytes changed while staging`),
        temporaryPath,
        remove,
      );
    }

    try {
      replace(temporaryPath, path);
    } catch (error) {
      const liveBytes = readBytes(path);
      if (equalBytes(liveBytes, expectedPriorBytes)) {
        throwWithCleanup(
          new Error(`atomic settings ${purpose} failed before changing ${path}`, { cause: error }),
          temporaryPath,
          remove,
        );
      }
      if (!equalBytes(liveBytes, encoded)) {
        throwWithCleanup(
          new Error(
            `atomic settings ${purpose} failed and ${path} matches neither the prior nor staged bytes; outcome is uncertain`,
            { cause: error },
          ),
          temporaryPath,
          remove,
        );
      }
      // A rename implementation may throw after the replacement took effect.
      // Reconcile by exact bytes and continue to the durability boundary.
    }

    try {
      sync(directory);
    } catch (error) {
      throw new Error(
        `settings ${purpose} reached ${path}, but its directory fsync failed; durability is uncertain`,
        { cause: error },
      );
    }
    const persistedBytes = readBytes(path);
    if (!equalBytes(persistedBytes, encoded)) {
      throw new Error(`settings ${purpose} readback for ${path} differs from the exact bytes atomically replaced`);
    }
  }

  function restorePriorBytes(
    appliedBytes: Uint8Array,
    priorBytes: Uint8Array | undefined,
  ): void {
    const liveBytes = readBytes(path);
    if (!equalBytes(liveBytes, appliedBytes)) {
      throw new Error(`settings rollback refused because ${path} no longer contains the applied bytes`);
    }
    if (priorBytes === undefined) {
      remove(path);
      sync(directory);
      if (readBytes(path) !== undefined) {
        throw new Error(`settings rollback could not remove newly created ${path}`);
      }
      return;
    }
    replaceBytes(new TextDecoder().decode(priorBytes), appliedBytes, "rollback");
  }

  function persist(
    record: SettingsFileRecord,
    priorBytes: Uint8Array | undefined,
  ): PersistedSettingsApplication {
    const bytes = `${canonicalJsonStringify(record)}\n`;
    const encoded = new TextEncoder().encode(bytes);
    try {
      replaceBytes(bytes, priorBytes, "apply");
    } catch (error) {
      const liveBytes = readBytes(path);
      if (equalBytes(liveBytes, priorBytes)) throw error;
      if (!equalBytes(liveBytes, encoded)) {
        throw new Error(
          `settings apply failed and ${path} matches neither the prior nor staged bytes; outcome is uncertain`,
          { cause: error },
        );
      }
      try {
        restorePriorBytes(encoded, priorBytes);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `settings apply failed after replacement and rollback also failed for ${path}`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
    return {
      record: parseRecord(path, encoded),
      rollback: () => restorePriorBytes(encoded, priorBytes),
    };
  }

  return Object.freeze({
    read,
    apply(input: unknown): SettingsFileApplyOutcome {
      const request = SettingsApplyInputSchema.parse(input);
      const current = readSnapshot();
      if (request.settingsSchemaHash !== CURRENT_SETTINGS_SCHEMA_HASH) {
        throw new Error(
          `settings schema ${request.settingsSchemaHash} does not match this build's ${CURRENT_SETTINGS_SCHEMA_HASH}`,
        );
      }
      const expectedPatchFingerprint = deriveSettingsPatchFingerprint(request.patch);
      if (request.patchFingerprint !== expectedPatchFingerprint) {
        throw new Error(
          `settings patch fingerprint ${request.patchFingerprint} does not match its strict patch value ${expectedPatchFingerprint}`,
        );
      }
      if (request.expectedRevision !== current.record.revision) {
        return { state: "conflict", currentRevision: current.record.revision };
      }
      const settings = mergeSettingsPatch(current.record.settings, request.patch);
      try {
        resolveConfigWithProvenance(validationEnvironment, settings, validationClock);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `candidate settings do not resolve to one complete valid runtime config: ${detail}`,
          { cause: error },
        );
      }
      const record = SettingsFileRecordSchema.parse({
        revision: current.record.revision + 1,
        settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
        settingsFingerprint: derivePersistedSettingsFingerprint(settings),
        settings,
      });
      const persisted = persist(record, current.bytes);
      return deepFreeze({
        state: "applied" as const,
        revision: persisted.record.revision,
        rollback: persisted.rollback,
      });
    },
  });
}
