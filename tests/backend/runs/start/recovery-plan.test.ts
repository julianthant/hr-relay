import { withCanonicalRunCommandScope } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { RunContinuationRefusedError } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { planRunRecovery } from "../../../../src/backend/runs/start/recovery-plan.js";
import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { continuationEvidenceDigest } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { failedSourceReadDescriptor as descriptor } from "../../../support/fixtures/source-bound-read-fixtures.js";

function fixture(outcome: "done" | "failed" | "interrupted" | "cancelled", issue?: "contract" | "input" | "parked" | "attempting" | "config" | "foreign") {
  const run = RunRecordSchema.parse({ ...QUEUED_RUN, version: 2, claimGeneration: 1,
    ...(["done", "failed"].includes(outcome) ? { completion: { schemaVersion: 1, kind: outcome, expectedVersion: 1,
      claim: { workerId: "fixture-worker", claimGeneration: 1 }, authorizedAt: QUEUED_RUN.updatedAt,
      ...(outcome === "failed" ? { failureId: "10000000-0000-4000-8000-000000000007" } : { resultDigest: "a".repeat(64) }) } } : {}),
    envelope: { ...QUEUED_RUN.envelope, workflow: descriptor.id, descriptorVersion: descriptor.version,
      contractFingerprint: issue === "contract" ? "b".repeat(64) : descriptor.contractFingerprint },
    input: { raw: { eid: "10812345" }, parsed: { value: { eid: "10812345" }, protectedBindings: [],
      schemaHash: issue === "input" ? "b".repeat(64) : deriveSchemaHash(descriptor.canonicalInput, "output") },
      ingressSchemaHash: QUEUED_RUN.input.ingressSchemaHash },
    lifecycle: { state: "terminal", outcome, endedAt: QUEUED_RUN.updatedAt,
      ...(outcome === "failed" ? { failureId: "10000000-0000-4000-8000-000000000007" } : {}) } });
  let writes = 0, audits = 0;
  const command = CommandRequestSchema.parse({ commandId: "10000000-0000-4000-8000-000000000008", requestedAt: QUEUED_RUN.updatedAt,
    requestedBy: "local-operator", source: "dashboard", family: "run", type: "recover-run",
    target: { runId: run.envelope.runId, expectedVersion: run.version } });
  const repositories = new Proxy({} as AuthorityRepositories, { get(_target, key) {
    switch (key) {
      case "commands": return { get: () => command, assertIdentity: () => undefined };
      case "commandAudits": return { findByCommand: () => { audits += 1; return undefined; } };
      case "runs": return { get: () => issue === "foreign" ? undefined : run, listByItem: () => [run] };
      case "deletedRuns": return { get: () => undefined };
      case "runtimeConfig": return { get: () => ({ configFingerprint: issue === "config" ? "b".repeat(64) : run.envelope.configFingerprint }) };
      case "writeIntents": return { listAttemptingByItem: () => issue === "attempting" ? [{}] : [],
        listByRun: () => issue === "parked" ? [{ status: "parked" }] : [] };
      case "runCheckpoints": return { listByItem: () => [] };
      case "gateResults": return { listByRun: () => [] };
      default: writes += 1; throw new Error(`unrequested authority effect: ${String(key)}`);
    }
  } });
  return { run, command, repositories, writes: () => writes, audits: () => audits,
    plan: () => withCanonicalRunCommandScope(repositories, command,
      () => planRunRecovery(repositories, descriptor, run, command.commandId)) };
}
it.each(["failed", "interrupted"] as const)("plans explicit recovery of %s with exact immutable source coordinates", outcome => {
  const f = fixture(outcome);
  const plan = f.plan();
  assert.equal(plan.kind, "checkpoint-recovery");
  assert.deepEqual(plan.source, { runId: f.run.envelope.runId, expectedVersion: f.run.version,
    attempt: f.run.envelope.attempt, inputDigest: continuationEvidenceDigest(f.run.input) });
  assert.equal(plan.continuation.sources[0]?.runId, f.run.envelope.runId);
  assert.equal(plan.continuation.sources[0]?.version, f.run.version);
  assert.deepEqual(plan.continuation.checkpoints, []);
  assert.equal(Object.hasOwn(plan, "rerun"), false);
  assert.equal(f.writes(), 0);
});
it.each(["done", "cancelled"] as const)("refuses %s source without allocating or changing authority", outcome => {
  const f = fixture(outcome);
  assert.throws(() => f.plan(), error => error instanceof RerunRefusedError && error.code === "invalid-state");
  assert.equal(f.writes(), 0);
});
it.each(["contract", "input", "parked", "attempting", "config", "foreign"] as const)("refuses %s recovery authority before effects", issue => {
  const f = fixture("failed", issue);
  assert.throws(() => f.plan(), RerunRefusedError);
  assert.equal(f.writes(), 0);
});
it("keeps the public recovery command source-only and rejects caller-provided checkpoint authority", () => {
  const f = fixture("failed");
  const command = { commandId: "10000000-0000-4000-8000-000000000008", requestedAt: QUEUED_RUN.updatedAt,
    requestedBy: "local-operator", source: "dashboard", family: "run", type: "recover-run",
    target: { runId: f.run.envelope.runId, expectedVersion: f.run.version } };
  assert.equal(CommandRequestSchema.parse(command).type, "recover-run");
  assert.equal(CommandRequestSchema.safeParse({ ...command, payload: { continuation: f.plan().continuation } }).success, false);
});

it("refuses a standalone planner with a parsed canonical command before product audits or mutations", () => {
  const f = fixture("failed");
  assert.throws(() => planRunRecovery(f.repositories, descriptor, f.run, f.command.commandId), RunContinuationRefusedError);
  assert.equal(f.audits(), 0); assert.equal(f.writes(), 0);
});
