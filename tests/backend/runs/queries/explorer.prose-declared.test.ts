import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { explorerQueryDeps, readFixtureExplorer } from "../../../support/fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-19T00:00:00.000Z"));
const HASH = FingerprintSchema.parse("d".repeat(64));

describe("explorer prose is declared for every registered workflow", () => {
  const wire = readFixtureExplorer(explorerQueryDeps(CLOCK, HASH));

  it("serves the descriptor's OWN summary for every registered workflow", () => {
    assert.equal(wire.workflows.length, READABLE_WORKFLOW_MODULES.length);
    assert.deepEqual(wire.workflows.map(workflow => workflow.id), READABLE_WORKFLOW_MODULES.map(module => module.descriptor.id));
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
    for (const module of READABLE_WORKFLOW_MODULES) {
      const workflow = wire.workflows.find((one) => String(one.id) === String(module.descriptor.id));
      assert.ok(workflow !== undefined);
      assert.deepEqual(
        workflow.summary,
        { state: "authored", text: module.descriptor.summary ?? "" },
      );
      const declared = new Map([
        ...module.descriptor.timeline.flatMap((group) => group.description === undefined ? [] : group.nodes.map((member) => [String(member.id), group.description] as const)),
        ...module.descriptor.nodePurposes.map((entry) => [String(entry.nodeId), entry.purpose] as const),
      ]);
      // Every node is described by its own purpose or its group's description;
      // full coverage proves the PROJECTION reads all of it rather than the first few.
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
