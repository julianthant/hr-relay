import assert from "node:assert/strict";
import { copyFileSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { z } from "zod";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore, CredentialErasureHeadSchema, erasureRequestIdentity, readForErasure } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

function pending() {
  const f = createBoundProfileFixture();
  const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
    activity: { hasUnquiescedWork: () => true } });
  const active = session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("fixture activation refused");
  const result = session.logOut(active.token, { at: "2026-10-21T12:01:00.000Z" });
  assert.equal(result.state, "cancelling"); if (result.state !== "cancelling") throw new Error("fixture cancellation refused"); assert.ok(result.operationId);
  const path = join(f.machine.stateRoot, "machine", "operations", `${result.operationId}.json`);
  const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  session.close();
  const owner = f.machine.admitProfile(createProfileRegistry(f.machine).settlementClaim(operation.operationId));
  const store = createCredentialStore({ admission: owner, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
    erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`) });
  return { f, owner, store, operation, path, close() { owner.release(); f.close(); } };
}

it("issues exact early pending-logout inspection without runtime, credential, database-write or artifact authority", () => {
  const f = pending();
  const purpose = f.owner.forPendingLogoutInventory(f.operation);
  try {
    assert.equal(f.operation.commandId, undefined); assert.equal(f.operation.expectedRevision, undefined);
    const before = AuthorityDatabase.readProfileMaintenanceInventory(purpose);
    purpose.assertPendingLogoutInventory(f.owner, f.operation);
    assert.equal(before.authorityGeneration, AuthorityDatabase.readProfileMaintenanceInventory(purpose).authorityGeneration);
    assert.throws(() => purpose.assertProfileRuntime());
    assert.throws(() => purpose.assertCredentialRead());
    assert.throws(() => purpose.assertWritable());
    assert.throws(() => purpose.assertExclusive());
    assert.throws(() => purpose.beginCredentialErasure({ epoch: 1 }));
    assert.throws(() => purpose.assertReadOnlyAuthorityDatabase(":memory:"));
    assert.throws(() => purpose.assertArtifactRoot(purpose.artifactRoot));
    assert.throws(() => AuthorityDatabase.open(purpose, { path: f.f.path, busyTimeoutMs: 250, migrationOwner: "refused" }));
    assert.throws(() => createCredentialStore({ admission: purpose, stateRoot: purpose.stateRoot,
      erasureJournalAdmission: f.f.machine, erasureJournalPath: join(f.f.machine.stateRoot, "machine", "erasures", `${f.operation.profileId}.json`) }));
    const sibling = f.f.machine.admitProfile(createProfileRegistry(f.f.machine).settlementClaim(f.operation.operationId));
    try { assert.throws(() => purpose.assertPendingLogoutInventory(sibling, f.operation)); }
    finally { sibling.release(); }
    assert.throws(() => purpose.assertPendingLogoutInventory(f.owner, { ...f.operation, operationId: randomUUID() }));
    assert.throws(() => purpose.assertPendingLogoutInventory(f.owner, { ...f.operation, phase: "complete" }));
    const foreign = pending();
    try {
      assert.throws(() => purpose.assertPendingLogoutInventory(foreign.owner, f.operation));
      assert.throws(() => purpose.assertReadOnlyAuthorityDatabase(foreign.f.path));
      assert.throws(() => purpose.verifiedReadOnlyCopy(foreign.f.path, "a".repeat(64)));
    } finally { foreign.close(); }
  } finally { purpose.release(); f.close(); }
});

for (const mutation of ["operation-inode", "operation-phase", "database-inode", "selection", "released-child", "released-parent"] as const) {
  it(`revokes pending inspection after actual ${mutation} changes`, () => {
    const f = pending(), purpose = f.owner.forPendingLogoutInventory(f.operation);
    let restore: (() => void) | undefined;
    try {
      if (mutation === "operation-inode" || mutation === "database-inode") {
        const path = mutation === "operation-inode" ? f.path : f.f.path, original = `${path}.retained`;
        renameSync(path, original); copyFileSync(original, path);
        restore = () => { unlinkSync(path); renameSync(original, path); };
      } else if (mutation === "operation-phase") f.f.machine.publishProfileOperation({ ...f.operation, phase: "incomplete" });
      else if (mutation === "selection") createProfileRegistry(f.f.machine).advanceSession(null);
      else if (mutation === "released-child") f.owner.release();
      else f.f.machine.release();
      assert.throws(() => purpose.assertPendingLogoutInventory(f.owner, f.operation));
      assert.throws(() => AuthorityDatabase.readProfileMaintenanceInventory(purpose));
    } finally { restore?.(); purpose.release(); f.close(); }
  });
}


for (const phase of ["early", "incomplete", "partial"] as const) it(`observes only the exact original ${phase} erasure head without changing phase or granting erasure`, () => {
  const f = pending();
  let operation = f.operation;
  const revision = readForErasure(f.store, operation.operationId).revision;
  if (phase !== "early") {
    operation = LogoutOperationSchema.parse({ ...operation, phase: "incomplete", commandId: randomUUID(),
      ...(phase === "incomplete" ? { writeId: randomUUID(), expectedRevision: revision } : {}) });
    f.f.machine.publishProfileOperation(operation);
  }
  const purpose = f.owner.forPendingLogoutInventory(operation);
  const continuity = z.object({ erasures: z.array(z.object({ profileId: z.string(), head: CredentialErasureHeadSchema })) })
    .parse(JSON.parse(readFileSync(join(f.f.workspace, ".tracker", "control", "profile-registry.json"), "utf8")));
  const head = continuity.erasures.find(row => row.profileId === operation.profileId)?.head; assert.ok(head);
  const before = readFileSync(f.path);
  try {
    assert.throws(() => purpose.assertCredentialErasureHead(head));
    if (phase === "early") {
      purpose.assertPendingLogoutErasureHead(f.owner, operation, head);
      const unexpected = erasureRequestIdentity(CredentialEraseInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), expectedRevision: revision,
        updatedAt: operation.at, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head, unexpected));
    } else if (phase === "incomplete") {
      const request = erasureRequestIdentity(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
        expectedRevision: operation.expectedRevision, updatedAt: operation.at, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH }));
      purpose.assertPendingLogoutErasureHead(f.owner, operation, head, request);
      assert.throws(() => f.owner.assertCredentialErasure(request));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head, { ...request, requestReceipt: "forged" }));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head, { ...request, commandId: randomUUID() }));
      assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, { ...operation, phase: "erasing" }, head, request));
    } else assert.throws(() => purpose.assertPendingLogoutErasureHead(f.owner, operation, head));
    assert.equal(readFileSync(f.path).equals(before), true, "read-only head observation cannot rewrite the original operation");
  } finally { purpose.release(); f.close(); }
});
