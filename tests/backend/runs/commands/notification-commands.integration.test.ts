import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createNotificationInboxTestWorld } from "../../../support/helpers/backend/notification-inbox-world.js";
import { HASH_C, LATER, NOW, UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { projectNotificationTrigger } from "../../../../src/rules/notifications/notification-triggers.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const { _afterEachFixture0, ACTOR, record, harness, command } = createNotificationInboxTestWorld(profileFixtures.create);

/** Clears exactly these rows at these versions, as the bell sends it. */
const clear = (members: readonly (readonly [string, number])[], actorId = ACTOR) => {
  const sorted = [...members].sort(([x], [y]) => x < y ? -1 : 1).map(([notificationId, expectedVersion]) => ({ notificationId, expectedVersion }));
  return { ...command("notification-clear", 1), target: { actorId, members: sorted, matchingCount: sorted.length } };
};
const one = (notificationId: string, expectedVersion = 1) => clear([[notificationId, expectedVersion]]);
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

  it("refuses to clear a notice still waiting on the operator and keeps its state and count", async () => {
    const { database, kernel } = await harness();
    // A storage notice whose concern cannot be read is still standing: nothing proves it handled.
    const standing = randomUUID();
    database.authority.notifications.create(record({ notificationId: standing, dedupeFingerprint: "3".repeat(64), trigger: "storage", title: "Storage needs attention", count: 4, links: [{ kind: "storage", diagnosticFingerprint: "d".repeat(64) }] }));
    const before = database.authority.notifications.get(standing);
    const refused = kernel.execute(one(standing));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "policy-refused");
    assert.deepEqual(database.authority.notifications.get(standing), before);
  });

  it("keeps a recovery notice standing while its command is unsettled, and clears it once settled", async () => {
    const { database, kernel } = await harness();
    const pending = { ...command("notification-read", 1), target: { notificationId: randomUUID(), actorId: ACTOR, expectedVersion: 1 } };
    database.authority.commands.insert(pending);
    const notice = randomUUID();
    database.authority.notifications.create(record({ notificationId: notice, dedupeFingerprint: "7".repeat(64), trigger: "command", title: "Command needs attention",
      summary: "The result of this command is unknown", links: [{ kind: "recovery", commandId: pending.commandId }] }));
    const refused = kernel.execute(one(notice));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "policy-refused");
    database.authority.commandAudits.insert({ auditId: randomUUID(), request: pending, completedAt: LATER, versionChanges: [], affectedDependencyIds: [],
      result: { state: "rejected", commandId: pending.commandId, code: "target-not-found", message: "gone" } });
    assert.equal(kernel.execute(one(notice)).state, "applied");
    assert.deepEqual(listed(database), []);
  });

  it.each([
    { trigger: "gate-waiting",
      event: { kind: "gate-opened", runId: UUID_2, workflowId: "person-lookup", gateId: "approval" },
      same: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "approval" },
      other: { state: "parked-gate", gateId: "review", parkedAt: LATER, resumeAt: "review" } },
    { trigger: "write-parked",
      event: { kind: "write-parked", runId: UUID_2, workflowId: "person-lookup", writeIntentId: "33333333-3333-4333-8333-333333333333" },
      same: { state: "parked-write", writeIntentId: "33333333-3333-4333-8333-333333333333", intentGeneration: 1, parkedAt: NOW, code: "unknown", message: "Synthetic unknown write" },
      other: { state: "parked-write", writeIntentId: "44444444-4444-4444-8444-444444444444", intentGeneration: 1, parkedAt: LATER, code: "unknown", message: "Synthetic unknown write" } },
  ])("refuses a $trigger notice while the run holds what it names, and clears it once handled or held elsewhere", async ({ event, same, other }) => {
    let lifecycle: unknown = same;
    const { database, kernel } = await harness(repositories => ({ ...repositories, runs: { ...repositories.runs,
      get: () => RunRecordSchema.parse({ ...personLookupQueuedRun({ runId: UUID_2 }), lifecycle }) } }));
    const projection = projectNotificationTrigger(event);
    const id = randomUUID();
    database.authority.notifications.create(record({ ...projection, notificationId: id }));
    database.withAuthorityTransaction(repositories => repositories.notificationPublications.create({ sourceId: HASH_C, actorId: ACTOR,
      notificationId: id, event, occurredAt: NOW, createdAt: NOW, adopted: false }));
    const refused = kernel.execute(one(id));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "policy-refused");
    lifecycle = other;
    assert.equal(kernel.execute(one(id)).state, "applied", "the run holds another one; this one is handled");
    const folded = database.withAuthorityTransaction(repositories => repositories.notifications.fold({ actorId: ACTOR, dedupeFingerprint: projection.dedupeFingerprint,
      seenAt: LATER, title: projection.title, summary: projection.summary })).notification;
    lifecycle = same;
    assert.equal(kernel.execute(one(id, folded.version)).state, "rejected");
    lifecycle = { state: "queued" };
    assert.equal(kernel.execute(one(id, folded.version)).state, "applied", "handled");
    assert.deepEqual(listed(database), []);
  });

  it("clears a whole group in one command, or none of it when one member stands or moved", async () => {
    const { database, kernel } = await harness();
    const [a, b, standing] = [randomUUID(), randomUUID(), randomUUID()];
    database.authority.notifications.create(record({ notificationId: a, dedupeFingerprint: "8".repeat(64) }));
    database.authority.notifications.create(record({ notificationId: b, dedupeFingerprint: "9".repeat(64), status: "read" }));
    database.authority.notifications.create(record({ notificationId: standing, dedupeFingerprint: "3".repeat(64), trigger: "storage", title: "Storage needs attention", links: [{ kind: "storage", diagnosticFingerprint: "d".repeat(64) }] }));
    const before = [a, b, standing].map(id => database.authority.notifications.get(id));
    const withStanding = kernel.execute(clear([[a, 1], [b, 1], [standing, 1]]));
    assert.equal(withStanding.state, "rejected");
    if (withStanding.state === "rejected") assert.equal(withStanding.code, "policy-refused");
    assert.equal(kernel.execute(clear([[a, 1], [b, 2]])).state, "rejected", "a member at another version refuses the whole group");
    assert.deepEqual([a, b, standing].map(id => database.authority.notifications.get(id)), before, "a refusal leaves every member as it was");
    const result = kernel.execute(clear([[a, 1], [b, 1]]));
    assert.equal(result.state, "applied");
    if (result.state === "applied") assert.equal(result.affectedTargets.length, 2, "read and unread members clear together");
    assert.deepEqual(listed(database), [standing]);
  });

  it("clears only the rows Clear all named, so a notice that arrives after the list stays", async () => {
    const { database, kernel } = await harness();
    const ids = Array.from({ length: 3 }, () => randomUUID());
    for (const [index, notificationId] of ids.entries()) database.authority.notifications.create(record({ notificationId, dedupeFingerprint: String(index).repeat(64) }));
    const request = clear(ids.map(id => [id, 1] as const));
    const arrived = randomUUID();
    database.authority.notifications.create(record({ notificationId: arrived, dedupeFingerprint: "6".repeat(64) }));
    assert.equal(kernel.execute(request).state, "applied");
    assert.deepEqual(listed(database), [arrived]);
  });

  it("refuses a pinned backfill gap and another person's notices, leaving theirs untouched", async () => {
    const { database, kernel } = await harness();
    const pinned = randomUUID(), theirs = randomUUID();
    database.authority.notifications.create(record({ notificationId: pinned, dedupeFingerprint: "b".repeat(64), trigger: "backfill-gap", links: [] }));
    database.authority.notifications.create(record({ notificationId: theirs, actorId: "other-operator", dedupeFingerprint: "5".repeat(64) }));
    assert.equal(kernel.execute(one(pinned)).state, "rejected");
    assert.equal(kernel.execute(one(theirs)).state, "rejected");
    assert.equal(kernel.execute(clear([[theirs, 1]], "other-operator")).state, "rejected", "the admitted actor cannot clear for someone else");
    assert.equal(database.authority.notifications.get(theirs)?.clearedAt, undefined);
    assert.equal(database.authority.notifications.get(theirs)?.version, 1);
    assert.deepEqual(listed(database), [pinned]);
  });

  it("reuses the served day when only storage health or a notification command result changes", async () => {
    const { database } = await harness();
    const pending = { ...command("notification-read", 1), target: { notificationId: randomUUID(), actorId: ACTOR, expectedVersion: 1 } };
    database.authority.commands.insert(pending);
    const day = LATER.slice(0, 10);
    const observed = () => {
      const first = database.checkQueueDaySources(day);
      assert.ok(first);
      assert.equal(first.kind, "full");
      return { through: first.through, retryConfigFingerprint: first.retryConfigFingerprint,
        runIds: [], timelineRunIds: [], lastWorkerClaims: [], relationships: [], month: { from: day, to: day, counts: [] } };
    };
    let previous = observed();
    assert.equal(database.checkQueueDaySources(day, previous)?.kind, "unchanged");
    database.withAuthorityTransaction(repositories => repositories.notificationHealth.put({ concern: "disk-space", active: false,
      occurrence: 0, observedAt: LATER, createdAt: LATER, samples: [] }));
    assert.equal(database.checkQueueDaySources(day, previous)?.kind, "unchanged", "storage standing belongs to the inbox");
    previous = observed();
    database.authority.commandAudits.insert({ auditId: randomUUID(), request: pending, completedAt: LATER, versionChanges: [], affectedDependencyIds: [],
      result: { state: "rejected", commandId: pending.commandId, code: "target-not-found", message: "gone" } });
    assert.equal(database.checkQueueDaySources(day, previous)?.kind, "unchanged", "command recovery standing belongs to the inbox");
  });
});
