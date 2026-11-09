import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import * as observedData from "../../../../src/backend/logs/observed-data.js";
import { RecordedDataPointSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { observationLeafPaths } from "../../../../src/models/events/data-observation-origin.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { assertOcrRecoverySnapshotCurrent, requireCurrentOcrSnapshot, readOcrReviewCheckpointSeed, readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest } from "../../../../src/models/ocr/review.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { OcrWorkflowResultSchema, compactOcrResult } from "../../../../src/models/workflows/ocr/result.js";
import { ReadOcrResult } from "../../../../src/models/workflows/ocr/read-result.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CommandAuditRecordSchema, CommandRequestSchema, RunLifecycleCommandAuditRecordSchema } from "../../../../src/rules/commands/commands.js";
import { OcrReviewRevisionSchema, initialOcrReviewRecords } from "../../../../src/models/ocr/review.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { replaceOcrAuditRead, replaceOcrCommandRead } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { terminalGateDependencyRecord } from "../../../../src/models/run/result.js";
import { RetainedOcrResultSchema, retainedOcrStore, redactRetainedOcrObservedDataPoints } from "../../../support/fixtures/ocr/retained-review-producer.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { checkpointRecordKey } from "../../../../src/models/workflow/checkpoint.js";
import { buildOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";
import { bindManualOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
function approval(f: Fixture, selectedRecordIds?: readonly string[]) {
  return f.approval(selectedRecordIds);
}

it("redacts full historical batches with origins and refuses undeclared or malformed observations", () => {
  const review = { ...retainedOcrStore.tasks.readResult.contract.example.review, roster: {
    artifact: retainedOcrStore.tasks.readResult.contract.example.review.accounting.manifest.document,
    readAt: "2026-11-08T00:00:00.000Z", rows: [{ sourceRow: 1, eid: null, name: "Historical Private Name" }],
  } };
  for (const task of [retainedOcrStore.tasks.readReviewSeed, retainedOcrStore.tasks.readResult]) {
    const output = JsonValueSchema.parse(task.contract.output.parse(task === retainedOcrStore.tasks.readResult ? { review, identities: [] } : review));
    assert.ok(output !== null && typeof output === "object" && !Array.isArray(output));
    const points = Object.entries(output).map(([field, value]) => RecordedDataPointSchema.parse({ direction: "read", field, value,
      execution: { runId: "00000000-0000-4000-8000-000000000001", traceId: "oc-000000-1111", attempt: 1,
        workflowId: "ocr", nodeId: task === retainedOcrStore.tasks.readResult ? "read-result" : "build-review", taskId: task.contract.id },
      recordedAt: "2026-11-08T00:00:00.000Z", origins: observationLeafPaths(value).map(path => ({ path,
        origin: { runId: "00000000-0000-4000-8000-000000000001", attempt: 1, spanPath: "oc-000000-1111/task", nodeId: "historical",
          taskId: task.contract.id, field, path } })) }));
    const redacted = redactRetainedOcrObservedDataPoints(task.contract.id, points);
    assert.deepEqual(redacted.map(point => point.origins), points.map(point => point.origins));
    assert.equal(JSON.stringify(redacted).includes("Historical Private Name"), false);
    const prefix = task === retainedOcrStore.tasks.readResult ? "review." : "";
    assert.deepEqual(redacted.flatMap(point => point.values).find(value => value.key === `${prefix}roster.rows`),
      { key: `${prefix}roster.rows`, state: "redacted", classification: "sensitive-hr", transform: "drop" });
    assert.throws(() => observedData.redactObservedDataPoints(task.contract.id, points), /no declared evidence classification/u);
    assert.throws(() => redactRetainedOcrObservedDataPoints(task.contract.id, []), /too small|at least|empty/iu);
    assert.throws(() => redactRetainedOcrObservedDataPoints(task.contract.id, points.slice(1)));
    assert.throws(() => redactRetainedOcrObservedDataPoints(task.contract.id, [...points, points[0]]), /duplicate/u);
    assert.throws(() => redactRetainedOcrObservedDataPoints(task.contract.id, [...points, RecordedDataPointSchema.parse({ ...points[0], field: "unexpected", value: true })]));
    assert.throws(() => redactRetainedOcrObservedDataPoints(retainedOcrStore.tasks.readSourcePages.contract.id, points), /Unsupported/u);
    assert.throws(() => redactRetainedOcrObservedDataPoints(task.contract.id, points.map(point => ({ ...point, direction: "write" }))));
    assert.throws(() => redactRetainedOcrObservedDataPoints(task.contract.id, points.map(point => ({ ...point,
      value: point.field === (prefix === "" ? "accounting" : "review") ? { unexpected: true } : point.value }))));
  }
});

it("reads an original-schema produced review and approval after reopening, and retains its protected checkpoint authority", async () => {
  const currentRedactor = observedData.redactObservedDataPoints;
  const historical = vi.spyOn(observedData, "redactObservedDataPoints").mockImplementation((taskId, points) =>
    taskId === retainedOcrStore.tasks.readResult.contract.id || taskId === retainedOcrStore.tasks.readReviewSeed.contract.id
      ? redactRetainedOcrObservedDataPoints(taskId, points) : currentRedactor(taskId, points));
  try {
    const f = await world.fixture({ record: true, release: true, retainedProducer: true });
    assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
    const request = approval(f);
    assert.equal(f.canonical.kernel.execute(request).state, "applied");
    const completed = await f.canonical.execute(f.run, new AbortController().signal);
    assert.ok(completed.run?.lifecycle.state === "terminal" && completed.run.lifecycle.outcome === "done");
    const original = f.database.authority.ocrReviews.revision(f.run.envelope.runId, 1); assert.ok(original?.origin.kind === "checkpoint");
    const checkpoint = f.database.authority.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "read-result", 1)[0]; assert.ok(checkpoint);
    assert.equal(checkpoint.output.schemaHash, deriveSchemaHash(RetainedOcrResultSchema, "output"));
    assert.equal(checkpoint.output.schemaHash, "40c74ca822894496cea565cc81c0e89264a3aaf290ec98b32b20415bae77014e");
    assert.notEqual(checkpoint.output.schemaHash, deriveSchemaHash(ReadOcrResult.output, "output"));
    const before = canonicalJsonStringify(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId));
    const publicationId = deriveStableUuid("timeline-checkpoint-recorded", checkpointRecordKey(checkpoint));
    const publication = f.database.authority.timelineEvents.get(publicationId); assert.ok(publication);
    assert.throws(() => f.database.withAuthorityTransaction(repositories => {
      repositories.timelineEvents.pruneBefore("2099-01-01");
      assert.deepEqual(repositories.timelineEvents.get(publicationId), publication);
      throw new Error("restore-ordinary-gate-evidence");
    }), /restore-ordinary-gate-evidence/u);
    const reviewed = readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId); assert.ok(reviewed);
    assert.equal(canonicalJsonStringify(readOcrSnapshotsAuthority(f.database.authority, reviewed)), before);
    for (const mutation of ["schemaHash", "value", "origin", "event-missing", "event-digest"] as const) {
      const altered = { ...checkpoint, output: { ...checkpoint.output,
        ...(mutation === "schemaHash" ? { schemaHash: FingerprintSchema.parse("a".repeat(64)) } : {}),
        ...(mutation === "value" ? { value: {} } : {}),
      } };
      const origin = mutation === "schemaHash" ? { ...original.origin, digest: sha256Hex(canonicalJsonStringify(altered)), checkpoint: timelineCheckpointReference(altered) }
        : mutation === "origin" ? { ...original.origin, digest: "a".repeat(64) } : original.origin;
      const repositories = f.database.authority;
      const tampered: AuthorityRepositories = { ...repositories,
        runCheckpoints: { ...repositories.runCheckpoints, listByAttempt: (...args) => repositories.runCheckpoints.listByAttempt(...args)
          .map(row => row === checkpoint || row.nodeId === "read-result" && row.runId === checkpoint.runId ? altered : row) },
        ocrReviews: { ...repositories.ocrReviews, revision: (runId, revision) => {
          const row = repositories.ocrReviews.revision(runId, revision);
          return row?.id === original.id ? OcrReviewRevisionSchema.parse({ ...row, origin }) : row;
        } },
        timelineEvents: { ...repositories.timelineEvents, get: id => {
          const row = repositories.timelineEvents.get(id);
          if (row?.payload.kind !== "checkpoint-recorded" || row.payload.checkpoint.nodeId !== "read-result") return row;
          if (mutation === "event-missing") return undefined;
          return mutation === "event-digest" ? { ...row, payload: { ...row.payload, checkpoint: { ...row.payload.checkpoint,
            outputDigest: FingerprintSchema.parse("a".repeat(64)) } } } : row;
        } },
      };
      assert.throws(() => readOcrReviewAuthority(tampered, f.canonical.lifecycle, f.run.envelope.runId), /OCR_REVIEW_REFUSED/u);
    }
    await f.harness.manager.closeAll("worker-stop"); f.database.close();
    const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "retained-ocr-read" }, f.clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    f.harness.authority.replaceClosedDatabase(reopened);
    const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID }, resolveDescriptor: f.resolve,
      publishQueued: () => { throw new Error("retained-review-read-is-readonly"); } });
    const read = readOcrReviewAuthority(reopened.authority, reader, f.run.envelope.runId); assert.ok(read);
    assert.equal(canonicalJsonStringify(readOcrSnapshotsAuthority(reopened.authority, read)), before);
    assert.deepEqual(reopened.authority.ocrReviews.revision(f.run.envelope.runId, 1), original);
  } finally { historical.mockRestore(); }
});

it("refuses a changed full revision whose compact checkpoint still matches retained evidence", async () => {
  const f = await world.fixture({ record: true });
  const repositories = f.database.authority, runId = f.run.envelope.runId;
  const original = repositories.ocrReviews.latest(runId); assert.ok(original);
  const outcome = original.seed.review.accounting.outcomes[0];
  assert.ok(outcome.state === "done" && outcome.output.extraction.record !== null && outcome.output.extraction.source.kind === "operator");
  const retained = repositories.ocrExtractions.get(outcome.output.extractionId); assert.ok(retained);
  const { pageFingerprint: _pageFingerprint, record, ...metadata } = outcome.output.extraction;
  assert.ok(record);
  const reading = bindManualOcrPageReading(outcome.output.input, outcome.output.extraction.source.actorId, { ...metadata,
    record: { answers: Object.fromEntries(record.answers.map(answer => [answer.path, answer.path === "contact.cellPhone"
      ? { state: "read", raw: "530-555-0101", confidence: 1 } : answer.state === "absent"
        ? { state: "absent", reason: answer.reason } : { state: "read", raw: answer.raw, confidence: answer.confidence }])) } });
  const { sourceRunId, roster, accounting } = original.seed.review;
  const seed = { ...original.seed, review: buildOcrReviewSeed({ ...(sourceRunId === undefined ? {} : { sourceRunId }), roster,
    accounting: { ...accounting, outcomes: [{ ...outcome, output: reading }, ...accounting.outcomes.slice(1)] } }) };
  assert.notDeepEqual(seed.review, original.seed.review);
  assert.deepEqual(compactOcrResult(seed), compactOcrResult(original.seed));
  assert.deepEqual(repositories.ocrExtractions.get(outcome.output.extractionId), retained);
  assert.deepEqual(readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId)?.revision, original);
  const changed = OcrReviewRevisionSchema.parse({ ...original, seed, records: initialOcrReviewRecords(seed) });
  const tampered: AuthorityRepositories = { ...repositories, ocrReviews: { ...repositories.ocrReviews,
    latest: id => id === runId ? changed : repositories.ocrReviews.latest(id),
    revision: (id, revision) => id === runId && revision === 1 ? changed : repositories.ocrReviews.revision(id, revision),
  } };
  assert.throws(() => readOcrReviewAuthority(tampered, f.canonical.lifecycle, runId), /OCR_REVIEW_REFUSED/u);
});

it("hydrates compact review checkpoints only from retained source-bound readings", async () => {
  const f = await world.fixture({ record: true });
  const repositories = f.database.authority;
  const checkpoint = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "build-review", 1).at(-1);
  const revision = repositories.ocrReviews.latest(f.run.envelope.runId);
  assert.ok(checkpoint && revision);
  assert.deepEqual(readOcrReviewCheckpointSeed(repositories, f.run, checkpoint.output.value), revision.seed.review);
  const missing: AuthorityRepositories = { ...repositories,
    ocrExtractions: { ...repositories.ocrExtractions, get: () => undefined } };
  assert.throws(() => readOcrReviewCheckpointSeed(missing, f.run, checkpoint.output.value), /OCR_REVIEW_REFUSED/u);
  assert.throws(() => readOcrReviewCheckpointSeed(repositories, f.run, { ...revision.seed.review }), /OCR_REVIEW_REFUSED/u);
});

it("appends journal-bound corrections, discards and restores with revision CAS and exact command replay", async () => {
  const f = await world.fixture({ record: true });
  const original = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
  const correction = f.command("correct-ocr-record", 1);
  const runVersion = f.database.authority.runs.get(f.run.envelope.runId)?.version; assert.ok(runVersion);
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  assert.equal(f.canonical.kernel.execute(correction).state, "already-applied");
  const divergent = f.canonical.kernel.execute({ ...correction, requestedAt: "2026-11-03T00:00:00.000Z" });
  assert.ok(divergent.state === "rejected" && divergent.code === "command-divergent");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.revision, 2);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.version, runVersion + 1);
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 1)).state, "conflict");
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2)).state, "applied");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.records[0]?.discarded, true);
  assert.equal(f.canonical.kernel.execute(f.command("restore-ocr-record", 3)).state, "applied");
  const read = readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId); assert.ok(read);
  assert.equal(read.revision.revision, 4);
  assert.equal(read.revision.records[0]?.discarded, false);
  assert.deepEqual(f.database.authority.ocrReviews.revision(f.run.envelope.runId, 1), original);
  assert.deepEqual(f.database.authority.ocrExtractions.get(f.reading.extractionId), { ...f.reading, binding: "source-bound" });
  const foreign = f.canonical.kernel.execute({ ...f.command("discard-ocr-record", 4), target: { runId: randomUUID(), expectedRevision: 4 } });
  assert.ok(foreign.state === "rejected" && foreign.code === "OCR_REVIEW_REFUSED");
});

it.each(["correct-ocr-record", "discard-ocr-record", "restore-ocr-record"] as const)("refuses delayed %s after approval without changing frozen authority", async type => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2 });
  const correction = f.command("correct-ocr-record", 1);
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  const runId = f.run.envelope.runId, repositories = f.database.authority;
  const tabB = readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId); assert.ok(tabB);
  assert.equal(tabB.revision.revision, 2);
  let delayed = CommandRequestSchema.parse(f.command(type, tabB.revision.revision));
  if (delayed.family === "ocr-review" && delayed.type === "correct-ocr-record") delayed = CommandRequestSchema.parse({ ...delayed,
    payload: { ...delayed.payload, assertedEid: "10800001" } });
  const selected = [tabB.revision.records[0].recordId], consent = approval(f, selected);
  assert.equal(f.canonical.kernel.execute(consent).state, "applied");
  const observe = () => ({ review: repositories.ocrReviews.latest(runId), run: repositories.runs.get(runId),
    snapshots: repositories.ocrReviews.snapshots(runId), gate: repositories.gateResults.get(`${runId}:approve-records`),
    generation: f.database.getMeta().authorityGeneration });
  const frozen = observe(); assert.ok(frozen.run && frozen.review);
  assert.equal(frozen.run.lifecycle.state, "queued");
  assert.equal(runClaim(frozen.run), undefined);
  assert.equal(frozen.review.revision, delayed.family === "ocr-review" ? delayed.target.expectedRevision : undefined);
  assert.deepEqual(frozen.snapshots[0].selectedRecordIds, selected);
  assert.equal(frozen.snapshots[0].records[0].assertedEid, "10800000");
  const refused = f.canonical.kernel.execute(delayed);
  assert.equal(refused.state, "rejected");
  if (refused.state === "rejected") assert.equal(refused.code, "OCR_REVIEW_REFUSED");
  assert.deepEqual(observe(), frozen);
  assert.equal(repositories.commands.get(delayed.commandId), undefined);
  assert.equal(repositories.commandAudits.findByCommand(delayed.commandId), undefined);
  assert.equal(repositories.lifecycleJournal.getCommand(lifecycleCommandId("operator-ocr-review", delayed.commandId)), undefined);
  assert.deepEqual(f.sources.commandResult(runId, delayed.commandId), { state: "unavailable" });
  const historical = f.sources.commandResult(runId, correction.commandId); assert.ok(historical.state === "recorded");
  assert.deepEqual(historical.request, CommandRequestSchema.parse(correction));
  assert.equal(historical.result.state, "applied");
  assert.equal(f.canonical.kernel.execute(correction).state, "already-applied");
  assert.equal(f.canonical.kernel.execute(consent).state, "already-applied");
  assert.deepEqual(observe(), frozen);
});

it("rolls snapshot creation back with gate failure, then replays the original approved snapshot through parent resume", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.result.run?.lifecycle.state, "parked-gate");
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const request = approval(f);
  const transact = f.database.withAuthorityTransaction.bind(f.database);
  const generation = f.database.getMeta().authorityGeneration;
  f.database.withAuthorityTransaction = work => transact(repositories => work({ ...repositories,
    gateResults: { ...repositories.gateResults, insert: () => { throw new Error("injected-gate-insert-failure"); } } }));
  try { assert.throws(() => f.canonical.kernel.execute(request), /injected-gate-insert-failure/u); }
  finally { f.database.withAuthorityTransaction = transact; }
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.database.authority.commands.get(request.commandId), undefined);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-gate");
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  assert.equal(f.canonical.kernel.execute(request).state, "already-applied");
  const snapshot = f.database.authority.ocrReviews.snapshot(request.commandId); assert.ok(snapshot);
  const manifests = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId);
  const children = manifests.flatMap(manifest => manifest.children.map(child => ({
    run: f.database.authority.runs.get(child.childRunId), result: f.database.authority.runResults.get(child.childRunId),
  })));
  const resumed = await f.canonical.execute(f.run, new AbortController().signal);
  assert.ok(resumed.run?.lifecycle.state === "terminal" && resumed.run.lifecycle.outcome === "done");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  assert.deepEqual(OcrWorkflowResultSchema.parse(result.result.value).approvedSnapshot, request.payload.result.value);
  assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId), manifests);
  assert.deepEqual(manifests.flatMap(manifest => manifest.children.map(child => ({
    run: f.database.authority.runs.get(child.childRunId), result: f.database.authority.runResults.get(child.childRunId),
  }))), children);
  const gate = f.database.authority.gateResults.get(`${f.run.envelope.runId}:approve-records`); assert.ok(gate);
  assert.deepEqual(result.dependencies.find(dependency => dependency.nodeId === gate.nodeId), terminalGateDependencyRecord(gate.nodeId, gate));
  const review = readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId); assert.ok(review);
  assert.deepEqual(readOcrSnapshotsAuthority(f.database.authority, review), [snapshot]);
});

it("refuses stale approval and late drafts while retaining the immutable snapshot through restart", async () => {
  const f = await world.fixture({ record: true, release: true });
  const correction = f.command("correct-ocr-record", 1);
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  const stale = approval(f);
  const discard = f.command("discard-ocr-record", 2);
  assert.equal(f.canonical.kernel.execute(discard).state, "applied");
  const currentRun = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(currentRun);
  const refused = f.canonical.kernel.execute({ ...stale, target: { ...stale.target, expectedVersion: currentRun.version } });
  assert.ok(refused.state === "rejected" && refused.code === "invalid-state");
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  const restore = f.command("restore-ocr-record", 3);
  assert.equal(f.canonical.kernel.execute(restore).state, "applied");
  const request = approval(f);
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const saved = f.database.authority.ocrReviews.snapshot(request.commandId); assert.ok(saved);
  assert.deepEqual(requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, request.payload.result.value, f.resolve), saved);
  const late = f.canonical.kernel.execute(f.command("discard-ocr-record", 4));
  assert.ok(late.state === "rejected" && late.code === "OCR_REVIEW_REFUSED");
  for (const command of [correction, discard, restore]) {
    const result = f.sources.commandResult(f.run.envelope.runId, command.commandId); assert.ok(result.state === "recorded");
    assert.deepEqual(result.request, CommandRequestSchema.parse(command));
    assert.equal(f.canonical.kernel.execute(command).state, "already-applied");
  }
  assert.deepEqual(f.database.authority.ocrReviews.snapshot(request.commandId), saved);
  assert.deepEqual(requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, request.payload.result.value, f.resolve), saved);
  const staleReference = { ...request.payload.result.value, revision: 3 };
  assert.throws(() => requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, staleReference, f.resolve), /OCR_REVIEW_REFUSED/u);
  const current = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(current);
  const repositories = f.database.authority, gateKey = `${f.run.envelope.runId}:approve-records`;
  const gate = repositories.gateResults.get(gateKey); assert.ok(gate);
  const altered: AuthorityRepositories = { ...repositories, gateResults: { ...repositories.gateResults,
    get: key => key === gateKey ? { ...gate, result: { ...gate.result, value: staleReference } } : repositories.gateResults.get(key) } };
  assert.throws(() => assertOcrRecoverySnapshotCurrent(altered, f.canonical.lifecycle, current, f.resolve), /ocr-approved-snapshot-recovery-refused/u);
  assert.doesNotThrow(() => assertOcrRecoverySnapshotCurrent(repositories, f.canonical.lifecycle, current, f.resolve));
  await f.harness.manager.closeAll("worker-stop");
  f.database.close();
  const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "ocr-review-restart" }, f.clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  f.harness.authority.replaceClosedDatabase(reopened);
  const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("unexpected enqueue"); } });
  const read = readOcrReviewAuthority(reopened.authority, reader, f.run.envelope.runId); assert.ok(read);
  assert.equal(read.revision.revision, 4);
  assert.deepEqual(readOcrSnapshotsAuthority(reopened.authority, read), [saved]);
  assert.equal(reopened.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "queued");
});

it("freezes only the explicit selected subset and refuses unknown or discarded members", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2 });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  assert.equal(review.records.length, 2);
  const first = review.records[0]; assert.ok(first);
  const candidate = approval(f, [first.recordId]);
  const foreign = { ...candidate, commandId: randomUUID(), payload: { ...candidate.payload,
    ocrApproval: { ...candidate.payload.ocrApproval, selectedRecordIds: [`${"f".repeat(64)}#emergency-contact#99`] } } };
  assert.equal(f.canonical.kernel.execute(foreign).state, "rejected");
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2)).state, "applied");
  const discarded = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(discarded);
  const currentRun = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(currentRun);
  assert.equal(f.canonical.kernel.execute({ ...candidate, commandId: randomUUID(), target: { ...candidate.target, expectedVersion: currentRun.version }, payload: { ...candidate.payload,
    ocrApproval: { ...candidate.payload.ocrApproval, expectedRevision: 3, reviewDigest: ocrReviewDigest(discarded) } } }).state, "rejected");
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.canonical.kernel.execute(f.command("restore-ocr-record", 3)).state, "applied");
  const request = approval(f, [first.recordId]);
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const snapshot = f.database.authority.ocrReviews.snapshot(request.commandId); assert.ok(snapshot);
  assert.deepEqual(snapshot.selectedRecordIds, [first.recordId]);
  assert.equal(snapshot.records.length, 1);
});

it("refuses native overwrite, replacement and deletion of source, review and approval evidence", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(approval(f)).state, "applied");
  const raw = new DatabaseSync(f.path);
  try {
    for (const table of ["ocr_source_uploads", "ocr_review_revisions", "ocr_approved_snapshots"]) {
      assert.throws(() => raw.exec(`UPDATE ${table} SET payload_json='{}'`), /ocr-evidence-immutable/u);
      assert.throws(() => raw.exec(`DELETE FROM ${table}`), /ocr-evidence-retained/u);
      assert.throws(() => raw.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /ocr-evidence-replace-refused/u);
    }
    assert.throws(() => raw.exec(`INSERT OR REPLACE INTO ocr_review_revisions
      SELECT id||':foreign',run_id,revision,command_id,payload_json,created_at FROM ocr_review_revisions WHERE revision=1`), /ocr-evidence-replace-refused/u);
    assert.throws(() => raw.exec(`INSERT OR REPLACE INTO ocr_review_revisions
      SELECT id||':foreign',run_id,revision+10,command_id,payload_json,created_at FROM ocr_review_revisions WHERE command_id IS NOT NULL`), /ocr-evidence-replace-refused/u);
  } finally { raw.close(); }
});

it("refuses foreign, missing and altered revision command, audit, run and lifecycle proof without changing authority", async () => {
  const f = await world.fixture({ record: true });
  const correction = f.command("correct-ocr-record", 1);
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  const repositories = f.database.authority, runId = f.run.envelope.runId;
  const current = readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId); assert.ok(current);
  const command = repositories.commands.get(correction.commandId); assert.ok(command?.family === "ocr-review");
  const audit = repositories.commandAudits.findByCommand(correction.commandId); assert.ok(audit?.result.state === "applied");
  const journalId = lifecycleCommandId("operator-ocr-review", command.commandId);
  const settled = repositories.lifecycleJournal.findAuditByCommand(journalId);
  assert.ok(settled !== undefined && "kind" in settled && settled.kind === "run-lifecycle" && settled.result.kind === "run");
  const appliedVersion = settled.result.appliedVersion;
  const foreignRun = randomUUID();
  const foreignRevision = OcrReviewRevisionSchema.parse({ ...current.revision, sourceRunId: foreignRun, id: `${foreignRun}#2` });
  const variants: ReadonlyArray<readonly [string, AuthorityRepositories]> = [
    ["missing command", replaceOcrCommandRead(repositories, command.commandId, undefined)],
    ...([
      ["foreign command", { ...command, commandId: randomUUID() }],
      ["foreign actor", { ...command, requestedBy: "foreign-operator" }],
      ["foreign source", { ...command, source: "run-detail" }],
      ["foreign run", { ...command, target: { ...command.target, runId: foreignRun } }],
      ["altered revision", { ...command, target: { ...command.target, expectedRevision: 2 } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrCommandRead(repositories, command.commandId, CommandRequestSchema.parse(candidate))] as const),
    ["missing audit", replaceOcrAuditRead(repositories, command.commandId, undefined)],
    ...([
      ["divergent audit", { ...audit, request: { ...command, requestedBy: "foreign-operator" } }],
      ["foreign audit result", { ...audit, result: { ...audit.result, commandId: randomUUID() } }],
      ["unapplied audit", { ...audit, result: { state: "rejected", commandId: command.commandId, code: "invalid-state", message: "Synthetic refusal" } }],
      ["missing revision advance", { ...audit, versionChanges: audit.versionChanges.filter(change => change.target.family !== "ocr-review") }],
      ["missing run advance", { ...audit, versionChanges: audit.versionChanges.filter(change => change.target.family !== "run") }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrAuditRead(repositories, command.commandId, CommandAuditRecordSchema.parse(candidate))] as const),
    ["foreign current run", { ...repositories, ocrReviews: { ...repositories.ocrReviews, latest: () => foreignRevision } }],
    ["missing revision", { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      revision: (id, revision) => revision === 2 ? undefined : repositories.ocrReviews.revision(id, revision) } }],
    ["foreign revision run", { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      revision: (id, revision) => revision === 2 ? foreignRevision : repositories.ocrReviews.revision(id, revision) } }],
    ["missing lifecycle command", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      getCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.getCommand(id) } }],
    ["missing lifecycle audit", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.findAuditByCommand(id) } }],
    ["altered lifecycle version", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? RunLifecycleCommandAuditRecordSchema.parse({ ...settled,
        result: { ...settled.result, appliedVersion: appliedVersion + 1 } }) : repositories.lifecycleJournal.findAuditByCommand(id) } }],
  ];
  const generation = f.database.getMeta().authorityGeneration;
  for (const [name, altered] of variants) assert.throws(() => readOcrReviewAuthority(altered, f.canonical.lifecycle, runId), /OCR_REVIEW_REFUSED/u, name);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId), current);
});

it("refuses foreign, missing and altered snapshot, approval, gate and lifecycle proof without changing authority", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const request = approval(f);
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const repositories = f.database.authority, runId = f.run.envelope.runId;
  const review = readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId); assert.ok(review);
  const saved = readOcrSnapshotsAuthority(repositories, review); assert.equal(saved.length, 1);
  const snapshot = saved[0]; assert.ok(snapshot);
  const command = repositories.commands.get(request.commandId); assert.ok(command?.family === "gate");
  const audit = repositories.commandAudits.findByCommand(request.commandId); assert.ok(audit?.result.state === "applied");
  const journalId = lifecycleCommandId("operator-gate", command.commandId);
  const settled = repositories.lifecycleJournal.findAuditByCommand(journalId);
  assert.ok(settled !== undefined && "kind" in settled && settled.kind === "run-lifecycle" && settled.result.kind === "run");
  const appliedVersion = settled.result.appliedVersion;
  const foreign = randomUUID();
  const first = snapshot.records[0]; assert.ok(first);
  const foreignRecordId = `${"f".repeat(64)}#emergency-contact#99`;
  const variants: ReadonlyArray<readonly [string, AuthorityRepositories]> = [
    ["missing command", replaceOcrCommandRead(repositories, command.commandId, undefined)],
    ...([
      ["foreign command", { ...command, commandId: foreign }],
      ["foreign actor", { ...command, requestedBy: "foreign-operator" }],
      ["foreign source", { ...command, source: "run-detail" }],
      ["foreign run", { ...command, target: { ...command.target, runId: foreign } }],
      ["foreign gate", { ...command, target: { ...command.target, gateId: "foreign-gate" } }],
      ["missing selection", { ...command, payload: { result: command.payload.result } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrCommandRead(repositories, command.commandId, CommandRequestSchema.parse(candidate))] as const),
    ["missing audit", replaceOcrAuditRead(repositories, command.commandId, undefined)],
    ...([
      ["divergent audit", { ...audit, request: { ...command, requestedBy: "foreign-operator" } }],
      ["foreign audit result", { ...audit, result: { ...audit.result, commandId: foreign } }],
      ["unapplied audit", { ...audit, result: { state: "rejected", commandId: command.commandId, code: "invalid-state", message: "Synthetic refusal" } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrAuditRead(repositories, command.commandId, CommandAuditRecordSchema.parse(candidate))] as const),
    ["missing revision", { ...repositories, ocrReviews: { ...repositories.ocrReviews, revision: () => undefined } }],
    ...([
      ["foreign snapshot run", { ...snapshot, sourceRunId: foreign }],
      ["altered review digest", { ...snapshot, reviewDigest: "f".repeat(64) }],
      ["foreign selected member", { ...snapshot, selectedRecordIds: [foreignRecordId], records: [{ ...first, recordId: foreignRecordId }] }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      snapshots: () => [OcrApprovedSnapshotSchema.parse(candidate)] } }] as const),
    ["missing gate", { ...repositories, gateResults: { ...repositories.gateResults, listByRun: () => [] } }],
    ["foreign gate actor", { ...repositories, gateResults: { ...repositories.gateResults,
      listByRun: id => repositories.gateResults.listByRun(id).map(gate => "commandId" in gate
        ? { ...gate, resolvedBy: ActorIdSchema.parse("foreign-operator") } : gate) } }],
    ["missing lifecycle command", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      getCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.getCommand(id) } }],
    ["missing lifecycle audit", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.findAuditByCommand(id) } }],
    ["altered lifecycle version", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? RunLifecycleCommandAuditRecordSchema.parse({ ...settled,
        result: { ...settled.result, appliedVersion: appliedVersion + 1 } }) : repositories.lifecycleJournal.findAuditByCommand(id) } }],
  ];
  const generation = f.database.getMeta().authorityGeneration;
  for (const [name, altered] of variants) assert.throws(() => readOcrSnapshotsAuthority(altered, review), /OCR_REVIEW_REFUSED/u, name);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(readOcrSnapshotsAuthority(repositories, review), saved);
});
