import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { ViewNavigationContext } from "../../../../src/dashboard/app/navigation/view-route-model.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = createRunStartDialogHarness();
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; await h.cleanup(); });

const descriptor = DESCRIPTORS.find(workflow => workflow.id === "person-lookup"); assert.ok(descriptor);
const surface = descriptor.surfaces.inputRun; assert.ok(surface?.typedInput);
const personLookup: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "present", surface } };
const onboardingDescriptor = DESCRIPTORS.find(workflow => workflow.id === "onboarding"); assert.ok(onboardingDescriptor);
const onboardingSurface = onboardingDescriptor.surfaces.inputRun; assert.ok(onboardingSurface?.typedInput);
const onboarding: RunStartWorkflow = { ...personLookup, workflowId: onboardingDescriptor.id, version: onboardingDescriptor.version,
  steps: projectStartSteps(onboardingDescriptor), inputRun: { state: "present", surface: onboardingSurface } };

describe("typed draft belongs to its workflow", () => {
  it("Person Lookup default with restored Onboarding selection renders Onboarding's unchosen Hire mode", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ToastProvider, { children: createElement(DashboardClientProvider, { client: h.stubClient({}),
      children: createElement(ViewNavigationContext.Provider, { value: { view: { launchServed: "onboarding" }, start: true, setStart() {}, update() {} },
        children: createElement(RunStartDialog, { open: true, onOpenChange() {}, catalog: buildWorkflowCatalog([personLookup, onboarding], false, servedFixtureSources([personLookup, onboarding])),
          panelWorkflowId: personLookup.workflowId, actorId: h.ACTOR_ID, onApplied() {}, onOpenIntake() {} }) }) }) })));
    const dialog = document.body.querySelector('[role="dialog"]'); assert.ok(dialog);
    assert.ok(dialog.textContent?.includes("Hire mode"));
    assert.equal(document.body.querySelector<HTMLInputElement>('input[type="radio"][value="new-hire"]')?.checked, false);
    assert.equal(document.body.querySelector<HTMLInputElement>('input[type="radio"][value="rehire"]')?.checked, false);
    assert.equal(document.body.textContent?.includes("Page unavailable"), false);
  });
});
