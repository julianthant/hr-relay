// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { emergencyContactModule, i9CheckStartModule, onboardingModule } from "../../../support/helpers/registered-workflows.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { useRunLaunch } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { ViewNavigationProvider } from "../../../../src/dashboard/app/navigation/view-navigation.js";
import { parseRoute, routeToSearch, type AppRouteState } from "../../../../src/dashboard/app/navigation/url-state.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";

const h = createRunStartDialogHarness();
let routedRoot: Root | undefined;
afterEach(async () => {
  await act(async () => { routedRoot?.unmount(); });
  routedRoot = undefined;
  await h.cleanup();
});

const workflowOf = (descriptor: AnyWorkflowDescriptor): RunStartWorkflow => ({ ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label,
  version: descriptor.version, steps: projectStartSteps(descriptor), requiredWorkbookFields: [...descriptor.requiredWorkbookFields],
  workbookReference: descriptor.workbookReference, referenceSources: [],
  ...(descriptor.surfaces.uploadRun === undefined ? {} : { uploadRun: descriptor.surfaces.uploadRun }),
  inputRun: descriptor.surfaces.inputRun === undefined ? { state: "absent", reason: "PDF input" } : { state: "present", surface: descriptor.surfaces.inputRun } });
const noCompatibility = () => {
  let catalogReads = 0;
  const client = h.stubClient({ workbookList: async () => [], workbookCatalog: async () => { catalogReads += 1; return []; },
    workbookCompatibility: async () => ({ workflows: [], libraries: [] }), workbookTypes: async () => [] });
  return { client, reads: () => catalogReads };
};
const settleAll = async () => { for (let wait = 0; wait < 6; wait += 1) await h.settle(); };

describe("Start run without a reference-spreadsheet check", () => {
  for (const module of [i9CheckStartModule, onboardingModule, emergencyContactModule]) {
    it(`opens ${module.descriptor.id} with one notice and Retry where the input would be`, async () => {
      const served = noCompatibility();
      const dialog = await h.openDialog(served.client, { workflows: [h.WORKFLOWS[0], workflowOf(module.descriptor)], panelWorkflowId: module.descriptor.id });
      await settleAll();
      const alerts = [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent ?? "");
      assert.deepEqual(alerts, ["Spreadsheets can't be checked.Retry"], dialog.text());
      assert.equal(document.querySelector('section[aria-label="Input"]') === null, true);
      assert.equal(dialog.disabled("Next"), true);
      assert.doesNotMatch(dialog.text(), /WORKBOOK_COMPATIBILITY|Page unavailable/u);
      const before = served.reads();
      await dialog.press("Retry");
      await settleAll();
      assert.ok(served.reads() > before, "Retry reads the reference spreadsheets again");
    });
  }
});

describe("closing Start run", () => {
  const cases = (["Escape", "Close"] as const).flatMap(how => (["Input", "Start"] as const).map(stage => [how, stage] as const));
  for (const [how, stage] of cases) {
    it(`leaves no launch coordinate in the URL after ${how} from ${stage}`, async () => {
      const descriptor = onboardingModule.descriptor;
      const workflows = [h.WORKFLOWS[0], workflowOf(descriptor)];
      const opened = stage === "Input" ? descriptor.id : h.WORKFLOWS[0].workflowId;
      const client = noCompatibility().client;
      let seen: AppRouteState = { start: true };
      function Launcher() {
        const launch = useRunLaunch(false, "main");
        return createElement(RunStartDialog, { open: launch.open, onOpenChange: launch.setOpen,
          catalog: buildWorkflowCatalog(workflows, servedFixtureSources(workflows)),
          panelWorkflowId: h.WORKFLOWS[0].workflowId, actorId: h.ACTOR_ID, onOpenIntake() {} });
      }
      function Harness() {
        const [route, setRoute] = useState<AppRouteState>({ start: true, view: { search: true, launchServed: opened, launchStage: "Input", launchCustomize: false } });
        seen = route;
        return createElement(ViewNavigationProvider, { route, setRoute,
          children: createElement(DashboardClientProvider, { client,
            children: createElement(ToastProvider, { children: createElement(FixtureCommandBinding, { actorId: h.ACTOR_ID,
              children: createElement(Launcher) }) }) }) });
      }
      const host = document.createElement("div"); document.body.append(host);
      routedRoot = createRoot(host);
      const root = routedRoot;
      await act(async () => root.render(createElement(Harness)));
      await settleAll();
      if (stage === "Start") {
        const box = document.querySelector("textarea"); assert.ok(box);
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, h.TYPED); box.dispatchEvent(new Event("input", { bubbles: true })); });
        const next = h.buttons().find(candidate => h.buttonName(candidate) === "Next"); assert.ok(next);
        await act(async () => next.click());
        await settleAll();
        assert.equal(seen.view?.launchStage, "Start");
      }
      if (how === "Escape") await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      else {
        const button = h.buttons().find(candidate => (how === "Close" ? h.buttonName(candidate) : (candidate.textContent ?? "").trim()) === how);
        assert.ok(button, how);
        await act(async () => button.click());
      }
      await settleAll();
      assert.equal(seen.start, false, how);
      assert.deepEqual(Object.fromEntries(Object.entries(seen.view ?? {}).filter(([, value]) => value !== undefined)), { search: true }, how);
      const search = routeToSearch(seen);
      assert.doesNotMatch(search, /launch/u, search);
      assert.deepEqual(parseRoute(search).view, { search: true });
      const reloaded = parseRoute(search);
      assert.equal(reloaded.start, false);
      assert.equal(reloaded.view?.launchStage, undefined);
    });
  }
});
