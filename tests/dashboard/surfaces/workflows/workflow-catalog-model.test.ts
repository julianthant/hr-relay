import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import { buildWorkflowCatalog as buildWorkflowCatalog_m0 } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { act as act_m0,createElement as createElement_m0,createElement as createElement_m1 } from "react";
import { createRoot as createRoot_m0,type Root as Root_m0 } from "react-dom/client";
import { renderToStaticMarkup as renderToStaticMarkup_m1 } from "react-dom/server";
import { afterAll as afterAll_m0,afterEach as afterEach_m0,beforeAll as beforeAll_m0,describe as describe_m0,describe as describe_m1,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { PRODUCT_WORKFLOW_COMPOSITION as PRODUCT_WORKFLOW_COMPOSITION_m1,WORKFLOW_SOURCES as WORKFLOW_SOURCES_m1,workflowComposition as workflowComposition_m1,workflowSource as workflowSource_m1 } from "../../../../src/dashboard/app/workflow-sources.js";
import { explorerRecoveryWorkflow as explorerRecoveryWorkflow_m1, explorerWorkflowOptions as explorerWorkflowOptions_m1 } from "../../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { WorkflowExplorer as WorkflowExplorer_m0 } from "../../../../src/dashboard/surfaces/explorer/explorer.js";
import { launchWorkflows as launchWorkflows_m1 } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { RunWorkflowPicker as RunWorkflowPicker_m1 } from "../../../../src/dashboard/surfaces/run-start/run-start-picker.js";
import { parseWorkflows as parseWorkflows_m1 } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { WorkflowRail as WorkflowRail_m1 } from "../../../../src/dashboard/surfaces/shell/workflow-rail.js";
import { MOCK_WORKFLOW_CATALOG as MOCK_WORKFLOW_CATALOG_m1 } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { buildWorkflowCatalog as buildWorkflowCatalog_m1,servedLaunchWorkflows as servedLaunchWorkflows_m1 } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP as FIXTURE_START_PICKER_BOOTSTRAP_m1 } from "../../../parity/helpers/fixture-start.js";
import { PARITY_WORKFLOW_COMPOSITION, servedFixtureSources as servedFixtureSources_m1 } from "../../../parity/helpers/workflow-composition.js";


{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root_m0 | undefined;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const _beforeAllFixture0 = () => Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
const _afterAllFixture1 = () => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
};
const _afterEachFixture2 = async () => {
  if (root) await act_m0(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
};
async function render(): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot_m0(host);
  await act_m0(async () => root?.render(createElement_m0(WorkflowExplorer_m0, { catalog: buildWorkflowCatalog_m0([], true, previewFixtureSources([])) })));
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
  assert_m0.ok(found instanceof HTMLButtonElement, `missing button ${name}`);
  return found;
}
async function click(name: string): Promise<void> { await act_m0(async () => button(name).click()); }
async function chooseControl(label: string, value: string): Promise<void> {
  const trigger = document.querySelector(`[aria-label="${label}"]`);
  assert_m0.ok(trigger instanceof HTMLButtonElement, `missing choice ${label}`);
  await act_m0(async () => trigger.click());
  const option = document.querySelector(`[role="option"][data-value="${value}"]`);
  assert_m0.ok(option instanceof HTMLElement, `missing option ${value}`);
  await act_m0(async () => option.click());
}
async function chooseWorkflow(value: string): Promise<void> { await chooseControl("Explorer workflow", value); }

describe_m0("frontend-only Explorer mock workflows", () => {
beforeAll_m0(_beforeAllFixture0);
afterAll_m0(_afterAllFixture1);
afterEach_m0(_afterEachFixture2);

  it_m0("switches mock workflows without a client provider, resets transient details and preserves Separations", async () => {
    await render();
    assert_m0.equal(document.querySelectorAll("li[data-step-number]").length, 22);
    const workflowSelect = document.querySelector('[aria-label="Explorer workflow"]');
    assert_m0.ok(workflowSelect instanceof HTMLButtonElement);
    await act_m0(async () => workflowSelect.click());
    assert_m0.deepEqual([...document.querySelectorAll('[role="option"]')].map(option => option.textContent), buildWorkflowCatalog_m0([], true, previewFixtureSources([])).map(entry => entry.label));
    await act_m0(async () => document.querySelector<HTMLElement>('[role="option"][data-value="fixture-separations"]')?.click());
    assert_m0.equal(document.querySelector('aside[aria-label="Workflow browser"]'), null);
    for (const name of ["Expand all", "Collapse all", "Version registry", "Show action legend"]) {
      assert_m0.ok(![...document.querySelectorAll("button")].some(node => node.textContent === name || node.getAttribute("aria-label") === name));
    }
    await chooseWorkflow("fixture-onboarding");
    assert_m0.equal(document.querySelectorAll("li[data-step-number]").length, 11);
    await click("Show source for Legal name");
    assert_m0.ok(document.querySelector('[aria-label="Legal name source"]'));
    await chooseWorkflow("fixture-emergency-contact");
    assert_m0.equal(document.querySelectorAll("li[data-step-number]").length, 11);
    assert_m0.equal(document.querySelector('[aria-label="Legal name source"]'), null);
    await chooseWorkflow("fixture-separations");
    assert_m0.equal(document.querySelectorAll("li[data-step-number]").length, 22);
    assert_m0.ok(document.querySelector('[aria-label="Read result preview"]'));
  });
  it_m0("opens served Separations on the registered definition instead of the mock timeline", async () => {
    const registered = launchWorkflows_m1(parseWorkflows_m1(FIXTURE_START_PICKER_BOOTSTRAP_m1.workflows));
    const catalog = buildWorkflowCatalog_m0(registered, true, WORKFLOW_SOURCES_m1);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot_m0(host);
    await act_m0(async () => root?.render(createElement_m0(WorkflowExplorer_m0, { catalog })));
    const select = document.querySelector('[aria-label="Explorer workflow"]');
    assert_m0.ok(select instanceof HTMLButtonElement);
    assert_m0.equal(select.getAttribute("data-value"), "separations");
    assert_m0.match(document.body.textContent ?? "", /Registered workflow data is unavailable because the dashboard client is not connected/);
    assert_m0.equal(document.body.textContent?.includes("Separation filed and Kuali document verified"), false);
  });
});
}

{


const served = launchWorkflows_m1(parseWorkflows_m1(FIXTURE_START_PICKER_BOOTSTRAP_m1.workflows));
const catalog = buildWorkflowCatalog_m1(served, true, servedFixtureSources_m1([]));
const noop = () => {};

describe_m1("frontend workflow catalog", () => {
  it_m1("retains custom served bootstrap workflows in Explorer and Logs preview catalogs", () => {
    const custom = { ...served[0], workflowId: "launch-proof", label: "Launch proof" };
    const bootstrap = [...served, custom];
    const composition = PARITY_WORKFLOW_COMPOSITION(bootstrap);
    for (const policy of [composition.explorerSources, composition.logsSources]) {
      expect_m1(() => buildWorkflowCatalog_m1(bootstrap, true, policy)).not.toThrow();
      const entries = buildWorkflowCatalog_m1(bootstrap, true, policy);
      expect_m1(entries.find(entry => entry.id === custom.workflowId)).toMatchObject({ source: "served", served: custom });
      for (const id of Object.keys(WORKFLOW_SOURCES_m1)) expect_m1(policy?.[id]).toBe("mock");
      expect_m1(entries.find(entry => entry.id === "person-lookup")?.source).toBe("preview");
    }
  });
  it_m1("retains explicit mock fixtures while production selects Person Lookup and Separations served", () => {
    expect_m1(MOCK_WORKFLOW_CATALOG_m1.workflows.map(flow => flow.id).sort()).toEqual(Object.keys(WORKFLOW_SOURCES_m1).sort());
    expect_m1(Object.keys(WORKFLOW_SOURCES_m1).sort()).toEqual(catalog.map(entry => entry.id).sort());
    expect_m1(Object.entries(WORKFLOW_SOURCES_m1).filter(([, source]) => source === "served").map(([id]) => id)).toEqual(["separations", "person-lookup"]);
    const product = buildWorkflowCatalog_m1(served, true);
    expect_m1(product.find(entry => entry.id === "separations")).toMatchObject({ source: "served" });
    expect_m1(product.find(entry => entry.id === "person-lookup")).toMatchObject({ source: "served" });
    expect_m1(explorerRecoveryWorkflow_m1(product)).toBe("separations");
    expect_m1(PRODUCT_WORKFLOW_COMPOSITION_m1.sourceForRoute("separations", false)).toBe("served");
    expect_m1(PRODUCT_WORKFLOW_COMPOSITION_m1.sourceForRoute("separations", true)).toBe("served");
    expect_m1(PRODUCT_WORKFLOW_COMPOSITION_m1.sourceForRoute("onboarding", false)).toBe("mock");
    expect_m1(served.every(flow => Object.hasOwn(WORKFLOW_SOURCES_m1, flow.workflowId))).toBe(true);
    expect_m1(catalog.every(entry => entry.source === "preview" && entry.served === undefined)).toBe(true);
    expect_m1(servedLaunchWorkflows_m1(catalog)).toEqual([]);
    const changed = served.map(flow => ({ ...flow, label: "Served label", inputRun: { state: "absent" as const, reason: "Not available" } }));
    expect_m1(buildWorkflowCatalog_m1(changed, true, servedFixtureSources_m1([]))).toEqual(catalog);
    expect_m1(PRODUCT_WORKFLOW_COMPOSITION_m1.dataSources).toBeUndefined();
    expect_m1(PRODUCT_WORKFLOW_COMPOSITION_m1.sourceForRoute("person-lookup", false)).toBe("served");
    expect_m1(PRODUCT_WORKFLOW_COMPOSITION_m1.sourceForRoute("person-lookup", true)).toBe("served");
    expect_m1(() => workflowSource_m1("unknown-workflow")).toThrow("WORKFLOW_SOURCE_UNDECLARED");
    const configured = { ...WORKFLOW_SOURCES_m1, "person-lookup": "served" as const };
    expect_m1(workflowComposition_m1(configured).dataSources).toBeUndefined();
    expect_m1(workflowComposition_m1(configured).sources).toBe(configured);
    expect_m1(workflowComposition_m1(configured).sourceForRoute("person-lookup", false)).toBe("served");
    expect_m1(workflowComposition_m1(configured).sourceForRoute("person-lookup", true)).toBe("served");
    expect_m1(() => buildWorkflowCatalog_m1([], true, configured)).toThrow("WORKFLOW_SERVED_REGISTRATION_MISSING");
  });
  it_m1("uses each served declaration once, retains exact authority and admits future registrations", () => {
    const future = { ...served[0], workflowId: "new-workflow", label: "New workflow", categoryId: "Payroll", code: "NW" };
    const renamed = { ...served[0], label: "Registered name" };
    const entries = buildWorkflowCatalog_m1([renamed, served[1], future], true, servedFixtureSources_m1([renamed, served[1], future]));
    expect_m1(entries).toHaveLength(16);
    expect_m1(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    expect_m1(entries.find(entry => entry.id === renamed.workflowId)).toMatchObject({ label: "Registered name", source: "served", launch: { state: "served" }, served: renamed });
    expect_m1(entries.find(entry => entry.id === future.workflowId)).toMatchObject({ label: future.label, code: "NW", launch: { state: "served" }, served: future });
    expect_m1(servedLaunchWorkflows_m1(entries)).toContain(future);
    expect_m1(servedLaunchWorkflows_m1(entries).find(entry => entry.workflowId === renamed.workflowId)).toBe(renamed);
    expect_m1(() => buildWorkflowCatalog_m1([served[0], served[0]], true, servedFixtureSources_m1(served))).toThrow("WORKFLOW_CATALOG_DUPLICATE");
  });
  it_m1("supplies matching registration membership and labels to navigation, Run and Explorer", () => {
    const rail = renderToStaticMarkup_m1(createElement_m1(WorkflowRail_m1, { workflows: catalog, active: "", preview: null, onSelect: noop, onPreview: noop }));
    const picker = renderToStaticMarkup_m1(createElement_m1(RunWorkflowPicker_m1, { catalog, value: "", query: "", onQuery: noop, onChange: noop }));
    for (const entry of catalog) {
      expect_m1(rail).toContain(`aria-label="${entry.label}"`);
      expect_m1(picker).toContain(`aria-label="${entry.label}"`);
    }
    expect_m1(explorerWorkflowOptions_m1(catalog).map(entry => [entry.id, entry.title])).toEqual(catalog.map(entry => [`fixture-${entry.id}`, entry.label]));
    expect_m1(picker.match(/disabled=""/gu)).toHaveLength(2);
    expect_m1(picker).toContain("Started by a parent workflow.");
  });
  it_m1("admits standalone OCR and limits parent-only launches to I-9 Lookup and SharePoint Download", () => {
    expect_m1(catalog.find(entry => entry.id === "ocr")?.launch.state).toBe("preview");
    expect_m1(catalog.filter(entry => entry.launch.state === "unavailable").map(entry => entry.id).sort()).toEqual(["i9-lookup", "sharepoint-download"]);
  });
});
}
