import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createWorkerCommandResultQuery } from "../../../../src/backend/runs/queries/worker-command-result.js";
import { CommandResultSchema, IntakeCommandRequestSchema, WorkerBrowserCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";

const retry = (commandId: string, requestedAt: string, requestedBy = "local-operator") => WorkerBrowserCommandRequestSchema.parse({
  commandId, requestedAt, requestedBy, source: "dashboard", family: "worker-browser", type: "retry-worker",
  target: { workerId: "person-lookup-1", lifetimeId: null, expectedVersion: 1, workflowId: "person-lookup" } });

it("reads an audited worker command as recorded and every unproved id as unavailable", async () => {
  const f = await foundationFixture();
  try {
    const query = createWorkerCommandResultQuery(f.db);
    const at = f.clock.now().toISOString();
    const audit = (request: ReturnType<typeof retry>, result: unknown) => f.db.authority.commandAudits.insert({
      auditId: randomUUID(), request, result: CommandResultSchema.parse(result), completedAt: at, versionChanges: [], affectedDependencyIds: [] });

    const rejected = retry(randomUUID(), at);
    const rejection = { state: "rejected", commandId: rejected.commandId, code: "invalid-state", message: "WORKER_TARGET_STALE" };
    f.db.authority.commands.insert(rejected); audit(rejected, rejection);
    assert.deepEqual(query(rejected.commandId), { state: "recorded", request: rejected, result: rejection });

    const accepted = retry(randomUUID(), at);
    const applied = { state: "applied", commandId: accepted.commandId, affectedTargets: [{ family: "worker-browser", workerId: "person-lookup-1" }] };
    f.db.authority.commands.insert(accepted); audit(accepted, applied);
    assert.deepEqual(query(accepted.commandId), { state: "recorded", request: accepted, result: applied });

    const journaledOnly = retry(randomUUID(), at);
    f.db.authority.commands.insert(journaledOnly);
    assert.deepEqual(query(journaledOnly.commandId), { state: "unavailable" });
    assert.deepEqual(query(randomUUID()), { state: "unavailable" });

    const foreign = retry(randomUUID(), at, "other-actor");
    f.db.authority.commands.insert(foreign);
    audit(foreign, { state: "rejected", commandId: foreign.commandId, code: "invalid-state", message: "WORKER_TARGET_STALE" });
    assert.deepEqual(query(foreign.commandId), { state: "unavailable" });

    const other = IntakeCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator",
      source: "dashboard", family: "intake", type: "validate-intake", target: { intakeSessionId: randomUUID(), expectedVersion: 1 } });
    f.db.authority.commands.insert(other);
    f.db.authority.commandAudits.insert({ auditId: randomUUID(), request: other, result: CommandResultSchema.parse({ state: "rejected", commandId: other.commandId, code: "policy-refused", message: "Fixture refusal" }),
      completedAt: at, versionChanges: [], affectedDependencyIds: [] });
    assert.deepEqual(query(other.commandId), { state: "unavailable" });
  } finally { await f.dispose(); }
});
