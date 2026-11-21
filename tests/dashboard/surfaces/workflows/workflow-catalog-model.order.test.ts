import { describe, expect, it } from "vitest";
import { WORKFLOW_SOURCES } from "../../../../src/dashboard/app/workflow-sources.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { runPickerGroups } from "../../../../src/dashboard/surfaces/run-start/run-start-picker-model.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { workflowNavigationGroups } from "../../../../src/dashboard/surfaces/shell/workflow-rail-model.js";
import { buildWorkflowCatalog, servedLaunchWorkflows } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";

/** Every served workflow: category groups as the rail shows them (Lookup, Separations, Onboarding, Work-Study, then categories the rail does not name),
 * inside each group the order `config/dashboard-workflow-sources.json` declares. */
const LISTED_ORDER = [
  "person-lookup",
  "separations",
  "i9-check-start",
  "onboarding",
  "work-study",
  "emergency-contact",
] as const;

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
const catalog = buildWorkflowCatalog(served, WORKFLOW_SOURCES);
const flat = <T extends { entry: { id: string }; members: readonly { entry: { id: string } }[] }>(groups: readonly { entries: readonly T[] }[]) =>
  groups.flatMap(group => group.entries.flatMap(node => [node.entry.id, ...node.members.map(member => member.entry.id)]));

describe("workflow order across every list", () => {
  it("lists served workflows by rail category, then the order the sources declare, with Emergency Contact under Documents", () => {
    expect(catalog.map(entry => entry.id)).toEqual(LISTED_ORDER);
    expect(catalog.every(entry => entry.source === "served")).toBe(true);
    expect(catalog.filter(entry => entry.categoryId === "Separations").map(entry => entry.id)).toEqual(["separations", "i9-check-start"]);
    expect(Object.keys(WORKFLOW_SOURCES).filter(id => LISTED_ORDER.some(listed => listed === id))).toEqual(["separations", "onboarding", "person-lookup", "work-study", "emergency-contact", "i9-check-start"]);
  });

  it("keeps hidden workflows out of every list", () => {
    for (const id of Object.entries(WORKFLOW_SOURCES).filter(([, source]) => source === "hidden").map(([hidden]) => hidden)) {
      expect(catalog.map(entry => entry.id)).not.toContain(id);
    }
    expect(catalog.map(entry => entry.id)).not.toContain("ocr");
  });

  it("orders the rail and collapsed tiles", () => {
    expect(flat(workflowNavigationGroups(catalog))).toEqual(LISTED_ORDER);
  });

  it("orders the Start run list and its picker", () => {
    expect(servedLaunchWorkflows(catalog).map(flow => flow.workflowId)).toEqual(LISTED_ORDER);
    expect(flat(runPickerGroups(catalog, ""))).toEqual(LISTED_ORDER);
  });
});
