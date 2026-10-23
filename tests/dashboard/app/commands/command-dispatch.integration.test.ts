import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { PositiveIntSchema as positiveIntSchemaForReset } from "../../../../src/rules/identity/ids.js";

import assert_m0 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";

import {
createCommandKernel as createCommandKernel_m0,
type CommandKernel as CommandKernel_m0
} from "../../../../src/backend/runs/commands/command-kernel.js";
import {
RunRecordService as RunRecordService_m0,
lifecycleCommandId as lifecycleCommandId_m0
} from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { composeCommandRequest as composeCommandRequest_m0,type CommandAction as CommandAction_m0 } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { settleCommandResult as settleCommandResult_m0 } from "../../../../src/dashboard/app/commands/command-result.js";
import { commandResultFeedEntry as commandResultFeedEntry_m0 } from "../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import type { ActionTarget as ActionTarget_m0 } from "../../../../src/dashboard/surfaces/shared/actions/actions.js";
import {
CommandRequestSchema as CommandRequestSchema_m0
} from "../../../../src/rules/commands/commands.js";
import { deriveItemId as deriveItemId_m0 } from "../../../../src/rules/identity/identifiers.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m0,UNSTORED_CONFIG_IDENTITY as UNSTORED_CONFIG_IDENTITY_m0,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m0 } from "../../../support/fixtures/intake-kernel-seams.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m0 } from "../../../support/fixtures/operator-command-fixtures.js";
import {
HASH_A as HASH_A_m0,
HASH_B as HASH_B_m0,
NOW as NOW_m0,
UUID_4 as UUID_4_m0
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m0,sequentialIdFactory as sequentialIdFactory_m0 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m0 } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../support/helpers/synthetic-storage-admission.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import {
composePlanWorkerCountCommand as composePlanWorkerCountCommand_m1,
composeStopWorkerCommand as composeStopWorkerCommand_m1
} from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { CommandRequestSchema as CommandRequestSchema_m1 } from "../../../../src/rules/commands/commands.js";


{


const roots: string[] = [];
const openDatabases: AuthorityDatabase_m0[] = [];

const _afterEachFixture0 = () => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};

function createHarness(): {
  database: AuthorityDatabase_m0;
  kernel: CommandKernel_m0;
  clock: ReturnType<typeof manualClock_m0>;
  lifecycle: RunRecordService_m0;
} {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "queue-lifecycle-test-")));
  roots.push(root);
  const path = join_m0(root, "authority.sqlite");
  const clock = manualClock_m0(new Date(NOW_m0));
  const database = AuthorityDatabase_m0.open(
    { path, busyTimeoutMs: 250, migrationOwner: "queue-lifecycle-proof" },
    clock,
  );
  openDatabases.push(database);
  seedSyntheticRuntimeConfig_m0(database);

  const ids = sequentialIdFactory_m0("d");
  const lifecycle = new RunRecordService_m0({
    database,
    clock,
    ids,
    publishQueued: () => {},
  });

  const kernel = createCommandKernel_m0({
    lifecycle,
    appVersion: "0.1.0",

    configIdentity: UNSTORED_CONFIG_IDENTITY_m0,
    intakeParser: UNWIRED_INTAKE_PARSER_m0,
    intakeProjections: NO_INTAKE_PROJECTIONS_m0,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
    },
    clock,
    ids,
    descriptors: {
      resolve: (workflow) => (workflow === "person-lookup" ? personLookupDescriptor_m0 : undefined),
    },
    writeResolution: {
      resolveAbsent: () => { throw new Error("unused in test"); },
      resolvePresent: () => { throw new Error("unused in test"); },
    },
    workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("worker runtime is not wired in this fixture"); }, spawnPoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); }, refreshPoolBrowser: () => { throw new Error("worker runtime is not wired in this fixture"); }, reopenPoolBrowser: () => { throw new Error("worker runtime is not wired in this fixture"); }, stopPoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); }, pausePoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); }, resumePoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); } } },
  });

  return { database, kernel, clock, lifecycle };
}

function enqueueRun(harness: Harness, runId: string, priority: "bulk" | "interactive" = "bulk"): void {
  const insert = harness.database.authority.runs.enqueue({
    ...QUEUED_RUN_m0,
    envelope: {
      ...QUEUED_RUN_m0.envelope,
      runId,
      itemId: runId,
      contractFingerprint: personLookupDescriptor_m0.contractFingerprint,
      configFingerprint: HASH_B_m0,
      configSnapshotId: UUID_4_m0,
      priority,
    },
  });
  assert_m0.equal(insert.state, "inserted");
}

function terminalizeRun(harness: Harness, runId: string, outcome: "completed" | "cancelled" | "failed" = "cancelled"): number {
  const run = harness.database.authority.runs.get(runId);
  assert_m0.ok(run !== undefined);
  const settled = harness.database.authority.runs.transition({
    runId,
    expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome, endedAt: NOW_m0 },
    now: NOW_m0,
  });
  assert_m0.equal(settled.state, "applied");
  return run.version + 1;
}

type Harness = ReturnType<typeof createHarness>;

describe_m0("Queue commands: CAS binding, attribution, in-flight, and replay", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("binds exact expectedVersion; stale version refuses with CAS conflict and records feed entry without state change", () => {
    const harness = createHarness();
    const runId = "11111111-1111-4000-8000-111111111111";
    enqueueRun(harness, runId);
    testWorkerPorts(harness.database, harness.clock, { path: syntheticDatabasePath(harness.database), descriptor: personLookupDescriptor_m0, poolIndex: 1 });
    const claimMember1 = harness.database.authority.workerSlots.get("person-lookup-worker-1");
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claim = harness.database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(harness.database, "person-lookup", claimMember1.poolIndex).workerLifetime, workflow: "person-lookup", workerId: "person-lookup-worker-1", now: NOW_m0 });
    assert_m0.equal(claim.state, "claimed");
    const currentRun = harness.database.authority.runs.get(runId);
    assert_m0.ok(currentRun !== undefined);
    assert_m0.equal(currentRun.version, 2);

    // Cancel action with stale expectedVersion (1 instead of 2)
    const staleAction: CommandAction_m0 = {
      key: "cancel",
      label: "Cancel run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "cancel",
      expectedVersion: 1,
    };
    const target: ActionTarget_m0 = { runId, expectedVersion: 1 };
    const composed = composeCommandRequest_m0(staleAction, target, {
      actorId: "test-operator",
      source: "queue",
    });
    assert_m0.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = CommandRequestSchema_m0.parse(composed.request);
    const result = harness.kernel.execute(request);
    assert_m0.equal(result.state, "conflict");
    if (result.state !== "conflict") return;
    assert_m0.equal(result.currentVersion, 2);


    const settlement = settleCommandResult_m0(result);
    assert_m0.equal(settlement.kind, "refused");
    if (settlement.kind !== "refused") return;
    assert_m0.equal(settlement.reason, "conflict");
    assert_m0.equal(settlement.currentVersion, 2);

    // Record into persistent failure feed
    const feed = commandResultFeedEntry_m0({
      settlement,
      targetRunId: runId,
      expectedVersion: 1,
      commandId: result.commandId,
      subject: "Test Run",
      workflowLabel: "Person lookup",
      actionLabel: staleAction.label,
      clock: "12:00 PM",
      actorId: "test-operator",
    });
    assert_m0.ok(feed !== undefined);
    assert_m0.equal(feed.targetRunId, runId);
    assert_m0.equal(feed.expectedVersion, 1);

    // Confirm authority row is completely unchanged
    const after = harness.database.authority.runs.get(runId);
    assert_m0.deepEqual(after, currentRun);
  });

  it_m0("stamps source: 'queue' when dispatched from Queue and source: 'run-detail' from Run Detail", () => {
    const action: CommandAction_m0 = {
      key: "cancel",
      label: "Cancel",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "cancel",
      expectedVersion: 1,
    };
    const target: ActionTarget_m0 = { runId: "11111111-1111-4000-8000-111111111111", expectedVersion: 1 };

    const queueComposed = composeCommandRequest_m0(action, target, {
      actorId: "operator-1",
      source: "queue",
    });
    assert_m0.equal(queueComposed.state, "ready");
    if (queueComposed.state === "ready") {
      const parsed = CommandRequestSchema_m0.parse(queueComposed.request);
      assert_m0.equal(parsed.source, "queue");
    }

    const detailComposed = composeCommandRequest_m0(action, target, {
      actorId: "operator-1",
      source: "run-detail",
    });
    assert_m0.equal(detailComposed.state, "ready");
    if (detailComposed.state === "ready") {
      const parsed = CommandRequestSchema_m0.parse(detailComposed.request);
      assert_m0.equal(parsed.source, "run-detail");
    }
  });

  it_m0("refuses direct retry/restart mutation and directs operator to Rerun modal", () => {
    const retryAction: CommandAction_m0 = {
      key: "retry",
      label: "Retry",
      intent: "neutral",
      placement: ["menu"],
      kind: "command",
      command: "retry",
      expectedVersion: 1,
    };
    const target: ActionTarget_m0 = { runId: "11111111-1111-4000-8000-111111111111", expectedVersion: 1 };
    const composed = composeCommandRequest_m0(retryAction, target, {
      actorId: "operator-1",
      source: "queue",
    });
    assert_m0.equal(composed.state, "refused");
    if (composed.state === "refused") {
      assert_m0.match(composed.reason, /Open Rerun to review steps and values before starting a new run/u);
    }
  });

  it_m0("suppresses duplicate in-flight dispatch and permits dispatch after settlement", () => {
    const inFlight = new Set<string>();
    const runId = "11111111-1111-4000-8000-111111111111";
    const inFlightKey = `${runId}:cancel`;

    let dispatches = 0;
    const triggerDispatch = () => {
      if (inFlight.has(inFlightKey)) return "suppressed";
      inFlight.add(inFlightKey);
      dispatches += 1;
      return "dispatched";
    };

    // First click: dispatches
    assert_m0.equal(triggerDispatch(), "dispatched");
    assert_m0.equal(dispatches, 1);

    // Rapid second & third clicks while in flight: suppressed
    assert_m0.equal(triggerDispatch(), "suppressed");
    assert_m0.equal(triggerDispatch(), "suppressed");
    assert_m0.equal(dispatches, 1);

    // First finishes and clears inFlight
    inFlight.delete(inFlightKey);

    // Subsequent click is allowed
    assert_m0.equal(triggerDispatch(), "dispatched");
    assert_m0.equal(dispatches, 2);
  });

  it_m0("retains commandId across uncertain network response and exact replay produces single accepted effect", () => {
    const harness = createHarness();
    const runId = "22222222-2222-4000-8000-222222222222";
    enqueueRun(harness, runId);

    const action: CommandAction_m0 = {
      key: "cancel",
      label: "Cancel run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "cancel",
      expectedVersion: 1,
    };
    const target: ActionTarget_m0 = { runId, expectedVersion: 1 };

    // Initial dispatch retains commandId & requestedAt
    const commandId = "33333333-3333-4000-8000-333333333333";
    const requestedAt = "2026-09-22T12:00:00.000Z";

    const composed1 = composeCommandRequest_m0(action, target, {
      actorId: "operator-1",
      source: "queue",
      commandId,
      requestedAt,
    });
    assert_m0.equal(composed1.state, "ready");
    if (composed1.state !== "ready") return;

    // Simulate successful kernel execution
    const request1 = CommandRequestSchema_m0.parse(composed1.request);
    const result1 = harness.kernel.execute(request1);
    assert_m0.equal(result1.state, "applied");


    const composedReplay = composeCommandRequest_m0(action, target, {
      actorId: "operator-1",
      source: "queue",
      commandId, // exact same commandId
      requestedAt, // exact same requestedAt
    });
    assert_m0.equal(composedReplay.state, "ready");
    if (composedReplay.state !== "ready") return;

    const requestReplay = CommandRequestSchema_m0.parse(composedReplay.request);
    const resultReplay = harness.kernel.execute(requestReplay);

    // Idempotent replay recognized by the journal: already-applied
    assert_m0.equal(resultReplay.state, "already-applied");
    assert_m0.equal(resultReplay.commandId, commandId);

    const settlement = settleCommandResult_m0(resultReplay);
    assert_m0.equal(settlement.kind, "applied");
    assert_m0.equal(settlement.replayed, true);
  });
});

describe_m0("Delete: Terminal-only, leaves-first, and selection-switch protection", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("refuses to delete an active run; leaves no tombstone and removes no bytes", () => {
    const harness = createHarness();
    const runId = "55555555-5555-4000-8000-555555555555";
    enqueueRun(harness, runId);

    const runBefore = harness.database.authority.runs.get(runId);
    assert_m0.ok(runBefore !== undefined);

    const deleteAction: CommandAction_m0 = {
      key: "delete",
      label: "Delete run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "delete",
      expectedVersion: runBefore.version,
    };
    const target: ActionTarget_m0 = { runId, expectedVersion: runBefore.version };
    const composed = composeCommandRequest_m0(deleteAction, target, {
      actorId: "operator-1",
      source: "queue",
    });
    assert_m0.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = CommandRequestSchema_m0.parse(composed.request);
    const result = harness.kernel.execute(request);

    assert_m0.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert_m0.equal(result.code, "invalid-state");
      assert_m0.match(result.message, /only a terminal run can be deleted/u);
    }

    // No tombstone created
    assert_m0.equal(harness.database.authority.deletedRuns.get(runId), undefined);
    // Authority row remains completely intact
    assert_m0.deepEqual(harness.database.authority.runs.get(runId), runBefore);
  });

  it_m0("deletes a valid terminal run leaves-first with insert-only tombstone", () => {
    const harness = createHarness();
    const runId = "66666666-6666-4000-8000-666666666666";
    enqueueRun(harness, runId);
    const terminalVersion = terminalizeRun(harness, runId, "cancelled");

    const deleteAction: CommandAction_m0 = {
      key: "delete",
      label: "Delete run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "delete",
      expectedVersion: terminalVersion,
    };
    const target: ActionTarget_m0 = { runId, expectedVersion: terminalVersion };
    const commandId = "77777777-7777-4000-8000-777777777777";
    const composed = composeCommandRequest_m0(deleteAction, target, {
      actorId: "operator-1",
      source: "queue",
      commandId,
    });
    assert_m0.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = CommandRequestSchema_m0.parse(composed.request);
    const result = harness.kernel.execute(request);
    assert_m0.equal(result.state, "applied");
    if (result.state !== "applied") return;


    assert_m0.equal(harness.database.authority.runs.get(runId), undefined);

    // Tombstone exists with lifecycleCommandId
    const tombstone = harness.database.authority.deletedRuns.get(runId);
    assert_m0.ok(tombstone !== undefined);
    assert_m0.equal(tombstone.origin, "queue");
    assert_m0.equal(tombstone.commandId, lifecycleCommandId_m0("operator-delete", commandId));
    assert_m0.equal(tombstone.workflow, "person-lookup");

    // Exact replay with same commandId returns already-applied
    const replay = harness.kernel.execute(request);
    assert_m0.equal(replay.state, "already-applied");

    // A new delete command for the now-deleted run rejects as target-deleted
    const newDeleteComposed = composeCommandRequest_m0(deleteAction, target, {
      actorId: "operator-1",
      source: "queue",
      commandId: "88888888-8888-4000-8000-888888888888",
    });
    assert_m0.equal(newDeleteComposed.state, "ready");
    if (newDeleteComposed.state === "ready") {
      const again = harness.kernel.execute(CommandRequestSchema_m0.parse(newDeleteComposed.request));
      assert_m0.equal(again.state, "rejected");
      if (again.state === "rejected") {
        assert_m0.equal(again.code, "target-deleted");
      }
    }
  });

  it_m0("deletes a tree leaves-first, and refuses the tree while any member is not terminal", () => {
    const harness = createHarness();
    const parentId = "aaaaaaaa-1111-4000-8000-111111111111";
    enqueueRun(harness, parentId);
    const parent = harness.database.authority.runs.get(parentId);
    assert_m0.ok(parent !== undefined);

    const childId = "bbbbbbbb-2222-4000-8000-222222222222";
    const manifestId = "cccccccc-3333-4000-8000-333333333333";
    const dependencyId = "dddddddd-4444-4000-8000-444444444444";

    assert_m0.equal(harness.database.authority.runs.enqueue({
      envelope: {
        runId: childId,
        workflow: "person-lookup",
        itemId: deriveItemId_m0("person-lookup", "child:delete"),
        traceId: "pl-170000-4444",
        descriptorVersion: 1,
        contractFingerprint: parent.envelope.contractFingerprint,
        resolvedInstance: { ucpath: "prod" },
        configFingerprint: parent.envelope.configFingerprint,
        configSnapshotId: parent.envelope.configSnapshotId,
        parent: { runId: parentId, tracePrefix: parent.envelope.traceId, edgeId: "delete-edge" },
        shape: "operation-member",
        priority: "bulk",
        dryRun: false,
        attempt: 1,
        enqueuedAt: NOW_m0,
      },
      input: parent.input,
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      version: 1,
      createdAt: NOW_m0,
      updatedAt: NOW_m0,
    }).state, "inserted");

    harness.database.authority.delegationManifests.insert({
      manifestId,
      parentRunId: parentId,
      edgeId: "delete-edge",
      inputSchemaHash: HASH_A_m0,
      resultSchemaHash: HASH_B_m0,
      cardinality: "one",
      join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      children: [{ dependencyId, childRunId: childId, childItemId: deriveItemId_m0("person-lookup", "child:delete"), canonicalInputFingerprint: HASH_A_m0 }],
      createdAt: NOW_m0,
      manifestFingerprint: HASH_A_m0,
    });

    harness.database.authority.dependencies.insert({
      dependencyId,
      manifestId,
      edgeId: "delete-edge",
      parentRunId: parentId,
      childRunId: childId,
      childItemId: deriveItemId_m0("person-lookup", "child:delete"),
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      state: "active",
      version: 1,
      createdAt: NOW_m0,
      updatedAt: NOW_m0,
    });

    // Parent settles terminal, but child is still queued
    const parentVersion = terminalizeRun(harness, parentId, "cancelled");

    const parentDelete = composeCommandRequest_m0(
      { key: "delete", label: "Delete", intent: "destructive", placement: ["menu"], kind: "command", command: "delete", expectedVersion: parentVersion },
      { runId: parentId, expectedVersion: parentVersion },
      { actorId: "operator-1", source: "queue" },
    );
    assert_m0.equal(parentDelete.state, "ready");
    if (parentDelete.state === "ready") {
      const refused = harness.kernel.execute(CommandRequestSchema_m0.parse(parentDelete.request));
      assert_m0.equal(refused.state, "rejected");
      if (refused.state === "rejected") {
        assert_m0.equal(refused.code, "invalid-state");
        assert_m0.match(refused.message, /delegated child .* is queued/u);
      }
    }

    // Now child also settles terminal
    const childVersion = terminalizeRun(harness, childId, "cancelled");

    // Member cannot be deleted alone
    const childDelete = composeCommandRequest_m0(
      { key: "delete", label: "Delete", intent: "destructive", placement: ["menu"], kind: "command", command: "delete", expectedVersion: childVersion },
      { runId: childId, expectedVersion: childVersion },
      { actorId: "operator-1", source: "queue" },
    );
    assert_m0.equal(childDelete.state, "ready");
    if (childDelete.state === "ready") {
      const memberDoor = harness.kernel.execute(CommandRequestSchema_m0.parse(childDelete.request));
      assert_m0.equal(memberDoor.state, "rejected");
      if (memberDoor.state === "rejected") {
        assert_m0.equal(memberDoor.code, "invalid-state");
        assert_m0.match(memberDoor.message, /delegated member of run .*; delete the group/u);
      }
    }

    // Deleting parent deletes tree leaves-first
    if (parentDelete.state === "ready") {
      const deleted = harness.kernel.execute(CommandRequestSchema_m0.parse(parentDelete.request));
      assert_m0.equal(deleted.state, "applied");
      if (deleted.state === "applied") {
        assert_m0.deepEqual(
          deleted.affectedTargets.map((target) => ("runId" in target ? target.runId : undefined)),
          [childId, parentId],
          "leaves first, then the parent target",
        );
      }
      assert_m0.equal(harness.database.authority.runs.get(childId), undefined);
      assert_m0.equal(harness.database.authority.runs.get(parentId), undefined);
      assert_m0.ok(harness.database.authority.deletedRuns.get(childId) !== undefined);
      assert_m0.ok(harness.database.authority.deletedRuns.get(parentId) !== undefined);
    }
  });

  it_m0("clears selection when deleted run is currently selected, but preserves a different run selected in the meantime", () => {
    const targetRunId = "88888888-8888-4000-8000-888888888888";
    const otherRunId = "99999999-9999-4000-8000-999999999999";

    // Scenario A: target run is still selected when delete settles -> clears selection
    let routeA: { run?: string; section?: string } = { run: targetRunId, section: "timeline" };
    let bulkIdsA = new Set<string>([targetRunId, otherRunId]);

    // Settlement logic matching LoadedApp delete handler
    routeA = routeA.run === targetRunId ? { ...routeA, run: undefined, section: undefined } : routeA;
    if (bulkIdsA.has(targetRunId)) {
      const next = new Set(bulkIdsA);
      next.delete(targetRunId);
      bulkIdsA = next;
    }

    assert_m0.equal(routeA.run, undefined, "cleared route selection for deleted run");
    assert_m0.equal(routeA.section, undefined);
    assert_m0.ok(!bulkIdsA.has(targetRunId), "removed deleted run from bulk selection");
    assert_m0.ok(bulkIdsA.has(otherRunId), "preserved other bulk selections");


    let routeB: { run?: string; section?: string } = { run: otherRunId, section: "log" };
    let bulkIdsB = new Set<string>([otherRunId]);

    // Late settlement of targetRunId delete lands:
    routeB = routeB.run === targetRunId ? { ...routeB, run: undefined, section: undefined } : routeB;
    if (bulkIdsB.has(targetRunId)) {
      const next = new Set(bulkIdsB);
      next.delete(targetRunId);
      bulkIdsB = next;
    }

    assert_m0.equal(routeB.run, otherRunId, "did NOT close the different run selected in the meantime");
    assert_m0.equal(routeB.section, "log");
    assert_m0.ok(bulkIdsB.has(otherRunId), "preserved bulkIds for active selection");
  });
});
}

{


const ACTOR = { actorId: "local-operator", source: "session-panel" } as const;

describe_m1("the controls post the arms the wire declares", () => {

  it_m1("plans a first pool against basis 0 — the honest basis, not a guess", () => {
    const request = CommandRequestSchema_m1.parse(composePlanWorkerCountCommand_m1(
      { workflowId: "separations", desiredWorkers: 1, expectedVersion: 0 },
      ACTOR,
    ));
    assert_m1.deepEqual(request.target, { workflowId: "separations", expectedVersion: 0 });
  });

  it_m1("stops a worker against its LEASE version, which is a different basis", () => {
    const request = CommandRequestSchema_m1.parse(composeStopWorkerCommand_m1(
      { workerId: "person-lookup-worker-1", membershipRevision: positiveIntSchemaForReset.parse(1), leaseVersion: 12, controlBasis: { leaseGeneration: positiveIntSchemaForReset.parse(2), controlRevision: positiveIntSchemaForReset.parse(3) } },
      ACTOR,
    ));

    assert_m1.equal(request.type, "stop-worker");
    assert_m1.deepEqual(request.target, { workerId: "person-lookup-worker-1", membershipRevision: 1, expectedVersion: 12, controlBasis: { leaseGeneration: 2, controlRevision: 3 } });
  });
});
}

it_m0("verifies real cascade tombstones after a lost delete reply and explicit executor recovery", async () => {
  const { createCommandKernelTestWorld } = await import("../../../support/helpers/backend/command-kernel-harness.js");
  const { kernelRejectMemberRecord } = await import("../../../support/helpers/backend/kernel-reject-member-run.js");
  const { singleAppliedRunId } = await import("../../../support/fixtures/operator-command-fixtures.js");
  const { createItemAttemptHistoryQuery } = await import("../../../../src/backend/runs/queries/item-attempt-history.js");
  const { sqliteRunReader } = await import("../../../support/helpers/canonical-run-reader.js");
  const { createDashboardClient } = await import("../../../../src/dashboard/client/index.js");
  const { CommandExecutor } = await import("../../../../src/dashboard/app/commands/command-executor.js");
  const { verifyShellCommandEffect } = await import("../../../../src/dashboard/app/commands/command-dispatch.js");
  const world = createCommandKernelTestWorld();
  try {
    const h = world.createHarness();
    const plan = world.createPlan(h, world.rejectActiveDescriptor, ["10800000"]);
    const parentId = singleAppliedRunId(h.kernel.execute(world.startCommand(plan)));
    const parent = h.database.authority.runs.get(parentId); assert_m0.ok(parent);
    const childId = "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa", manifestId = "bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb", dependencyId = "cccccccc-4444-4444-8444-cccccccccccc";
    const childItemId = deriveItemId_m0("kernel-reject", "child:delete");
    const policy = { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const, afterChildRetry: "resume-parent" as const, visibility: "inline" as const };
    assert_m0.equal(h.database.authority.runs.enqueue(kernelRejectMemberRecord(parent, parentId, childId, "child:delete", "kr-170000-4444", "delete-edge", NOW_m0)).state, "inserted");
    h.database.authority.delegationManifests.insert({ manifestId, parentRunId: parentId, edgeId: "delete-edge", inputSchemaHash: HASH_A_m0, resultSchemaHash: HASH_B_m0,
      cardinality: "one", join: "one", policy, children: [{ dependencyId, childRunId: childId, childItemId, canonicalInputFingerprint: HASH_A_m0 }], createdAt: NOW_m0, manifestFingerprint: HASH_A_m0 });
    h.database.authority.dependencies.insert({ dependencyId, manifestId, edgeId: "delete-edge", parentRunId: parentId, childRunId: childId, childItemId, policy, state: "active", version: 1, createdAt: NOW_m0, updatedAt: NOW_m0 });
    for (const id of [parentId, childId]) {
      const run = h.database.authority.runs.get(id); assert_m0.ok(run);
      assert_m0.equal(h.database.authority.runs.transition({ runId: id, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW_m0 }, now: NOW_m0 }).state, "applied");
    }
    const terminal = h.database.authority.runs.get(parentId); assert_m0.ok(terminal);
    const request = world.runCommand("delete", parentId, terminal.version);
    const history = createItemAttemptHistoryQuery({ database: h.database, reader: sqliteRunReader(h.database, h.clock) });
    const bodies: string[] = [];
    const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
      if (url.endsWith("/commands")) {
        assert_m0.equal(typeof init?.body, "string"); if (typeof init?.body !== "string") throw new Error("missing body");
        bodies.push(init.body);
        const result = h.kernel.execute(CommandRequestSchema_m0.parse(JSON.parse(init.body)));
        if (bodies.length === 1) throw new Error("lost acknowledgment");
        return Response.json(result);
      }
      const selectedId = url.includes(childId) ? childId : parentId;
      return Response.json(history.read(selectedId, { limit: 25 }));
    } });
    let scope: import("../../../../src/dashboard/app/commands/command-executor.js").CommandExecutionScope | undefined = { actorId: request.requestedBy, client, authority: {}, dayRequest: { day: "2026-08-03" } };
    const executor = new CommandExecutor(() => scope);
    const readback: import("../../../../src/dashboard/app/commands/command-executor.js").CommandExecutionOptions["readback"] = (child, reply) => verifyShellCommandEffect(client, "2026-08-03", child, reply);
    const firstScope = scope;
    assert_m0.equal((await executor.execute(request, { scope, readback })).kind, "uncertain");
    assert_m0.equal(h.database.authority.runs.get(parentId), undefined); assert_m0.equal(h.database.authority.runs.get(childId), undefined);
    scope = undefined;
    assert_m0.equal((await executor.replay(request.commandId, { scope: firstScope, readback })).kind, "refused");
    scope = { ...firstScope, authority: {}, dayRequest: { day: "2026-08-04" } };
    const result = await executor.replay(request.commandId, { scope, readback });
    assert_m0.equal(result.kind, "confirmed"); assert_m0.deepEqual(bodies, [bodies[0], bodies[0]]);
    assert_m0.ok(result.reply !== undefined && "affectedTargets" in result.reply);
    assert_m0.deepEqual(result.reply.affectedTargets.map(target => target.family === "run" ? target.runId : undefined), [childId, parentId]);
  } finally {
    for (const database of world.openDatabases.splice(0)) database.close();
    for (const path of world.roots.splice(0)) rmSync_m0(path, { recursive: true, force: true });
  }
});
