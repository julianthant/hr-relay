import { describe,expect,it } from "vitest";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { runPickerGroups } from "../../../../src/dashboard/surfaces/run-start/run-start-picker-model.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { WORKFLOW_SOURCES } from "../../../../src/dashboard/app/workflow-sources.js";

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
const catalog = buildWorkflowCatalog(served, WORKFLOW_SOURCES);
const ids = (query = "") => runPickerGroups(catalog, query).flatMap(group => group.entries.flatMap(node => [node.entry.id, ...node.members.map(child => child.entry.id)]));

describe("shared run catalog", () => {
  it("keeps a workflow that requires a workbook when its compatibility projection is missing", () => {
    const required = parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows).find(entry => entry.start.workbookReference !== undefined);
    expect(required).toBeDefined();
    expect(launchWorkflows([required!], { workflows: [], libraries: [] }).map(entry => entry.workflowId)).toEqual([String(required!.id)]);
  });
  it("keeps hidden children and removed workflows out of the picker and catalog", () => {
    const visible = ["emergency-contact", "i9-check-start", "onboarding", "person-lookup", "separations", "work-study"];
    expect(ids().sort()).toEqual(visible);
    expect(catalog.map(flow => flow.id).sort()).toEqual(visible);
    expect(ids()).not.toContain("i9-lookup"); expect(ids()).not.toContain("sharepoint-download");
    expect(ids("OCR")).toEqual([]); expect(ids("i-9")).toEqual(["i9-check-start"]);
    expect(ids("I-9 Lookup")).toEqual([]); expect(ids("SharePoint")).toEqual([]);
    expect(ids("Documents")).toEqual(["emergency-contact"]); expect(ids("Lookup")).toEqual(["person-lookup"]);
    expect(catalog.filter(flow => flow.launch.state === "unavailable").map(flow => flow.id).sort()).toEqual([]);
    expect(catalog.find(flow => flow.id === "ocr")).toBeUndefined(); expect(catalog.find(flow => flow.id === "onbase")).toBeUndefined();
  });
  it("uses served capability when served input is absent", () => {
    const absent: RunStartWorkflow = { ...served[0], inputRun: { state: "absent", reason: "Delegation only" } };
    const entries = buildWorkflowCatalog([absent], servedFixtureSources([absent]));
    expect(entries.filter(entry => entry.id === absent.workflowId)).toHaveLength(1);
    expect(entries.find(entry => entry.id === absent.workflowId)?.launch).toEqual({ state: "unavailable", label: "No direct start", reason: "This served workflow has no standalone launch input. Delegation only" });
    expect(runPickerGroups(entries, "").flatMap(group => group.entries).map(node => node.entry.id)).toContain(absent.workflowId);
    expect(buildWorkflowCatalog(served, servedFixtureSources(served)).map(entry => entry.id).sort()).toEqual(served.map(entry => entry.workflowId).sort());
  });
  it("matches categories, multiple words and served short codes", () => {
    expect(runPickerGroups(catalog, "  ONBOARDING  ").map(group => group.label)).toEqual(["Onboarding"]);
    expect(ids("work study")).toEqual(["work-study"]);
    expect(runPickerGroups(buildWorkflowCatalog([{ ...served[0], code: "zz" }], servedFixtureSources([served[0]])), "zz")[0].entries[0].entry.id).toBe(served[0].workflowId);
  });
  it("shares sidebar category order and retains subordinate proving harnesses", () => {
    expect(runPickerGroups(catalog, "").map(group => group.label)).toEqual(["Lookup", "Separations", "Onboarding", "Work-Study", "Documents"]);
    const composition: RunStartWorkflow = { ...served[0], workflowId: "test-composition", role: defineWorkflowRole({ kind: "composition" }) };
    const harness: RunStartWorkflow = { ...served[0], workflowId: "test-harness", role: defineWorkflowRole({ kind: "chunk-harness", of: "test-composition", step: composition.steps[0].key }) };
    const groups = runPickerGroups(buildWorkflowCatalog([composition, harness], servedFixtureSources([composition, harness])), "");
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].entries[0].members[0].entry.id).toBe("test-harness");
    expect(groups[0].entries[0].members[0].harness?.nested).toBe(true);
  });
});
