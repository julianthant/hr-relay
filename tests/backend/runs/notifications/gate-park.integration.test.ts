import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { createGateParkNotifier } from "../../../../src/backend/runs/notifications/gate-park.js";
import { createNotificationInbox,type NotificationPublishReport } from "../../../../src/backend/runs/notifications/inbox.js";
import { notificationWireOf } from "../../../../src/models/dashboard/projection.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW,UUID_1,UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const PARK_A = { runId: UUID_1, workflowId: "separations", gateId: "identity-approval" } as const;
const PARK_B = { runId: UUID_2, workflowId: "person-lookup", gateId: "identity-approval" } as const;


function recordingInbox(): {
  published: unknown[];
  publish(event: unknown): Promise<NotificationPublishReport>;
  failNext(message: string): void;
} {
  const published: unknown[] = [];
  let failure: string | undefined;
  return {
    published,
    failNext(message: string) {
      failure = message;
    },
    publish(event: unknown) {
      if (failure !== undefined) {
        const message = failure;
        failure = undefined;
        return Promise.reject(new Error(message));
      }
      published.push(event);
      return Promise.resolve({} as NotificationPublishReport);
    },
  };
}

async function realWorld() {
  const clock = manualClock(new Date(NOW));
  const opened = await openBoundDatabaseFixture("gate-park-test", clock);
  disposers.push(async () => await opened.close());
  const database = opened.database;
  seedSyntheticRuntimeConfig(database);
  const active = database.authority.runtimeConfig.get(); assert.ok(active);
  for (const park of [PARK_A, PARK_B]) {
    const record = RunRecordSchema.parse(personLookupQueuedRun({ runId: park.runId }));
    database.authority.runs.enqueue(RunRecordSchema.parse({ ...record,
      envelope: { ...record.envelope, workflow: park.workflowId, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId } }));
  }
  const inbox = createNotificationInbox({
    runReader: createTrustRunReader(database),
    authority: database,
    clock,
    ids: sequentialIdFactory(),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });
  return { clock, database, inbox };
}

describe("gate-park notifier: a park publishes on the transition, exactly once", () => {
  it("publishes a newly observed park and nothing for the same standing park", async () => {
    const inbox = recordingInbox();
    const notifier = createGateParkNotifier({ inbox });

    const first = await notifier.observed([PARK_A]);
    assert.equal(first.published.length, 1);
    assert.deepEqual(first.standing, []);
    assert.deepEqual(inbox.published, [{
      kind: "gate-opened",
      runId: PARK_A.runId,
      workflowId: PARK_A.workflowId,
      gateId: PARK_A.gateId,
    }]);


    const second = await notifier.observed([PARK_A]);
    assert.deepEqual(second.published, []);
    assert.deepEqual(second.standing, [PARK_A]);
    assert.equal(inbox.published.length, 1);

    const third = await notifier.observed([PARK_A]);
    assert.deepEqual(third.published, []);
    assert.equal(inbox.published.length, 1);
  });

  it("publishes one row per (run, gate) and folds nothing across runs", async () => {
    const inbox = recordingInbox();
    const notifier = createGateParkNotifier({ inbox });
    const report = await notifier.observed([PARK_A, PARK_B]);
    assert.equal(report.published.length, 2);
    assert.deepEqual(
      inbox.published.map((event) => (event as { runId: string }).runId),
      [PARK_A.runId, PARK_B.runId],
    );
  });

  it("forgets a resolved park WITHOUT publishing anything about the resolution", async () => {
    const inbox = recordingInbox();
    const notifier = createGateParkNotifier({ inbox });
    await notifier.observed([PARK_A]);

    // The operator resolved the gate: the run left `parked-gate`.
    const released = await notifier.observed([]);
    assert.deepEqual(released.published, []);
    assert.deepEqual(released.released, [PARK_A]);
    assert.equal(inbox.published.length, 1);

    // A LATER park at the same gate is a transition again, not a silent fold.
    const reparked = await notifier.observed([PARK_A]);
    assert.equal(reparked.published.length, 1);
    assert.equal(inbox.published.length, 2);
  });

  it("forgets nothing when the publish throws — the next observation retries it", async () => {
    const inbox = recordingInbox();
    const notifier = createGateParkNotifier({ inbox });
    inbox.failNext("authority is unwritable");

    await assert.rejects(notifier.observed([PARK_A]), /authority is unwritable/);
    assert.deepEqual(inbox.published, []);

    const retry = await notifier.observed([PARK_A]);
    assert.equal(retry.published.length, 1);
    assert.equal(inbox.published.length, 1);
  });

  it("keeps the parks it DID commit when a later one in the same pass throws", async () => {
    const inbox = recordingInbox();
    const notifier = createGateParkNotifier({ inbox });
    await notifier.observed([PARK_A]);
    inbox.failNext("authority is unwritable");

    await assert.rejects(notifier.observed([PARK_A, PARK_B]), /authority is unwritable/);
    // A's row is durable, so it must not be re-published; B is still pending.
    const retry = await notifier.observed([PARK_A, PARK_B]);
    assert.deepEqual(retry.standing, [PARK_A]);
    assert.equal(retry.published.length, 1);
    assert.equal(retry.published[0]?.park.runId, PARK_B.runId);
  });

  it("refuses an observation that is not a park (ids only, no prose)", async () => {
    const notifier = createGateParkNotifier({ inbox: recordingInbox() });
    await assert.rejects(notifier.observed([{ ...PARK_A, subject: "Hernandez, Jose" }]));
    await assert.rejects(notifier.observed([{ runId: PARK_A.runId, gateId: PARK_A.gateId }]));
  });
});

describe("gate-park notifier: the durable row it actually writes", () => {
  it("lands ONE unread gate-waiting ping carrying a run link, and no second row", async () => {
    const { database, inbox } = await realWorld();
    const notifier = createGateParkNotifier({ inbox });

    const first = await notifier.observed([PARK_A]);
    assert.equal(first.published.length, 1);
    const report = first.published[0]?.report;
    assert.ok(report);
    assert.equal(report.durable, "created");
    assert.equal(report.notification.trigger, "gate-waiting");
    assert.equal(report.notification.channel, "ping");
    assert.equal(report.notification.status, "unread");
    assert.equal(report.notification.count, 1);
    assert.deepEqual(report.notification.links, [{ kind: "run", runId: PARK_A.runId }]);
    // No prose from the gate's evidence packet: the title names WHERE to look.
    assert.match(report.notification.title, /Needs you/);

    const stored = database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(stored.length, 1);

    // Still parked on the next tick: nothing is written, and in particular the
    // stored row is NOT marked unread again.
    await notifier.observed([PARK_A]);
    const after = database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.version, 1);
    assert.equal(after[0]?.count, 1);
  });


  it("serves exact run and Storage destinations without diagnostic prose", async () => {
    const { clock, inbox } = await realWorld();
    const notifier = createGateParkNotifier({ inbox });
    const first = await notifier.observed([PARK_A]);
    const parked = first.published[0]?.report.notification;
    assert.ok(parked);

    const wire = notificationWireOf(parked, clock.nowMs());
    assert.equal(wire.kind, "notification");
    if (wire.kind !== "notification") assert.fail("gate-park must project an ordinary notification");
    assert.deepEqual(wire.link, { kind: "run", runId: PARK_A.runId });
    assert.equal(wire.severity, "warning");
    assert.equal(wire.state, "unread");

    const storage = await inbox.publish({
      kind: "storage-degraded",
      concern: "backup",
      state: "degraded",
      diagnosticFingerprint: "ab".repeat(32),
    });
    const storageWire = notificationWireOf(storage.notification, clock.nowMs());
    assert.equal(storageWire.kind, "notification");
    if (storageWire.kind !== "notification") assert.fail("storage degradation must project an ordinary notification");
    assert.deepEqual(storageWire.link, { kind: "storage" });
    assert.equal(JSON.stringify(storageWire).includes("ab".repeat(32)), false);
  });
});
