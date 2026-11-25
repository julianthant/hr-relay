import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { EidSchema, FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { FixtureReadReceipt } from "../../support/fixtures/descriptor-fixtures.js";

/* ── the negative controls, through the real entry points ────────────────── */

const Input = z.strictObject({ eid: EidSchema });
const CanonicalInput = defineCanonicalInput(
  Input,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }, { eid: "10800001" }],
);

function fixtureWith(nodePurposes?: readonly Readonly<{ nodeId: string; purpose: string }>[]) {
  return () => defineWorkflowDescriptor({
    id: "prose-fixture",
    version: 1,
    contractFingerprint: FingerprintSchema.parse("b".repeat(64)),
    code: "pr",
    label: "Prose Fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: CanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` },
    presentation: { title: (input) => `Fixture ${input.eid}` },
    scenarios: ["ucpath/person-org-happy"],
    ...(nodePurposes === undefined ? {} : { nodePurposes }),
    flow: flow(Input)
      .step("first", FixtureReadReceipt, {
        dependsOn: [],
        replay: "checkpoint",
        bind: ({ input }) => ({ eid: input.eid }),
      })
      .step("second", FixtureReadReceipt, {
        dependsOn: ["first"],
        replay: "checkpoint",
        bind: ({ input }) => ({ eid: input.eid }),
      })
      .build({
        schema: z.strictObject({ present: z.boolean() }),
        dependsOn: ["first"],
        derive: ({ outputs }) => ({ present: outputs.first.present }),
      }),
  });
}

describe("the declaration itself is exhaustive or absent, never partial", () => {
  it("REFUSES a node-purpose list that does not cover every node", () => {
    assert.throws(
      fixtureWith([{ nodeId: "first", purpose: "reads the receipt" }]),
      /a declared node-purpose list is exhaustive and this one does not cover: second/u,
    );
  });

  it("REFUSES a purpose naming a node the graph does not carry, and a node named twice", () => {
    assert.throws(
      fixtureWith([
        { nodeId: "first", purpose: "reads the receipt" },
        { nodeId: "third", purpose: "does not exist" },
      ]),
      /node purpose names undeclared node third/u,
    );
    assert.throws(
      fixtureWith([
        { nodeId: "first", purpose: "reads the receipt" },
        { nodeId: "first", purpose: "reads it again" },
      ]),
      /node purposes name node first twice/u,
    );
  });

  it("accepts a descriptor that declares nothing — the arm this guard makes unreachable", () => {
    const descriptor = fixtureWith()();
    assert.deepEqual(descriptor.nodePurposes, []);
    assert.equal(descriptor.summary, undefined);
  });
});
