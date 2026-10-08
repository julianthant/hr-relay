import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { servedFixtureSources } from "../../parity/helpers/workflow-composition.js";
import { describe, expect, it } from "vitest";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../parity/helpers/fixture-start.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell/shell-model.js";
import { launchWorkflows } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { buildWorkflowCatalog } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { runPickerGroups } from "../../../src/dashboard/surfaces/run-start/run-start-picker-model.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows));
const catalog = buildWorkflowCatalog(served);
const ids = (query = "") => runPickerGroups(catalog, query).flatMap(group => group.entries.flatMap(node => [node.entry.id, ...node.members.map(child => child.entry.id)]));

describe("shared run catalog", () => {
  it("keeps all registered workflows visible and marks delegated entries unavailable for direct launch", () => {
    expect(ids()).toHaveLength(15);
    expect(ids("OCR")).toEqual(["ocr"]); expect(ids("i-9")).toEqual(["i9-lookup", "i9-check"]);
    expect(catalog.filter(flow => flow.launch.state === "unavailable").map(flow => flow.id).sort()).toEqual(["i9-lookup", "sharepoint-download"]);
  });
  it("uses served capability instead of restoring a preview launch when served input is absent", () => {
    const absent: RunStartWorkflow = { ...served[0], inputRun: { state: "absent", reason: "Delegation only" } };
    const entries = buildWorkflowCatalog([absent], true, servedFixtureSources([absent]));
    expect(entries.filter(entry => entry.id === absent.workflowId)).toHaveLength(1);
    expect(entries.find(entry => entry.id === absent.workflowId)?.launch).toEqual({ state: "unavailable", label: "Unavailable", reason: "Delegation only" });
    expect(runPickerGroups(entries, "").flatMap(group => group.entries).map(node => node.entry.id)).toContain(absent.workflowId);
    expect(buildWorkflowCatalog(served, false, servedFixtureSources(served)).map(entry => entry.id).sort()).toEqual(served.map(entry => entry.workflowId).sort());
  });
  it("matches categories, multiple words and served short codes", () => {
    expect(runPickerGroups(catalog, "  ONBOARDING  ").map(group => group.label)).toEqual(["Onboarding"]);
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
