import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CREDENTIAL_DIRECTORY_MODE, CredentialLockRecordSchema, errorCode, fsyncPath, noSymlinkAncestry, statDirectory,
  sameDirectory, removeExactPath, ensureChildDirectory, readPrivateFile,
  createPrivateLock, writePrivateStage, replacePrivateFile, companionCredentialEntries,
  type DirectoryIdentity,
} from "./credential-safe-file.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type {
  CredentialStore,
  CredentialStoreApplyOutcome,
} from "../../../models/config/credential-store.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  ProtectedSettingsLastAppliedSchema,
  ProtectedSettingsNameSchema,
  ProtectedStoreRecordSchema,
  initialProtectedStoreRecord,
  type ProtectedSettingsApplyInput,
  type ProtectedStoreRecord,
} from "../../../models/config/protected-settings.js";
import {
  SettingsApplyRefusalSchema,
  type SettingsApplyRejectionCode,
} from "../../../models/config/settings.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { encodePrivate, privateEqual as privateEqualBounded } from "../../../rules/validation/private-equal.js";
import {
  observeProcessIdentity,
  type ProcessIdentityObserver,
} from "../sqlite/runtime-process-locks.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";

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
});

const CredentialHistoryEntrySchema = z.strictObject({
  request: ProtectedSettingsApplyInputSchema,
  setValueIds: SetValueIdsSchema,
});

const CredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(2),
  record: ProtectedStoreRecordSchema,
  history: z.array(CredentialHistoryEntrySchema),
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

  readonly observeProcessIdentity?: ProcessIdentityObserver;
}

export interface CredentialStoreOptions {
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly ids?: CredentialStoreIds;
  readonly hooks?: CredentialStoreHooks;
}

// A replaced protected document can still have unknown observed durable completion.
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

function privateEqual(left: unknown, right: unknown): boolean {
  try {
    return privateEqualBounded(left, right, MAX_PRIVATE_REQUEST_BYTES);
  } catch {
    throw new Error("credential private comparison exceeds its fixed bound");
  }
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

function replayHistory(
  history: readonly CredentialHistoryEntry[],
): ProtectedStoreRecord {
  let current: ProtectedStoreRecord = initialProtectedStoreRecord();
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
    schemaVersion: 2,
    record: initialProtectedStoreRecord(),
    history: [],
  }));
}

function readPrivateDocument(path: string): ReadDocument | undefined {
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_DOCUMENT_BYTES });
  if (file === undefined) return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
  catch { throw new Error("credential store protected.json is malformed"); }
  return { bytes: file.bytes, document: authenticateDocument(decoded), identity: file.identity };
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
  const file = readPrivateFile(path, { label: "lock", maxBytes: 4_096, allowedLinkCounts });
  if (file === undefined) return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
  catch { throw new Error("directory-integrity: credential lock is malformed"); }
  const parsed = CredentialLockRecordSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.kind !== kind) throw new Error("directory-integrity: credential lock is malformed");
  return { bytes: file.bytes, record: parsed.data, identity: file.identity };
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

function removeTemporary(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw new Error("credential store temporary cleanup failed", { cause: error });
    }
  }
}

export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  const admission = requireRuntimeAdmission(options.admission);
  const rawStateRoot = z.string().min(1).parse(options.stateRoot);
  if (rawStateRoot.split(/[/\\]+/u).includes("..")) throw new Error("directory-integrity: raw credential path contains a '..' component");
  const stateRoot = resolve(rawStateRoot);
  admission.assertStateRoot(stateRoot);
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
    for (const name of companionCredentialEntries(credentialDirectory, "protected")) permitted.add(name);
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
    return createPrivateLock(path, credentialDirectory, encodePrivate(record), () => {
      const observed = readCredentialLock(path, record.kind);
      return observed !== undefined && privateEqual(observed.record, record);
    });
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

  // Only the successful hard-link creator removes its claimed inode; contenders cannot unlink replacements.
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
    const application = staged.document.history.length === prior.history.length + 1
      && sameHistory(stagedPrefix, prior.history)
      && stagedRequest?.expectedRevision === prior.record.revision
      && staged.document.record.revision === prior.record.revision + 1;
    if (!application) {
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
        writePrivateStage(temporaryPath, bytes);
      } catch (error) {
        throw new Error("credential store replacement could not be staged", { cause: error });
      }
      // Compare exact bytes under the writer lock.
      const live = readPrivateDocument(protectedPath);
      if (priorBytes === undefined ? live !== undefined : live === undefined || !sameBytes(live.bytes, priorBytes)) {
        throw new Error("credential store protected.json changed before replacement");
      }
      hooks.beforeRename?.();
      assertDirectory();
      try {
        replacePrivateFile(temporaryPath, protectedPath);
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
    for (const name of companionCredentialEntries(credentialDirectory, "protected")) permitted.add(name);
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
    const allocated = new Set([
      ...Object.values(document.record.entries).map(({ valueId }) => valueId),
      ...document.history.flatMap(({ setValueIds: ids }) => Object.values(ids)),
    ]);
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
      schemaVersion: 2,
      record: {
        schemaVersion: 1,
        revision: document.record.revision + 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        entries: Object.fromEntries(entries),
        lastApplied: lastApplied(request),
      },
      history: [...document.history, { request, setValueIds }],
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

  return Object.freeze({
    read(): ProtectedStoreRecord {
      admission.assertLive();
      return observeCurrent().document.record;
    },
    ownsCommandId(commandId: string): boolean {
      admission.assertLive();
      const id = z.uuid().parse(commandId);
      const document = observeCurrent().document;
      return document.history.some(({ request }) => request.commandId === id);
    },
    acceptedAt(commandId: string): string | undefined {
      admission.assertLive();
      const id = z.uuid().parse(commandId);
      return withLock(() => {
        const latest = readCurrentUnderLock().document.history.at(-1)?.request;
        return { committed: false, result: latest?.commandId === id ? latest.updatedAt : undefined };
      });
    },
    apply(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      admission.assertWritable();
      const request = admit(input);
      if (!("commandId" in request)) return request;
      return applyAdmitted(request);
    },
    verifyReplay(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      admission.assertLive();
      const request = admit(input);
      if (!("commandId" in request)) return request;
      const replay = evaluateReplay(observeCurrent(), request);
      return replay ?? divergent();
    },
  });
}

export { createChatGptCredentialRepository, verifyChatGptCredentialBytes, verifyChatGptCredentialStore, ChatGptCredentialError, ChatGptCredentialRecordSchema, type ChatGptCredentialRecord, type ChatGptCredentialRepositoryOptions, type ChatGptCredentialTransaction } from "./chatgpt-credential-repository.js";
