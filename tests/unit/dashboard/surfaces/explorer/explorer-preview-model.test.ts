import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { buildWorkflowExplorer } from "../../../../../src/backend/runs/queries/explorer.js";
import { ExplorerTimeline } from "../../../../../src/dashboard/surfaces/explorer/explorer-flow.js";
import { registeredExplorerPreview } from "../../../../../src/dashboard/surfaces/explorer/explorer-preview-model.js";
import { allFields, DEFAULT_SCENARIO } from "../../../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../../../support/fixtures/explorer-seams.js";

const wire = buildWorkflowExplorer(explorerQueryDeps(
  manualClock(new Date("2026-08-09T12:00:00.000Z")),
  FingerprintSchema.parse("b".repeat(64)),
));

describe("registered ExplorerTimeline adapter", () => {
  it("keeps compiled tuple order and first-use systems ahead of the groups", () => {
    for (const workflow of wire.workflows) {
      assert.equal(workflow.definitionPreview.state, "compiled");
      if (workflow.definitionPreview.state !== "compiled") continue;
      const preview = registeredExplorerPreview(workflow);
      const offset = workflow.definitionPreview.systemsFirstUse.length > 0 ? 1 : 0;
      assert.deepEqual(preview.steps.slice(offset).map((step) => step.title),
        workflow.definitionPreview.groups.map((group) => group.label));
      assert.ok(JSON.stringify(preview.steps[offset]?.parts).includes(workflow.sources.descriptor.state === "resolved"
        ? workflow.sources.descriptor.path : workflow.sources.descriptor.attemptedPath));
      if (offset) {
        assert.equal(preview.steps[0]?.title, "Declared systems");
        assert.deepEqual(preview.steps[0]?.parts.find((part) => part.kind === "sessions"),
          { kind: "sessions", systems: workflow.definitionPreview.systemsFirstUse });
      }
      const bindingById = new Map(workflow.nodes.flatMap((node) => node.tasks.map((task) => [String(task.taskId), task.binding] as const)));
      const firstUse = [...new Set(workflow.definitionPreview.groups.flatMap((group) => group.entries.flatMap((entry) =>
        entry.taskIds.flatMap((id) => {
          const binding = bindingById.get(String(id));
          return binding?.state === "bound" && binding.driverSystem !== undefined ? [String(binding.driverSystem)] : [];
        }))))];
      assert.deepEqual(workflow.definitionPreview.systemsFirstUse, firstUse);
      assert.deepEqual(preview.steps.map((step) => step.number),
        preview.steps.map((_, index) => index + 1));
    }
  });

  it("addresses every displayed field to its exact stable source and withholds run values", () => {
    for (const workflow of wire.workflows) {
      const preview = registeredExplorerPreview(workflow);
      for (const step of preview.steps) for (const field of allFields(step.parts)) {
        assert.ok(preview.sources.has(`${step.number}:${field.id}`));
        assert.match(field.value, /no run value/);
        assert.equal(field.source, field.id);
        assert.ok(field.destination && !field.destination.startsWith("Local ·"));
      }
      if (workflow.operationStructure.state === "legacy") {
        assert.ok(preview.steps.some((step) => JSON.stringify(step.parts).includes("Action details unavailable")));
      }
      assert.match(preview.completion, /No workflow was run/);
    }
  });

  it("keeps a hypothetical choice local to its declaration and refuses invented branch targets", () => {
    const workflow = wire.workflows.find((item) => registeredExplorerPreview(item).choices.length > 0);
    assert.ok(workflow);
    const initial = registeredExplorerPreview(workflow);
    const choice = initial.choices[0];
    assert.ok(choice);
    assert.ok(initial.path);
    assert.equal(initial.path.control, `preview-${choice.id}`);
    const selected = choice.options.at(-1)?.[0];
    assert.ok(selected);
    const changed = registeredExplorerPreview(workflow, { [choice.id]: selected });
    assert.equal(changed.steps.length, initial.steps.length);
    assert.deepEqual(changed.sources, initial.sources);
    assert.match(changed.completion, /No workflow was run/);
  });

  it("names an unresolved contract source instead of claiming a verified file", () => {
    const workflow = wire.workflows.find((item) => item.nodes.some((node) => node.tasks.some((task) => task.fields.length > 0)));
    assert.ok(workflow);
    const nodeIndex = workflow.nodes.findIndex((node) => node.tasks.some((task) => task.fields.length > 0));
    const node = workflow.nodes[nodeIndex];
    assert.ok(node);
    const taskIndex = node.tasks.findIndex((task) => task.fields.length > 0);
    const task = node.tasks[taskIndex];
    assert.ok(task);
    const altered = { ...workflow, nodes: workflow.nodes.map((candidate, index) => index === nodeIndex
      ? { ...candidate, tasks: candidate.tasks.map((arm, armIndex) => armIndex === taskIndex
        ? { ...arm, contractSource: { state: "unresolved" as const, attemptedPath: task.contractSource.state === "resolved"
          ? task.contractSource.path : task.contractSource.attemptedPath, reason: "fixture source is absent" } } : arm) }
      : candidate) };
    const preview = registeredExplorerPreview(altered);
    const field = preview.steps.flatMap((step) => allFields(step.parts).map((one) => [step.number, one.id] as const))
      .find(([, id]) => id.startsWith(`${node.id}:${task.arm}:`));
    assert.ok(field);
    assert.match(preview.sources.get(`${field[0]}:${field[1]}`)?.detail ?? "", /Source unavailable:.*fixture source is absent/);
  });

  it("renders path control only for a declared choice and gives every source an exact DOM target", () => {
    for (const workflow of wire.workflows) {
      const preview = registeredExplorerPreview(workflow);
      const html = renderToStaticMarkup(createElement(ExplorerTimeline, {
        title: preview.title, summary: preview.summary, completion: preview.completion,
        steps: preview.steps, scenario: DEFAULT_SCENARIO, onScenario: () => {},
        sourceFor: (field, step) => preview.sources.get(`${step}:${field.id}`),
        onVersionRegistry: () => {}, workflows: [], workflowId: String(workflow.id), onWorkflow: () => {},
        path: preview.path, onMockChoice: () => {}, previewLabel: "Definition preview",
        workflowClass: "Registered workflow · hypothetical preview",
      }));
      assert.equal(html.includes("Preview paths"), preview.path !== undefined);
      if (preview.path !== undefined) assert.ok(html.includes(`id="${preview.path.control}"`));
      for (const step of preview.steps) for (const field of allFields(step.parts)) {
        assert.ok(html.includes(`id="explorer-field-${step.number}-${field.id}"`));
      }
    }
  });
});
