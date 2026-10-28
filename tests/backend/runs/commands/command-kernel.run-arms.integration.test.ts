import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { childMixedPolicyRoot, childMixedPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { join } from "node:path";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createKernelStubCommandFixtures } from "../../../support/helpers/backend/kernel-stub-command-fixtures.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { personLookupDescriptor, separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { projectFailureDisplay } from "../../../../src/models/dashboard/failure-display.js";
import { ErrorCodeSchema } from "../../../../src/rules/identity/ids.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";
import { localDatePart } from "../../../../src/rules/time/clock.js";
import { kernelRejectMemberRecord } from "../../../support/helpers/backend/kernel-reject-member-run.js";
import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, createPlan, startCommand, runCommand } = createCommandKernelTestWorld();


const delegationWorld = createRunExecutorTestWorld();
afterEach(delegationWorld.cleanup);

afterEach(async () => {
  for (const database of openDatabases.splice(0)) { releaseSeededWriteOwners(database, NOW); database.close(); }
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("run arms", () => {
  function startOne(harness: Harness, descriptor: AnyWorkflowDescriptor, eid: string): string {
    const plan = createPlan(harness, descriptor, [eid]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    return singleAppliedRunId(result);
  }

  it("retries a terminal run into a fresh linked run and refuses an active item", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");

    const active = harness.kernel.execute(runCommand("retry", runId, 1));
    assert.equal(active.state, "rejected");
    if (active.state === "rejected") assert.equal(active.code, "invalid-state");

    const run = harness.database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    const cancelResult = harness.kernel.execute(runCommand("cancel", runId, run.version));
    assert.equal(cancelResult.state, "applied");

    const retry = harness.kernel.execute(runCommand("retry", runId, 2));
    assert.equal(retry.state, "applied");
    if (retry.state !== "applied") return;
    const newTarget = retry.affectedTargets[0];
    assert.equal(newTarget.family, "run");
    if (newTarget.family !== "run") return;
    const retried = harness.database.authority.runs.get(newTarget.runId);
    assert.ok(retried !== undefined);
    assert.equal(retried.envelope.retryOf, runId);

    assert.equal(retried.envelope.attempt, 2);
    assert.equal(retried.lifecycle.state, "queued");
    assert.deepEqual(retried.input, harness.database.authority.runs.get(runId)?.input);

    assert.ok(run.sessionId !== undefined);
    assert.equal(retried.sessionId, run.sessionId);
    assert.deepEqual(
      harness.database.authority.runs.listBySession(run.sessionId).map((member) => member.envelope.runId).sort(),
      [runId, newTarget.runId].sort(),
    );
  });

  it("cancel is CAS-scoped and cascades through authority dependency edges only", async () => {
    const h = await delegationWorld.executorHarness({ descriptor: childMixedPolicyRoot.descriptor, stores: plan1Stores });
    const { database, path } = h.authority;
    const execution = canonicalChildExecution(h.deps, database, path,
      id => childMixedPolicyModules.find(module => module.descriptor.id === id)?.descriptor);
    const root = execution.start(childMixedPolicyRoot.descriptor,
      { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
    assert.equal((await execution.step(root, delegationWorld.SIGNAL)).outcome.state, "yielded-delegation");
    const parentId = root.envelope.runId;
    const parent = database.authority.runs.get(parentId);
    assert.ok(parent);
    const children = database.authority.runs.listChildren(parentId);
    const cascadeChildId = children.find(child => child.envelope.parent?.edgeId === "cascade")?.envelope.runId;
    const independentChildId = children.find(child => child.envelope.parent?.edgeId === "independent")?.envelope.runId;
    assert.ok(cascadeChildId);
    assert.ok(independentChildId);
    const harness = { database, kernel: execution.kernel };

    const stale = harness.kernel.execute(runCommand("cancel", parentId, parent.version + 7));
    assert.equal(stale.state, "conflict");

    const result = harness.kernel.execute(runCommand("cancel", parentId, parent.version));
    assert.equal(result.state, "applied", JSON.stringify(result));
    const cancelledParent = harness.database.authority.runs.get(parentId);
    assert.equal(cancelledParent?.lifecycle.state, "terminal");
    const cascaded = harness.database.authority.runs.get(cascadeChildId);
    assert.equal(cascaded?.lifecycle.state, "terminal");
    if (cascaded?.lifecycle.state === "terminal") assert.equal(cascaded.lifecycle.outcome, "cancelled");
    const independent = harness.database.authority.runs.get(independentChildId);
    assert.equal(independent?.lifecycle.state, "queued");
  });

  it("cancels nothing when a child has no dependency edge in authority", async () => {
    const harness = await createHarness();
    const parentId = startOne(harness, rejectActiveDescriptor, "10800000");
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);
    const orphanId = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
    assert.equal(harness.database.authority.runs.enqueue(kernelRejectMemberRecord(parent, parentId, orphanId, "child:orphan", "kr-170000-9999", "orphan-edge", NOW)).state, "inserted");

    assert.throws(
      () => harness.kernel.execute(runCommand("cancel", parentId, parent.version)),
      /no dependency edge in authority/,
    );
    assert.equal(harness.database.authority.runs.get(parentId)?.lifecycle.state, "queued");
    assert.equal(harness.database.authority.runs.get(orphanId)?.lifecycle.state, "queued");
  });


  it("bump elevates a queued run to interactive at the live version, and refuses a stale one", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = () => harness.database.authority.runs.get(runId)?.version ?? 0;

    const stale = harness.kernel.execute(runCommand("bump", runId, version() + 998));
    assert.equal(stale.state, "conflict", "a stale bump may not reorder the claim queue");
    if (stale.state === "conflict") {
      assert.equal(stale.currentVersion, version());
      assert.match(stale.message, /refresh before bumping it/);
    }
    // The refusal wrote nothing: the run is still at its authored priority.
    assert.equal(harness.database.authority.runs.get(runId)?.envelope.priority, "bulk");

    const bumped = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(bumped.state, "applied");
    assert.equal(harness.database.authority.runs.get(runId)?.envelope.priority, "interactive");

    // Re-bumping an already-interactive run is the no-op arm: it advances no
    // version, so the SAME expected version is still live and still accepted.
    const again = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(again.state, "applied");

    const { workerId, workerLifetime } = testAdmittedWorker(harness.database, harness.clock, {
      path: join(harness.stateRoot, "state.db"), workflow: rejectActiveDescriptor.id, poolIndex: 1, browserSystems: [],
    });
    const claimed = harness.database.authority.runs.claimNext({ workflow: rejectActiveDescriptor.id, workerId, workerLifetime, now: NOW });
    assert.equal(claimed.state, "claimed");
    const busy = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(busy.state, "rejected");
    if (busy.state === "rejected") assert.equal(busy.code, "invalid-state");
  });

  it("rename is presentation-only and changes no lifecycle", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = () => {
      const run = harness.database.authority.runs.get(runId);
      assert.notEqual(run, undefined);
      return run?.version ?? 0;
    };

    const renamed = harness.kernel.execute(
      runCommand("rename", runId, version(), { payload: { displayName: "Kernel case" } }),
    );
    assert.equal(renamed.state, "applied");
    const run = harness.database.authority.runs.get(runId);
    assert.equal(run?.displayName, "Kernel case");

    assert.equal(run?.lifecycle.state, "queued");
  });


  it("refuses a stale rename with the live version", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800001");
    const live = harness.database.authority.runs.get(runId)?.version ?? 0;
    assert.ok(live > 0);
    const stale = live + 998;

    const result = harness.kernel.execute(
      runCommand("rename", runId, stale, { payload: { displayName: "Yesterday's name" } }),
    );
    assert.equal(result.state, "conflict", "a stale rename applied over a current name");
    if (result.state === "conflict") {
      // The server's own sentence names the version that IS live, because it
      // is the only party that knows it.
      assert.equal(result.currentVersion, live);
      assert.match(result.message, new RegExp(`not ${String(stale)}`));
    }


    const run = harness.database.authority.runs.get(runId);
    assert.equal(run?.version, live);
    assert.equal(run?.displayName, undefined);
  });
});


const protectedFixtures = createKernelStubCommandFixtures({ profiles, roots, openDatabases,
  prefix: "hrauto-protected-recovery-", migrationOwner: "protected-recovery-test",
  resolve: workflow => [personLookupDescriptor, separationsDescriptor].find(descriptor => descriptor.id === workflow) });
const SUBJECT_BINDING = { kind: "test-data-local" as const, inputPath: "emplId" as const,
  name: "personLookupCanaryEid" as const, sourceId: "44444444-4444-4444-8444-444444444444" };
const SYNTHETIC_EID = "10873698";

function recoverySource(harness: Awaited<ReturnType<typeof protectedFixtures.createHarness>>, protection: "subject" | "ordinary" | "timekeeper") {
  if (protection === "timekeeper") {
    const plan = planStart({ authority: harness.database, clock: harness.clock, ids: harness.plannerIds,
      planTtlMs: 600_000, protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic signer" }) },
    { descriptor: separationsDescriptor, submissions: [{ documentNumber: "12345678" }],
      dryRun: true, priority: "bulk", shape: "single", ...harness.configIdentity, plannedBy: "local-operator" });
    assert.deepEqual(plan.refused, []);
    const planned = plan.planned[0];
    assert.ok(planned);
    return buildQueuedRun({ descriptor: separationsDescriptor, runId: "11111111-1111-4111-8111-111111111111",
      itemId: planned.itemId, traceId: "se-120000-1111", rawInput: planned.rawInput, canonicalInput: planned.input,
      ingressSchemaHash: plan.ingressSchemaHash, ...harness.configIdentity, resolvedInstance: plan.resolvedInstance,
      shape: "single", priority: "bulk", dryRun: true, attempt: 1, runNumber: 1, appVersion: "0.1.0", now: NOW });
  }
  const initial = RunRecordSchema.parse(personLookupQueuedRun());
  const { sessionId: _sessionId, ...withoutSession } = initial;
  assert.ok(initial.input.parsed);
  return RunRecordSchema.parse({ ...withoutSession,
    envelope: { ...initial.envelope, ...harness.configIdentity, enqueuedAt: NOW },
    createdAt: NOW, updatedAt: NOW,
    input: { ...initial.input, parsed: { ...initial.input.parsed,
      value: initial.input.parsed.value,
      protectedBindings: protection === "subject" ? [SUBJECT_BINDING] : [] } } });
}

describe("protected subject recovery publication", () => {
  for (const type of ["retry", "restart"] as const) {
    for (const protection of ["subject", "ordinary", "timekeeper"] as const) {
      it(`${type} retains safe queue display for ${protection} input`, async () => {
        const harness = await protectedFixtures.createHarness({ publishQueued: (run, publication) => {
          assert.ok(publication);
          createTimelineEmitter({ repository: harness.database.authority.timelineEvents, clock: harness.clock }).emit(
            runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
        } });
        const source = recoverySource(harness, protection);
        assert.equal(harness.database.authority.runs.enqueue(source).state, "inserted");
        createTimelineEmitter({ repository: harness.database.authority.timelineEvents, clock: harness.clock }).emit(
          runQueuedSpanEvent({ run: source, actorId: ActorIdSchema.parse("local-operator"),
            title: protection === "subject" ? "Protected test subject" : protection === "timekeeper" ? "Separation 12345678" : SYNTHETIC_EID }));
        assert.equal(harness.kernel.execute(protectedFixtures.runCommand("cancel", source.envelope.runId, source.version)).state, "applied");
        const terminal = harness.database.authority.runs.get(source.envelope.runId);
        assert.ok(terminal);
        const result = harness.kernel.execute(protectedFixtures.runCommand(type, terminal.envelope.runId, terminal.version));
        assert.equal(result.state, "applied");
        if (result.state !== "applied") throw new Error("recovery not applied");
        const target = result.affectedTargets[0];
        assert.ok(target.family === "run");
        const next = harness.database.authority.runs.get(target.runId);
        assert.ok(next);
        assert.deepEqual(next.input, terminal.input);
        const rows = harness.database.authority.timelineEvents.page({ runId: next.envelope.runId });
        assert.equal(rows.length, 1);
        const queued = rows[0].payload;
        assert.ok(queued.kind === "span" && queued.event.t === "run.queued");
        const event = queued.event;
        const expectedTitle = protection === "subject" ? "Protected test subject" : protection === "timekeeper" ? "Separation 12345678" : SYNTHETIC_EID;
        assert.equal(event.title, expectedTitle);
        if (protection === "subject") {
          assert.equal(event.subtitle, undefined);
          assert.equal(JSON.stringify(rows).includes(SYNTHETIC_EID), false);
        }
        const world = await makeWorld({ reader: sqliteRunReader(harness.database, harness.clock),
          timeline: harness.database.authority.timelineEvents,
          descriptors: { resolve: workflow => [personLookupDescriptor, separationsDescriptor].find(descriptor => descriptor.id === workflow) } });
        try {
          world.clock.setWall(harness.clock.now());
          world.projection.ingestFromTimeline();
          const day = world.projection.buildDashboardDayWire(localDatePart(harness.clock.now()));
          const row = day.queueSurfaces.find(row => row.runId === next.envelope.runId);
          assert.ok(row);
          assert.equal(row.title, protection === "subject" ? SYNTHETIC_EID : expectedTitle);
          if (protection === "subject") {
            for (const surface of day.queueSurfaces) assert.equal(surface.title, SYNTHETIC_EID);
            assert.equal(JSON.stringify(day.queueSurfaces.map(({ title: _title, ...surface }) => surface)).includes(SYNTHETIC_EID), false);
          }
        } finally { await world.dispose(); }
      });
    }
    it(`${type} rolls back a corrupt unmasked producer and exposes the mapped refusal`, async () => {
      const harness = await protectedFixtures.createHarness({ publishQueued: (run, publication) => {
        assert.ok(publication);
        createTimelineEmitter({ repository: harness.database.authority.timelineEvents, clock: harness.clock }).emit(
          runQueuedSpanEvent({ run, ...publication, title: "synthetic-unmasked-subject-proof", actorId: ActorIdSchema.parse(publication.actorId) }));
      } });
      const source = recoverySource(harness, "subject");
      assert.equal(harness.database.authority.runs.enqueue(source).state, "inserted");
      createTimelineEmitter({ repository: harness.database.authority.timelineEvents, clock: harness.clock }).emit(
        runQueuedSpanEvent({ run: source, actorId: ActorIdSchema.parse("local-operator"), title: "Protected test subject" }));
      assert.equal(harness.kernel.execute(protectedFixtures.runCommand("cancel", source.envelope.runId, source.version)).state, "applied");
      const terminal = harness.database.authority.runs.get(source.envelope.runId);
      assert.ok(terminal);
      const beforeTimeline = harness.database.authority.timelineEvents.page({});
      let caught: unknown;
      try { harness.kernel.execute(protectedFixtures.runCommand(type, terminal.envelope.runId, terminal.version)); }
      catch (error) { caught = error; }
      assert.ok(caught);
      const response = failureStatus(caught);
      assert.equal(response.status, 409);
      assert.equal(response.body.code, "PROTECTED_SUBJECT_DISPLAY_REFUSED");
      assert.equal(response.body.message, "The protected subject display was not masked. The run was not queued.");
      assert.equal(response.body.message, projectFailureDisplay({ code: ErrorCodeSchema.parse("PROTECTED_SUBJECT_DISPLAY_REFUSED") }).observation);
      assert.deepEqual(harness.database.authority.runs.listByWorkflow(personLookupDescriptor.id), [terminal]);
      assert.deepEqual(harness.database.authority.timelineEvents.page({}), beforeTimeline);
      assert.equal(JSON.stringify(beforeTimeline).includes("synthetic-unmasked-subject-proof"), false);
      const world = await makeWorld({ reader: sqliteRunReader(harness.database, harness.clock),
        timeline: harness.database.authority.timelineEvents,
        descriptors: { resolve: workflow => workflow === personLookupDescriptor.id ? personLookupDescriptor : undefined } });
      try {
        world.clock.setWall(harness.clock.now());
        world.projection.ingestFromTimeline();
        const rows = world.projection.buildDashboardDayWire(localDatePart(harness.clock.now())).queueSurfaces;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].runId, terminal.envelope.runId);
        assert.equal(rows[0].title, SYNTHETIC_EID);
        assert.equal(JSON.stringify(rows).includes("synthetic-unmasked-subject-proof"), false);
      } finally { await world.dispose(); }
    });
  }
});
