import { createHash } from "node:crypto";
import { z } from "zod";
import { DuoCredentialRecordSchema, DuoEnrollmentScopeSchema, DuoStoredCredentialSchema, type DuoEnrollmentScope, type DuoReenrolCommitIntent } from "../../../models/config/duo-credential-store.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { CanonicalCredentialError, createCanonicalCredentials } from "./canonical-credential-store.js";
import { createDuoAssertion, validateDuoKeyPair, DuoAssertionRequestSchema, type DuoAssertionRequest, type DuoPublicCredential, type DuoPlatformCredential } from "./duo-signing.js";

export class DuoCredentialError extends Error {
  readonly code: "DUO_CREDENTIAL_BUSY" | "DUO_CREDENTIAL_CONFLICT" | "DUO_CREDENTIAL_UNCERTAIN" | "DUO_CREDENTIAL_UNAVAILABLE";
  constructor(error: CanonicalCredentialError) {
    const code = ({
      CREDENTIAL_BUSY: "DUO_CREDENTIAL_BUSY",
      CREDENTIAL_CONFLICT: "DUO_CREDENTIAL_CONFLICT",
      CREDENTIAL_UNCERTAIN: "DUO_CREDENTIAL_UNCERTAIN",
      CREDENTIAL_UNAVAILABLE: "DUO_CREDENTIAL_UNAVAILABLE",
    } as const)[error.code];
    super(ERROR_CATALOG[code].text, { cause: error });
    this.name = "DuoCredentialError";
    this.code = code;
  }
}

export function createDuoCredentialStore(admission: RuntimeAdmission, clock: Clock = systemClock) {
  const owner = createCanonicalCredentials(admission);
  const settle = <T>(operation: () => T): T => {
    try { return operation(); }
    catch (error) { if (error instanceof CanonicalCredentialError) throw new DuoCredentialError(error); throw error; }
  };
  const access = <T>(operation: () => T): T => settle(() => { owner.assertCurrent(); return operation(); });
  const read = () => access(() => {
    const frame = owner.readRecord("duo");
    return { revision: frame?.revision ?? 0, record: frame === undefined ? { credentials: [] } : DuoCredentialRecordSchema.parse(frame.value) };
  });
  const assertScope = (scope: DuoEnrollmentScope): void => {
    DuoEnrollmentScopeSchema.parse(scope);
    if (clock.nowMs() < Date.parse(scope.armedAt) || clock.nowMs() >= Date.parse(scope.expiresAt)) throw new Error("duo-arm-expired");
    const origin = new URL(scope.origin);
    if (scope.rpId !== "duosecurity.com" || origin.hostname !== scope.rpId && !origin.hostname.endsWith(`.${scope.rpId}`)) throw new Error("duo-rp-origin-mismatch");
  };
  const required = (credentialId: string, scope?: DuoEnrollmentScope) => {
    if (scope !== undefined) assertScope(scope);
    const credential = read().record.credentials.find(value => value.credentialId === credentialId);
    if (credential === undefined || credential.authenticator === undefined
      || scope !== undefined && canonicalJsonStringify(credential.scope) !== canonicalJsonStringify(scope)) throw new Error("duo-credential-scope-mismatch");
    return { credential, material: { credentialId, privateKeyPkcs8: credential.privateKeyPkcs8, publicKeySpki: credential.publicKeySpki,
      createdAt: credential.createdAt, ...credential.authenticator } };
  };
  const publicCredentials = (): readonly DuoPublicCredential[] => read().record.credentials.filter(value => value.state === "ready").map(value => {
    if (value.authenticator === undefined) throw new Error("duo-authenticator-required");
    return { credentialId: value.credentialId, rpId: "duosecurity.com", ...value.authenticator };
  });
  const signAssertion = (request: DuoAssertionRequest, scope: DuoEnrollmentScope | undefined, state: "ready" | "staged") => access(() => {
    const parsed = DuoAssertionRequestSchema.parse(request);
    const { credential, material } = required(parsed.credentialId, scope);
    if (credential.state !== state || credential.scope.rpId !== parsed.rpId
      || scope !== undefined && parsed.origin !== scope.origin) throw new Error(`duo-${state}-credential-required`);
    const reservation = state === "ready" ? owner.reserveDuoCounter(parsed.credentialId, parsed.requestId)
      : owner.reserveStagedDuoCounter(parsed.credentialId, parsed.requestId, credential.scope);
    owner.assertCurrent();
    const result = createDuoAssertion(material, parsed, reservation.count);
    owner.assertCurrent();
    return result;
  });
  return Object.freeze({
    assertCurrent() { access(() => undefined); },
    identity() {
      const credentials = read().record.credentials.filter(value => value.state === "ready").map(({ credentialId, publicKeySpki }) => ({ credentialId, publicKeySpki }))
        .sort((a, b) => a.credentialId.localeCompare(b.credentialId));
      if (credentials.length === 0) throw new Error("duo-ready-credential-required");
      return FingerprintSchema.parse(createHash("sha256").update(canonicalJsonStringify(credentials)).digest("hex"));
    },
    credentials: publicCredentials,
    platformCredentials(): readonly DuoPlatformCredential[] {
      return access(() => read().record.credentials.filter(credential => credential.state === "ready").flatMap((credential): DuoPlatformCredential[] => {
        const authenticator = credential.authenticator;
        if (authenticator === undefined) throw new Error("duo-authenticator-required");
        if (authenticator.transport !== "internal") return [];
        validateDuoKeyPair(credential.privateKeyPkcs8, credential.publicKeySpki);
        return [{ credentialId: credential.credentialId, rpId: "duosecurity.com", ...authenticator,
          transport: "internal", privateKeyPkcs8: credential.privateKeyPkcs8, signCount: owner.readDuoCounter(credential.credentialId) }];
      }));
    },
    read() {
      const { revision, record } = read();
      return { state: revision === 0 ? "never-initialized" as const : "registered" as const, revision,
        credentials: record.credentials.map(({ credentialId, state }) => ({ credentialId, state })) };
    },
    readForScope(scope: DuoEnrollmentScope) {
      const parsed = DuoEnrollmentScopeSchema.parse(scope);
      return read().record.credentials.filter(row => canonicalJsonStringify(row.scope) === canonicalJsonStringify(parsed)).map(({ credentialId, state }) => ({ credentialId, state }));
    },
    enroll(input: { credentialId: string; scope: DuoEnrollmentScope; privateKeyPkcs8: string; publicKeySpki: string;
      authenticator?: { userHandle?: string; transport: "internal" | "usb"; isResidentCredential: boolean }; initialSignCount?: number }) {
      const { initialSignCount, ...material } = input;
      if (material.authenticator?.transport === "internal") z.number().int().min(0).max(0xffff_ffff).parse(initialSignCount);
      else if (initialSignCount !== undefined) throw new Error("duo-platform-counter-unexpected");
      const credential = DuoStoredCredentialSchema.parse({ ...material, state: "pending", createdAt: clock.now().toISOString() });
      assertScope(credential.scope);
      validateDuoKeyPair(credential.privateKeyPkcs8, credential.publicKeySpki);
      return access(() => {
        const { revision, record } = read();
        if (record.credentials.some(row => row.credentialId === credential.credentialId)) throw new Error("duo-credential-id-reused");
        const next = owner.replaceRecord("duo", revision === 0 ? null : revision, DuoCredentialRecordSchema.parse({ credentials: [...record.credentials, credential] }));
        if (initialSignCount !== undefined) owner.initializePendingDuoCounter(credential.credentialId, initialSignCount);
        return { credentialId: credential.credentialId, revision: next.revision };
      });
    },
    confirm(credentialId: string, scope: DuoEnrollmentScope) {
      assertScope(scope);
      return access(() => {
        const { revision, record } = read();
        const pending = record.credentials.find(row => row.credentialId === credentialId);
        if (pending?.state !== "pending" || canonicalJsonStringify(pending.scope) !== canonicalJsonStringify(scope)) throw new Error("duo-pending-credential-mismatch");
        if (pending.authenticator?.transport === "internal") owner.readDuoCounter(credentialId);
        const credentials = record.credentials.map(row => row === pending ? { ...row, state: "ready", confirmedAt: clock.now().toISOString() } : row);
        return { revision: owner.replaceRecord("duo", revision, DuoCredentialRecordSchema.parse({ credentials })).revision };
      });
    },
    provision(credentialId: string, scope: DuoEnrollmentScope) { return required(credentialId, scope).material; },
    reserveForAttempt(credentialId: string, requestId: string, scope: DuoEnrollmentScope) {
      z.uuid().parse(requestId);
      if (required(credentialId, scope).credential.state !== "ready") throw new Error("duo-ready-credential-required");
      return access(() => owner.reserveDuoCounter(credentialId, requestId));
    },
    async sign(request: DuoAssertionRequest) { return signAssertion(request, undefined, "ready"); },
    async signForScope(request: DuoAssertionRequest, scope: DuoEnrollmentScope) { return signAssertion(request, scope, "ready"); },
    stage(credentialId: string, scope: DuoEnrollmentScope) {
      assertScope(scope);
      return access(() => owner.stageDuoCredential(credentialId, scope, clock.now().toISOString()));
    },
    async signStagedForScope(request: DuoAssertionRequest, scope: DuoEnrollmentScope) { assertScope(scope); return signAssertion(request, scope, "staged"); },
    discardDraft(accountId: string) { settle(() => owner.discardDuoDraft(accountId)); },
    prepareReenrolCommit(accountId: string) { return access(() => owner.prepareDuoReenrolCommit(accountId)); },
    inspectReenrolCommit(intent: DuoReenrolCommitIntent) { return settle(() => owner.inspectDuoReenrolCommit(intent)); },
    commitReenrol(intent: DuoReenrolCommitIntent) { return settle(() => owner.commitDuoReenrol(intent)); },
  });
}
