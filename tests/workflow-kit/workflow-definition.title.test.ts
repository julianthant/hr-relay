import assert from "node:assert/strict";
import { it } from "vitest";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { ResultTitleProjectionSchema } from "../../src/models/workflow/presentation.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";

it("validates the declared result name path and narrow protected EID display permission", () => {
  assert.deepEqual(compileWorkflow(personLookupWorkflow).descriptor.titleProjection, personLookupWorkflow.titleProjection);
  for (const fieldPath of ["missing", "activeStatus", "activeStatus.details.foundInUcpath"]) {
    assert.throws(() => compileWorkflow({ ...personLookupWorkflow, titleProjection: { fieldPath, display: "person-name" } }), /result title projection/u);
  }
  assert.equal(ResultTitleProjectionSchema.safeParse({ fieldPath: "activeStatus.details.name", display: "person-name", protectedInput: "documentNumber" }).success, false);
  assert.equal(ResultTitleProjectionSchema.safeParse({ fieldPath: "activeStatus.details.name", display: "person-name", extra: true }).success, false);
});
