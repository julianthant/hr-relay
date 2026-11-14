import { describe,expect,it } from "vitest";
import { workflowPreviewGraph } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-preview-contracts.js";
describe("complete workflow presentation mocks", () => {
  it("keeps configured SharePoint and validated Time Detail output", () => {
    expect(workflowPreviewGraph("old-kronos-reports").nodes.map(node => node.id)).toEqual(["Searching", "Extracting", "Downloading"]);
    expect(workflowPreviewGraph("onboarding").summary).toContain("then stages Smart HR without Save and Submit");
  });
});
