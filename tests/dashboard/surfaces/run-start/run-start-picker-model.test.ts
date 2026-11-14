import { describe,expect,it } from "vitest";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { runPickerGroups } from "../../../../src/dashboard/surfaces/run-start/run-start-picker-model.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
const catalog = buildWorkflowCatalog(served, true, servedFixtureSources([]));
const ids = (query = "") => runPickerGroups(catalog, query).flatMap(group => group.entries.flatMap(node => [node.entry.id, ...node.members.map(child => child.entry.id)]));

describe("shared run catalog", () => {
  it("refuses a missing compatibility projection for a workflow that requires a workbook", () => {
    const required = parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows).find(entry => entry.start.workbookReference !== undefined);
    expect(required).toBeDefined();
    expect(() => launchWorkflows([required!], { workflows: [], libraries: [] })).toThrow(/WORKBOOK_COMPATIBILITY_UNAVAILABLE/u);
  });
  it("keeps hidden children and removed workflows out of the picker and catalog", () => {
    const visible = ["crm-doc-download", "emergency-contact", "i9-check-start", "kronos-pay-rule", "oath-signature", "oath-upload", "old-kronos-reports", "onbase", "onboarding", "person-lookup", "separations", "work-study"];
    expect(ids().sort()).toEqual(visible);
    expect(catalog.map(flow => flow.id).sort()).toEqual(visible);
    expect(ids()).not.toContain("i9-lookup"); expect(ids()).not.toContain("sharepoint-download");
    expect(ids("OCR")).toEqual([]); expect(ids("i-9")).toEqual(["i9-check-start"]);
    expect(ids("I-9 Lookup")).toEqual([]); expect(ids("SharePoint")).toEqual([]);
    expect(ids("Onboarding Documents")).toEqual(["crm-doc-download"]); expect(ids("Search")).toEqual(["person-lookup"]);
    expect(catalog.filter(flow => flow.launch.state === "unavailable").map(flow => flow.id).sort()).toEqual([]);
    expect(catalog.find(flow => flow.id === "ocr")).toBeUndefined();
  });
  it("uses served capability instead of restoring a preview launch when served input is absent", () => {
    const absent: RunStartWorkflow = { ...served[0], inputRun: { state: "absent", reason: "Delegation only" } };
    const entries = buildWorkflowCatalog([absent], true, servedFixtureSources([absent]));
    expect(entries.filter(entry => entry.id === absent.workflowId)).toHaveLength(1);
    expect(entries.find(entry => entry.id === absent.workflowId)?.launch).toEqual({ state: "unavailable", label: "No direct start", reason: "This served workflow has no standalone launch input. Delegation only" });
    expect(runPickerGroups(entries, "").flatMap(group => group.entries).map(node => node.entry.id)).toContain(absent.workflowId);
    expect(buildWorkflowCatalog(served, false, servedFixtureSources(served)).map(entry => entry.id).sort()).toEqual(served.map(entry => entry.workflowId).sort());
  });
  it("matches categories, multiple words and served short codes", () => {
    expect(runPickerGroups(catalog, "  ONBOARDING  ").map(group => group.label)).toEqual(["Onboarding", "Utils"]);
    expect(ids("oath signature")).toEqual(["oath-signature"]);
    expect(runPickerGroups(buildWorkflowCatalog([{ ...served[0], code: "zz" }], false, servedFixtureSources([served[0]])), "zz")[0].entries[0].entry.id).toBe(served[0].workflowId);
  });
  it("shares sidebar category order and retains subordinate proving harnesses", () => {
    expect(runPickerGroups(catalog, "").map(group => group.label)).toEqual(["Search", "Separations", "Onboarding", "Work Study", "Payroll", "Utils", "OnBase", "Timekeeping"]);
    const composition: RunStartWorkflow = { ...served[0], workflowId: "test-composition", role: defineWorkflowRole({ kind: "composition" }) };
    const harness: RunStartWorkflow = { ...served[0], workflowId: "test-harness", role: defineWorkflowRole({ kind: "chunk-harness", of: "test-composition", step: composition.steps[0].key }) };
    const groups = runPickerGroups(buildWorkflowCatalog([composition, harness], false, servedFixtureSources([composition, harness])), "");
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].entries[0].members[0].entry.id).toBe("test-harness");
    expect(groups[0].entries[0].members[0].harness?.nested).toBe(true);
  });
});
