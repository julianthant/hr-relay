import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { createEmergencyContactRetryWorld } from "../../../support/helpers/backend/emergency-contact-retry-world.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
afterAll(world.releaseTemplates);

it("serves a native admitted failed-member Retry and withdraws it after replacement", async () => {
  const f = await world.fixture();
  const projection = createOperatorProjection({ database: f.database, reader: f.canonical.lifecycle,
    stateRoot: f.admission.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  const failed = f.children().find(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
  const successful = f.children().find(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  assert.ok(failed && successful);
  const before = canonicalJsonStringify(successful);
  const row = projection.queueSurface(failed.envelope.runId);
  const retry = row?.actions.find(action => action.key === "retry-member");
  assert.ok(retry?.kind === "command");
  assert.equal(retry.command, "retry");
  assert.equal(retry.expectedVersion, failed.version);
  assert.ok(retry.placement.includes("footer"));
  assert.ok(!projection.queueSurface(successful.envelope.runId)?.actions.some(action => action.key === "retry-member"));
  const command = { ...f.runCommand("retry", failed), target: { runId: failed.envelope.runId, expectedVersion: retry.expectedVersion } };
  assert.equal(f.canonical.kernel.execute(command).state, "applied");
  assert.equal(f.canonical.kernel.execute(command).state, "already-applied");
  assert.ok(!projection.queueSurface(failed.envelope.runId)?.actions.some(action => action.key === "retry-member"));
  assert.equal(canonicalJsonStringify(f.current(successful.envelope.runId)), before);
});

for (const unknown of [false, true]) it(`withholds member Retry after ${unknown ? "an UNKNOWN write" : "a committed Save followed by failure"}`, async () => {
  const f = await world.fixture();
  const failed = f.children().find(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
  assert.ok(failed);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", failed)).state, "applied");
  f.control.unknownAfterSave = unknown;
  f.control.failAfterSave = !unknown;
  const executed = await f.canonical.step(f.parentRun, new AbortController().signal);
  assert.equal(executed.outcome.state, unknown ? "parked-write" : "failed");
  const target = f.current(executed.run.envelope.runId);
  const intents = f.database.authority.writeIntents.listByRun(target.envelope.runId);
  assert.deepEqual(intents.map(intent => intent.status), [unknown ? "parked" : "committed"]);
  const projection = createOperatorProjection({ database: f.database, reader: f.canonical.lifecycle,
    stateRoot: f.admission.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  const row = projection.queueSurface(target.envelope.runId);
  assert.ok(row);
  assert.ok(!row.actions.some(action => action.kind === "command" && action.command === "retry"));
  if (unknown) assert.ok(!row.actions.some(action => action.kind === "command" && action.command === "cancel"));
  const before = canonicalJsonStringify(f.children());
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", target)).state, "rejected");
  assert.equal(canonicalJsonStringify(f.children()), before);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(target.envelope.runId), intents);
});
