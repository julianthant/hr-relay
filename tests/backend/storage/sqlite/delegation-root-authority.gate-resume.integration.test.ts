import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { authenticateRootRun } from "../../../../src/backend/storage/sqlite/delegation-root-authority.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { ActorIdSchema, FingerprintSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { replaceOcrAuditRead, replaceOcrCommandRead } from "../../../support/helpers/backend/ocr-proof-reads.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("authenticates only the exact recorded worker park and operator gate resume after OCR correction", async () => {
  const f = await world.fixture({ record: true, release: true });
  const before = authenticateRootRun(f.database.authority, f.run);
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const approval = f.approval();
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  const run = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(run);
  assert.equal(run.envelope.startAt, "approve-records");
  const repositories = f.database.authority;
  const generation = f.database.getMeta().authorityGeneration;
  f.database.withAuthorityReadSnapshot(() => {
    assert.equal(authenticateRootRun(repositories, run).command.commandId, before.command.commandId);
    const command = repositories.commands.get(approval.commandId); assert.ok(command?.family === "gate");
    const audit = repositories.commandAudits.findByCommand(command.commandId); assert.ok(audit?.result.state === "applied");
    const gate = repositories.gateResults.listByRun(run.envelope.runId)[0]; assert.ok(gate && "commandId" in gate);
    const park = repositories.lifecycleJournal.findGatePark(run.envelope.runId, gate.gateId, gate.expectedVersion); assert.ok(park);
    const parkAudit = repositories.lifecycleJournal.findAuditByCommand(park.commandId);
    assert.ok(parkAudit && "kind" in parkAudit && parkAudit.kind === "run-lifecycle" && parkAudit.result.kind === "run");
    assert.equal(repositories.lifecycleJournal.findGatePark(randomUUID(), gate.gateId, gate.expectedVersion), undefined);
    assert.equal(repositories.lifecycleJournal.findGatePark(run.envelope.runId, "foreign-gate", gate.expectedVersion), undefined);
    assert.equal(repositories.lifecycleJournal.findGatePark(run.envelope.runId, gate.gateId, parkAudit.result.appliedVersion - 1), undefined);
    const resumeId = lifecycleCommandId("operator-gate", command.commandId);
    const variants: ReadonlyArray<readonly [string, AuthorityRepositories]> = [
      ["missing gate", { ...repositories, gateResults: { ...repositories.gateResults, listByRun: () => [] } }],
      ["foreign gate actor", { ...repositories, gateResults: { ...repositories.gateResults,
        listByRun: () => [{ ...gate, resolvedBy: ActorIdSchema.parse("foreign-operator") }] } }],
      ["missing command", replaceOcrCommandRead(repositories, command.commandId, undefined)],
      ["foreign command", replaceOcrCommandRead(repositories, command.commandId, { ...command,
        target: { ...command.target, runId: RunIdSchema.parse(randomUUID()) } })],
      ["missing applied audit", replaceOcrAuditRead(repositories, command.commandId, undefined)],
      ["missing gate version", replaceOcrAuditRead(repositories, command.commandId, { ...audit, versionChanges: [] })],
      ["missing native park", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal, findGatePark: () => undefined } }],
      ["altered native park fingerprint", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
        findGatePark: () => ({ ...park, requestFingerprint: FingerprintSchema.parse("a".repeat(64)) }) } }],
      ...[resumeId, park.commandId].map(id => ["missing native audit", { ...repositories,
        lifecycleJournal: { ...repositories.lifecycleJournal,
          findAuditByCommand: commandId => commandId === id ? undefined : repositories.lifecycleJournal.findAuditByCommand(commandId) },
      }] satisfies readonly [string, AuthorityRepositories]),
    ];
    for (const [name, altered] of variants) assert.throws(() => authenticateRootRun(altered, run),
      /delegation-gate-resume-authority-unavailable|run-lifecycle-request-binding-mismatch/u, name);
    assert.throws(() => authenticateRootRun(repositories, RunRecordSchema.parse({ ...run,
      envelope: { ...run.envelope, startAt: "read-result" } })), /delegation-gate-resume-authority-unavailable/u);
  });
  assert.equal(f.database.getMeta().authorityGeneration, generation);
});

it("refuses an invented resume node before an operator gate settlement", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.throws(() => authenticateRootRun(f.database.authority, RunRecordSchema.parse({ ...f.run,
    envelope: { ...f.run.envelope, startAt: "approve-records" } })), /delegation-gate-resume-authority-unavailable/u);
});

it("authenticates the original gate resume after terminal timeline pruning", async () => {
  const f = await world.fixture({ record: true, release: true });
  const original = authenticateRootRun(f.database.authority, f.run);
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const approval = f.approval();
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  const resumed = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(resumed);
  await f.canonical.execute(resumed, new AbortController().signal);
  const run = f.database.authority.runs.get(resumed.envelope.runId); assert.ok(run);
  assert.deepEqual(run.lifecycle, { state: "terminal", outcome: "done", endedAt: f.clock.now().toISOString() });
  const repositories = f.database.authority;
  const eventId = lifecycleCommandId("timeline-gate-resolved", approval.commandId);
  const resolved = repositories.timelineEvents.get(eventId); assert.ok(resolved);
  assert.equal(authenticateRootRun(repositories, run).command.commandId, original.command.commandId);

  assert.ok(repositories.timelineEvents.pruneBefore("2099-01-01") > 0);
  assert.equal(authenticateRootRun(repositories, run).command.commandId, original.command.commandId);
  assert.deepEqual(repositories.timelineEvents.get(eventId), resolved);
  assert.equal(repositories.timelineEvents.pruneBefore("2099-01-01"), 0);
  assert.throws(() => authenticateRootRun({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
    get: id => id === eventId ? undefined : repositories.timelineEvents.get(id) } }, run), /delegation-gate-resume-authority-unavailable/u);
});
