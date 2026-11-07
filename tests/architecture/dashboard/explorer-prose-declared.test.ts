
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { EidSchema, FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";
import { FixtureReadReceipt } from "../../support/fixtures/descriptor-fixtures.js";

const CLOCK = manualClock(new Date("2026-08-19T00:00:00.000Z"));
const HASH = FingerprintSchema.parse("d".repeat(64));

describe("explorer prose is declared for every registered workflow", () => {
  const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));

  it("serves the descriptor's OWN summary for every registered workflow", () => {
    assert.equal(wire.workflows.length, WORKFLOW_MODULES.length);
    for (const workflow of wire.workflows) {
      assert.equal(
        workflow.summary.state,
        "authored",
        `${String(workflow.id)} serves no summary: `
        + (workflow.summary.state === "absent" ? workflow.summary.reason : ""),
      );
    }
  });

  it("serves the descriptor's OWN purpose for every node of every registered workflow", () => {
    for (const workflow of wire.workflows) {
      for (const node of workflow.nodes) {
        assert.equal(
          node.purpose.state,
          "authored",
          `${String(workflow.id)} node ${String(node.id)} serves no purpose: `
          + (node.purpose.state === "absent" ? node.purpose.reason : ""),
        );
      }
    }
  });

  it("takes each sentence from the descriptor, never from a label or a contract title", () => {
    for (const module of WORKFLOW_MODULES) {
      const workflow = wire.workflows.find((one) => String(one.id) === String(module.descriptor.id));
      assert.ok(workflow !== undefined);
      assert.deepEqual(
        workflow.summary,
        { state: "authored", text: module.descriptor.summary ?? "" },
      );
      const declared = new Map(
        module.descriptor.nodePurposes.map((entry) => [String(entry.nodeId), entry.purpose]),
      );
      // The factory already refuses a partial list; asserting coverage here is
      // what proves the PROJECTION reads all of it rather than the first few.
      assert.equal(declared.size, descriptorRuntimeNodes(module.descriptor).length);
      for (const node of workflow.nodes) {
        assert.deepEqual(
          node.purpose,
          { state: "authored", text: declared.get(String(node.id)) ?? "" },
        );
      }
    }
  });
});

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
