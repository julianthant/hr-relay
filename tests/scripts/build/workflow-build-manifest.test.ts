import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
import { declaredWorkflowId } from "../../../scripts/build/workflow-build-manifest.js";

describe("workflow definition compiler", () => {

  it("keeps definition-authored workflow ids visible to the build-manifest guard", () => {
    expect(declaredWorkflowId(resolve("src/workflows/person-lookup/workflow.ts"))).toBe("person-lookup");
    expect(declaredWorkflowId(resolve("src/workflows/separations/workflow.ts"))).toBe("separations");
  });
});
