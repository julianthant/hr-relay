import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../source-closure.js';
import {
  CREDENTIAL_DIRECTORY_MODE, CredentialLockRecordSchema, errorCode, fsyncPath, noSymlinkAncestry, statDirectory,
  sameDirectory, removeExactPath, ensureChildDirectory, readPrivateFile,
  createPrivateLock, writePrivateStage, replacePrivateFile, companionCredentialEntries,
  type CredentialInventory, type DirectoryIdentity,
} from "./credential-safe-file.js";
import { assertCanonicalProfileBinding } from "../sqlite/profile-local-databases.js";
import { CredentialInitializationSchema, ProfileRegistryDocumentSchema, SignUpOperationSchema, LogoutOperationSchema, type LogoutOperation, type SignUpOperation, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type {
  CredentialStore,
  CredentialStoreApplyOutcome,
} from "../../../models/config/credential-store.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  CompleteProtectedSettingsPatchSchema,
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
import type { RuntimeAdmission, RegisteredProfileStorageClaim } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { StoppedControlProfileInventory } from "../admission/installation.js";
import { DuoCredentialDocumentSchema, DuoDocumentEnvelopeSchema, type DuoCredentialDocument } from "../../../models/config/duo-credential-store.js";


const MAX_PRIVATE_REQUEST_BYTES = 64_000;
const MAX_CREDENTIAL_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_CREDENTIAL_ENVELOPE_BYTES = Math.ceil(MAX_CREDENTIAL_DOCUMENT_BYTES / 3) * 4 + 4096;
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

const CredentialReplayReceiptSchema = ProtectedSettingsLastAppliedSchema.extend({ updatedAt: z.string().datetime({ offset: true }) });
const CredentialHistoryEntrySchema = z.strictObject({ receipt: CredentialReplayReceiptSchema,
  marked: CredentialMarkedPatchSchema, setValueIds: SetValueIdsSchema });
const ErasureHistoryEntrySchema = CredentialHistoryEntrySchema.extend({ receipt: CredentialReplayReceiptSchema.extend({ requestReceipt: z.string().regex(/^[0-9a-f]{64}$/u) }) });
const CredentialDocumentV3Schema = z.strictObject({ schemaVersion: z.literal(3), record: ProtectedStoreRecordSchema,
  history: z.array(ErasureHistoryEntrySchema) });
const CredentialLatestRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("apply"), request: ProtectedSettingsApplyInputSchema }),
  z.strictObject({ kind: z.literal("erase"), request: CredentialEraseInputSchema, repairedExpectedRevision: z.number().int().safe().positive().optional() }),
]);
const CredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(4),
  record: ProtectedStoreRecordSchema,
  historyBaseRevision: z.number().int().safe().positive(),
  history: z.array(CredentialHistoryEntrySchema),
  retiredLegacy: z.strictObject({ commandIds: z.array(z.uuid()).max(100_000), writeIds: z.array(z.uuid()).max(100_000), valueIds: z.array(z.uuid()).max(100_000) }),
  latestRequest: CredentialLatestRequestSchema.optional(),
});

const CredentialEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(4),
  algorithm: z.literal("aes-256-gcm"),
  installationId: z.uuid(),
  profileId: z.uuid(),
  keyId: z.uuid(),
  nonce: z.string().length(16).regex(/^[A-Za-z0-9+/]{16}$/u),
  tag: z.string().length(24).regex(/^[A-Za-z0-9+/]{22}==$/u),
  ciphertext: z.string().min(4).max(Math.ceil(MAX_CREDENTIAL_DOCUMENT_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});
const CredentialKeyDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(),
  key: z.string().length(44).regex(/^[A-Za-z0-9+/]{43}=$/u),
});
type CredentialKeyDocument = z.infer<typeof CredentialKeyDocumentSchema>;

function parseCredentialJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error("credential-private-document-invalid"); }
}

function credentialAad(binding: ProfileDatabaseBinding, keyId: string): Buffer {
  return Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4,
    algorithm: "aes-256-gcm", installationId: binding.installationId, profileId: binding.profileId, keyId }), "utf8");
}
function credentialKeyBytes(key: CredentialKeyDocument, binding: ProfileDatabaseBinding): Buffer {
  if (key.installationId !== binding.installationId || key.profileId !== binding.profileId) throw new Error("credential-key-binding-mismatch");
  const bytes = Buffer.from(key.key, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== key.key) throw new Error("credential-key-invalid");
  return bytes;
}
function encryptCredentialDocument(document: CredentialDocument, key: CredentialKeyDocument, binding: ProfileDatabaseBinding): Uint8Array {
  const plaintext = encodePrivate(document);
  if (plaintext.byteLength > MAX_CREDENTIAL_DOCUMENT_BYTES) throw new Error("credential-document-too-large");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", credentialKeyBytes(key, binding), nonce, { authTagLength: 16 });
  cipher.setAAD(credentialAad(binding, key.keyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encodePrivate(CredentialEnvelopeSchema.parse({ schemaVersion: 4, algorithm: "aes-256-gcm", ...binding,
    keyId: key.keyId, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
}
function decryptCredentialDocument(input: unknown, key: CredentialKeyDocument, binding: ProfileDatabaseBinding): unknown {
  const envelope = CredentialEnvelopeSchema.parse(input);
  if (Buffer.from(envelope.nonce, "base64").toString("base64") !== envelope.nonce
    || Buffer.from(envelope.tag, "base64").toString("base64") !== envelope.tag) throw new Error("credential-envelope-invalid");
  if (envelope.installationId !== binding.installationId || envelope.profileId !== binding.profileId || envelope.keyId !== key.keyId) throw new Error("credential-envelope-binding-mismatch");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  if (ciphertext.length > MAX_CREDENTIAL_DOCUMENT_BYTES || ciphertext.toString("base64") !== envelope.ciphertext) throw new Error("credential-envelope-invalid");
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialKeyBytes(key, binding), Buffer.from(envelope.nonce, "base64"), { authTagLength: 16 });
    decipher.setAAD(credentialAad(binding, key.keyId));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const pending = decipher.update(ciphertext);
    plaintext = Buffer.concat([pending, decipher.final()]);
  } catch { throw new Error("credential-document-authentication-failed"); }
  if (plaintext.length > MAX_CREDENTIAL_DOCUMENT_BYTES) throw new Error("credential-document-too-large");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown; }
  catch { throw new Error("credential-document-invalid"); }
}

export interface DuoCredentialPurpose { readonly profileId: string }

const duoPurposes = new WeakMap<DuoCredentialPurpose, {
  custody: ReturnType<RuntimeAdmission["captureDuoCredentialCustody"]>; keyPath: string; witness: CredentialKeyWitness; ancestry: Map<string, DirectoryIdentity>; documentPath: string; assertReadable(): void;
}>();

export function issueDuoCredentialPurpose(profile: RuntimeAdmission, machine: RuntimeAdmission): DuoCredentialPurpose {
  const custody = machine.captureDuoCredentialCustody(profile), binding = custody.binding;
  const keyPath = join(machine.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`);
  const witness = captureKeyFile(keyPath, binding);
  machine.assertProfileCredentialKeyAnchor(profile, witness.keyId);
  const purpose = Object.freeze({ profileId: binding.profileId }), ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(dirname(keyPath), ancestry)) throw new Error("credential-key-required");
  duoPurposes.set(purpose, { custody, keyPath, witness, ancestry,
    documentPath: join(machine.stateRoot, 'machine', 'duo-credentials', `${binding.profileId}.json`),
    assertReadable: () => profile.assertProfileRuntime() });
  return purpose;
}

function duoPurposeKey(purpose: DuoCredentialPurpose) {
  const issued = duoPurposes.get(purpose);
  if (issued === undefined) throw new Error("duo-purpose-unissued");
  issued.custody.assertHeld();
  if (!noSymlinkAncestry(dirname(issued.keyPath), issued.ancestry)) throw new Error("credential-key-required");
  assertCredentialKeyWitness(issued.keyPath, issued.witness, issued.custody.binding);
  const file = readPrivateFile(issued.keyPath, { label: "lock", maxBytes: 4096 });
  if (file === undefined) throw new Error("credential-key-required");
  if (canonicalJsonStringify({ device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") })
    !== canonicalJsonStringify(issued.witness.file)) throw new Error("credential-key-custody-changed");
  const key = CredentialKeyDocumentSchema.parse(parseCredentialJson(file.bytes));
  return { ...issued, key };
}

export function duoCredentialPurposeBinding(purpose: DuoCredentialPurpose): Readonly<{ binding: ProfileDatabaseBinding; generation: number }> {
  const issued = duoPurposeKey(purpose);
  return { binding: issued.custody.binding, generation: issued.custody.generation };
}

function duoAad(metadata: Omit<z.infer<typeof DuoDocumentEnvelopeSchema>, "tag" | "ciphertext">): Buffer {
  return Buffer.from(canonicalJsonStringify(metadata), "utf8");
}

export function sealDuoCredentialDocument(purpose: DuoCredentialPurpose, input: DuoCredentialDocument): Uint8Array {
  const { key, custody } = duoPurposeKey(purpose), document = DuoCredentialDocumentSchema.parse(input);
  if (document.installationId !== custody.binding.installationId || document.profileId !== custody.binding.profileId) throw new Error("duo-document-binding-mismatch");
  const plaintext = encodePrivate(document);
  if (plaintext.byteLength > MAX_CREDENTIAL_DOCUMENT_BYTES) throw new Error("duo-document-too-large");
  const nonce = randomBytes(12), metadata = { schemaVersion: 1 as const, purpose: "relay:duo-credential:v1" as const,
    algorithm: "aes-256-gcm" as const, ...custody.binding, keyId: key.keyId, revision: document.revision, nonce: nonce.toString("base64") };
  const cipher = createCipheriv("aes-256-gcm", credentialKeyBytes(key, custody.binding), nonce, { authTagLength: 16 });
  cipher.setAAD(duoAad(metadata));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encodePrivate(DuoDocumentEnvelopeSchema.parse({ ...metadata, tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
}

function decryptDuoCredentialDocument(issued: ReturnType<typeof duoPurposeKey>, bytes: Uint8Array, revision: number): DuoCredentialDocument {
  const { key, custody } = issued, envelope = DuoDocumentEnvelopeSchema.parse(parseCredentialJson(bytes));
  const { tag, ciphertext, ...metadata } = envelope;
  if (metadata.installationId !== custody.binding.installationId || metadata.profileId !== custody.binding.profileId || metadata.keyId !== key.keyId
    || metadata.revision !== revision) throw new Error("duo-envelope-binding-mismatch");
  for (const value of [metadata.nonce, tag, ciphertext]) if (Buffer.from(value, "base64").toString("base64") !== value) throw new Error("duo-envelope-invalid");
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialKeyBytes(key, custody.binding), Buffer.from(metadata.nonce, "base64"), { authTagLength: 16 });
    decipher.setAAD(duoAad(metadata)); decipher.setAuthTag(Buffer.from(tag, "base64"));
    plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  } catch { throw new Error("duo-document-authentication-failed"); }
  if (plaintext.byteLength > MAX_CREDENTIAL_DOCUMENT_BYTES) throw new Error("duo-document-too-large");
  const document = DuoCredentialDocumentSchema.parse(parseCredentialJson(plaintext));
  if (document.installationId !== metadata.installationId || document.profileId !== metadata.profileId || document.revision !== revision) throw new Error("duo-document-binding-mismatch");
  return document;
}

export function openDuoCredentialDocument(purpose: DuoCredentialPurpose, bytes: Uint8Array, revision: number): DuoCredentialDocument {
  const issued = duoPurposeKey(purpose);
  issued.assertReadable();
  const continuity = issued.custody.readDuoContinuity();
  if (continuity.state === "never-initialized" || revision > continuity.revision) throw new Error("duo-envelope-binding-mismatch");
  const readCurrent = () => {
    if (!noSymlinkAncestry(dirname(issued.documentPath), issued.ancestry)) throw new Error("duo-directory-required");
    const file = readPrivateFile(issued.documentPath, { label: "Duo credential", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
    if (file === undefined) throw new Error("duo-document-required");
    const identity = { device: file.identity.device, inode: file.identity.inode, digest: createHash('sha256').update(file.bytes).digest('hex') };
    if (canonicalJsonStringify(identity) !== canonicalJsonStringify(continuity.document)) throw new Error("duo-document-custody-changed");
    return file;
  };
  const currentFile = readCurrent();
  const current = decryptDuoCredentialDocument(issued, currentFile.bytes, continuity.revision);
  if ((current.credentials.length === 0) !== (continuity.state === 'erased')) throw new Error("duo-envelope-binding-mismatch");
  const document = decryptDuoCredentialDocument(issued, bytes, revision);
  if (continuity.state === 'erased' && document.credentials.length > 0) throw new Error("duo-erased-key-material-refused");
  if (document.credentials.some(row => current.retired.some(retired => retired.credentialId === row.credentialId))) throw new Error("duo-erased-key-material-refused");
  duoPurposeKey(purpose);
  const after = readCurrent();
  if (!after.bytes.equals(currentFile.bytes)) throw new Error("duo-document-custody-changed");
  issued.assertReadable();
  if (canonicalJsonStringify(issued.custody.readDuoContinuity()) !== canonicalJsonStringify(continuity)) throw new Error("duo-document-custody-changed");
  return document;
}

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
  pending: ErasureHistoryEntrySchema.optional(),
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
  readonly betweenPresenceObservations?: () => void;
  readonly beforeInitialKey?: () => void;
  readonly afterKeyStageBeforeIntent?: () => void;
  readonly afterKeyStageIntent?: () => void;
  readonly afterKeyStageJournal?: () => void;
  readonly afterInitialKey?: () => void;
  readonly afterCredentialAnchor?: () => void;
  readonly afterInitializationPhase?: (phase: "key-published" | "document-published") => void;

  readonly observeProcessIdentity?: ProcessIdentityObserver;
}

export interface CredentialInitializationCopyInspection {
  readonly capturedSecrets: readonly string[];
  readonly capturedSecretsComplete: boolean;
  containsKey(value: unknown): boolean;
  readonly keyScanOverlap: number;
  inspectEncrypted(path: string): Readonly<{ containsUcsd: boolean; containsCaptured: boolean }>;
}

export interface CredentialStoreOptions {
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  /** Durable tombstones. Outside the profile root so a profile backup cannot roll them back. */
  readonly erasureJournalPath?: string;
  readonly erasureJournalAdmission?: RuntimeAdmission;
  readonly repairInventory?: (request: CredentialEraseInput, writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection) => Readonly<{ revalidate(): void; dispose(): void }>;
  readonly pendingLogoutInventory?: (purpose: RuntimeAdmission, operation: LogoutOperation, copies: CredentialInitializationCopyInspection & Readonly<{ entriesAbsent: boolean }>) => Readonly<{ assessment: CredentialInventory; revalidate(): void }>;
  readonly initializationInventory?: (operation: SignUpOperation, writer: Readonly<{ acquisitionId: string; pid: number }>, copies: CredentialInitializationCopyInspection) => Readonly<{ revalidate(operation: SignUpOperation): () => void; revalidateBeforeKeyIntent(): void }>;
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
  readonly sourceVersion: 4;
}

type CurrentDocument = ReadDocument;

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

function replayValueIds(history: readonly CredentialHistoryEntry[], baseRevision: number): Map<string, string> {
  let revision = baseRevision;
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

function convertVersionTwoDocument(input: unknown): CredentialDocument {
  const parsed = CredentialDocumentV2Schema.parse(input);
  if (!privateEqual(replayVersionTwoHistory(parsed.history), parsed.record)) throw new Error("credential-legacy-replay-disagrees");
  const latest = parsed.history.at(-1);
  return authenticateDocument({ schemaVersion: 4, record: parsed.record, historyBaseRevision: 1,
    retiredLegacy: { commandIds: [], writeIds: [], valueIds: [] },
    ...(latest === undefined ? {} : { latestRequest: { kind: "apply", request: latest.request } }),
    history: parsed.history.map(entry => ({ receipt: { ...lastApplied(entry.request), updatedAt: entry.request.updatedAt },
      marked: markProtectedSettingsPatch(entry.request.entries), setValueIds: entry.setValueIds })) });
}

function authenticateDocument(input: unknown, journal: ErasureJournal = EMPTY_JOURNAL): CredentialDocument {
  const parsed = CredentialDocumentSchema.safeParse(input);
  if (!parsed.success) throw new Error("credential store protected.json is malformed");
  const erased = new Set(journal.erasedValueIds);
  let replayed: Map<string, string>;
  try {
    replayed = withoutTombstones(replayValueIds(parsed.data.history, parsed.data.historyBaseRevision), journal);
  } catch {
    throw new Error("credential store protected.json has malformed identity history");
  }
  const actual = recordValueIds(parsed.data.record);
  if ([...actual.values()].some((valueId) => erased.has(valueId))
    || !sameValueIds(replayed, actual)
    || parsed.data.record.revision !== parsed.data.historyBaseRevision + parsed.data.history.length
    || !Number.isSafeInteger(parsed.data.record.revision)) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  const latest = parsed.data.history.at(-1);
  if (latest === undefined ? parsed.data.record.lastApplied !== undefined
    : !privateEqual(parsed.data.record.lastApplied, lastApplied(latest.receipt))) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  const request = parsed.data.latestRequest;
  if ((latest === undefined) !== (request === undefined)
    || latest !== undefined && request !== undefined && (latest.receipt.commandId !== request.request.commandId
      || latest.receipt.writeId !== request.request.writeId || latest.receipt.updatedAt !== request.request.updatedAt
      || latest.receipt.commandFingerprint !== request.request.commandFingerprint
      || latest.receipt.expectedRevision !== (request.kind === "erase" ? request.repairedExpectedRevision ?? request.request.expectedRevision : request.request.expectedRevision)
      || latest.receipt.protectedSchemaHash !== request.request.protectedSchemaHash)
    || parsed.data.history.some(entry => parsed.data.retiredLegacy.commandIds.includes(entry.receipt.commandId)
      || parsed.data.retiredLegacy.writeIds.includes(entry.receipt.writeId)
      || Object.values(entry.setValueIds).some(id => parsed.data.retiredLegacy.valueIds.includes(id)))) throw new Error("credential-document-history-invalid");
  if (request?.kind === "apply") {
    if (!privateEqual(markProtectedSettingsPatch(request.request.entries), latest?.marked)) throw new Error("credential-latest-request-invalid");
    for (const name of ProtectedSettingsNameSchema.options) {
      const choice = request.request.entries[name], entry = parsed.data.record.entries[name];
      if (choice === undefined) continue;
      if ("clear" in choice ? entry !== undefined : entry === undefined || !privateEqual(entry.value, choice.set)
        || entry.updatedAt !== request.request.updatedAt || entry.valueId !== latest?.setValueIds[name]) throw new Error("credential-latest-request-invalid");
    }
  }
  return deepFreeze(parsed.data);
}

function initialDocument(): CredentialDocument {
  return deepFreeze(CredentialDocumentSchema.parse({
    schemaVersion: 4,
    record: initialProtectedStoreRecord(),
    historyBaseRevision: 1, history: [],
    retiredLegacy: { commandIds: [], writeIds: [], valueIds: [] },
  }));
}

export function captureReadyUpgradeCredentialSource(machine: RuntimeAdmission, claim: RegisteredProfileStorageClaim) {
  const profileId = claim.profileId;
  const observe = (owner: RuntimeAdmission, current: RegisteredProfileStorageClaim): string => {
    requireRuntimeAdmission(owner).assertProfileUpgradeCredentialSource(current);
    if (current.profileId !== profileId) throw new Error("profile-upgrade-handoff-credential-profile-changed");
    const binding = { installationId: owner.locator.installationId, profileId: current.profileId };
    const keyPath = join(owner.stateRoot, "machine", "credential-keys", `${current.profileId}.json`);
    const path = join(owner.stateRoot, "profiles", current.profileId, "credentials", CREDENTIAL_FILE_NAME);
    const keyFile = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
    const file = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
    if (keyFile === undefined || file === undefined) throw new Error("profile-upgrade-handoff-credential-required");
    const key = CredentialKeyDocumentSchema.parse(parseCredentialJson(keyFile.bytes));
    const envelope = CredentialEnvelopeSchema.parse(parseCredentialJson(file.bytes));
    if (key.installationId !== binding.installationId || key.profileId !== binding.profileId || envelope.installationId !== binding.installationId
      || envelope.profileId !== binding.profileId || envelope.keyId !== key.keyId) throw new Error("profile-upgrade-handoff-credential-binding-changed");
    owner.assertProfileUpgradeCredentialSource(current);
    return canonicalJsonStringify([keyFile, file].map(value => ({ identity: value.identity, digest: createHash("sha256").update(value.bytes).digest("hex") })));
  };
  const original = observe(machine, claim);
  return Object.freeze({ revalidate(owner: RuntimeAdmission, current: RegisteredProfileStorageClaim): void {
    if (observe(owner, current) !== original) throw new Error("profile-upgrade-handoff-credential-changed");
  } });
}

function readAuthenticatedDocument(path: string, key: CredentialKeyDocument, binding: ProfileDatabaseBinding): ReadDocument | undefined {
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
  if (file === undefined) return undefined;
  let decoded: unknown;
  try { decoded = parseCredentialJson(file.bytes); }
  catch { throw new Error("credential store protected.json is malformed"); }
  return {
    bytes: file.bytes,
    document: authenticateDocument(decryptCredentialDocument(decoded, key, binding)),
    identity: file.identity,
    sourceVersion: 4,
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
  try { decoded = parseCredentialJson(file.bytes); }
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
export function erasureRequestIdentity(request: CredentialEraseInput): ErasureRequestIdentity {
  return Object.freeze({ commandId: request.commandId, writeId: request.writeId, commandFingerprint: request.commandFingerprint,
    expectedRevision: request.expectedRevision, updatedAt: request.updatedAt, requestReceipt: requestReceipt(request) });
}
export const CredentialKeyWitnessSchema = z.strictObject({ keyId: z.uuid(), binding: z.strictObject({ installationId: z.uuid(), profileId: z.uuid() }), file: ErasureFileEvidenceSchema });
export type CredentialKeyWitness = z.infer<typeof CredentialKeyWitnessSchema>;
function captureKeyFile(keyPath: string, binding: ProfileDatabaseBinding): CredentialKeyWitness {
  noSymlinkAncestry(dirname(keyPath), new Map());
  const file = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
  if (file === undefined) throw new Error("credential-key-required");
  const key = CredentialKeyDocumentSchema.parse(parseCredentialJson(file.bytes));
  credentialKeyBytes(key, binding);
  return CredentialKeyWitnessSchema.parse({ keyId: key.keyId, binding, file: { device: file.identity.device, inode: file.identity.inode,
    digest: createHash("sha256").update(file.bytes).digest("hex") } });
}
function captureProfileCredentialsForControlUpgrade(machineRoot: string, binding: ProfileDatabaseBinding,
  keyWitness: CredentialKeyWitness, head: CredentialErasureHead) {
  const keyPath = join(machineRoot, "machine", "credential-keys", `${binding.profileId}.json`);
  const journalPath = join(machineRoot, "machine", "erasures", `${binding.profileId}.json`);
  assertCredentialKeyWitness(keyPath, keyWitness, binding);
  assertCredentialErasureHeadFiles(journalPath, head);
  const keyFile = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
  if (keyFile === undefined) throw new Error("credential-key-required");
  if (canonicalJsonStringify({ device: keyFile.identity.device, inode: keyFile.identity.inode,
    digest: createHash("sha256").update(keyFile.bytes).digest("hex") }) !== canonicalJsonStringify(keyWitness.file)) throw new Error("credential-key-custody-changed");
  const key = CredentialKeyDocumentSchema.parse(parseCredentialJson(keyFile.bytes));
  let journal: ErasureJournal;
  if (head.state === "never-erased") journal = EMPTY_JOURNAL;
  else {
    const file = readPrivateFile(journalPath, { label: "erasure journal", maxBytes: 64_000 });
    if (file === undefined) throw new Error("credential-erasure-head-missing");
    journal = ErasureJournalSchema.parse(parseCredentialJson(file.bytes));
    if (journal.epoch !== head.epoch) throw new Error("credential-erasure-head-changed");
  }
  const path = join(machineRoot, "profiles", binding.profileId, "credentials", "protected.json");
  noSymlinkAncestry(dirname(path), new Map());
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
  if (file === undefined) throw new Error("credential-document-required");
  const document = authenticateDocument(decryptCredentialDocument(parseCredentialJson(file.bytes), key, binding), journal);
  assertCredentialKeyWitness(keyPath, keyWitness, binding);
  assertCredentialErasureHeadFiles(journalPath, head);
  return { key, document, witness: { device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") } };
}

export function inspectProfileCredentialsForControlUpgrade(machineRoot: string, binding: ProfileDatabaseBinding,
  keyWitness: CredentialKeyWitness, head: CredentialErasureHead): Readonly<{ device: number; inode: number; digest: string }> {
  return captureProfileCredentialsForControlUpgrade(machineRoot, binding, keyWitness, head).witness;
}

function credentialKeyMatcher(key: z.infer<typeof CredentialKeyDocumentSchema>, binding: ProfileDatabaseBinding, bytes: Uint8Array): (value: unknown) => boolean {
  const little = Buffer.from(key.key, "utf16le");
  const patterns = [credentialKeyBytes(key, binding), Buffer.from(key.key, "utf8"), little, Buffer.from(little).swap16(), Buffer.from(bytes)];
  const inspect = (value: unknown): boolean => {
    if (value instanceof Uint8Array) return patterns.some(pattern => Buffer.from(value.buffer, value.byteOffset, value.byteLength).includes(pattern));
    if (typeof value === "string") return inspect(Buffer.from(value, "utf8"));
    if (Array.isArray(value)) return value.some(inspect);
    return typeof value === "object" && value !== null && Object.entries(value).some(([name, child]) => inspect(name) || inspect(child));
  };
  return inspect;
}

export interface StoppedControlCredentialAttestation { readonly profileId: string }

const stoppedControlAttestations = new WeakMap<StoppedControlCredentialAttestation, {
  claim: StoppedControlProfileInventory; used: boolean; revalidate(): () => void;
}>();

export function attestStoppedControlCredentials(admission: RuntimeAdmission, claim: StoppedControlProfileInventory,
  assess: (copies: CredentialInitializationCopyInspection) => Readonly<{ revalidate(): () => void; revalidateBeforeKeyIntent(): void }>): StoppedControlCredentialAttestation {
  const source = requireRuntimeAdmission(admission).readStoppedControlCredentialInventorySource(claim);
  const capture = captureProfileCredentialsForControlUpgrade(source.machineRoot, source.binding, source.key, source.head);
  const capturedSecrets = SECRET_NAMES.flatMap(name => { const entry = capture.document.record.entries[name]; return entry === undefined ? [] : [entry.value]; });
  const keyPath = join(source.machineRoot, "machine", "credential-keys", `${claim.profileId}.json`);
  const keyFile = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
  if (keyFile === undefined) throw new Error("credential-key-required");
  const containsKey = credentialKeyMatcher(capture.key, source.binding, keyFile.bytes);
  const inventory = assess({ capturedSecrets, capturedSecretsComplete: SECRET_NAMES.every(name => capture.document.record.entries[name] !== undefined), containsKey, keyScanOverlap: 4095,
    inspectEncrypted: path => {
      const bytes = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
      if (bytes === undefined) throw new Error("credential-copy-required");
      const copy = authenticateDocument(decryptCredentialDocument(parseCredentialJson(bytes.bytes), capture.key, source.binding));
      const inspected = inspectAuthenticatedCredentialPayload(copy, capturedSecrets);
      return { ...inspected, containsCaptured: inspected.containsCaptured || containsKey(copy) };
    } });
  inventory.revalidateBeforeKeyIntent(); source.assertHeld();
  const issued = Object.freeze({ profileId: claim.profileId });
  stoppedControlAttestations.set(issued, { claim, used: false, revalidate: () => {
    source.assertHeld(); inventory.revalidateBeforeKeyIntent();
    const physicalCopies = inventory.revalidate();
    if (canonicalJsonStringify(inspectProfileCredentialsForControlUpgrade(source.machineRoot, source.binding, source.key, source.head)) !== canonicalJsonStringify(capture.witness)) throw new Error("profile-control-upgrade-credential-source-changed");
    source.assertHeld();
    return () => {
      source.revalidateSource(); physicalCopies();
      if (canonicalJsonStringify(inspectProfileCredentialsForControlUpgrade(source.machineRoot, source.binding, source.key, source.head)) !== canonicalJsonStringify(capture.witness)) throw new Error("profile-control-upgrade-credential-source-changed");
      source.revalidateSource(); physicalCopies();
    };
  } });
  return issued;
}

export function verifyStoppedControlCredentialAttestation(proof: StoppedControlCredentialAttestation, claim: StoppedControlProfileInventory, consume: boolean): () => void {
  const issued = stoppedControlAttestations.get(proof);
  if (issued === undefined || issued.used || issued.claim !== claim || proof.profileId !== claim.profileId) throw new Error("profile-control-upgrade-attestation-unissued-or-used");
  const afterPublication = issued.revalidate();
  if (consume) { issued.used = true; stoppedControlAttestations.delete(proof); }
  return afterPublication;
}

export function releaseStoppedControlCredentialAttestation(proof: StoppedControlCredentialAttestation): void {
  stoppedControlAttestations.delete(proof);
}

export function assertUnpublishedCredentialKey(keyPath: string, initialization: NonNullable<SignUpOperation["credentialInitialization"]>, binding: ProfileDatabaseBinding): void {
  const captured = captureKeyFile(keyPath, binding);
  if (captured.keyId !== initialization.keyId || initialization.keyDocumentDigest === undefined || captured.file.digest !== initialization.keyDocumentDigest) throw new Error("credential-initialization-key-mismatch");
  if (initialization.keyFile !== undefined && canonicalJsonStringify(captured.file) !== canonicalJsonStringify(initialization.keyFile)) throw new Error("credential-key-custody-changed");
}
export function assertCredentialKeyWitness(keyPath: string, witness: CredentialKeyWitness, binding: ProfileDatabaseBinding): void {
  if (canonicalJsonStringify(captureKeyFile(keyPath, binding)) !== canonicalJsonStringify(witness)) throw new Error("credential-key-custody-changed");
}

const erasureHeads = new WeakMap<VerifiedCredentialErasureHead, { stateRoot: string; journalPath: string; binding: ProfileDatabaseBinding; head: CredentialErasureHead; keyPath: string; key: CredentialKeyWitness }>();
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
  assertCredentialKeyWitness(capture.keyPath, capture.key, binding);
  return capture.head;
}
export function verifyCredentialKeyHead(witness: VerifiedCredentialErasureHead, stateRoot: string, binding: ProfileDatabaseBinding): CredentialKeyWitness {
  const capture = erasureHeads.get(witness);
  if (capture === undefined || capture.stateRoot !== stateRoot || canonicalJsonStringify(capture.binding) !== canonicalJsonStringify(binding)) throw new Error("credential-key-witness-unissued");
  assertCredentialKeyWitness(capture.keyPath, capture.key, binding);
  return capture.key;
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

interface CredentialInitializationInventoryProof { readonly operationId: string; }
const initializationInventoryProofs = new WeakMap<CredentialInitializationInventoryProof, Readonly<{
  admission: RuntimeAdmission; operationId: string; keyId: string; revalidate: (operation: SignUpOperation) => void;
  head: CredentialErasureHead; journalPath: string;
}>>();
function assertInitializationInventoryProof(proof: CredentialInitializationInventoryProof, admission: RuntimeAdmission, operation: SignUpOperation): void {
  const capture = initializationInventoryProofs.get(proof);
  if (capture === undefined || capture.admission !== admission || capture.operationId !== operation.operationId
    || capture.keyId !== operation.credentialInitialization?.keyId) throw new Error("credential-initialization-proof-unissued");
  admission.assertLive();
  assertCredentialErasureHeadFiles(capture.journalPath, capture.head);
  capture.revalidate(operation);
}

export interface CommittedCredentialWitness { readonly revision: number; }
const committedStores = new WeakMap<CredentialStore, { readonly pendingLogoutInventory: (operation: LogoutOperation) => Readonly<{ assessment: CredentialInventory; revalidate(): void; dispose(): void }>; readonly admission: RuntimeAdmission; readonly stateRoot: string;
  readonly presence: () => readonly { readonly name: z.infer<typeof ProtectedSettingsNameSchema>; readonly present: boolean }[]; readonly journalAdmission: RuntimeAdmission; readonly journalPath: string; readonly keyPath: string; readonly containsKey: (value: unknown) => boolean; readonly inspectCopy: (path: string, capturedSecrets: readonly string[]) => Readonly<{ containsUcsd: boolean; containsCaptured: boolean }> ; readonly migrationSource: () => CredentialMigrationSource; readonly readForErasure: (operationId: string) => ProtectedStoreRecord; readonly captureErasureHead: () => VerifiedCredentialErasureHead }>();

export function observeCredentialPresence(store: CredentialStore, admission: RuntimeAdmission): readonly { readonly name: z.infer<typeof ProtectedSettingsNameSchema>; readonly present: boolean }[] {
  assertCredentialStoreOwner(store, admission);
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("credential-presence-owner-required");
  return owner.presence();
}

type CredentialMigrationSource = { state: "current" } | { state: "absent" } | { state: "legacy"; schemaVersion: 2 | 3; revision: number; device: number; inode: number; digest: string };
export function preparePendingLogoutInventory(store: CredentialStore, operation: LogoutOperation): Readonly<{ assessment: CredentialInventory; revalidate(): void; dispose(): void }> {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("credential-store-owner-required");
  owner.admission.assertCredentialErasureObservation(operation.operationId);
  return owner.pendingLogoutInventory(LogoutOperationSchema.parse(operation));
}

export function inspectCredentialCopy(store: CredentialStore, path: string, capturedSecrets: readonly string[]): Readonly<{ containsUcsd: boolean; containsCaptured: boolean }> {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("credential-copy-owner-required");
  owner.admission.assertLive();
  return owner.inspectCopy(path, capturedSecrets);
}

export function inspectCredentialKeyCopy(store: CredentialStore, value: unknown): boolean {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("credential-copy-owner-required");
  owner.admission.assertLive();
  return owner.containsKey(value);
}

export function credentialMigrationSource(store: CredentialStore): CredentialMigrationSource {
  const owner = committedStores.get(store);
  if (owner === undefined) throw new Error("credential-migration-owner-required");
  owner.admission.assertLive();
  owner.journalAdmission.assertProfileCredentialKey(owner.admission, join(owner.journalAdmission.stateRoot, "machine", "credential-keys", `${owner.admission.profileBinding.profileId}.json`));
  return owner.migrationSource();
}

export function assertCredentialStoreOwner(store: CredentialStore, admissionInput: RuntimeAdmission): void {
  const admission = requireRuntimeAdmission(admissionInput), owner = committedStores.get(store);
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
  readonly files: CommitFiles; readonly keyPath: string; readonly key: CredentialKeyWitness; readonly binding: ProfileDatabaseBinding; readonly database: DirectoryIdentity }>();

function captureCommitFiles(stateRoot: string, journalPath: string): CommitFiles {
  const directory = join(stateRoot, "credentials");
  noSymlinkAncestry(directory, new Map());
  noSymlinkAncestry(dirname(journalPath), new Map());
  for (const name of [CREDENTIAL_LOCK_NAME, CREDENTIAL_REAPER_NAME, CREDENTIAL_REAPER_CLAIM_NAME]) {
    if (lstatSync(join(directory, name), { throwIfNoEntry: false }) !== undefined) throw new Error("profile-signup-credential-busy");
  }
  const paths = [join(directory, CREDENTIAL_FILE_NAME), journalPath, `${journalPath}.authority`];
  const files = paths.map((path, index) => {
    const file = readPrivateFile(path, { label: index === 0 ? "protected.json" : "erasure journal", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
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
  const key = captureKeyFile(owner.keyPath, binding);
  const before = captureCommitFiles(owner.stateRoot, owner.journalPath);
  const verified = store.verifyReplay(request);
  if (verified.state !== "applied") throw new Error("profile-signup-receipt-uncommitted");
  const after = captureCommitFiles(owner.stateRoot, owner.journalPath);
  assertCredentialKeyWitness(owner.keyPath, key, binding);
  assertCanonicalProfileBinding(join(owner.stateRoot, "state.db"), binding);
  const afterDatabase = lstatSync(join(owner.stateRoot, "state.db"));
  if (database.dev !== afterDatabase.dev || database.ino !== afterDatabase.ino) throw new Error("profile-signup-database-changed");
  if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) throw new Error("profile-signup-credential-changed");
  const witness = Object.freeze({ revision: verified.record.revision });
  committedWitnesses.set(witness, { stateRoot: owner.stateRoot, journalPath: owner.journalPath,
    request: Object.freeze({ commandId: request.commandId, writeId: request.writeId, commandFingerprint: request.commandFingerprint,
      expectedRevision: request.expectedRevision, updatedAt: request.updatedAt }), files: after, keyPath: owner.keyPath, key, binding, database: { device: database.dev, inode: database.ino } });
  return witness;
}

export function verifyCommittedCredentialKey(witness: CommittedCredentialWitness): CredentialKeyWitness {
  const captured = committedWitnesses.get(witness);
  if (captured === undefined) throw new Error("credential-key-witness-unissued");
  assertCredentialKeyWitness(captured.keyPath, captured.key, captured.binding);
  return captured.key;
}

export const CredentialKeyStagePublicationSchema = z.strictObject({ registry: ProfileRegistryDocumentSchema, priorOperation: SignUpOperationSchema,
  operation: SignUpOperationSchema, key: CredentialKeyWitnessSchema });
export type CredentialKeyStagePublication = z.infer<typeof CredentialKeyStagePublicationSchema>;
export interface CommittedCredentialKeyStage { readonly operationId: string; }
const committedKeyStages = new WeakMap<CommittedCredentialKeyStage, Readonly<{ capture: CredentialKeyStagePublication; revalidate(): void; afterIntent?: () => void }>>();
export function assertCredentialKeyStagePublication(stateRoot: string, capture: Pick<CredentialKeyStagePublication, "priorOperation" | "operation" | "key">): void {
  const prior = capture.priorOperation, next = capture.operation, binding = capture.key.binding;
  if (prior.profileId !== binding.profileId || next.profileId !== prior.profileId || next.operationId !== prior.operationId
    || prior.credentialInitialization === undefined || next.credentialInitialization === undefined
    || canonicalJsonStringify({ ...next, credentialInitialization: prior.credentialInitialization }) !== canonicalJsonStringify(prior)
    || canonicalJsonStringify(next.credentialInitialization.keyFile) !== canonicalJsonStringify(capture.key.file)
    || next.credentialInitialization.keyDocumentDigest !== capture.key.file.digest
    || next.credentialInitialization.keyId !== capture.key.keyId) throw new Error("credential-key-stage-intent-invalid");
  const priorInitialization = prior.credentialInitialization, nextInitialization = next.credentialInitialization;
  if (priorInitialization === undefined || nextInitialization === undefined
    || canonicalJsonStringify({ mode: priorInitialization.mode, keyId: priorInitialization.keyId, phase: priorInitialization.phase,
      ...(priorInitialization.mode === "initial" ? {} : { source: priorInitialization.source }) }) !== canonicalJsonStringify({ mode: nextInitialization.mode,
      keyId: nextInitialization.keyId, phase: nextInitialization.phase, ...(nextInitialization.mode === "initial" ? {} : { source: nextInitialization.source }) })) throw new Error("credential-key-stage-intent-invalid");
  const directory = join(stateRoot, "machine", "credential-keys"), stage = join(directory, `.credential-key.${next.operationId}.tmp`), final = join(directory, `${next.profileId}.json`);
  const staged = lstatSync(stage, { throwIfNoEntry: false }), published = lstatSync(final, { throwIfNoEntry: false });
  if ((staged === undefined) === (published === undefined)) throw new Error("credential-key-stage-outcome-uncertain");
  assertCredentialKeyWitness(staged === undefined ? final : stage, capture.key, binding);
}
export function observeCredentialKeyStageIntent(witness: CommittedCredentialKeyStage): void {
  const issued = committedKeyStages.get(witness);
  if (issued === undefined) throw new Error("credential-key-stage-witness-unissued");
  issued.afterIntent?.();
}
export function verifyCommittedCredentialKeyStage(witness: CommittedCredentialKeyStage, stateRoot: string): CredentialKeyStagePublication {
  const issued = committedKeyStages.get(witness);
  if (issued === undefined) throw new Error("credential-key-stage-witness-unissued");
  issued.revalidate();
  assertCredentialKeyStagePublication(stateRoot, issued.capture);
  return issued.capture;
}

export const CredentialInitializationPublicationSchema = z.strictObject({ operation: SignUpOperationSchema,
  key: CredentialKeyWitnessSchema, head: CredentialErasureHeadSchema,
  document: ErasureFileEvidenceSchema });
export type CredentialInitializationPublication = z.infer<typeof CredentialInitializationPublicationSchema>;
export interface CommittedCredentialInitialization { readonly operationId: string; }
const initializedCredentials = new WeakMap<CommittedCredentialInitialization, Readonly<{ capture: CredentialInitializationPublication; revalidate(): void }>>();
export function assertCredentialInitializationPublication(stateRoot: string, journalPath: string, input: CredentialInitializationPublication): void {
  const capture = CredentialInitializationPublicationSchema.parse(input), operation = capture.operation;
  if (operation.phase !== "applying" || operation.credentialInitialization?.phase !== "document-published"
    || operation.credentialInitialization.keyId !== capture.key.keyId || operation.profileId !== capture.key.binding.profileId
    || operation.credentialInitialization.keyDocumentDigest !== capture.key.file.digest
    || canonicalJsonStringify(operation.credentialInitialization.keyFile) !== canonicalJsonStringify(capture.key.file)) throw new Error("credential-initialization-publication-invalid");
  const keyPath = join(stateRoot, "machine", "credential-keys", `${operation.profileId}.json`);
  assertCredentialKeyWitness(keyPath, capture.key, capture.key.binding);
  assertCredentialErasureHeadFiles(journalPath, capture.head);
  const keyFile = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
  if (keyFile === undefined) throw new Error("credential-key-required");
  const path = join(stateRoot, "profiles", operation.profileId, "credentials", CREDENTIAL_FILE_NAME);
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
  if (file === undefined || file.identity.device !== capture.document.device || file.identity.inode !== capture.document.inode
    || createHash("sha256").update(file.bytes).digest("hex") !== capture.document.digest) throw new Error("credential-initialization-document-changed");
  readAuthenticatedDocument(path, CredentialKeyDocumentSchema.parse(parseCredentialJson(keyFile.bytes)), capture.key.binding);
}
export function verifyCommittedCredentialInitialization(witness: CommittedCredentialInitialization, stateRoot: string, journalPath: string): CredentialInitializationPublication {
  const issued = initializedCredentials.get(witness);
  if (issued === undefined) throw new Error("credential-initialization-witness-unissued");
  issued.revalidate();
  assertCredentialInitializationPublication(stateRoot, journalPath, issued.capture);
  return issued.capture;
}

export function verifyCommittedCredentialErasureOrigin(witness: CommittedCredentialWitness): CredentialErasureHead {
  const capture = committedWitnesses.get(witness);
  if (capture === undefined || capture.files.slice(1).some(file => !("absent" in file))) throw new Error("profile-signup-erasure-origin-invalid");
  assertCredentialErasureHeadFiles(capture.journalPath, { state: "never-erased", epoch: 0 });
  assertCredentialKeyWitness(capture.keyPath, capture.key, capture.binding);
  return { state: "never-erased", epoch: 0 };
}

export function verifyCommittedCredentialWitness(witness: CommittedCredentialWitness, stateRoot: string, journalPath: string,
  request: Readonly<{ commandId: string; writeId: string; commandFingerprint: string; expectedRevision?: number; createdAt: string }>): number {
  const captured = committedWitnesses.get(witness);
  if (captured === undefined || captured.stateRoot !== stateRoot || captured.journalPath !== journalPath
    || captured.request.commandId !== request.commandId || captured.request.writeId !== request.writeId
    || captured.request.commandFingerprint !== request.commandFingerprint || captured.request.expectedRevision !== request.expectedRevision
    || captured.request.updatedAt !== request.createdAt) throw new Error("profile-signup-receipt-mismatch");
  assertCredentialKeyWitness(captured.keyPath, captured.key, captured.binding);
  assertCanonicalProfileBinding(join(stateRoot, "state.db"), captured.binding);
  const database = lstatSync(join(stateRoot, "state.db"));
  if (database.dev !== captured.database.device || database.ino !== captured.database.inode) throw new Error("profile-signup-database-changed");
  if (canonicalJsonStringify(captureCommitFiles(stateRoot, journalPath)) !== canonicalJsonStringify(captured.files)) throw new Error("profile-signup-credential-changed");
  return witness.revision;
}

function credentialValueStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(credentialValueStrings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(credentialValueStrings);
  return [];
}

function inspectAuthenticatedCredentialPayload(payload: CredentialDocument, capturedSecrets: readonly string[]): Readonly<{ containsUcsd: boolean; containsCaptured: boolean }> {
  const holds = payload.record.entries.ucpathUserId !== undefined || payload.record.entries.ucpathPassword !== undefined
    || payload.latestRequest?.kind === "apply" && SECRET_NAMES.some(name => { const entry = payload.latestRequest?.kind === "apply" ? payload.latestRequest.request.entries[name] : undefined; return entry !== undefined && "set" in entry; });
  const contains = (value: unknown): boolean => typeof value === "string" ? capturedSecrets.some(secret => secret.length > 0 && value.includes(secret))
    : Array.isArray(value) ? value.some(contains) : typeof value === "object" && value !== null && Object.entries(value).some(([key, member]) => contains(key) || contains(member));
  return { containsUcsd: holds, containsCaptured: contains(payload) };
}

export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  const admission = requireRuntimeAdmission(options.admission);
  const binding = admission.profileBinding;
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
  const keyPath = join(journalAdmission.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`);
  journalAdmission.assertProfileCredentialKey(admission, keyPath);
  function readKey(): CredentialKeyDocument {
    journalAdmission.assertProfileCredentialKey(admission, keyPath);
    const file = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
    if (file === undefined) throw new Error("credential-key-required");
    const key = CredentialKeyDocumentSchema.parse(parseCredentialJson(file.bytes));
    credentialKeyBytes(key, binding);
    journalAdmission.assertProfileCredentialKeyAnchor(admission, key.keyId);
    return key;
  }
  function containsKey(value: unknown): boolean {
    const file = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
    if (file === undefined) return false;
    return credentialKeyMatcher(readKey(), binding, file.bytes)(value);
  }
  function readPrivateDocument(path: string): ReadDocument | undefined {
    if (readPrivateFile(path, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES }) === undefined) return undefined;
    return readAuthenticatedDocument(path, readKey(), binding);
  }
  const ids = options.ids ?? { randomUUID };
  const hooks = options.hooks ?? {};
  const observer = hooks.observeProcessIdentity ?? observeProcessIdentity;
  let directoryIdentity: DirectoryIdentity | undefined;
  const ancestorIdentities = new Map<string, DirectoryIdentity>();
  const ownTemporaryPaths = new Set<string>();
  let initializationRecovery: Readonly<{ operation: SignUpOperation; replacement?: z.infer<typeof CompleteProtectedSettingsPatchSchema> }> | undefined;

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
    const rawCurrent = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
    if (initializationRecovery !== undefined) {
      const operation = journalAdmission.assertProfileCredentialInitialization(admission, initializationRecovery.operation);
      const init = operation.credentialInitialization;
      if (init === undefined || readKey().keyId !== init.keyId) throw new Error("credential-initialization-recovery-key-mismatch");
      if (init.mode === "initial") {
        if (rawCurrent !== undefined || !privateEqual(staged.document, initialDocument())) throw new Error("credential-initialization-recovery-divergent");
      } else {
        if (rawCurrent === undefined || rawCurrent.identity.device !== init.source.device || rawCurrent.identity.inode !== init.source.inode
          || createHash("sha256").update(rawCurrent.bytes).digest("hex") !== init.source.digest) throw new Error("credential-initialization-recovery-source-changed");
        if (init.mode === "proven-v2") {
          const decoded: unknown = parseCredentialJson(rawCurrent.bytes);
          if (!privateEqual(staged.document, convertVersionTwoDocument(decoded))) throw new Error("credential-initialization-recovery-divergent");
        } else {
          const request = ProtectedSettingsApplyInputSchema.parse({ commandId: operation.commandId, commandFingerprint: operation.commandFingerprint,
            expectedRevision: init.source.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: operation.writeId,
            updatedAt: operation.createdAt, entries: initializationRecovery.replacement });
          if (exactLastReplay(staged.document, request) !== "exact") throw new Error("credential-initialization-recovery-divergent");
        }
      }
      removeExactPath(temporaryPath, staged.identity, false, "credential-initialization-stage-changed");
      fsyncPath(credentialDirectory);
      return;
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
    const bytes = encryptCredentialDocument(document, readKey(), binding);
    if (bytes.byteLength > MAX_CREDENTIAL_ENVELOPE_BYTES) {
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
      const live = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
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
    try { decoded = parseCredentialJson(file.bytes); }
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
    const latestErase = document?.latestRequest;
    if (latestErase?.kind === "erase" && latestErase.repairedExpectedRevision !== undefined
      && (parsed.data.pending === undefined || !privateEqual(erasureRequestIdentity(latestErase.request),
        { commandId: parsed.data.pending.receipt.commandId, writeId: parsed.data.pending.receipt.writeId, commandFingerprint: parsed.data.pending.receipt.commandFingerprint, expectedRevision: parsed.data.pending.receipt.expectedRevision, updatedAt: parsed.data.pending.receipt.updatedAt, requestReceipt: parsed.data.pending.receipt.requestReceipt }))) {
      throw new CredentialErasureAuthorityError("credential repaired erasure identity differs from pending operation");
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

  function withRepairInventory<T>(current: CurrentDocument, journal: ErasureJournal, writer: CredentialLockRecord, work: () => T): T {
    const pending = journal.pending;
    if (pending === undefined) throw new Error("credential-repair-pending-operation-required");
    const request = CredentialEraseInputSchema.parse({ ...lastApplied(pending.receipt), updatedAt: pending.receipt.updatedAt });
    const head = observeErasureHead(journalPath, journal.epoch), key = captureKeyFile(keyPath, binding);
    const capturedSecrets = SECRET_NAMES.flatMap(name => { const entry = current.document.record.entries[name]; return entry === undefined ? [] : [entry.value]; });
    const copies: CredentialInitializationCopyInspection = { capturedSecrets,
      capturedSecretsComplete: SECRET_NAMES.every(name => current.document.record.entries[name] !== undefined), containsKey, keyScanOverlap: 4095,
      inspectEncrypted: path => {
        const copy = readPrivateDocument(path);
        if (copy === undefined) throw new Error("credential-copy-required");
        const observed = inspectAuthenticatedCredentialPayload(copy.document, capturedSecrets);
        return { ...observed, containsCaptured: observed.containsCaptured || containsKey(copy.document) };
      } };
    const inventory = options.repairInventory?.(request, writer, copies);
    if (inventory === undefined) throw new Error("credential-repair-inventory-required");
    let result: { value: T } | undefined, primary: { error: unknown } | undefined;
    try {
      inventory.revalidate();
      assertCredentialErasureHeadFiles(journalPath, head); assertCredentialKeyWitness(keyPath, key, binding);
      const observed = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
      if (observed === undefined || observed.identity.device !== current.identity.device || observed.identity.inode !== current.identity.inode
        || !sameBytes(observed.bytes, current.bytes)) throw new Error("credential-repair-source-changed");
      result = { value: work() };
    } catch (error) { primary = { error }; }
    const owners = { admission: { admission: options.admission, inventory } };
    if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([primary.error], owners);
    try { inventory.dispose(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], owners); }
    if (primary !== undefined) throw primary.error;
    if (result === undefined) throw new Error('credential-repair-result-unproved');
    return result.value;
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
      setValueIds: pending.setValueIds,
      receipt: { ...lastApplied(pending.receipt), updatedAt: pending.receipt.updatedAt, expectedRevision: document.record.revision },
      marked,
    }];
    const latest = history.at(-1);
    if (latest === undefined) throw new Error("credential erasure journal is missing its pending removal");
    const entries = Object.fromEntries(Object.entries(document.record.entries).filter(([, entry]) => !erased.has(entry.valueId)));
    return authenticateDocument({
      schemaVersion: 4,
      historyBaseRevision: document.historyBaseRevision, retiredLegacy: document.retiredLegacy,
      latestRequest: { kind: "erase", request: { ...lastApplied(pending.receipt), updatedAt: pending.receipt.updatedAt },
        repairedExpectedRevision: latest.receipt.expectedRevision },
      record: {
        ...document.record,
        entries,
        revision: document.historyBaseRevision + history.length,
        lastApplied: lastApplied(latest.receipt),
      },
      history,
    });
  }

  function readCurrentUnderLock(): CurrentDocument {
    readKey();
    assertDirectory();
    const current = readPrivateDocument(protectedPath);
    if (current !== undefined) return current;
    throw new Error("credential-established-document-required");
  }

  function observeCurrent(): CurrentDocument {
    readKey();
    const missing = (): never => { throw new Error("credential-established-document-required"); };
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
    return document.latestRequest?.kind === "apply" && privateEqual(document.latestRequest.request, request) ? "exact" : "divergent";
  }

  function historyReusesIdentity(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput | CredentialEraseInput,
  ): boolean {
    return document.retiredLegacy.commandIds.includes(request.commandId) || document.retiredLegacy.writeIds.includes(request.writeId) || document.history.some(({ receipt }) => (
      receipt.commandId === request.commandId || receipt.writeId === request.writeId
    ));
  }

  function buildNext(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): CredentialDocument {
    if (!Number.isSafeInteger(document.record.revision + 1)) throw new Error("credential-revision-overflow");
    const entries = new Map<string, unknown>(Object.entries(document.record.entries));
    const setValueIds: Record<string, string> = {};
    const allocated = new Set([
      ...Object.values(document.record.entries).map(({ valueId }) => valueId),
      ...document.history.flatMap(({ setValueIds: ids }) => Object.values(ids)),
      ...document.retiredLegacy.valueIds, ...loadJournal(document).erasedValueIds,
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
      schemaVersion: 4,
      historyBaseRevision: document.historyBaseRevision, retiredLegacy: document.retiredLegacy,
      latestRequest: { kind: "apply", request },
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
        const journal = loadJournal(current.document);
        if (needsTombstoneRepair(current.document, journal)) withRepairInventory(current, journal, writer, () => {
          const repaired = repairTombstones(current.document, journal);
          if (repaired === undefined) throw new Error("credential-repair-state-changed");
          writeDocument(repaired, current.bytes, false, writer);
          current = readCurrentUnderLock();
        });
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
        const journal = loadJournal(current.document);
        if (!needsTombstoneRepair(current.document, journal)) return { committed: false, result: current.document.record };
        return withRepairInventory(current, journal, writer, () => {
          const repaired = repairTombstones(current.document, journal);
          if (repaired === undefined) throw new Error("credential-repair-state-changed");
          writeDocument(repaired, current.bytes, false, writer);
          return { committed: true, result: repaired.record };
        });
      });
    },
    ownsCommandId(commandId: string): boolean {
      admission.assertLive();
      const id = z.uuid().parse(commandId);
      return observeCurrent().document.history.some(({ receipt }) => receipt.commandId === id);
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
          const anchor = journalAdmission !== admission && journal.epoch > 0 ? readPrivateFile(`${journalPath}.authority`, { label: "erasure journal", maxBytes: 64_000 }) : undefined;
          const authority = anchor === undefined ? undefined : ErasureAuthoritySchema.parse(parseCredentialJson(anchor.bytes));
          const journalInfo = journal.epoch > 0 ? lstatSync(journalPath) : undefined;
          const repairAnchor = authority !== undefined && journalInfo !== undefined
            && (authority.epoch !== journal.epoch || authority.device !== journalInfo.dev || authority.inode !== journalInfo.ino);
          if (repairAnchor || needsTombstoneRepair(current.document, journal)) withRepairInventory(current, journal, writer, () => {
            if (repairAnchor) writeJournal(journal, writer);
            const repaired = repairTombstones(current.document, journal);
            if (repaired !== undefined) { writeDocument(repaired, current.bytes, false, writer); current = readCurrentUnderLock(); }
          });
          if (journal.retiredCommandIds.includes(request.commandId)) return { committed: false, result: divergent() };
          const receipt = requestReceipt(request);
          const latest = current.document.history.at(-1);
          if (latest?.receipt.commandId === request.commandId) {
            if (current.document.latestRequest?.kind === "erase" && privateEqual(current.document.latestRequest.request, request)) admission.settleCredentialErasure(erasureRequestIdentity(request), issueErasureHead(journal.epoch));
            return {
              committed: false,
              result: current.document.latestRequest?.kind === "erase" && privateEqual(current.document.latestRequest.request, request)
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
          const pending = ErasureHistoryEntrySchema.parse({
            receipt: { ...lastApplied(request), updatedAt: request.updatedAt, requestReceipt: receipt },
            marked,
            setValueIds: {},
          });
          const nextJournal = ErasureJournalSchema.parse({
            schemaVersion: 1, epoch: journal.epoch + 1, erasedValueIds, retiredCommandIds, pending,
          });
          const next = authenticateDocument({
            schemaVersion: 4,
            historyBaseRevision: current.document.historyBaseRevision, retiredLegacy: current.document.retiredLegacy,
            latestRequest: { kind: "erase", request },
            record: {
              schemaVersion: 1,
              revision: current.document.record.revision + 1,
              protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
              entries,
              lastApplied: lastApplied(request),
            },
            history: [...current.document.history, { marked: pending.marked, setValueIds: pending.setValueIds, receipt: { ...lastApplied(pending.receipt), updatedAt: pending.receipt.updatedAt } }],
          });
          if (journalAdmission !== admission) {
            const intent = Object.freeze({ epoch: nextJournal.epoch });
            erasureIntents.set(intent, deepFreeze({ stateRoot, journalPath, binding: binding, prior: observeErasureHead(journalPath, journal.epoch),
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
    migrateHistory(input: Parameters<CredentialStore["migrateHistory"]>[0]): void {
      assertWritableStateRoot();
      let operation = journalAdmission.assertProfileCredentialInitialization(admission, SignUpOperationSchema.parse(input.operation));
      let initialization = CredentialInitializationSchema.parse(operation.credentialInitialization);
      const replacement = input.replacement === undefined ? undefined : CompleteProtectedSettingsPatchSchema.parse(input.replacement);
      if (initialization.mode === "replace-v3" && replacement === undefined) throw new Error("credential-complete-replacement-required");
      initializationRecovery = { operation, ...(replacement === undefined ? {} : { replacement }) };
      let publicationStarted = false;
      let publicationInventory: Readonly<{ revalidate(operation: SignUpOperation): () => void; revalidateBeforeKeyIntent(): void }> | undefined;
      try { withLock(writer => {
        const originalFile = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
        const original: unknown = originalFile === undefined ? undefined : parseCredentialJson(originalFile.bytes);
        let capturedSecrets: string[] = [], capturedSecretsComplete = initialization.mode === "initial";
        if (initialization.mode === "proven-v2" && CredentialDocumentV2Schema.safeParse(original).success) {
          convertVersionTwoDocument(original);
          const legacy = CredentialDocumentV2Schema.parse(original);
          capturedSecrets = legacy.history.flatMap(entry => Object.values(entry.request.entries).flatMap(choice => choice !== undefined && "set" in choice ? credentialValueStrings(choice.set) : []));
          capturedSecretsComplete = true;
        } else if (CredentialEnvelopeSchema.safeParse(original).success) {
          const current = readPrivateDocument(protectedPath);
          if (current === undefined) throw new Error("credential-initialization-document-required");
          capturedSecrets = Object.values(current.document.record.entries).flatMap(entry => credentialValueStrings(entry.value));
          capturedSecretsComplete = initialization.mode === "initial";
        } else if (initialization.mode === "replace-v3") {
          const legacy = CredentialDocumentV3Schema.parse(original);
          capturedSecrets = Object.values(legacy.record.entries).flatMap(entry => credentialValueStrings(entry.value));
        }
        const inspectEncrypted = (path: string) => {
          const copy = readPrivateDocument(path);
          if (copy === undefined) throw new Error("credential-copy-required");
          const inspected = inspectAuthenticatedCredentialPayload(copy.document, capturedSecrets);
          return { ...inspected, containsCaptured: inspected.containsCaptured || containsKey(copy.document) };
        };
        const inventory = options.initializationInventory?.(operation, writer, { capturedSecrets, capturedSecretsComplete, inspectEncrypted, containsKey, keyScanOverlap: 4095 });
        if (inventory === undefined) throw new Error("credential-initialization-inventory-required");
        publicationInventory = inventory;
        const pendingStage = journalAdmission.readProfileCredentialKeyStage(admission, operation);
        if (pendingStage !== undefined) {
          const witness = Object.freeze({ operationId: operation.operationId });
          const revalidateMembership = inventory.revalidate(operation);
          const stageHead = observeErasureHead(journalPath, loadJournal().epoch);
          committedKeyStages.set(witness, { capture: pendingStage, revalidate: () => {
            journalAdmission.assertProfileCredentialKeyStageOwner(admission, pendingStage.operation);
            revalidateMembership();
            assertCredentialErasureHeadFiles(journalPath, stageHead);
            const currentSource = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
            if (originalFile === undefined ? currentSource !== undefined : currentSource === undefined || !sameBytes(currentSource.bytes, originalFile.bytes)
              || currentSource.identity.device !== originalFile.identity.device || currentSource.identity.inode !== originalFile.identity.inode) throw new Error("credential-initialization-source-changed");
          } });
          journalAdmission.publishProfileCredentialKeyStage(admission, pendingStage.operation, witness);
          operation = pendingStage.operation;
          initialization = CredentialInitializationSchema.parse(operation.credentialInitialization);
        }
        const head = observeErasureHead(journalPath, loadJournal().epoch);
        const inventoryProof = Object.freeze({ operationId: operation.operationId });
        initializationInventoryProofs.set(inventoryProof, { admission, operationId: operation.operationId, keyId: initialization.keyId,
          revalidate: inventory.revalidate.bind(inventory), head, journalPath });
        assertInitializationInventoryProof(inventoryProof, admission, operation);
        operation = journalAdmission.assertProfileCredentialInitialization(admission, operation);
        const source = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
        const decoded: unknown = source === undefined ? undefined : parseCredentialJson(source.bytes);
        const existingKey = readPrivateFile(keyPath, { label: "lock", maxBytes: 4096 });
        if (existingKey !== undefined) {
          if (readKey().keyId !== initialization.keyId || initialization.keyDocumentDigest === undefined
            || createHash("sha256").update(existingKey.bytes).digest("hex") !== initialization.keyDocumentDigest) throw new Error("credential-initialization-key-mismatch");
          if (initialization.keyFile !== undefined && canonicalJsonStringify(captureKeyFile(keyPath, binding).file) !== canonicalJsonStringify(initialization.keyFile)) throw new Error("credential-key-custody-changed");
        }
        if (CredentialEnvelopeSchema.safeParse(decoded).success) {
          if (existingKey === undefined) throw new Error("credential-key-required");
          const current = readPrivateDocument(protectedPath);
          if (current === undefined) throw new Error("credential-initialization-document-required");
          if (initialization.mode === "replace-v3") {
            const request = ProtectedSettingsApplyInputSchema.parse({ ...lastApplied({ commandId: operation.commandId, writeId: operation.writeId,
              commandFingerprint: operation.commandFingerprint, expectedRevision: initialization.source.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }),
              updatedAt: operation.createdAt, entries: replacement });
            if (exactLastReplay(current.document, request) !== "exact") throw new Error("credential-initialization-replay-divergent");
          }
          operation = { ...operation, credentialInitialization: { ...initialization, phase: "document-published" } };
          if (initialization.phase !== "document-published") journalAdmission.publishProfileOperation(operation);
          assertInitializationInventoryProof(inventoryProof, admission, operation);
          return { committed: false, result: undefined };
        }
        if (initialization.phase === "document-published") throw new Error("credential-established-document-required");
        if (initialization.mode === "initial") {
          if (source !== undefined) throw new Error("credential-initialization-source-unexpected");
        } else {
          if (source === undefined || source.identity.device !== initialization.source.device || source.identity.inode !== initialization.source.inode
            || createHash("sha256").update(source.bytes).digest("hex") !== initialization.source.digest) throw new Error("credential-initialization-source-changed");
        }
        const journal = loadJournal();
        let document: CredentialDocument;
        if (initialization.mode === "initial") document = initialDocument();
        else if (initialization.mode === "proven-v2") document = convertVersionTwoDocument(decoded);
        else {
          const legacy = CredentialDocumentV3Schema.parse(decoded);
          if (legacy.record.revision !== initialization.source.revision || !Number.isSafeInteger(legacy.record.revision + 1)) throw new Error("credential-initialization-revision-invalid");
          const retiredLegacy = { commandIds: [...new Set([...legacy.history.map(entry => entry.receipt.commandId), ...(legacy.record.lastApplied === undefined ? [] : [legacy.record.lastApplied.commandId])])],
            writeIds: [...new Set([...legacy.history.map(entry => entry.receipt.writeId), ...(legacy.record.lastApplied === undefined ? [] : [legacy.record.lastApplied.writeId])])],
            valueIds: [...new Set([...legacy.history.flatMap(entry => Object.values(entry.setValueIds)), ...Object.values(legacy.record.entries).map(entry => entry.valueId)])] };
          if (retiredLegacy.commandIds.some(id => id === operation.commandId) || retiredLegacy.writeIds.some(id => id === operation.writeId)) throw new Error("credential-initialization-identity-retired");
          const request = ProtectedSettingsApplyInputSchema.parse({ commandId: operation.commandId, commandFingerprint: operation.commandFingerprint,
            expectedRevision: initialization.source.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: operation.writeId,
            updatedAt: operation.createdAt, entries: replacement });
          const entries: Record<string, unknown> = {}, setValueIds: Record<string, string> = {}, allocated = new Set([...retiredLegacy.valueIds, ...journal.erasedValueIds]);
          for (const name of ProtectedSettingsNameSchema.options) {
            const choice = request.entries[name];
            if (choice === undefined) throw new Error("credential-complete-replacement-required");
            if ("clear" in choice) continue;
            const valueId = z.uuid().parse(ids.randomUUID());
            if (allocated.has(valueId)) throw new Error("credential-value-identity-retired");
            allocated.add(valueId); setValueIds[name] = valueId;
            entries[name] = { valueId, value: choice.set, updatedAt: request.updatedAt };
          }
          document = authenticateDocument({ schemaVersion: 4, historyBaseRevision: initialization.source.revision, retiredLegacy,
            record: { schemaVersion: 1, revision: initialization.source.revision + 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
              entries, lastApplied: lastApplied(request) }, history: [{ receipt: { ...lastApplied(request), updatedAt: request.updatedAt }, marked: markProtectedSettingsPatch(request.entries), setValueIds }],
            latestRequest: { kind: "apply", request } });
        }
        document = repairTombstones(document, journal) ?? document;
        assertInitializationInventoryProof(inventoryProof, admission, operation);
        if (existingKey === undefined) {
          journalAdmission.assertProfileCredentialKey(admission, keyPath);
          const machineDirectory = join(journalAdmission.stateRoot, "machine"), directory = dirname(keyPath);
          ensureChildDirectory(journalAdmission.stateRoot, machineDirectory, "credential machine", 0o700, 0o700);
          ensureChildDirectory(machineDirectory, directory, "credential keys", 0o700, 0o700);
          const stagePath = join(directory, `.credential-key.${operation.operationId}.tmp`);
          if (initialization.keyFile === undefined) {
            if (initialization.keyDocumentDigest !== undefined) throw new Error("credential-initialization-intended-key-missing");
            assertInitializationInventoryProof(inventoryProof, admission, operation);
            const registryBeforeStage = journalAdmission.readProfileRegistry();
            hooks.beforeInitialKey?.();
            const key = CredentialKeyDocumentSchema.parse({ schemaVersion: 1, ...binding, keyId: initialization.keyId, key: randomBytes(32).toString("base64") });
            writePrivateStage(stagePath, encodePrivate(key)); fsyncPath(directory);
            publicationStarted = true;
            const capturedKey = captureKeyFile(stagePath, binding), priorOperation = operation;
            if (capturedKey.file.digest !== createHash("sha256").update(encodePrivate(key)).digest("hex")) throw new Error("credential-key-stage-readback-changed");
            hooks.afterKeyStageBeforeIntent?.();
            initialization = { ...initialization, keyDocumentDigest: capturedKey.file.digest, keyFile: capturedKey.file };
            operation = { ...operation, credentialInitialization: initialization };
            const capture = CredentialKeyStagePublicationSchema.parse({ registry: registryBeforeStage, priorOperation, operation, key: capturedKey });
            const witness = Object.freeze({ operationId: operation.operationId });
            committedKeyStages.set(witness, { capture, afterIntent: hooks.afterKeyStageJournal, revalidate: () => {
              journalAdmission.assertProfileCredentialKeyStageOwner(admission, operation);
              inventory.revalidateBeforeKeyIntent();
              assertCredentialErasureHeadFiles(journalPath, head);
              const currentSource = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
              if (source === undefined ? currentSource !== undefined : currentSource === undefined || !sameBytes(currentSource.bytes, source.bytes)
                || currentSource.identity.device !== source.identity.device || currentSource.identity.inode !== source.identity.inode) throw new Error("credential-initialization-source-changed");
            } });
            publicationStarted = true;
            journalAdmission.publishProfileCredentialKeyStage(admission, operation, witness);
            hooks.afterKeyStageIntent?.();
          }
          assertInitializationInventoryProof(inventoryProof, admission, operation);
          const keyWitness = CredentialKeyWitnessSchema.parse({ keyId: initialization.keyId, binding: binding, file: initialization.keyFile });
          assertCredentialKeyWitness(stagePath, keyWitness, binding);
          if (lstatSync(keyPath, { throwIfNoEntry: false }) !== undefined) throw new Error("credential-key-stage-outcome-uncertain");
          publicationStarted = true;
          renameSync(stagePath, keyPath); fsyncPath(directory);
          assertCredentialKeyWitness(keyPath, keyWitness, binding);
          hooks.afterInitialKey?.();
        }
        initialization = { ...initialization, keyFile: captureKeyFile(keyPath, binding).file };
        operation = { ...operation, credentialInitialization: { ...initialization, phase: "key-published" } };
        journalAdmission.publishProfileOperation(operation);
        hooks.afterInitializationPhase?.("key-published");
        publicationStarted = true;
        writeDocument(document, source?.bytes, true, writer);
        operation = { ...operation, credentialInitialization: { ...initialization, phase: "document-published" } };
        journalAdmission.publishProfileOperation(operation);
        hooks.afterInitializationPhase?.("document-published");
        assertInitializationInventoryProof(inventoryProof, admission, operation);
        return { committed: true, result: undefined };
      });
        if (initialization.mode !== "initial") {
          const currentOperation = journalAdmission.assertProfileCredentialInitialization(admission, operation);
          const file = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
          if (file === undefined) throw new Error("credential-initialization-document-required");
          const capture = CredentialInitializationPublicationSchema.parse({ operation: currentOperation,
            key: captureKeyFile(keyPath, binding), head: observeErasureHead(journalPath, loadJournal().epoch),
            document: { device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") } });
          const witness = Object.freeze({ operationId: operation.operationId });
          const inventory = publicationInventory;
          if (inventory === undefined) throw new Error("credential-initialization-inventory-required");
          const revalidateMembership = inventory.revalidate(currentOperation);
          initializedCredentials.set(witness, { capture, revalidate: () => {
            journalAdmission.assertProfileCredentialKeyStageOwner(admission, currentOperation);
            revalidateMembership();
          } });
          journalAdmission.publishProfileCredentialInitialization(admission, witness);
          hooks.afterCredentialAnchor?.();
        }
      } catch (error) {
        if (publicationStarted && !(error instanceof CredentialStoreCommitUncertainError)) throw new CredentialStoreCommitUncertainError("credential initialization publication needs exact recovery", { cause: error });
        throw error;
      } finally { initializationRecovery = undefined; }
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
    if (journalAdmission !== admission) erasureHeads.set(witness, { stateRoot, journalPath, binding: binding, head: deepFreeze(observeErasureHead(journalPath, epoch)), keyPath, key: captureKeyFile(keyPath, binding) });
    return witness;
  }
  let pendingCapture: Readonly<{ operationId: string; at: string; revision: number; values: readonly string[]; complete: boolean }> | undefined;
  committedStores.set(store, { admission, stateRoot, pendingLogoutInventory: operation => {
    admission.assertCredentialErasureObservation(operation.operationId);
    const purpose = admission.forPendingLogoutInventory(operation);
    try {
      const current = observeCurrent(), journal = loadJournal(current.document, "settlement");
      const head = observeErasureHead(journalPath, journal.epoch), key = captureKeyFile(keyPath, binding);
      if ([operation.commandId, operation.writeId, operation.expectedRevision].some(value => value === undefined)
        && [operation.commandId, operation.writeId, operation.expectedRevision].some(value => value !== undefined)) throw new Error("profile-pending-logout-request-refused");
      const request = operation.commandId === undefined && operation.writeId === undefined && operation.expectedRevision === undefined ? undefined
        : erasureRequestIdentity(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
          expectedRevision: operation.expectedRevision, updatedAt: operation.at, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }));
      purpose.assertPendingLogoutErasureHead(admission, operation, head, request);
      const entries = current.document.record.entries;
      let capturedSecrets = SECRET_NAMES.flatMap(name => { const entry = entries[name]; return entry === undefined ? [] : [entry.value]; });
      let capturedSecretsComplete = SECRET_NAMES.every(name => entries[name] !== undefined);
      const previous = pendingCapture, latest = current.document.latestRequest;
      if (previous !== undefined && previous.operationId === operation.operationId && previous.at === operation.at
        && latest?.kind === "erase" && latest.request.commandId === operation.commandId && latest.request.writeId === operation.writeId
        && latest.request.expectedRevision === operation.expectedRevision && latest.request.updatedAt === operation.at
        && previous.revision === operation.expectedRevision) {
        capturedSecrets = [...previous.values]; capturedSecretsComplete = previous.complete;
      } else if (capturedSecrets.length > 0) {
        pendingCapture = { operationId: operation.operationId, at: operation.at, revision: current.document.record.revision,
          values: capturedSecrets, complete: capturedSecretsComplete };
      }
      const assertCurrentInventory = () => {
        purpose.assertPendingLogoutErasureHead(admission, operation, head, request);
        assertCredentialErasureHeadFiles(journalPath, head); assertCredentialKeyWitness(keyPath, key, binding);
        const after = observeCurrent(); loadJournal(after.document, "settlement");
        if (!sameBytes(after.bytes, current.bytes) || after.identity.device !== current.identity.device || after.identity.inode !== current.identity.inode) {
          throw new Error("credential-pending-logout-source-changed");
        }
      };
      const inventory = options.pendingLogoutInventory?.(purpose, operation, { capturedSecrets, capturedSecretsComplete,
        entriesAbsent: entries.ucpathUserId === undefined && entries.ucpathPassword === undefined, containsKey, keyScanOverlap: 4095,
        inspectEncrypted: path => {
          assertCurrentInventory(); purpose.assertStateRoot(path);
          const copy = readPrivateDocument(path);
          if (copy === undefined) throw new Error("credential-copy-required");
          const inspected = inspectAuthenticatedCredentialPayload(copy.document, capturedSecrets);
          assertCurrentInventory();
          return { ...inspected, containsCaptured: inspected.containsCaptured || containsKey(copy.document) };
        } });
      if (inventory === undefined) throw new Error("credential-pending-logout-inventory-required");
      assertCurrentInventory(); inventory.revalidate(); assertCurrentInventory();
      if (inventory.assessment.logoutComplete) pendingCapture = undefined;
      return Object.freeze({ assessment: inventory.assessment, revalidate: () => {
        assertCurrentInventory(); inventory.revalidate(); assertCurrentInventory();
      }, dispose: () => purpose.release() });
    } catch (error) {
      let cleanupFailure: { error: unknown } | undefined;
      try { purpose.release(); }
      catch (cleanup) { cleanupFailure = { error: cleanup }; }
      if (cleanupFailure !== undefined) throw new AggregateError([error, cleanupFailure.error], "credential-pending-logout-inventory-release-failed", { cause: error });
      throw error;
    }
  }, presence: () => {
    admission.assertCredentialRead();
    const current = observeCurrent(), journal = loadJournal(current.document);
    const head = observeErasureHead(journalPath, journal.epoch), key = captureKeyFile(keyPath, binding);
    if (needsTombstoneRepair(current.document, journal)) throw new Error("credential-presence-repair-required");
    const entries = Object.freeze(ProtectedSettingsNameSchema.options.map(name => Object.freeze({ name, present: current.document.record.entries[name] !== undefined })));
    hooks.betweenPresenceObservations?.();
    const after = observeCurrent(), afterJournal = loadJournal(after.document);
    if (needsTombstoneRepair(after.document, afterJournal)) throw new Error("credential-presence-repair-required");
    assertCredentialErasureHeadFiles(journalPath, head);
    assertCredentialKeyWitness(keyPath, key, binding);
    admission.assertCredentialRead();
    if (!sameBytes(current.bytes, after.bytes) || current.identity.device !== after.identity.device || current.identity.inode !== after.identity.inode) throw new Error("credential-presence-source-changed");
    return entries;
  }, journalAdmission, journalPath, keyPath, containsKey, inspectCopy: (path, capturedSecrets) => {
    admission.assertStateRoot(path);
    const copy = readPrivateDocument(path);
    if (copy === undefined) throw new Error("credential-copy-required");
    const inspected = inspectAuthenticatedCredentialPayload(copy.document, capturedSecrets);
    return { ...inspected, containsCaptured: inspected.containsCaptured || containsKey(copy.document) };
  }, migrationSource: () => {
    const file = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: MAX_CREDENTIAL_ENVELOPE_BYTES });
    if (file === undefined) return { state: "absent" };
    const decoded: unknown = parseCredentialJson(file.bytes);
    if (CredentialEnvelopeSchema.safeParse(decoded).success) { readPrivateDocument(protectedPath); return { state: "current" }; }
    const legacy = z.union([CredentialDocumentV2Schema, CredentialDocumentV3Schema]).parse(decoded);
    if (!Number.isSafeInteger(legacy.record.revision + 1)) throw new Error("credential-migration-revision-invalid");
    return { state: "legacy", schemaVersion: legacy.schemaVersion, revision: legacy.record.revision,
      device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") };
  }, captureErasureHead: () => {
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
