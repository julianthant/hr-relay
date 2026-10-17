import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { createTrustRunReader } from "../../../src/backend/runs/trust/canonical-reader.js";
import { personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { NotificationTriggerEventSchema, deriveNotificationDedupeFingerprint, notificationDeliverability, projectNotificationTrigger } from "../../../src/rules/notifications/notification-triggers.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { createNotificationInbox, type NotificationInbox } from "../../../src/backend/runs/notifications/inbox.js";
import { HASH_A, HASH_B, HASH_C, NOW, UUID_1, UUID_2, UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const NEXT = "2026-07-31T17:05:00.000Z";
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function sequentialIds(lane = "0"): { uuid: () => string } {
  let index = 0;
  return {
    uuid: () => {
      index += 1;
      return `${String(index).padStart(8, "0")}-0000-4000-8000-00000000000${lane}`;
    },
  };
}

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-notify-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "notification-durability" },
    manualClock(new Date(NOW)),
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_2 }));
  const separations = RunRecordSchema.parse(personLookupQueuedRun({ runId: UUID_4 }));
  database.authority.runs.enqueue(RunRecordSchema.parse({ ...separations,
    envelope: { ...separations.envelope, workflow: "separations" } }));
  return database;
}

function inboxFor(
  database: AuthorityDatabase,
  now: string,
): NotificationInbox {
  return createNotificationInbox({
    runReader: createTrustRunReader(database),
    authority: database,
    clock: manualClock(new Date(now)),
    ids: sequentialIds(),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });
}

const RUN_FAILED = {
  kind: "run-failed",
  runId: UUID_2,
  workflowId: "person-lookup",
  failureId: UUID_1,
  failureFingerprint: HASH_A,
  code: "CRM_UNAVAILABLE",
} as const;

/** One representative event per closed trigger, ref dashboard-surfaces's whole list. */
const EVERY_EVENT = [
  RUN_FAILED,
  {
    kind: "subject-mismatch", runId: UUID_4, workflowId: "separations",
    failureId: UUID_4, failureFingerprint: HASH_B,
  },
  { kind: "gate-opened", runId: UUID_4, workflowId: "separations", gateId: "confirm-identity" },
  { kind: "write-parked", runId: UUID_4, workflowId: "separations", writeIntentId: UUID_4 },
  {
    kind: "repeating-failure", runId: UUID_2, workflowId: "person-lookup",
    failureId: UUID_1, failureFingerprint: HASH_A, occurrences: 5, threshold: 3,
  },
  { kind: "storage-degraded", concern: "backup", state: "failed", diagnosticFingerprint: HASH_C },
  { kind: "verified-done", runId: UUID_2, workflowId: "person-lookup" },
  {
    kind: "backfill-gap",
    detector: "server-resume",
    reason: "cursor-expired",
    topic: "dashboard-day",
    requestedCursor: "pc:1",
    currentCursor: "pc:4",
    projectionGeneration: 1,
  },
] as const;

describe("notification-durability: every closed trigger commits a durable item", () => {
  it("routes each trigger to its channel and stores it unread", async () => {
    const database = openDatabase();
    const inbox = inboxFor(database, NOW);
    const routed: [string, string, string][] = [];
    for (const event of EVERY_EVENT) {
      const report = await inbox.publish(event);
      assert.equal(report.durable, "created");
      assert.equal(report.notification.status, "unread");
      assert.equal(report.notification.count, 1);
      assert.equal(report.notification.version, 1);
      // Durable, not merely returned.
      const stored = database.authority.notifications.get(report.notification.notificationId);
      assert.ok(stored);
      routed.push([event.kind, stored.trigger, stored.channel]);
    }
    assert.deepEqual(routed, [
      ["run-failed", "failed", "ping"],
      ["subject-mismatch", "failed", "ping"],
      ["gate-opened", "gate-waiting", "ping"],
      ["write-parked", "write-parked", "ping"],
      ["repeating-failure", "repeating", "ping"],
      ["storage-degraded", "storage", "ping"],
      ["verified-done", "verified-done", "inbox"],
      ["backfill-gap", "backfill-gap", "ping"],
    ]);
    assert.equal(inbox.list(LOCAL_OPERATOR_ACTOR_ID, "unread").length, EVERY_EVENT.length);
  });

  it("gives every closed trigger its own dedupe identity and links", () => {
    const fingerprints = EVERY_EVENT.map((event) => deriveNotificationDedupeFingerprint(event));
    assert.equal(new Set(fingerprints).size, EVERY_EVENT.length);
    assert.deepEqual(
      EVERY_EVENT.map((event) => projectNotificationTrigger(event).links[0]?.kind),
      ["failure", "failure", "run", "run", "failure", "storage", "run", undefined],
    );
    // The occurrence never enters the identity: a second firing of the same
    // repeating alert with a higher count folds into the same row.
    assert.equal(
      deriveNotificationDedupeFingerprint({ ...EVERY_EVENT[4], occurrences: 9 }),
      fingerprints[4],
    );
  });

  it("has no free-text channel a captured value could enter through", () => {

    assert.equal(
      NotificationTriggerEventSchema.safeParse({ ...RUN_FAILED, message: "SSN 920-74-1459" }).success,
      false,
    );
    const projection = projectNotificationTrigger(RUN_FAILED);
    assert.ok(projection.summary.includes(RUN_FAILED.runId));
    assert.ok(!projection.summary.includes("920-74-1459"));
  });
});

describe("notification-durability: the durable row is committed before delivery", () => {
  it("reports a missing desktop channel as no-channel, never as delivered", async () => {
    const database = openDatabase();
    const report = await inboxFor(database, NOW).publish(RUN_FAILED);
    assert.equal(report.delivery.state, "no-channel");
    assert.equal(database.authority.notifications.get(report.notification.notificationId)?.status, "unread");
  });
});

describe("notification-durability: repeats fold, they do not spam", () => {
  it("folds a distinct occurrence of the same trigger into one row with count and lastSeenAt", async () => {
    const database = openDatabase();
    const first = await inboxFor(database, NOW).publish(RUN_FAILED);
    const second = await inboxFor(database, NEXT).publish({ ...RUN_FAILED, failureId: UUID_4 });

    assert.equal(second.durable, "folded");
    assert.equal(second.notification.notificationId, first.notification.notificationId);
    assert.equal(second.notification.count, 2);
    assert.equal(second.notification.lastSeenAt, NEXT);
    assert.equal(second.notification.version, 2);
    assert.equal(database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 1);
  });

  it("makes a repeat unread again after the operator read it", async () => {
    const database = openDatabase();
    const created = await inboxFor(database, NOW).publish(RUN_FAILED);
    const read = inboxFor(database, NEXT).markRead(created.notification.notificationId, 1);
    assert.equal(read.status, "read");

    const repeated = await inboxFor(database, NEXT).publish({ ...RUN_FAILED, failureId: UUID_4 });
    assert.equal(repeated.durable, "folded");
    assert.equal(repeated.notification.status, "unread");
    assert.equal(repeated.notification.count, 2);
  });

  it("keeps two different actors' rows apart even for one trigger", async () => {
    const database = openDatabase();
    const operator = await inboxFor(database, NOW).publish(RUN_FAILED);
    const second = createNotificationInbox({
      runReader: createTrustRunReader(database),
    authority: database,
      clock: manualClock(new Date(NEXT)),
      ids: sequentialIds("1"),
      actorId: "second-operator",
    });
    const other = await second.publish(RUN_FAILED);
    assert.notEqual(other.notification.notificationId, operator.notification.notificationId);
    assert.equal(other.durable, "created");
  });
});

describe("notification-durability: snooze suppresses delivery and nothing else", () => {
  it("keeps the status the operator left and skips the toast until expiry", async () => {
    const database = openDatabase();
    const created = await inboxFor(database, NOW).publish(RUN_FAILED);
    const until = "2026-07-31T18:00:00.000Z";
    const snoozed = inboxFor(database, NEXT).snooze(created.notification.notificationId, 1, until);
    assert.equal(snoozed.status, "unread", "snoozing may never flip read state");
    assert.deepEqual(snoozed.snooze, { state: "snoozed", until });

    const report = await inboxFor(database, NEXT).publish({ ...RUN_FAILED, failureId: UUID_4 });
    assert.deepEqual(report.delivery, { state: "suppressed-snoozed", until });
    // Still folded durably: suppression is about delivery, not about recording.
    assert.equal(report.notification.count, 2);
    assert.equal(report.notification.status, "unread");

    assert.deepEqual(notificationDeliverability(report.notification, "2026-07-31T18:00:01.000Z"), {
      state: "deliverable",
    });
  });

  it("keeps read state and snooze independent in both directions", async () => {
    const database = openDatabase();
    const created = await inboxFor(database, NOW).publish(RUN_FAILED);
    const inbox = inboxFor(database, NEXT);
    const snoozed = inbox.snooze(created.notification.notificationId, 1, "2026-07-31T18:00:00.000Z");
    const read = inbox.markRead(snoozed.notificationId, snoozed.version);
    assert.equal(read.status, "read");
    assert.equal(read.snooze.state, "snoozed", "marking read may not clear a snooze");
    const cleared = inbox.clearSnooze(read.notificationId, read.version);
    assert.equal(cleared.snooze.state, "not-snoozed");
    assert.equal(cleared.status, "read", "clearing a snooze may not flip read state");
  });

  it("refuses a state change against a stale version", async () => {
    const database = openDatabase();
    const created = await inboxFor(database, NOW).publish(RUN_FAILED);
    const inbox = inboxFor(database, NEXT);
    inbox.markRead(created.notification.notificationId, 1);
    assert.throws(
      () => inbox.markUnread(created.notification.notificationId, 1),
      /is at version 2, not 1/,
    );
  });
});
