import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { assertSetupRootDraft } from "../../../../src/backend/storage/maintenance/profile-inventory.js";

const profileId = randomUUID(), operationId = randomUUID(), accountId = randomUUID();
const root = { profileId, owner: { operationId, accountId, providerGeneration: 1 } };
const reenrol = { schemaVersion: 1, kind: "duo-reenrol", operationId, profileId, createdAt: "2026-11-13T12:00:00.000Z",
  draft: { accountId, generation: 1, attempts: [] } };
const signUp = { schemaVersion: 2, kind: "sign-up", operationId, profileId, commandId: randomUUID(), writeId: randomUUID(), emailKey: "a".repeat(64),
  firstName: "Synthetic", lastName: "Operator", createdAt: "2026-11-13T12:00:00.000Z", commandFingerprint: "b".repeat(64), phase: "applying",
  credentials: { operationId: randomUUID(), keyId: randomUUID(), generation: 1, phase: "ready" }, onboarding: { accountId, generation: 1, attempts: [] } };

it("binds a stopped setup root to its sign-up or Duo re-enrolment draft", () => {
  assert.doesNotThrow(() => assertSetupRootDraft(signUp, root));
  assert.doesNotThrow(() => assertSetupRootDraft(reenrol, root));
});

it("refuses a setup root whose draft names another profile, account or generation, or that no draft owns", () => {
  for (const changed of [{ ...reenrol, profileId: randomUUID() }, { ...reenrol, draft: { ...reenrol.draft, accountId: randomUUID() } },
    { ...reenrol, draft: { ...reenrol.draft, generation: 2 } }, { ...reenrol, operationId: randomUUID() }]) {
    assert.throws(() => assertSetupRootDraft(changed, root), /profile-inventory-browser-membership-unavailable/u);
  }
  assert.throws(() => assertSetupRootDraft({ ...signUp, onboarding: undefined }, root), /profile-inventory-browser-membership-unavailable/u);
  assert.throws(() => assertSetupRootDraft({ schemaVersion: 3, kind: "logout", operationId, profileId, sessionGeneration: 1,
    source: { database: { device: 1, inode: 1 } }, at: "2026-11-13T12:00:00.000Z", phase: "admitted" }, root), /profile-inventory-browser-membership-unavailable/u);
});
