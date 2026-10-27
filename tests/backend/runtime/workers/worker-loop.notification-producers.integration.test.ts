import { createNotificationCompositionTestWorld } from "../../../support/helpers/backend/notification-composition-world.js";
import { describe, expect, it } from "vitest";
import { createTrustNotifications } from "../../../../src/backend/app/composition/dashboard/notifications.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testRunLifecycle, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureSessions } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";

const { fixture } = createNotificationCompositionTestWorld();

describe("canonical notification producers", () => {
  it("reads a write park through the production composition", async () => {
    const f = await fixture();
    try {
      const world = createWriteFixtureWorld();
      const stores = buildWriteFixtureRegistry(world);
      const sessions = writeFixtureSessions(world);
      const scheduler = new ManualScheduler(f.clock);
      const ids = sequentialIdFactory("c");
      const log = recordingLogger().log;
      const emitter = recordingEmitter().emitter;
      f.db.authority.runs.enqueue(writeFixtureQueuedRun());
      world.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
      world.commitThrows = new Error("private park");
      await runWorkerLoop({
        ...testWorkerPorts(f.db, f.clock, { path: f.path, descriptor: writeFixtureDescriptor, poolIndex: 1 }),
        workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID), workerId: WorkerIdSchema.parse(f.db.authority.workerSlots.list(WRITE_FIXTURE_WORKFLOW_ID)[0].workerId),
        descriptor: writeFixtureDescriptor, stores, authority: f.db, sessionFactory: sessions.factory, emitter,
        clock: f.clock, ids, scheduler, taskDeadlineMs: 60_000, sessionAcquireMs: 20_000,
        duoCeremony: await fixtureDuoCeremonyGates(f.clock), heartbeatIntervalMs: 600_000, idleRepollMs: 1_000,
        log, stopSignal: new AbortController().signal, exitWhenIdle: true,
        writeSequencerFor: manager => createWriteSequencer({ lifecycle: testRunLifecycle(f.db, f.clock), stores,
          authority: f.db, sessions: manager, emitter, clock: f.clock, ids, scheduler, taskDeadlineMs: 60_000,
          operator: "local-operator", log, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT }),
      });
      await createTrustNotifications({ database: f.db, reader: f.reader, clock: f.clock, ids: sequentialIdFactory("b") }).observer.observe();
      expect(f.inbox.list("local-operator").map(row => row.trigger)).toEqual(["write-parked"]);
      expect(JSON.stringify(f.inbox.list("local-operator"))).not.toContain("private park");
    } finally { await f.close(); }
  });
});
