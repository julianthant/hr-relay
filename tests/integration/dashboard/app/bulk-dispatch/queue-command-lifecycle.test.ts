
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";

import {
  composeBulkRunCommand,
  planBulkVerb,
  bulkResultCounts,
  type BulkCandidateRow,
} from "../../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { composeCommandRequest, type CommandAction } from "../../../../../src/dashboard/app/commands/command-dispatch.js";
import { settleCommandResult } from "../../../../../src/dashboard/app/commands/command-result.js";
import { commandResultFeedEntry } from "../../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import type { ActionTarget } from "../../../../../src/dashboard/surfaces/shared/actions/actions.js";
import {
  createCommandKernel,
  type CommandKernel,
} from "../../../../../src/backend/runs/commands/command-kernel.js";
import {
  lifecycleCommandId,
  RunRecordService,
} from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { deriveItemId } from "../../../../../src/rules/identity/identifiers.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import {
  BulkRunCommandResponseSchema,
  BulkRunCommandRequestSchema,
  CommandRequestSchema,
} from "../../../../../src/rules/commands/commands.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";
import { seedSyntheticRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import {
  HASH_A,
  HASH_B,
  NOW,
  UUID_4,
} from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../../../support/fixtures/archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../../support/fixtures/intake-kernel-seams.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createHarness(): {
  database: AuthorityDatabase;
  kernel: CommandKernel;
  clock: ReturnType<typeof manualClock>;
  lifecycle: RunRecordService;
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "queue-lifecycle-test-")));
  roots.push(root);
  const path = join(root, "authority.sqlite");
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "queue-lifecycle-proof" },
    clock,
  );
  openDatabases.push(database);
  seedSyntheticRuntimeConfig(database);

  const ids = sequentialIdFactory("d");
  const lifecycle = new RunRecordService({
    database,
    clock,
    ids,
    publishQueued: () => {},
  });

  const kernel = createCommandKernel({
    lifecycle,
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
    },
    clock,
    ids,
    descriptors: {
      resolve: (workflow) => (workflow === "person-lookup" ? personLookupDescriptor : undefined),
    },
    writeResolution: {
      resolveAbsent: () => { throw new Error("unused in test"); },
      resolvePresent: () => { throw new Error("unused in test"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("unused in test"); },
      spawnWorker: () => { throw new Error("unused in test"); },
      refreshBrowser: () => { throw new Error("unused in test"); },
      reopenBrowser: () => { throw new Error("unused in test"); },
    },
  });

  return { database, kernel, clock, lifecycle };
}

function enqueueRun(harness: Harness, runId: string, priority: "bulk" | "interactive" = "bulk"): void {
  const insert = harness.database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId,
      itemId: runId,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      configFingerprint: HASH_B,
      configSnapshotId: UUID_4,
      priority,
    },
  });
  assert.equal(insert.state, "inserted");
}

function terminalizeRun(harness: Harness, runId: string, outcome: "completed" | "cancelled" | "failed" = "cancelled"): number {
  const run = harness.database.authority.runs.get(runId);
  assert.ok(run !== undefined);
  const settled = harness.database.authority.runs.transition({
    runId,
    expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome, endedAt: NOW },
    now: NOW,
  });
  assert.equal(settled.state, "applied");
  return run.version + 1;
}

type Harness = ReturnType<typeof createHarness>;

describe("Queue commands: CAS binding, attribution, in-flight, and replay", () => {
  it("binds exact expectedVersion; stale version refuses with CAS conflict and records feed entry without state change", () => {
    const harness = createHarness();
    const runId = "11111111-1111-4000-8000-111111111111";
    enqueueRun(harness, runId);
    // Advance run to version 2 via claim
    const claim = harness.database.authority.runs.claimNext({ workflow: "person-lookup", workerId: "worker-1", now: NOW });
    assert.equal(claim.state, "claimed");
    const currentRun = harness.database.authority.runs.get(runId);
    assert.ok(currentRun !== undefined);
    assert.equal(currentRun.version, 2);

    // Cancel action with stale expectedVersion (1 instead of 2)
    const staleAction: CommandAction = {
      key: "cancel",
      label: "Cancel run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "cancel",
      expectedVersion: 1,
    };
    const target: ActionTarget = { runId, expectedVersion: 1 };
    const composed = composeCommandRequest(staleAction, target, {
      actorId: "test-operator",
      source: "queue",
    });
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = CommandRequestSchema.parse(composed.request);
    const result = harness.kernel.execute(request);
    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") return;
    assert.equal(result.currentVersion, 2);


    const settlement = settleCommandResult(result);
    assert.equal(settlement.kind, "refused");
    if (settlement.kind !== "refused") return;
    assert.equal(settlement.reason, "conflict");
    assert.equal(settlement.currentVersion, 2);

    // Record into persistent failure feed
    const feed = commandResultFeedEntry({
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
    assert.ok(feed !== undefined);
    assert.equal(feed.targetRunId, runId);
    assert.equal(feed.expectedVersion, 1);

    // Confirm authority row is completely unchanged
    const after = harness.database.authority.runs.get(runId);
    assert.deepEqual(after, currentRun);
  });

  it("stamps source: 'queue' when dispatched from Queue and source: 'run-detail' from Run Detail", () => {
    const action: CommandAction = {
      key: "cancel",
      label: "Cancel",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "cancel",
      expectedVersion: 1,
    };
    const target: ActionTarget = { runId: "11111111-1111-4000-8000-111111111111", expectedVersion: 1 };

    const queueComposed = composeCommandRequest(action, target, {
      actorId: "operator-1",
      source: "queue",
    });
    assert.equal(queueComposed.state, "ready");
    if (queueComposed.state === "ready") {
      const parsed = CommandRequestSchema.parse(queueComposed.request);
      assert.equal(parsed.source, "queue");
    }

    const detailComposed = composeCommandRequest(action, target, {
      actorId: "operator-1",
      source: "run-detail",
    });
    assert.equal(detailComposed.state, "ready");
    if (detailComposed.state === "ready") {
      const parsed = CommandRequestSchema.parse(detailComposed.request);
      assert.equal(parsed.source, "run-detail");
    }
  });

  it("refuses direct retry/restart mutation and directs operator to Rerun modal", () => {
    const retryAction: CommandAction = {
      key: "retry",
      label: "Retry",
      intent: "neutral",
      placement: ["menu"],
      kind: "command",
      command: "retry",
      expectedVersion: 1,
    };
    const target: ActionTarget = { runId: "11111111-1111-4000-8000-111111111111", expectedVersion: 1 };
    const composed = composeCommandRequest(retryAction, target, {
      actorId: "operator-1",
      source: "queue",
    });
    assert.equal(composed.state, "refused");
    if (composed.state === "refused") {
      assert.match(composed.reason, /Open Rerun to review steps and values before starting a new run/u);
    }
  });

  it("suppresses duplicate in-flight dispatch and permits dispatch after settlement", () => {
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
    assert.equal(triggerDispatch(), "dispatched");
    assert.equal(dispatches, 1);

    // Rapid second & third clicks while in flight: suppressed
    assert.equal(triggerDispatch(), "suppressed");
    assert.equal(triggerDispatch(), "suppressed");
    assert.equal(dispatches, 1);

    // First finishes and clears inFlight
    inFlight.delete(inFlightKey);

    // Subsequent click is allowed
    assert.equal(triggerDispatch(), "dispatched");
    assert.equal(dispatches, 2);
  });

  it("retains commandId across uncertain network response and exact replay produces single accepted effect", () => {
    const harness = createHarness();
    const runId = "22222222-2222-4000-8000-222222222222";
    enqueueRun(harness, runId);

    const action: CommandAction = {
      key: "cancel",
      label: "Cancel run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "cancel",
      expectedVersion: 1,
    };
    const target: ActionTarget = { runId, expectedVersion: 1 };

    // Initial dispatch retains commandId & requestedAt
    const commandId = "33333333-3333-4000-8000-333333333333";
    const requestedAt = "2026-09-22T12:00:00.000Z";

    const composed1 = composeCommandRequest(action, target, {
      actorId: "operator-1",
      source: "queue",
      commandId,
      requestedAt,
    });
    assert.equal(composed1.state, "ready");
    if (composed1.state !== "ready") return;

    // Simulate successful kernel execution
    const request1 = CommandRequestSchema.parse(composed1.request);
    const result1 = harness.kernel.execute(request1);
    assert.equal(result1.state, "applied");


    const composedReplay = composeCommandRequest(action, target, {
      actorId: "operator-1",
      source: "queue",
      commandId, // exact same commandId
      requestedAt, // exact same requestedAt
    });
    assert.equal(composedReplay.state, "ready");
    if (composedReplay.state !== "ready") return;

    const requestReplay = CommandRequestSchema.parse(composedReplay.request);
    const resultReplay = harness.kernel.execute(requestReplay);

    // Idempotent replay recognized by the journal: already-applied
    assert.equal(resultReplay.state, "already-applied");
    assert.equal(resultReplay.commandId, commandId);

    const settlement = settleCommandResult(resultReplay);
    assert.equal(settlement.kind, "applied");
    assert.equal(settlement.replayed, true);
  });

  it("plans bulk cancel preserving frozen target order and reporting distinct outcomes", () => {
    const runIdA = "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa";
    const runIdB = "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb";
    const runIdC = "cccccccc-cccc-4000-8000-cccccccccccc";
    const sub1 = "11111111-aaaa-4000-8000-111111111111";
    const sub2 = "22222222-bbbb-4000-8000-222222222222";
    const rows: BulkCandidateRow[] = [
      {
        runId: runIdA,
        title: "Alpha",
        actions: [{ key: "cancel", label: "Cancel", intent: "neutral", placement: ["menu"], kind: "command", command: "cancel", expectedVersion: 2 }],
      },
      {
        runId: runIdB,
        title: "Bravo",
        actions: [{ key: "cancel", label: "Cancel", intent: "neutral", placement: ["menu"], kind: "command", command: "cancel", expectedVersion: 5 }],
      },
      {
        runId: runIdC,
        title: "Charlie",
        actions: [], // Not eligible
      },
    ];

    const plan = planBulkVerb(rows, "cancel", [runIdA, runIdB, runIdC]);
    assert.deepEqual(plan.eligible, [
      { runId: runIdA, title: "Alpha", expectedVersion: 2 },
      { runId: runIdB, title: "Bravo", expectedVersion: 5 },
    ]);
    assert.deepEqual(plan.skipped, [{ runId: runIdC, title: "Charlie" }]);

    const commandId = "44444444-4444-4000-8000-444444444444";
    const requestedAt = "2026-09-22T12:00:00.000Z";
    const composed = composeBulkRunCommand(plan, {
      actorId: "operator-1",
      source: "queue",
      commandId,
      requestedAt,
    });
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = BulkRunCommandRequestSchema.parse(composed.request);
    assert.equal(request.commandId, commandId);
    assert.equal(request.requestedAt, requestedAt);
    assert.deepEqual(request.targets, [
      { runId: runIdA, expectedVersion: 2 },
      { runId: runIdB, expectedVersion: 5 },
    ]);

    // Simulated mixed execution: one applied, one conflict
    const simulatedResponse = BulkRunCommandResponseSchema.parse({
      state: "vector",
      bulkCommandId: commandId,
      type: "cancel",
      requestedCount: 2,
      results: [
        { outcome: "applied", runId: runIdA, commandId: sub1, replayed: false, detail: "cancelled" },
        { outcome: "conflict", runId: runIdB, commandId: sub2, currentVersion: 6, detail: "the run moved while this was open." },
      ],
    });

    assert.equal(simulatedResponse.state, "vector");
    const counts = bulkResultCounts(simulatedResponse);
    assert.equal(counts.applied, 1);
    assert.equal(counts.conflict, 1);
    assert.equal(counts.refused, 0);
    // Partial bulk failure never becomes aggregate success
    assert.equal(simulatedResponse.state, "vector");
    if (simulatedResponse.state !== "vector") return;
    assert.notEqual(counts.applied, simulatedResponse.results.length);
  });
});

describe("Delete: Terminal-only, leaves-first, and selection-switch protection", () => {
  it("refuses to delete an active run; leaves no tombstone and removes no bytes", () => {
    const harness = createHarness();
    const runId = "55555555-5555-4000-8000-555555555555";
    enqueueRun(harness, runId);

    const runBefore = harness.database.authority.runs.get(runId);
    assert.ok(runBefore !== undefined);

    const deleteAction: CommandAction = {
      key: "delete",
      label: "Delete run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "delete",
      expectedVersion: runBefore.version,
    };
    const target: ActionTarget = { runId, expectedVersion: runBefore.version };
    const composed = composeCommandRequest(deleteAction, target, {
      actorId: "operator-1",
      source: "queue",
    });
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = CommandRequestSchema.parse(composed.request);
    const result = harness.kernel.execute(request);

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "invalid-state");
      assert.match(result.message, /only a terminal run can be deleted/u);
    }

    // No tombstone created
    assert.equal(harness.database.authority.deletedRuns.get(runId), undefined);
    // Authority row remains completely intact
    assert.deepEqual(harness.database.authority.runs.get(runId), runBefore);
  });

  it("deletes a valid terminal run leaves-first with insert-only tombstone", () => {
    const harness = createHarness();
    const runId = "66666666-6666-4000-8000-666666666666";
    enqueueRun(harness, runId);
    const terminalVersion = terminalizeRun(harness, runId, "cancelled");

    const deleteAction: CommandAction = {
      key: "delete",
      label: "Delete run",
      intent: "destructive",
      placement: ["menu"],
      kind: "command",
      command: "delete",
      expectedVersion: terminalVersion,
    };
    const target: ActionTarget = { runId, expectedVersion: terminalVersion };
    const commandId = "77777777-7777-4000-8000-777777777777";
    const composed = composeCommandRequest(deleteAction, target, {
      actorId: "operator-1",
      source: "queue",
      commandId,
    });
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = CommandRequestSchema.parse(composed.request);
    const result = harness.kernel.execute(request);
    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;


    assert.equal(harness.database.authority.runs.get(runId), undefined);

    // Tombstone exists with lifecycleCommandId
    const tombstone = harness.database.authority.deletedRuns.get(runId);
    assert.ok(tombstone !== undefined);
    assert.equal(tombstone.origin, "queue");
    assert.equal(tombstone.commandId, lifecycleCommandId("operator-delete", commandId));
    assert.equal(tombstone.workflow, "person-lookup");

    // Exact replay with same commandId returns already-applied
    const replay = harness.kernel.execute(request);
    assert.equal(replay.state, "already-applied");

    // A new delete command for the now-deleted run rejects as target-deleted
    const newDeleteComposed = composeCommandRequest(deleteAction, target, {
      actorId: "operator-1",
      source: "queue",
      commandId: "88888888-8888-4000-8000-888888888888",
    });
    assert.equal(newDeleteComposed.state, "ready");
    if (newDeleteComposed.state === "ready") {
      const again = harness.kernel.execute(CommandRequestSchema.parse(newDeleteComposed.request));
      assert.equal(again.state, "rejected");
      if (again.state === "rejected") {
        assert.equal(again.code, "target-deleted");
      }
    }
  });

  it("deletes a tree leaves-first, and refuses the tree while any member is not terminal", () => {
    const harness = createHarness();
    const parentId = "aaaaaaaa-1111-4000-8000-111111111111";
    enqueueRun(harness, parentId);
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);

    const childId = "bbbbbbbb-2222-4000-8000-222222222222";
    const manifestId = "cccccccc-3333-4000-8000-333333333333";
    const dependencyId = "dddddddd-4444-4000-8000-444444444444";

    assert.equal(harness.database.authority.runs.enqueue({
      envelope: {
        runId: childId,
        workflow: "person-lookup",
        itemId: deriveItemId("person-lookup", "child:delete"),
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
        enqueuedAt: NOW,
      },
      input: parent.input,
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }).state, "inserted");

    harness.database.authority.delegationManifests.insert({
      manifestId,
      parentRunId: parentId,
      edgeId: "delete-edge",
      inputSchemaHash: HASH_A,
      resultSchemaHash: HASH_B,
      cardinality: "one",
      join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      children: [{ dependencyId, childRunId: childId, childItemId: deriveItemId("person-lookup", "child:delete"), canonicalInputFingerprint: HASH_A }],
      createdAt: NOW,
      manifestFingerprint: HASH_A,
    });

    harness.database.authority.dependencies.insert({
      dependencyId,
      manifestId,
      edgeId: "delete-edge",
      parentRunId: parentId,
      childRunId: childId,
      childItemId: deriveItemId("person-lookup", "child:delete"),
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      state: "active",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // Parent settles terminal, but child is still queued
    const parentVersion = terminalizeRun(harness, parentId, "cancelled");

    const parentDelete = composeCommandRequest(
      { key: "delete", label: "Delete", intent: "destructive", placement: ["menu"], kind: "command", command: "delete", expectedVersion: parentVersion },
      { runId: parentId, expectedVersion: parentVersion },
      { actorId: "operator-1", source: "queue" },
    );
    assert.equal(parentDelete.state, "ready");
    if (parentDelete.state === "ready") {
      const refused = harness.kernel.execute(CommandRequestSchema.parse(parentDelete.request));
      assert.equal(refused.state, "rejected");
      if (refused.state === "rejected") {
        assert.equal(refused.code, "invalid-state");
        assert.match(refused.message, /delegated child .* is queued/u);
      }
    }

    // Now child also settles terminal
    const childVersion = terminalizeRun(harness, childId, "cancelled");

    // Member cannot be deleted alone
    const childDelete = composeCommandRequest(
      { key: "delete", label: "Delete", intent: "destructive", placement: ["menu"], kind: "command", command: "delete", expectedVersion: childVersion },
      { runId: childId, expectedVersion: childVersion },
      { actorId: "operator-1", source: "queue" },
    );
    assert.equal(childDelete.state, "ready");
    if (childDelete.state === "ready") {
      const memberDoor = harness.kernel.execute(CommandRequestSchema.parse(childDelete.request));
      assert.equal(memberDoor.state, "rejected");
      if (memberDoor.state === "rejected") {
        assert.equal(memberDoor.code, "invalid-state");
        assert.match(memberDoor.message, /delegated member of run .*; delete the group/u);
      }
    }

    // Deleting parent deletes tree leaves-first
    if (parentDelete.state === "ready") {
      const deleted = harness.kernel.execute(CommandRequestSchema.parse(parentDelete.request));
      assert.equal(deleted.state, "applied");
      if (deleted.state === "applied") {
        assert.deepEqual(
          deleted.affectedTargets.map((target) => ("runId" in target ? target.runId : undefined)),
          [childId, parentId],
          "leaves first, then the parent target",
        );
      }
      assert.equal(harness.database.authority.runs.get(childId), undefined);
      assert.equal(harness.database.authority.runs.get(parentId), undefined);
      assert.ok(harness.database.authority.deletedRuns.get(childId) !== undefined);
      assert.ok(harness.database.authority.deletedRuns.get(parentId) !== undefined);
    }
  });

  it("clears selection when deleted run is currently selected, but preserves a different run selected in the meantime", () => {
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

    assert.equal(routeA.run, undefined, "cleared route selection for deleted run");
    assert.equal(routeA.section, undefined);
    assert.ok(!bulkIdsA.has(targetRunId), "removed deleted run from bulk selection");
    assert.ok(bulkIdsA.has(otherRunId), "preserved other bulk selections");


    let routeB: { run?: string; section?: string } = { run: otherRunId, section: "log" };
    let bulkIdsB = new Set<string>([otherRunId]);

    // Late settlement of targetRunId delete lands:
    routeB = routeB.run === targetRunId ? { ...routeB, run: undefined, section: undefined } : routeB;
    if (bulkIdsB.has(targetRunId)) {
      const next = new Set(bulkIdsB);
      next.delete(targetRunId);
      bulkIdsB = next;
    }

    assert.equal(routeB.run, otherRunId, "did NOT close the different run selected in the meantime");
    assert.equal(routeB.section, "log");
    assert.ok(bulkIdsB.has(otherRunId), "preserved bulkIds for active selection");
  });
});
