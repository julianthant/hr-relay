import { describe, expect, it } from "vitest";
import { WORKFLOW_SOURCES } from "../../../../src/dashboard/app/workflow-sources.js";
import { explorerWorkflowOptions } from "../../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { launchWorkflows } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { runPickerGroups } from "../../../../src/dashboard/surfaces/run-start/run-start-picker-model.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { workflowNavigationGroups } from "../../../../src/dashboard/surfaces/shell/workflow-rail-model.js";
import { servedLaunchWorkflows } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-start.js";
import { buildPreviewCatalog, DESIGN_HIDDEN_WORKFLOWS } from "../../../mocks/helpers/workflow-composition.js";

/** The approved mock's order of every listed workflow: category groups as the rail shows them,
 * the mock catalog's order inside each group. Hidden workflows (I-9 Lookup, OCR, OnBase when hidden) are not listed. */
const MOCK_ORDER = [
  "person-lookup",
  "separations",
  "i9-check-start",
  "onboarding",
  "oath-signature",
  "oath-upload",
  "emergency-contact",
  "work-study",
  "kronos-pay-rule",
  "crm-doc-download",
  "onbase",
  "old-kronos-reports",
] as const;

const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
const catalog = buildPreviewCatalog(served, WORKFLOW_SOURCES);
const listed = MOCK_ORDER.filter(id => catalog.some(entry => entry.id === id));
const flat = <T extends { entry: { id: string }; members: readonly { entry: { id: string } }[] }>(groups: readonly { entries: readonly T[] }[]) =>
  groups.flatMap(group => group.entries.flatMap(node => [node.entry.id, ...node.members.map(member => member.entry.id)]));

describe("workflow order across every list", () => {
  it("serves served and mock-only workflows in the mock's order, with Oath Signature before Emergency Contact", () => {
    expect(catalog.map(entry => entry.id)).toEqual(listed);
    expect(catalog.filter(entry => entry.source === "served").length).toBeGreaterThan(0);
    expect(catalog.filter(entry => entry.source === "preview").length).toBeGreaterThan(0);
    const onboarding = catalog.filter(entry => entry.categoryId === "Onboarding").map(entry => entry.label);
    expect(onboarding).toEqual(["Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact"]);
  });

  it("keeps hidden workflows out of every list", () => {
    for (const id of DESIGN_HIDDEN_WORKFLOWS) {
      expect(catalog.map(entry => entry.id)).not.toContain(id);
    }
    expect(catalog.map(entry => entry.id)).not.toContain("ocr");
  });

  it("orders the rail and collapsed tiles", () => {
    expect(flat(workflowNavigationGroups(catalog))).toEqual(listed);
  });

  it("orders the Start run list and its picker", () => {
    const startable = servedLaunchWorkflows(catalog).map(flow => flow.workflowId);
    expect(startable).toEqual(listed.filter(id => startable.includes(id)));
    expect(flat(runPickerGroups(catalog, ""))).toEqual(listed.filter(id => {
      const entry = catalog.find(item => item.id === id);
      return entry !== undefined && (entry.source !== "preview" || entry.preview?.runnable !== false);
    }));
  });

  it("orders the Search > Workflows, Add workers and Explorer lists, which read the catalog", () => {
    const explorer = explorerWorkflowOptions(catalog).map(option => option.id.replace(/^fixture-/u, ""));
    expect(explorer).toEqual(listed);
  });
});
