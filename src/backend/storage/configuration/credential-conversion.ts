import { CredentialMaintenanceHold, inspectStoppedCanonicalConversionCopy, inspectStoppedCanonicalConversion, prepareStoppedCanonicalCredentials, type CanonicalCredentialConversionPlan } from "./canonical-credential-store.js";
import { z } from "zod";
import { DuoCredentialFileSchema } from "../../../models/config/duo-credential.js";
import { DuoEnrollmentScopeSchema } from "../../../models/config/duo-credential-store.js";
import { createDecipheriv, createHash } from "node:crypto";
import { join } from "node:path";
import { readPrivateFile } from "./credential-safe-file.js";
import { credentialKeyCustody, CredentialKeyCustodyError } from "./credential-key-custody.js";
import { authenticateDocument, CredentialDocumentSchema, type CredentialDocument } from "./credential-store.js";
import { ChatGptCredentialRecordSchema } from "./chatgpt-credential-repository.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { encodePrivate } from "../../../rules/validation/private-equal.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { StoppedControlProfileInventory } from "../admission/installation.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../source-closure.js";

const RevisionSchema = z.number().int().safe().positive();
const CountSchema = z.number().int().min(0).max(0xffff_ffff);
const Base64Schema = z.string().min(4).max(16_384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const CredentialIdSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/u);
const TimestampSchema = z.iso.datetime();

const CredentialFields = {
  credentialId: CredentialIdSchema, scope: DuoEnrollmentScopeSchema,
  privateKeyPkcs8: Base64Schema, publicKeySpki: Base64Schema,
  createdAt: TimestampSchema, highWater: CountSchema,
  authenticator: z.strictObject({ userHandle: z.string().optional(), transport: z.enum(["internal", "usb"]), isResidentCredential: z.boolean() }).optional(),
};
export const StoppedDuoStoredCredentialSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), ...CredentialFields }),
  z.strictObject({ state: z.literal("ready"), ...CredentialFields, confirmedAt: TimestampSchema }),
]);
export type StoppedDuoStoredCredential = z.infer<typeof StoppedDuoStoredCredentialSchema>;

export const StoppedDuoSignReservationSchema = z.strictObject({
  attemptId: z.uuid(), credentialId: CredentialIdSchema, count: CountSchema,
  reservedAt: TimestampSchema,
});
export type StoppedDuoSignReservation = z.infer<typeof StoppedDuoSignReservationSchema>;

export const StoppedDuoCredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), installationId: z.uuid(), profileId: z.uuid(), revision: RevisionSchema,
  credentials: z.array(StoppedDuoStoredCredentialSchema).max(1000),
  retired: z.array(z.strictObject({ credentialId: CredentialIdSchema, highWater: CountSchema })).max(100_000),
  reservations: z.array(StoppedDuoSignReservationSchema).max(100_000),
}).superRefine((value, context) => {
  const ids = [...value.credentials, ...value.retired].map(row => row.credentialId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duo-credential-membership-invalid" });
  if (new Set(value.reservations.map(row => row.attemptId)).size !== value.reservations.length) context.addIssue({ code: "custom", message: "duo-attempt-reused" });
  const counts = new Set<string>();
  const previous = new Map<string, number>();
  for (const reservation of value.reservations) {
    const owner = [...value.credentials, ...value.retired].find(row => row.credentialId === reservation.credentialId);
    const key = `${reservation.credentialId}:${String(reservation.count)}`;
    if (owner === undefined || reservation.count === 0 || reservation.count > owner.highWater || counts.has(key)
      || reservation.count <= (previous.get(reservation.credentialId) ?? 0)) context.addIssue({ code: "custom", message: "duo-reservation-lineage-invalid" });
    counts.add(key); previous.set(reservation.credentialId, reservation.count);
  }
  for (const owner of [...value.credentials, ...value.retired]) {
    if (owner.highWater !== (previous.get(owner.credentialId) ?? 0)) context.addIssue({ code: "custom", message: "duo-reservation-head-mismatch" });
  }
  for (const credential of value.credentials) {
    if (Date.parse(credential.createdAt) < Date.parse(credential.scope.armedAt)
      || Date.parse(credential.createdAt) >= Date.parse(credential.scope.expiresAt)
      || credential.state === "pending" && credential.highWater !== 0
      || credential.state === "ready" && (Date.parse(credential.confirmedAt) < Date.parse(credential.createdAt)
        || Date.parse(credential.confirmedAt) >= Date.parse(credential.scope.expiresAt))) context.addIssue({ code: "custom", message: "duo-credential-event-order-invalid" });
  }
});
export type StoppedDuoCredentialDocument = z.infer<typeof StoppedDuoCredentialDocumentSchema>;

const PhysicalWitnessSchema = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: z.string().regex(/^[0-9a-f]{64}$/u) });
export const StoppedDuoContinuityRowSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-initialized"), profileId: z.uuid(), revision: z.literal(0) }),
  z.strictObject({ state: z.literal("registered"), profileId: z.uuid(), revision: RevisionSchema, document: PhysicalWitnessSchema }),
  z.strictObject({ state: z.literal("erased"), profileId: z.uuid(), revision: RevisionSchema, document: PhysicalWitnessSchema }),
]);
export type StoppedDuoContinuityRow = z.infer<typeof StoppedDuoContinuityRowSchema>;
export const StoppedDuoDocumentEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1), purpose: z.literal("relay:duo-credential:v1"), algorithm: z.literal("aes-256-gcm"),
  installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(), revision: RevisionSchema,
  nonce: z.string().length(16).regex(/^[A-Za-z0-9+/]{16}$/u),
  tag: z.string().length(24).regex(/^[A-Za-z0-9+/]{22}==$/u), ciphertext: z.string().min(4).max(Math.ceil(16 * 1024 * 1024 / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});

export function stoppedDuoConversionRecord(binding: Readonly<{ installationId: string; profileId: string }>,
  input: StoppedDuoContinuityRow, source: unknown) {
  const row = StoppedDuoContinuityRowSchema.parse(input);
  if (row.profileId !== binding.profileId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  if (row.state === "never-initialized") {
    if (source !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    return { record: { revision: 0, value: null }, retired: [] as string[] };
  }
  const document = StoppedDuoCredentialDocumentSchema.parse(source);
  if (document.installationId !== binding.installationId || document.profileId !== binding.profileId || document.revision !== row.revision
    || row.state === "erased" && document.credentials.length !== 0) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  // Predecessor session signers did not durably close their maximum counter.
  if (document.credentials.length !== 0) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_COUNTER_UNPROVED");
  return { record: { revision: document.revision, value: { credentials: [] } }, retired: document.retired.map(credential => credential.credentialId) };
}

export const StoppedCredentialKeyWitnessSchema = z.strictObject({ keyId: z.uuid(),
  binding: z.strictObject({ installationId: z.uuid(), profileId: z.uuid() }), file: PhysicalWitnessSchema });
export const StoppedCredentialErasureHeadSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-erased"), epoch: z.literal(0) }),
  z.strictObject({ state: z.literal("established"), epoch: z.number().int().positive(), journal: PhysicalWitnessSchema, anchor: PhysicalWitnessSchema }),
]);

const StoppedKeyIdentity = z.strictObject({ installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid() });
const StoppedInlineKey = StoppedKeyIdentity.extend({ schemaVersion: z.literal(1), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u) });
const StoppedNativeKey = StoppedKeyIdentity.extend({ schemaVersion: z.literal(2), keyDigest: z.string().regex(/^[a-f0-9]{64}$/u), legacyWitness: z.literal(true).optional() });
const ProtectedEnvelope = z.strictObject({ schemaVersion: z.literal(4), algorithm: z.literal("aes-256-gcm"),
  installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(), nonce: z.string().length(16), tag: z.string().length(24),
  ciphertext: z.string().min(4).max(Math.ceil(16 * 1024 * 1024 / 3) * 4) });
const StoppedErasureJournal = z.strictObject({ schemaVersion: z.literal(1), epoch: z.number().int().safe().nonnegative(),
  erasedValueIds: z.array(z.uuid()), retiredCommandIds: z.array(z.uuid()), pending: z.unknown().optional() });
const StoppedErasureAnchor = z.strictObject({ schemaVersion: z.literal(1), epoch: z.number().int().safe().nonnegative(),
  device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
const maxSourceBytes = Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096;
const sourceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const decodeSource = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as unknown;

function sourceFile(path: string, expected?: z.infer<typeof PhysicalWitnessSchema>, limit = maxSourceBytes) {
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: limit });
  if (file === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  const witness = { ...file.identity, digest: sourceHash(file.bytes) };
  if (expected !== undefined && canonicalJsonStringify(witness) !== canonicalJsonStringify(expected)) throw new Error("profile-control-upgrade-credential-source-changed");
  return { ...file, witness };
}

function decryptSource(metadata: Readonly<{ nonce: string; tag: string; ciphertext: string }>, key: Buffer, aad: Buffer): unknown {
  const nonce = Buffer.from(metadata.nonce, "base64"), tag = Buffer.from(metadata.tag, "base64"), ciphertext = Buffer.from(metadata.ciphertext, "base64");
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > 16 * 1024 * 1024
    || nonce.toString("base64") !== metadata.nonce || tag.toString("base64") !== metadata.tag
    || ciphertext.toString("base64") !== metadata.ciphertext) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad); decipher.setAuthTag(tag);
  return decodeSource(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function inspectStoppedCredentialSource(admission: RuntimeAdmission, claim: StoppedControlProfileInventory) {
  const source = admission.readStoppedControlCredentialInventorySource(claim);
  try {
    source.assertHeld();
    const legacyDuo = readPrivateFile(join(source.stateRoot, "credentials", "duo-webauthn.json"), { label: "protected.json", maxBytes: 64_000 });
    if (legacyDuo !== undefined) {
      DuoCredentialFileSchema.parse(decodeSource(legacyDuo.bytes));
      throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_COUNTER_UNPROVED");
    }
    const keyPath = join(source.machineRoot, "machine", "credential-keys", `${claim.profileId}.json`),
      journalPath = join(source.machineRoot, "machine", "erasures", `${claim.profileId}.json`);
    const keyFile = sourceFile(keyPath, undefined, 4096), raw = decodeSource(keyFile.bytes);
    const inline = StoppedInlineKey.safeParse(raw), metadata = StoppedNativeKey.safeParse(raw);
    const identity = inline.success ? inline.data : metadata.success ? metadata.data : undefined;
    if (identity === undefined || identity.installationId !== source.binding.installationId || identity.profileId !== source.binding.profileId
      || identity.keyId !== source.key.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const keyDocument = inline.success ? inline.data : metadata.success ? credentialKeyCustody.read({ schemaVersion: 2,
      installationId: metadata.data.installationId, profileId: metadata.data.profileId, keyId: metadata.data.keyId, keyDigest: metadata.data.keyDigest }) : undefined;
    if (keyDocument === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const key = Buffer.from(keyDocument.key, "base64");
    if (key.length !== 32 || key.toString("base64") !== keyDocument.key) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    if (inline.success) {
      try { credentialKeyCustody.read({ schemaVersion: 2, ...source.binding, keyId: identity.keyId, keyDigest: sourceHash(key) }); }
      catch (error) { if (!(error instanceof CredentialKeyCustodyError) || error.code !== "CREDENTIAL_KEYCHAIN_MISSING") throw error; }
    }
    const witnessedDigest = metadata.success && metadata.data.legacyWitness === true ? sourceHash(encodePrivate(keyDocument)) : sourceHash(keyFile.bytes);
    if (keyFile.identity.device !== source.key.file.device || keyFile.identity.inode !== source.key.file.inode
      || witnessedDigest !== source.key.file.digest) throw new Error("profile-control-upgrade-credential-source-changed");
    let erased: string[] = [], retired: string[] = [];
    if (source.head.state === "never-erased") {
      if (readPrivateFile(journalPath, { label: "lock", maxBytes: 64_000 }) !== undefined
        || readPrivateFile(`${journalPath}.authority`, { label: "lock", maxBytes: 4096 }) !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    } else {
      const journalFile = sourceFile(journalPath, source.head.journal, 64_000), anchorFile = sourceFile(`${journalPath}.authority`, source.head.anchor, 4096);
      const journal = StoppedErasureJournal.parse(decodeSource(journalFile.bytes)), anchor = StoppedErasureAnchor.parse(decodeSource(anchorFile.bytes));
      if (journal.epoch !== source.head.epoch || anchor.epoch !== journal.epoch || anchor.device !== journalFile.identity.device
        || anchor.inode !== journalFile.identity.inode || journal.pending !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
      erased = journal.erasedValueIds; retired = journal.retiredCommandIds;
    }
    const protectedFile = sourceFile(join(source.stateRoot, "credentials", "protected.json")), envelope = ProtectedEnvelope.parse(decodeSource(protectedFile.bytes));
    if (envelope.installationId !== source.binding.installationId || envelope.profileId !== source.binding.profileId || envelope.keyId !== identity.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const parsed = CredentialDocumentSchema.parse(decryptSource(envelope, key, Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4,
      algorithm: "aes-256-gcm", ...source.binding, keyId: identity.keyId }))));
    const document = authenticateDocument({ ...parsed, retiredLegacy: { ...parsed.retiredLegacy,
      commandIds: [...new Set([...parsed.retiredLegacy.commandIds, ...retired])], valueIds: [...new Set([...parsed.retiredLegacy.valueIds, ...erased])] } });
    const duoRow = source.duo, duoPath = join(source.machineRoot, "machine", "duo-credentials", `${claim.profileId}.json`);
    const duoFile = readPrivateFile(duoPath, { label: "protected.json", maxBytes: maxSourceBytes });
    let duoDocument: unknown;
    if (duoRow.state !== "never-initialized") {
      if (duoFile === undefined || canonicalJsonStringify({ ...duoFile.identity, digest: sourceHash(duoFile.bytes) }) !== canonicalJsonStringify(duoRow.document)) throw new Error("duo-document-custody-changed");
      const sealed = StoppedDuoDocumentEnvelopeSchema.parse(decodeSource(duoFile.bytes));
      if (sealed.installationId !== source.binding.installationId || sealed.profileId !== source.binding.profileId || sealed.keyId !== identity.keyId
        || sealed.revision !== duoRow.revision) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
      const { tag: _tag, ciphertext: _ciphertext, ...aad } = sealed;
      duoDocument = decryptSource(sealed, key, Buffer.from(canonicalJsonStringify(aad)));
    } else if (duoFile !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const duo = stoppedDuoConversionRecord(source.binding, duoRow, duoDocument);
    const chatgptFile = readPrivateFile(join(source.stateRoot, "credentials", "chatgpt-account.json"), { label: "protected.json", maxBytes: 64_000 });
    const chatgpt = chatgptFile === undefined ? undefined : ChatGptCredentialRecordSchema.parse(decodeSource(chatgptFile.bytes));
    const copies = copyInspection(source, document, chatgpt, keyDocument, bytes => {
      const sealed = ProtectedEnvelope.parse(decodeSource(bytes));
      if (sealed.installationId !== source.binding.installationId || sealed.profileId !== source.binding.profileId || sealed.keyId !== identity.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
      return authenticateDocument(decryptSource(sealed, key, Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4,
        algorithm: "aes-256-gcm", ...source.binding, keyId: identity.keyId }))));
    });
    source.assertHeld();
    return { records: { protected: { revision: document.record.revision, value: document }, duo: duo.record,
      chatgpt: chatgpt === undefined ? { revision: 0, value: null } : { revision: chatgpt.revision, value: chatgpt } }, retired: duo.retired,
      copies };
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

function copyInspection(source: ReturnType<RuntimeAdmission["readStoppedControlCredentialInventorySource"]>,
  document: CredentialDocument, chatgpt: z.infer<typeof ChatGptCredentialRecordSchema> | undefined,
  keyDocument: ReturnType<typeof credentialKeyCustody.read>, decryptProtected: (bytes: Buffer) => CredentialDocument) {
  const capturedSecrets = [document.record.entries.ucpathUserId?.value, document.record.entries.ucpathPassword?.value,
    chatgpt?.session?.accessToken, chatgpt?.session?.refreshToken, chatgpt?.session?.idToken].filter((value): value is string => typeof value === "string");
  const little = Buffer.from(keyDocument.key, "utf16le"), patterns = [Buffer.from(keyDocument.key, "base64"), Buffer.from(keyDocument.key), little, Buffer.from(little).swap16(), Buffer.from(encodePrivate(keyDocument))];
  const containsKey = (value: unknown): boolean => value instanceof Uint8Array ? patterns.some(pattern => Buffer.from(value).includes(pattern))
    : typeof value === "string" ? containsKey(Buffer.from(value)) : Array.isArray(value) ? value.some(containsKey)
      : value !== null && typeof value === "object" && Object.entries(value).some(([name, entry]) => containsKey(name) || containsKey(entry));
  return { capturedSecrets, capturedSecretsComplete: document.record.entries.ucpathUserId !== undefined && document.record.entries.ucpathPassword !== undefined,
    containsKey, keyScanOverlap: 4095, inspectEncrypted(path: string) {
      source.assertHeld(); const copy = decryptProtected(sourceFile(path).bytes), text = canonicalJsonStringify(copy);
      source.assertHeld();
      return { containsUcsd: copy.record.entries.ucpathUserId !== undefined || copy.record.entries.ucpathPassword !== undefined
        || copy.latestRequest?.kind === "apply" && (copy.latestRequest.request.entries.ucpathUserId !== undefined || copy.latestRequest.request.entries.ucpathPassword !== undefined),
      containsCaptured: capturedSecrets.some(value => text.includes(value)) || containsKey(copy) };
    } };
}

function inspectResumedCredentialSource(admission: RuntimeAdmission, claim: StoppedControlProfileInventory, plan: CanonicalCredentialConversionPlan) {
  const source = admission.readStoppedControlCredentialInventorySource(claim), records = inspectStoppedCanonicalConversion(admission, claim, plan);
  const document = authenticateDocument(records.protected.value), chatgpt = records.chatgpt.value === null ? undefined : ChatGptCredentialRecordSchema.parse(records.chatgpt.value);
  const paths = join(source.machineRoot, "machine", "credential-keys", `${claim.profileId}.json`), file = sourceFile(paths), inline = StoppedInlineKey.safeParse(decodeSource(file.bytes));
  const metadata = plan.operation.head.key;
  if (metadata.installationId !== source.binding.installationId || metadata.profileId !== source.binding.profileId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  const keyDocument = inline.success ? inline.data : credentialKeyCustody.read(metadata), key = Buffer.from(keyDocument.key, "base64");
  if (keyDocument.installationId !== source.binding.installationId || keyDocument.profileId !== source.binding.profileId
    || keyDocument.keyId !== metadata.keyId || sourceHash(key) !== metadata.keyDigest) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  return { records, retired: plan.operation.head.retired, copies: copyInspection(source, document, chatgpt, keyDocument, bytes => {
    const value = decodeSource(bytes);
    if (ProtectedEnvelope.safeParse(value).success) {
      const sealed = ProtectedEnvelope.parse(value);
      if (sealed.installationId !== source.binding.installationId || sealed.profileId !== source.binding.profileId || sealed.keyId !== metadata.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
      return authenticateDocument(decryptSource(sealed, key, Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4,
        algorithm: "aes-256-gcm", ...source.binding, keyId: metadata.keyId }))));
    }
    const record = inspectStoppedCanonicalConversionCopy(admission, claim, plan, "protected", bytes);
    if (record === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    return authenticateDocument(record.value);
  }) };
}

export type StoppedCredentialCopyInspection = ReturnType<typeof inspectStoppedCredentialSource>["copies"];
export interface StoppedControlCredentialAttestation { readonly profileId: string }
const conversionInventories = new WeakMap<StoppedControlCredentialAttestation, Readonly<{
  claim: StoppedControlProfileInventory; admission: RuntimeAdmission; plan: CanonicalCredentialConversionPlan;
  revalidate(): void;
}>>();

export function prepareStoppedCredentialConversion(admission: RuntimeAdmission, claim: StoppedControlProfileInventory,
  assess: (copies: StoppedCredentialCopyInspection) => Readonly<{ revalidate(): () => void; revalidateBeforeKeyIntent(): void }>): StoppedControlCredentialAttestation {
  const source = admission.readStoppedControlCredentialInventorySource(claim);
  try {
    const pending = source.pendingPlan();
    const captured = pending === undefined ? inspectStoppedCredentialSource(admission, claim) : inspectResumedCredentialSource(admission, claim, pending);
    const inventory = assess(captured.copies);
    inventory.revalidateBeforeKeyIntent(); inventory.revalidate()();
    const plan = pending ?? prepareStoppedCanonicalCredentials(admission, claim, source.conversionOperationId, captured.records, captured.retired);
    const proof = Object.freeze({ profileId: claim.profileId });
    conversionInventories.set(proof, { claim, admission, plan, revalidate() {
      source.revalidateSource(); inventory.revalidateBeforeKeyIntent(); inventory.revalidate()();
      if (source.pendingPlan() !== undefined) inspectStoppedCanonicalConversion(admission, claim, plan);
      else {
        const current = inspectStoppedCredentialSource(admission, claim);
        if (canonicalJsonStringify(current.records) !== canonicalJsonStringify(captured.records)
          || canonicalJsonStringify(current.retired) !== canonicalJsonStringify(captured.retired)) throw new Error("profile-control-upgrade-credential-source-changed");
      }
      source.revalidateSource();
    } });
    return proof;
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); throw error; }
    if (error instanceof CredentialMaintenanceHold || error instanceof CredentialKeyCustodyError) throw error;
    throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED", { cause: error });
  }
}

export function readStoppedCredentialConversion(proof: StoppedControlCredentialAttestation, claim: StoppedControlProfileInventory) {
  const inventory = conversionInventories.get(proof);
  if (inventory === undefined || inventory.claim !== claim || proof.profileId !== claim.profileId) throw new Error("profile-control-upgrade-attestation-unissued");
  inventory.revalidate();
  return inventory;
}

export function releaseStoppedCredentialConversion(proof: StoppedControlCredentialAttestation): void {
  conversionInventories.delete(proof);
}
