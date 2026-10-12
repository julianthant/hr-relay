import { kernelRejectMemberRecord } from "../../../support/helpers/backend/kernel-reject-member-run.js";
import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { HASH_A, HASH_B, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, rejectActiveDescriptor, createHarness, createPlan, startCommand, runCommand } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("run arms", () => {
  function startOne(harness: Harness, descriptor: AnyWorkflowDescriptor, eid: string): string {
    const plan = createPlan(harness, descriptor, [eid]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    return singleAppliedRunId(result);
  }

  it("retries a terminal run into a fresh linked run and refuses an active item", () => {
    const harness = createHarness();
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

  it("cancel is CAS-scoped and cascades through authority dependency edges only", () => {
    const harness = createHarness();
    const parentId = startOne(harness, rejectActiveDescriptor, "10800000");
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);

    const cascadeChildId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const independentChildId = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
    assert.equal(harness.database.authority.runs.enqueue(kernelRejectMemberRecord(parent, parentId, cascadeChildId, "child:aaaa", "kr-170000-aaaa", "cascade-edge", NOW)).state, "inserted");
    assert.equal(harness.database.authority.runs.enqueue(kernelRejectMemberRecord(parent, parentId, independentChildId, "child:bbbb", "kr-170000-bbbb", "independent-edge", NOW)).state, "inserted");

    const manifest = (manifestId: string, edgeId: string, childRunId: string, childItemId: string, cascadeCancel: string) => ({
      manifestId,
      parentRunId: parentId,
      edgeId,
      inputSchemaHash: HASH_A,
      resultSchemaHash: HASH_B,
      cardinality: "one",
      join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel, afterChildRetry: "resume-parent", visibility: "inline" },
      children: [{ dependencyId: `${manifestId.slice(0, 8)}-3333-4333-8333-333333333333`, childRunId, childItemId, canonicalInputFingerprint: HASH_A }],
      createdAt: NOW,
      manifestFingerprint: HASH_A,
    });
    const dependency = (dependencyId: string, manifestId: string, edgeId: string, childRunId: string, childItemId: string, cascadeCancel: string) => ({
      dependencyId,
      manifestId,
      edgeId,
      parentRunId: parentId,
      childRunId,
      childItemId,
      policy: { onChildFailed: "fail-parent", cascadeCancel, afterChildRetry: "resume-parent", visibility: "inline" },
      state: "active",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const cascadeItem = deriveItemId("kernel-reject", "child:aaaa");
    const independentItem = deriveItemId("kernel-reject", "child:bbbb");
    harness.database.authority.delegationManifests.insert(manifest("dddddddd-1111-4111-8111-dddddddddddd", "cascade-edge", cascadeChildId, cascadeItem, "cascade"));
    harness.database.authority.delegationManifests.insert(manifest("dddddddd-2222-4222-8222-dddddddddddd", "independent-edge", independentChildId, independentItem, "independent"));
    harness.database.authority.dependencies.insert(dependency("dddddddd-3333-4333-8333-dddddddddddd", "dddddddd-1111-4111-8111-dddddddddddd", "cascade-edge", cascadeChildId, cascadeItem, "cascade"));
    harness.database.authority.dependencies.insert(dependency("dddddddd-4444-4444-8444-dddddddddddd", "dddddddd-2222-4222-8222-dddddddddddd", "independent-edge", independentChildId, independentItem, "independent"));

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

  it("cancels nothing when a child has no dependency edge in authority", () => {
    const harness = createHarness();
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


  it("bump elevates a queued run to interactive at the live version, and refuses a stale one", () => {
    const harness = createHarness();
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

    const claimed = harness.database.authority.runs.claimNext({ workflow: "kernel-reject", workerId: "worker-1", now: NOW });
    assert.equal(claimed.state, "claimed");
    const busy = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(busy.state, "rejected");
    if (busy.state === "rejected") assert.equal(busy.code, "invalid-state");
  });

  it("rename is presentation-only and changes no lifecycle", () => {
    const harness = createHarness();
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


  it("refuses a stale rename with the live version", () => {
    const harness = createHarness();
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
