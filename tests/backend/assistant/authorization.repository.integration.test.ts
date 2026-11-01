import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { createBoundProfileFixture, boundProfileCredentials } from "../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, auditMigrationTableCoverage, migrationTableNames } from "../../../src/backend/storage/sqlite/migrations.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it("registers the forward schema while refusing unjournaled grants and foreign chats atomically", async () => {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const database = AuthorityDatabase.open(profile.admission, { path: join(profile.stateRoot, "state.db"), busyTimeoutMs: 100, migrationOwner: "assistant-repository-test" }, clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  cleanups.push(async () => { database.close(); await profile.close(); });
  assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 11);
  assert.deepEqual(auditMigrationTableCoverage(), []);
  assert.equal(migrationTableNames(7).some(name => name.startsWith("assistant_")), false);
  assert.equal(migrationTableNames(8).filter(name => name.startsWith("assistant_")).length, 3);
  const generation = database.getMeta().authorityGeneration, profileId = profile.admission.profileBinding.profileId;
  assert.throws(() => database.authority.assistantAuthorization.grantBySettings({ id: "current", profileId, commandId: randomUUID(), updatedAt: clock.now().toISOString(),
    policy: { revision: 1, mode: "every-action", grant: { grantId: randomUUID(), profileId, policyRevision: 1, mode: "every-action", grantedAt: clock.now().toISOString() } } }));
  assert.throws(() => database.authority.assistantAuthorization.createChat({ id: randomUUID(), profileId: randomUUID(), epoch: 1, createdAt: clock.now().toISOString(), expiresAt: "2026-10-21T13:00:00.000Z" }));
  assert.equal(database.getMeta().authorityGeneration, generation);
  assert.equal(database.authority.assistantAuthorization.grant(), undefined);
});
