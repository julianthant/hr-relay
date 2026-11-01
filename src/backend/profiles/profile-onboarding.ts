import { randomUUID } from "node:crypto";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { z } from "zod";
import { DuoEnrollmentScopeSchema } from "../../models/config/duo-credential-store.js";
import { assertFinishedProfileOnboarding, type SignUpDuoAttempt, type SignUpOperation } from "../../models/profiles/profile.js";
import type { ProfileOnboardingMethod, ProfileOnboardingState } from "../../models/profiles/public-profile.js";
import type { Clock } from "../../rules/time/clock.js";
import type { createDuoCredentialStore } from "../storage/configuration/duo-credential-store.js";
import { ProfileSessionRefusedError } from "./profile-errors.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "./onboarding-duo.js";

export function duoAccountMatches(email: string, observed: string): boolean {
  const canonical = email.trim().toLowerCase(), account = observed.trim().toLowerCase();
  const parts = canonical.split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] === "ucsd.edu"
    && (account === canonical || account === parts[0]);
}

export function createProfileOnboarding(input: {
  readonly clock: Clock;
  readonly provider?: ProfileOnboardingDuoProvider;
  readonly failureKind: (error: Error) => "unavailable" | "refused" | "unknown";
  readonly read: (operationId: string) => SignUpOperation;
  readonly update: <T>(operationId: string, change: (operation: SignUpOperation) => Readonly<{ operation: SignUpOperation; result: T }>) => T;
  readonly email: (operation: SignUpOperation) => string;
  readonly credentials: (operation: SignUpOperation) => Readonly<{ userId: string; password: string }>;
  readonly publicState: (operation: SignUpOperation) => ProfileOnboardingState;
  readonly store: (operation: SignUpOperation) => ReturnType<typeof createDuoCredentialStore>;
}) {
  const leases = new Map<string, { revoked: boolean; closed: boolean; attempt: DraftDuoAttempt; capability?: DraftDuoCapability }>();
  const retainedFailures: unknown[] = [];
  const browsers = new Map<string, DraftDuoBrowserOwner>();
  const unavailable = (): never => { throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE"); };
  const requiredDraft = (operation: SignUpOperation) => {
    if (operation.onboarding === undefined || operation.phase !== "applying" && !(operation.phase === "publishing" && operation.onboarding.finish !== undefined)) return unavailable();
    return operation.onboarding;
  };
  function current(attempt: DraftDuoAttempt): { operation: SignUpOperation; receipt: SignUpDuoAttempt } {
    const lease = leases.get(attempt.attemptId), operation = input.read(attempt.operationId), draft = requiredDraft(operation);
    const receipt = draft.attempts.find(entry => entry.attemptId === attempt.attemptId);
    if (draft.abort !== undefined || lease === undefined || lease.revoked || operation.profileId !== attempt.profileId || draft.accountId !== attempt.accountId
      || draft.generation !== attempt.generation || receipt === undefined || receipt.generation !== draft.generation
      || receipt.method !== attempt.method || receipt.state !== "pending" && receipt.state !== "complete"
      || Date.parse(attempt.expiresAt) <= input.clock.nowMs()) return unavailable();
    return { operation, receipt };
  }
  function browserOwner(operationId: string): DraftDuoBrowserOwner {
    const existing = browsers.get(operationId);
    if (existing) { existing.assertCurrent(); return existing; }
    const operation = input.read(operationId), draft = requiredDraft(operation);
    const currentDraft = () => {
      const latest = input.read(operationId), current = requiredDraft(latest);
      if (latest.profileId !== operation.profileId || current.accountId !== draft.accountId || current.generation !== draft.generation
        || current.abort !== undefined || current.finish !== undefined) return unavailable();
      return latest;
    };
    const browser: DraftDuoBrowserOwner = Object.freeze({ operationId, profileId: operation.profileId,
      accountId: draft.accountId, generation: draft.generation,
      assertCurrent() { currentDraft(); },
      async acquireCredentials() { const value = input.credentials(currentDraft()); currentDraft(); return value; },
      readState() { return input.publicState(currentDraft()); },
      async start(method: ProfileOnboardingMethod) { currentDraft(); await owner.start(operationId, method); currentDraft(); },
      async cancel(method: ProfileOnboardingMethod, attemptId: string) { currentDraft(); await owner.cancelAttempt(operationId, method, attemptId); currentDraft(); },
      confirm(method: ProfileOnboardingMethod, attemptId: string) { currentDraft(); owner.confirm(operationId, method, attemptId); currentDraft(); },
    });
    browsers.set(operationId, browser); return browser;
  }
  function updateAttempt<T>(attempt: DraftDuoAttempt, change: (operation: SignUpOperation, receipt: SignUpDuoAttempt) => Readonly<{ receipt: SignUpDuoAttempt; result: T }>): T {
    current(attempt);
    return input.update(attempt.operationId, operation => {
      const draft = requiredDraft(operation), receipt = draft.attempts.find(entry => entry.attemptId === attempt.attemptId);
      if (draft.generation !== attempt.generation || receipt === undefined) return unavailable();
      const outcome = change(operation, receipt);
      return { operation: { ...operation, onboarding: { ...draft, attempts: draft.attempts.map(entry => entry.attemptId === attempt.attemptId ? outcome.receipt : entry) } }, result: outcome.result };
    });
  }
  function completeIfProved(receipt: SignUpDuoAttempt): SignUpDuoAttempt {
    if (receipt.ceremony === undefined || receipt.scope === undefined) return receipt;
    if (receipt.portal !== undefined && receipt.ceremony.credentialId !== receipt.portal.credentialId) return unavailable();
    const confirmed = receipt.operatorConfirmedAt !== undefined || receipt.method === "key" && receipt.portal?.acceptance === "exact-credential-request";
    if (!confirmed) return receipt;
    if (receipt.method === "key") {
      if (receipt.ceremony.mechanism !== "fast-duo") return unavailable();
    } else if (receipt.portal?.acceptance !== "portal-accepted") return receipt;
    else if (receipt.ceremony.mechanism !== "native-platform" || !receipt.ceremony.softwareInterceptionDisabled) return unavailable();
    return { ...receipt, state: "complete" };
  }
  function settleAttempt(attempt: DraftDuoAttempt): void {
    const { operation, receipt } = current(attempt), completed = completeIfProved(receipt);
    if (completed.state !== "complete") return;
    if (attempt.method === "key") {
      if (receipt.scope === undefined) return unavailable();
      const store = input.store(operation), credential = store.readForScope(receipt.scope).find(entry => entry.credentialId === receipt.ceremony?.credentialId);
      if (credential?.state === "pending" && receipt.scope !== undefined) store.confirm(credential.credentialId, receipt.scope);
      else if (credential?.state !== "ready") return unavailable();
    }
    updateAttempt(attempt, (_operation, latest) => ({ receipt: completeIfProved(latest), result: undefined }));
  }
  async function reportFailure(attempt: DraftDuoAttempt, error: Error): Promise<void> {
    const kind = input.failureKind(error);
    if (kind === "unknown" && !retainedFailures.includes(error)) retainedFailures.push(error);
    try {
      input.update(attempt.operationId, operation => {
        const draft = requiredDraft(operation);
        if (draft.generation !== attempt.generation || !draft.attempts.some(entry => entry.attemptId === attempt.attemptId)) return unavailable();
        return { operation: { ...operation, onboarding: { ...draft, attempts: draft.attempts.map(entry => entry.attemptId === attempt.attemptId
          ? { ...entry, state: kind === "unknown" ? "unknown" as const : "closed" as const } : entry) } }, result: undefined };
      });
    } catch (failure) { retainedFailures.push(error, failure); throw new AggregateError([error, failure], "profile-onboarding-failure-retention-unproved", { cause: failure }); }
    const lease = leases.get(attempt.attemptId); if (lease !== undefined) lease.revoked = true;
  }
  async function bind(attempt: DraftDuoAttempt, observed: DraftDuoObservedContext): Promise<DraftDuoCapability> {
    const { operation, receipt } = current(attempt);
    if (receipt.scope !== undefined || !duoAccountMatches(input.email(operation), observed.accountName)) return unavailable();
    const scope = DuoEnrollmentScopeSchema.parse({ armId: attempt.attemptId, contextId: observed.contextId, tabId: observed.tabId,
      accountId: attempt.accountId, origin: observed.origin, rpId: observed.rpId,
      armedAt: new Date(Date.parse(attempt.expiresAt) - 600_000).toISOString(), expiresAt: attempt.expiresAt });
    const origin = new URL(scope.origin);
    if (scope.rpId !== "duosecurity.com" || origin.hostname !== scope.rpId && !origin.hostname.endsWith(`.${scope.rpId}`)) return unavailable();
    updateAttempt(attempt, (_operation, prior) => ({ receipt: { ...prior, scope }, result: undefined }));
    const assertCurrent = () => { const latest = current(attempt).receipt;
      if (JSON.stringify(latest.scope) !== JSON.stringify(scope)) return unavailable();
    };
    const capability: DraftDuoCapability = Object.freeze<DraftDuoCapability>({ attempt, scope, assertCurrent,
      async persistPending(credential) {
        assertCurrent(); if (attempt.method !== "key") return unavailable();
        const latest = current(attempt).operation;
        const store = input.store(latest);
        if (store.readForScope(scope).length !== 0) return unavailable();
        const result = store.enroll({ credentialId: credential.credentialId, scope,
          privateKeyPkcs8: credential.privateKeyPkcs8, publicKeySpki: credential.publicKeySpki,
          authenticator: { ...(credential.userHandle === undefined ? {} : { userHandle: credential.userHandle }),
            transport: credential.transport, isResidentCredential: credential.isResidentCredential } });
        assertCurrent(); return { revision: result.revision };
      },
      async signAssertion(request) { assertCurrent(); if (attempt.method !== "key" || request.requestId === attempt.attemptId) return unavailable();
        const result = await input.store(current(attempt).operation).signForScope(request, scope);
        assertCurrent(); return result;
      },
      async recordCeremony(proof) {
        assertCurrent(); z.string().min(1).parse(proof.credentialId); z.string().min(1).parse(proof.requestId);
        if (attempt.method === "key" ? proof.mechanism !== "fast-duo" : proof.mechanism !== "native-platform" || !proof.softwareInterceptionDisabled) return unavailable();
        updateAttempt(attempt, (_latest, prior) => {
          if (prior.ceremony !== undefined && JSON.stringify(prior.ceremony) !== JSON.stringify(proof)) return unavailable();
          return { receipt: { ...prior, ceremony: proof }, result: undefined };
        });
        settleAttempt(attempt);
      },
      async recordPortalAcceptance(proof) {
        assertCurrent(); z.string().min(1).parse(proof.credentialId); z.string().min(1).parse(proof.requestId);
        if (attempt.method === "touch" && proof.acceptance !== "portal-accepted") return unavailable();
        updateAttempt(attempt, (_latest, prior) => {
          if (prior.portal !== undefined && JSON.stringify(prior.portal) !== JSON.stringify(proof)) return unavailable();
          return { receipt: { ...prior, portal: proof }, result: undefined };
        });
        settleAttempt(attempt);
      },
      async retainUnknown() {
        input.update(attempt.operationId, operation => {
          const draft = requiredDraft(operation);
          if (draft.generation !== attempt.generation || !draft.attempts.some(entry => entry.attemptId === attempt.attemptId)) return unavailable();
          const receipt = draft.attempts.find(entry => entry.attemptId === attempt.attemptId);
          if (attempt.method === "key" && receipt?.state === "complete" && completeIfProved(receipt).state === "complete"
            && receipt.scope !== undefined && input.store(operation).readForScope(receipt.scope)
              .some(entry => entry.credentialId === receipt.ceremony?.credentialId && entry.state === "ready")) {
            return { operation, result: undefined };
          }
          return { operation: { ...operation, onboarding: { ...draft, attempts: draft.attempts.map(entry => entry.attemptId === attempt.attemptId
            ? { ...entry, state: "unknown" as const } : entry) } }, result: undefined };
        });
        const lease = leases.get(attempt.attemptId); if (lease !== undefined) lease.revoked = true;
      },
    });
    const lease = leases.get(attempt.attemptId); if (lease === undefined || lease.revoked) return unavailable();
    lease.capability = capability;
    return capability;
  }
  const owner = {
    async showBrowser(operationId: string): Promise<void> {
      if (!input.provider) return unavailable();
      const browser = browserOwner(operationId); await input.provider.showBrowser(browser); browser.assertCurrent();
    },
    async openPortal(operationId: string): Promise<void> {
      if (!input.provider) return unavailable();
      const browser = browserOwner(operationId); await input.provider.openPortal(browser); browser.assertCurrent();
    },
    async start(operationId: string, method: ProfileOnboardingMethod): Promise<void> {
      const provider = input.provider; if (provider === undefined) return unavailable();
      const before = requiredDraft(input.read(operationId));
      const prior = before.attempts.filter(entry => entry.generation === before.generation && entry.method !== method && entry.providerClosedAt === undefined);
      if (prior.some(entry => entry.state !== "complete")) return unavailable();
      for (const receipt of prior) await owner.cancelAttempt(operationId, receipt.method, receipt.attemptId);
      const attempt = input.update(operationId, operation => {
        const draft = requiredDraft(operation);
        if (draft.abort !== undefined || draft.finish !== undefined) return unavailable();
        if (draft.attempts.some(entry => entry.state === "unknown" || entry.method === method
          && (entry.state !== "closed" || entry.providerClosedAt === undefined && leases.get(entry.attemptId)?.closed !== true))) return unavailable();
        const attempt: DraftDuoAttempt = Object.freeze({ operationId, profileId: operation.profileId, accountId: draft.accountId,
          generation: draft.generation, attemptId: randomUUID(), method, expiresAt: new Date(input.clock.nowMs() + 600_000).toISOString() });
        return { operation: { ...operation, onboarding: { ...draft, attempts: [...draft.attempts, {
          attemptId: attempt.attemptId, generation: attempt.generation, method, expiresAt: IsoInstantSchema.parse(attempt.expiresAt), state: "pending" as const }] } }, result: attempt };
      });
      leases.set(attempt.attemptId, { revoked: false, closed: false, attempt });
      try { await provider.showBrowser(browserOwner(operationId)); await provider.start(attempt, observed => bind(attempt, observed), error => reportFailure(attempt, error)); }
      catch (error) {
        if (error instanceof Error) await reportFailure(attempt, error);
        else { retainedFailures.push(error); await reportFailure(attempt, new Error("profile-onboarding-provider-failure", { cause: error })); }
        try { await owner.cancelAttempt(operationId, method, attempt.attemptId); }
        catch (cleanup) {
          retainedFailures.push(error, cleanup);
          throw new AggregateError([error, cleanup], "profile-onboarding-provider-closure-unproved", { cause: cleanup });
        }
        if (error instanceof Error && input.failureKind(error) === "unavailable") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE", { cause: error });
        if (error instanceof Error && input.failureKind(error) === "refused") throw new ProfileSessionRefusedError("PROFILE_SIGN_IN_REFUSED", { cause: error });
        throw error;
      }
    },
    confirm(operationId: string, method: ProfileOnboardingMethod, attemptId: string): void {
      const lease = leases.get(attemptId); if (lease === undefined || lease.attempt.operationId !== operationId || lease.attempt.method !== method) return unavailable();
      updateAttempt(lease.attempt, (_operation, receipt) => ({ receipt: { ...receipt, operatorConfirmedAt: IsoInstantSchema.parse(input.clock.now().toISOString()) }, result: undefined }));
      settleAttempt(lease.attempt);
    },
    async cancelAttempt(operationId: string, method: ProfileOnboardingMethod, attemptId: string): Promise<void> {
      const provider = input.provider, operation = input.read(operationId), draft = requiredDraft(operation);
      const receipt = draft.attempts.find(entry => entry.attemptId === attemptId && entry.method === method && entry.generation === draft.generation);
      const lease = leases.get(attemptId);
      if (provider === undefined || receipt === undefined || lease?.attempt.operationId !== operationId) return unavailable();
      lease.revoked = true;
      const closure = await provider.cancel(lease.attempt);
      if (closure.state === "closed") lease.closed = true;
      input.update(operationId, latest => {
        const current = requiredDraft(latest);
        if (current.generation !== draft.generation) return unavailable();
        return { operation: { ...latest, onboarding: { ...current, attempts: current.attempts.map(entry => {
          if (entry.attemptId !== attemptId) return entry;
          if (closure.state !== "closed" || entry.state === "unknown" || entry.scope !== undefined && entry.state !== "complete") return { ...entry, state: "unknown" as const };
          return { ...entry, state: entry.state === "complete" ? "complete" as const : "closed" as const, providerClosedAt: IsoInstantSchema.parse(input.clock.now().toISOString()) };
        }) } }, result: undefined };
      });
      if (closure.state !== "closed") return unavailable();
    },
    async drain(operationId: string): Promise<void> {
      const operation = input.read(operationId), draft = requiredDraft(operation), provider = input.provider;
      const pending = draft.attempts.filter(entry => entry.generation === draft.generation
        && entry.providerClosedAt === undefined && leases.get(entry.attemptId)?.closed !== true);
      if (pending.length > 0 && provider === undefined) return unavailable();
      for (const receipt of pending) {
        const lease = leases.get(receipt.attemptId); if (lease === undefined) return unavailable();
        lease.revoked = true;
        const closure = await provider!.cancel(lease.attempt);
        if (closure.state !== "closed") return unavailable();
        lease.closed = true;
        input.update(operationId, latest => { const current = requiredDraft(latest);
          if (current.generation !== draft.generation) return unavailable();
          return { operation: { ...latest, onboarding: { ...current, attempts: current.attempts.map(entry => entry.attemptId === receipt.attemptId
            ? { ...entry, providerClosedAt: IsoInstantSchema.parse(input.clock.now().toISOString()) } : entry) } }, result: undefined };
        });
      }
      const browser = browsers.get(operationId);
      if (browser !== undefined) {
        if (provider === undefined || (await provider.closeBrowser(browser)).state !== "closed") return unavailable();
        browsers.delete(operationId);
      }
    },
    recoverClosed(operationId: string): void {
      const operation = input.read(operationId), draft = requiredDraft(operation);
      if (draft.finish !== undefined || browsers.has(operationId) || leases.size > 0) return unavailable();
      input.update(operationId, latest => ({ operation: { ...latest, onboarding: { ...requiredDraft(latest), attempts: draft.attempts.map(entry => ({ ...entry,
        providerClosedAt: entry.providerClosedAt ?? IsoInstantSchema.parse(input.clock.now().toISOString()) })) } }, result: undefined }));
    },
    assertAbortable(operationId: string): void {
      const draft = requiredDraft(input.read(operationId));
      if (draft.finish !== undefined || draft.attempts.some(entry => entry.providerClosedAt === undefined)) return unavailable();
      if (retainedFailures.length > 0) throw new AggregateError(retainedFailures, "profile-onboarding-custody-unproved");
    },
    verifyFinish(operationId: string): SignUpOperation {
      if (retainedFailures.length > 0) throw new AggregateError(retainedFailures, "profile-onboarding-custody-unproved");
      const operation = input.read(operationId); assertFinishedProfileOnboarding(operation);
      const key = requiredDraft(operation).attempts.findLast(entry => entry.method === "key" && entry.generation === operation.onboarding?.generation);
      if (key?.scope === undefined) return unavailable();
      const credential = input.store(operation).readForScope(key.scope).find(entry => entry.credentialId === key.ceremony?.credentialId);
      if (credential?.state !== "ready") return unavailable();
      return operation;
    },
  };
  return { ...owner,
    hasLiveAttempt(attemptId: string): boolean { const lease = leases.get(attemptId); return lease !== undefined && !lease.revoked && !lease.closed; },
    async close(): Promise<void> {
      for (const operationId of new Set([...browsers.keys(), ...[...leases.values()].filter(lease => !lease.closed).map(lease => lease.attempt.operationId)])) await owner.drain(operationId);
    },
    assertClosed(): void {
      if ([...leases.values()].some(lease => !lease.closed)) return unavailable();
      if (browsers.size > 0) return unavailable();
      if (retainedFailures.length > 0) throw new AggregateError(retainedFailures, "profile-onboarding-custody-unproved");
    },
  };
}
