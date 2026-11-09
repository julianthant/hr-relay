import { WorkbookReferenceSlotSchema } from "../../../src/models/dashboard/workbook-library.js";
import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { WorkflowBootstrapPrimitiveSchema, WorkflowStartReadinessSchema } from "../../../src/models/dashboard/bootstrap.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { ServerClockWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { runtimeTimeZone } from "../../../src/rules/time/clock.js";

{

const { WORKFLOW_PRIMITIVE, BOOTSTRAP } = createDashboardModelFixtures();

describe("dashboard wire primitives", () => {

  it("requires one exact reference fix action and keeps ready scoped to default workbook bindings", () => {
    const blocked = { scope: "default-workbook-references", state: "blocked", reason: "Import the roster.",
      fixAction: { kind: "import-workbook", purpose: { kind: "workflow-reference", workflowId: WORKFLOW_PRIMITIVE.id, typeId: "roster" } } };
    const workflow = { ...WORKFLOW_PRIMITIVE, start: { ...WORKFLOW_PRIMITIVE.start, requiredWorkbookTypeIds: ["roster"], readiness: blocked } };
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse(workflow).success, true);
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse({ ...workflow,
      start: { ...workflow.start, readiness: { ...blocked, fixAction: { ...blocked.fixAction,
        purpose: { ...blocked.fixAction.purpose, workflowId: "another-workflow" } } } } }).success, false);
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse({ ...workflow,
      start: { ...workflow.start, requiredWorkbookTypeIds: [] } }).success, false);
    assert.equal(WorkbookReferenceSlotSchema.safeParse({ workflowId: WORKFLOW_PRIMITIVE.id, workflowLabel: WORKFLOW_PRIMITIVE.label,
      typeId: "roster", type: null, current: { state: "missing" } }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ ...blocked, fixAction: undefined }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ ...blocked, fixActions: [blocked.fixAction] }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ ...blocked, fixAction: { kind: "import-workbook", purpose: { kind: "other" } } }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ scope: "all-dependencies", state: "ready" }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ scope: "default-workbook-references", state: "ready", fixAction: blocked.fixAction }).success, false);
  });

  it("refuses a served chunk harness whose composition is not in the same document", () => {
    const composition = {
      ...WORKFLOW_PRIMITIVE,
      id: "separations",
      code: "se",
      label: "Separations",
      role: { kind: "composition" },
    };
    const harness = {
      ...WORKFLOW_PRIMITIVE,
      id: "separations-kuali-read",
      code: "sk",
      label: "Separations — Kuali read",
      role: { kind: "chunk-harness", of: "separations", step: "kuali-extraction" },
    };

    assert.equal(
      FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, workflows: [composition, harness] }).success,
      true,
    );

    const dangling = FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, workflows: [harness] });
    assert.equal(dangling.success, false);
    assert.match(
      JSON.stringify(dangling.error?.issues ?? []),
      /separations-kuali-read is served as a chunk harness of separations/,
    );

    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...composition, role: { kind: "standalone" } }, harness],
      }).success,
      false,
    );


    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...WORKFLOW_PRIMITIVE, role: { kind: "sub-workflow" } }],
      }).success,
      false,
    );
    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...WORKFLOW_PRIMITIVE, role: { kind: "standalone", of: "separations" } }],
      }).success,
      false,
    );
  });
});
}

{

describe("Activity volume range policy and boundary skeleton", () => {

  it("shares the runtime's resolved IANA zone with the bootstrap clock contract", () => {
    const timeZone = runtimeTimeZone();
    assert.equal(timeZone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: timeZone }).success, true);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: "Mars/Olympus" }).success, false);
  });
});
}
