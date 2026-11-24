import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createNotificationInboxTestWorld } from "../../../support/helpers/backend/notification-inbox-world.js";
import { LATER } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const { _afterEachFixture0, ACTOR, record, harness, command } = createNotificationInboxTestWorld(profileFixtures.create);

const collection = (database: AuthorityDatabase, type: "notification-clear-all" | "notification-clear-unread-all", actor = ACTOR) => ({
  ...command(type, 1), target: database.withAuthorityReadSnapshot(() => database.authority.notifications.collection(actor, type === "notification-clear-all" ? "clear" : "clear-unread")),
});
const one = (notificationId: string, expectedVersion = 1) => ({ ...command("notification-clear", expectedVersion), target: { notificationId, actorId: ACTOR, expectedVersion } });
const listed = (database: AuthorityDatabase) => database.authority.notifications.listByActor(ACTOR).filter(row => row.clearedAt === undefined).map(row => row.notificationId).sort();

describe("clearing notifications", () => {
  afterEach(_afterEachFixture0);

  it("clears one notice for good: it stays cleared after a restart and is refused a second time", async () => {
    const { database, kernel, reopen } = await harness();
    const kept = randomUUID(), cleared = randomUUID();
    database.authority.notifications.create(record({ notificationId: kept, dedupeFingerprint: "1".repeat(64) }));
    database.authority.notifications.create(record({ notificationId: cleared, dedupeFingerprint: "2".repeat(64) }));
    assert.equal(kernel.execute(one(cleared)).state, "applied");
    assert.deepEqual(database.authority.notifications.get(cleared), { ...record({ notificationId: cleared, dedupeFingerprint: "2".repeat(64) }), clearedAt: LATER, version: 2, updatedAt: LATER });
    assert.deepEqual(listed(database), [kept]);
    const restarted = reopen();
    assert.deepEqual(listed(restarted), [kept], "a restart keeps it cleared");
    assert.equal(restarted.authority.notifications.collection(ACTOR, "read").members.some(member => member.notificationId === cleared), false, "a cleared notice leaves every collection");
  });

  it("refuses clearing a cleared notice again and changes nothing", async () => {
    const { database, kernel } = await harness();
    const id = randomUUID();
    database.authority.notifications.create(record({ notificationId: id }));
    assert.equal(kernel.execute(one(id)).state, "applied");
    const before = database.authority.notifications.get(id);
    assert.equal(kernel.execute(one(id, 2)).state, "rejected");
    assert.deepEqual(database.authority.notifications.get(id), before);
  });

  it("brings a cleared notice back when the same thing happens again", async () => {
    const { database, kernel } = await harness();
    const id = randomUUID();
    database.authority.notifications.create(record({ notificationId: id }));
    assert.equal(kernel.execute(one(id)).state, "applied");
    const folded = database.withAuthorityTransaction(repositories => repositories.notifications.fold({ actorId: ACTOR, dedupeFingerprint: record().dedupeFingerprint, seenAt: LATER, title: "Run failed", summary: "person-lookup run failed again" }));
    assert.equal(folded.notification.clearedAt, undefined);
    assert.equal(folded.notification.status, "unread");
    assert.deepEqual(listed(database), [id]);
  });

  it("refuses to clear a notice still waiting on the operator and leaves it out of Clear all with its count", async () => {
    const { database, kernel } = await harness();
    // A storage notice whose concern cannot be read is still standing: nothing proves it handled.
    const standing = randomUUID(), plain = randomUUID();
    database.authority.notifications.create(record({ notificationId: standing, dedupeFingerprint: "3".repeat(64), trigger: "storage", title: "Storage needs attention", count: 4, links: [{ kind: "storage", diagnosticFingerprint: "d".repeat(64) }] }));
    database.authority.notifications.create(record({ notificationId: plain, dedupeFingerprint: "4".repeat(64) }));
    const before = database.authority.notifications.get(standing);
    const refused = kernel.execute({ ...command("notification-clear", 1), target: { notificationId: standing, actorId: ACTOR, expectedVersion: 1 } });
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "policy-refused");
    const request = collection(database, "notification-clear-all");
    assert.equal(request.target.matchingCount, 1);
    assert.equal(kernel.execute(request).state, "applied");
    assert.deepEqual(database.authority.notifications.get(standing), before, "the standing notice keeps its state and count");
    assert.deepEqual(listed(database), [standing]);
  });

  it("clears every notice Clear all lists in one command, or only the unread ones from the Unread tab", async () => {
    const { database, kernel } = await harness();
    const ids = Array.from({ length: 4 }, () => randomUUID());
    for (const [index, notificationId] of ids.entries()) {
      database.authority.notifications.create(record({ notificationId, dedupeFingerprint: String(index).repeat(64), status: index < 2 ? "unread" : "read" }));
    }
    const pinned = randomUUID();
    database.authority.notifications.create(record({ notificationId: pinned, dedupeFingerprint: "b".repeat(64), trigger: "backfill-gap", links: [] }));
    const unread = collection(database, "notification-clear-unread-all");
    assert.equal(unread.target.matchingCount, 2);
    const result = kernel.execute(unread);
    assert.equal(result.state, "applied");
    if (result.state === "applied") assert.equal(result.affectedTargets.length, 2);
    assert.deepEqual(listed(database), [...ids.slice(2), pinned].sort());
    assert.equal(kernel.execute(collection(database, "notification-clear-all")).state, "applied");
    assert.deepEqual(listed(database), [pinned], "a pinned backfill gap is never cleared");
  });

  it("refuses a stale Clear all and leaves another person's notices untouched", async () => {
    const { database, kernel } = await harness();
    const mine = randomUUID(), theirs = randomUUID();
    database.authority.notifications.create(record({ notificationId: mine, dedupeFingerprint: "5".repeat(64) }));
    database.authority.notifications.create(record({ notificationId: theirs, actorId: "other-operator", dedupeFingerprint: "5".repeat(64) }));
    const request = collection(database, "notification-clear-all");
    database.authority.notifications.create(record({ notificationId: randomUUID(), dedupeFingerprint: "6".repeat(64) }));
    assert.equal(kernel.execute(request).state, "rejected", "a notice that arrived after the list was read refuses the collection");
    assert.equal(kernel.execute(collection(database, "notification-clear-all")).state, "applied");
    assert.deepEqual(listed(database), []);
    assert.equal(database.authority.notifications.get(theirs)?.clearedAt, undefined);
    assert.equal(database.authority.notifications.get(theirs)?.version, 1);
  });
});
