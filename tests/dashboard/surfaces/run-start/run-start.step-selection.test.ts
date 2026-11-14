// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { ViewNavigationContext } from "../../../../src/dashboard/app/navigation/view-route-model.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; await h.cleanup(); });

function flow(id: string): RunStartWorkflow {
  const descriptor = DESCRIPTORS.find(entry => entry.id === id); assert.ok(descriptor?.surfaces.inputRun);
  return { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version, steps: projectStartSteps(descriptor), inputRun: { state: "present", surface: descriptor.surfaces.inputRun } };
}
const personLookup = flow("person-lookup");
const onboarding = flow("onboarding");
const defaultCount = (workflow: RunStartWorkflow) => workflow.steps.filter(step => step.includedByDefault).length;

async function open(panel: RunStartWorkflow, remembered?: RunStartWorkflow): Promise<void> {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const workflows = [personLookup, onboarding];
  const dialog = createElement(RunStartDialog, { open: true, onOpenChange() {}, catalog: buildWorkflowCatalog(workflows, false, servedFixtureSources(workflows)),
    panelWorkflowId: panel.workflowId, actorId: h.ACTOR_ID, onApplied() {}, onOpenIntake() {} });
  await act(async () => root?.render(createElement(ToastProvider, { children: createElement(DashboardClientProvider, { client: h.stubClient({}),
    children: remembered === undefined ? dialog : createElement(ViewNavigationContext.Provider, { value: { view: { launchServed: remembered.workflowId }, start: true, setStart() {}, update() {} }, children: dialog }) }) })));
}
const stepCount = (workflow: RunStartWorkflow) => `${defaultCount(workflow)} of ${workflow.steps.length} steps`;

it("counts the default steps of a workflow other than the first when it is the one opened", async () => {
  assert.notEqual(stepCount(personLookup), stepCount(onboarding));
  await open(onboarding);
  assert.ok(document.body.textContent?.includes(stepCount(onboarding)), document.body.textContent ?? "");
});

it("counts the default steps of the remembered workflow, not the panel's, when they differ", async () => {
  await open(personLookup, onboarding);
  assert.ok(document.body.textContent?.includes(stepCount(onboarding)), document.body.textContent ?? "");
});
