import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach,it } from "vitest";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { authenticateDelegationRefresh } from "../../../../src/backend/storage/sqlite/delegation-refresh.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { childSettledObservationModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1ControlledFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { createDelegationExecutionWorld } from "../../../support/helpers/backend/delegation-execution-world.js";

const world = createDelegationExecutionWorld(childSettledObservationModules);
const fixture = world.fixture;
afterEach(world.cleanup);

it("refuses a truncated accepted retry cohort before it can publish an early native wake", async () => {
  let fail = true;
  const f = await fixture(plan1ControlledFailureStores(() => fail),"fail",childSettledObservationModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const children = f.database.authority.runs.listChildren(parent.envelope.runId); assert.equal(children.length,2);
  fail = false;
  for (const child of children) assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: child.version } }).state,"applied");
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  const waiting = f.database.authority.runs.get(parent.envelope.runId); assert.ok(waiting?.delegationRefresh?.phase === "waiting");
  assert.equal(waiting.delegationRefresh.retryCommandIds.length,2);
  const truncated = RunRecordSchema.parse({ ...waiting, delegationRefresh: { ...waiting.delegationRefresh,
    retryCommandIds: waiting.delegationRefresh.retryCommandIds.slice(0,1) } });
  assert.throws(() => authenticateDelegationRefresh(f.database.authority,truncated),/delegation-refresh-cohort/);
  const wakeId = lifecycleCommandId("delegation-refresh-settle", { rootCommandId: truncated.delegationRefresh?.commandId,
    retryCommandIds: truncated.delegationRefresh?.retryCommandIds });
  const raw = new DatabaseSync(syntheticDatabasePath(f.database));
  try {
    raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.delegationRefresh.retryCommandIds',json(?)) WHERE id=?")
      .run(JSON.stringify(truncated.delegationRefresh?.retryCommandIds),parent.envelope.runId);
    assert.throws(() => f.database.withAuthorityTransaction(() => f.database.authority.dependencies.reconcile(parent.envelope.runId,f.clock.now().toISOString())),/delegation-refresh-cohort/);
    assert.equal(f.database.authority.lifecycleJournal.getCommand(wakeId),undefined);
    assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.version,waiting.version);
    assert.equal(f.database.authority.runs.listChildren(parent.envelope.runId).filter(child => child.envelope.retryOf !== undefined && child.lifecycle.state !== "terminal").length,1);
  } finally {
    raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.delegationRefresh.retryCommandIds',json(?)) WHERE id=?")
      .run(JSON.stringify(waiting.delegationRefresh.retryCommandIds),parent.envelope.runId);
    raw.close();
  }
});
