import { hasUnprovedSourceClosure } from "../storage/source-closure.js";
import { randomUUID } from "node:crypto";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { z } from "zod";
import { DuoEnrollmentScopeSchema } from "../../models/config/duo-credential-store.js";
import { assertFinishedProfileOnboarding, ProfileOnboardingDuoFailureSchema, type ProfileOnboardingDuoEvent, type ProfileOnboardingDuoFailure, type SignUpDuoAttempt, type SignUpOperation } from "../../models/profiles/profile.js";
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
  readonly failureDiagnostic: (error: Error) => ProfileOnboardingDuoFailure;
  readonly onFailure: (attempt: DraftDuoAttempt, failure: ProfileOnboardingDuoFailure) => void;
  readonly onEvent: (operation: SignUpOperation, event: ProfileOnboardingDuoEvent) => void;
  readonly read: (operationId: string) => SignUpOperation;
  readonly update: <T>(operationId: string, change: (operation: SignUpOperation) => Readonly<{ operation: SignUpOperation; result: T }>) => T;
  readonly email: (operation: SignUpOperation) => string;
  readonly publicState: (operation: SignUpOperation) => ProfileOnboardingState;
  readonly store: (operation: SignUpOperation) => ReturnType<typeof createDuoCredentialStore>;
}) {
  type Lease = { revoked: boolean; closed: boolean; opening: boolean; attempt: DraftDuoAttempt; browserGeneration?: number; browserClosureProved?: true; capability?: DraftDuoCapability };
  const leases = new Map<string, Lease>();
  const retainedFailures: { error: unknown; lease?: Lease }[] = [];
  const retainCustody = (error: unknown, attempt?: DraftDuoAttempt) => {
    const lease = attempt === undefined ? undefined : leases.get(attempt.attemptId);
    if (!retainedFailures.some(entry => entry.error === error)) retainedFailures.push({ error, lease });
  };
  const assertCustody = () => {
    const pending = retainedFailures.filter(entry => entry.lease?.browserClosureProved !== true || hasUnprovedSourceClosure(entry.error)).map(entry => entry.error);
    if (pending.length) throw new AggregateError(pending, "profile-onboarding-custody-unproved");
  };
  function recoveredLeases(browser: DraftDuoBrowserOwner, generation: number) {
    return [...leases.values()].filter(lease => lease.browserGeneration === generation && lease.attempt.operationId === browser.operationId
      && lease.attempt.profileId === browser.profileId && lease.attempt.accountId === browser.accountId && lease.attempt.generation === browser.generation);
  }
  function settleCustody(recovered: readonly Lease[]): void {
    for (const lease of recovered) lease.browserClosureProved = true;
  }
  const browserHolds = new Map<string, ProfileSessionRefusedError>();
  const assertBrowserAvailable = (operationId: string) => { const hold = browserHolds.get(operationId); if (hold) throw hold; };
  const retainBrowserHold = (operationId: string, cause?: unknown) => {
    const previous = browserHolds.get(operationId);
    const hold = new ProfileSessionRefusedError("BROWSER_CLOSURE_UNPROVED", { cause: previous === undefined ? cause : new AggregateError([previous, cause], "onboarding-browser-recovery-unproved") }); browserHolds.set(operationId, hold); return hold;
  };
  async function showOwnedBrowser(provider: ProfileOnboardingDuoProvider, browser: DraftDuoBrowserOwner): Promise<void> {
    try { await provider.showBrowser(browser); }
    catch (cause) {
      if (hasUnprovedSourceClosure(cause)) throw retainBrowserHold(browser.operationId, cause);
      const state = provider.browserState?.(browser.operationId);
      if (state?.state === "failed") throw new ProfileSessionRefusedError(state.code, { cause });
      throw cause;
    }
    browser.assertCurrent();
  }
  const browsers = new Map<string, DraftDuoBrowserOwner>();
  let transition: string | undefined;
  let recovery: { operationId: string; generation: number; work: Promise<void> } | undefined;
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
      readState() { return input.publicState(currentDraft()); },
      reportEvent(event: ProfileOnboardingDuoEvent) { input.onEvent(currentDraft(), event); },
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
    const confirmed = receipt.operatorConfirmedAt !== undefined || receipt.portal?.acceptance === "portal-accepted"
      || receipt.method === "key" && receipt.portal?.acceptance === "exact-credential-request";
    if (!confirmed) return receipt;
    if (receipt.method === "key") {
      if (receipt.ceremony.mechanism !== "fast-duo") return unavailable();
    } else if ((receipt.ceremony.mechanism !== "native-platform" && receipt.ceremony.mechanism !== "chromium-platform") || !receipt.ceremony.softwareInterceptionDisabled) return unavailable();
    return { ...receipt, state: "complete" };
  }
  function provedComplete(operation: SignUpOperation, receipt: SignUpDuoAttempt): boolean {
    return (receipt.method === "key" || receipt.ceremony?.mechanism === "chromium-platform")
      && receipt.state === "complete" && completeIfProved(receipt).state === "complete"
      && receipt.scope !== undefined && input.store(operation).readForScope(receipt.scope)
        .some(entry => entry.credentialId === receipt.ceremony?.credentialId && entry.state === "ready");
  }
  function settleAttempt(attempt: DraftDuoAttempt): void {
    const { operation, receipt } = current(attempt), completed = completeIfProved(receipt);
    if (completed.state !== "complete") return;
    if (attempt.method === "key" || receipt.ceremony?.mechanism === "chromium-platform") {
      if (receipt.scope === undefined) return unavailable();
      const store = input.store(operation), credential = store.readForScope(receipt.scope).find(entry => entry.credentialId === receipt.ceremony?.credentialId);
      if (credential?.state === "pending" && receipt.scope !== undefined) store.confirm(credential.credentialId, receipt.scope);
      else if (credential?.state !== "ready") return unavailable();
    }
    updateAttempt(attempt, (_operation, latest) => ({ receipt: completeIfProved(latest), result: undefined }));
  }
  async function reportFailure(attempt: DraftDuoAttempt, error: Error): Promise<void> {
    const failure = ProfileOnboardingDuoFailureSchema.parse(input.failureDiagnostic(error)), kind = failure.kind;
    let complete = false;
    try {
      const recorded = input.update(attempt.operationId, operation => {
        const draft = requiredDraft(operation), receipt = draft.attempts.find(entry => entry.attemptId === attempt.attemptId);
        if (draft.generation !== attempt.generation || receipt === undefined) return unavailable();
        complete = provedComplete(operation, receipt);
        if (complete) return { operation, result: false };
        return { operation: { ...operation, onboarding: { ...draft, attempts: draft.attempts.map(entry => entry.attemptId === attempt.attemptId
          ? { ...entry, failure: entry.failure ?? failure, state: kind === "unknown" ? "unknown" as const : "closed" as const } : entry) } }, result: receipt.failure === undefined };
      });
      if (kind === "unknown" && !complete) retainCustody(error, attempt);
      if (recorded) input.onFailure(attempt, failure);
    } catch (failure) { retainCustody(error); retainCustody(failure); throw new AggregateError([error, failure], "profile-onboarding-failure-retention-unproved", { cause: failure }); }
    const lease = leases.get(attempt.attemptId); if (lease !== undefined) lease.revoked = true;
  }
  async function bind(attempt: DraftDuoAttempt, observed: DraftDuoObservedContext): Promise<DraftDuoCapability> {
    if (current(attempt).receipt.scope !== undefined) return unavailable();
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
        assertCurrent(); if (attempt.method === "touch" && credential.transport !== "internal") return unavailable();
        const latest = current(attempt).operation;
        const store = input.store(latest);
        if (store.readForScope(scope).length !== 0) return unavailable();
        const result = store.enroll({ credentialId: credential.credentialId, scope,
          privateKeyPkcs8: credential.privateKeyPkcs8, publicKeySpki: credential.publicKeySpki,
          ...(credential.initialSignCount === undefined ? {} : { initialSignCount: credential.initialSignCount }),
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
        if (attempt.method === "key" ? proof.mechanism !== "fast-duo" : (proof.mechanism !== "native-platform" && proof.mechanism !== "chromium-platform") || !proof.softwareInterceptionDisabled) return unavailable();
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
      async retainUnknown(diagnostic) {
        const failure = ProfileOnboardingDuoFailureSchema.parse(diagnostic);
        const retained = input.update(attempt.operationId, operation => {
          const draft = requiredDraft(operation);
          if (draft.generation !== attempt.generation || !draft.attempts.some(entry => entry.attemptId === attempt.attemptId)) return unavailable();
          const receipt = draft.attempts.find(entry => entry.attemptId === attempt.attemptId);
          if (receipt !== undefined && provedComplete(operation, receipt)) return { operation, result: false };
          return { operation: { ...operation, onboarding: { ...draft, attempts: draft.attempts.map(entry => entry.attemptId === attempt.attemptId
            ? { ...entry, failure: entry.failure ?? failure, state: "unknown" as const } : entry) } }, result: receipt?.failure === undefined };
        });
        if (retained) input.onFailure(attempt, failure);
        const lease = leases.get(attempt.attemptId); if (lease !== undefined) lease.revoked = true;
      },
    });
    const lease = leases.get(attempt.attemptId); if (lease === undefined || lease.revoked) return unavailable();
    lease.capability = capability;
    return capability;
  }
  const owner = {
    assertBrowserAvailable,
    async showBrowser(operationId: string): Promise<void> {
      assertBrowserAvailable(operationId);
      if (transition !== undefined || recovery !== undefined) return unavailable();
      if (!input.provider) return unavailable();
      const browser = browserOwner(operationId);
      await showOwnedBrowser(input.provider, browser);
    },
    browserState(operationId: string) { return input.provider?.browserState?.(operationId) ?? { state: "checking" as const, generation: 0 }; },
    async reopenBrowser(operationId: string, generation: number): Promise<void> {
      if (recovery !== undefined) {
        if (recovery.operationId !== operationId || recovery.generation !== generation) return unavailable();
        return recovery.work;
      }
      const provider = input.provider, recover = provider?.recoverBrowser?.bind(provider);
      if (!provider || !recover || transition !== undefined) return unavailable();
      const browser = browserOwner(operationId);
      if (provider.browserState?.(operationId).generation !== generation) return unavailable();
      for (const lease of leases.values()) if (lease.opening && lease.browserGeneration === undefined && lease.attempt.operationId === operationId) lease.browserGeneration = generation;
      const work = (async () => {
        try { await recover(browser, generation); }
        catch (cause) {
          retainBrowserHold(operationId, cause);
          const state = provider.browserState?.(operationId);
          if (state?.state === "failed") throw new ProfileSessionRefusedError(state.code, { cause });
          throw cause;
        }
        browser.assertCurrent();
        const recovered = recoveredLeases(browser, generation);
        for (const lease of recovered) { lease.revoked = true; lease.closed = true; }
        settleCustody(recovered);
        input.update(operationId, operation => {
          const draft = requiredDraft(operation);
          return { operation: { ...operation, onboarding: { ...draft, attempts: draft.attempts.map(entry => entry.providerClosedAt !== undefined || !recovered.some(lease => lease.attempt.attemptId === entry.attemptId) ? entry : {
            ...entry, state: entry.state === "complete" ? "complete" as const : "unknown" as const,
            providerClosedAt: IsoInstantSchema.parse(input.clock.now().toISOString()),
          }) } }, result: undefined };
        });
        const hold = browserHolds.get(operationId);
        if (hold && hasUnprovedSourceClosure(hold)) throw hold;
        browserHolds.delete(operationId);
        await showOwnedBrowser(provider, browser);
      })();
      recovery = { operationId, generation, work };
      try { await work; } finally { if (recovery?.work === work) recovery = undefined; }
    },
    async openPortal(operationId: string): Promise<void> {
      assertBrowserAvailable(operationId);
      if (transition !== undefined || recovery !== undefined) return unavailable();
      if (!input.provider) return unavailable();
      const browser = browserOwner(operationId); await input.provider.openPortal(browser); browser.assertCurrent();
    },
    async start(operationId: string, method: ProfileOnboardingMethod): Promise<void> {
      assertBrowserAvailable(operationId);
      if (transition !== undefined || recovery !== undefined) return unavailable();
      const provider = input.provider; if (provider === undefined) return unavailable();
      const before = requiredDraft(input.read(operationId));
      const running = (entry: SignUpDuoAttempt) => entry.providerClosedAt === undefined && leases.has(entry.attemptId) && leases.get(entry.attemptId)?.closed !== true;
      for (const receipt of before.attempts.filter(entry => entry.generation === before.generation && running(entry))) await owner.cancelAttempt(operationId, receipt.method, receipt.attemptId);
      const attempt = input.update(operationId, operation => {
        const draft = requiredDraft(operation);
        if (draft.abort !== undefined || draft.finish !== undefined) return unavailable();
        if (draft.attempts.some(entry => entry.generation === draft.generation && (entry.method === method && entry.state === "complete" || running(entry)))) return unavailable();
        const attempt: DraftDuoAttempt = Object.freeze({ operationId, profileId: operation.profileId, accountId: draft.accountId,
          generation: draft.generation, attemptId: randomUUID(), method, expiresAt: new Date(input.clock.nowMs() + 600_000).toISOString() });
        return { operation: { ...operation, onboarding: { ...draft, attempts: [...draft.attempts, {
          attemptId: attempt.attemptId, generation: attempt.generation, method, expiresAt: IsoInstantSchema.parse(attempt.expiresAt), state: "pending" as const }] } }, result: attempt };
      });
      leases.set(attempt.attemptId, { revoked: false, closed: false, opening: true, attempt });
      try {
        await provider.showBrowser(browserOwner(operationId));
        const lease = leases.get(attempt.attemptId); if (!lease) return unavailable();
        lease.opening = false;
        if (lease.revoked || transition !== undefined || recovery !== undefined) return unavailable();
        const generation = provider.browserState?.(operationId).generation;
        if (lease.browserGeneration !== undefined && lease.browserGeneration !== generation) return unavailable();
        lease.browserGeneration = generation;
        await provider.start(attempt, observed => bind(attempt, observed), error => reportFailure(attempt, error)); }
      catch (error) {
        const lease = leases.get(attempt.attemptId);
        if (lease) lease.opening = false;
        if (lease && lease.browserGeneration === undefined) lease.browserGeneration = provider.browserState?.(operationId).generation;
        if (error instanceof Error) await reportFailure(attempt, error);
        else { retainCustody(error, attempt); await reportFailure(attempt, new Error("profile-onboarding-provider-failure", { cause: error })); }
        try { await owner.cancelAttempt(operationId, method, attempt.attemptId); }
        catch (cleanup) {
          retainCustody(error, attempt); retainCustody(cleanup, attempt);
          throw new AggregateError([error, cleanup], "profile-onboarding-provider-closure-unproved", { cause: cleanup });
        }
        if (error instanceof Error && input.failureDiagnostic(error).kind === "unavailable") throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE", { cause: error });
        if (error instanceof Error && input.failureDiagnostic(error).kind === "refused") throw new ProfileSessionRefusedError("PROFILE_SIGN_IN_REFUSED", { cause: error });
        throw error;
      }
    },
    confirm(operationId: string, method: ProfileOnboardingMethod, attemptId: string): void {
      if (transition !== undefined || recovery !== undefined) return unavailable();
      const lease = leases.get(attemptId); if (lease === undefined || lease.attempt.operationId !== operationId || lease.attempt.method !== method) return unavailable();
      updateAttempt(lease.attempt, (_operation, receipt) => receipt.ceremony === undefined ? unavailable()
        : { receipt: { ...receipt, operatorConfirmedAt: IsoInstantSchema.parse(input.clock.now().toISOString()) }, result: undefined });
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
          if (closure.state !== "closed") return { ...entry, state: "unknown" as const };
          const providerClosedAt = IsoInstantSchema.parse(input.clock.now().toISOString());
          if (entry.state === "unknown" || entry.state !== "complete" && entry.scope !== undefined
            && (entry.ceremony !== undefined || input.store(latest).readForScope(entry.scope).length > 0)) return { ...entry, state: "unknown" as const, providerClosedAt };
          return { ...entry, state: entry.state === "complete" ? "complete" as const : "closed" as const, providerClosedAt };
        }) } }, result: undefined };
      });
      if (closure.state !== "closed") return unavailable();
    },
    async drain(operationId: string): Promise<void> {
      assertBrowserAvailable(operationId);
      if (recovery !== undefined) return unavailable();
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
        if (provider === undefined) return unavailable();
        const recovered = recoveredLeases(browser, provider.browserState?.(operationId).generation ?? -1);
        const closure = await provider.closeBrowser(browser);
        if (closure.state === "uncertain") throw retainBrowserHold(operationId, closure.cause);
        settleCustody(recovered);
        browsers.delete(operationId);
      }
      assertCustody();
    },
    recoverClosed(operationId: string): void {
      const operation = input.read(operationId), draft = requiredDraft(operation);
      if (draft.finish !== undefined || browsers.has(operationId) || leases.size > 0) return unavailable();
      input.update(operationId, latest => ({ operation: { ...latest, onboarding: { ...requiredDraft(latest), attempts: draft.attempts.map(entry => ({ ...entry,
        providerClosedAt: entry.providerClosedAt ?? IsoInstantSchema.parse(input.clock.now().toISOString()) })) } }, result: undefined }));
    },
    assertAbortable(operationId: string): void {
      assertBrowserAvailable(operationId);
      const draft = requiredDraft(input.read(operationId));
      if (draft.finish !== undefined || draft.attempts.some(entry => entry.providerClosedAt === undefined)) return unavailable();
      assertCustody();
    },
    verifyFinish(operation: SignUpOperation): void {
      assertBrowserAvailable(operation.operationId);
      assertCustody();
      assertFinishedProfileOnboarding(operation);
      for (const method of ["key", "touch"] as const) {
        const receipt = requiredDraft(operation).attempts.findLast(entry => entry.method === method && entry.generation === operation.onboarding?.generation);
        if (receipt?.scope === undefined) return unavailable();
        if (method === "touch" && receipt.ceremony?.mechanism === "native-platform") continue;
        const credential = input.store(operation).readForScope(receipt.scope).find(entry => entry.credentialId === receipt.ceremony?.credentialId);
        if (credential?.state !== "ready") return unavailable();
      }
    },
  };
  return { ...owner,
    beginTransition(operationId: string): void { if (transition !== undefined || recovery !== undefined) return unavailable(); transition = operationId; },
    endTransition(operationId: string): void { if (transition !== operationId) return unavailable(); transition = undefined; },
    hasLiveAttempt(attemptId: string): boolean { const lease = leases.get(attemptId); return lease !== undefined && !lease.revoked && !lease.closed; },
    async close(): Promise<void> {
      const failures: unknown[] = [];
      for (const operationId of new Set([...browsers.keys(), ...[...leases.values()].filter(lease => !lease.closed).map(lease => lease.attempt.operationId)])) {
        try { await owner.drain(operationId); } catch (error) { failures.push(error); }
      }
      try { await input.provider?.stop(); }
      catch (error) { retainCustody(error); failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "profile-onboarding-shutdown-unproved");
    },
    assertClosed(): void {
      if ([...leases.values()].some(lease => !lease.closed)) return unavailable();
      if (browsers.size > 0) return unavailable();
      assertCustody();
    },
  };
}
