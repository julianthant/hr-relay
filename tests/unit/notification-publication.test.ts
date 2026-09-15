import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { manualClock } from "../../src/domain/clock.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { createNotificationInbox } from "../../src/services/notifications/inbox.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
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
  it.each(["before", "after"])("survives process death %s publication commit", boundary => {
    const f = harness(); const initial = f.open(); initial.close();
    const script = `
      import { AuthorityDatabase } from "./src/infra/sqlite/authority-database.ts";
      import { manualClock } from "./src/domain/clock.ts";
      import { createNotificationInbox } from "./src/services/notifications/inbox.ts";
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
      const { projectNotificationTrigger } = await import("../../src/domain/notification-triggers.js");
      const projection = projectNotificationTrigger(event);
      const record = { ...projection, notificationId: "00000000-0000-4000-8000-000000000123", actorId: "local-operator", status: "read",
        snooze: { state: "snoozed", until: "2026-09-15T12:00:00Z" }, count: 4, version: 7,
        lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() };
      db.authority.notifications.create(record);
      const report = await inbox.publish(event, { identity: "d".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(report.durable).toBe("existing"); expect(report.notification).toEqual(record);
      expect(db.authority.notificationPublications.latest(record.notificationId)).toBeUndefined();
    } finally { db.close(); }
  });
  it("retains a committed source when delivery crashes and never redelivers it on restart", async () => {
    const f = harness(); let db = f.open(); let deliveries = 0;
    try {
      const inbox = createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("b"), actorId: "local-operator",
        delivery: { deliver: async record => { deliveries += 1; expect(db.authority.notifications.get(record.notificationId)).toEqual(record); throw new Error("crash-after-commit"); } } });
      expect((await inbox.publish(event)).delivery.state).toBe("failed");
      db.close(); db = f.open(); expect((await f.inbox(db).publish(event)).durable).toBe("existing");
      expect(deliveries).toBe(1);
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
