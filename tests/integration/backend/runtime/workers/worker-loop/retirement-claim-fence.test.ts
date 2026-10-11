import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture, id, NOW } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
import { QUEUED_RUN } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { WorkerBrowserCommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { admitWorkerPoolRoster } from "../../../../../../src/backend/storage/sqlite/worker-slots.js";

it("keeps canonical claims fenced until the native pool reservation is audited", () => {
  const fixture = foundationFixture();
  try {
    const ports = testWorkerPorts(fixture.db, fixture.clock, { path: fixture.path, descriptor: personLookupDescriptor, poolIndex: 2 });
    const worker = fixture.db.authority.workerSlots.list("person-lookup").find(slot => slot.poolIndex === 2);
    assert.ok(worker);
    const runId = id(700);
    fixture.db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...fixture.run.envelope, runId, itemId: runId } });
    const pool = fixture.db.authority.workerPools.get("person-lookup");
    assert.ok(pool);
    const command = WorkerBrowserCommandRequestSchema.parse({ commandId: id(701), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: pool.version }, payload: { desiredWorkers: 2 } });
    assert.equal(command.type, "plan-worker-count");
    if (command.type !== "plan-worker-count") throw new Error("fixture requires pool command");
    fixture.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(command);
      const roster = admitWorkerPoolRoster(repositories, command, NOW);
      repositories.workerControls.admit({ commandId: command.commandId, request: command, scope: "worker-pool:person-lookup", executorId: id(702),
        admittedAt: NOW, expiresAt: NOW, basisVersion: pool.version, phase: { state: "admitted" }, roster });
    });
    const before = fixture.db.getMeta().authorityGeneration;
    const claim = () => ports.claimNext({ commandId: id(703), workflow: "person-lookup", workerId: worker.workerId });
    assert.deepEqual(claim(), { state: "refused", refusal: { reason: "none-eligible" } });
    assert.equal(fixture.db.authority.runs.get(runId)?.lifecycle.state, "queued");
    assert.equal(fixture.db.getMeta().authorityGeneration, before);
    fixture.db.authority.workerControls.transition(command.commandId, "admitted", { state: "refused", completedAt: NOW, message: "operator declined" });
    assert.deepEqual(claim(), { state: "refused", refusal: { reason: "none-eligible" } });
    fixture.db.authority.workerControls.audit(command.commandId, NOW);
    assert.equal(claim().state, "applied");
    assert.equal(fixture.db.authority.runs.get(runId)?.lifecycle.state, "claimed");
  } finally { fixture.dispose(); }
});
