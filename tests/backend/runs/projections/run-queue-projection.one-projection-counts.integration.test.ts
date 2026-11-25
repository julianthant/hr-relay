import { isQueueTopLevel } from "../../../../src/models/dashboard/queue-parent.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { ledgerCommitFixture, fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { seedAtomicWriteOwner, atomicWriteCheckpoint } from "../../../support/helpers/timeline-write-fixture.js";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  claimEventOf,
  failureRecordOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  DAY,
  type DashboardWorld,
} from "../../../support/helpers/backend/dashboard-harness.js";

describe("one-projection-counts", () => {

  const worlds: DashboardWorld[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.dispose();
  });

  it("proves badge total == status sum == rendered rows by construction over a hostile seeded world", async () => {
    const world = await makeWorld();
    worlds.push(world);

    queuedEventOf(world, { seed: 1 }); // plain queued
    queuedEventOf(world, { seed: 2 }); // running
    claimEventOf(world, 2);
    world.authority.put(runRecordOf({
      seed: 2,
      lifecycle: {
        state: "running",
        workerId: "person-lookup-worker-1",
        claimedAt: "2026-08-03T17:00:05.000Z",
        heartbeatAt: "2026-08-03T17:00:05.000Z",
      },
      claimGeneration: 1,
      version: 2,
    }));
    queuedEventOf(world, { seed: 3 });
    queuedEventOf(world, { seed: 4, shape: "operation" }); // delegated group
    queuedEventOf(world, { seed: 5, shape: "operation-member", parentSeed: 4 });
    queuedEventOf(world, { seed: 6, shape: "operation-member", parentSeed: 4 });
    queuedEventOf(world, { seed: 7 }); // rejected/failed terminal
    world.writer.emit({
      t: "span.ended", kind: "run", ts: world.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(7), attempt: 1, traceId: `pl-100007-${uuidOf(7).slice(0, 4)}`,
      spanPath: `pl-100007-${uuidOf(7).slice(0, 4)}`, outcome: "failed", failureId: uuidOf(9007),
    });
    world.authority.put(RunRecordSchema.parse({
      ...runRecordOf({ seed: 7, version: 3, claimGeneration: 1 }),
      lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:20:00.000Z", failureId: uuidOf(9007) },
      updatedAt: "2026-08-03T17:20:00.000Z",
      completion: { schemaVersion: 1, kind: "failed", expectedVersion: 2,
        claim: { workerId: "projection-fixture-worker", claimGeneration: 1 },
        authorizedAt: "2026-08-03T17:20:00.000Z", failureId: uuidOf(9007) },
    }));

    queuedEventOf(world, { seed: 8 }); // parked on an operator gate
    world.writer.emit({
      t: "gate.opened", ts: world.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(8), attempt: 1, traceId: `pl-100008-${uuidOf(8).slice(0, 4)}`,
      spanPath: `pl-100008-${uuidOf(8).slice(0, 4)}`, gate: "approval",
    });

    world.authority.put(runRecordOf({ seed: 8, lifecycle: { state: "parked-gate",
      gateId: "approval", resumeAt: "searching", parkedAt: world.clock.now().toISOString() },
    }));

    const payload = world.projection.buildDashboardDayWire(DAY);

    // The three renderings, each read off the ONE payload:
    const workflowPanelTotal = payload.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusBarSum = payload.statusCounts.reduce((sum, { count }) => sum + count, 0);
    const renderedQueueRows = payload.queueSurfaces.filter(isQueueTopLevel).length;

    assert.equal(workflowPanelTotal, statusBarSum);
    assert.equal(statusBarSum, renderedQueueRows);
    assert.equal(renderedQueueRows, 6); // 1,2,3,4,7,8 — members contained

    // Containment applied once, inside the projection: the members ride flat
    // for layout, counted only in their operation's rollup.
    const operation = payload.queueSurfaces.find(({ runId }) => runId === uuidOf(4));
    if (operation?.surfaceKind !== "operation") assert.fail("the delegated group must project as an operation");
    assert.equal(operation.memberRollup.total, 2);

    // And the month calendar rendering descends from the same fold.
    assert.deepEqual(payload.monthCounts, [{ day: DAY, count: 6 }]);



    world.authority.failures.set(
      uuidOf(9007),
      failureRecordOf({ seed: 7, code: "SESSION_LOST", transient: true }),
    );
    for (const [index, instance] of [[0, "prod"], [1, "test"]] as const) {
      const fixture = ledgerCommitFixture(index, { instance, confirmedAt: instantOffsetOf(0),
        runId: fixtureUuid(`one-projection-run-${String(index)}`), itemId: fixtureUuid(`one-projection-item-${String(index)}`) });
      seedAtomicWriteOwner(world.database, fixture.commit, syntheticDatabasePath(world.database));
      assert.equal(fenceWriteFixture(world.database, { intent: fixture.intent, attempt: fixture.attempt }).state, "fenced");
      world.database.commitWriteAttempt(fixture.commit, atomicWriteCheckpoint(fixture.commit));
    }
    const report = world.projection.buildActivityReportWire(DAY, DAY);
    assert.deepEqual(report.ledger, {
      systems: [{ system: "ucpath", entries: 2, prod: 1, test: 1 }],
    });
    assert.deepEqual(world.projection.buildDashboardDayWire(DAY).monthCounts, payload.monthCounts);
    assert.deepEqual(world.projection.buildDashboardDayWire(DAY).statusCounts, payload.statusCounts);
    assert.deepEqual(world.projection.buildDashboardDayWire(DAY).workflowCounts, payload.workflowCounts);
    assert.equal(report.totalRuns, 6);
  });
});
