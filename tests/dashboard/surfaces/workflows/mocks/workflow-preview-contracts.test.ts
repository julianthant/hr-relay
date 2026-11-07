import { describe,expect,it } from "vitest";
import { buildWorkflowMock,initialWorkflowChoices } from "../../../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { mockRunLog,seedMockRuns } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { workflowPreviewGraph } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-preview-contracts.js";
describe("complete workflow presentation mocks", () => {
  it("keeps Work-Study's exact fields, configured SharePoint and validated Time Detail output", () => {
    const work = workflowPreviewGraph("work-study").nodes.find(node => node.id === "Transaction")!;
    expect(work.contract.map(row => row.field)).toEqual(["Effective date", "Position pool", "Change reason", "Job Data comments", "Initiator comments"]);
    expect(workflowPreviewGraph("sharepoint-download").nodes.map(node => node.id)).toEqual(["Navigate", "Download"]);
    expect(workflowPreviewGraph("old-kronos-reports").nodes.map(node => node.id)).toEqual(["Searching", "Extracting", "Downloading"]);
    expect(workflowPreviewGraph("onboarding").summary).toContain("then stages Smart HR without Save and Submit");
    const workRun = seedMockRuns().find(run => run.workflowId === "work-study")!;
    const fields = mockRunLog(workRun).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Position pool", value: "F" }), expect.objectContaining({ label: "Change reason", value: "JRL" })]));
    const workProof = buildWorkflowMock("work-study", initialWorkflowChoices("work-study")).steps.find(step => step.title === "Transaction")!.parts.filter(part => part.kind === "action").map(part => part.text).join(" ");
    expect(workProof.match(/staged form readback and submission confirmation/gu)).toHaveLength(1);
    const logProof = mockRunLog(workRun).steps.flatMap(step => step.entries).filter(entry => entry.kind === "note").map(entry => entry.message).join(" ");
    expect(logProof.match(/staged form readback and submission confirmation/gu)).toHaveLength(1);
  });
});
