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
 * re-parsed onto it, so each case states the allowlist it is about instead of
 * depending on which workflow the registry happens to serve first. Some
 * descriptors DO allowlist fields — `person-lookup` names three on `crm-dates`
 * (`src/workflows/person-lookup/workflow.ts`), and the pencil draws for them
 * today — so a negative control that assumes an empty allowlist is one node
 * ordering away from passing for the wrong reason. `nodeWithNoEditableFields`
 * asserts the emptiness it needs instead.
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
import { ExplorerPresentationFields, NodeDetail } from "../../../src/dashboard/surfaces/explorer.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));

/** The first served node that owns at least one contract field to mark. */
function nodeWithFields(workflow: ExplorerWorkflowWire) {
  const node = workflow.nodes.find((one) => one.tasks.some((task) => task.fields.length > 0));
  if (node === undefined) throw new Error(`workflow ${String(workflow.id)} serves no contract field`);
  return node;
}

/**
 * A node with contract fields and an allowlist that is ASSERTED empty — the
 * negative control's precondition, not an assumption about node order.
 */
function nodeWithNoEditableFields(workflow: ExplorerWorkflowWire) {
  const node = workflow.nodes.find(
    (one) => one.editableFields.length === 0 && one.tasks.some((task) => task.fields.length > 0),
  );
  if (node === undefined) {
    throw new Error(`workflow ${String(workflow.id)} serves no node with fields and an empty Edit Data allowlist`);
  }
  return node;
}

/** The first OUTPUT field on a node — the only side an allowlisted path can be. */
function firstOutputField(node: ExplorerWorkflowWire["nodes"][number]) {
  const field = node.tasks.flatMap((task) => task.fields).find((one) => one.side === "output");
  if (field === undefined) throw new Error(`node ${String(node.id)} serves no output contract field`);
  return field;
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

/**
 * Re-parse the workflow with `path` present on the node's first task as BOTH an
 * input and an output row, input first — the collision no wire rule forbids.
 */
function withCollidingSides(
  workflow: ExplorerWorkflowWire,
  nodeId: string,
  path: string,
): ExplorerWorkflowWire {
  return withTaskFields(workflow, nodeId, (template) => [
    { ...template, path, side: "input" },
    { ...template, path, side: "output" },
  ]);
}

/** Re-parse the workflow with `path` present ONLY as an input row. */
function withInputOnlyField(
  workflow: ExplorerWorkflowWire,
  nodeId: string,
  path: string,
): ExplorerWorkflowWire {
  return withTaskFields(workflow, nodeId, (template) => [{ ...template, path, side: "input" }]);
}

function withTaskFields(
  workflow: ExplorerWorkflowWire,
  nodeId: string,
  extra: (template: ExplorerWorkflowWire["nodes"][number]["tasks"][number]["fields"][number]) => readonly unknown[],
): ExplorerWorkflowWire {
  const source = workflow.nodes.find((one) => String(one.id) === nodeId);
  if (source === undefined) throw new Error(`no node ${nodeId}`);
  const template = source.tasks.flatMap((task) => task.fields)[0];
  if (template === undefined) throw new Error(`node ${nodeId} serves no contract field to copy`);
  let injected = false;
  return ExplorerWorkflowWireSchema.parse({
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (String(node.id) !== nodeId) return node;
      return {
        ...node,
        tasks: node.tasks.map((task) => {
          if (injected || task.fields.length === 0) return task;
          injected = true;
          return { ...task, fields: [...extra(template), ...task.fields] };
        }),
      };
    }),
  });
}

function render(workflow: ExplorerWorkflowWire, nodeId: string): string {
  const node = workflow.nodes.find((one) => String(one.id) === nodeId);
  if (node === undefined) throw new Error(`no node ${nodeId}`);
  return renderToStaticMarkup(createElement(NodeDetail, { workflow, node }));
}

describe("EX114 — the pencil marks the field's own row", () => {
  it("puts the presentation edit door on its exact served field row", () => {
    const workflow = firstWorkflow();
    const html = renderToStaticMarkup(createElement(ExplorerPresentationFields, {
      workflow,
      onEdit: () => undefined,
    }));
    // D299 — the row prints the SHORT name and the door keeps the long one, so
    // each index is asserted FOUND before it is ordered. `indexOf` answering
    // -1 for a name that moved would satisfy `label < value` on its own, and
    // the whole claim here is an ordering.
    const label = html.indexOf("Label");
    const value = html.indexOf(workflow.label, label);
    const action = html.indexOf("Edit workflow label", value);
    assert.ok(label >= 0, "the field row must print its own name");
    assert.ok(value > label, "the value must follow its own label");
    assert.ok(action > value, "the action must follow its own label and value");
    assert.equal(html.slice(label, action).includes("</div>"), false, "the action escaped its owning field row");
    assert.equal(html.includes("Edit workflow icon"), true);
    assert.equal(html.includes("Edit workflow category"), true);
  });

  it("draws the mark inside the contract row of the path the descriptor allows", () => {
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const path = String(firstOutputField(node).path);
    const workflow = withEditable(base, String(node.id), [{ fieldPath: path, label: "Pay rate" }]);
    const html = render(workflow, String(node.id));

    assert.equal(html.includes("correctable at a checkpoint as Pay rate"), true);
    // Placement, not presence: the mark and the path share ONE cell, so the
    // markup between them holds no table-cell boundary.
    const mark = html.indexOf("correctable at a checkpoint as Pay rate");
    const value = html.indexOf(path, mark);
    assert.ok(value > mark, "the mark must precede the path it is about");
    assert.equal(html.slice(mark, value).includes("</li>"), false, "the mark left the field's row");
  });

  it("draws no mark on a node whose descriptor allowlists nothing", () => {
    // The negative control. A pencil rendered unconditionally would satisfy the
    // assertion above and be a mark on every field in the product.
    const base = firstWorkflow();
    const node = nodeWithNoEditableFields(base);
    assert.equal(render(base, String(node.id)).includes("correctable at a checkpoint"), false);
  });

  it("no longer draws the correctable paths a second time below the table", () => {
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const path = String(firstOutputField(node).path);
    const workflow = withEditable(base, String(node.id), [{ fieldPath: path, label: "Pay rate" }]);
    const html = render(workflow, String(node.id));
    assert.equal(html.includes("Operator-correctable"), false);
    // Exactly ONE mark for one allowlisted path: the chip row and the cell
    // drawing it together is the same fact in two places that can disagree.
    assert.equal(html.split("correctable at a checkpoint").length - 1, 1);
  });

  it("marks the OUTPUT row and never the input row that spells the same path", () => {
    // `editableFields` carries no side and the table draws one row per
    // `side:path`, so a marks map keyed by path alone pencils BOTH — telling
    // the operator they may correct a value the node read. ref
    // data-intake-and-edit-data §6.3 re-parses an edit against the producing
    // contract's OUTPUT schema, so only one of these two rows can ever be it.
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const workflow = withCollidingSides(base, String(node.id), "collides.on.both.sides");
    const withMark = withEditable(workflow, String(node.id), [
      { fieldPath: "collides.on.both.sides", label: "Pay rate" },
    ]);
    const html = render(withMark, String(node.id));

    assert.equal(html.split("correctable at a checkpoint").length - 1, 1);
    // …and it is the SECOND of the two rows — the output one — that carries it.
    // The input row is injected first, so its own occurrence of the path must
    // precede the mark, and the mark must then precede the output occurrence
    // inside one cell. A single mark landing on the input row passes the count
    // above and fails here.
    const inputRow = html.indexOf("collides.on.both.sides");
    const mark = html.indexOf("correctable at a checkpoint");
    const outputRow = html.indexOf("collides.on.both.sides", mark);
    assert.ok(inputRow < mark, "the mark landed on the input row, which is drawn first");
    assert.ok(mark < outputRow, "the mark must precede the output path it is about");
    assert.equal(html.slice(mark, outputRow).includes("</li>"), false, "the mark left the output row");
  });

  it("names an input-only allowlisted path rather than marking its read row", () => {
    // The same rule stated as an absence: a descriptor allowlisting a path that
    // exists only as an INPUT is a save the kernel's re-parse will refuse, so
    // the page says so instead of drawing a pencil that promises otherwise.
    const base = firstWorkflow();
    const node = nodeWithFields(base);
    const workflow = withInputOnlyField(base, String(node.id), "read.only.input");
    const withMark = withEditable(workflow, String(node.id), [
      { fieldPath: "read.only.input", label: "Ghost input" },
    ]);
    const html = render(withMark, String(node.id));

    assert.equal(html.includes("correctable at a checkpoint"), false);
    assert.equal(html.includes("An Edit Data field has no contract row on this node"), true);
    assert.equal(html.includes("Ghost input"), true);
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
