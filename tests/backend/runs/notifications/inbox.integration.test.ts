import { runInheritedRuntimeChild } from "../../../support/helpers/backend/runtime-lifetime.js";
import { createNotificationInboxTestWorld } from "../../../support/helpers/backend/notification-inbox-world.js";



import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";

import { manualClock } from "../../../../src/rules/time/clock.js";

import { NOW, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

{

const { _afterEachFixture0, record, harness, command } = createNotificationInboxTestWorld();

describe("notification collection commands", () => {
  afterEach(_afterEachFixture0);
  const actor = "local-operator";
  const collectionCommand = (database: Awaited<ReturnType<typeof harness>>["database"], type = "notification-read-all") => ({
    ...command(type, 1), target: database.withAuthorityReadSnapshot(() => database.authority.notifications.collection(actor, type === "notification-read-all" ? "read" : type === "notification-unread-all" ? "unread" : type === "notification-snooze-all" ? "snooze" : "unsnooze")),
  });
  it("changes more than twenty current notices atomically, preserves pinned and UNKNOWN evidence, and replays one aggregate audit", async () => {
    const { database, kernel } = await harness();
    const ids = Array.from({ length: 25 }, () => randomUUID());
    for (const [index, notificationId] of ids.entries()) database.authority.notifications.create(record({ notificationId, dedupeFingerprint: index.toString(16).padStart(64, "0"), trigger: "write-parked" }));
    const pinned = record({ notificationId: randomUUID(), dedupeFingerprint: "b".repeat(64), trigger: "backfill-gap", links: [] });
    database.authority.notifications.create(pinned);
    const before = database.authority.notifications.listByActor(actor);
    const request = collectionCommand(database);
    assert.equal(request.target.members.length, 26); assert.equal(request.target.matchingCount, 25);
    const result = kernel.execute(request); assert.equal(result.state, "applied");
    if (result.state !== "applied") throw new Error("bulk applied result required");
    assert.equal(result.affectedTargets.length, 25);
    assert.deepEqual(database.authority.notifications.get(pinned.notificationId), pinned);
    for (const original of before.filter(row => row.trigger !== "backfill-gap")) {
      assert.deepEqual(database.authority.notifications.get(original.notificationId), { ...original, status: "read", version: 2, updatedAt: request.requestedAt });
    }
    const audit = database.authority.commandAudits.findByCommand(request.commandId); assert.ok(audit);
    assert.equal(audit.versionChanges.length, 25);
    const generation = database.getMeta().authorityGeneration;
    assert.deepEqual(kernel.execute(request), { ...result, state: "already-applied" });
    assert.deepEqual(database.authority.commandAudits.findByCommand(request.commandId), audit);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });
  it.each(["added", "changed", "foreign", "duplicate", "omitted"])("refuses the whole collection after %s membership drift", async change => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record());
    const request = collectionCommand(database);
    if (change === "added") database.authority.notifications.create(record({ notificationId: randomUUID(), dedupeFingerprint: "c".repeat(64) }));
    if (change === "changed") database.authority.notifications.updateState({ notificationId: UUID_7, expectedVersion: 1, status: "unread", snooze: { state: "not-snoozed" }, updatedAt: request.requestedAt });
    const candidate = change === "foreign" ? { ...request, target: { ...request.target, actorId: "other-operator" } }
      : change === "duplicate" ? { ...request, target: { ...request.target, members: [...request.target.members, ...request.target.members] } }
      : change === "omitted" ? { ...request, target: { ...request.target, members: [], matchingCount: 0 } } : request;
    const rows = database.authority.notifications.listByActor(actor);
    const result = change === "duplicate" ? undefined : kernel.execute(candidate);
    if (change === "duplicate") assert.throws(() => kernel.execute(candidate)); else assert.equal(result?.state, "rejected");
    assert.deepEqual(database.authority.notifications.listByActor(actor), rows);
  });
  it.each(["late-row", "audit"])("rolls all rows and command publication back on %s failure", async boundary => {
    let writes = 0;
    const { database, kernel } = await harness(repositories => ({ ...repositories,
      notifications: { ...repositories.notifications, updateState: input => {
        writes++; if (boundary === "late-row" && writes === 23) throw new Error("controlled late row failure");
        return repositories.notifications.updateState(input);
      } },
      commandAudits: { ...repositories.commandAudits, insert: input => {
        if (boundary === "audit") throw new Error("controlled audit failure"); return repositories.commandAudits.insert(input);
      } },
    }));
    for (let index = 0; index < 25; index++) database.authority.notifications.create(record({ notificationId: randomUUID(), dedupeFingerprint: index.toString(16).padStart(64, "0") }));
    const request = collectionCommand(database), rows = database.authority.notifications.listByActor(actor), generation = database.getMeta().authorityGeneration;
    assert.throws(() => kernel.execute(request)); assert(writes >= 23);
    assert.deepEqual(database.authority.notifications.listByActor(actor), rows);
    assert.equal(database.authority.commands.get(request.commandId), undefined);
    assert.equal(database.authority.commandAudits.findByCommand(request.commandId), undefined);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });
  it.each(["read", "unread", "snooze", "unsnooze"] as const)("uses the same per-row %s rules and never includes another actor", async operation => {
    const { database, kernel } = await harness();
    const mutable = record({ status: operation === "unread" ? "read" : "unread", snooze: { state: "snoozed", until: "2026-08-01T18:00:00.000Z" } });
    const pinned = record({ notificationId: randomUUID(), dedupeFingerprint: "b".repeat(64), trigger: "backfill-gap", links: [] });
    const foreign = record({ notificationId: randomUUID(), actorId: "other-operator" });
    for (const row of [mutable, pinned, foreign]) database.authority.notifications.create(row);
    const request = collectionCommand(database, `notification-${operation}-all`);
    assert.equal(request.target.members.length, 2); assert.equal(request.target.matchingCount, 1);
    assert.equal(kernel.execute(request).state, "applied");
    const changed = database.authority.notifications.get(UUID_7); assert.ok(changed);
    assert.equal(changed.version, 2);
    assert.equal(changed.status, operation === "read" ? "read" : operation === "unread" ? "unread" : mutable.status);
    assert.deepEqual(changed.snooze, operation === "snooze" ? { state: "snoozed", until: "2026-07-31T18:01:00.000Z" } : operation === "unsnooze" ? { state: "not-snoozed" } : mutable.snooze);
    assert.deepEqual(database.authority.notifications.get(pinned.notificationId), pinned);
    assert.deepEqual(database.authority.notifications.get(foreign.notificationId), foreign);
  });
  it("honestly applies an empty current collection with no affected rows", async () => {
    const { database, kernel } = await harness(), request = collectionCommand(database), result = kernel.execute(request);
    assert.equal(result.state, "applied"); if (result.state !== "applied") throw new Error("applied required");
    assert.deepEqual(result.affectedTargets, []);
    assert.equal(result.noChange, "no-matching-notifications");
    const audit = database.authority.commandAudits.findByCommand(request.commandId); assert.ok(audit);
    assert.deepEqual(audit.result, result); assert.deepEqual(audit.versionChanges, []);
    const replay = kernel.execute(request); assert.deepEqual(replay, { ...result, state: "already-applied" });
    assert.deepEqual(database.authority.commandAudits.findByCommand(request.commandId), audit);
    const generation = database.getMeta().authorityGeneration;
    for (const candidate of [
      { ...request, type: "notification-read", target: { actorId: "local-operator", notificationId: randomUUID(), expectedVersion: 1 } },
      { ...request, target: { actorId: "local-operator", members: [{ notificationId: randomUUID(), expectedVersion: 1 }], matchingCount: 1 } },
      { ...request, family: "workflow-batch", type: "set-batch-grouping", target: { batchId: randomUUID(), expectedVersion: 1 }, payload: { groupInQueue: false } },
    ]) assert.throws(() => database.withAuthorityTransaction(repositories => repositories.commandAudits.insert({ ...audit, auditId: randomUUID(), request: candidate })), { name: "ZodError" });
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(database.authority.commandAudits.findByCommand(request.commandId), audit);
  });
});

describe("notification lifecycle arms", () => {
afterEach(_afterEachFixture0);

  it("refuses a crafted mark-read command for a pinned backfill gap", async () => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-read", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "policy-refused");
      assert.match(result.message, /pinned backfill gap/u);
    }
    const unchanged = database.authority.notifications.get(UUID_7);
    assert.equal(unchanged?.status, "unread");
    assert.equal(unchanged?.version, 1);
  });

  it("refuses a crafted snooze command for a pinned backfill gap", async () => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-snooze", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "policy-refused");
    const unchanged = database.authority.notifications.get(UUID_7);
    assert.deepEqual(unchanged?.snooze, { state: "not-snoozed" });
    assert.equal(unchanged?.version, 1);
  });

  it("refuses a crafted same-state mark-unread command for a pinned backfill gap", async () => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-unread", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "policy-refused");
    assert.equal(database.authority.notifications.get(UUID_7)?.version, 1);
  });

  it("marks read preserving the snooze, and unread preserving it too", async () => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record({
      snooze: { state: "snoozed", until: "2026-07-31T18:00:00.000Z" },
    }));

    assert.equal(kernel.execute(command("notification-read", 1)).state, "applied");
    const read = database.authority.notifications.get(UUID_7);
    assert.equal(read?.status, "read");
    assert.deepEqual(read?.snooze, { state: "snoozed", until: "2026-07-31T18:00:00.000Z" });

    assert.equal(kernel.execute(command("notification-unread", 2)).state, "applied");
    assert.equal(database.authority.notifications.get(UUID_7)?.status, "unread");
  });

  it("snoozes for one backend-clock hour, preserving read state, then unsnoozes", async () => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record({ status: "read", version: 1 }));

    const snoozed = kernel.execute(command("notification-snooze", 1));
    assert.equal(snoozed.state, "applied");
    const row = database.authority.notifications.get(UUID_7);
    assert.equal(row?.status, "read");
    assert.deepEqual(row?.snooze, { state: "snoozed", until: "2026-07-31T18:01:00.000Z" });

    const before = database.getMeta().authorityGeneration;
    assert.throws(() => kernel.execute(command("notification-snooze", 2, { payload: { until: NOW } })));
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(kernel.execute(command("notification-unsnooze", 2)).state, "applied");
    assert.deepEqual(database.authority.notifications.get(UUID_7)?.snooze, { state: "not-snoozed" });
  });

  it("rejects a stale version and a foreign actor", async () => {
    const { database, kernel } = await harness();
    database.authority.notifications.create(record());

    const stale = kernel.execute(command("notification-read", 7));
    assert.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert.match(stale.message, /reload the inbox/u);

    const foreign = kernel.execute({
      ...command("notification-read", 1),
      target: { notificationId: UUID_7, actorId: "other-operator", expectedVersion: 1 },
    });
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.match(foreign.message, /target actor does not match/u);
  });
});
}

{

const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const _afterEachFixture0 = async () => {
  const failures: unknown[] = [];
  for (const profile of profiles.splice(0)) { try { await profile.close(); } catch (error) { failures.push(error); } }
  if (failures.length > 0) throw new AggregateError(failures, "notification publication fixture cleanup failed");
};
const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
async function harness() {
  const profile = await createBoundProfileFixture({ sharedMachine: true }); profiles.push(profile);
  const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
  const path = profile.path;
  const open = () => AuthorityDatabase.open(profile.admission, { path, busyTimeoutMs: 250, migrationOwner: "notification-test" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  const inbox = (db: AuthorityDatabase) => createNotificationInbox({ authority: db, clock, ids: sequentialIdFactory("a"), actorId: "local-operator" });
  return { open, inbox, clock, path, lifetime: profile.lifetime, workspace: profile.workspace, profileId: profile.admission.profileBinding.profileId };
}
describe("durable notification publication", () => {
afterEach(_afterEachFixture0);

  it.each(["before", "after"])("survives process death %s publication commit", async boundary => {
    const f = await harness(); const initial = f.open(); initial.close();
    const script = `
      import { AuthorityDatabase } from ${JSON.stringify(join(process.cwd(), "src/backend/storage/sqlite/authority-database.ts"))};
      import { acquireSharedRuntimeAdmission } from ${JSON.stringify(join(process.cwd(), "src/backend/storage/admission/admission.ts"))};
      import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(join(process.cwd(), "src/backend/storage/admission/lifetime-lock.ts"))};
      import { createProfileRegistry } from ${JSON.stringify(join(process.cwd(), "src/backend/profiles/registry.ts"))};
      import { registerBoundProfile, boundProfileCredentials } from ${JSON.stringify(join(process.cwd(), "tests/support/helpers/synthetic-database-admission.ts"))};
      import { join } from "node:path";
      import { manualClock } from ${JSON.stringify(join(process.cwd(), "src/rules/time/clock.ts"))};
      import { createNotificationInbox } from ${JSON.stringify(join(process.cwd(), "src/backend/runs/notifications/inbox.ts"))};
      const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
      const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
      const machine = acquireSharedRuntimeAdmission(process.argv[2], lifetime);
      const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(process.argv[3]));
      registerBoundProfile(admission, machine);
      const db = AuthorityDatabase.open(admission,{path:join(admission.stateRoot,"state.db"),busyTimeoutMs:250,migrationOwner:"crash-proof"},clock,
        undefined,undefined,undefined,boundProfileCredentials(admission));
      const inbox = createNotificationInbox({authority:db,clock,ids:{uuid:()=>"00000000-0000-4000-8000-000000000991"},actorId:"local-operator"});
      const event = ${JSON.stringify(event)};
      if(process.argv[4]==="before") db.withAuthorityTransaction(()=>{void inbox.publish(event);process.exit(71);});
      else {await inbox.publish(event);process.exit(72);}
    `;
    const child = await runInheritedRuntimeChild(f.lifetime, script, [f.workspace, f.profileId, boundary]);
    expect(child.status, child.stderr).toBe(boundary === "before" ? 71 : 72);
    const db = f.open();
    try {
      expect(db.authority.notificationPublications.list()).toHaveLength(boundary === "before" ? 0 : 1);
      expect(db.authority.notifications.listByActor("local-operator")).toHaveLength(boundary === "before" ? 0 : 1);
    } finally { db.close(); }
  });
  it("adopts historical occurrences without resetting the existing operator row", async () => {
    const f = await harness(), db = f.open();
    try {
      const inbox = f.inbox(db);
      const { projectNotificationTrigger } = await import("../../../../src/rules/notifications/notification-triggers.js");
      const projection = projectNotificationTrigger(event);
      const record = { ...projection, notificationId: "00000000-0000-4000-8000-000000000123", actorId: "local-operator", status: "read",
        snooze: { state: "snoozed", until: "2026-09-15T12:00:00Z" }, count: 4, version: 7,
        lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() };
      db.authority.notifications.create(record);
      const emitted: unknown[] = []; inbox.onPublication(publication => emitted.push(publication));
      const report = await inbox.publish(event, { identity: "d".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(emitted).toEqual([]);
      expect(report.durable).toBe("existing"); expect(report.notification).toEqual(record);
      expect(db.authority.notificationPublications.latest(record.notificationId)).toBeUndefined();
    } finally { db.close(); }
  });
  it("retains a committed source without an OS delivery channel across restart", async () => {
    const f = await harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      expect((await inbox.publish(event)).delivery.state).toBe("no-channel");
      db.close(); db = f.open(); expect((await f.inbox(db).publish(event)).durable).toBe("existing");
    } finally { db.close(); }
  });

  it("commits one occurrence under concurrent replay and preserves read/snooze across restart", async () => {
    const f = await harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      const reports = await Promise.all([inbox.publish(event), inbox.publish(event)]);
      expect(reports.map(row => row.durable)).toEqual(["created", "existing"]);
      const id = reports[0].notification.notificationId;
      inbox.markRead(id, 1); inbox.snooze(id, 2, "2026-09-15T12:00:00Z");
      const before = inbox.get(id);
      db.close(); db = f.open();
      expect((await f.inbox(db).publish(event)).notification).toEqual(before);
    } finally { db.close(); }
  });
  it("rolls back source and row together, then folds each distinct source once", async () => {
    const f = await harness(), db = f.open();
    try {
      const inbox = f.inbox(db);
      const first = await inbox.publish(event);
      await inbox.publish(event, { identity: "b".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(inbox.get(first.notification.notificationId)?.count).toBe(2);
      const before = db.authority.notificationPublications.list();
      expect(() => db.withAuthorityTransaction(repos => {
        repos.notificationPublications.create({ ...before[0], sourceId: "c".repeat(64) });
        throw new Error("crash-before-commit");
      })).toThrow("crash-before-commit");
      expect(db.authority.notificationPublications.list()).toEqual(before);
      await inbox.publish(event, { identity: "b".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(inbox.get(first.notification.notificationId)?.count).toBe(2);
    } finally { db.close(); }
  });
});
}

describe("committed publication signal", () => {
  const world = createNotificationInboxTestWorld();
  afterEach(world._afterEachFixture0);
  const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
  it("emits created and folded exactly once after the outer commit, excluding replay and state commands", async () => {
    const { database } = await world.harness();
    const inbox = createNotificationInbox({ authority: database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("f"), actorId: "local-operator" });
    const emitted: import("../../../../src/backend/runs/notifications/inbox.js").NotificationPublication[] = [];
    const dispose = inbox.onPublication(value => { assert(database.authority.notificationPublications.get(value.sourceId)); emitted.push(value); });
    let pending: ReturnType<typeof inbox.publish> | undefined;
    database.withAuthorityTransaction(() => {
      pending = inbox.publish(event);
      assert.equal(emitted.length, 0);
    });
    await pending;
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].durable, "created");
    await inbox.publish(event);
    assert.equal(emitted.length, 1);
    const id = emitted[0].notification.notificationId;
    inbox.markRead(id, 1);
    inbox.snooze(id, 2, "2026-09-15T12:00:00Z");
    assert.equal(emitted.length, 1);
    const folded = await inbox.publish(event, { identity: "b".repeat(64), occurredAt: NOW });
    assert.equal(folded.delivery.state, "suppressed-snoozed");
    assert.equal(emitted[1].durable, "folded");
    assert.equal(emitted[1].notification.snooze.state, "snoozed");
    assert.notEqual(emitted[0].sourceId, emitted[1].sourceId);
    dispose();
    await inbox.publish(event, { identity: "c".repeat(64), occurredAt: NOW });
    assert.equal(emitted.length, 2);
  });
  it("discards both outer and nested rolled-back publications, permitting later retry after rollback", async () => {
    const { database } = await world.harness();
    const inbox = createNotificationInbox({ authority: database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("f"), actorId: "local-operator" });
    const emitted: unknown[] = []; inbox.onPublication(value => emitted.push(value));
    let pending: ReturnType<typeof inbox.publish> | undefined;
    assert.throws(() => database.withAuthorityTransaction(() => { pending = inbox.publish(event); throw new Error("outer rollback"); }), /outer rollback/);
    await pending;
    assert.equal(emitted.length, 0);
    database.withAuthorityTransaction(() => {
      assert.throws(() => database.withAuthorityTransaction(() => { pending = inbox.publish(event); throw new Error("nested rollback"); }), /nested rollback/);
      assert.equal(emitted.length, 0);
    });
    await pending;
    assert.equal(emitted.length, 0);
    assert.equal(database.authority.notificationPublications.list().length, 0);
    assert.equal((await inbox.publish(event)).durable, "created");
    assert.equal(emitted.length, 1);
  });
});
