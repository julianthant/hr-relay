import { sourceBoundHarness } from "../../support/fixtures/integration/source-bound-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_EID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { buildRerunPlan } from "../../../src/backend/runs/start/rerun.js";
import { RerunSourceSchema } from "../../../src/models/run/rerun.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import {
  PHASE1_ACTIVE_COMMAND_ARMS,
  PHASE1_DEFERRED_COMMAND_ARMS,
} from "../../../src/backend/runs/commands/command-kernel.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import {
  EditDataPolicySchema,
  STANDARD_WORKFLOW_ACTIONS,
} from "../../../src/models/workflow/presentation.js";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { FixtureReadReceipt } from "../../support/fixtures/descriptor-fixtures.js";

const PolicyInput = z.strictObject({ eid: EidSchema });
const PolicyCanonicalInput = defineCanonicalInput(
  PolicyInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }],
);

function policyDescriptorSpec(editData: unknown, replay: "checkpoint" | "always-rerun" = "checkpoint") {
  const GateResult = z.strictObject({ approved: z.boolean() });
  return {
    id: "edit-policy-fixture",
    version: 1,
    contractFingerprint: "e".repeat(64),
    code: "ep",
    label: "Edit policy fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: PolicyCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof PolicyInput>) => `eid:${input.eid}` },
    presentation: { title: (input: z.output<typeof PolicyInput>) => input.eid },
    scenarios: ["edit-policy-fixture/happy"],
    capabilities: { review: false, editData },
    flow: flow(PolicyInput)
      .step("probe", FixtureReadReceipt, {
        dependsOn: [],
        replay,
        bind: ({ input }: { input: z.output<typeof PolicyInput> }) => ({ eid: input.eid }),
      })
      .gate("approve", {
        dependsOn: ["probe"],
        label: "Approve",
        resolvedBy: "operator",
        result: GateResult,
      })
      .build({
        schema: z.strictObject({ eid: EidSchema }),
        dependsOn: ["probe"],
        derive: ({ outputs }: { outputs: { probe: { eid: string } } }) => ({ eid: outputs.probe.eid }),
      }),
  } as never;
}

describe("edit data field policy", () => {
  it("accepts a declared field the producing task's output schema owns", () => {
    assert.doesNotThrow(() => defineWorkflowDescriptor(policyDescriptorSpec({
      fields: [{ nodeId: "probe", fieldPath: "eid", label: "EID" }],
    })));
  });

  it("refuses a declared field the producing schema does not own — it could never re-parse", () => {
    assert.throws(
      () => defineWorkflowDescriptor(policyDescriptorSpec({
        fields: [{ nodeId: "probe", fieldPath: "salary", label: "Salary" }],
      })),
      /editData field/u,
    );
  });

  it("refuses a field on a non-task node — a proof surface is never correctable", () => {
    assert.throws(
      () => defineWorkflowDescriptor(policyDescriptorSpec({
        fields: [{ nodeId: "approve", fieldPath: "approved", label: "Approved" }],
      })),
      /only a read task node's output is correctable/u,
    );
  });

  it("refuses a field on an always-rerun node — its correction could never be replayed", () => {
    assert.throws(
      () => defineWorkflowDescriptor(policyDescriptorSpec(
        { fields: [{ nodeId: "probe", fieldPath: "eid", label: "EID" }] },
        "always-rerun",
      )),
      /only a checkpoint-replayed node's recorded output is correctable/u,
    );
  });

  it("refuses a field declared without an operator-facing label (2i-C)", () => {
    assert.throws(
      () => defineWorkflowDescriptor(policyDescriptorSpec({
        fields: [{ nodeId: "probe", fieldPath: "eid" }],
      })),
      /label/u,
    );
  });

  it("keeps every registered descriptor's policy inside the closed schema", () => {
    for (const module of WORKFLOW_MODULES) {
      const editData = module.descriptor.capabilities?.editData;
      if (editData !== undefined) EditDataPolicySchema.parse(editData);
    }
  });

  it("keeps the retired save outside the active and deferred partitions", () => {
    assert.ok(!PHASE1_ACTIVE_COMMAND_ARMS.run.includes("edit-checkpoint" as never));
    assert.ok(!PHASE1_DEFERRED_COMMAND_ARMS.run.includes("edit-checkpoint" as never));
  });
});

describe("Rerun source and provenance boundary", () => {
  it("checks source revision, descriptor closure, node and field provenance before storing a plan", async () => {
    const h = sourceBoundHarness();
    try {
      const initial = h.start(h.proposal());
      h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
      assert.equal((await h.execute(initial)).state, "done");
      const source = h.fresh(initial);
      const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
      const request = { workflowId: h.descriptor.id, submissions: [{ eid: WRITE_FIXTURE_EID }], dryRun: false, selectedStepKeys,
        rerunSource: { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys } };
      assert.ok(h.planner.plan(request).rerun, "valid source is the positive control");
      const effects = () => ({ generation: h.database.getMeta().authorityGeneration, ids: h.lifecycleIds.minted(), roots: h.queueRoots });
      const before = structuredClone(effects());
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource, expectedVersion: source.version + 1 } }), /revision changed/);
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource,
        copiedFrom: [{ nodeId: "not-in-descriptor", fieldPath: "eid", targetFieldPath: "eid" }] } }), /descriptor output/);
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource,
        copiedFrom: [{ nodeId: "submit-write", fieldPath: "missing", targetFieldPath: "eid" }] } }), /coordinates do not resolve/);
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource,
        copiedFrom: [{ nodeId: "submit-write", fieldPath: "output.value.transactionId", targetFieldPath: "eid" }] } }), /does not match/);
      assert.deepEqual(effects(), before, "every negative control leaves authority and publication unchanged");
      const changedDescriptor = { ...h.descriptor, contractFingerprint: FingerprintSchema.parse("f".repeat(64)) };
      assert.throws(() => buildRerunPlan(h.database.authority, changedDescriptor, RerunSourceSchema.parse(request.rerunSource), []),
        /workflow runtime nodes require the exact object returned by defineWorkflowDescriptor/u);
      assert.deepEqual(h.fresh(source), source);
    } finally { h.dispose(); }
  });
});
