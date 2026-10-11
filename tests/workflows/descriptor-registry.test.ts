
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { STEP_PROOF_DESCRIPTORS as STEP_PROOF_DESCRIPTORS_m1 } from "../../src/backend/app/registries/step-proof-modules.js";
import { SERVER_REGISTRY as SERVER_REGISTRY_m1,WORKFLOW_MODULES as WORKFLOW_MODULES_m1,workflowModuleOf as workflowModuleOf_m1 } from "../../src/backend/app/registries/workflow-registry.js";
import { WORKFLOW_DESCRIPTORS as WORKFLOW_DESCRIPTORS_m0,WORKFLOW_DESCRIPTORS as WORKFLOW_DESCRIPTORS_m1 } from "../../src/workflows/descriptor-registry.js";


{


describe_m0("the declared active-run policy, as the modal states it", () => {

  it_m0("no registered workflow declares supersede-active", () => {

    assert_m0.deepEqual(
      WORKFLOW_DESCRIPTORS_m0.filter((descriptor) => descriptor.enqueue === "supersede-active").map((d) => d.id),
      [],
    );
  });
});

describe_m0("the descriptor prose the modal draws", () => {
  it_m0("finds a summary on every registered workflow, and treats absence as legal anyway", () => {

    for (const descriptor of WORKFLOW_DESCRIPTORS_m0) {
      assert_m0.equal(typeof descriptor.summary, "string", `${descriptor.id} declares no summary`);
      assert_m0.ok((descriptor.summary ?? "").trim().length > 0);
    }
  });

  it_m0("has exactly one start method kind, which is why no method tabs are drawn", () => {

    assert_m0.deepEqual(
      WORKFLOW_DESCRIPTORS_m0.filter((descriptor) => descriptor.surfaces.uploadRun !== undefined).map((d) => d.id),
      [],
    );
  });
});
}

{



describe_m1("workflow descriptor registry", () => {
  it_m1("registers only operator workflows", () => {
    expect_m1(WORKFLOW_DESCRIPTORS_m1.map(({ id }) => String(id))).toEqual([
      "person-lookup",
      "separations",
    ]);
    expect_m1(WORKFLOW_MODULES_m1.map(({ descriptor }) => String(descriptor.id))).toEqual([
      "person-lookup",
      "separations",
    ]);
    expect_m1(Object.keys(SERVER_REGISTRY_m1)).toEqual(["person-lookup", "separations"]);
    for (const descriptor of STEP_PROOF_DESCRIPTORS_m1) {
      expect_m1(() => workflowModuleOf_m1(descriptor.id)).toThrow(/not registered/u);
    }
  });

  it_m1("keeps separations steps inside its one timeline", () => {
    const separations = WORKFLOW_DESCRIPTORS_m1[1];
    expect_m1(separations?.timeline.map(({ key, label }) => [key, label])).toEqual([
      ["kuali-extraction", "Kuali extraction"],
      ["identity-check", "Identity check"],
      ["job-summary", "Job summary"],
      ["kronos-timecard", "Kronos timecard"],
      ["ucpath-transaction", "UCPath transaction"],
      ["kuali-finalization", "Kuali finalization"],
    ]);
  });
});
}
