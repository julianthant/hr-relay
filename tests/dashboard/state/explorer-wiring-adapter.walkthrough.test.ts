import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { projectExplorerDefinition } from "../../../src/dashboard/state/explorer-wiring-adapter.js";
import { buildExplorerPreview, previewFieldSource } from "../../../src/dashboard/surfaces/explorer/explorer-fixture.js";
import { allFields, type PreviewScenario } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import type { FlowPart, FlowStep } from "../../../src/models/workflow/explorer-preview.js";
import { buildWorkflowMock, initialWorkflowChoices } from "../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { WorkflowExplorerPreviewSchema } from "../../../src/models/workflow/explorer-preview.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";

const wire = buildWorkflowExplorer(explorerQueryDeps(manualClock(new Date("2026-08-03T17:00:00.000Z")), FingerprintSchema.parse("d".repeat(64))));
function workflow(id: string) {
  const value = wire.workflows.find(workflow => workflow.id === id); assert.ok(value?.walkthrough);
  return value;
}
function presentation(steps: readonly FlowStep[]) {
  const parts = (items: readonly FlowPart[]): unknown[] => items.map(part => {
    if (part.kind === "form" || part.kind === "detail") { const { id: _id, parts: children, ...value } = part; return { ...value, parts: parts(children) }; }
    if (part.kind === "rows") return { kind: part.kind, fields: part.fields.map(({ id: _id, source: _source, ...field }) => field) };
    return part.kind === "sessions" ? { ...part, systems: part.systems ?? ["Kuali", "Kronos", "UCPath"] } : part;
  });
  return JSON.stringify(steps.map(step => ({ ...step, parts: parts(step.parts) })));
}

describe("registered Explorer walkthroughs", () => {
  for (const identity of ["verified", "review", "rejected"] as const) for (const pending of ["none", "some", "unknown"] as const) for (const termination of ["absent", "present", "unknown"] as const) {
    it(`matches the separation forms, actions, fields and sources: ${identity}/${pending}/${termination}`, () => {
      const scenario: PreviewScenario = { identity, pending, termination };
      const result = projectExplorerDefinition(workflow("separations"), { ...scenario }); assert.ok(result.state === "ready");
      assert.deepEqual(presentation(result.projection.steps), presentation(buildExplorerPreview(scenario)));
      assert.equal(result.projection.stopAfter, identity === "rejected" ? 15 : pending === "unknown" ? 18 : termination === "unknown" ? 19 : undefined);
      for (const step of result.projection.steps) for (const field of allFields(step.parts)) if (field.source) {
        const key = field.source === "identity-before-approval" ? "identity" : field.source;
        assert.equal(JSON.stringify(result.projection.sources.get(field.source)), JSON.stringify(previewFieldSource(key, step.number, scenario)));
      }
    });
  }
  for (const mode of ["search", "match"]) for (const crm of ["on", "off"]) for (const identifier of ["name", "eid"]) for (const dates of ["none", "requested"]) {
    it(`matches the Person Lookup path without future delegation: ${mode}/${crm}/${identifier}/${dates}`, () => {
      const selection = { mode, crm, identifier, dates };
      const result = projectExplorerDefinition(workflow("person-lookup"), selection); assert.ok(result.state === "ready");
      const expected = buildWorkflowMock("person-lookup", { ...initialWorkflowChoices("person-lookup"), ...selection, mode: mode === "search" && dates === "requested" ? "delegated" : mode }).steps
        .filter(step => !["Accept delegation", "Member fan-out", "Report back"].includes(step.title))
        .map((step, index) => ({ ...step, number: index + 1, parts: step.parts.map(part => part.kind === "mock-choice" && part.id === "workflow:mode" ? { ...part, value: mode, options: part.options.filter(([value]) => value !== "delegated") } : part) }));
      assert.deepEqual(presentation(result.projection.steps), presentation(expected));
      assert.ok(!JSON.stringify(result.projection.steps).includes("Member fan-out"));
    });
  }
  it("keeps graph coverage, pending implementations, unavailable definitions and schema validation ahead of the walkthrough", () => {
    const value = structuredClone(workflow("separations"));
    assert.ok(value.walkthrough);
    value.walkthrough.steps[1].nodes = ["unregistered-node"];
    assert.equal(projectExplorerDefinition(value).state, "refused");
    const pending = structuredClone(workflow("person-lookup"));
    pending.nodes.find(node => node.tasks.length)!.tasks[0].binding = { state: "pending", note: "Not implemented" };
    assert.equal(projectExplorerDefinition(pending).state, "refused");
    const unavailable = structuredClone(workflow("person-lookup"));
    unavailable.definitionPreview = { state: "unavailable", reason: "Definition missing" };
    assert.deepEqual(projectExplorerDefinition(unavailable), { state: "unavailable", reason: "Definition missing" });
    const invalid = structuredClone(workflow("person-lookup").walkthrough!);
    invalid.steps[0].when = { mode: ["invented"] };
    assert.equal(WorkflowExplorerPreviewSchema.safeParse(invalid).success, false);
  });
});
