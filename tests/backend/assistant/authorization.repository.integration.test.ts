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
it("registers the forward schema while refusing foreign chats atomically", async () => {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const database = AuthorityDatabase.open(profile.admission, { path: join(profile.stateRoot, "state.db"), busyTimeoutMs: 100, migrationOwner: "assistant-repository-test" }, clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  cleanups.push(async () => { database.close(); await profile.close(); });
  assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 30);
  assert.deepEqual(auditMigrationTableCoverage(), []);
  assert.equal(migrationTableNames(7).some(name => name.startsWith("assistant_")), false);
  assert.equal(migrationTableNames(8).filter(name => name.startsWith("assistant_")).length, 3);
  const predecessor = migrationTableNames(28);
  // Content fingerprints hash tables in this order; the retired table must keep its place after settings.
  assert.equal(predecessor.indexOf("assistant_grants"), predecessor.indexOf("settings") + 1);
  assert.equal(predecessor.includes("assistant_grants"), true);
  assert.equal(migrationTableNames(29).includes("assistant_grants"), false);
  const generation = database.getMeta().authorityGeneration;
  assert.throws(() => database.authority.assistantAuthorization.createChat({ id: randomUUID(), profileId: randomUUID(), epoch: 1, createdAt: clock.now().toISOString(), expiresAt: "2026-10-21T13:00:00.000Z" }));
  assert.equal(database.getMeta().authorityGeneration, generation);
});
