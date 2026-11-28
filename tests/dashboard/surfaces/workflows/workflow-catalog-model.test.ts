// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it } from "vitest";
import { PRODUCT_WORKFLOW_COMPOSITION,WORKFLOW_SOURCES,workflowComposition,workflowSource } from "../../../../src/dashboard/app/workflow-sources.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { RunWorkflowPicker } from "../../../../src/dashboard/surfaces/run-start/run-start-picker.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { WorkflowRail } from "../../../../src/dashboard/surfaces/shell/workflow-rail.js";
import { buildWorkflowCatalog,servedLaunchWorkflows } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { childWorkflowModuleOf,WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectWorkflowStartSteps } from "../../../../src/backend/runs/queries/bootstrap.js";
import { workflowDryRunSupport } from "../../../../src/workflow-kit/workflow.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../support/helpers/dashboard/mock-world/fixture-start.js";
import { servedFixtureSources } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";


const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows));
const catalog = buildWorkflowCatalog(served, WORKFLOW_SOURCES);
const noop = () => {};

describe("frontend workflow catalog", () => {
  it("offers a served saved-row Onboarding declaration unless an explicit restriction applies", () => {
    const onboarding = served.find(workflow => workflow.workflowId === "onboarding");
    assert.ok(onboarding?.inputRun.state === "present");
    expect(onboarding.inputRun.surface.workbookRows).toEqual({ typeId: "onboarding-roster", inputField: "email" });
    const sources = servedFixtureSources([onboarding]);
    const entries = buildWorkflowCatalog([onboarding], sources);
    expect(entries.find(entry => entry.id === "onboarding")?.launch).toEqual({ state: "served" });
    expect(servedLaunchWorkflows(entries)).toEqual([onboarding]);
    const reason = "Explicit start restriction";
    const restricted = buildWorkflowCatalog([onboarding], sources, [
      { feature: "workflow-start:onboarding", availability: { state: "unavailable", code: "deferred", reason } }]);
    expect(restricted.find(entry => entry.id === "onboarding")?.launch).toEqual({ state: "unavailable", label: "Unavailable", reason });
  });

  it("retains custom served bootstrap workflows in the catalog", () => {
    const custom = { ...served[0], workflowId: "launch-proof", label: "Launch proof" };
    const sources = servedFixtureSources([custom]);
    expect(() => buildWorkflowCatalog([custom], sources)).not.toThrow();
    const entries = buildWorkflowCatalog([custom], sources);
    expect(entries.map(entry => entry.id)).toEqual(["launch-proof"]);
    expect(entries.find(entry => entry.id === custom.workflowId)).toMatchObject({ source: "served", served: custom });
  });

  it("lists only the served workflows the sources policy declares and hides child workflows", () => {
    expect(Object.entries(WORKFLOW_SOURCES).filter(([, source]) => source === "served").map(([id]) => id)).toEqual(["separations", "onboarding", "person-lookup", "work-study", "emergency-contact", "i9-check-start"]);
    expect(catalog.map(entry => entry.id).sort()).toEqual(["emergency-contact", "i9-check-start", "onboarding", "person-lookup", "separations", "work-study"]);
    expect(catalog.every(entry => entry.source === "served" && entry.served !== undefined)).toBe(true);
    expect(servedLaunchWorkflows(catalog).map(flow => flow.workflowId).sort()).toEqual(catalog.map(entry => entry.id).sort());
    expect(catalog.find(entry => entry.id === "onboarding")).toMatchObject({ launch: { state: "served" } });
    expect(catalog.find(entry => entry.id === "work-study")).toMatchObject({ launch: { state: "served" } });
    expect(catalog.find(entry => entry.id === "i9-check-start")).toMatchObject({ launch: { state: "served" } });
    expect(catalog.find(entry => entry.id === "i9-lookup")).toBeUndefined();
    expect(catalog.find(entry => entry.id === "i9-check")).toBeUndefined();
    expect(catalog.find(entry => entry.id === "ocr")).toBeUndefined();
    expect(workflowSource("ocr")).toBe("hidden");
    expect(workflowSource("separations")).toBe("served");
    expect(workflowSource("onboarding")).toBe("served");
    expect(workflowSource("work-study")).toBe("served");
    expect(workflowSource("i9-check-start")).toBe("served");
    expect(workflowSource("i9-lookup")).toBe("hidden");
    expect(Object.hasOwn(WORKFLOW_SOURCES, "i9-check")).toBe(false);
    expect(served.every(flow => Object.hasOwn(WORKFLOW_SOURCES, flow.workflowId))).toBe(true);
    expect(PRODUCT_WORKFLOW_COMPOSITION.dataSources).toBeUndefined();
    expect(workflowSource("person-lookup")).toBe("served");
    expect(() => workflowSource("unknown-workflow")).toThrow("WORKFLOW_SOURCE_UNDECLARED");
    const configured = { ...WORKFLOW_SOURCES, "person-lookup": "served" as const };
    expect(workflowComposition(configured).dataSources).toBeUndefined();
    expect(workflowComposition(configured).sources).toBe(configured);
    expect(workflowSource("person-lookup", configured)).toBe("served");
    expect(buildWorkflowCatalog([], configured)).toEqual([]);
  });

  it("takes each entry's category heading from the served registry category", () => {
    const category = (id: string) => catalog.find(entry => entry.id === id)?.categoryId;
    expect(category("person-lookup")).toBe("Lookup");
    expect(category("separations")).toBe("Separations");
    expect(category("onboarding")).toBe("Onboarding");
    expect(category("work-study")).toBe("Work-Study");
    expect(category("emergency-contact")).toBe("Documents");
  });

  it("uses each served declaration once, retains exact authority and admits future registrations", () => {
    const future = { ...served[0], workflowId: "new-workflow", label: "New workflow", categoryId: "Payroll", code: "NW" };
    const renamed = { ...served[0], label: "Registered name" };
    const entries = buildWorkflowCatalog([renamed, served[1], future], servedFixtureSources([renamed, served[1], future]));
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    expect(entries.find(entry => entry.id === renamed.workflowId)).toMatchObject({ label: "Registered name", source: "served", launch: { state: "served" }, served: renamed });
    expect(entries.find(entry => entry.id === future.workflowId)).toMatchObject({ label: future.label, code: "NW", launch: { state: "served" }, served: future });
    expect(servedLaunchWorkflows(entries)).toContain(future);
    expect(servedLaunchWorkflows(entries).find(entry => entry.workflowId === renamed.workflowId)).toBe(renamed);
    expect(() => buildWorkflowCatalog([served[0], served[0]], servedFixtureSources(served))).toThrow("WORKFLOW_CATALOG_DUPLICATE");
  });

  it("supplies matching registration membership and labels to navigation, Run and Explorer", () => {
    const rail = renderToStaticMarkup(createElement(WorkflowRail, { workflows: catalog, active: "", onSelect: noop }));
    const picker = renderToStaticMarkup(createElement(RunWorkflowPicker, { catalog, value: "", query: "", onQuery: noop, onChange: noop }));
    for (const entry of catalog) {
      expect(rail).toContain(`aria-label="${entry.label}"`);
      expect(picker).toContain(`aria-label="${entry.label}"`);
    }
    expect(picker.match(/disabled=""/gu) ?? []).toHaveLength(0);
    expect(picker).not.toContain("Started by a parent workflow.");
  });

  it("keeps hidden OCR out of the catalog and limits parent-only launches to I-9 Lookup and SharePoint Download", () => {
    expect(WORKFLOW_SOURCES.ocr).toBe("hidden");
    expect(catalog.find(entry => entry.id === "ocr")).toBeUndefined();
    const hiddenOcr = { ...served[0], workflowId: "ocr", label: "OCR" };
    expect(buildWorkflowCatalog([hiddenOcr, ...served], { ...servedFixtureSources(served), ocr: "hidden" }).some(entry => entry.id === "ocr")).toBe(false);
    expect(catalog.find(entry => entry.id === "i9-lookup")).toBeUndefined();
    expect(catalog.find(entry => entry.id === "sharepoint-download")).toBeUndefined();
    expect(catalog.filter(entry => entry.launch.state === "unavailable").map(entry => entry.id).sort()).toEqual([]);
  });

  it("keeps hidden OCR and I-9 Lookup and removed SharePoint Download out of the catalog", () => {
    expect(WORKFLOW_SOURCES.ocr).toBe("hidden");
    expect(catalog.find(entry => entry.id === "ocr")).toBeUndefined();
    expect(WORKFLOW_SOURCES["i9-lookup"]).toBe("hidden");
    expect(catalog.find(entry => entry.id === "i9-lookup")).toBeUndefined();
    expect(catalog.find(entry => entry.id === "sharepoint-download")).toBeUndefined();
    const hiddenOcr = { ...served[0], workflowId: "ocr", label: "OCR" };
    expect(buildWorkflowCatalog([hiddenOcr, ...served], { ...servedFixtureSources(served), ocr: "hidden" }).some(entry => entry.id === "ocr")).toBe(false);
    expect(catalog.filter(entry => entry.launch.state === "unavailable").map(entry => entry.id).sort()).toEqual([]);
  });

  it("keeps hidden OnBase out of the catalog and Run picker while Emergency Contact members still start it", () => {
    expect(WORKFLOW_SOURCES.onbase).toBe("hidden");
    expect(catalog.find(entry => entry.id === "onbase")).toBeUndefined();
    const picker = renderToStaticMarkup(createElement(RunWorkflowPicker, { catalog, value: "", query: "", onQuery: noop, onChange: noop }));
    expect(picker).not.toContain("OnBase");
    expect(childWorkflowModuleOf("emergency-contact-member", "onbase").descriptor.id).toBe("onbase");
  });

  it("boots the product catalog from public definitions without exposing or disabling the I-9 PDF parent", () => {
    const publicStarts = WORKFLOW_MODULES.map(({ descriptor, role }) => ({
      workflowId: descriptor.id, label: descriptor.label, categoryId: descriptor.category, code: descriptor.code, role, icon: descriptor.icon,
      enqueue: descriptor.enqueue, version: descriptor.version, steps: projectWorkflowStartSteps(descriptor),
      requiredWorkbookFields: descriptor.requiredWorkbookFields, spreadsheetIntake: false,
      ...(descriptor.workbookReference === undefined ? {} : { workbookReference: descriptor.workbookReference }),
      uploadRun: descriptor.surfaces.uploadRun,
      inputRun: descriptor.surfaces.inputRun === undefined
        ? { state: "absent" as const, reason: "No typed input" }
        : { state: "present" as const, surface: descriptor.surfaces.inputRun },
    }));
    const product = buildWorkflowCatalog(publicStarts);
    const parent = product.filter(entry => entry.id === "i9-check-start");
    expect(parent).toHaveLength(1);
    expect(parent[0]).toMatchObject({ source: "served", launch: { state: "served" },
      served: { uploadRun: { pdfInput: { documentsField: "documents", asOfField: "asOf", reviewerField: "reviewerName" } },
        workbookReference: { id: "action-history" }, steps: [{ key: "documents" }, { key: "roster-reference" }, { key: "retention" }, { key: "publication" }] } });
    expect(product.filter(entry => ["i9-check", "i9-lookup", "ocr"].includes(entry.id))).toEqual([]);
    expect(childWorkflowModuleOf("i9-check-start", "i9-check").descriptor.id).toBe("i9-check");
    for (const owner of ["ocr", "onboarding"]) expect(childWorkflowModuleOf(owner, "i9-lookup").descriptor.id).toBe("i9-lookup");
    const module = WORKFLOW_MODULES.find(entry => entry.descriptor.id === "i9-check-start");
    assert.ok(module);
    expect(workflowDryRunSupport(module.descriptor)).toEqual({ state: "supported", firstPublicationNodeId: "save-workbook" });
  });

  it("uses served start refusals", () => {
    const reason = "Top-level start is unavailable until its workflow backend is implemented.";
    const restricted = buildWorkflowCatalog(served, WORKFLOW_SOURCES, [
      { feature: "workflow-start:i9-check-start", availability: { state: "unavailable", code: "deferred", reason } },
    ]);
    expect(restricted.find(entry => entry.id === "i9-check-start")?.launch).toEqual({ state: "unavailable", label: "Unavailable", reason });
    expect(restricted.find(entry => entry.id === "onboarding")?.launch).toEqual({ state: "served" });
  });
});
