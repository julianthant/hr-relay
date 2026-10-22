import { assertCanonicalProfileBinding } from "../sqlite/profile-local-databases.js";
import type { ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { createHash, randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
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
  PROTECTED_SETTINGS_SET_MARKER,
  initialProtectedStoreRecord,
  markProtectedSettingsPatch,
  type ProtectedSettingsApplyInput,
  type ProtectedStoreRecord,
} from "../../../models/config/protected-settings.js";
import {
  CredentialEraseInputSchema,
  type CredentialEraseInput,
} from "../../../models/config/credential-store.js";
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
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";

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

const CredentialMarkedOperationSchema = z.union([
  z.strictObject({ set: z.literal(PROTECTED_SETTINGS_SET_MARKER) }),
  z.strictObject({ clear: z.literal(true) }),
  z.strictObject({ erase: z.literal(true) }),
]);

const CredentialMarkedPatchSchema = z.strictObject({
  ucpathUserId: CredentialMarkedOperationSchema.optional(),
  ucpathPassword: CredentialMarkedOperationSchema.optional(),
  timekeeperName: CredentialMarkedOperationSchema.optional(),
  sharepointOnboardingRosterUrl: CredentialMarkedOperationSchema.optional(),
  activityPersonPseudonym: CredentialMarkedOperationSchema.optional(),
});

const CredentialReplayReceiptSchema = ProtectedSettingsLastAppliedSchema.extend({
  updatedAt: z.string().datetime({ offset: true }),
  requestReceipt: z.string().regex(/^[0-9a-f]{64}$/u),
});

const CredentialHistoryEntrySchema = z.strictObject({
  receipt: CredentialReplayReceiptSchema,
  marked: CredentialMarkedPatchSchema,
  setValueIds: SetValueIdsSchema,
});

const CredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(3),
  record: ProtectedStoreRecordSchema,
  history: z.array(CredentialHistoryEntrySchema),
});

const CredentialHistoryEntryV2Schema = z.strictObject({
  request: ProtectedSettingsApplyInputSchema,
  setValueIds: SetValueIdsSchema,
});

const CredentialDocumentV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  record: ProtectedStoreRecordSchema,
  history: z.array(CredentialHistoryEntryV2Schema),
});

const ErasureJournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  epoch: z.number().int().nonnegative(),
  erasedValueIds: z.array(z.uuid()),
  retiredCommandIds: z.array(z.uuid()),
  pending: CredentialHistoryEntrySchema.optional(),
});

const ErasureAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(1),
  epoch: z.number().int().nonnegative(),
  device: z.number().int().nonnegative(),
  inode: z.number().int().nonnegative(),
});

type CredentialHistoryEntry = z.infer<typeof CredentialHistoryEntrySchema>;
type CredentialDocument = z.infer<typeof CredentialDocumentSchema>;
type ErasureJournal = z.infer<typeof ErasureJournalSchema>;
const EMPTY_JOURNAL: ErasureJournal = { schemaVersion: 1, epoch: 0, erasedValueIds: [], retiredCommandIds: [] };
const SECRET_NAMES = ["ucpathUserId", "ucpathPassword"] as const;

export const RESTORE_ADMISSION_REQUEST = "restore-admission owner must admit the machine erasure journal outside every profile root before logout completion";

export class CredentialErasureAuthorityError extends Error {
  readonly request = RESTORE_ADMISSION_REQUEST;
  constructor(message: string) {
    super(message);
    this.name = "CredentialErasureAuthorityError";
  }
}

function documentHasErasure(document: CredentialDocument | undefined): boolean {
  if (document === undefined) return false;
  return document.history.some((entry) => SECRET_NAMES.some((name) => {
    const operation = entry.marked[name];
    return operation !== undefined && "erase" in operation;
  }));
}
type CredentialLockRecord = z.infer<typeof CredentialLockRecordSchema>;

export interface CredentialStoreIds {
  readonly randomUUID: () => string;
}

export interface CredentialStoreHooks {
  /** Test seam after the staged document is durable and before authority rename. */
  readonly beforeRename?: () => void;
  /** Test seam at the uncertain boundary after authority rename and before directory fsync. */
  readonly afterRename?: () => void;
  /** Test seam after the erasure journal is durable and before the protected document rewrite. */
  readonly afterErasureJournal?: () => void;

  readonly observeProcessIdentity?: ProcessIdentityObserver;
}

export interface CredentialStoreOptions {
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  /** Durable tombstones. Outside the profile root so a profile backup cannot roll them back. */
  readonly erasureJournalPath?: string;
  readonly erasureJournalAdmission?: RuntimeAdmission;
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
  readonly sourceVersion: 2 | 3;
}

interface CurrentDocument {
  readonly bytes: Uint8Array | undefined;
  readonly document: CredentialDocument;
  readonly sourceVersion: 2 | 3;
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

function lastApplied(request: {
  readonly commandId: string;
  readonly commandFingerprint: string;
  readonly expectedRevision: number;
  readonly protectedSchemaHash: string;
  readonly writeId: string;
}) {
  return ProtectedSettingsLastAppliedSchema.parse({
    commandId: request.commandId,
    commandFingerprint: request.commandFingerprint,
    expectedRevision: request.expectedRevision,
    protectedSchemaHash: request.protectedSchemaHash,
    writeId: request.writeId,
  });
}

function requestReceipt(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

function replayValueIds(history: readonly CredentialHistoryEntry[]): Map<string, string> {
  let revision = 1;
  const commandIds = new Set<string>();
  const writeIds = new Set<string>();
  const valueIds = new Set<string>();
  const entries = new Map<string, string>();
  for (const entry of history) {
    const { receipt, marked, setValueIds } = entry;
    if (receipt.expectedRevision !== revision || commandIds.has(receipt.commandId) || writeIds.has(receipt.writeId)) {
      throw new Error("credential history has a divergent command identity");
    }
    commandIds.add(receipt.commandId);
    writeIds.add(receipt.writeId);
    for (const name of ProtectedSettingsNameSchema.options) {
      const operation = marked[name];
      const valueId = setValueIds[name];
      if (operation === undefined || "clear" in operation || "erase" in operation) {
        if (valueId !== undefined) throw new Error("credential history has an unexpected value identity");
        if (operation !== undefined) entries.delete(name);
        continue;
      }
      if (valueId === undefined || valueIds.has(valueId)) throw new Error("credential history has an invalid value identity");
      valueIds.add(valueId);
      entries.set(name, valueId);
    }
    revision += 1;
  }
  return entries;
}

function recordValueIds(record: ProtectedStoreRecord): Map<string, string> {
  return new Map(ProtectedSettingsNameSchema.options.flatMap((name) => {
    const entry = record.entries[name];
    return entry === undefined ? [] : [[name, entry.valueId] as const];
  }));
}

function sameValueIds(left: Map<string, string>, right: Map<string, string>): boolean {
  return left.size === right.size && [...left].every(([name, valueId]) => right.get(name) === valueId);
}

function withoutTombstones(ids: Map<string, string>, journal: ErasureJournal): Map<string, string> {
  const erased = new Set(journal.erasedValueIds);
  return new Map([...ids].filter(([, valueId]) => !erased.has(valueId)));
}

function replayVersionTwoHistory(
  history: readonly z.infer<typeof CredentialHistoryEntryV2Schema>[],
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

function v2Document(input: unknown): unknown {
  const parsed = CredentialDocumentV2Schema.safeParse(input);
  if (!parsed.success) return input;
  if (!privateEqual(replayVersionTwoHistory(parsed.data.history), parsed.data.record)) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  return {
    schemaVersion: 3,
    record: parsed.data.record,
    history: parsed.data.history.map((entry) => ({
      receipt: {
        commandId: entry.request.commandId,
        commandFingerprint: entry.request.commandFingerprint,
        expectedRevision: entry.request.expectedRevision,
        protectedSchemaHash: entry.request.protectedSchemaHash,
        writeId: entry.request.writeId,
        updatedAt: entry.request.updatedAt,
        requestReceipt: requestReceipt(entry.request),
      },
      marked: markProtectedSettingsPatch(entry.request.entries),
      setValueIds: entry.setValueIds,
    })),
  };
}

function authenticateDocument(input: unknown, journal: ErasureJournal = EMPTY_JOURNAL): CredentialDocument {
  const parsed = CredentialDocumentSchema.safeParse(v2Document(input));
  if (!parsed.success) throw new Error("credential store protected.json is malformed");
  const erased = new Set(journal.erasedValueIds);
  let replayed: Map<string, string>;
  try {
    replayed = withoutTombstones(replayValueIds(parsed.data.history), journal);
  } catch {
    throw new Error("credential store protected.json has malformed identity history");
  }
  const actual = recordValueIds(parsed.data.record);
  if ([...actual.values()].some((valueId) => erased.has(valueId))
    || !sameValueIds(replayed, actual)
    || parsed.data.record.revision !== parsed.data.history.length + 1) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  const latest = parsed.data.history.at(-1);
  if (latest === undefined ? parsed.data.record.lastApplied !== undefined
    : !privateEqual(parsed.data.record.lastApplied, lastApplied(latest.receipt))) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  return deepFreeze(parsed.data);
}

function initialDocument(): CredentialDocument {
  return deepFreeze(CredentialDocumentSchema.parse({
    schemaVersion: 3,
    record: initialProtectedStoreRecord(),
    history: [],
  }));
}

function sourceVersion(input: unknown): 2 | 3 {
  if (typeof input === "object" && input !== null && "schemaVersion" in input && input.schemaVersion === 2) return 2;
  return 3;
}

function readPrivateDocument(path: string): ReadDocument | undefined {
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_DOCUMENT_BYTES });
  if (file === undefined) return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
  catch { throw new Error("credential store protected.json is malformed"); }
  return {
    bytes: file.bytes,
    document: authenticateDocument(decoded),
    identity: file.identity,
    sourceVersion: sourceVersion(decoded),
  };
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

const ErasureFileEvidenceSchema = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: z.string().regex(/^[0-9a-f]{64}$/u) });
export const CredentialErasureHeadSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-erased"), epoch: z.literal(0) }),
  z.strictObject({ state: z.literal("established"), epoch: z.number().int().positive(), journal: ErasureFileEvidenceSchema, anchor: ErasureFileEvidenceSchema }),
]);
export type CredentialErasureHead = z.infer<typeof CredentialErasureHeadSchema>;
export interface VerifiedCredentialErasureHead { readonly epoch: number; }
export interface VerifiedCredentialErasureIntent { readonly epoch: number; }
type ErasureRequestIdentity = Readonly<{ commandId: string; writeId: string; commandFingerprint: string; expectedRevision: number; updatedAt: string; requestReceipt: string }>;
function erasureRequestIdentity(request: CredentialEraseInput): ErasureRequestIdentity {
  return Object.freeze({ commandId: request.commandId, writeId: request.writeId, commandFingerprint: request.commandFingerprint,
    expectedRevision: request.expectedRevision, updatedAt: request.updatedAt, requestReceipt: requestReceipt(request) });
}
const erasureHeads = new WeakMap<VerifiedCredentialErasureHead, { stateRoot: string; journalPath: string; binding: ProfileDatabaseBinding; head: CredentialErasureHead }>();
const erasureIntents = new WeakMap<VerifiedCredentialErasureIntent, { stateRoot: string; journalPath: string; binding: ProfileDatabaseBinding; prior: CredentialErasureHead; request: ErasureRequestIdentity; nextEpoch: number; nextDigest: string }>();
function erasureFileEvidence(path: string) {
  const file = readPrivateFile(path, { label: "erasure journal", maxBytes: 64_000 });
  return file === undefined ? undefined : { device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") };
}
function observeErasureHead(journalPath: string, epoch: number): CredentialErasureHead {
  noSymlinkAncestry(dirname(journalPath), new Map());
  const journal = erasureFileEvidence(journalPath), anchor = erasureFileEvidence(`${journalPath}.authority`);
  if (journal === undefined && anchor === undefined && epoch === 0) return { state: "never-erased", epoch: 0 };
  if (journal === undefined || anchor === undefined) throw new Error("credential-erasure-head-missing");
  return CredentialErasureHeadSchema.parse({ state: "established", epoch, journal, anchor });
}
export function assertCredentialErasureHeadFiles(journalPath: string, head: CredentialErasureHead): void {
  if (canonicalJsonStringify(observeErasureHead(journalPath, head.epoch)) !== canonicalJsonStringify(head)) throw new Error("credential-erasure-head-changed");
}
export function verifyCredentialErasureHead(witness: VerifiedCredentialErasureHead, stateRoot: string, journalPath: string, binding: ProfileDatabaseBinding): CredentialErasureHead {
  const capture = erasureHeads.get(witness);
  if (capture === undefined || capture.stateRoot !== stateRoot || capture.journalPath !== journalPath
    || canonicalJsonStringify(capture.binding) !== canonicalJsonStringify(binding)) throw new Error("credential-erasure-head-unissued");
  assertCredentialErasureHeadFiles(journalPath, capture.head);
  return capture.head;
}
export function verifyCredentialErasureIntent(witness: VerifiedCredentialErasureIntent, stateRoot: string, journalPath: string, binding: ProfileDatabaseBinding) {
  const capture = erasureIntents.get(witness);
  if (capture === undefined || capture.stateRoot !== stateRoot || capture.journalPath !== journalPath
    || canonicalJsonStringify(capture.binding) !== canonicalJsonStringify(binding)) throw new Error("credential-erasure-intent-unissued");
  assertCredentialErasureHeadFiles(journalPath, capture.prior);
  return capture;
}
export function captureCredentialErasureHead(store: CredentialStore): VerifiedCredentialErasureHead {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("credential-erasure-store-unissued");
  return owner.captureErasureHead();
}

export interface CommittedCredentialWitness { readonly revision: number; }
const committedStores = new WeakMap<CredentialStore, { readonly admission: RuntimeAdmission; readonly stateRoot: string;
  readonly journalAdmission: RuntimeAdmission; readonly journalPath: string; readonly readForErasure: (operationId: string) => ProtectedStoreRecord; readonly captureErasureHead: () => VerifiedCredentialErasureHead }>();

export function assertCredentialStoreOwner(store: CredentialStore, admissionInput: RuntimeAdmission): void {
  const admission = requireRuntimeAdmission(admissionInput), owner = committedStores.get(store);
  admission.assertLive();
  if (owner === undefined || owner.admission !== admission || owner.stateRoot !== admission.stateRoot
    || owner.journalAdmission === admission
    || owner.journalPath !== join(owner.journalAdmission.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`)) {
    throw new Error("credential-store-owner-mismatch");
  }
  owner.journalAdmission.assertProfileErasureJournal(admission, owner.journalPath);
}
type CommitFiles = readonly ({ readonly path: string; readonly device: number; readonly inode: number; readonly digest: string } | { readonly path: string; readonly absent: true })[];
const committedWitnesses = new WeakMap<CommittedCredentialWitness, { readonly stateRoot: string; readonly journalPath: string;
  readonly request: Readonly<{ commandId: string; writeId: string; commandFingerprint: string; expectedRevision: number; updatedAt: string }>;
  readonly files: CommitFiles; readonly binding: ProfileDatabaseBinding; readonly database: DirectoryIdentity }>();

function captureCommitFiles(stateRoot: string, journalPath: string): CommitFiles {
  const directory = join(stateRoot, "credentials");
  noSymlinkAncestry(directory, new Map());
  noSymlinkAncestry(dirname(journalPath), new Map());
  for (const name of [CREDENTIAL_LOCK_NAME, CREDENTIAL_REAPER_NAME, CREDENTIAL_REAPER_CLAIM_NAME]) {
    if (lstatSync(join(directory, name), { throwIfNoEntry: false }) !== undefined) throw new Error("profile-signup-credential-busy");
  }
  const paths = [join(directory, CREDENTIAL_FILE_NAME), journalPath, `${journalPath}.authority`];
  const files = paths.map((path, index) => {
    const file = readPrivateFile(path, { label: index === 0 ? "protected.json" : "erasure journal", maxBytes: MAX_CREDENTIAL_DOCUMENT_BYTES });
    if (file === undefined) {
      if (index === 0) throw new Error("profile-signup-credential-missing");
      return { path, absent: true as const };
    }
    return { path, device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  if (("absent" in (files[1] ?? {})) !== ("absent" in (files[2] ?? {}))) throw new Error("profile-signup-journal-missing");
  return files;
}

export function readForErasure(store: CredentialStore, operationId: string): ProtectedStoreRecord {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("profile-erasure-credential-store-unissued");
  return owner.readForErasure(operationId);
}

export function captureCommittedCredentialReplay(store: CredentialStore, input: ProtectedSettingsApplyInput): CommittedCredentialWitness {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("profile-signup-credential-store-unissued");
  owner.admission.assertProfileInitialization();
  owner.admission.assertWritable();
  owner.journalAdmission.assertProfileErasureJournal(owner.admission, owner.journalPath);
  const request = ProtectedSettingsApplyInputSchema.parse(input);
  const binding = owner.admission.profileBinding;
  assertCanonicalProfileBinding(join(owner.stateRoot, "state.db"), binding);
  const database = lstatSync(join(owner.stateRoot, "state.db"));
  const before = captureCommitFiles(owner.stateRoot, owner.journalPath);
  const verified = store.verifyReplay(request);
  if (verified.state !== "applied") throw new Error("profile-signup-receipt-uncommitted");
  const after = captureCommitFiles(owner.stateRoot, owner.journalPath);
  assertCanonicalProfileBinding(join(owner.stateRoot, "state.db"), binding);
  const afterDatabase = lstatSync(join(owner.stateRoot, "state.db"));
  if (database.dev !== afterDatabase.dev || database.ino !== afterDatabase.ino) throw new Error("profile-signup-database-changed");
  if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new Error("profile-signup-credential-changed");
  const witness = Object.freeze({ revision: verified.record.revision });
  committedWitnesses.set(witness, { stateRoot: owner.stateRoot, journalPath: owner.journalPath,
    request: Object.freeze({ commandId: request.commandId, writeId: request.writeId, commandFingerprint: request.commandFingerprint,
      expectedRevision: request.expectedRevision, updatedAt: request.updatedAt }), files: after, binding, database: { device: database.dev, inode: database.ino } });
  return witness;
}

export function verifyCommittedCredentialErasureOrigin(witness: CommittedCredentialWitness): CredentialErasureHead {
  const capture = committedWitnesses.get(witness);
  if (capture === undefined || capture.files.slice(1).some(file => !("absent" in file))) throw new Error("profile-signup-erasure-origin-invalid");
  assertCredentialErasureHeadFiles(capture.journalPath, { state: "never-erased", epoch: 0 });
  return { state: "never-erased", epoch: 0 };
}

export function verifyCommittedCredentialWitness(witness: CommittedCredentialWitness, stateRoot: string, journalPath: string,
  request: Readonly<{ commandId: string; writeId: string; commandFingerprint: string; expectedRevision?: number; createdAt: string }>): number {
  const captured = committedWitnesses.get(witness);
  if (captured === undefined || captured.stateRoot !== stateRoot || captured.journalPath !== journalPath
    || captured.request.commandId !== request.commandId || captured.request.writeId !== request.writeId
    || captured.request.commandFingerprint !== request.commandFingerprint || captured.request.expectedRevision !== request.expectedRevision
    || captured.request.updatedAt !== request.createdAt) throw new Error("profile-signup-receipt-mismatch");
  assertCanonicalProfileBinding(join(stateRoot, "state.db"), captured.binding);
  const database = lstatSync(join(stateRoot, "state.db"));
  if (database.dev !== captured.database.device || database.ino !== captured.database.inode) throw new Error("profile-signup-database-changed");
  if (canonicalJsonStringify(captureCommitFiles(stateRoot, journalPath)) !== canonicalJsonStringify(captured.files)) throw new Error("profile-signup-credential-changed");
  return witness.revision;
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
  const journalPath = resolve(options.erasureJournalPath ?? join(stateRoot, "credential-erasures", "journal.json"));
  if (journalPath.split(/[/\\]+/u).includes("..")) throw new Error("directory-integrity: raw credential path contains a '..' component");
  const journalAdmission = requireRuntimeAdmission(options.erasureJournalAdmission ?? admission);
  journalAdmission.assertStateRoot(journalPath);
  journalAdmission.assertStateRoot(`${journalPath}.authority`);
  function assertJournalAuthority(writable = false): void {
    if (!writable && journalAdmission === admission) {
      admission.assertLive();
      noSymlinkAncestry(dirname(journalPath), ancestorIdentities);
      return;
    }
    if (writable) journalAdmission.assertWritable();
    if (journalAdmission !== admission) journalAdmission.assertProfileErasureJournal(admission, journalPath);
    journalAdmission.assertStateRoot(journalPath);
    journalAdmission.assertStateRoot(`${journalPath}.authority`);
  }
  const ids = options.ids ?? { randomUUID };
  const hooks = options.hooks ?? {};
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  let directoryIdentity: DirectoryIdentity | undefined;
  const ancestorIdentities = new Map<string, DirectoryIdentity>();
  const ownTemporaryPaths = new Set<string>();

  function assertWritableStateRoot(): void {
    admission.assertWritable();
    noSymlinkAncestry(stateRoot, ancestorIdentities);
    admission.assertStateRoot(stateRoot);
  }

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
    const stagedRequest = staged.document.history.at(-1)?.receipt;
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

  function loadJournal(document?: CredentialDocument, purpose: "available" | "settlement" = "available"): ErasureJournal {
    assertJournalAuthority();
    const file = readPrivateFile(journalPath, { label: "erasure journal", maxBytes: 64_000 });
    const anchorFile = readPrivateFile(`${journalPath}.authority`, { label: "erasure journal", maxBytes: 64_000 });
    if (file === undefined && anchorFile === undefined) {
      if (documentHasErasure(document)) throw new CredentialErasureAuthorityError("credential erasure journal is missing");
      if (purpose === "available") admission.assertCredentialErasureHead(observeErasureHead(journalPath, 0));
      return EMPTY_JOURNAL;
    }
    if (file === undefined) throw new CredentialErasureAuthorityError("credential erasure journal is missing");
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
    catch { throw new Error("credential erasure journal is malformed"); }
    const parsed = ErasureJournalSchema.safeParse(decoded);
    if (!parsed.success) throw new Error("credential erasure journal is malformed");
    if (anchorFile === undefined) throw new CredentialErasureAuthorityError("credential erasure journal authority is missing");
    let anchorDecoded: unknown;
    try { anchorDecoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(anchorFile.bytes)); }
    catch { throw new CredentialErasureAuthorityError("credential erasure journal authority is malformed"); }
    const anchor = ErasureAuthoritySchema.safeParse(anchorDecoded);
    if (!anchor.success) throw new CredentialErasureAuthorityError("credential erasure journal authority is malformed");
    if (anchor.data.epoch > parsed.data.epoch) {
      throw new CredentialErasureAuthorityError("credential erasure journal generation rolled back");
    }
    if (anchor.data.epoch === parsed.data.epoch
      && (anchor.data.device !== file.identity.device || anchor.data.inode !== file.identity.inode)) {
      throw new CredentialErasureAuthorityError("credential erasure journal identity changed");
    }
    if (purpose === "available") admission.assertCredentialErasureHead(observeErasureHead(journalPath, parsed.data.epoch));
    return parsed.data;
  }

  function writeJournal(journal: ErasureJournal, writer: CredentialLockRecord): void {
    assertJournalAuthority(true);
    const directory = dirname(journalPath);
    ensureChildDirectory(dirname(directory), directory, "credential erasure journal", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
    if (!noSymlinkAncestry(directory, ancestorIdentities)) {
      throw new CredentialErasureAuthorityError("credential erasure journal ancestry is incomplete");
    }
    const temporaryPath = join(directory, `.journal.${writer.acquisitionId}.${z.uuid().parse(ids.randomUUID())}.tmp`);
    try {
      writePrivateStage(temporaryPath, encodePrivate(journal));
      replacePrivateFile(temporaryPath, journalPath);
      fsyncPath(directory);
    } finally {
      removeTemporary(temporaryPath);
    }
    const status = lstatSync(journalPath);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new CredentialErasureAuthorityError("credential erasure journal is not a regular file");
    }
    const anchorPath = `${journalPath}.authority`;
    const anchorTemporary = join(directory, `.authority.${writer.acquisitionId}.${z.uuid().parse(ids.randomUUID())}.tmp`);
    try {
      writePrivateStage(anchorTemporary, encodePrivate(ErasureAuthoritySchema.parse({
        schemaVersion: 1, epoch: journal.epoch, device: status.dev, inode: status.ino,
      })));
      replacePrivateFile(anchorTemporary, anchorPath);
      fsyncPath(directory);
    } finally {
      removeTemporary(anchorTemporary);
    }
  }

  function needsTombstoneRepair(document: CredentialDocument, journal: ErasureJournal): boolean {
    const erased = new Set(journal.erasedValueIds);
    return [...recordValueIds(document.record).values()].some((valueId) => erased.has(valueId));
  }

  function repairTombstones(document: CredentialDocument, journal: ErasureJournal): CredentialDocument | undefined {
    if (!needsTombstoneRepair(document, journal)) return undefined;
    const pending = journal.pending;
    if (pending === undefined) throw new Error("credential erasure journal is missing its pending removal");
    const already = document.history.some((entry) => entry.receipt.commandId === pending.receipt.commandId);
    const erased = new Set(journal.erasedValueIds);
    const marked = { ...pending.marked };
    for (const name of SECRET_NAMES) {
      const entry = document.record.entries[name];
      if (entry !== undefined && erased.has(entry.valueId)) marked[name] = { erase: true };
    }
    const history = already ? document.history : [...document.history, {
      ...pending,
      receipt: { ...pending.receipt, expectedRevision: document.record.revision },
      marked,
    }];
    const latest = history.at(-1);
    if (latest === undefined) throw new Error("credential erasure journal is missing its pending removal");
    const entries = Object.fromEntries(Object.entries(document.record.entries).filter(([, entry]) => !erased.has(entry.valueId)));
    return authenticateDocument({
      schemaVersion: 3,
      record: {
        ...document.record,
        entries,
        revision: history.length + 1,
        lastApplied: lastApplied(latest.receipt),
      },
      history,
    });
  }

  function readCurrentUnderLock(): CurrentDocument {
    assertDirectory();
    const current = readPrivateDocument(protectedPath);
    if (current !== undefined) return current;
    return { bytes: undefined, document: initialDocument(), sourceVersion: 3 };
  }

  function observeCurrent(): CurrentDocument {
    const missing = (): CurrentDocument => ({ bytes: undefined, document: initialDocument(), sourceVersion: 3 });
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
    if (latest.receipt.commandId !== request.commandId) return "none";
    return latest.receipt.requestReceipt === requestReceipt(request) ? "exact" : "divergent";
  }

  function historyReusesIdentity(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput | CredentialEraseInput,
  ): boolean {
    return document.history.some(({ receipt }) => (
      receipt.commandId === request.commandId || receipt.writeId === request.writeId
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
      schemaVersion: 3,
      record: {
        schemaVersion: 1,
        revision: document.record.revision + 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        entries: Object.fromEntries(entries),
        lastApplied: lastApplied(request),
      },
      history: [...document.history, {
        receipt: {
          commandId: request.commandId,
          commandFingerprint: request.commandFingerprint,
          expectedRevision: request.expectedRevision,
          protectedSchemaHash: request.protectedSchemaHash,
          writeId: request.writeId,
          updatedAt: request.updatedAt,
          requestReceipt: requestReceipt(request),
        },
        marked: markProtectedSettingsPatch(request.entries),
        setValueIds,
      }],
    });
  }

  function evaluateReplay(
    current: CurrentDocument,
    request: ProtectedSettingsApplyInput,
  ): CredentialStoreApplyOutcome | undefined {
    if (loadJournal(current.document).retiredCommandIds.includes(request.commandId)) return divergent();
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
        let current = readCurrentUnderLock();
        const repaired = repairTombstones(current.document, loadJournal(current.document));
        if (repaired !== undefined) {
          writeDocument(repaired, current.bytes, false, writer);
          current = readCurrentUnderLock();
        }
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

  const store: CredentialStore = Object.freeze({
    read(): ProtectedStoreRecord {
      admission.assertCredentialRead();
      const observed = observeCurrent();
      const journal = loadJournal(observed.document);
      if (!needsTombstoneRepair(observed.document, journal)) return observed.document.record;
      assertWritableStateRoot();
      return withLock((writer) => {
        const current = readCurrentUnderLock();
        const repaired = repairTombstones(current.document, loadJournal(current.document));
        if (repaired === undefined) return { committed: false, result: current.document.record };
        writeDocument(repaired, current.bytes, false, writer);
        return { committed: true, result: repaired.record };
      });
    },
    ownsCommandId(commandId: string): boolean {
      admission.assertLive();
      const id = z.uuid().parse(commandId);
      const document = observeCurrent().document;
      return document.history.some(({ receipt }) => receipt.commandId === id);
    },
    acceptedAt(commandId: string): string | undefined {
      admission.assertLive();
      const id = z.uuid().parse(commandId);
      return withLock(() => {
        const latest = readCurrentUnderLock().document.history.at(-1)?.receipt;
        return { committed: false, result: latest?.commandId === id ? latest.updatedAt : undefined };
      });
    },
    apply(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      assertWritableStateRoot();
      const request = admit(input);
      if (!("commandId" in request)) return request;
      return applyAdmitted(request);
    },
    erase(input: CredentialEraseInput): CredentialStoreApplyOutcome {
      const parsed = CredentialEraseInputSchema.safeParse(input);
      if (!parsed.success) return frozenRefusal("invalid-value", "credential request is invalid");
      if (parsed.data.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
        return frozenRefusal("schema-mismatch", "credential schema does not match the current catalog");
      }
      const request = parsed.data;
      admission.assertCredentialErasure(request);
      noSymlinkAncestry(stateRoot, ancestorIdentities);
      admission.assertStateRoot(stateRoot);
      try {
        return withLock((writer) => {
          let current = readCurrentUnderLock();
          const journal = loadJournal(current.document, "settlement");
          admission.resumeCredentialErasure(erasureRequestIdentity(request), observeErasureHead(journalPath, journal.epoch));
          if (journalAdmission !== admission && journal.epoch > 0) {
            const anchor = readPrivateFile(`${journalPath}.authority`, { label: "erasure journal", maxBytes: 64_000 });
            if (anchor === undefined) throw new CredentialErasureAuthorityError("credential erasure journal authority is missing");
            const authority = ErasureAuthoritySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(anchor.bytes)));
            const info = lstatSync(journalPath);
            if (authority.epoch !== journal.epoch || authority.device !== info.dev || authority.inode !== info.ino) writeJournal(journal, writer);
          }
          if (journal.retiredCommandIds.includes(request.commandId)) return { committed: false, result: divergent() };
          const repaired = repairTombstones(current.document, journal);
          if (repaired !== undefined) {
            writeDocument(repaired, current.bytes, false, writer);
            current = readCurrentUnderLock();
          }
          const receipt = requestReceipt(request);
          const latest = current.document.history.at(-1);
          if (latest?.receipt.commandId === request.commandId) {
            if (latest.receipt.requestReceipt === receipt) admission.settleCredentialErasure(erasureRequestIdentity(request), issueErasureHead(journal.epoch));
            return {
              committed: false,
              result: latest.receipt.requestReceipt === receipt
                ? deepFreeze({ state: "applied" as const, record: current.document.record })
                : divergent(),
            };
          }
          if (request.expectedRevision !== current.document.record.revision) {
            return { committed: false, result: conflict(current.document.record.revision, request.expectedRevision) };
          }
          if (historyReusesIdentity(current.document, request)) return { committed: false, result: divergent() };
          const entries = { ...current.document.record.entries };
          const erasedValueIds = [...journal.erasedValueIds];
          const retiredCommandIds = [...journal.retiredCommandIds];
          const marked: Record<string, { erase: true }> = {};
          for (const historical of current.document.history) {
            for (const name of SECRET_NAMES) {
              const valueId = historical.setValueIds[name];
              if (valueId !== undefined && !erasedValueIds.includes(valueId)) erasedValueIds.push(valueId);
              if ((valueId !== undefined || historical.marked[name] !== undefined)
                && !retiredCommandIds.includes(historical.receipt.commandId)) {
                retiredCommandIds.push(historical.receipt.commandId);
              }
            }
          }
          for (const name of SECRET_NAMES) {
            const entry = entries[name];
            if (entry === undefined) continue;
            if (!erasedValueIds.includes(entry.valueId)) erasedValueIds.push(entry.valueId);
            delete entries[name];
            marked[name] = { erase: true };
          }
          const pending = CredentialHistoryEntrySchema.parse({
            receipt: { ...lastApplied(request), updatedAt: request.updatedAt, requestReceipt: receipt },
            marked,
            setValueIds: {},
          });
          const nextJournal = ErasureJournalSchema.parse({
            schemaVersion: 1, epoch: journal.epoch + 1, erasedValueIds, retiredCommandIds, pending,
          });
          const next = authenticateDocument({
            schemaVersion: 3,
            record: {
              schemaVersion: 1,
              revision: current.document.record.revision + 1,
              protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
              entries,
              lastApplied: lastApplied(request),
            },
            history: [...current.document.history, pending],
          });
          if (journalAdmission !== admission) {
            const intent = Object.freeze({ epoch: nextJournal.epoch });
            erasureIntents.set(intent, deepFreeze({ stateRoot, journalPath, binding: admission.profileBinding, prior: observeErasureHead(journalPath, journal.epoch),
              request: erasureRequestIdentity(request),
              nextEpoch: nextJournal.epoch, nextDigest: createHash("sha256").update(encodePrivate(nextJournal)).digest("hex") }));
            admission.beginCredentialErasure(intent);
          }
          writeJournal(nextJournal, writer);
          hooks.afterErasureJournal?.();
          writeDocument(next, current.bytes, true, writer);
          admission.settleCredentialErasure(erasureRequestIdentity(request), issueErasureHead(nextJournal.epoch));
          return { committed: true, result: deepFreeze({ state: "applied" as const, record: next.record }) };
        });
      } catch (error) {
        if (error instanceof CredentialStoreLockUnavailableError) {
          return frozenRefusal("lock-unavailable", "credential store lock is unavailable");
        }
        throw error;
      }
    },
    migrateHistory(): void {
      assertWritableStateRoot();
      withLock((writer) => {
        const current = readCurrentUnderLock();
        if (current.bytes === undefined || current.sourceVersion !== 2) return { committed: false, result: undefined };
        writeDocument(current.document, current.bytes, false, writer);
        return { committed: true, result: undefined };
      });
    },
    verifyReplay(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      admission.assertLive();
      const request = admit(input);
      if (!("commandId" in request)) return request;
      const replay = evaluateReplay(observeCurrent(), request);
      return replay ?? divergent();
    },
  });
  function issueErasureHead(epoch: number): VerifiedCredentialErasureHead {
    const witness = Object.freeze({ epoch });
    if (journalAdmission !== admission) erasureHeads.set(witness, { stateRoot, journalPath, binding: admission.profileBinding, head: deepFreeze(observeErasureHead(journalPath, epoch)) });
    return witness;
  }
  committedStores.set(store, { admission, stateRoot, journalAdmission, journalPath, captureErasureHead: () => {
    admission.assertCredentialRead();
    const before = observeCurrent();
    const journal = loadJournal(before.document);
    const head = issueErasureHead(journal.epoch);
    const after = observeCurrent();
    if (!privateEqualBounded(before.document, after.document, MAX_CREDENTIAL_DOCUMENT_BYTES)) throw new Error("credential-erasure-capture-changed");
    const captured = erasureHeads.get(head);
    if (captured === undefined) throw new Error("credential-erasure-head-unissued");
    assertCredentialErasureHeadFiles(journalPath, captured.head);
    return head;
  }, readForErasure: operationId => {
    admission.assertCredentialErasureObservation(operationId);
    const current = observeCurrent();
    loadJournal(current.document, "settlement");
    return current.document.record;
  } });
  return store;
}

export { createChatGptCredentialRepository, verifyChatGptCredentialBytes, verifyChatGptCredentialStore, ChatGptCredentialError, ChatGptCredentialRecordSchema, type ChatGptCredentialRecord, type ChatGptCredentialRepositoryOptions, type ChatGptCredentialTransaction } from "./chatgpt-credential-repository.js";
