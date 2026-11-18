// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { ViewNavigationContext } from "../../../../src/dashboard/app/navigation/view-route-model.js";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { WorkflowExplorer } from "../../../../src/dashboard/surfaces/explorer/explorer.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_EXPLORER_WIRE } from "../../../mocks/helpers/fixture-explorer.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class ResizeObserverStub { observe() {} disconnect() {} unobserve() {} }
Reflect.set(globalThis, "ResizeObserver", ResizeObserverStub);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const versions = new Map(FIXTURE_EXPLORER_WIRE.workflows.map(workflow => [String(workflow.id), workflow.version]));
const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
const catalog = buildWorkflowCatalog(served, true).map(entry => entry.served === undefined ? entry : { ...entry, served: { ...entry.served, version: versions.get(entry.id) ?? entry.served.version } });
const client = { workflowExplorer: async () => FIXTURE_EXPLORER_WIRE } as never;

async function mount() {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(WorkflowExplorer, { catalog, client }))));
  return host;
}
const click = async (node: Element | null) => { assert.ok(node instanceof HTMLElement); await act(async () => { node.focus(); node.click(); }); };
async function openPicker(host: HTMLElement) { await click(host.querySelector('[aria-label="Explorer workflow"]')); return [...document.querySelectorAll('[role="option"]')]; }
async function choose(trigger: string, value: string) {
  await click(document.querySelector(trigger));
  await click(document.querySelector(`[role="option"][data-value="${value}"]`));
}
const titles = (host: HTMLElement) => [...host.querySelectorAll("h3")].map(title => title.textContent);

it("lists the main workflows only; sub-workflows and mock workflows are absent", async () => {
  const host = await mount();
  const options = await openPicker(host);
  const listed = options.map(option => option.textContent?.trim());
  assert.deepEqual(listed.slice(0, 1), ["Person Lookup"]);
  for (const name of ["Separations", "Onboarding", "Emergency Contact", "I-9 Check"]) assert.ok(listed.includes(name), name);
  for (const sub of ["OCR", "OCR Page", "I-9 Lookup", "Emergency Contact member", "OnBase Emergency Contact"]) assert.ok(!listed.includes(sub), sub);
  for (const mock of ["Kronos Pay Rule", "Oath Signature", "CRM Document Download"]) assert.ok(!listed.includes(mock), mock);
  assert.ok(options.every(option => option.textContent === option.textContent?.trim()), "no indented entries");
});

it("a step's starts line naming a sub-workflow shows a main workflow that starts it", async () => {
  const host = await mount();
  await choose('[aria-label="Explorer workflow"]', "onboarding");
  const start = [...host.querySelectorAll("button")].find(button => button.textContent === "I-9 Lookup");
  assert.ok(start, "the starts line names the child");
  await click(start);
  const shown = host.querySelector('[aria-label="Explorer workflow"]')?.getAttribute("data-value") ?? "";
  assert.notEqual(shown, "i9-lookup");
  assert.ok(["onboarding", "i9-check-start"].includes(shown), "a main workflow that starts it is shown");
});

it("resets options to the new workflow's defaults when the workflow changes", async () => {
  const host = await mount();
  await choose('[aria-label="Explorer workflow"]', "person-lookup");
  const trigger = host.querySelector('[aria-labelledby="option-crmCheck"]');
  const before = trigger?.getAttribute("data-value");
  await choose('[aria-labelledby="option-crmCheck"]', before === "false" ? "true" : "false");
  assert.notEqual(host.querySelector('[aria-labelledby="option-crmCheck"]')?.getAttribute("data-value"), before);
  await choose('[aria-label="Explorer workflow"]', "separations");
  await choose('[aria-label="Explorer workflow"]', "person-lookup");
  assert.equal(host.querySelector('[aria-labelledby="option-crmCheck"]')?.getAttribute("data-value"), before);
});

it("reads the explorer wire once while moving between workflows", async () => {
  let reads = 0;
  const counting = { workflowExplorer: async () => { reads += 1; return FIXTURE_EXPLORER_WIRE; } } as never;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(WorkflowExplorer, { catalog, client: counting }))));
  assert.equal(reads, 1, "mount reads once");
  await choose('[aria-label="Explorer workflow"]', "onboarding");
  await choose('[aria-label="Explorer workflow"]', "separations");
  await choose('[aria-label="Explorer workflow"]', "person-lookup");
  assert.equal(reads, 1, "a workflow switch reads nothing");
});

it("a saved choice of a sub-workflow shows the main workflow that starts it; an unknown choice shows the first", async () => {
  for (const [saved, expected] of [["ocr-page", "i9-check-start"], ["onbase", "emergency-contact"], ["not-a-workflow", "person-lookup"]] as const) {
    const navigation = { view: { explorerWorkflow: saved }, start: false, setStart() {}, update() {} };
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(createElement(ViewNavigationContext.Provider, { value: navigation }, createElement(TooltipProvider, null, createElement(WorkflowExplorer, { catalog, client })))));
    assert.equal(host.querySelector('[aria-label="Explorer workflow"]')?.getAttribute("data-value"), expected, saved);
    await act(async () => root?.unmount());
    root = undefined;
    host.remove();
  }
});
