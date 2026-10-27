import { join } from "node:path";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { UcpathReadJobSummary } from "../../../../src/models/systems/ucpath/read-job-summary.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { FactProvenanceSchema } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, DESCRIPTOR_SET, createHarness, nextCommandId, _createPlan, startCommand } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const externalGateInputSchema = z.strictObject({ token: z.string().min(1) });
const externalGateCanonicalInput = defineCanonicalInput(
  externalGateInputSchema,
  externalGateInputSchema,
  [{ token: "external-gate-fixture" }],
);
const externalGateResultSchema = z.strictObject({ authorized: z.boolean() });
const externalGateFlow = flow(externalGateInputSchema)
  .gate("approval", {
    dependsOn: [],
    label: "External Approval",
    resolvedBy: "external",
    subscribes: {
      kind: "external",
      sourceId: "fixture-approval-source",
      event: z.strictObject({ approved: z.boolean() }),
      correlationKey: "runId",
    },
    result: externalGateResultSchema,
    resolve: () => ({ authorized: true }),
  })
  .build({
    schema: externalGateResultSchema,
    dependsOn: ["approval"],
    derive: ({ outputs }) => outputs.approval,
  });
const externalGateDescriptor = defineWorkflowDescriptor({
  id: "kernel-external-gate",
  version: 1,
  contractFingerprint: FingerprintSchema.parse("e".repeat(64)),
  code: "keg",
  label: "External Gate Fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: externalGateCanonicalInput,
  inputSubject: () => "none",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `external-gate:${input.token}` },
  presentation: { title: (input) => `External gate ${input.token}` },
  scenarios: ["command-kernel/external-gate"],
  flow: {
    ...externalGateFlow,
  },
});

const finiteGateInputSchema = z.strictObject({ emplId: EidSchema });
const finiteGateCanonicalInput = defineCanonicalInput(
  finiteGateInputSchema,
  finiteGateInputSchema,
  [{ emplId: "10873698" }],
);
const finiteGateFlow = flow(finiteGateInputSchema)
  .step("job-summary", UcpathReadJobSummary, {
    dependsOn: [],
    replay: "always-rerun",
    bind: ({ input }) => ({ emplId: input.emplId }),
  })
  .gate("approval", {
    dependsOn: ["job-summary"],
    label: "Finite Freshness Approval",
    resolvedBy: "operator",
    result: externalGateResultSchema,
  })
  .build({
    schema: externalGateResultSchema,
    dependsOn: ["approval"],
    derive: ({ outputs }) => externalGateResultSchema.parse(outputs.approval),
  });
const finiteGateDescriptor = defineWorkflowDescriptor({
  id: "kernel-finite-gate",
  version: 1,
  contractFingerprint: FingerprintSchema.parse("f".repeat(64)),
  code: "kfg",
  label: "Finite Gate Fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: finiteGateCanonicalInput,
  inputSubject: () => "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `eid:${input.emplId}` },
  presentation: { title: (input) => `Finite gate ${input.emplId}` },
  scenarios: ["command-kernel/finite-gate"],
  flow: { ...finiteGateFlow },
});



describe("gate resolution", () => {

  function gateCommand(runId: string, expectedVersion: number, result: unknown, gateId = "identity-approval") {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
      target: { runId, gateId, expectedVersion },
      payload: { result },
    };
  }

  function assertGateRefusalHasNoMutation(
    harness: Harness,
    runId: string,
    command: ReturnType<typeof gateCommand>,
    expectedCode: "invalid-state" | "schema-mismatch",
  ) {
    const beforeRun = harness.database.authority.runs.get(runId);
    const beforeEvents = harness.database.authority.timelineEvents.page({});
    const beforeGeneration = harness.database.getMeta().authorityGeneration;
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, expectedCode);
    assert.deepEqual(harness.database.authority.runs.get(runId), beforeRun);
    assert.equal(harness.database.authority.gateResults.get(`${runId}:${command.target.gateId}`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, beforeGeneration);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), beforeEvents);
    return result;
  }

  it("refuses a stale direct gate dependency under its finite declared freshness bound", async () => {
    const harness = await createHarness(undefined, { descriptors: [...DESCRIPTOR_SET, finiteGateDescriptor] });
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: finiteGateDescriptor,
        submissions: [{ emplId: "10873698" }],
        dryRun: false,
        priority: "bulk",
        shape: "single",
        configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
    assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);
    const { workerId, workerLifetime } = testAdmittedWorker(harness.database, harness.clock, {
      path: join(harness.stateRoot, "kernel.sqlite"), workflow: finiteGateDescriptor.id, poolIndex: 1, browserSystems: ["ucpath"],
    });
    const claimed = harness.database.authority.runs.claimNext({
      workflow: String(finiteGateDescriptor.id), workerId, workerLifetime, now: NOW,
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("finite-gate fixture was not claimed");

    const task = descriptorRuntimeNodes(finiteGateDescriptor)
      .find((node) => node.kind === "task" && String(node.id) === "job-summary");
    assert.ok(task?.kind === "task");
    const observedAt = new Date(Date.parse(NOW) - 4 * 60 * 60 * 1000 - 1).toISOString();
    const output = UcpathReadJobSummary.output.parse({ ...UcpathReadJobSummary.example, observedAt });
    const inserted = harness.database.authority.runCheckpoints.insert({
      workflowId: finiteGateDescriptor.id,
      itemId: claimed.run.envelope.itemId,
      nodeId: "job-summary",
      attempt: claimed.run.envelope.attempt,
      claimGeneration: claimed.run.claimGeneration,
      runId,
      output: { schemaHash: deriveSchemaHash(task.uses.output, "output"), value: output },
      descriptorVersion: finiteGateDescriptor.version,
      contractFingerprint: finiteGateDescriptor.contractFingerprint,
      implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, task.uses.id),
      provenance: [FactProvenanceSchema.parse({
        path: "observedAt",
        source: "live",
        observedAt,
        originalObservedAt: observedAt,
      })],
      writtenAt: NOW,
    });
    assert.equal(inserted.state, "inserted");

    const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      const transitioned = harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim,
        lifecycle: { state, workerId: claim.workerId, workerLifetime, claimedAt: NOW, heartbeatAt: NOW }, now: NOW,
      });
      assert.equal(transitioned.state, "applied");
      if (transitioned.state !== "applied") throw new Error("finite-gate run transition was refused");
      version = transitioned.run.version;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "approval" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("finite gate was not parked");

    const gate = descriptorRuntimeNodes(finiteGateDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "approval");
    assert.ok(gate?.kind === "gate");
    const refusal = assertGateRefusalHasNoMutation(harness, runId, gateCommand(
      runId,
      parked.run.version,
      { schemaHash: deriveSchemaHash(gate.result, "output"), value: { authorized: true } },
      "approval",
    ), "invalid-state");
    if (refusal.state === "rejected") {
      assert.match(refusal.message, /expired .*4 hours|expired .*14400000ms/u);
    }
  });

  it("refuses an operator resolution for a gate owned by its registered external source", async () => {
    const harness = await createHarness(undefined, { descriptors: [...DESCRIPTOR_SET, externalGateDescriptor] });
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: externalGateDescriptor,
        submissions: [{ token: "operator-test" }],
        dryRun: false,
        priority: "bulk",
        shape: "single",
        configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
    assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);
    const { workerId, workerLifetime } = testAdmittedWorker(harness.database, harness.clock, {
      path: join(harness.stateRoot, "kernel.sqlite"), workflow: externalGateDescriptor.id, poolIndex: 1, browserSystems: ["ucpath"],
    });
    const claimResult = harness.database.authority.runs.claimNext({
      workflow: String(externalGateDescriptor.id), workerId, workerLifetime, now: NOW,
    });
    assert.equal(claimResult.state, "claimed");
    if (claimResult.state !== "claimed") throw new Error("external-gate fixture was not claimed");
    const claim = { workerId, claimGeneration: claimResult.run.claimGeneration };
    let version = claimResult.run.version;
    for (const state of ["validating", "running"] as const) {
      const transitioned = harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, workerId: claim.workerId, workerLifetime,
          claimedAt: NOW, heartbeatAt: NOW }, now: NOW,
      });
      assert.equal(transitioned.state, "applied");
      if (transitioned.state !== "applied") throw new Error("external-gate run transition was refused");
      version = transitioned.run.version;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "approval" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("external gate was not parked");
    const gate = descriptorRuntimeNodes(externalGateDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "approval");
    assert.ok(gate?.kind === "gate");
    const command = gateCommand(runId, parked.run.version, {
      schemaHash: deriveSchemaHash(gate.result, "output"),
      value: { approved: true },
    }, "approval");
    const beforeEvents = harness.database.authority.timelineEvents.page({});
    const beforeGeneration = harness.database.getMeta().authorityGeneration;
    const refusal = harness.kernel.execute(command);
    assert.equal(refusal.state, "rejected");
    if (refusal.state === "rejected") {
      assert.equal(refusal.code, "invalid-state");
      assert.match(refusal.message, /only its registered source may settle it/);
    }
    assert.equal(harness.database.authority.gateResults.get(`${runId}:approval`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.runs.get(runId)?.lifecycle.state, "parked-gate");
    assert.equal(harness.database.getMeta().authorityGeneration, beforeGeneration);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), beforeEvents);
  });
});
