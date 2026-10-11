
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { afterEach as afterEach_m0,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { KualiReadSeparationDocument as KualiReadSeparationDocument_m1 } from "../../../src/models/systems/kuali/read-separation-document.js";
import { classifyEvidenceLeaf as classifyEvidenceLeaf_m0,classifyEvidenceLeaf as classifyEvidenceLeaf_m1,redactEvidenceLeaf as redactEvidenceLeaf_m1 } from "../../../src/models/trust/evidence-classification.js";
import { taskId as taskId_m1,TaskIdSchema as TaskIdSchema_m0 } from "../../../src/rules/identity/ids.js";
import { fictionalSeparationDocument as fictionalSeparationDocument_m1 } from "../../support/fixtures/plan1-separation-operation.js";


{


describe_m0("bounded transaction task recording", () => {
afterEach_m0(_afterEachFixture0);


  it_m0("declares every production probe and post-fence verifier point by its own task role", () => {
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
      const scope = { kind: "task-output" as const, taskId: TaskIdSchema_m0.parse(taskId) };
      for (const path of paths) assert_m0.doesNotThrow(() => classifyEvidenceLeaf_m0(scope, path), `${taskId}:${path}`);
    }
  });
});

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};
}

{


describe_m1("fictional separation run through production authority", () => {
  it_m1("keeps fixture outputs outside active schemas and retains classified local evidence", () => {
    assert_m1.equal(KualiReadSeparationDocument_m1.output.safeParse({ ...KualiReadSeparationDocument_m1.example, fictional: fictionalSeparationDocument_m1 }).success, false);
    const scope = { kind: "task-output" as const, taskId: taskId_m1("kuali/read-separation-document") };
    const employee = redactEvidenceLeaf_m1(scope, { path: "fictional.employee", field: "employee", value: "10800000" });
    assert_m1.ok(employee.state === "allowed" && employee.transform === "allow");
    assert_m1.equal(employee.value, "10800000");
    for (const path of ["fictional.comments", "fictional.managerComments"]) assert_m1.equal(classifyEvidenceLeaf_m1(scope, path).transform, "drop");
    assert_m1.throws(() => classifyEvidenceLeaf_m1(scope, "fictional.undeclared"), /no declared evidence classification/u);
  });
});
}
