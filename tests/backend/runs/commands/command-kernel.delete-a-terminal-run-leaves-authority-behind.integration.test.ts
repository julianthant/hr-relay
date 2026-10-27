import { kernelRejectMemberRecord } from "../../../support/helpers/backend/kernel-reject-member-run.js";
import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { HASH_A, HASH_B, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, createPlan, startCommand, runCommand } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


describe("delete — a terminal run leaves authority behind one tombstone", () => {
  function startOne(harness: Harness, descriptor: AnyWorkflowDescriptor, eid: string): string {
    const plan = createPlan(harness, descriptor, [eid]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    return singleAppliedRunId(result);
  }

  function settle(harness: Harness, runId: string): number {
    const run = harness.database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    const settled = harness.database.authority.runs.transition({
      runId,
      expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    assert.equal(settled.state, "applied");
    return run.version + 1;
  }

  it("refuses a run that is not terminal, and leaves it exactly as it was", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const before = harness.database.authority.runs.get(runId);
    assert.ok(before !== undefined);

    const result = harness.kernel.execute(runCommand("delete", runId, before.version));
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "invalid-state");
      assert.match(result.message, /only a terminal run can be deleted/u);
    }
    assert.deepEqual(harness.database.authority.runs.get(runId), before);
    assert.equal(harness.database.authority.deletedRuns.get(runId), undefined);
  });

  it("CASes the caller's version before it reads anything else", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = settle(harness, runId);

    const stale = harness.kernel.execute(runCommand("delete", runId, version - 1));
    assert.equal(stale.state, "conflict");
    assert.ok(harness.database.authority.runs.get(runId) !== undefined);
  });

  it("deletes a cancelled run entirely, keeps the journal, and refuses a second delete by name", async () => {
    const harness = await createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = settle(harness, runId);
    const generationBefore = harness.database.getMeta().authorityGeneration;

    const command = runCommand("delete", runId, version);
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "applied");
    if (result.state === "applied") {
      assert.deepEqual(result.affectedTargets, [{ family: "run", runId }]);
    }

    assert.equal(harness.database.authority.runs.get(runId), undefined, "the tasks row is gone");
    assert.equal(harness.database.authority.runs.findByTrace("kr-170000-0001"), undefined);
    const tombstone = harness.database.authority.deletedRuns.get(runId);
    assert.ok(tombstone !== undefined, "exactly one tombstone remains");
    assert.equal(tombstone.origin, "queue");
    assert.equal(tombstone.commandId, lifecycleCommandId("operator-delete", command.commandId));
    assert.equal(tombstone.workflow, "kernel-reject");
    assert.deepEqual(tombstone.removed.filter(({ table }) => table === "runs"), [{ table: "runs", rows: 1 }]);
    assert.ok(harness.database.authority.commands.get(command.commandId) !== undefined, "the delete is journaled");
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore + 1);

    const again = harness.kernel.execute(runCommand("delete", runId, version));
    assert.equal(again.state, "rejected");
    if (again.state === "rejected") assert.equal(again.code, "target-deleted");
  });



  it("deletes a tree leaves-first, and refuses the tree while any member is not terminal", async () => {
    const harness = await createHarness();
    const parentId = startOne(harness, rejectActiveDescriptor, "10800000");
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);
    const childId = "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa";
    const manifestId = "bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb";
    const dependencyId = "cccccccc-4444-4444-8444-cccccccccccc";
    assert.equal(harness.database.authority.runs.enqueue(kernelRejectMemberRecord(parent, parentId, childId, "child:delete", "kr-170000-4444", "delete-edge", NOW)).state, "inserted");
    harness.database.authority.delegationManifests.insert({
      manifestId,
      parentRunId: parentId,
      edgeId: "delete-edge",
      inputSchemaHash: HASH_A,
      resultSchemaHash: HASH_B,
      cardinality: "one",
      join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      children: [{ dependencyId, childRunId: childId, childItemId: deriveItemId("kernel-reject", "child:delete"), canonicalInputFingerprint: HASH_A }],
      createdAt: NOW,
      manifestFingerprint: HASH_A,
    });
    harness.database.authority.dependencies.insert({
      dependencyId,
      manifestId,
      edgeId: "delete-edge",
      parentRunId: parentId,
      childRunId: childId,
      childItemId: deriveItemId("kernel-reject", "child:delete"),
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      state: "active",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // The parent settles on its own; the child is still queued.
    const parentVersion = settle(harness, parentId);
    const refused = harness.kernel.execute(runCommand("delete", parentId, parentVersion));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") {
      assert.equal(refused.code, "invalid-state");
      assert.match(refused.message, /delegated child .* is queued/u);
    }
    assert.ok(harness.database.authority.runs.get(parentId) !== undefined, "nothing was deleted");
    assert.ok(harness.database.authority.runs.get(childId) !== undefined);

    const childVersion = settle(harness, childId);
    const memberDoor = harness.kernel.execute(runCommand("delete", childId, childVersion));
    assert.equal(memberDoor.state, "rejected");
    if (memberDoor.state === "rejected") {
      assert.equal(memberDoor.code, "invalid-state");
      assert.match(memberDoor.message, /delegated member of run .*; delete the group/u);
    }
    assert.ok(harness.database.authority.runs.get(childId) !== undefined, "a member is not deleted alone");

    const deleted = harness.kernel.execute(runCommand("delete", parentId, parentVersion));
    assert.equal(deleted.state, "applied");
    if (deleted.state === "applied") {
      assert.deepEqual(
        deleted.affectedTargets.map((target) => ("runId" in target ? target.runId : undefined)),
        [childId, parentId],
        "leaves first, then the target",
      );
    }
    assert.equal(harness.database.authority.runs.get(childId), undefined);
    assert.equal(harness.database.authority.runs.get(parentId), undefined);
    assert.deepEqual(harness.database.authority.dependencies.listByParentRun(parentId), []);
    assert.ok(harness.database.authority.deletedRuns.get(childId) !== undefined);
    assert.ok(harness.database.authority.deletedRuns.get(parentId) !== undefined);
  });
});
