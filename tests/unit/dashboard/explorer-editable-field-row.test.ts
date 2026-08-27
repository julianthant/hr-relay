/**
 * D275 item 6, rendered — the Explorer's edit affordance sits on the FIELD ROW
 * (ledger 3 EX114).
 *
 * The claim is entirely about PLACEMENT, so no fold can make it: the pencil was
 * always in the props and always rendered, just in two chip rows below the
 * table instead of in the cell of the row it is true of. `renderToStaticMarkup`
 * is the instrument that can see the difference, the same way
 * `queue-gate-age.test.ts` sees a queue row's accessible name.
 *
 * The wire comes from the REAL projection with one node's `editableFields`
 * re-parsed onto it — no descriptor in this build allowlists a field yet, so a
 * fixture taken as-is would exercise none of this and every assertion below
 * would pass for the wrong reason.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import {
  ExplorerWorkflowWireSchema,
  type ExplorerWorkflowWire,
} from "../../../src/domain/dashboard/explorer.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";
import { NodeDetail } from "../../../src/dashboard/surfaces/explorer.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));

/** The first served node that owns at least one contract field to mark. */
function nodeWithFields(workflow: ExplorerWorkflowWire) {
  const node = workflow.nodes.find((one) => one.tasks.some((task) => task.fields.length > 0));
  if (node === undefined) throw new Error(`workflow ${String(workflow.id)} serves no contract field`);
  return node;
}

function firstWorkflow(): ExplorerWorkflowWire {
  const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, FingerprintSchema.parse("b".repeat(64))));
  const workflow = wire.workflows[0];
  if (workflow === undefined) throw new Error("the explorer projection served no workflow");
  return workflow;
}

/** Re-parse the workflow with `editableFields` set on one node. */
function withEditable(
  workflow: ExplorerWorkflowWire,
  nodeId: string,
  fields: readonly { fieldPath: string; label: string }[],
): ExplorerWorkflowWire {
  return ExplorerWorkflowWireSchema.parse({
    ...workflow,
    nodes: workflow.nodes.map((node) => (
      String(node.id) === nodeId ? { ...node, editableFields: fields } : node
    )),
  });
}

function render(workflow: ExplorerWorkflowWire, nodeId: string): string {
  const node = workflow.nodes.find((one) => String(one.id) === nodeId);
  if (node === undefined) throw new Error(`no node ${nodeId}`);
  return renderToStaticMarkup(createElement(NodeDetail, { workflow, node }));
}

describe("EX114 — the pencil marks the field's own row", () => {
  it("draws the mark inside the contract row of the path the descriptor allows", () => {
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const target = node.tasks.flatMap((task) => task.fields)[0];
    assert.notEqual(target, undefined);
    const path = String(target?.path);
    const workflow = withEditable(base, String(node.id), [{ fieldPath: path, label: "Pay rate" }]);
    const html = render(workflow, String(node.id));

    assert.equal(html.includes("correctable at a checkpoint as Pay rate"), true);
    // Placement, not presence: the mark and the path share ONE cell, so the
    // markup between them holds no table-cell boundary.
    const mark = html.indexOf("correctable at a checkpoint as Pay rate");
    const value = html.indexOf(path, mark);
    assert.ok(value > mark, "the mark must precede the path it is about");
    assert.equal(html.slice(mark, value).includes("</td>"), false, "the mark left the field's cell");
  });

  it("draws no mark on a node whose descriptor allowlists nothing", () => {
    // The negative control. A pencil rendered unconditionally would satisfy the
    // assertion above and be a mark on every field in the product.
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    assert.deepEqual(node.editableFields, []);
    assert.equal(render(base, String(node.id)).includes("correctable at a checkpoint"), false);
  });

  it("no longer draws the correctable paths a second time below the table", () => {
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const path = String(node.tasks.flatMap((task) => task.fields)[0]?.path);
    const workflow = withEditable(base, String(node.id), [{ fieldPath: path, label: "Pay rate" }]);
    const html = render(workflow, String(node.id));
    assert.equal(html.includes("Operator-correctable"), false);
    // Exactly ONE mark for one allowlisted path: the chip row and the cell
    // drawing it together is the same fact in two places that can disagree.
    assert.equal(html.split("correctable at a checkpoint").length - 1, 1);
  });

  it("refuses to swallow an allowlisted path that has no contract row", () => {
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const workflow = withEditable(base, String(node.id), [
      { fieldPath: "nowhere.in.this.contract", label: "Ghost field" },
    ]);
    const html = render(workflow, String(node.id));
    assert.equal(html.includes("An Edit Data field has no contract row on this node"), true);
    assert.equal(html.includes("nowhere.in.this.contract"), true);
    assert.equal(html.includes("Ghost field"), true);
  });
});
