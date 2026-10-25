import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { DuoContinuityRowSchema, DuoCredentialDocumentSchema, DuoDocumentEnvelopeSchema, DuoEnrollmentScopeSchema, DuoStoredCredentialSchema,
  type DuoContinuityRow, type DuoCredentialDocument, type DuoEnrollmentScope } from "../../../models/config/duo-credential-store.js";
import type { ProfileRegistryDocument } from "../../../models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { duoCredentialPurposeBinding, issueDuoCredentialPurpose, openDuoCredentialDocument, sealDuoCredentialDocument,
  type DuoCredentialPurpose } from "./credential-store.js";
import { ensureChildDirectory, fsyncPath, noSymlinkAncestry, readPrivateFile, writePrivateStage, type DirectoryIdentity } from "./credential-safe-file.js";

const MAX_DUO_ENVELOPE_BYTES = Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096;
export const DuoPublicationCaptureSchema = z.strictObject({
  publicationId: z.uuid(), profileId: z.uuid(), prior: DuoContinuityRowSchema, next: DuoContinuityRowSchema,
});
export type DuoPublicationCapture = z.infer<typeof DuoPublicationCaptureSchema>;
export class DuoCredentialCommitUncertainError extends Error {
  readonly code = "duo-commit-uncertain";
  constructor(cause: unknown) { super("duo-commit-uncertain", { cause }); this.name = "DuoCredentialCommitUncertainError"; }
}
export interface IssuedDuoTransaction { readonly profileId: string }
type PublicCredential = Readonly<{ credentialId: string; state: "pending" | "ready"; highWater: number }>;
type Mutation = (document: DuoCredentialDocument | undefined) => Readonly<{ document?: DuoCredentialDocument; result: unknown }>;
const transactions = new WeakMap<IssuedDuoTransaction, {
  purpose: DuoCredentialPurpose; machineRoot: string; mutation: Mutation; used: boolean; publicationStarted: boolean; capture?: DuoPublicationCapture; ancestry: Map<string, DirectoryIdentity>;
}>();

function identity(path: string) {
  const file = readPrivateFile(path, { label: "Duo credential", maxBytes: MAX_DUO_ENVELOPE_BYTES });
  if (file === undefined) throw new Error("duo-document-required");
  return { device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") };
}
export function assertDuoDocumentWitness(machineRoot: string, row: DuoContinuityRow): void {
  const path = join(machineRoot, "machine", "duo-credentials", `${row.profileId}.json`);
  if (row.state === "never-initialized") {
    if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) throw new Error("duo-uninitialized-document-present");
  } else if (canonicalJsonStringify(identity(path)) !== canonicalJsonStringify(row.document)) throw new Error("duo-document-custody-changed");
}
export function duoStagePath(machineRoot: string, capture: DuoPublicationCapture): string {
  return join(machineRoot, "machine", "duo-credentials", `.${capture.profileId}.${capture.publicationId}.stage`);
}
export function assertDuoPublishedFile(path: string, capture: DuoPublicationCapture): void {
  if (capture.next.state === "never-initialized" || canonicalJsonStringify(identity(path)) !== canonicalJsonStringify(capture.next.document)) throw new Error("duo-publication-file-changed");
}

export function prepareIssuedDuoTransaction(transaction: IssuedDuoTransaction, machineRoot: string,
  registry: ProfileRegistryDocument, prior: DuoContinuityRow): DuoPublicationCapture | undefined {
  const issued = transactions.get(transaction);
  if (issued === undefined || issued.used || issued.machineRoot !== machineRoot || prior.profileId !== transaction.profileId) throw new Error("duo-transaction-unissued");
  const { binding, generation } = duoCredentialPurposeBinding(issued.purpose);
  const profile = registry.profiles.find(row => row.profileId === binding.profileId);
  if (registry.sessionGeneration !== generation || profile?.lifecycle !== "ready" || profile.credentialState !== "saved") throw new Error("duo-profile-authority-changed");
  issued.used = true;
  const directory = join(machineRoot, "machine", "duo-credentials");
  if (!noSymlinkAncestry(directory, issued.ancestry) && prior.state !== "never-initialized") throw new Error("duo-document-required");
  assertDuoDocumentWitness(machineRoot, prior);
  const path = join(machineRoot, "machine", "duo-credentials", `${prior.profileId}.json`);
  const current = prior.state === "never-initialized" ? undefined : openDuoCredentialDocument(issued.purpose,
    readPrivateFile(path, { label: "Duo credential", maxBytes: MAX_DUO_ENVELOPE_BYTES })?.bytes ?? (() => { throw new Error("duo-document-required"); })(), prior.revision);
  if (current !== undefined && (prior.state === "erased") !== (current.credentials.length === 0)) throw new Error("duo-continuity-state-mismatch");
  const outcome = issued.mutation(current);
  if (outcome.document === undefined) return undefined;
  const nextDocument = DuoCredentialDocumentSchema.parse(outcome.document);
  if (nextDocument.revision !== prior.revision + 1 || nextDocument.profileId !== prior.profileId || !Number.isSafeInteger(nextDocument.revision)) throw new Error("duo-revision-invalid");
  ensureChildDirectory(join(machineRoot, "machine"), directory, "Duo credentials", 0o700, 0o700);
  if (!noSymlinkAncestry(directory, issued.ancestry)) throw new Error("duo-directory-required");
  const publicationId = randomUUID(), stage = join(directory, `.${prior.profileId}.${publicationId}.stage`);
  const bytes = sealDuoCredentialDocument(issued.purpose, nextDocument);
  issued.publicationStarted = true;
  writePrivateStage(stage, bytes); fsyncPath(directory);
  const next = DuoContinuityRowSchema.parse({ profileId: prior.profileId, revision: nextDocument.revision,
    state: nextDocument.credentials.length === 0 ? "erased" : "registered", document: identity(stage) });
  const capture = DuoPublicationCaptureSchema.parse({ publicationId, profileId: prior.profileId, prior, next });
  issued.capture = capture;
  return capture;
}
export function verifyIssuedDuoTransaction(transaction: IssuedDuoTransaction, capture: DuoPublicationCapture | undefined): void {
  const issued = transactions.get(transaction);
  if (issued === undefined || !issued.used) throw new Error("duo-transaction-unissued");
  if (capture !== undefined) {
    const path = join(issued.machineRoot, "machine", "duo-credentials", `${capture.profileId}.json`);
    assertDuoPublishedFile(path, capture);
    const file = readPrivateFile(path, { label: "Duo credential", maxBytes: MAX_DUO_ENVELOPE_BYTES });
    if (file === undefined) throw new Error("duo-document-required");
    openDuoCredentialDocument(issued.purpose, file.bytes, capture.next.revision);
  }
}
export function readDuoPublicationEnvelope(bytes: Uint8Array): Readonly<{ profileId: string; installationId: string; revision: number; purpose: string }> {
  const envelope = DuoDocumentEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)));
  return { profileId: envelope.profileId, installationId: envelope.installationId, revision: envelope.revision, purpose: envelope.purpose };
}

export function resumeIssuedDuoTransaction(transaction: IssuedDuoTransaction, capture: DuoPublicationCapture): void {
  const issued = transactions.get(transaction);
  if (issued === undefined || !issued.used || !issued.publicationStarted || issued.capture === undefined) throw new Error("duo-transaction-unissued");
  if (canonicalJsonStringify(issued.capture) !== canonicalJsonStringify(capture)) throw new Error("duo-publication-prior-changed");
  const { binding } = duoCredentialPurposeBinding(issued.purpose);
  if (binding.profileId !== capture.profileId || capture.prior.profileId !== capture.profileId || capture.next.profileId !== capture.profileId
    || capture.next.revision !== capture.prior.revision + 1) throw new Error("duo-profile-authority-changed");
}


function duoPurposeBackupDirectory(machineRoot: string, profileId: string): string {
  return join(machineRoot, "machine", "duo-purpose-backups", profileId);
}

export function censusDuoPurposeCopies(machineRoot: string, profileRoot: string, profileId: string, artifactRoot = join(profileRoot, "artifacts")): Readonly<{ canonicalDigest?: string; backups: readonly string[]; unauthorized: readonly string[] }> {
  const canonical = join(machineRoot, "machine", "duo-credentials", `${profileId}.json`);
  const backupDirectory = duoPurposeBackupDirectory(machineRoot, profileId);
  const roots = [machineRoot];
  for (const extra of [profileRoot, artifactRoot]) {
    if (!roots.some((root) => extra === root || extra.startsWith(root + sep))) roots.push(extra);
  }
  let canonicalBytes: Buffer | undefined;
  if (lstatSync(canonical, { throwIfNoEntry: false }) !== undefined) {
    const canonicalStat = lstatSync(canonical);
    if (canonicalStat.isSymbolicLink() || !canonicalStat.isFile() || canonicalStat.nlink !== 1) throw new Error("duo-document-membership-mismatch");
    canonicalBytes = readFileSync(canonical);
  }
  const canonicalDigest = canonicalBytes === undefined ? undefined : createHash("sha256").update(canonicalBytes).digest("hex");
  const backups: string[] = [];
  const unauthorized: string[] = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) throw new Error("duo-document-membership-mismatch");
    if (stat.isDirectory()) {
      if (!noSymlinkAncestry(path, new Map())) throw new Error("duo-directory-required");
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("duo-document-membership-mismatch");
    if (path === canonical) return;
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const embedded = canonicalBytes !== undefined && bytes.length !== canonicalBytes.length && bytes.includes(canonicalBytes);
    let envelope: ReturnType<typeof readDuoPublicationEnvelope> | undefined;
    if (stat.size <= MAX_DUO_ENVELOPE_BYTES) {
      try { envelope = readDuoPublicationEnvelope(bytes); } catch { envelope = undefined; }
    }
    const sameProfile = envelope?.profileId === profileId && envelope.purpose === "relay:duo-credential:v1";
    if (!sameProfile && digest !== canonicalDigest && !embedded) return;
    const managedBackup = path.startsWith(backupDirectory + sep) && /^[1-9][0-9]*\.json$/u.test(path.slice(backupDirectory.length + 1));
    if (managedBackup && sameProfile) backups.push(path);
    else unauthorized.push(path);
  };
  for (const root of roots) visit(root);
  return { ...(canonicalDigest === undefined ? {} : { canonicalDigest }), backups, unauthorized };
}

export function createDuoCredentialStore(profile: RuntimeAdmission, machine: RuntimeAdmission, clock: Clock = systemClock) {
  const purpose = issueDuoCredentialPurpose(profile, machine), { binding } = duoCredentialPurposeBinding(purpose);
  const machineRoot = machine.stateRoot, ancestry = new Map<string, DirectoryIdentity>();
  noSymlinkAncestry(join(machineRoot, "machine", "duo-credentials"), ancestry);
  let uncertain: IssuedDuoTransaction | undefined;
  function transact<Result>(mutation: (document: DuoCredentialDocument | undefined) => Readonly<{ document?: DuoCredentialDocument; result: Result }>, phase: "settle" | "durable-intent" = "settle"): Result {
    profile.assertProfileRuntime();
    const transaction = Object.freeze({ profileId: binding.profileId });
    let outcome: Readonly<{ result: Result }> | undefined;
    const issued = { purpose, machineRoot, mutation: (document: DuoCredentialDocument | undefined) => {
      const result = mutation(document); outcome = result; return result;
    }, used: false, publicationStarted: false, ancestry };
    transactions.set(transaction, issued);
    try { if (phase === "durable-intent") machine.commitProfileDuoIntent(transaction); else machine.commitProfileDuo(transaction); }
    catch (error) {
      if (issued.publicationStarted) { uncertain = transaction; throw new DuoCredentialCommitUncertainError(error); }
      throw error;
    }
    if (!issued.used || outcome === undefined) throw new Error("duo-transaction-not-committed");
    return outcome.result;
  }
  function next(document: DuoCredentialDocument | undefined): DuoCredentialDocument {
    return document === undefined ? { schemaVersion: 1, ...binding, revision: 1, credentials: [], retired: [], reservations: [] }
      : { ...document, revision: document.revision + 1 };
  }
  function assertScope(scope: DuoEnrollmentScope): void {
    const now = clock.nowMs();
    if (now < Date.parse(scope.armedAt) || now >= Date.parse(scope.expiresAt)) throw new Error("duo-arm-expired");
    const origin = new URL(scope.origin);
    if (origin.hostname !== scope.rpId && !origin.hostname.endsWith(`.${scope.rpId}`)) throw new Error("duo-rp-origin-mismatch");
  }
  return Object.freeze({
    read(): Readonly<{ state: "never-initialized" | "registered" | "erased"; revision: number; credentials: readonly PublicCredential[] }> {
      return transact(document => ({ result: { state: document === undefined ? "never-initialized" : document.credentials.length === 0 ? "erased" : "registered",
        revision: document?.revision ?? 0, credentials: document?.credentials.map(({ credentialId, state, highWater }) => ({ credentialId, state, highWater })) ?? [] } }));
    },
    enroll(input: { credentialId: string; scope: DuoEnrollmentScope; privateKeyPkcs8: string; publicKeySpki: string }): Readonly<{ credentialId: string; revision: number }> {
      const credential = DuoStoredCredentialSchema.parse({ ...input, state: "pending", createdAt: clock.now().toISOString(), highWater: 0 });
      assertScope(credential.scope);
      for (const value of [credential.privateKeyPkcs8, credential.publicKeySpki]) if (Buffer.from(value, "base64").toString("base64") !== value) throw new Error("duo-key-encoding-invalid");
      const key = createPrivateKey({ key: Buffer.from(credential.privateKeyPkcs8, "base64"), type: "pkcs8", format: "der" });
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
        || !createPublicKey(key).export({ type: "spki", format: "der" }).equals(Buffer.from(credential.publicKeySpki, "base64"))) throw new Error("duo-key-pair-invalid");
      return transact(document => {
        assertScope(credential.scope);
        const updated = next(document);
        if ([...updated.credentials, ...updated.retired].some(row => row.credentialId === credential.credentialId)) throw new Error("duo-credential-id-reused");
        updated.credentials.push(credential);
        return { document: updated, result: { credentialId: credential.credentialId, revision: updated.revision } };
      });
    },
    confirm(credentialId: string, input: DuoEnrollmentScope): Readonly<{ revision: number }> {
      const scope = DuoEnrollmentScopeSchema.parse(input); assertScope(scope);
      return transact(document => {
        assertScope(scope);
        if (document === undefined) throw new Error("duo-pending-credential-required");
        const pending = document.credentials.find(row => row.credentialId === credentialId);
        if (pending?.state !== "pending" || canonicalJsonStringify(pending.scope) !== canonicalJsonStringify(scope)) throw new Error("duo-pending-credential-mismatch");
        const updated = next(document);
        updated.credentials = updated.credentials.map(row => row.credentialId === credentialId ? { ...row, state: "ready", confirmedAt: clock.now().toISOString() } : row);
        return { document: updated, result: { revision: updated.revision } };
      });
    },
    reserve(credentialId: string): Readonly<{ attemptId: string; count: number; revision: number }> {
      return transact(document => {
        if (document === undefined) throw new Error("duo-ready-credential-required");
        const credential = document.credentials.find(row => row.credentialId === credentialId);
        if (credential?.state !== "ready") throw new Error("duo-ready-credential-required");
        const count = Math.max(credential.highWater + 1, Math.floor(clock.nowMs() / 1000));
        if (!Number.isInteger(count) || count < 1 || count > 0xffff_ffff) throw new Error("duo-counter-exhausted");
        const updated = next(document), attemptId = randomUUID();
        updated.credentials = updated.credentials.map(row => row.credentialId === credentialId ? { ...row, highWater: count } : row);
        updated.reservations.push({ attemptId, credentialId, count, reservedAt: clock.now().toISOString() });
        return { document: updated, result: { attemptId, count, revision: updated.revision } };
      });
    },
    interruptReserve(credentialId: string): never {
      transact(document => {
        if (document === undefined) throw new Error("duo-ready-credential-required");
        const credential = document.credentials.find(row => row.credentialId === credentialId);
        if (credential?.state !== "ready") throw new Error("duo-ready-credential-required");
        const count = Math.max(credential.highWater + 1, Math.floor(clock.nowMs() / 1000));
        if (!Number.isInteger(count) || count < 1 || count > 0xffff_ffff) throw new Error("duo-counter-exhausted");
        const updated = next(document), attemptId = randomUUID();
        updated.credentials = updated.credentials.map(row => row.credentialId === credentialId ? { ...row, highWater: count } : row);
        updated.reservations.push({ attemptId, credentialId, count, reservedAt: clock.now().toISOString() });
        return { document: updated, result: { attemptId, count, revision: updated.revision } };
      }, "durable-intent");
      throw new Error("duo-publication-pending");
    },
    recoverInterruptedPublication(): void {
      if (uncertain === undefined) throw new Error("duo-transaction-unissued");
      const transaction = uncertain;
      machine.commitProfileDuo(transaction);
      uncertain = undefined;
    },
    backup(): Readonly<{ revision: number; digest: string }> {
      const current = this.read();
      const canonical = join(machineRoot, "machine", "duo-credentials", `${binding.profileId}.json`);
      const file = readPrivateFile(canonical, { label: "Duo credential", maxBytes: MAX_DUO_ENVELOPE_BYTES });
      if (file === undefined) throw new Error("duo-document-required");
      const digest = createHash("sha256").update(file.bytes).digest("hex");
      const directory = duoPurposeBackupDirectory(machineRoot, binding.profileId);
      ensureChildDirectory(join(machineRoot, "machine"), join(machineRoot, "machine", "duo-purpose-backups"), "Duo credentials", 0o700, 0o700);
      ensureChildDirectory(join(machineRoot, "machine", "duo-purpose-backups"), directory, "Duo credentials", 0o700, 0o700);
      const path = join(directory, `${current.revision}.json`);
      if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) throw new Error("duo-purpose-backup-exists");
      writePrivateStage(path, Buffer.from(file.bytes));
      const again = readPrivateFile(canonical, { label: "Duo credential", maxBytes: MAX_DUO_ENVELOPE_BYTES });
      if (again === undefined || !again.bytes.equals(Buffer.from(file.bytes)) || createHash("sha256").update(readFileSync(path)).digest("hex") !== digest) throw new Error("duo-document-custody-changed");
      return { revision: current.revision, digest };
    },
    restore(backupPath: string): Readonly<{ revision: number }> {
      const directory = duoPurposeBackupDirectory(machineRoot, binding.profileId);
      const resolved = resolve(backupPath);
      if (resolved !== backupPath || !resolved.startsWith(directory + sep)) throw new Error("duo-purpose-restore-unmanaged");
      if (!noSymlinkAncestry(directory, new Map())) throw new Error("duo-directory-required");
      const file = readPrivateFile(resolved, { label: "Duo credential", maxBytes: MAX_DUO_ENVELOPE_BYTES });
      if (file === undefined) throw new Error("duo-document-required");
      const envelope = readDuoPublicationEnvelope(file.bytes);
      if (envelope.profileId !== binding.profileId || envelope.installationId !== binding.installationId || envelope.purpose !== "relay:duo-credential:v1") throw new Error("duo-profile-authority-changed");
      let restored: ReturnType<typeof openDuoCredentialDocument>;
      try { restored = openDuoCredentialDocument(purpose, file.bytes, envelope.revision); }
      catch (error) {
        if (error instanceof Error && error.message === "duo-erased-key-material-refused") throw new Error("duo-purpose-restore-revives-erased-key", { cause: error });
        throw error;
      }
      const before = censusDuoPurposeCopies(machineRoot, profile.stateRoot, binding.profileId, profile.artifactRoot);
      if (before.unauthorized.length > 0) throw new Error("duo-purpose-copy-present");
      const result = transact(current => {
        const floors = new Map<string, number>();
        if (current !== undefined) {
          if (current.credentials.length === 0 && restored.credentials.length > 0) throw new Error("duo-purpose-restore-revives-erased-key");
          for (const row of [...current.credentials, ...current.retired]) floors.set(row.credentialId, Math.max(floors.get(row.credentialId) ?? 0, row.highWater));
          for (const [id, floor] of floors) {
            const row = [...restored.credentials, ...restored.retired].find((candidate) => candidate.credentialId === id);
            if ((row?.highWater ?? 0) < floor) throw new Error("duo-purpose-restore-lowers-burned-count");
          }
        }
        const updated = next(current);
        const retired = new Map<string, number>();
        for (const row of [...(current?.retired ?? []), ...restored.retired]) retired.set(row.credentialId, Math.max(retired.get(row.credentialId) ?? 0, row.highWater));
        updated.retired = [...retired].map(([credentialId, highWater]) => ({ credentialId, highWater }));
        updated.credentials = restored.credentials.map((row) => ({ ...row, highWater: Math.max(row.highWater, floors.get(row.credentialId) ?? 0) }));
        updated.reservations = current?.reservations ?? [];
        return { document: updated, result: { revision: updated.revision } };
      });
      const after = censusDuoPurposeCopies(machineRoot, profile.stateRoot, binding.profileId, profile.artifactRoot);
      if (after.unauthorized.length > 0) throw new Error("duo-purpose-copy-present");
      return result;
    },
    erase(): Readonly<{ revision: number }> {
      const before = censusDuoPurposeCopies(machineRoot, profile.stateRoot, binding.profileId, profile.artifactRoot);
      if (before.unauthorized.length > 0) throw new Error("duo-purpose-copy-present");
      const result = transact(document => {
        const again = censusDuoPurposeCopies(machineRoot, profile.stateRoot, binding.profileId, profile.artifactRoot);
        if (again.unauthorized.length > 0 || canonicalJsonStringify(again.backups) !== canonicalJsonStringify(before.backups)) throw new Error("duo-purpose-copy-present");
        const updated = next(document);
        updated.retired.push(...updated.credentials.map(({ credentialId, highWater }) => ({ credentialId, highWater })));
        updated.credentials = [];
        return { document: updated, result: { revision: updated.revision } };
      });
      const after = censusDuoPurposeCopies(machineRoot, profile.stateRoot, binding.profileId, profile.artifactRoot);
      if (after.unauthorized.length > 0) throw new Error("duo-purpose-copy-present");
      return result;
    },
  });
}
