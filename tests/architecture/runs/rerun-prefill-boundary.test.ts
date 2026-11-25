import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import {
  PHASE1_ACTIVE_COMMAND_ARMS,
} from "../../../src/backend/runs/commands/command-arms.js";
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

  it("keeps the retired save outside the active arms", () => {
    assert.ok(!PHASE1_ACTIVE_COMMAND_ARMS.run.includes("edit-checkpoint" as never));
  });
});
