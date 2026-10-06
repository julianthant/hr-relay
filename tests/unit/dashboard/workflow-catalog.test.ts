import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../parity/helpers/fixture-start.js";
import { launchWorkflows } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog, servedLaunchWorkflows } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { WorkflowRail } from "../../../src/dashboard/surfaces/shell/workflow-rail.js";
import { RunWorkflowPicker } from "../../../src/dashboard/surfaces/run-start/run-start-picker.js";
import { explorerWorkflowOptions } from "../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { MOCK_FORM_TYPES } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { previewSessionAdd } from "../../../src/dashboard/surfaces/sessions/sessions-fixture.js";

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows));
const catalog = buildWorkflowCatalog(served);
const noop = () => {};

describe("frontend workflow catalog", () => {
  it("uses each served declaration once, retains exact authority and admits future registrations", () => {
    const future = { ...served[0], workflowId: "new-workflow", label: "New workflow", categoryId: "Payroll", code: "NW" };
    const renamed = { ...served[0], label: "Registered name" };
    const entries = buildWorkflowCatalog([renamed, served[1], future]);
    expect(entries).toHaveLength(16);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    expect(entries.find(entry => entry.id === renamed.workflowId)).toMatchObject({ label: "Registered name", source: "served", launch: { state: "served" }, served: renamed });
    expect(entries.find(entry => entry.id === future.workflowId)).toMatchObject({ label: future.label, code: "NW", launch: { state: "served" }, served: future });
    expect(servedLaunchWorkflows(entries)).toContain(future);
    expect(servedLaunchWorkflows(entries).find(entry => entry.workflowId === renamed.workflowId)).toBe(renamed);
    expect(() => buildWorkflowCatalog([served[0], served[0]])).toThrow("WORKFLOW_CATALOG_DUPLICATE");
  });
  it("supplies matching registration membership and labels to navigation, Run and Explorer", () => {
    const rail = renderToStaticMarkup(createElement(WorkflowRail, { workflows: catalog, active: "", preview: null, onSelect: noop, onPreview: noop }));
    const picker = renderToStaticMarkup(createElement(RunWorkflowPicker, { catalog, value: "", query: "", onQuery: noop, onChange: noop }));
    for (const entry of catalog) {
      expect(rail).toContain(`aria-label="${entry.label}"`);
      expect(picker).toContain(`aria-label="${entry.label}"`);
    }
    expect(explorerWorkflowOptions(catalog).map(entry => [entry.id, entry.title])).toEqual(catalog.map(entry => [`fixture-${entry.id}`, entry.label]));
    expect(picker.match(/disabled=""/gu)).toHaveLength(2);
    expect(picker).toContain("Started by a parent workflow.");
  });
  it("admits standalone OCR and limits parent-only launches to I-9 Lookup and SharePoint Download", () => {
    expect(catalog.find(entry => entry.id === "ocr")?.launch.state).toBe("preview");
    expect(catalog.filter(entry => entry.launch.state === "unavailable").map(entry => entry.id).sort()).toEqual(["i9-lookup", "sharepoint-download"]);
  });
  it("adds local workers for every registration without inventing a UCPath browser or a claimed run", () => {
    for (const entry of catalog) {
      const result = previewSessionAdd({ state: "ready", workers: [] }, catalog, entry.id, 2, 10);
      if (result.state !== "ready") throw new Error("ready expected");
      expect(result.workers.map(worker => worker.workflow)).toEqual([entry.label, entry.label]);
      expect(result.workers.map(worker => worker.id)).toEqual(["sample-added-10", "sample-added-11"]);
      expect(result.workers.every(worker => worker.timeline === undefined && worker.subject === undefined)).toBe(true);
      expect(result.workers[0].browsers.map(browser => browser.label)).toEqual([...new Set(entry.preview?.steps.flatMap(step => step.system ? [step.system] : []) ?? [])]);
    }
    expect(() => previewSessionAdd({ state: "ready", workers: [] }, catalog, "unregistered", 1, 10)).toThrow("sessions-preview-add-invalid");
  });
  it("lists only actual OCR document types", () => {
    expect(MOCK_FORM_TYPES.map(type => type.value)).toEqual(["oath", "emergency-contact", "onbase-emergency-contact", "i9"]);
  });
});
