// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { ViewNavigationContext } from "../../../../src/dashboard/app/navigation/view-route-model.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../parity/helpers/workflow-composition.js";
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
const [firstMode] = surface.typedInput.modes; assert.ok(firstMode);
const other: RunStartWorkflow = { ...personLookup, workflowId: "other-typed",
  inputRun: { state: "present", surface: { ...surface, typedInput: { ...surface.typedInput, initialMode: null, controls: [],
    modes: [{ ...firstMode, value: "other-mode", defaults: [] }] } } } };

describe("typed draft belongs to its workflow", () => {
  it("restored view state selecting another typed workflow never sees the default workflow's mode", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(DashboardClientProvider, { client: h.stubClient({}),
      children: createElement(ViewNavigationContext.Provider, { value: { view: { launchServed: "other-typed" }, start: true, setStart() {}, update() {} },
        children: createElement(RunStartDialog, { open: true, onOpenChange() {}, catalog: buildWorkflowCatalog([personLookup, other], false, servedFixtureSources([personLookup, other])),
          panelWorkflowId: personLookup.workflowId, actorId: h.ACTOR_ID, onApplied() {}, onOpenIntake() {} }) }) })));
    assert.equal(host.textContent?.includes("Page unavailable"), false);
  });
});
