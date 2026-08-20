/**
 * Ref data-intake-and-edit-data §6.2/§6.3 (D166): Edit Data's field policy is structural.
 *
 * The default is read-only — a descriptor must DECLARE every correctable
 * node+field path WITH its operator-facing label (2i-C), a declared path must
 * resolve through the producing task node's own output schema (anything else
 * could never re-parse; one union arm offering it is enough, since the save
 * re-parses the whole stored output), only a READ task node's output is
 * correctable (a transaction node's output is a write proof), and only a
 * checkpoint-replayed node qualifies — an always-rerun node would discard the
 * correction. The negative controls run through the REAL descriptor factory,
 * so a dead check cannot stand in for enforcement; the activation arm pins
 * the save command in the ACTIVE partition so descriptors declaring fields
 * can never outrun the kernel arm that honours the policy.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../src/base/workflow.js";
import {
  PHASE1_ACTIVE_COMMAND_ARMS,
  PHASE1_DEFERRED_COMMAND_ARMS,
} from "../../../src/core/command-kernel.js";
import { EidSchema } from "../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import {
  EditDataPolicySchema,
  STANDARD_WORKFLOW_ACTIONS,
} from "../../../src/domain/workflow/presentation.js";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { FixtureReadReceipt } from "./helpers/descriptor-fixtures.js";

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

  it("pins the save command ACTIVE so a declared policy can never outrun its kernel arm", () => {
    assert.ok(PHASE1_ACTIVE_COMMAND_ARMS.run.includes("edit-checkpoint"));
    assert.ok(!PHASE1_DEFERRED_COMMAND_ARMS.run.includes("edit-checkpoint" as never));
  });
});
