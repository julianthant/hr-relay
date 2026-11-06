import { AuthoritySourceClosureUnprovedError, createBrowserSourceRecovery } from "../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { randomUUID } from "node:crypto";
import { ProfileOnboardingDuoProviderError } from "../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createProfileOnboarding, duoAccountMatches } from "../../../src/backend/profiles/profile-onboarding.js";
import { ProfileOnboardingStateSchema } from "../../../src/models/profiles/public-profile.js";

it("binds Duo account names only to the verified UCSD email or its exact username", () => {
  for (const observed of ["fixture@ucsd.edu", "fixture", " Fixture@UCSD.EDU "]) assert.equal(duoAccountMatches("fixture@ucsd.edu", observed), true);
  for (const observed of ["other", "fixture-other", "fixture@other.edu", "fixture@ucsd.edu.other", "Fixture Operator", ""]) {
    assert.equal(duoAccountMatches("fixture@ucsd.edu", observed), false);
  }
  assert.equal(duoAccountMatches("fixture@other.edu", "fixture"), false);
  assert.equal(duoAccountMatches("fixture@other.edu", "fixture@other.edu"), false);
});

it("requires distinct served completion facts for both methods before Ready", () => {
  const complete = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const ready = { browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: "2d3b9a81-ec67-4e68-af2e-ad378a97dc00", profileId: "b5a72f23-c2e8-4252-9227-f4de440cedd9",
    step: "ready", methods: { key: complete, touch: complete } };
  assert.equal(ProfileOnboardingStateSchema.safeParse(ready).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, key: { ...complete, portalAccepted: false } } }).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, ceremonyObserved: false } } }).success, false);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, operatorConfirmed: false } } }).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, portalAccepted: false } } }).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: true } } }).success, false);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, key: { ...complete, operatorConfirmed: false, exactCredentialRequestObserved: true } } }).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, state: "pending" } } }).success, false);
});

for (const path of ["provider", "scope-loss"] as const) it(`persists and logs only safe cause tags for an Unknown ${path} attempt`, async () => {
  const operationId = randomUUID(), profileId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId,
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  let starts = 0;
  const diagnostic = { kind: "unknown" as const, causeTag: path === "provider" ? "worker" as const : "scope" as const };
  const noSecretAccess = (): never => { throw new Error("unexpected secret access"); };
  const events: unknown[] = [];
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)),
    onEvent: event => { events.push(event); },
    onFailure: (attempt, failure) => { events.push({ operationId: attempt.operationId, attemptId: attempt.attemptId, method: attempt.method, failure }); },
    failureDiagnostic: error => error instanceof ProfileOnboardingDuoProviderError ? { kind: error.kind, causeTag: error.reason } : { kind: "unknown", causeTag: "provider" },
    read: () => operation, update: (_id, change) => { const next = change(operation); operation = SignUpOperationSchema.parse(next.operation); return next.result; },
    email: () => "synthetic@ucsd.edu", credentials: noSecretAccess, store: noSecretAccess, publicState: noSecretAccess,
    provider: { async showBrowser(browser) { browser.assertCurrent(); }, async openPortal() { throw new Error("unexpected portal"); },
      async closeBrowser() { return { state: "closed" }; }, async cancel() { return { state: "closed" }; },
      async start(_attempt, bind, reportFailure) {
        starts++;
        if (path === "provider") await reportFailure(new ProfileOnboardingDuoProviderError("unknown", "worker", new Error("private diagnostic must never be logged")));
        else {
          const capability = await bind({ contextId: "A0000000000040008000000000000007", tabId: 7, origin: "https://synthetic.duosecurity.com", rpId: "duosecurity.com" });
          await capability.retainUnknown(diagnostic);
          await capability.retainUnknown({ kind: "unknown", causeTag: "browser-lifetime" });
        }
      } },
  });
  try {
    await owner.start(operationId, "key");
    const attempt = operation.onboarding?.attempts[0]; assert.ok(attempt);
    assert.equal(attempt.state, "unknown");
    assert.deepEqual(attempt.failure, diagnostic);
    assert.equal(SignUpOperationSchema.safeParse({ ...operation, onboarding: { ...operation.onboarding, attempts: [{ ...attempt, failure: { ...diagnostic, message: "private diagnostic must never be logged" } }] } }).success, false);
    assert.equal(SignUpOperationSchema.safeParse({ ...operation, onboarding: { ...operation.onboarding, attempts: [{ ...attempt, failure: { kind: "unknown", causeTag: "private diagnostic" } }] } }).success, false);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { operationId, attemptId: attempt.attemptId, method: "key", failure: diagnostic });
    assert.doesNotMatch(JSON.stringify(events), /private diagnostic|synthetic@ucsd.edu|password|stack/);
    await owner.showBrowser(operationId);
    assert.equal(starts, 1);
    await owner.start(operationId, "touch");
    await owner.start(operationId, "key");
    assert.equal(starts, 3); assert.deepEqual(operation.onboarding?.attempts.map(entry => [entry.method, entry.state]),
      [["key", "unknown"], ["touch", "unknown"], ["key", "unknown"]]);
  } finally { await owner.close(); }
});

it("starting the other method closes an unfinished attempt instead of refusing", async () => {
  const operationId = randomUUID(), profileId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId,
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  const cancelled: string[] = [];
  const noSecretAccess = (): never => { throw new Error("unexpected secret access"); };
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)), onEvent() {}, onFailure() {},
    failureDiagnostic: error => error instanceof ProfileOnboardingDuoProviderError ? { kind: error.kind, causeTag: error.reason } : { kind: "unknown", causeTag: "provider" },
    read: () => operation, update: (_id, change) => { const next = change(operation); operation = SignUpOperationSchema.parse(next.operation); return next.result; },
    email: () => "synthetic@ucsd.edu", credentials: noSecretAccess, store: noSecretAccess, publicState: noSecretAccess,
    provider: { async showBrowser(browser) { browser.assertCurrent(); }, async openPortal() { throw new Error("unexpected portal"); },
      async closeBrowser() { return { state: "closed" }; }, async cancel(attempt) { cancelled.push(attempt.method); return { state: "closed" }; },
      async start() {} },
  });
  try {
    await owner.start(operationId, "key");
    await owner.start(operationId, "touch");
    assert.deepEqual(cancelled, ["key"]);
    assert.deepEqual(operation.onboarding?.attempts.map(entry => [entry.method, entry.state]), [["key", "closed"], ["touch", "pending"]]);
    await owner.start(operationId, "key");
    assert.deepEqual(operation.onboarding?.attempts.map(entry => [entry.method, entry.state]), [["key", "closed"], ["touch", "closed"], ["key", "pending"]]);
  } finally { await owner.close(); }
});

it("reopens the exact browser generation after a drain failure without aborting the draft", async () => {
  const operationId = randomUUID(), profileId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId,
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  const cause = new Error("synthetic first close failure");
  const calls: number[] = [];
  let recovered = false;
  const release = Promise.withResolvers<void>();
  const unused = (): never => { throw new Error("unexpected credential access"); };
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)), onEvent() {}, onFailure() {},
    failureDiagnostic: () => ({ kind: "unknown", causeTag: "browser-lifetime" }),
    read: () => operation, update: (_id, change) => { const next = change(operation); operation = SignUpOperationSchema.parse(next.operation); return next.result; },
    email: unused, credentials: unused, store: unused, publicState: unused,
    provider: {
      async showBrowser(browser) { browser.assertCurrent(); }, async openPortal() { unused(); }, async start() { unused(); },
      async cancel() { return { state: "closed" }; },
      async closeBrowser() { return recovered ? { state: "closed" } : { state: "uncertain", cause }; },
      async reopenBrowser(browser, generation) { browser.assertCurrent(); calls.push(generation); await release.promise; recovered = true; },
      browserState() { return { state: "closed", generation: 4 }; },
    },
  });
  await owner.showBrowser(operationId);
  await assert.rejects(owner.drain(operationId), error => error instanceof Error && error.cause === cause);
  assert.equal(operation.onboarding?.abort, undefined);
  assert.equal(operation.onboarding?.finish, undefined);
  const first = owner.reopenBrowser(operationId, 4), joined = owner.reopenBrowser(operationId, 4);
  await assert.rejects(owner.reopenBrowser(operationId, 5));
  assert.throws(() => owner.beginTransition(operationId));
  await assert.rejects(owner.start(operationId, "touch"));
  assert.deepEqual(operation.onboarding?.attempts, []);
  release.resolve();
  await Promise.all([first, joined]);
  assert.deepEqual(calls, [4]);
  assert.deepEqual(operation.onboarding?.attempts, []);
  await owner.drain(operationId);
  owner.assertClosed();
});

for (const foreign of [false, true]) it(`settles only recovered attempt custody before Cancel and retains Unknown history (foreign=${foreign})`, async () => {
  const operationId = randomUUID(), profileId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId,
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  const source = new AuthoritySourceClosureUnprovedError([new Error("foreign custody")]), sourceRecovery = createBrowserSourceRecovery(); sourceRecovery.retain(source);
  let generation = 4, recovered = false;
  const unused = (): never => { throw new Error("unexpected credential access"); };
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)), onEvent() {}, onFailure() {},
    failureDiagnostic: () => ({ kind: "unknown", causeTag: "worker" }),
    read: () => operation, update: (_id, change) => { const next = change(operation); operation = SignUpOperationSchema.parse(next.operation); return next.result; },
    email: unused, credentials: unused, store: unused, publicState: unused,
    provider: { async showBrowser(browser) { browser.assertCurrent(); }, async openPortal() { unused(); },
      browserState() { return { state: "closed", generation }; },
      async start(_attempt, _bind, report) { await report(new ProfileOnboardingDuoProviderError("unknown", "worker", foreign ? source : undefined)); },
      async cancel() { return { state: "closed" }; },
      async closeBrowser() { return recovered ? { state: "closed" } : { state: "uncertain" }; },
      async reopenBrowser(browser, expected) { browser.assertCurrent(); assert.equal(expected, generation); generation++; recovered = true; },
    } });
  await owner.start(operationId, "touch");
  await assert.rejects(owner.drain(operationId)); assert.throws(() => owner.assertAbortable(operationId));
  await owner.reopenBrowser(operationId, 4);
  assert.equal(operation.onboarding?.attempts[0]?.state, "unknown");
  assert.deepEqual(operation.onboarding?.attempts[0]?.failure, { kind: "unknown", causeTag: "worker" });
  await owner.drain(operationId);
  if (foreign) { assert.throws(() => owner.assertAbortable(operationId)); assert.throws(() => owner.assertClosed()); await sourceRecovery.prove(async () => {}); owner.assertAbortable(operationId); owner.assertClosed(); }
  else { owner.assertAbortable(operationId); owner.assertClosed(); }
});

for (const foreign of [false, true]) it(`a Show failure caught after proved Reopen stays bound to its retired resource (foreign=${foreign})`, async () => {
  const operationId = randomUUID(), profileId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId,
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  const opening = Promise.withResolvers<void>(), source = new AuthoritySourceClosureUnprovedError([new Error("foreign late source")]);
  let generation = 4, starts = 0;
  const unused = (): never => { throw new Error("unexpected credential access"); };
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)), onEvent() {}, onFailure() {},
    failureDiagnostic: () => ({ kind: "unknown", causeTag: "worker" }),
    read: () => operation, update: (_id, change) => { const next = change(operation); operation = SignUpOperationSchema.parse(next.operation); return next.result; },
    email: unused, credentials: unused, store: unused, publicState: unused,
    provider: { async showBrowser() { await opening.promise; if (foreign) throw source; }, async openPortal() { unused(); },
      browserState() { return { state: "closed", generation }; }, async start() { starts++; }, async cancel() { return { state: "closed" }; },
      async closeBrowser() { return { state: "closed" }; }, async reopenBrowser(browser, expected) { browser.assertCurrent(); assert.equal(expected, generation); generation++; },
    } });
  const start = owner.start(operationId, "touch");
  const refused = assert.rejects(start);
  await owner.reopenBrowser(operationId, 4);
  opening.resolve(); await refused;
  assert.equal(starts, 0, "retired Show cannot start a fresh ceremony");
  await owner.drain(operationId);
  assert.equal(operation.onboarding?.attempts[0]?.state, "unknown");
  if (foreign) assert.throws(() => owner.assertAbortable(operationId)); else { owner.assertAbortable(operationId); owner.assertClosed(); }
});
