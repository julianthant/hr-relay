import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { batchMemberRetryAction, composeCommandRequest, verifyShellCommandEffect } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import { RunDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { createDashboardModelFixtures } from "../../../support/helpers/dashboard-model-fixtures.js";
import { queueParentFixture } from "../../../support/helpers/dashboard/queue-parent-fixture.js";

const f = createDashboardModelFixtures();
const row = QueueSurfaceWireSchema.parse({ ...f.QUEUE, workflowId: "person-lookup", parent: null, status: "failed", rowRevision: 3,
  session: { state: "present", sessionId: f.RUN_2, origin: { kind: "start-plan", startPlanId: f.RUN_2, actorId: "local-operator" },
    presentation: { groupInQueue: true, version: 1, startedAt: f.QUEUE.startedAt } },
  actions: [{ key: "retry-batch-member", kind: "command", command: "retry", label: "Retry", expectedVersion: 3, icon: "retry", intent: "neutral", placement: ["banner"] }] });
const context = { actorId: "local-operator", source: "run-detail", batchMemberRetry: row } as const;

it("composes only the exact served failed Lookup batch root and leaves child Retry separate", () => {
  const action = batchMemberRetryAction(row); assert.ok(action);
  const target = { runId: row.runId, expectedVersion: row.rowRevision };
  const composed = composeCommandRequest(action, target, context); assert.ok(composed.state === "ready");
  const command = CommandRequestSchema.parse(composed.request); assert.equal(command.type, "retry"); assert.deepEqual(command.target, target);
  assert.equal(composeCommandRequest(action, target, { ...context, batchMemberRetry: undefined }).state, "refused");
  assert.equal(composeCommandRequest(action, target, { ...context, source: "queue" }).state, "refused");
  assert.equal(composeCommandRequest(action, { ...target, expectedVersion: 4 }, context).state, "refused");
  assert.equal(composeCommandRequest({ ...action, key: "retry-child" }, target, context).state, "refused");
  for (const changed of [
    { workflowId: "separations" }, { status: "done" }, { parent: queueParentFixture(f.RUN_2) },
    { actions: [] }, { session: { state: "absent", reason: "standalone" } },
    { session: { ...row.session, presentation: { groupInQueue: false, version: 1, startedAt: row.startedAt } } },
  ]) assert.equal(composeCommandRequest(action, target, { ...context, batchMemberRetry: QueueSurfaceWireSchema.parse({ ...row, ...changed }) }).state, "refused");
});

for (const detailWorkflowMatches of [true, false]) it(detailWorkflowMatches
  ? "confirms only the exact native root replacement with the same person and batch"
  : "refuses matching foreign-workflow detail headers when Lookup row facts stay unchanged", async () => {
  const source = RunDetailWireSchema.parse({ ...f.DETAIL, runId: row.runId, rowRevision: 3,
    header: { ...f.DETAIL.header, runId: row.runId, workflowId: detailWorkflowMatches ? row.workflowId : "separations", parentRunId: undefined, status: "failed", attempt: 1 } });
  const next = RunDetailWireSchema.parse({ ...source, runId: f.RUN_2, rowRevision: 1,
    header: { ...source.header, runId: f.RUN_2, retryOf: row.runId, status: "queued", attempt: 2 } });
  const replacement = QueueSurfaceWireSchema.parse({ ...row, runId: f.RUN_2, rowRevision: 1, attempt: 2, status: "queued", endedAt: { state: "absent", reason: "queued" }, actions: [] });
  let observedRow = replacement, observedDetail = next;
  const client = { ...createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw new Error("unexpected read"); } }),
    runDetail: async (id: string) => id === row.runId ? source : observedDetail,
    dashboardDay: async () => DashboardDayWireSchema.parse({ ...f.DAY, queueSurfaces: [{ ...row, actions: [] }, observedRow] }),
  };
  const command = CommandRequestSchema.parse({ family: "run", type: "retry", commandId: f.RUN_2, source: "run-detail", requestedBy: "local-operator",
    requestedAt: row.startedAt, target: { runId: row.runId, expectedVersion: 3 } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
    affectedTargets: [row, replacement].map(value => ({ family: "run", runId: value.runId })) });
  if (!detailWorkflowMatches) {
    assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, reply)).state, "mismatch");
    return;
  }
  assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, reply)).state, "matched");
  for (const changed of [{ itemId: f.RUN_2 }, { workflowId: "separations" }, { parent: queueParentFixture(f.RUN_2) },
    { session: { state: "absent", reason: "lost batch" } }, { session: { ...replacement.session, sessionId: row.runId } }]) {
    observedRow = QueueSurfaceWireSchema.parse({ ...replacement, ...changed });
    assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, reply)).state, "mismatch");
  }
  observedRow = replacement;
  for (const header of [{ ...next.header, retryOf: row.itemId }, { ...next.header, attempt: 1 }, { ...next.header, parentRunId: row.itemId }]) {
    observedDetail = RunDetailWireSchema.parse({ ...next, header });
    assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, reply)).state, "mismatch");
  }
  assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, CommandResultSchema.parse({ ...reply,
    affectedTargets: [{ family: "run", runId: row.runId }, { family: "run", runId: f.RUN_2 }, { family: "run", runId: row.itemId }] }))).state, "mismatch");
});
