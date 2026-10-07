import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { buildWorkflowExplorer } from "../../../../../src/backend/runs/queries/explorer.js";
import { ExplorerTimeline } from "../../../../../src/dashboard/surfaces/explorer/explorer-flow.js";
import { registeredExplorerPreview } from "../../../../../src/dashboard/surfaces/explorer/explorer-preview-model.js";
import { allFields, DEFAULT_SCENARIO } from "../../../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { buildEmergencyContactMock, buildOnboardingMock, DEFAULT_MOCK_SCENARIO, EXPLORER_MOCK_WORKFLOWS,
  mockFieldSource, updateMockScenario } from "../../../../../src/dashboard/surfaces/explorer/explorer-mock-fixtures.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { ExplorerOperationStructureWireSchema } from "../../../../../src/models/dashboard/operation-structure.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../../../support/fixtures/explorer-seams.js";

const wire = buildWorkflowExplorer(explorerQueryDeps(
  manualClock(new Date("2026-08-09T12:00:00.000Z")),
  FingerprintSchema.parse("b".repeat(64)),
));

describe("registered ExplorerTimeline adapter", () => {
  it("keeps compiled tuple order and first-use systems ahead of the groups", () => {
    const personLookup = wire.workflows.find((workflow) => workflow.id === "person-lookup");
    assert.ok(personLookup?.definitionPreview.state === "compiled");
    assert.deepEqual(personLookup.definitionPreview.groups.map((group) => group.label),
      ["Searching", "Cross Verification", "Active Status", "CRM Dates"]);
    assert.deepEqual(personLookup.definitionPreview.systemsFirstUse, ["ucpath", "crm"]);
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
    assert.throws(() => registeredExplorerPreview(workflow, { [choice.id]: "invented-target" }),
      /unknown hypothetical (condition|branch) choice/u);
  });

  it("retains the accepted fictional flows, sources, and typed path choices without registering them", () => {
    assert.deepEqual(EXPLORER_MOCK_WORKFLOWS.map((workflow) => workflow.id),
      ["fixture-separations", "fixture-onboarding", "fixture-emergency-contact"]);
    for (const registered of wire.workflows) assert.ok(!EXPLORER_MOCK_WORKFLOWS.some((mock) => mock.id === registered.id));
    const onboarding = buildOnboardingMock(DEFAULT_MOCK_SCENARIO);
    assert.deepEqual(onboarding.steps.map((step) => step.title), [
      "Open browser sessions", "Choose the hire type", "Read the CRM onboarding record", "Download attached iDocs",
      "Search for the person", "Resolve the hire identity", "Resolve the I-9 profile", "Stage the Smart HR hire",
      "Verify the staged hire", "File the hire", "Verify the hire receipt",
    ]);
    assert.deepEqual(onboarding.steps[0]?.parts[0], { kind: "sessions", systems: ["CRM", "UCPath", "I-9"] });
    assert.deepEqual(mockFieldSource("hire-name")?.reads?.[0],
      { system: "CRM", page: "UCPath Entry Sheet", field: "Legal name", step: 3, fieldId: "name" });
    const rehire = buildOnboardingMock(updateMockScenario(DEFAULT_MOCK_SCENARIO, "fixture-hire-mode", "rehire"));
    assert.deepEqual(rehire.steps[0]?.parts[0], { kind: "sessions", systems: ["CRM", "UCPath"] });
    assert.ok(JSON.stringify(rehire.steps[7]?.parts).includes("UC_CONC_HIRE"));
    const emergency = buildEmergencyContactMock(DEFAULT_MOCK_SCENARIO);
    assert.equal(emergency.steps.length, 11);
    assert.equal(emergency.path.control, "preview-fixture-contact-review");
    assert.deepEqual(mockFieldSource("contact-name")?.reads?.[0],
      { system: "OCR", page: "Emergency Contact Form", field: "Contact name", step: 2, fieldId: "contact" });
    const duplicate = buildEmergencyContactMock(updateMockScenario(DEFAULT_MOCK_SCENARIO, "fixture-existing-contact", "exact"));
    assert.deepEqual(duplicate.steps.map((step) => step.number), [1, 2, 3, 4, 5, 6, 11]);
    const held = buildEmergencyContactMock(updateMockScenario(DEFAULT_MOCK_SCENARIO, "fixture-contact-review", "pending"));
    assert.equal(held.stopAfter, 3);
    assert.throws(() => updateMockScenario(DEFAULT_MOCK_SCENARIO, "fixture-contact-review", "invented"),
      /explorer-mock-choice-invalid/u);
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

  it("uses complete declared actions and jumps only to one exact output field", () => {
    const workflow = wire.workflows.find((item) => item.nodes.some((node) => node.tasks.some((task) =>
      task.fields.some((field) => field.side === "output"))));
    assert.ok(workflow);
    const node = workflow.nodes.find((item) => item.tasks.some((task) => task.fields.some((field) => field.side === "output")));
    assert.ok(node);
    const task = node.tasks.find((item) => item.fields.some((field) => field.side === "output"));
    assert.ok(task);
    const output = task.fields.find((field) => field.side === "output");
    assert.ok(output);
    const complete = (path: string) => ExplorerOperationStructureWireSchema.parse({
      state: "declared",
      definition: {
        capability: "complete", declarationVersion: 1, snapshotVersion: 2,
        workflowId: workflow.id, definitionFingerprint: workflow.contractFingerprint,
        transforms: [], presentation: [], execution: [], contentDigest: "a".repeat(64),
        invocations: [{ id: "fixture-invocation", entryId: node.id, taskId: task.taskId, contractRole: "task",
          occurrencePath: ["once"], outcomes: [],
          bindings: [{ slot: "selected-output", value: { kind: "task-output", entryId: node.id, path } }],
          operation: { version: 1, id: "fixture-operation", system: "local", session: { kind: "local", id: "fixture-session" },
            values: [{ id: "selected-output", source: { kind: "contract-output", path } }], templates: [], transforms: [],
            actions: [{ id: "read-output", kind: "read-field", label: "Read declared output" }] },
        }],
      },
    });
    const valueId = `${node.id}:fixture-invocation:value:selected-output`;
    const one = registeredExplorerPreview({ ...workflow, operationStructure: complete(output.path) });
    const source = [...one.sources.entries()].find(([key]) => key.endsWith(`:${valueId}`))?.[1];
    assert.ok(source);
    assert.deepEqual(source.reads, [{ system: task.binding.state === "bound" && task.binding.driverSystem
      ? String(task.binding.driverSystem) : task.binding.state === "pending" ? "Implementation pending" : "Headless task",
    page: node.label, field: output.path,
    step: one.steps.find((step) => step.parts.some((part) => part.kind === "detail" && part.id === node.id))?.number,
    fieldId: `${node.id}:${task.arm}:output:${output.path}` }]);
    assert.ok(JSON.stringify(one.steps).includes("Read declared output"));
    assert.ok(JSON.stringify(one.steps).includes("Declared · no run value"));
    const missing = registeredExplorerPreview({ ...workflow, operationStructure: complete("absent.path") });
    assert.match([...missing.sources.entries()].find(([key]) => key.endsWith(`:${valueId}`))?.[1].detail ?? "",
      /No exact displayed source field exists/u);
    const ambiguous = registeredExplorerPreview({ ...workflow,
      operationStructure: complete(output.path),
      nodes: workflow.nodes.map((candidate) => candidate.id === node.id
        ? { ...candidate, tasks: candidate.tasks.map((arm) => arm === task ? { ...arm, fields: [...arm.fields, output] } : arm) }
        : candidate),
    });
    const refused = [...ambiguous.sources.entries()].find(([key]) => key.endsWith(`:${valueId}`))?.[1];
    assert.match(refused?.detail ?? "", /Multiple source fields match; no jump is available/u);
    assert.equal(refused?.reads, undefined);
  });

  it("shows declared branch and parallel joins as hypothetical control, refusing invalid cases", () => {
    const workflow = wire.workflows[0];
    assert.ok(workflow?.nodes[0] && workflow.nodes[1]);
    const [first, second] = workflow.nodes;
    assert.ok(first && second);
    const altered = { ...workflow, nodes: workflow.nodes.map((node) => node.id === first.id
      ? { ...node, shape: { kind: "branch" as const, cases: [
        { name: "approved", nodes: [second.id] }, { name: "held", nodes: [] },
      ] } }
      : node.id === second.id ? { ...node, shape: { kind: "parallel" as const, join: "all" as const,
        branches: [{ id: "left", nodes: [first.id] }, { id: "right", nodes: [second.id] }] } } : node) };
    const preview = registeredExplorerPreview(altered);
    assert.deepEqual(preview.choices.find((choice) => choice.id === `${first.id}-case`)?.options,
      [["approved", "approved"], ["held", "held"]]);
    assert.ok(JSON.stringify(preview.steps).includes(`Parallel join: all`));
    assert.ok(JSON.stringify(preview.steps).includes(`${first.id}`));
    const held = registeredExplorerPreview(altered, { [`${first.id}-case`]: "held" });
    assert.ok(JSON.stringify(held.steps).includes("Declared case held"));
    assert.deepEqual(held.steps.map((step) => step.number), preview.steps.map((step) => step.number));
    assert.throws(() => registeredExplorerPreview(altered, { [`${first.id}-case`]: "invented" }),
      /unknown hypothetical branch choice/u);
  });

  it("omits session cards for sessionless definitions and labels mixed fields by their own bound system", () => {
    const workflow = wire.workflows.find((item) => item.nodes.some((node) => node.tasks.some((task) =>
      task.binding.state === "bound" && task.fields.length > 0)));
    assert.ok(workflow && workflow.definitionPreview.state === "compiled");
    const sourceNode = workflow.nodes.find((node) => node.tasks.some((task) => task.binding.state === "bound" && task.fields.length > 0));
    const original = sourceNode?.tasks.find((task) => task.binding.state === "bound" && task.fields.length > 0);
    assert.ok(sourceNode && original && original.binding.state === "bound");
    const mixed = { ...workflow,
      definitionPreview: { ...workflow.definitionPreview, systemsFirstUse: [] },
      nodes: workflow.nodes.map((node) => node.id === sourceNode.id ? { ...node, tasks: [
        { ...original, arm: "task" as const, binding: { ...original.binding, storeKind: "browser" as const, driverSystem: "crm" as const } },
        { ...original, arm: "prepare" as const, binding: { ...original.binding, storeKind: "browser" as const, driverSystem: "ucpath" as const } },
      ] } : node),
    };
    const preview = registeredExplorerPreview(mixed);
    assert.equal(preview.steps[0]?.title, workflow.definitionPreview.groups[0]?.label);
    assert.ok(preview.steps.every((step) => !step.parts.some((part) => part.kind === "sessions")));
    const fields = preview.steps.flatMap((step) => allFields(step.parts));
    assert.ok(fields.some((field) => field.id.startsWith(`${sourceNode.id}:task:`) && field.destination?.startsWith("crm ·")));
    assert.ok(fields.some((field) => field.id.startsWith(`${sourceNode.id}:prepare:`) && field.destination?.startsWith("ucpath ·")));
    assert.ok(fields.every((field) => !field.destination?.startsWith("Local ·")));
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
