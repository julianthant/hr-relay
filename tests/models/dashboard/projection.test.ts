import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { isTerminalQueueStatus } from "../../../src/models/dashboard/projection.js";

{

const { RUN_1, RUN_2, QUEUE, DAY } = createDashboardModelFixtures();

describe("dashboard wire primitives", () => {

  it("binds every served action to the row's own revision, once per key", () => {
    const [cancel, hide] = QUEUE.actions;
    assert.ok(cancel !== undefined && hide !== undefined);

    assert.equal(
      QueueSurfaceWireSchema.safeParse({
        ...QUEUE,
        actions: [{ ...cancel, expectedVersion: 2 }, hide],
      }).success,
      false,
      "accepted an action whose expectedVersion is not the row's rowRevision",
    );
    assert.equal(
      QueueSurfaceWireSchema.safeParse({ ...QUEUE, rowRevision: 2 }).success,
      false,
      "accepted a bumped rowRevision while every action still named the old one",
    );
    assert.equal(
      QueueSurfaceWireSchema.safeParse({ ...QUEUE, actions: [cancel, { ...hide, key: "cancel" }] }).success,
      false,
      "accepted two served actions sharing one key",
    );


    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, actions: [] }).success, true);
  });

  it("keeps queue surfaces flat and operation-only membership coherent", () => {
    assert.equal(QueueSurfaceWireSchema.safeParse(QUEUE).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, surfaceKind: "preview" }).success, true);
    const member = {
      ...QUEUE,
      surfaceKind: "member",
      containment: "member",
      lineage: { state: "child", parentRunId: RUN_2 },
    };
    assert.equal(QueueSurfaceWireSchema.safeParse(member).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, surfaceKind: "member" }).success, false);

    assert.equal(QueueSurfaceWireSchema.safeParse({ ...member, containment: "root" }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, containment: "member" }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, containment: "linked" }).success, false);

    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...QUEUE, containment: "linked", lineage: { state: "child", parentRunId: RUN_2 },
    }).success, true);

    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...QUEUE,
      linkedRuns: [{ runId: RUN_1, workflowId: "onboarding", label: "Onboarding", panelKind: "run", status: "running" }],
    }).success, false);
    const chip = { runId: RUN_2, workflowId: "onboarding", label: "Onboarding", panelKind: "run", status: "running" };
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, linkedRuns: [chip] }).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, linkedRuns: [chip, chip] }).success, false);
    const operation = {
      ...QUEUE,
      surfaceKind: "operation",
      panelKind: "group",
      availableSections: ["people", "logs", "receipt"],
      memberRunIds: [RUN_2],
      memberRollup: { total: 1, terminal: 0, failed: 0 },
      memberPreview: { state: "present", value: "Ada Lovelace" },
    };
    assert.equal(QueueSurfaceWireSchema.safeParse(operation).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, memberRunIds: [RUN_2] }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...operation, memberRunIds: [RUN_2, RUN_2], memberRollup: { total: 2, terminal: 0, failed: 0 } }).success, false);
    assert.equal(JSON.stringify(operation).includes("members\":"), false);
    assert.equal(JSON.stringify(DAY).includes("notes\":"), false);
    assert.equal(JSON.stringify(DAY).includes("bytes\":"), false);
  });
});
}

{

describe("queue row timing", () => {

  it("refuses a status that is not part of the served queue vocabulary", () => {
    assert.throws(() => isTerminalQueueStatus("finished"));
  });
});
}
