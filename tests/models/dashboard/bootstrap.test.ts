import { WorkbookCompatibilitySchema } from "../../../src/models/dashboard/workbook-library.js";
import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { WorkflowBootstrapPrimitiveSchema, WorkflowStartReadinessSchema } from "../../../src/models/dashboard/bootstrap.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { ServerClockWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { PACIFIC_TIME_ZONE } from "../../../src/models/dashboard/search-calendar.js";

{

const { WORKFLOW_PRIMITIVE, BOOTSTRAP } = createDashboardModelFixtures();

describe("dashboard wire primitives", () => {

  it("requires a workflow icon from the declared vocabulary", () => {
    const { icon, ...withoutIcon } = WORKFLOW_PRIMITIVE;
    assert.equal(WorkflowBootstrapPrimitiveSchema.parse(WORKFLOW_PRIMITIVE).icon, icon);
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse(withoutIcon).success, false);
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse({ ...withoutIcon, icon: "unknown-icon" }).success, false);
  });

  it("serves explicit source selection readiness without type defaults", () => {
    const needed = { scope: "workbook-sources", state: "selection-needed",
      fixAction: { kind: "choose-workbook-sources", workflowId: WORKFLOW_PRIMITIVE.id } };
    const workflow = { ...WORKFLOW_PRIMITIVE, start: { ...WORKFLOW_PRIMITIVE.start,
      requiredWorkbookFields: ["eid"], workbookReference: { id: "roster", keyFieldId: "eid", mode: "all", writableFields: [] }, readiness: needed } };
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse(workflow).success, true);
    assert.equal(WorkbookCompatibilitySchema.safeParse({ workflows: [], libraries: [] }).success, true);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ ...needed, defaultWorkbookId: "roster" }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ scope: "all-dependencies", state: "ready" }).success, false);
    assert.equal(WorkflowStartReadinessSchema.safeParse({ scope: "workbook-sources", state: "ready", fixAction: needed }).success, false);
  });

  it("serves the optional reference check beside or without a required reference, ready with no pick", () => {
    const ready = { scope: "workbook-sources", state: "ready" }, workbookCheck = { id: "reference-check", keyFieldId: "eid" };
    const checkOnly = { ...WORKFLOW_PRIMITIVE, start: { ...WORKFLOW_PRIMITIVE.start, requiredWorkbookFields: [], workbookCheck, readiness: ready } };
    assert.deepEqual(WorkflowBootstrapPrimitiveSchema.parse(checkOnly).start.workbookCheck, workbookCheck);
    const both = { ...WORKFLOW_PRIMITIVE, start: { ...WORKFLOW_PRIMITIVE.start, requiredWorkbookFields: ["eid"], workbookCheck,
      workbookReference: { id: "roster", keyFieldId: "eid", mode: "all", writableFields: [] }, readiness: ready } };
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse(both).success, true);
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse({ ...both, start: { ...both.start, workbookCheck: { id: "roster", keyFieldId: "eid" } } }).success, false);
    assert.equal(WorkflowBootstrapPrimitiveSchema.safeParse({ ...checkOnly, start: { ...checkOnly.start, workbookCheck: { ...workbookCheck, optional: true } } }).success, false);
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

  it("accepts the Pacific calendar zone in the bootstrap clock contract", () => {
    assert.equal(PACIFIC_TIME_ZONE, "America/Los_Angeles");
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: PACIFIC_TIME_ZONE }).success, true);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: "Mars/Olympus" }).success, false);
  });
});
}
