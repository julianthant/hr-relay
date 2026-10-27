import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { appliedRunIds, singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { HASH_A, NOW, UUID_4, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, profiles, rejectActiveDescriptor, supersedeDescriptor, parallelDescriptor, createHarness, createPlan, startCommand, applyCurrentSettings } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start arm consumes plans atomically", () => {
  it("requires renewed review for a start plan made before settings activation", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    applyCurrentSettings(harness);

    const refused = harness.kernel.execute(startCommand(plan));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "replan-required");
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
  });

  it("consumes the plan and enqueues every accepted run in one applied command", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    assert.equal(plan.planned.length, 2);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), [], "saving a request creates no runs");
    assert.deepEqual(harness.database.authority.runSessions.list(), [], "saving a request creates no batch");

    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.equal(result.affectedTargets.length, 3);
    const runIds = appliedRunIds(result);
    assert.equal(runIds.length, plan.planned.length);

    const consumed = harness.database.authority.startPlans.get(plan.startPlanId);
    assert.ok(consumed?.consumedBy !== undefined);
    assert.equal(consumed.consumedBy.commandId, result.commandId);
    assert.equal(consumed.version, plan.version + 1);
    for (const [index, planned] of plan.planned.entries()) {
      const runId = runIds[index];
      assert.ok(runId !== undefined);
      const run = harness.database.authority.runs.get(runId);
      assert.ok(run !== undefined, runId);
      assert.equal(run.lifecycle.state, "queued");
      assert.deepEqual(run.input.raw, planned.rawInput);
      assert.deepEqual(run.input.parsed, planned.input);
      assert.equal(run.input.ingressSchemaHash, plan.ingressSchemaHash);
      assert.equal(run.envelope.contractFingerprint, plan.descriptorFingerprint);
    }
    const audit = harness.database.authority.commandAudits.findByCommand(result.commandId);
    assert.ok(audit !== undefined);
    assert.equal(audit.result.state, "applied");
    assert.equal(audit.versionChanges[0].before, plan.version);
    assert.equal(audit.versionChanges[0].after, plan.version + 1);
  });

  it("the fan-out is ONE durable session, written before its first member, and membership is the run rows", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    const runIds = appliedRunIds(result);

    const sessionIds = new Set(runIds.map((runId) => harness.database.authority.runs.get(runId)?.sessionId));
    assert.equal(sessionIds.size, 1, "both runs carry the same session id");
    const [sessionId] = [...sessionIds];
    assert.ok(sessionId !== undefined);
    const session = harness.database.authority.runSessions.get(sessionId);
    assert.ok(session !== undefined);
    assert.equal(session.workflow, plan.workflowId);
    assert.deepEqual(session.origin, { kind: "start-plan", startPlanId: plan.startPlanId, actorId: "local-operator" });
    assert.equal(session.startedAt, NOW);
    // Membership is DERIVED — the session row names nobody; the run table does.
    assert.deepEqual(
      harness.database.authority.runs.listBySession(sessionId).map((run) => run.envelope.runId).sort(),
      [...runIds].sort(),
    );
    assert.deepEqual(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).map((row) => row.sessionId), [sessionId]);
  });

  it("rolls back consumption and the journal when a run insert crashes", async () => {
    let shouldFail = false;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        enqueue: (input: unknown) => {
          if (shouldFail) throw new Error("injected run-insert crash");
          return repositories.runs.enqueue(input);
        },
      },
    }));
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    const generationBefore = harness.database.getMeta().authorityGeneration;
    shouldFail = true;
    assert.throws(() => harness.kernel.execute(command), /injected run-insert crash/);
    shouldFail = false;

    const stored = harness.database.authority.startPlans.get(plan.startPlanId);
    assert.equal(stored?.consumedBy, undefined);
    assert.equal(stored?.version, plan.version);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);


    const retried = harness.kernel.execute(command);
    assert.equal(retried.state, "applied");
  });

  it("creates zero runs when the active-run authority lookup fails", async () => {
    let shouldFail = false;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        listByItem: (input: unknown) => {
          if (shouldFail) throw new Error("injected active-run lookup failure");
          return repositories.runs.listByItem(input);
        },
      },
    }));
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    shouldFail = true;
    const generationBefore = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(startCommand(plan)), /injected active-run lookup failure/);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("conflicts on a stale confirmation revision without consuming the plan", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = { ...startCommand(plan), target: { ...startCommand(plan).target, expectedVersion: plan.version + 5 } };
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") return;
    assert.equal(result.currentVersion, plan.version);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("rejects binding drift as schema-mismatch and an expired plan as invalid-state", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const base = startCommand(plan);
    const drifted = { ...base, payload: { ...base.payload, inputFingerprint: HASH_A } };
    const driftResult = harness.kernel.execute(drifted);
    assert.equal(driftResult.state, "rejected");
    if (driftResult.state === "rejected") assert.equal(driftResult.code, "schema-mismatch");
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);

    harness.clock.advanceWall(3_600_000);
    const expired = harness.kernel.execute(startCommand(plan));
    assert.equal(expired.state, "rejected");
    if (expired.state === "rejected") {
      assert.equal(expired.code, "invalid-state");
      assert.match(expired.message, /expired/);
    }
  });

  it("refuses the whole command under reject-active when an active run appeared after planning", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    const itemId = deriveItemId("kernel-reject", "eid:10800001");
    const conflicting = {
      envelope: {
        runId: UUID_7,
        workflow: "kernel-reject",
        itemId,
        traceId: "kr-170000-7777",
        descriptorVersion: 1,
        contractFingerprint: plan.descriptorFingerprint,
        resolvedInstance: { ucpath: "prod" },
        configFingerprint: plan.configFingerprint,
        configSnapshotId: UUID_4,
        shape: "single",
        priority: "bulk",
        dryRun: false,
        attempt: 1,
        enqueuedAt: NOW,
      },
      input: {
        raw: plan.planned[1].rawInput,
        parsed: plan.planned[1].input,
        ingressSchemaHash: plan.ingressSchemaHash,
      },
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    assert.equal(harness.database.authority.runs.enqueue(conflicting).state, "inserted");

    const command = startCommand(plan);
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "policy-refused");
      assert.match(result.message, /already has an active run/);
    }

    assert.equal(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);

    assert.deepEqual(
      harness.database.authority.runs.listByWorkflow(plan.workflowId).map((run) => run.envelope.runId),
      [UUID_7],
    );
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("supersede-active terminalizes the exact active run and creates the replacement atomically", async () => {
    const harness = await createHarness();
    const first = createPlan(harness, supersedeDescriptor, ["10800000"]);
    const firstResult = harness.kernel.execute(startCommand(first));
    assert.equal(firstResult.state, "applied");
    const activeRunId = singleAppliedRunId(firstResult);

    const second = createPlan(harness, supersedeDescriptor, ["10800000"]);
    const result = harness.kernel.execute(startCommand(second));
    assert.equal(result.state, "applied");
    const replacementId = appliedRunIds(result).at(-1);
    assert.ok(replacementId !== undefined);

    const superseded = harness.database.authority.runs.get(activeRunId);
    assert.equal(superseded?.lifecycle.state, "terminal");
    if (superseded?.lifecycle.state === "terminal") {
      assert.equal(superseded.lifecycle.outcome, "superseded");
    }
    const replacement = harness.database.authority.runs.get(replacementId);
    assert.equal(replacement?.lifecycle.state, "queued");
  });

  it("allow-parallel enqueues beside an active run for the same item", async () => {
    const harness = await createHarness();
    const first = createPlan(harness, parallelDescriptor, ["10800000"]);
    const firstResult = harness.kernel.execute(startCommand(first));
    assert.equal(firstResult.state, "applied");
    const second = createPlan(harness, parallelDescriptor, ["10800000"]);
    const secondResult = harness.kernel.execute(startCommand(second));
    assert.equal(secondResult.state, "applied");
    const firstRun = harness.database.authority.runs.get(singleAppliedRunId(firstResult));
    const secondRun = harness.database.authority.runs.get(singleAppliedRunId(secondResult));
    assert.equal(firstRun?.lifecycle.state, "queued");
    assert.equal(secondRun?.lifecycle.state, "queued");
  });
});
