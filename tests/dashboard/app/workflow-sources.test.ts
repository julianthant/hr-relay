import { describe, expect, it } from "vitest";
import { PRODUCT_WORKFLOW_COMPOSITION, WORKFLOW_SOURCES, workflowSource } from "../../../src/dashboard/app/workflow-sources.js";

const RETIRED = ["kronos-pay-rule", "oath-signature", "oath-upload", "old-kronos-reports"];

describe("the product workflow sources", () => {
  it("declare every workflow served or hidden, and none of the retired mock workflows", () => {
    expect(new Set(Object.values(WORKFLOW_SOURCES))).toEqual(new Set(["served", "hidden"]));
    for (const id of RETIRED) expect(() => workflowSource(id)).toThrow("WORKFLOW_SOURCE_UNDECLARED");
  });

  it("keeps CRM Document Download, which the backend registers, hidden until it is ready", () => {
    expect(workflowSource("crm-doc-download")).toBe("hidden");
  });

  it("serve every surface from the server", () => {
    expect(PRODUCT_WORKFLOW_COMPOSITION).toMatchObject({ inbox: "served", search: "served" });
    expect(PRODUCT_WORKFLOW_COMPOSITION.sessionsHarness).toBeUndefined();
    expect(PRODUCT_WORKFLOW_COMPOSITION.useActivityReport).toBeUndefined();
  });
});
