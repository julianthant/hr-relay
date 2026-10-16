import { createNotificationInboxTestWorld } from "../../../support/helpers/backend/notification-inbox-world.js";



import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";

import { manualClock } from "../../../../src/rules/time/clock.js";

import { NOW, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

{

const { _afterEachFixture0, record, harness, command } = createNotificationInboxTestWorld();

describe("notification lifecycle arms", () => {
afterEach(_afterEachFixture0);

  it("refuses a crafted mark-read command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
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

  it("refuses a crafted snooze command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
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

  it("refuses a crafted same-state mark-unread command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-unread", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "policy-refused");
    assert.equal(database.authority.notifications.get(UUID_7)?.version, 1);
  });

  it("marks read preserving the snooze, and unread preserving it too", () => {
    const { database, kernel } = harness();
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

  it("snoozes for one backend-clock hour, preserving read state, then unsnoozes", () => {
    const { database, kernel } = harness();
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

  it("rejects a stale version and a foreign actor", () => {
    const { database, kernel } = harness();
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

const roots: string[] = [];
const _afterEachFixture0 = () => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
function harness() {
  const root = mkdtempSync(join(tmpdir(), "notification-publication-")); roots.push(root);
  const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
  const path = join(root, "state.db");
  const open = () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "notification-test" }, clock);
  const inbox = (db: AuthorityDatabase) => createNotificationInbox({ authority: db, clock, ids: sequentialIdFactory("a"), actorId: "local-operator" });
  return { open, inbox, clock, path };
}
describe("durable notification publication", () => {
afterEach(_afterEachFixture0);

  it.each(["before", "after"])("survives process death %s publication commit", boundary => {
    const f = harness(); const initial = f.open(); initial.close();
    const script = `
      import { AuthorityDatabase } from ${JSON.stringify(join(process.cwd(), "tests/support/helpers/synthetic-storage-admission.ts"))};
      import { manualClock } from ${JSON.stringify(join(process.cwd(), "src/rules/time/clock.ts"))};
      import { createNotificationInbox } from ${JSON.stringify(join(process.cwd(), "src/backend/runs/notifications/inbox.ts"))};
      const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
      const db = AuthorityDatabase.open({path:process.argv[1],busyTimeoutMs:250,migrationOwner:"crash-proof"},clock);
      const inbox = createNotificationInbox({authority:db,clock,ids:{uuid:()=>"00000000-0000-4000-8000-000000000991"},actorId:"local-operator"});
      const event = ${JSON.stringify(event)};
      if(process.argv[2]==="before") db.withAuthorityTransaction(()=>{void inbox.publish(event);process.exit(71);});
      else {await inbox.publish(event);process.exit(72);}
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.path, boundary], { cwd: process.cwd(), encoding: "utf8" });
    expect(child.status, child.stderr).toBe(boundary === "before" ? 71 : 72);
    const db = f.open();
    try {
      expect(db.authority.notificationPublications.list()).toHaveLength(boundary === "before" ? 0 : 1);
      expect(db.authority.notifications.listByActor("local-operator")).toHaveLength(boundary === "before" ? 0 : 1);
    } finally { db.close(); }
  });
  it("adopts historical occurrences without resetting the existing operator row", async () => {
    const f = harness(), db = f.open();
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
    const f = harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      expect((await inbox.publish(event)).delivery.state).toBe("no-channel");
      db.close(); db = f.open(); expect((await f.inbox(db).publish(event)).durable).toBe("existing");
    } finally { db.close(); }
  });

  it("commits one occurrence under concurrent replay and preserves read/snooze across restart", async () => {
    const f = harness(); let db = f.open();
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
    const f = harness(), db = f.open();
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
    const { database } = world.harness();
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
    const { database } = world.harness();
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
