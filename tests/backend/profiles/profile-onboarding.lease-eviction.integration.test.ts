import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

function rig(cancelState: "closed" | "uncertain") {
  const operationId = randomUUID();
  let operation = SignUpOperationSchema.parse({ schemaVersion: 2, kind: "sign-up", operationId, profileId: randomUUID(),
    commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64), firstName: "Synthetic", lastName: "Operator",
    createdAt: "2026-11-03T08:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
    credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" },
    onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
  const unused = (): never => { throw new Error("unexpected credential access"); };
  const owner = createProfileOnboarding({ clock: manualClock(new Date(operation.createdAt)), onEvent() {}, onFailure() {},
    failureDiagnostic: () => ({ kind: "unknown", causeTag: "provider" }),
    read: () => draftOf(operation), update: (_id, change) => { const next = change(draftOf(operation)); operation = withAttempts(operation, next.attempts); return next.result; },
    store: unused, publicState: unused,
    provider: { async showBrowser(browser) { browser.assertCurrent(); }, async openPortal() { unused(); }, async stop() {},
      async closeBrowser() { return { state: "closed" }; }, async cancel() { return { state: cancelState }; }, async start() {} } });
  return { operationId, owner };
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
