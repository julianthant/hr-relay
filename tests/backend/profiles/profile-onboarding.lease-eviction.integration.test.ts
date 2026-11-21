import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { it } from "vitest";
import { SignUpOperationSchema, type SignUpDuoAttempt, type SignUpOperation } from "../../../src/models/profiles/profile.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createProfileOnboarding, type DuoDraft } from "../../../src/backend/profiles/profile-onboarding.js";

function draftOf(operation: SignUpOperation): DuoDraft {
  const draft = operation.onboarding;
  if (draft === undefined) throw new Error("fixture sign-up draft missing");
  return { operationId: operation.operationId, profileId: operation.profileId, accountId: draft.accountId, generation: draft.generation,
    attempts: draft.attempts, sealed: draft.finish !== undefined, aborted: draft.abort !== undefined, settle: "confirm" };
}
function withAttempts(operation: SignUpOperation, attempts: readonly SignUpDuoAttempt[]): SignUpOperation {
  if (operation.onboarding === undefined) throw new Error("fixture sign-up draft missing");
  return SignUpOperationSchema.parse({ ...operation, onboarding: { ...operation.onboarding, attempts } });
}

type CancelOutcome = "closed" | "uncertain" | "reject";

function rig(cancelOutcome: CancelOutcome) {
  const operationId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId: randomUUID(),
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  const unused = (): never => { throw new Error("unexpected credential access"); };
  const started: WeakRef<object>[] = [];
  const cancelFailure = new Error("fixture worker stop refused");
  let browserCloses = 0;
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)), onEvent() {}, onFailure() {},
    failureDiagnostic: () => ({ kind: "unknown", causeTag: "provider" }),
    read: () => draftOf(operation), update: (_id, change) => { const next = change(draftOf(operation)); operation = withAttempts(operation, next.attempts); return next.result; },
    store: unused, publicState: unused,
    provider: { async showBrowser(browser) { browser.assertCurrent(); }, async openPortal() { unused(); }, async stop() {},
      browserState: () => ({ state: "open", generation: 1 }),
      async recoverBrowser(browser) { browser.assertCurrent(); },
      async closeBrowser() { browserCloses += 1; return { state: "closed" }; },
      async cancel() { if (cancelOutcome === "reject") throw cancelFailure; return { state: cancelOutcome }; },
      async start(attempt) { started.push(new WeakRef(attempt)); } } });
  const latest = () => operation.onboarding!.attempts.at(-1)!;
  return { operationId, owner, started, cancelFailure, latest, browserCloses: () => browserCloses };
}

function collect(): void {
  setFlagsFromString("--expose-gc");
  (runInNewContext("gc") as () => void)();
}

it("evicts settled leases once drain proves provider and receipt closure, so repeated attempts do not accumulate", async () => {
  const { operationId, owner } = rig("closed");
  for (let round = 0; round < 3; round++) {
    await owner.start(operationId, "key");
    await owner.start(operationId, "touch");
    await owner.drain(operationId);
  }
  owner.assertClosed();
  owner.recoverClosed(operationId);
});

it("keeps the lease of an attempt whose closure is unproved", async () => {
  const { operationId, owner } = rig("uncertain");
  await owner.start(operationId, "key");
  await assert.rejects(owner.start(operationId, "touch"));
  await assert.rejects(owner.drain(operationId));
  assert.throws(() => owner.assertClosed());
  assert.throws(() => owner.recoverClosed(operationId));
});

for (const outcome of ["uncertain", "reject"] as const) it(`still closes the setup browser when an attempt cancel is ${outcome}, and reports it`, async () => {
  const { operationId, owner, cancelFailure, browserCloses } = rig(outcome);
  await owner.start(operationId, "key");
  await assert.rejects(owner.drain(operationId), (error: unknown) => outcome === "uncertain"
    ? error instanceof Error && error.name === "ProfileSessionRefusedError" : error === cancelFailure);
  assert.equal(browserCloses(), 1);
  assert.throws(() => owner.assertClosed());
});

it("evicts each attempt as cancel proves it closed, while the setup browser stays open", async () => {
  const { operationId, owner, started, latest } = rig("closed");
  for (let round = 0; round < 3; round++) {
    await owner.start(operationId, "key");
    await owner.cancelAttempt(operationId, "key", latest().attemptId);
  }
  await new Promise(resolve => setImmediate(resolve));
  collect();
  assert.equal(started.filter(entry => entry.deref() !== undefined).length, 0, "settled attempts must not stay leased");
});

it("evicts the attempts a browser recovery closed before the final drain", async () => {
  const { operationId, owner, started } = rig("closed");
  for (let round = 0; round < 3; round++) {
    await owner.start(operationId, "key");
    await owner.reopenBrowser(operationId, 1);
  }
  await new Promise(resolve => setImmediate(resolve));
  collect();
  assert.equal(started.filter(entry => entry.deref() !== undefined).length, 0, "recovered attempts must not stay leased");
  await owner.drain(operationId);
  owner.assertClosed();
});
