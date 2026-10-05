import { describe, expect, it } from "vitest";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../parity/helpers/fixture-start.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell-model.js";
import { launchWorkflows } from "../../../src/dashboard/app/run-launch-model.js";
import { MOCK_WORKFLOWS } from "../../../src/dashboard/surfaces/workflow-mock-catalog.js";
import { runPickerEntries, runPickerGroups } from "../../../src/dashboard/surfaces/run-start-picker-model.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start.js";

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows));
const ids = (query = "") => runPickerGroups(runPickerEntries(served, true), query).flatMap(group => group.entries.flatMap(node => [node.entry.id, ...node.members.map(child => child.entry.id)]));

describe("direct run catalog", () => {
  it("keeps delegated workflows in the panel catalog, but excludes them from direct launch", () => {
    expect(MOCK_WORKFLOWS).toHaveLength(15);
    expect(MOCK_WORKFLOWS.filter(flow => !flow.runnable).map(flow => flow.id).sort()).toEqual(["i9-lookup", "ocr"]);
    expect(ids()).toHaveLength(13);
    expect(ids()).not.toContain("ocr"); expect(ids()).not.toContain("i9-lookup");
    expect(ids("OCR")).toEqual([]); expect(ids("i-9")).toEqual(["i9-check"]);
  });
  it("uses served launch authority instead of a duplicate preview capability", () => {
    const absent: RunStartWorkflow = { ...served[0], inputRun: { state: "absent", reason: "Delegation only" } };
    const entries = runPickerEntries([absent], true);
    expect(entries.filter(entry => entry.id === absent.workflowId)).toHaveLength(1);
    expect(runPickerGroups(entries, "").flatMap(group => group.entries).map(node => node.entry.id)).not.toContain(absent.workflowId);
    expect(runPickerEntries(served, false).map(entry => entry.id)).toEqual(served.map(entry => entry.workflowId));
  });
  it("matches category names, multiple words and served short codes", () => {
    expect(runPickerGroups(runPickerEntries(served, true), "  ONBOARDING  ").map(group => group.label)).toEqual(["Onboarding"]);
    expect(ids("oath signature")).toEqual(["oath-signature"]);
    const entry = served[0];
    expect(runPickerGroups(runPickerEntries([{ ...entry, code: "zz" }], false), "zz")[0].entries[0].entry.id).toBe(entry.workflowId);
  });
  it("shares sidebar category order and retains subordinate proving harnesses", () => {
    expect(runPickerGroups(runPickerEntries(served, true), "").map(group => group.label)).toEqual(["Search", "Separations", "Onboarding", "Work Study", "Payroll", "Utils", "OnBase", "Timekeeping"]);
    const composition = { ...served[0], workflowId: "test-composition", role: { kind: "composition" as const } };
    const harness = { ...served[0], workflowId: "test-harness", role: { kind: "chunk-harness" as const, of: "test-composition" as typeof served[number]["workflowId"] } };
    const groups = runPickerGroups(runPickerEntries([composition, harness] as readonly RunStartWorkflow[], false), "");
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].entries[0].members[0].entry.id).toBe("test-harness");
    expect(groups[0].entries[0].members[0].harness?.nested).toBe(true);
  });
});
