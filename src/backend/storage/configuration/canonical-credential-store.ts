import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { DuoCredentialRecordSchema } from "../../../models/config/duo-credential-store.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import type { SignUpOperation } from "../../../models/profiles/profile.js";
import type { ProfilePublicationRead, StoppedControlProfileInventory } from "../admission/installation.js";
import { RuntimeLifetimeLock, type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { fsyncPath, replacePrivateFile, writePrivateStage } from "../private-path.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../source-closure.js";
import { validateDuoKeyPair } from "./duo-signing.js";
import { credentialKeyCustody } from "./credential-key-custody.js";
import { assertPrivateFileLockBytes, capturePriorPrivateFileLock, createPrivateLock, ensureChildDirectory, noSymlinkAncestry, readPrivateFile, PrivateFileReadTransitionError, removeExactPath, statDirectory, withPrivateFileLock, PrivateFileLockUnavailableError, type DirectoryIdentity } from "./credential-safe-file.js";

export type CanonicalCredentialKind = "protected" | "duo" | "chatgpt";
export type CanonicalCredentialRecord = Readonly<{ revision: number; value: unknown }>;
type CredentialCode = "CREDENTIAL_BUSY" | "CREDENTIAL_CONFLICT" | "CREDENTIAL_UNCERTAIN" | "CREDENTIAL_UNAVAILABLE";
export class CanonicalCredentialError extends Error {
  constructor(readonly code: CredentialCode, options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options); this.name = "CanonicalCredentialError";
  }
}
type HoldCode = "CREDENTIAL_CONVERSION_COUNTER_UNPROVED" | "CREDENTIAL_CONVERSION_REQUIRED" | "CREDENTIAL_CONVERSION_UNSUPPORTED" | "CREDENTIAL_CREATE_KEY_MISSING" | "CREDENTIAL_OPERATION_PENDING";
export class CredentialMaintenanceHold extends Error {
  constructor(readonly code: HoldCode, options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options); this.name = "CredentialMaintenanceHold";
  }
}

const Revision = z.number().int().safe().nonnegative();
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const PublicationFile = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: Digest });
export const CanonicalCredentialPublicationSourceSchema = z.strictObject({ head: PublicationFile,
  files: z.array(PublicationFile.extend({ kind: z.enum(["protected", "duo", "chatgpt"]) })).length(3) });
export type CanonicalCredentialPublicationSource = z.infer<typeof CanonicalCredentialPublicationSourceSchema>;
const Binding = z.strictObject({ installationId: z.uuid(), profileId: z.uuid() });
const NativeKey = Binding.extend({ schemaVersion: z.literal(2), keyId: z.uuid(), keyDigest: Digest });
const Counter = z.strictObject({ credentialId: z.string().min(1), publicKeySpki: z.string().min(1),
  count: z.number().int().min(0).max(0xffff_ffff),
  requests: z.array(z.strictObject({ requestId: z.string().min(1), count: z.number().int().min(1).max(0xffff_ffff) })).max(100_000) });
const ActiveHeadBody = Binding.extend({ schemaVersion: z.literal(1), state: z.literal("active"),
  generation: z.number().int().safe().positive(), revision: Revision, key: NativeKey,
  counters: z.array(Counter).max(1000), retired: z.array(z.string().min(1)).max(100_000) });
const ActiveHead = ActiveHeadBody.extend({ mac: Digest });
const ErasedHeadBody = Binding.extend({ schemaVersion: z.literal(1), state: z.literal("erased"),
  generation: z.number().int().safe().positive(), operationId: z.uuid(), key: NativeKey,
  counters: z.array(Counter).max(1000), retired: z.array(z.string().min(1)).max(100_000) });
const ErasedHead = ErasedHeadBody.extend({ planDigest: Digest });
export const CanonicalCredentialHeadSchema = z.discriminatedUnion("state", [ActiveHead, ErasedHead]);
const Frame = Binding.extend({ schemaVersion: z.literal(1), kind: z.enum(["protected", "duo", "chatgpt"]),
  generation: z.number().int().safe().positive(), keyId: z.uuid(), revision: Revision,
  nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/u), tag: z.string().regex(/^[A-Za-z0-9+/]{22}==$/u),
  ciphertext: z.string().min(4).max(24 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/u) });
const PlainFrame = z.strictObject({ revision: Revision, value: z.unknown() });
type Head = z.infer<typeof ActiveHead>;
export const MAX_CANONICAL_CREDENTIAL_BYTES = 25 * 1024 * 1024;
const maxBytes = MAX_CANONICAL_CREDENTIAL_BYTES;
const kinds = ["protected", "duo", "chatgpt"] as const;
const encode = (value: unknown) => Buffer.from(canonicalJsonStringify(value), "utf8");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function parse(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
function increment(value: number): number {
  if (!Number.isSafeInteger(value + 1)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  return value + 1;
}
function assertHeadKeyBinding(head: z.infer<typeof Binding> & { key: z.infer<typeof NativeKey> }): void {
  if (head.key.installationId !== head.installationId || head.key.profileId !== head.profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
}
function keyBytes(head: Head): Buffer {
  assertHeadKeyBinding(head);
  return Buffer.from(credentialKeyCustody.read(head.key).key, "base64");
}
function headMac(body: z.infer<typeof ActiveHeadBody>, key: Buffer): string {
  return createHmac("sha256", key).update("relay:canonical-credential-head:v1\0").update(encode(body)).digest("hex");
}
function authenticateHead(head: Head): Buffer { return authenticateHeadBody(head, keyBytes(head)); }
function authenticateHeadBody(head: Head, key: Buffer): Buffer {
  const { mac: _mac, ...input } = head;
  const body = ActiveHeadBody.parse(input);
  if (head.key.installationId !== head.installationId || head.key.profileId !== head.profileId
    || !timingSafeEqual(Buffer.from(head.mac, "hex"), Buffer.from(headMac(body, key), "hex"))) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  if (new Set(head.counters.map(counter => counter.credentialId)).size !== head.counters.length
    || new Set(head.retired).size !== head.retired.length) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  for (const counter of head.counters) if (head.retired.includes(counter.credentialId)
    || new Set(counter.requests.map(request => request.requestId)).size !== counter.requests.length
    || counter.requests.some(request => request.count > counter.count)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  return key;
}
function seal(head: Head, key: Buffer, kind: CanonicalCredentialKind, record: CanonicalCredentialRecord): Buffer {
  const nonce = randomBytes(12), metadata = { schemaVersion: 1 as const, kind, installationId: head.installationId,
    profileId: head.profileId, generation: head.generation, keyId: head.key.keyId, revision: record.revision, nonce: nonce.toString("base64") };
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(encode(metadata));
  const plaintext = encode(record);
  if (plaintext.byteLength > 16 * 1024 * 1024) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encode(Frame.parse({ ...metadata, tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
}
function open(head: Head, key: Buffer, kind: CanonicalCredentialKind, bytes: Buffer): CanonicalCredentialRecord | undefined {
  const frame = Frame.parse(parse(bytes));
  if (frame.installationId !== head.installationId || frame.profileId !== head.profileId || frame.generation !== head.generation
    || frame.keyId !== head.key.keyId || frame.kind !== kind) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  const { ciphertext, tag, ...metadata } = frame;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(frame.nonce, "base64"));
  decipher.setAAD(encode(metadata)); decipher.setAuthTag(Buffer.from(tag, "base64"));
  const record = PlainFrame.parse(parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()])));
  if (record.revision !== frame.revision) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  if (record.value === null) {
    if (record.revision !== 0) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    return undefined;
  }
  if (record.revision === 0) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  return deepFreeze(record);
}

const PriorFile = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), digest: Digest, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() })]);
const PlannedFile = z.strictObject({ kind: z.enum(kinds), digest: Digest, prior: PriorFile,
  bytes: z.string().max(34 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/u) });
const CreateOperation = Binding.extend({ schemaVersion: z.literal(1), kind: z.literal("create"), operationId: z.uuid(),
  head: ActiveHead, priorHead: PriorFile, files: z.array(PlannedFile).length(3) });

const EraseFile = z.strictObject({ kind: z.enum(kinds), digest: Digest, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
const ErasePlan = Binding.extend({ schemaVersion: z.literal(1), kind: z.literal("erase"), operationId: z.uuid(),
  priorHead: ActiveHead, priorHeadFile: EraseFile.omit({ kind: true }), head: ErasedHeadBody, files: z.array(EraseFile).length(3) });
const EraseOperation = ErasePlan.extend({ head: ErasedHead });

function canonicalPaths(admission: RuntimeAdmission) {
  const binding = admission.profileBinding, context = admission.readInstallationContext();
  if (context === undefined || context.locator.installationId !== binding.installationId
    || admission.stateRoot !== join(context.locator.stateRoot, "profiles", binding.profileId)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  return fixedCanonicalPaths(context.locator.stateRoot, admission.stateRoot, binding);
}
function fixedCanonicalPaths(machineRoot: string, profileRoot: string, binding: z.infer<typeof Binding>) {
  const machine = join(machineRoot, "machine"), directory = join(machine, "credential-keys"), operations = join(machine, "credential-operations");
  return { binding, machine, directory, operations, headPath: join(directory, `${binding.profileId}.json`),
    operationPath: join(operations, `${binding.profileId}.json`),
    records: { protected: join(profileRoot, "credentials", "protected.json"),
      duo: join(machine, "duo-credentials", `${binding.profileId}.json`), chatgpt: join(profileRoot, "credentials", "chatgpt-account.json") } };
}

function createStage(paths: ReturnType<typeof canonicalPaths>, operationId: string, kind: CanonicalCredentialKind): string {
  return join(dirname(paths.records[kind]), `.${paths.binding.profileId}.${operationId}.${kind}.canonical.tmp`);
}
function matchesPrior(file: ReturnType<typeof readPrivateFile>, prior: z.infer<typeof PriorFile>): boolean {
  return prior.state === "absent" ? file === undefined : file !== undefined && digest(file.bytes) === prior.digest
    && file.identity.device === prior.device && file.identity.inode === prior.inode;
}
function inspectCreatePrefix(paths: ReturnType<typeof canonicalPaths>, operation: z.infer<typeof CreateOperation>, key: Buffer, assertCurrent: () => void): void {
  if (operation.installationId !== paths.binding.installationId || operation.profileId !== paths.binding.profileId
    || operation.head.installationId !== paths.binding.installationId || operation.head.profileId !== paths.binding.profileId
    || operation.files.some((file, index) => file.kind !== kinds[index])) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  let missing = false, firstPending: CanonicalCredentialKind | undefined;
  const allowed = new Set<string>(Object.values(paths.records));
  for (const kind of kinds) {
    const file = operation.files.find(file => file.kind === kind);
    if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const bytes = Buffer.from(file.bytes, "base64");
    if (bytes.toString("base64") !== file.bytes || digest(bytes) !== file.digest) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    open(operation.head, key, kind, bytes);
    assertCurrent(); const current = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
    const published = current !== undefined && current.bytes.equals(bytes);
    if (published && missing || !published && !matchesPrior(current, file.prior)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    if (!published) { missing = true; firstPending ??= kind; }
    const stagePath = createStage(paths, operation.operationId, kind);
    assertCurrent(); const stage = readPrivateFile(stagePath, { label: "protected.json", maxBytes });
    if (stage !== undefined) {
      open(operation.head, key, kind, stage.bytes);
      if (published || firstPending !== kind || !stage.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      allowed.add(stagePath);
    }
  }
  const headBytes = encode(operation.head), headStage = join(paths.directory, `.${paths.binding.profileId}.${operation.operationId}.head.canonical.tmp`);
  assertCurrent(); const current = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
  const published = current !== undefined && current.bytes.equals(headBytes);
  if (published && missing || !published && !matchesPrior(current, operation.priorHead)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  assertCurrent(); const stage = readPrivateFile(headStage, { label: "lock", maxBytes });
  if (stage !== undefined) {
    if (missing || published || !stage.bytes.equals(headBytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    allowed.add(headStage);
  }
  const writer = join(paths.directory, `.${paths.binding.profileId}.writer.lock`);
  assertCurrent(); const lock = readPrivateFile(writer, { label: "lock", maxBytes: 4096 });
  if (lock !== undefined) { assertPrivateFileLockBytes(lock.bytes); allowed.add(writer); }
  for (const directory of [dirname(paths.records.protected), dirname(paths.records.duo), paths.directory]) {
    assertCurrent();
    if (lstatSync(directory, { throwIfNoEntry: false }) === undefined && directory === dirname(paths.records.duo)
      && operation.files.find(file => file.kind === "duo")?.prior.state === "absent" && !published) continue;
    for (const name of readdirSync(directory)) {
      if (directory !== dirname(paths.records.protected) && !name.startsWith(`.${paths.binding.profileId}.`)) continue;
      if (!allowed.has(join(directory, name))) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    }
  }
}

function inspectErasePrefix(paths: ReturnType<typeof canonicalPaths>, operation: z.infer<typeof EraseOperation>,
  assertCurrent: () => void): Readonly<{ erased: boolean; headBytes: Buffer }> {
    const { planDigest, ...plannedHead } = operation.head;
    if (planDigest !== digest(encode(ErasePlan.parse({ ...operation, head: plannedHead })))) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    if (operation.installationId !== paths.binding.installationId || operation.profileId !== paths.binding.profileId
      || operation.head.operationId !== operation.operationId || operation.files.some((file, index) => file.kind !== kinds[index])
      || operation.priorHead.installationId !== paths.binding.installationId || operation.priorHead.profileId !== paths.binding.profileId
      || operation.head.installationId !== paths.binding.installationId || operation.head.profileId !== paths.binding.profileId
      || canonicalJsonStringify(operation.head.key) !== canonicalJsonStringify(operation.priorHead.key)
      || operation.head.generation !== increment(operation.priorHead.generation)
      || canonicalJsonStringify(operation.head.counters) !== canonicalJsonStringify(operation.priorHead.counters)
      || [...operation.priorHead.retired, ...operation.priorHead.counters.map(counter => counter.credentialId)]
        .some(credentialId => !operation.head.retired.includes(credentialId))) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    assertCurrent();
    if (readdirSync(dirname(paths.records.protected)).some(name => name !== "protected.json" && name !== "chatgpt-account.json")
      || readdirSync(dirname(paths.records.duo)).some(name => name.startsWith(`.${paths.binding.profileId}.`))
      || readdirSync(paths.directory).some(name => name.startsWith(`.${paths.binding.profileId}.`)
        && name !== `.${paths.binding.profileId}.writer.lock` && name !== `.${paths.binding.profileId}.${operation.operationId}.erase.tmp`)) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    assertCurrent(); const headFile = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (headFile === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const headBytes = encode(operation.head), erased = headFile.bytes.equals(headBytes);
    if (!erased && (digest(headFile.bytes) !== operation.priorHeadFile.digest
      || headFile.identity.device !== operation.priorHeadFile.device || headFile.identity.inode !== operation.priorHeadFile.inode
      || canonicalJsonStringify(parse(headFile.bytes)) !== canonicalJsonStringify(operation.priorHead))) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    let foundPresent = false;
    for (const kind of kinds) {
      const expected = operation.files.find(file => file.kind === kind);
      if (expected === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      assertCurrent(); const current = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
      if (current === undefined) {
        if (!erased || foundPresent) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      } else {
        foundPresent = true;
        if (digest(current.bytes) !== expected.digest || current.identity.device !== expected.device || current.identity.inode !== expected.inode) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      }
    }
    if (!erased) { assertCurrent(); authenticateHead(operation.priorHead); }
    const stagePath = join(paths.directory, `.${paths.binding.profileId}.${operation.operationId}.erase.tmp`);
    assertCurrent(); const stage = readPrivateFile(stagePath, { label: "lock", maxBytes });
    if (stage !== undefined && (erased || !stage.bytes.equals(headBytes))) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    return { erased, headBytes };
}

function publishCreate(paths: ReturnType<typeof canonicalPaths>, operation: z.infer<typeof CreateOperation>,
  saved: NonNullable<ReturnType<typeof readPrivateFile>>, secret: Buffer, assertCurrent: () => void): void {
  inspectCreatePrefix(paths, operation, secret, assertCurrent);
    for (const file of operation.files) {
      const bytes = Buffer.from(file.bytes, "base64");
      if (digest(bytes) !== file.digest) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      open(operation.head, secret, file.kind, bytes);
      const path = paths.records[file.kind]; assertCurrent();
      const current = readPrivateFile(path, { label: "protected.json", maxBytes });
      if (current !== undefined && current.bytes.equals(bytes)) continue;
      if (!matchesPrior(current, file.prior)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      const stage = join(dirname(path), `.${paths.binding.profileId}.${operation.operationId}.${file.kind}.canonical.tmp`);
      const existing = readPrivateFile(stage, { label: "protected.json", maxBytes });
      if (existing === undefined) { assertCurrent(); writePrivateStage(stage, bytes); fsyncPath(dirname(stage)); }
      else if (!existing.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      inspectCreatePrefix(paths, operation, secret, assertCurrent);
      assertCurrent(); replacePrivateFile(stage, path); fsyncPath(dirname(path));
      const published = readPrivateFile(path, { label: "protected.json", maxBytes });
      if (published === undefined || !published.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    }
    assertCurrent();
    const current = readPrivateFile(paths.headPath, { label: "lock", maxBytes }), bytes = encode(operation.head);
    if (current === undefined || !current.bytes.equals(bytes)) {
      if (!matchesPrior(current, operation.priorHead)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      const stage = join(paths.directory, `.${paths.binding.profileId}.${operation.operationId}.head.canonical.tmp`);
      const existing = readPrivateFile(stage, { label: "lock", maxBytes });
      if (existing === undefined) { assertCurrent(); writePrivateStage(stage, bytes); fsyncPath(paths.directory); }
      else if (!existing.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      inspectCreatePrefix(paths, operation, secret, assertCurrent);
      assertCurrent(); replacePrivateFile(stage, paths.headPath); fsyncPath(paths.directory);
    }
    const after = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (after === undefined || !after.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    assertCurrent(); authenticateHead(operation.head);
    inspectCreatePrefix(paths, operation, secret, assertCurrent);
    assertCurrent(); removeExactPath(paths.operationPath, saved.identity, false, "credential-create-operation-changed"); fsyncPath(paths.operations);
}

type OwnedStages = ReadonlyMap<string, Readonly<{ bytes: Buffer; kind?: CanonicalCredentialKind; identity?: DirectoryIdentity }>>;
function inspectCanonicalNamespace(paths: ReturnType<typeof canonicalPaths>, head: Head, key: Buffer,
  owned: OwnedStages, assertCurrent: () => void, ancestry = new Map<string, DirectoryIdentity>()): void {
  const writerLockPath = join(paths.directory, `.${paths.binding.profileId}.writer.lock`);
  function validatePrivateLock(bytes: Buffer): void {
    try { assertPrivateFileLockBytes(bytes); }
    catch (error) { throw new CanonicalCredentialError("CREDENTIAL_BUSY", { cause: error }); }
  }
  function writerLockPresent(): boolean {
    assertCurrent(); const lock = readPrivateFile(writerLockPath, { label: "nonce lock", maxBytes: 4096 });
    if (lock === undefined) return false;
    // A safely read writer lock may still be publishing its nonce; refuse without trusting it.
    validatePrivateLock(lock.bytes); return true;
  }
  for (const directory of [dirname(paths.records.protected), dirname(paths.records.duo), paths.directory]) {
    assertCurrent();
    if (!noSymlinkAncestry(directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    statDirectory(directory, "canonical credential directory", 0o700);
    for (const name of readdirSync(directory)) {
      const profileDirectory = directory === dirname(paths.records.protected);
      if (profileDirectory && (name === "protected.json" || name === "chatgpt-account.json")) continue;
      if (!profileDirectory && !name.startsWith(`.${paths.binding.profileId}.`)) continue;
      const path = join(directory, name);
      if (directory === paths.directory && (name === `.${paths.binding.profileId}.writer.lock` || name === `.${paths.binding.profileId}.chatgpt.lock`)) {
        if (name === `.${paths.binding.profileId}.writer.lock`) {
          if (!writerLockPresent()) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
        } else {
          assertCurrent(); const lock = readPrivateFile(path, { label: "nonce lock", maxBytes: 4096 });
          if (lock === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
          validatePrivateLock(lock.bytes);
        }
        continue;
      }
      if (!name.endsWith(".canonical.tmp")) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      const expected = owned.get(path);
      if (expected === undefined && writerLockPresent()) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
      assertCurrent();
      let stage: ReturnType<typeof readPrivateFile>;
      try { stage = readPrivateFile(path, { label: "protected.json", maxBytes }); }
      catch (error) {
        if (expected !== undefined && error instanceof PrivateFileReadTransitionError && !hasUnprovedSourceClosure(error)) {
          throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE", { cause: error });
        }
        const cause = error instanceof Error ? error.cause : undefined;
        const isEnoent = (value: unknown) => value !== null && typeof value === "object"
          && "code" in value && value.code === "ENOENT";
        if (expected === undefined && !hasUnprovedSourceClosure(error) && (isEnoent(error) || isEnoent(cause))) {
          throw new CanonicalCredentialError("CREDENTIAL_BUSY", { cause: error });
        }
        throw error;
      }
      if (stage === undefined) {
        if (expected === undefined) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
        throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      }
      if (expected === undefined) {
        if (writerLockPresent()) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
        throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      }
      if (directory === paths.directory) {
        const candidate = ActiveHead.parse(parse(stage.bytes)), { mac, ...body } = candidate;
        if (candidate.profileId !== head.profileId || candidate.installationId !== head.installationId || candidate.generation !== head.generation
          || canonicalJsonStringify(candidate.key) !== canonicalJsonStringify(head.key)
          || !timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(headMac(body, key), "hex"))) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      } else {
        const header = Frame.parse(parse(stage.bytes));
        if (profileDirectory ? header.kind === "duo" : header.kind !== "duo") throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        open(head, key, header.kind, stage.bytes);
        if (expected.kind !== header.kind) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      }
      if (!stage.bytes.equals(expected.bytes) || expected.identity === undefined
        || stage.identity.device !== expected.identity.device || stage.identity.inode !== expected.identity.inode) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    }
  }
}

export function captureCanonicalCredentialStartupLocks(lifetime: RuntimeLifetimeLock, workspace: string,
  machineRoot: string, installationId: string): readonly (() => void)[] {
  if (!(lifetime instanceof RuntimeLifetimeLock)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  const assertCurrent = () => lifetime.assertStartupWorkspace(workspace);
  const directory = join(machineRoot, "machine", "credential-keys"), operations = join(machineRoot, "machine", "credential-operations");
  const ancestry = new Map<string, DirectoryIdentity>(), removals: (() => void)[] = [], profiles = new Set<string>();
  const guard = () => {
    assertCurrent();
    for (const path of [directory, operations]) if (noSymlinkAncestry(path, ancestry)) statDirectory(path, "canonical credential directory", 0o700);
  };
  guard();
  for (const path of [directory, operations]) {
    if (!noSymlinkAncestry(path, ancestry)) continue;
    for (const name of readdirSync(path)) {
      const match = path === operations ? /^([a-f0-9-]+)\.json$/u.exec(name)
        : /^(?:([a-f0-9-]+)\.json|\.([a-f0-9-]{36})\..+)$/u.exec(name);
      if (match === null) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      profiles.add(z.uuid().parse(match[1] ?? match[2]));
    }
  }
  for (const profileId of profiles) {
    const paths = fixedCanonicalPaths(machineRoot, join(machineRoot, "profiles", profileId), { installationId, profileId });
    guard();
    for (const path of [directory, operations, dirname(paths.records.protected), dirname(paths.records.duo)]) {
      if (!noSymlinkAncestry(path, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      statDirectory(path, "canonical credential directory", 0o700);
    }
    const pending = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
    if (pending !== undefined) {
      const create = CreateOperation.safeParse(parse(pending.bytes));
      if (create.success) {
        let key: Buffer;
        try { key = authenticateHead(create.data.head); }
        catch (cause) { throw new CredentialMaintenanceHold("CREDENTIAL_CREATE_KEY_MISSING", { cause }); }
        inspectCreatePrefix(paths, create.data, key, guard);
      } else {
        const erase = EraseOperation.safeParse(parse(pending.bytes));
        if (!erase.success) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
        inspectErasePrefix(paths, erase.data, guard);
      }
    } else {
      const file = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
      if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      const head = CanonicalCredentialHeadSchema.parse(parse(file.bytes));
      if (head.installationId !== installationId || head.profileId !== profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      if (head.state === "active") {
        guard(); const key = authenticateHead(head);
        inspectCanonicalNamespace(paths, head, key, new Map(), guard, ancestry);
        for (const kind of kinds) {
          guard(); const record = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
          if (record === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
          open(head, key, kind, record.bytes);
        }
      } else {
        for (const path of Object.values(paths.records)) if (readPrivateFile(path, { label: "protected.json", maxBytes }) !== undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        if (readdirSync(dirname(paths.records.protected)).length !== 0
          || readdirSync(directory).some(name => name.startsWith(`.${profileId}.`) && name !== `.${profileId}.writer.lock`)) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      }
    }
    for (const suffix of ["writer", "chatgpt"]) {
      guard();
      const remove = capturePriorPrivateFileLock(directory, `.${profileId}.${suffix}.lock`);
      if (remove !== undefined) removals.push(() => { guard(); remove(); });
    }
  }
  guard(); return removals;
}

export function captureCanonicalCredentialPublication(machine: RuntimeAdmission, profile: RuntimeAdmission,
  operation: SignUpOperation, publication: ProfilePublicationRead) {
  requireRuntimeAdmission(machine); requireRuntimeAdmission(profile);
  const assertCurrent = () => machine.assertCanonicalCredentialCreation(profile, operation, publication);
  const source = assertCurrent(), ancestry = new Map<string, DirectoryIdentity>();
  const paths = fixedCanonicalPaths(source.machineRoot, source.profileRoot, source.binding);
  try {
    assertCurrent();
    if (!noSymlinkAncestry(paths.directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const headFile = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (headFile === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const head = ActiveHead.parse(parse(headFile.bytes));
    if (head.profileId !== source.binding.profileId || head.installationId !== source.binding.installationId
      || head.key.keyId !== operation.credentials.keyId || head.generation !== operation.credentials.generation) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    assertCurrent(); const key = authenticateHead(head);
    inspectCanonicalNamespace(paths, head, key, new Map(), assertCurrent, ancestry);
    const records: Partial<Record<CanonicalCredentialKind, CanonicalCredentialRecord | undefined>> = {}, files = [];
    for (const kind of kinds) {
      assertCurrent(); const file = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
      if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      records[kind] = open(head, key, kind, file.bytes);
      files.push({ kind, ...file.identity, digest: digest(file.bytes) });
    }
    const witness = CanonicalCredentialPublicationSourceSchema.parse({ head: { ...headFile.identity, digest: digest(headFile.bytes) }, files });
    for (const file of [{ path: paths.headPath, ...witness.head }, ...witness.files.map(file => ({ path: paths.records[file.kind], ...file }))]) {
      assertCurrent(); const current = readPrivateFile(file.path, { label: "protected.json", maxBytes });
      if (current === undefined || current.identity.device !== file.device || current.identity.inode !== file.inode || digest(current.bytes) !== file.digest) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    }
    assertCurrent(); return deepFreeze({ source: witness, records, head });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) {
      machine.retainSourceClosure(error); profile.retainSourceClosure(error);
      retainUnprovedSourceOwners(error, { admission: { machine, profile } });
    }
    throw error;
  }
}

export function readCanonicalCredentialForPublication(machine: RuntimeAdmission, profile: RuntimeAdmission,
  operation: SignUpOperation, kind: CanonicalCredentialKind, publication: ProfilePublicationRead): CanonicalCredentialRecord | undefined {
  return captureCanonicalCredentialPublication(machine, profile, operation, publication).records[kind];
}

export function captureCanonicalCredentialUpgradeSource(machine: RuntimeAdmission, profileId: string) {
  const observe = (owner: RuntimeAdmission, current: string): string => {
    if (current !== profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    requireRuntimeAdmission(owner).assertProfileUpgradeCredentialSource(current);
    const binding = { installationId: owner.locator.installationId, profileId: current };
    const paths = fixedCanonicalPaths(owner.stateRoot, join(owner.stateRoot, "profiles", current), binding);
    const ancestry = new Map<string, DirectoryIdentity>();
    const assertCurrent = () => owner.assertProfileUpgradeCredentialSource(current);
    try {
      assertCurrent();
      if (!noSymlinkAncestry(paths.directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      if (readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 }) !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      const file = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
      if (file === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
      const head = ActiveHead.parse(parse(file.bytes));
      if (head.installationId !== binding.installationId || head.profileId !== binding.profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      assertCurrent(); const key = authenticateHead(head), files = [file];
      inspectCanonicalNamespace(paths, head, key, new Map(), assertCurrent, ancestry);
      for (const kind of kinds) {
        assertCurrent(); const record = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
        if (record === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        open(head, key, kind, record.bytes); files.push(record);
      }
      assertCurrent(); return canonicalJsonStringify(files.map(source => ({ ...source.identity, digest: digest(source.bytes) })));
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { owner.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: owner }); }
      throw error;
    }
  };
  const original = observe(machine, profileId);
  return Object.freeze({ revalidate(owner: RuntimeAdmission, current: string): void {
    if (observe(owner, current) !== original) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  } });
}

export const CanonicalCredentialRestoreSnapshotSchema = z.strictObject({ binding: Binding,
  generation: z.number().int().safe().positive(), keyId: z.uuid(), digest: Digest,
  counters: z.array(Counter).max(1000), retired: z.array(z.string().min(1)).max(100_000) });

export function captureStoppedCanonicalCredentialHead(admission: RuntimeAdmission, operation: OfflineMaintenanceOperation) {
  requireRuntimeAdmission(admission).assertStoppedProfile(operation);
  const paths = canonicalPaths(admission), ancestry = new Map<string, DirectoryIdentity>();
  const assertCurrent = () => admission.assertStoppedProfile(operation);
  try {
    assertCurrent();
    if (!noSymlinkAncestry(paths.directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    if (readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 }) !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    const file = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (file === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
    const head = ActiveHead.parse(parse(file.bytes));
    if (head.installationId !== paths.binding.installationId || head.profileId !== paths.binding.profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    assertCurrent(); const key = authenticateHead(head);
    inspectCanonicalNamespace(paths, head, key, new Map(), assertCurrent, ancestry); assertCurrent();
    return deepFreeze(CanonicalCredentialRestoreSnapshotSchema.parse({ binding: paths.binding, generation: head.generation, keyId: head.key.keyId,
      digest: digest(file.bytes), counters: head.counters, retired: head.retired }));
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission, restore: operation }); }
    throw error;
  }
}

export function captureStoppedIncompleteCredentials(admissionInput: RuntimeAdmission) {
  const admission = requireRuntimeAdmission(admissionInput), paths = canonicalPaths(admission);
  const current = () => admission.assertStoppedIncompleteProfileInventory();
  try {
    current();
    if (readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 }) !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    const source = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (source === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
    const head = ActiveHead.parse(parse(source.bytes));
    if (head.installationId !== paths.binding.installationId || head.profileId !== paths.binding.profileId
      || head.counters.length !== 0 || head.retired.length !== 0) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const key = authenticateHead(head);
    inspectCanonicalNamespace(paths, head, key, new Map(), current);
    const files = kinds.map(kind => {
      current();
      const file = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
      if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      return { kind, file, record: open(head, key, kind, file.bytes) };
    });
    const duo = files.find(file => file.kind === "duo")?.record;
    if (duo !== undefined && DuoCredentialRecordSchema.parse(duo.value).credentials.length !== 0
      || files.find(file => file.kind === "chatgpt")?.record !== undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const protectedRecord = files.find(file => file.kind === "protected")?.record;
    if (protectedRecord === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    current();
    return { record: protectedRecord, keyId: head.key.keyId, generation: head.generation,
      credentials: CanonicalCredentialPublicationSourceSchema.parse({ head: { ...source.identity, digest: digest(source.bytes) },
        files: files.map(({ kind, file }) => ({ kind, ...file.identity, digest: digest(file.bytes) })) }) };
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export const CanonicalCredentialConversionPlanSchema = z.strictObject({ operation: CreateOperation, digest: Digest });
export type CanonicalCredentialConversionPlan = Readonly<z.infer<typeof CanonicalCredentialConversionPlanSchema>>;

function stoppedConversionKey(source: ReturnType<RuntimeAdmission["readStoppedControlCredentialInventorySource"]>, plan: CanonicalCredentialConversionPlan): Buffer {
  assertHeadKeyBinding(plan.operation.head);
  if (plan.operation.head.installationId !== source.binding.installationId || plan.operation.head.profileId !== source.binding.profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  const paths = fixedCanonicalPaths(source.machineRoot, source.stateRoot, source.binding), current = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
  if (matchesPrior(current, plan.operation.priorHead) && current !== undefined) {
    const legacy = Binding.extend({ schemaVersion: z.literal(1), keyId: z.uuid(), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u) }).safeParse(parse(current.bytes));
    if (legacy.success) {
      if (legacy.data.installationId !== source.binding.installationId || legacy.data.profileId !== source.binding.profileId
        || legacy.data.keyId !== plan.operation.head.key.keyId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      const key = Buffer.from(legacy.data.key, "base64");
      if (digest(key) !== plan.operation.head.key.keyDigest) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      return authenticateHeadBody(plan.operation.head, key);
    }
  }
  return authenticateHead(plan.operation.head);
}

export function inspectStoppedCanonicalConversionCopy(admission: RuntimeAdmission, claim: StoppedControlProfileInventory,
  plan: CanonicalCredentialConversionPlan, kind: CanonicalCredentialKind, bytes: Buffer) {
  const source = admission.readStoppedControlCredentialInventorySource(claim);
  try {
    source.assertCanonicalConversion(plan.operation.operationId, plan.digest);
    if (digest(encode(plan.operation)) !== plan.digest) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const key = stoppedConversionKey(source, plan), record = open(plan.operation.head, key, kind, bytes);
    source.assertCanonicalConversion(plan.operation.operationId, plan.digest);
    return record;
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export function inspectStoppedCanonicalConversion(admission: RuntimeAdmission, claim: StoppedControlProfileInventory,
  input: CanonicalCredentialConversionPlan) {
  const source = admission.readStoppedControlCredentialInventorySource(claim), plan = CanonicalCredentialConversionPlanSchema.parse(input);
  const current = () => source.assertCanonicalConversion(plan.operation.operationId, plan.digest);
  try {
    current();
    if (digest(encode(plan.operation)) !== plan.digest || plan.operation.installationId !== source.binding.installationId
      || plan.operation.profileId !== source.binding.profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const key = stoppedConversionKey(source, plan), paths = fixedCanonicalPaths(source.machineRoot, source.stateRoot, source.binding);
    inspectCreatePrefix(paths, plan.operation, key, current);
    const records = Object.fromEntries(kinds.map(kind => {
      const file = plan.operation.files.find(file => file.kind === kind);
      if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      return [kind, open(plan.operation.head, key, kind, Buffer.from(file.bytes, "base64")) ?? { revision: 0, value: null }];
    })) as Record<CanonicalCredentialKind, CanonicalCredentialRecord>;
    current(); return records;
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export function prepareStoppedCanonicalCredentials(admission: RuntimeAdmission, claim: StoppedControlProfileInventory,
  operationId: string, records: Readonly<Record<CanonicalCredentialKind, CanonicalCredentialRecord>>, retired: readonly string[]): CanonicalCredentialConversionPlan {
  const source = requireRuntimeAdmission(admission).readStoppedControlCredentialInventorySource(claim);
  const assertCurrent = () => { admission.readStoppedControlCredentialInventorySource(claim); source.revalidateSource(); };
  const paths = fixedCanonicalPaths(source.machineRoot, source.stateRoot, source.binding), ancestry = new Map<string, DirectoryIdentity>();
  try {
    assertCurrent();
    if (!noSymlinkAncestry(paths.directory, ancestry)) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    if (readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 }) !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    const old = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (old === undefined || old.identity.device !== source.key.file.device || old.identity.inode !== source.key.file.inode) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const legacy = Binding.extend({ schemaVersion: z.literal(1), keyId: z.uuid(), key: z.string() }).safeParse(parse(old.bytes));
    const metadata = NativeKey.extend({ legacyWitness: z.literal(true).optional() }).safeParse(parse(old.bytes));
    if (!legacy.success && !metadata.success) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const identity = legacy.success ? legacy.data : metadata.success ? metadata.data : undefined;
    if (identity === undefined || identity.installationId !== source.binding.installationId || identity.profileId !== source.binding.profileId
      || identity.keyId !== source.key.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const oldKey = legacy.success ? legacy.data : metadata.success ? credentialKeyCustody.read(NativeKey.parse({ schemaVersion: 2,
      installationId: metadata.data.installationId, profileId: metadata.data.profileId, keyId: metadata.data.keyId, keyDigest: metadata.data.keyDigest })) : undefined;
    if (oldKey === undefined || oldKey.installationId !== source.binding.installationId || oldKey.profileId !== source.binding.profileId
      || oldKey.keyId !== source.key.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const secret = Buffer.from(oldKey.key, "base64");
    if (secret.length !== 32 || secret.toString("base64") !== oldKey.key) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const priorDigest = metadata.success && metadata.data.legacyWitness === true ? digest(Buffer.from(`${canonicalJsonStringify(oldKey)}\n`)) : digest(old.bytes);
    if (priorDigest !== source.key.file.digest) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
    const duo = records.duo.value === null ? { credentials: [] } : DuoCredentialRecordSchema.parse(records.duo.value);
    if (duo.credentials.length !== 0) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_COUNTER_UNPROVED");
    const key = NativeKey.parse({ schemaVersion: 2, ...source.binding, keyId: oldKey.keyId, keyDigest: digest(secret) });
    const body = ActiveHeadBody.parse({ schemaVersion: 1, state: "active", ...source.binding,
      generation: increment(source.head.epoch), revision: 0, key, counters: [], retired });
    const head = ActiveHead.parse({ ...body, mac: headMac(body, secret) });
    const operation = CreateOperation.parse({ schemaVersion: 1, kind: "create", ...source.binding, operationId, head,
      priorHead: { state: "present", ...old.identity, digest: digest(old.bytes) }, files: kinds.map(kind => {
        assertCurrent();
        if (!noSymlinkAncestry(dirname(paths.records[kind]), ancestry) && kind !== "duo") throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
        const prior = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes }), bytes = seal(head, secret, kind, records[kind]);
        open(head, secret, kind, bytes);
        return { kind, digest: digest(bytes), bytes: bytes.toString("base64"), prior: prior === undefined ? { state: "absent" } : { state: "present", ...prior.identity, digest: digest(prior.bytes) } };
      }) });
    assertCurrent(); return deepFreeze({ operation, digest: digest(encode(operation)) });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export function publishStoppedCanonicalCredentials(admission: RuntimeAdmission, claim: StoppedControlProfileInventory,
  input: CanonicalCredentialConversionPlan): void {
  const source = requireRuntimeAdmission(admission).readStoppedControlCredentialInventorySource(claim);
  const operation = CreateOperation.parse(input.operation), bytes = encode(operation);
  if (digest(bytes) !== input.digest || operation.installationId !== source.binding.installationId || operation.profileId !== source.binding.profileId
    || operation.head.key.keyId !== source.key.keyId || operation.head.generation !== increment(source.head.epoch)
    || operation.priorHead.state !== "present") throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED");
  const paths = fixedCanonicalPaths(source.machineRoot, source.stateRoot, source.binding), ancestry = new Map<string, DirectoryIdentity>();
  const assertCurrent = () => {
    const held = admission.readStoppedControlCredentialInventorySource(claim);
    held.assertCanonicalPublication(operation.operationId, input.digest);
    for (const path of [paths.directory, paths.operations, ...Object.values(paths.records).map(dirname)]) {
      if (!noSymlinkAncestry(path, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    }
  };
  try {
    source.assertCanonicalPublication(operation.operationId, input.digest);
    for (const path of [paths.operations, dirname(paths.records.duo)]) {
      admission.readStoppedControlCredentialInventorySource(claim).assertCanonicalPublication(operation.operationId, input.digest);
      ensureChildDirectory(paths.machine, path, "canonical credentials", 0o700, 0o700);
    }
    withPrivateFileLock(paths.directory, `.${source.binding.profileId}.writer.lock`, () => {
      assertCurrent();
      let saved = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
      const current = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
      if (saved === undefined && current !== undefined && current.bytes.equals(encode(operation.head))) {
        const key = authenticateHead(operation.head); inspectCreatePrefix(paths, operation, key, assertCurrent); return;
      }
      if (saved === undefined) {
        if (!matchesPrior(current, operation.priorHead) || current === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        const publishIntent = () => { assertCurrent(); writePrivateStage(paths.operationPath, bytes); fsyncPath(paths.operations); };
        const legacy = Binding.extend({ schemaVersion: z.literal(1), keyId: z.uuid(), key: z.string() }).safeParse(parse(current.bytes));
        if (legacy.success) {
          assertCurrent(); credentialKeyCustody.importStoppedLegacy(legacy.data, metadata => {
            if (canonicalJsonStringify(metadata) !== canonicalJsonStringify(operation.head.key)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
            publishIntent();
          });
        } else { assertCurrent(); authenticateHead(operation.head); publishIntent(); }
        saved = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
      }
      if (saved === undefined || !saved.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      let key: Buffer;
      try { assertCurrent(); key = authenticateHead(operation.head); }
      catch (cause) { throw new CredentialMaintenanceHold("CREDENTIAL_CREATE_KEY_MISSING", { cause }); }
      publishCreate(paths, operation, saved, key, assertCurrent);
    });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export function initializeCanonicalCredentials(machine: RuntimeAdmission, profile: RuntimeAdmission,
  input: SignUpOperation, protectedRecord: CanonicalCredentialRecord): void {
  requireRuntimeAdmission(machine);
  const admission = requireRuntimeAdmission(profile), paths = canonicalPaths(admission), ancestry = new Map<string, DirectoryIdentity>();
  const assertCurrent = () => {
    machine.assertCanonicalCredentialCreation(admission, input);
    if (!noSymlinkAncestry(admission.stateRoot, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  };
  try {
  assertCurrent();
  const initialization = input.credentials;
  if (initialization.generation !== 1) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
  for (const [parent, path] of [[paths.machine, paths.directory], [paths.machine, paths.operations],
    [paths.machine, dirname(paths.records.duo)], [admission.stateRoot, dirname(paths.records.protected)]] as const) {
    assertCurrent(); ensureChildDirectory(parent, path, "canonical credentials", 0o700, 0o700);
  }
  withPrivateFileLock(paths.directory, `.${paths.binding.profileId}.writer.lock`, () => {
    assertCurrent();
    let saved = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
    if (saved === undefined) {
      const head = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
      if (head !== undefined) {
        const current = CanonicalCredentialHeadSchema.safeParse(parse(head.bytes));
        if (!current.success || current.data.state !== "active" || current.data.installationId !== paths.binding.installationId
          || current.data.profileId !== paths.binding.profileId || current.data.key.keyId !== initialization.keyId) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
        const key = authenticateHead(current.data);
        inspectCanonicalNamespace(paths, current.data, key, new Map(), assertCurrent, ancestry);
        for (const kind of kinds) {
          assertCurrent();
          const file = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
          if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
          open(current.data, key, kind, file.bytes);
        }
        return;
      }
      for (const path of Object.values(paths.records)) if (readPrivateFile(path, { label: "protected.json", maxBytes }) !== undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
      if (readdirSync(dirname(paths.records.protected)).length !== 0
        || readdirSync(dirname(paths.records.duo)).some(name => name.startsWith(`.${paths.binding.profileId}.`))
        || readdirSync(paths.directory).some(name => name.startsWith(`.${paths.binding.profileId}.`) && name !== `.${paths.binding.profileId}.writer.lock`)) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      assertCurrent();
      credentialKeyCustody.create({ ...paths.binding, keyId: initialization.keyId }, (key, secret) => {
        const body = ActiveHeadBody.parse({ schemaVersion: 1, state: "active", ...paths.binding, generation: 1, revision: 0,
          key, counters: [], retired: [] });
        const head = ActiveHead.parse({ ...body, mac: headMac(body, secret) });
        const records = { protected: protectedRecord, duo: { revision: 0, value: null }, chatgpt: { revision: 0, value: null } };
        const operation = CreateOperation.parse({ schemaVersion: 1, kind: "create", ...paths.binding, operationId: initialization.operationId, head, priorHead: { state: "absent" },
          files: kinds.map(kind => { const bytes = seal(head, secret, kind, records[kind]); return { kind, digest: digest(bytes), prior: { state: "absent" }, bytes: bytes.toString("base64") }; }) });
        assertCurrent(); writePrivateStage(paths.operationPath, encode(operation)); fsyncPath(paths.operations); assertCurrent();
      });
      saved = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
    }
    if (saved === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    const operation = CreateOperation.parse(parse(saved.bytes));
    if (operation.operationId !== initialization.operationId || operation.installationId !== paths.binding.installationId
      || operation.profileId !== paths.binding.profileId || operation.head.installationId !== paths.binding.installationId
      || operation.head.profileId !== paths.binding.profileId || operation.head.key.keyId !== initialization.keyId
      || new Set(operation.files.map(file => file.kind)).size !== 3) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    let secret: Buffer;
    try { secret = authenticateHead(operation.head); }
    catch (cause) { throw new CredentialMaintenanceHold("CREDENTIAL_CREATE_KEY_MISSING", { cause }); }
    inspectCreatePrefix(paths, operation, secret, assertCurrent);
    if (operation.priorHead.state !== "absent" || operation.files.some(file => file.prior.state !== "absent")) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    publishCreate(paths, operation, saved, secret, assertCurrent);
  });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) {
      machine.retainSourceClosure(error); profile.retainSourceClosure(error);
      retainUnprovedSourceOwners(error, { admission: { machine, profile } });
    }
    throw error;
  }
}

export function verifyCanonicalCredentialBytes(admission: RuntimeAdmission, kind: CanonicalCredentialKind, bytes: Buffer): void {
  const owner = createCanonicalCredentials(admission), paths = canonicalPaths(admission);
  try {
    owner.assertCurrent();
    const file = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (file === undefined || bytes.byteLength > maxBytes) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const head = ActiveHead.parse(parse(file.bytes));
    if (head.installationId !== paths.binding.installationId || head.profileId !== paths.binding.profileId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    owner.assertCurrent(); const key = authenticateHead(head);
    open(head, key, kind, bytes); owner.assertCurrent();
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export function captureCanonicalDraftErasure(machine: RuntimeAdmission, profile: RuntimeAdmission, operation: SignUpOperation) {
  try {
    machine.assertCanonicalCredentialErasure(profile, operation);
    const paths = canonicalPaths(profile), abort = operation.onboarding?.abort;
    if (abort === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const file = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const head = ErasedHead.parse(parse(file.bytes));
    assertHeadKeyBinding(head);
    if (head.installationId !== paths.binding.installationId || head.profileId !== paths.binding.profileId
      || head.key.keyId !== operation.credentials.keyId || head.operationId !== abort.operationId
      || head.generation !== abort.generation) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    if (readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 }) !== undefined
      || Object.values(paths.records).some(path => readPrivateFile(path, { label: "protected.json", maxBytes }) !== undefined)) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    machine.assertCanonicalCredentialErasure(profile, operation);
    return { ...file.identity, digest: digest(file.bytes) };
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) {
      machine.retainSourceClosure(error); profile.retainSourceClosure(error);
      retainUnprovedSourceOwners(error, { admission: { machine, profile } });
    }
    throw error;
  }
}

export function eraseCanonicalDraftCredentials(machine: RuntimeAdmission, profile: RuntimeAdmission, input: SignUpOperation): void {
  requireRuntimeAdmission(machine); requireRuntimeAdmission(profile);
  const assertCurrent = () => machine.assertCanonicalCredentialErasure(profile, input);
  assertCurrent();
  const paths = canonicalPaths(profile), abort = input.onboarding?.abort;
  if (abort === undefined || input.onboarding?.attempts.some(attempt => attempt.providerClosedAt === undefined)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
  const ancestry = new Map<string, DirectoryIdentity>();
  const guard = () => {
    assertCurrent();
    for (const directory of [paths.directory, paths.operations, ...Object.values(paths.records).map(dirname)]) {
      if (!noSymlinkAncestry(directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    }
  };
  try { withPrivateFileLock(paths.directory, `.${paths.binding.profileId}.writer.lock`, () => {
    guard();
    if (readPrivateFile(join(paths.directory, `.${paths.binding.profileId}.chatgpt.lock`), { label: "lock", maxBytes: 4096 }) !== undefined) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
    let saved = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
    if (saved !== undefined) {
      const create = CreateOperation.safeParse(parse(saved.bytes));
      if (create.success) {
        const operation = create.data;
        if (operation.operationId !== input.credentials.operationId || operation.head.key.keyId !== input.credentials.keyId
          || operation.head.generation !== input.credentials.generation || operation.priorHead.state !== "absent"
          || operation.files.some(file => file.prior.state !== "absent")) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        let key: Buffer;
        try { guard(); key = authenticateHead(operation.head); }
        catch (cause) { throw new CredentialMaintenanceHold("CREDENTIAL_CREATE_KEY_MISSING", { cause }); }
        inspectCreatePrefix(paths, operation, key, guard);
        publishCreate(paths, operation, saved, key, guard);
        saved = undefined;
      }
    }
    if (saved === undefined) {
      const file = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
      if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      const parsed = CanonicalCredentialHeadSchema.parse(parse(file.bytes));
      if (parsed.installationId !== paths.binding.installationId || parsed.profileId !== paths.binding.profileId
        || parsed.key.keyId !== input.credentials.keyId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      if (parsed.state === "erased") {
        if (parsed.operationId !== abort.operationId || parsed.generation !== abort.generation) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        for (const path of Object.values(paths.records)) if (readPrivateFile(path, { label: "protected.json", maxBytes }) !== undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        guard(); assertHeadKeyBinding(parsed); credentialKeyCustody.delete(parsed.key); return;
      }
      if (parsed.generation !== input.credentials.generation || abort.generation !== increment(parsed.generation)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      guard(); const key = authenticateHead(parsed);
      inspectCanonicalNamespace(paths, parsed, key, new Map(), guard);
      let duo: z.infer<typeof DuoCredentialRecordSchema> = { credentials: [] };
      const files = kinds.map(kind => {
        guard(); const source = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
        if (source === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        const record = open(parsed, key, kind, source.bytes);
        if (kind === "duo" && record !== undefined) {
          duo = DuoCredentialRecordSchema.parse(record.value);
          for (const credential of duo.credentials) validateDuoKeyPair(credential.privateKeyPkcs8, credential.publicKeySpki);
        }
        return { kind, digest: digest(source.bytes), ...source.identity };
      });
      const head = ErasedHeadBody.parse({ schemaVersion: 1, state: "erased", ...paths.binding, generation: abort.generation,
        operationId: abort.operationId, key: parsed.key, counters: parsed.counters,
        retired: [...new Set([...parsed.retired, ...parsed.counters.map(counter => counter.credentialId), ...duo.credentials.map(credential => credential.credentialId)])] });
      const plan = ErasePlan.parse({ schemaVersion: 1, kind: "erase", ...paths.binding, operationId: abort.operationId,
        priorHead: parsed, priorHeadFile: { digest: digest(file.bytes), ...file.identity }, head, files });
      const operation = EraseOperation.parse({ ...plan, head: { ...head, planDigest: digest(encode(plan)) } });
      guard(); writePrivateStage(paths.operationPath, encode(operation)); fsyncPath(paths.operations); guard();
      saved = readPrivateFile(paths.operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 });
    }
    if (saved === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    const parsed = EraseOperation.safeParse(parse(saved.bytes));
    if (!parsed.success) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
    const operation = parsed.data;
    if (operation.operationId !== abort.operationId || operation.head.operationId !== abort.operationId
      || operation.head.generation !== abort.generation || operation.priorHead.generation !== input.credentials.generation
      || operation.priorHead.key.keyId !== input.credentials.keyId) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const { erased, headBytes } = inspectErasePrefix(paths, operation, guard);
    if (!erased) {
      guard(); authenticateHead(operation.priorHead);
      const stage = join(paths.directory, `.${paths.binding.profileId}.${operation.operationId}.erase.tmp`);
      const existing = readPrivateFile(stage, { label: "lock", maxBytes });
      if (existing === undefined) { guard(); writePrivateStage(stage, headBytes); fsyncPath(paths.directory); }
      else if (!existing.bytes.equals(headBytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      guard(); replacePrivateFile(stage, paths.headPath); fsyncPath(paths.directory);
    }
    guard();
    const published = readPrivateFile(paths.headPath, { label: "lock", maxBytes });
    if (published === undefined || !published.bytes.equals(headBytes)) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    guard(); assertHeadKeyBinding(operation.priorHead); credentialKeyCustody.delete(operation.priorHead.key);
    for (const kind of kinds) {
      const expected = operation.files.find(file => file.kind === kind);
      if (expected === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      guard();
      const current = readPrivateFile(paths.records[kind], { label: "protected.json", maxBytes });
      if (current !== undefined) {
        if (digest(current.bytes) !== expected.digest || current.identity.device !== expected.device || current.identity.inode !== expected.inode) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        removeExactPath(paths.records[kind], expected, false, "credential-erase-source-changed"); fsyncPath(dirname(paths.records[kind]));
      }
    }
    guard(); removeExactPath(paths.operationPath, saved.identity, false, "credential-erase-operation-changed"); fsyncPath(paths.operations);
  }); } catch (error) {
    if (hasUnprovedSourceClosure(error)) {
      machine.retainSourceClosure(error); profile.retainSourceClosure(error);
      retainUnprovedSourceOwners(error, { admission: { machine, profile } });
    }
    throw error;
  }
}

export function createCanonicalCredentials(admissionInput: RuntimeAdmission,
  options: Readonly<{ afterReplace?: (kind: CanonicalCredentialKind) => void }> = {}) {
  const admission = requireRuntimeAdmission(admissionInput), canonical = canonicalPaths(admission);
  const { binding, directory, headPath, operationPath } = canonical, paths = canonical.records;
  const ancestry = new Map<string, DirectoryIdentity>();
  let capturedGeneration: Readonly<{ generation: number; keyId: string }> | undefined;
  const ownedStages = new Map<string, Readonly<{ bytes: Buffer; kind?: CanonicalCredentialKind; identity?: DirectoryIdentity }>>();
  let publicationEpoch = 0;
  function assertAccess(): void {
    admission.assertCredentialRead();
    if (!noSymlinkAncestry(directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    statDirectory(directory, "canonical credential head", 0o700);
  }
  function translate(error: unknown, code: CredentialCode = "CREDENTIAL_UNAVAILABLE"): never {
    const sourceClosureUnproved = hasUnprovedSourceClosure(error);
    if (sourceClosureUnproved) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    if (error instanceof CanonicalCredentialError) throw error;
    const busy = code === "CREDENTIAL_UNAVAILABLE" && !sourceClosureUnproved
      && (error instanceof PrivateFileLockUnavailableError || error instanceof PrivateFileReadTransitionError);
    throw new CanonicalCredentialError(busy ? "CREDENTIAL_BUSY" : code, { cause: error });
  }
  function readHead(): { head: Head; key: Buffer } {
    assertAccess();
    if (readPrivateFile(operationPath, { label: "lock", maxBytes: 100 * 1024 * 1024 }) !== undefined) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
    const file = readPrivateFile(headPath, { label: "lock", maxBytes });
    if (file === undefined) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
    const parsed = CanonicalCredentialHeadSchema.safeParse(parse(file.bytes));
    if (!parsed.success) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED");
    const head = parsed.data;
    if (head.installationId !== binding.installationId || head.profileId !== binding.profileId || head.state !== "active") throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const key = authenticateHead(head);
    inspectCanonicalNamespace(canonical, head, key, ownedStages, assertAccess, ancestry);
    if (capturedGeneration !== undefined && (head.generation !== capturedGeneration.generation || head.key.keyId !== capturedGeneration.keyId)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    capturedGeneration ??= { generation: head.generation, keyId: head.key.keyId };
    assertAccess(); return { head, key };
  }
  function assertCurrent(): void { try { readHead(); } catch (error) { translate(error); } }
  function read(kind: CanonicalCredentialKind): CanonicalCredentialRecord | undefined {
    const { head, key } = readHead();
    assertCurrent();
    if (!noSymlinkAncestry(dirname(paths[kind]), ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const file = readPrivateFile(paths[kind], { label: "protected.json", maxBytes });
    if (file === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const record = open(head, key, kind, file.bytes); assertCurrent(); return record;
  }
  function publish(path: string, bytes: Buffer, kind?: CanonicalCredentialKind): void {
    const stage = join(dirname(path), `.${binding.profileId}.${randomUUID()}.canonical.tmp`);
    let replacementAttempted = false, stageCreated = false, identity: DirectoryIdentity | undefined;
    ownedStages.set(stage, { bytes, ...(kind === undefined ? {} : { kind }) });
    try {
      if (bytes.byteLength > maxBytes) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      assertCurrent();
      if (!createPrivateLock(stage, dirname(stage), bytes, () => {
        const file = readPrivateFile(stage, { label: "protected.json", maxBytes });
        if (file === undefined || !file.bytes.equals(bytes)) return false;
        identity = file.identity;
        ownedStages.set(stage, { bytes, identity, ...(kind === undefined ? {} : { kind }) });
        return true;
      })) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      stageCreated = true;
      assertCurrent(); replacementAttempted = true; publicationEpoch++;
      replacePrivateFile(stage, path);
      if (kind !== undefined) options.afterReplace?.(kind);
      fsyncPath(dirname(path)); assertCurrent();
      const after = readPrivateFile(path, { label: "protected.json", maxBytes });
      if (after === undefined || identity === undefined || !after.bytes.equals(bytes)
        || after.identity.device !== identity.device || after.identity.inode !== identity.inode) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    } catch (error) {
      if (!stageCreated && error instanceof AggregateError) translate(error, "CREDENTIAL_UNCERTAIN");
      if (stageCreated && !replacementAttempted && !hasUnprovedSourceClosure(error)) {
        try {
          const owned = readPrivateFile(stage, { label: "protected.json", maxBytes });
          if (owned !== undefined && identity !== undefined && owned.bytes.equals(bytes)
            && owned.identity.device === identity.device && owned.identity.inode === identity.inode) {
            removeExactPath(stage, owned.identity, false, "credential-stage-changed"); fsyncPath(dirname(stage));
          }
        } catch (cleanup) {
          translate(new AggregateError([error, cleanup], "credential publication and stage closure failed", { cause: cleanup }), "CREDENTIAL_UNCERTAIN");
        }
      }
      if (replacementAttempted) {
        if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
        throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN", { cause: error });
      }
      translate(error);
    } finally { ownedStages.delete(stage); }
  }
  function locked<T>(body: () => T): T {
    assertCurrent(); const before = publicationEpoch;
    try { return withPrivateFileLock(directory, `.${binding.profileId}.writer.lock`, () => { assertCurrent(); return body(); }); }
    catch (error) {
      if (publicationEpoch !== before && !(error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNCERTAIN")) {
        if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
        throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN", { cause: error });
      }
      throw error;
    }
  }
  function replace(kind: CanonicalCredentialKind, expectedRevision: number | null, value: unknown): CanonicalCredentialRecord {
    const current = read(kind);
    if ((current?.revision ?? null) !== expectedRevision) throw new CanonicalCredentialError("CREDENTIAL_CONFLICT");
    const { head, key } = readHead();
    if (kind === "duo") {
      const next = DuoCredentialRecordSchema.parse(value), prior = current === undefined ? { credentials: [] } : DuoCredentialRecordSchema.parse(current.value);
      for (const credential of [...prior.credentials, ...next.credentials]) validateDuoKeyPair(credential.privateKeyPkcs8, credential.publicKeySpki);
      if (next.credentials.some(credential => head.retired.includes(credential.credentialId))
        || prior.credentials.some(credential => !next.credentials.some(candidate => candidate.credentialId === credential.credentialId
          && candidate.publicKeySpki === credential.publicKeySpki && candidate.privateKeyPkcs8 === credential.privateKeyPkcs8))) throw new CanonicalCredentialError("CREDENTIAL_CONFLICT");
    }
    const record = deepFreeze({ revision: increment(current?.revision ?? 0), value });
    publish(paths[kind], seal(head, key, kind, record), kind);
    const after = read(kind);
    if (after === undefined || canonicalJsonStringify(after) !== canonicalJsonStringify(record)) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
    return after;
  }
  const chatLeasePath = join(directory, `.${binding.profileId}.chatgpt.lock`);
  async function withChatGptOperation<T>(body: (tx: Readonly<{ read(): CanonicalCredentialRecord | undefined;
    replace(value: unknown, expectedRevision: number | null): CanonicalCredentialRecord }>) => Promise<T>): Promise<T> {
    let active = false, identity: DirectoryIdentity | undefined, settledBodyError: { error: unknown } | undefined;
    const bytes = encode({ nonce: randomUUID() });
    function assertLease(): void {
      if (!active) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
      assertCurrent();
      const file = readPrivateFile(chatLeasePath, { label: "lock", maxBytes: 4096 });
      if (identity === undefined || file === undefined || file.identity.device !== identity.device || file.identity.inode !== identity.inode
        || !file.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    }
    try {
      locked(() => {
        readHead();
        if (!createPrivateLock(chatLeasePath, directory, bytes, () => {
          const file = readPrivateFile(chatLeasePath, { label: "lock", maxBytes: 4096 });
          if (file === undefined || !file.bytes.equals(bytes)) return false;
          identity = file.identity; return true;
        })) throw new CanonicalCredentialError("CREDENTIAL_BUSY");
        active = true; publicationEpoch++;
      });
      let outcome: { result: T } | { error: unknown };
      try {
        const result = await body(Object.freeze({ read() {
          try { assertLease(); return read("chatgpt"); } catch (error) { translate(error); }
        }, replace(value: unknown, expectedRevision: number | null) {
          try { return locked(() => { assertLease(); return replace("chatgpt", expectedRevision, value); }); }
          catch (error) { translate(error); }
        } }));
        try { assertLease(); } catch (error) { translate(error); }
        outcome = { result };
      } catch (error) { outcome = { error }; }
      active = false;
      if ("error" in outcome && hasUnprovedSourceClosure(outcome.error)) {
        admission.retainSourceClosure(outcome.error);
        retainUnprovedSourceOwners(outcome.error, { admission, processLock: { path: chatLeasePath, identity, bytes } });
        settledBodyError = { error: outcome.error }; throw outcome.error;
      }
      try {
        if (identity === undefined || !noSymlinkAncestry(directory, ancestry)) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
        statDirectory(directory, "canonical credential head", 0o700);
        const file = readPrivateFile(chatLeasePath, { label: "lock", maxBytes: 4096 });
        if (file === undefined || !file.bytes.equals(bytes)) throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN");
        removeExactPath(chatLeasePath, identity, false, "credential-operation-lease-changed"); fsyncPath(directory);
      } catch (cleanup) {
        throw new CanonicalCredentialError("CREDENTIAL_UNCERTAIN", { cause: "error" in outcome
          ? new AggregateError([outcome.error, cleanup], "credential operation and lease closure failed", { cause: cleanup }) : cleanup });
      }
      if ("error" in outcome) { settledBodyError = { error: outcome.error }; throw outcome.error; }
      return outcome.result;
    } catch (error) {
      active = false;
      if (hasUnprovedSourceClosure(error)) {
        admission.retainSourceClosure(error);
        if (identity !== undefined) retainUnprovedSourceOwners(error, { admission, processLock: { path: chatLeasePath, identity, bytes } });
      }
      if (settledBodyError !== undefined && Object.is(settledBodyError.error, error)) throw error;
      translate(error);
    }
  }
  return Object.freeze({ assertCurrent,
    readRecord(kind: CanonicalCredentialKind): CanonicalCredentialRecord | undefined { try { return read(kind); } catch (error) { translate(error); } },
    replaceRecord(kind: "protected" | "duo", expectedRevision: number | null, value: unknown): CanonicalCredentialRecord {
      try {
        if (kind !== "protected" && kind !== "duo") throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        return locked(() => replace(kind, expectedRevision, value));
      } catch (error) { translate(error); }
    },
    reserveDuoCounter(credentialId: string, requestId: string): Readonly<{ count: number; revision: number }> {
      try { return locked(() => {
        if (requestId.length === 0) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        const record = read("duo"), document = DuoCredentialRecordSchema.parse(record?.value);
        const credential = document.credentials.find(candidate => candidate.credentialId === credentialId && candidate.state === "ready");
        if (credential === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        validateDuoKeyPair(credential.privateKeyPkcs8, credential.publicKeySpki);
        const { head, key } = readHead();
        if (head.retired.includes(credentialId)) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        const prior = head.counters.find(counter => counter.credentialId === credentialId);
        if (prior !== undefined && prior.publicKeySpki !== credential.publicKeySpki) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
        const existing = prior?.requests.find(request => request.requestId === requestId);
        if (existing !== undefined) throw new CanonicalCredentialError("CREDENTIAL_CONFLICT");
        const count = (prior?.count ?? 0) + 1;
        const counter = Counter.parse({ credentialId, publicKeySpki: credential.publicKeySpki, count,
          requests: [...(prior?.requests ?? []), { requestId, count }] });
        const { mac: _mac, ...priorBody } = head;
        const body = ActiveHeadBody.parse({ ...priorBody, revision: increment(head.revision),
          counters: [...head.counters.filter(candidate => candidate.credentialId !== credentialId), counter] });
        publish(headPath, encode({ ...body, mac: headMac(body, key) }));
        return { count, revision: body.revision };
      }); } catch (error) { translate(error); }
    }, withChatGptOperation,
  });
}
