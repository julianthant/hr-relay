import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { createBoundProfileFixture, boundProfileCredentials, openBoundDatabaseFixture } from "../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, auditMigrationTableCoverage, migrationTableNames } from "../../../src/backend/storage/sqlite/migrations.js";
import { NotificationCommandRequestSchema, type CommandResult } from "../../../src/rules/commands/commands.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it("registers the forward schema while refusing foreign chats atomically", async () => {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const database = AuthorityDatabase.open(profile.admission, { path: join(profile.stateRoot, "state.db"), busyTimeoutMs: 100, migrationOwner: "assistant-repository-test" }, clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  cleanups.push(async () => { database.close(); await profile.close(); });
  assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 48);
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

it("reads only audited notification action metadata for the bound profile, retaining completed activity after approval expiry", async () => {
  const fixture = await openBoundDatabaseFixture("assistant-notification-activity");
  cleanups.push(() => fixture.close());
  const { database } = fixture, profileId = database.getMeta().profileId;
  const at = "2026-11-06T07:59:00.000Z", completedAt = "2026-11-06T08:00:00.000Z", expiresAt = "2026-11-06T08:01:00.000Z";
  const authorization = database.authority.assistantAuthorization, id = randomUUID(), chatId = randomUUID();
  const command = NotificationCommandRequestSchema.options[0].parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
    family: "notification", type: "notification-read", target: { notificationId: randomUUID(), actorId: "local-operator", expectedVersion: 1 } });
  authorization.createChat({ id: chatId, profileId, epoch: 1, createdAt: at, expiresAt });
  authorization.createAction({ id, chatId, manifest: { revision: 1, entries: [] },
    binding: { profileId, accountSessionEpoch: 1, manifestRevision: 1, family: "notification", action: command.type, classification: "local-write",
      commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" }, configDescriptor: { kind: "none" } },
    command, plan: null, revision: 1, state: "prepared", result: null, createdAt: at, expiresAt });
  assert.deepEqual(authorization.notificationActivity(), [], "a preparation has no completion timestamp");
  const result: CommandResult = { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }] };
  authorization.transition(id, 1, "approved"); authorization.transition(id, 2, "claimed"); authorization.transition(id, 3, "settled", result);
  database.authority.commands.insert(command);
  database.authority.commandAudits.insert({ auditId: randomUUID(), request: command, result, completedAt, versionChanges: [], affectedDependencyIds: [] });
  const generation = database.getMeta().authorityGeneration;
  assert.deepEqual(authorization.notificationActivity(), [{ id, operation: "notification-read", outcome: "applied", completedAt }]);
  assert.equal(database.getMeta().authorityGeneration, generation);
  const foreign = await openBoundDatabaseFixture("assistant-notification-foreign");
  cleanups.push(() => foreign.close());
  assert.deepEqual(foreign.database.authority.assistantAuthorization.notificationActivity(), []);
});
