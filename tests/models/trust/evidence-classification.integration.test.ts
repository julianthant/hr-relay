import { default as assert } from "node:assert/strict";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { KualiReadSeparationDocument } from "../../../src/models/systems/kuali/read-separation-document.js";
import { classifyEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { redactEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { taskId as taskId_m1 } from "../../../src/rules/identity/ids.js";
import { TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { fictionalSeparationDocument } from "../../support/fixtures/plan1-separation-operation.js";

{

describe("bounded transaction task recording", () => {
afterEach(_afterEachFixture0);

  it("declares every production probe and post-fence verifier point by its own task role", () => {
    const roles = [
      ["ucpath/match-existing-termination", ["state", "emplId", "effectiveDate"]],
      ["ucpath/match-pending-terminations", [
        "state", "emplId", "diagnostic.state", "diagnostic.banner", "diagnostic.oldRowCount",
        "diagnostic.route", "diagnostic.iframeCount", "diagnostic.errorRegionCount",
        "diagnostic.searchVisible", "diagnostic.searchEnabled", "diagnostic.cause",
      ]],
      ["kuali/match-separation-finalization", ["state", "documentNumber", "transactionNumber"]],
      ["ucpath/verify-termination", ["state", "emplId", "effectiveDate"]],
      ["ucpath/verify-pending-terminations-cleared", ["state", "emplId"]],
      ["kuali/verify-separation-finalization", ["state", "documentNumber", "transactionNumber"]],
    ] as const;

    for (const [taskId, paths] of roles) {
      const scope = { kind: "task-output" as const, taskId: TaskIdSchema.parse(taskId) };
      for (const path of paths) assert.doesNotThrow(() => classifyEvidenceLeaf(scope, path), `${taskId}:${path}`);
    }
  });
});

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};
}

{

describe("fictional separation run through production authority", () => {
  it("keeps fixture outputs outside active schemas and retains classified local evidence", () => {
    assert.equal(KualiReadSeparationDocument.output.safeParse({ ...KualiReadSeparationDocument.example, fictional: fictionalSeparationDocument }).success, false);
    const scope = { kind: "task-output" as const, taskId: taskId_m1("kuali/read-separation-document") };
    const employee = redactEvidenceLeaf(scope, { path: "fictional.employee", field: "employee", value: "10800000" });
    assert.ok(employee.state === "allowed" && employee.transform === "allow");
    assert.equal(employee.value, "10800000");
    for (const path of ["fictional.comments", "fictional.managerComments"]) assert.equal(classifyEvidenceLeaf(scope, path).transform, "drop");
    assert.throws(() => classifyEvidenceLeaf(scope, "fictional.undeclared"), /no declared evidence classification/u);
  });
});
}
