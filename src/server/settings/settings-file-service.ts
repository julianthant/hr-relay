import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
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
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { systemClock, type Clock } from "../../domain/clock.js";
import { deepFreeze } from "../../domain/immutability.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import {
  CommandIdSchema,
  FingerprintSchema,
  PositiveIntSchema,
  type Fingerprint,
} from "../../domain/ids.js";
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
  reconcile(): SettingsFileReconciliationOutcome;
  runtimeStatus(): unknown;
}

export type SettingsFileApplyOutcome =
  | Readonly<{ state: "conflict"; currentRevision: number }>
  | Readonly<{ state: "applied"; revision: number; restartRequired: true }>;

export const SettingsJournalObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({
    state: z.literal("committed"),
    commandFingerprint: FingerprintSchema,
    revision: PositiveIntSchema,
  }),
  z.strictObject({ state: z.literal("inconsistent"), reason: z.string().min(1) }),
]);
export type SettingsJournalObservation = z.infer<typeof SettingsJournalObservationSchema>;

export interface SettingsCommandJournal {
  observe(commandId: string): unknown;
}

export const SettingsFileReconciliationOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("clear") }),
  z.strictObject({
    state: z.literal("committed"),
    commandId: CommandIdSchema,
    revision: PositiveIntSchema,
  }),
  z.strictObject({
    state: z.literal("rolled-back"),
    commandId: CommandIdSchema,
    revision: PositiveIntSchema,
  }),
]);
export type SettingsFileReconciliationOutcome = z.infer<typeof SettingsFileReconciliationOutcomeSchema>;

export interface SettingsFileServiceOptions {
  readonly path: string;
  readonly recoveryPath?: string;
  readonly journal: SettingsCommandJournal;
  readonly validationEnvironment?: NodeJS.ProcessEnv;
  readonly validationClock?: Clock;
  readonly runtimeStatus?: () => unknown;
  /**
   * Only the exclusive dashboard process may decide that an absent journal
   * outcome is terminal and restore prior bytes. Workers observe the same
   * file concurrently and must not mistake an uncommitted SQLite transaction
   * for process loss.
   */
  readonly absentJournalRecovery?: "exclusive-owner" | "refuse";
  readonly operations?: SettingsFileOperations;
}

interface SettingsFileSnapshot {
  readonly bytes: Uint8Array | undefined;
  readonly record: SettingsFileRecord;
}

const EncodedBytesSchema = z.strictObject({
  bytesBase64: z.string().min(1),
  bytesFingerprint: FingerprintSchema,
  revision: PositiveIntSchema,
  settingsFingerprint: FingerprintSchema,
});

const SettingsPrepareRecordSchema = z.strictObject({
  protocolVersion: z.literal(1),
  journalOutcome: z.literal("pending"),
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema,
  settingsSchemaHash: FingerprintSchema,
  patchFingerprint: FingerprintSchema,
  prior: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("absent"),
      revision: z.literal(1),
      settingsFingerprint: FingerprintSchema,
    }),
    z.strictObject({ state: z.literal("present"), ...EncodedBytesSchema.shape }),
  ]),
  next: EncodedBytesSchema,
}).superRefine((record, context) => {
  if (record.prior.revision !== record.expectedRevision) {
    context.addIssue({
      code: "custom",
      path: ["prior", "revision"],
      message: "prepared prior revision must equal the command's expected revision",
    });
  }
  if (record.next.revision !== record.expectedRevision + 1) {
    context.addIssue({
      code: "custom",
      path: ["next", "revision"],
      message: "prepared next revision must advance the expected revision exactly once",
    });
  }
});
type SettingsPrepareRecord = z.infer<typeof SettingsPrepareRecordSchema>;

let temporarySequence = 0;

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

/** Missing is the explicit revision-1 baseline state, not a parse fallback. */
function missingBytes(): undefined {
  return undefined;
}

function readBytes(path: string): Uint8Array | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if (isMissing(error)) return missingBytes();
    throw error;
  }
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function fingerprintBytes(bytes: Uint8Array): Fingerprint {
  return FingerprintSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}

function encodeBytes(
  bytes: Uint8Array,
  record: SettingsFileRecord,
): z.infer<typeof EncodedBytesSchema> {
  return EncodedBytesSchema.parse({
    bytesBase64: Buffer.from(bytes).toString("base64"),
    bytesFingerprint: fingerprintBytes(bytes),
    revision: record.revision,
    settingsFingerprint: record.settingsFingerprint,
  });
}

function decodePreparedBytes(
  label: "prior" | "next",
  encoded: z.infer<typeof EncodedBytesSchema>,
): Uint8Array {
  const bytes = Buffer.from(encoded.bytesBase64, "base64");
  if (fingerprintBytes(bytes) !== encoded.bytesFingerprint) {
    throw new Error(`settings prepare ${label} bytes do not match their recorded fingerprint`);
  }
  return bytes;
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

function parsePrepareRecord(path: string, bytes: Uint8Array): SettingsPrepareRecord {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`settings prepare file ${path} is not valid JSON`, { cause: error });
  }
  try {
    return deepFreeze(SettingsPrepareRecordSchema.parse(decoded));
  } catch (error) {
    throw new Error(`settings prepare file ${path} does not satisfy its strict recovery contract`, {
      cause: error,
    });
  }
}

export function createSettingsFileService(options: SettingsFileServiceOptions): SettingsFileService {
  const path = options.path;
  const recoveryPath = options.recoveryPath ?? `${path}.prepare`;
  const journal = options.journal;
  const operations = options.operations ?? {};
  const write = operations.writeExclusive ?? writeExclusive;
  const sync = operations.syncPath ?? syncPath;
  const replace = operations.atomicReplace ?? renameSync;
  const remove = operations.remove ?? unlinkSync;
  const validationEnvironment = options.validationEnvironment ?? {};
  const validationClock = options.validationClock ?? systemClock;
  const absentJournalRecovery = options.absentJournalRecovery ?? "refuse";

  function readSnapshot(): SettingsFileSnapshot {
    const bytes = readBytes(path);
    return {
      bytes,
      record: bytes === undefined ? initialSettingsFileRecord() : parseRecord(path, bytes),
    };
  }

  function nextTemporaryPath(
    targetPath: string,
    purpose: "apply" | "rollback" | "prepare",
  ): string {
    temporarySequence += 1;
    return join(
      dirname(targetPath),
      `.${basename(targetPath)}.${String(process.pid)}.${String(temporarySequence)}.${purpose}.tmp`,
    );
  }

  function replaceBytes(
    targetPath: string,
    nextBytes: string,
    expectedPriorBytes: Uint8Array | undefined,
    purpose: "apply" | "rollback" | "prepare",
  ): void {
    const directory = dirname(targetPath);
    mkdirSync(directory, { recursive: true });
    const observedPriorBytes = readBytes(targetPath);
    if (!equalBytes(observedPriorBytes, expectedPriorBytes)) {
      throw new Error(
        `${purpose} of settings file ${targetPath} refused because its live bytes changed before replacement`,
      );
    }
    const temporaryPath = nextTemporaryPath(targetPath, purpose);
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

    const beforeReplaceBytes = readBytes(targetPath);
    if (!equalBytes(beforeReplaceBytes, expectedPriorBytes)) {
      throwWithCleanup(
        new Error(`${purpose} of settings file ${targetPath} refused because its live bytes changed while staging`),
        temporaryPath,
        remove,
      );
    }

    try {
      replace(temporaryPath, targetPath);
    } catch (error) {
      const liveBytes = readBytes(targetPath);
      if (equalBytes(liveBytes, expectedPriorBytes)) {
        throwWithCleanup(
          new Error(`atomic settings ${purpose} failed before changing ${targetPath}`, { cause: error }),
          temporaryPath,
          remove,
        );
      }
      if (!equalBytes(liveBytes, encoded)) {
        throwWithCleanup(
          new Error(
            `atomic settings ${purpose} failed and ${targetPath} matches neither the prior nor staged bytes; outcome is uncertain`,
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
        `settings ${purpose} reached ${targetPath}, but its directory fsync failed; durability is uncertain`,
        { cause: error },
      );
    }
    const persistedBytes = readBytes(targetPath);
    if (!equalBytes(persistedBytes, encoded)) {
      throw new Error(`settings ${purpose} readback for ${targetPath} differs from the exact bytes atomically replaced`);
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
      sync(dirname(path));
      if (readBytes(path) !== undefined) {
        throw new Error(`settings rollback could not remove newly created ${path}`);
      }
      return;
    }
    replaceBytes(path, new TextDecoder().decode(priorBytes), appliedBytes, "rollback");
  }

  function persist(
    record: SettingsFileRecord,
    priorBytes: Uint8Array | undefined,
  ): SettingsFileRecord {
    const bytes = `${canonicalJsonStringify(record)}\n`;
    const encoded = new TextEncoder().encode(bytes);
    try {
      replaceBytes(path, bytes, priorBytes, "apply");
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
    return parseRecord(path, encoded);
  }

  function removeRecoveryRecord(): void {
    if (readBytes(recoveryPath) === undefined) return;
    removeIfPresent(recoveryPath, remove);
    sync(dirname(recoveryPath));
    if (readBytes(recoveryPath) !== undefined) {
      throw new Error(`settings reconciliation could not remove prepare file ${recoveryPath}`);
    }
  }

  function validatedPrepareBytes(
    prepare: SettingsPrepareRecord,
  ): Readonly<{ prior: Uint8Array | undefined; next: Uint8Array }> {
    if (prepare.settingsSchemaHash !== CURRENT_SETTINGS_SCHEMA_HASH) {
      throw new Error(
        `settings prepare schema ${prepare.settingsSchemaHash} does not match this build's ${CURRENT_SETTINGS_SCHEMA_HASH}`,
      );
    }
    const initial = initialSettingsFileRecord();
    let prior: Uint8Array | undefined;
    if (prepare.prior.state === "absent") {
      if (prepare.prior.settingsFingerprint !== initial.settingsFingerprint) {
        throw new Error("absent settings prepare prior does not match the revision-1 empty baseline");
      }
      prior = undefined;
    } else {
      prior = decodePreparedBytes("prior", prepare.prior);
      const priorRecord = parseRecord(`${recoveryPath}#prior`, prior);
      if (priorRecord.revision !== prepare.prior.revision
        || priorRecord.settingsFingerprint !== prepare.prior.settingsFingerprint) {
        throw new Error("settings prepare prior bytes do not match their recorded revision and settings fingerprint");
      }
    }
    const next = decodePreparedBytes("next", prepare.next);
    const nextRecord = parseRecord(`${recoveryPath}#next`, next);
    if (nextRecord.revision !== prepare.next.revision
      || nextRecord.settingsFingerprint !== prepare.next.settingsFingerprint) {
      throw new Error("settings prepare next bytes do not match their recorded revision and settings fingerprint");
    }
    return { prior, next };
  }

  function reconcile(): SettingsFileReconciliationOutcome {
    const prepareBytes = readBytes(recoveryPath);
    if (prepareBytes === undefined) return { state: "clear" };
    const prepare = parsePrepareRecord(recoveryPath, prepareBytes);
    const prepared = validatedPrepareBytes(prepare);
    const observation = SettingsJournalObservationSchema.parse(journal.observe(prepare.commandId));
    if (observation.state === "inconsistent") {
      throw new Error(
        `settings prepare ${prepare.commandId} cannot reconcile against an inconsistent journal: ${observation.reason}`,
      );
    }
    const liveBytes = readBytes(path);
    if (observation.state === "committed") {
      if (observation.commandFingerprint !== prepare.commandFingerprint
        || observation.revision !== prepare.next.revision) {
        throw new Error(
          `settings prepare ${prepare.commandId} does not match its committed journal identity`,
        );
      }
      if (!equalBytes(liveBytes, prepared.next)) {
        throw new Error(
          `settings command ${prepare.commandId} committed, but live settings do not match its exact prepared next bytes`,
        );
      }
      removeRecoveryRecord();
      return deepFreeze({
        state: "committed" as const,
        commandId: prepare.commandId,
        revision: prepare.next.revision,
      });
    }
    if (absentJournalRecovery === "refuse") {
      throw new Error(
        `settings prepare ${prepare.commandId} has no visible journal outcome; it may still be in flight, `
        + "so only an exclusive dashboard boot or the applying command owner may recover its prior bytes",
      );
    }
    if (equalBytes(liveBytes, prepared.next)) {
      restorePriorBytes(prepared.next, prepared.prior);
    } else if (!equalBytes(liveBytes, prepared.prior)) {
      throw new Error(
        `settings command ${prepare.commandId} has no journal outcome, and live settings match neither prepared prior nor next bytes`,
      );
    }
    removeRecoveryRecord();
    return deepFreeze({
      state: "rolled-back" as const,
      commandId: prepare.commandId,
      revision: prepare.expectedRevision,
    });
  }

  function read(): SettingsFileRecord {
    reconcile();
    return readSnapshot().record;
  }

  function prepareApplication(
    request: z.infer<typeof SettingsApplyInputSchema>,
    current: SettingsFileSnapshot,
    nextRecord: SettingsFileRecord,
  ): void {
    const nextBytes = new TextEncoder().encode(`${canonicalJsonStringify(nextRecord)}\n`);
    const prepare = SettingsPrepareRecordSchema.parse({
      protocolVersion: 1,
      journalOutcome: "pending",
      commandId: request.commandId,
      commandFingerprint: request.commandFingerprint,
      expectedRevision: request.expectedRevision,
      settingsSchemaHash: request.settingsSchemaHash,
      patchFingerprint: request.patchFingerprint,
      prior: current.bytes === undefined
        ? {
            state: "absent",
            revision: current.record.revision,
            settingsFingerprint: current.record.settingsFingerprint,
          }
        : { state: "present", ...encodeBytes(current.bytes, current.record) },
      next: encodeBytes(nextBytes, nextRecord),
    });
    replaceBytes(
      recoveryPath,
      `${canonicalJsonStringify(prepare)}\n`,
      undefined,
      "prepare",
    );
  }

  return Object.freeze({
    read,
    reconcile,
    runtimeStatus(): unknown {
      if (options.runtimeStatus === undefined) {
        throw new Error("settings runtime-generation barrier is not composed");
      }
      return options.runtimeStatus();
    },
    apply(input: unknown): SettingsFileApplyOutcome {
      const request = SettingsApplyInputSchema.parse(input);
      reconcile();
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
      prepareApplication(request, current, record);
      const persisted = persist(record, current.bytes);
      return deepFreeze({
        state: "applied" as const,
        revision: persisted.revision,
        restartRequired: true as const,
      });
    },
  });
}
