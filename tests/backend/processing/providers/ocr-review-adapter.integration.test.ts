import { OCR_ROSTER_TYPE_ID, OCR_ROSTER_FIELDS } from "../../../../src/models/workflows/ocr/roster.js";
import { ocrStore } from "../../../../src/backend/processing/ocr/task-registry.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { randomUUID } from "node:crypto";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, beforeEach, it } from "vitest";
import { createOcrReviewAdapter } from "../../../../src/backend/processing/providers/ocr-review-adapter.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { delegationEvidenceOutput } from "../../../../src/models/run/result.js";
import { ReadApprovedOcrRecords } from "../../../../src/models/processing/ocr/read-approved-records.js";
import { OcrWorkflowResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { OcrInputSchema, OcrCanonicalInputSchema, OCR_INPUT_EXAMPLE } from "../../../../src/models/workflows/ocr/input.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow, composeWorkflowModule, defineStepEntries } from "../../../../src/workflow-kit/workflow-definition.js";
import { compileFixtureWorkflow } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { ocrProofReadDatabase } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { OcrApprovedSnapshotSchema } from "../../../../src/models/ocr/review.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WorkflowIdSchema, NodeIdSchema } from "../../../../src/rules/identity/ids.js";
import type { z } from "zod";

const documentsStep = { key: "documents", label: "Documents" } as const;
const parent = composeWorkflowModule(compileFixtureWorkflow(defineWorkflow({
  id: "ocr-selection-parent", version: 1, code: "osp", label: "Selection parent", icon: "FileScan", category: "documents",
  input: OcrInputSchema, canonicalInput: defineCanonicalInput(OcrInputSchema, OcrCanonicalInputSchema, [OCR_INPUT_EXAMPLE]),
  requiredWorkbookTypeIds: [OCR_ROSTER_TYPE_ID], referenceLookups: () => [{ mode: "all", typeId: OCR_ROSTER_TYPE_ID, fields: [...OCR_ROSTER_FIELDS] }],
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], role: defineWorkflowRole({ kind: "composition" }), scenarios: ["ocr/approved-records"],
  identity: { matchKey: input => input.document.sha256 }, presentation: { title: () => "Selection parent" },
  steps: ({ delegate, task, result }) => {
    const source = delegate({ id: "read-documents", target: { id: WorkflowIdSchema.parse("ocr"), input: OcrInputSchema, result: OcrWorkflowResultSchema },
      edgeId: "documents", cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    }, [], { bind: ({ input }) => [input], deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const approved = task(defineStepEntries(documentsStep).task("approved", ReadApprovedOcrRecords, { replay: "always-rerun" }), [source], ({ outputs }) => ({ delegationNodeId: NodeIdSchema.parse("read-documents"), outcomes: [...outputs["read-documents"]] }));
    return { steps: [[documentsStep, [source, approved]]], result: result(ReadApprovedOcrRecords.output, [approved], ({ outputs }) => outputs.approved) };
  },
})), [ocrStore]);
const world = createOcrReviewWorld();
let fixtureBuilds = 0;
afterAll(async () => { try { assert.equal(fixtureBuilds, 1); } finally { await world.cleanup(); } });

async function buildBulkFixture() {
  fixtureBuilds++;
  const pageCount = 2;
  const f = await world.fixture({ record: true, release: true, pageCount, parent });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1, pageCount - 1)).state, "applied");
  const revision = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(revision);
  const approval = f.approval([revision.records[pageCount - 1].recordId]);
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  const completed = await f.canonical.step(f.parentRun, new AbortController().signal);
  assert.equal(completed.run.envelope.runId, f.run.envelope.runId);
  assert.equal(completed.outcome.state, "done");
  const owner = testWorkerLifetime(f.database, f.parentRun.envelope.workflow, 1), runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const claimed = f.canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.parentRun.envelope.workflow, workerId: owner.workerId, runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied" && "run" in claimed);
  assert.equal(claimed.run.envelope.runId, f.parentRun.envelope.runId);
  const claim = { workerId: owner.workerId, claimGeneration: claimed.run.claimGeneration };
  for (const state of ["validating", "running"] as const) {
    const current = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(current);
    assert.equal(f.canonical.lifecycle.workerTransition({ commandId: randomUUID(), runId: current.envelope.runId, claim, expectedVersion: current.version,
      lifecycle: { ...current.lifecycle, state, ...(state === "running" ? { currentNodeId: "approved" } : {}) } }).state, "applied");
  }
  const run = claimed.run;
  const outcomes = ReadApprovedOcrRecords.input.shape.outcomes.parse(delegationEvidenceOutput(readDelegationEvidence(f.database.authority, run.envelope.runId, "read-documents"), OcrWorkflowResultSchema));
  return { f, run, revision, input: { delegationNodeId: NodeIdSchema.parse("read-documents"), outcomes } };
}

let shared: Awaited<ReturnType<typeof buildBulkFixture>>;
let baseline: ReturnType<typeof custody>;
function custody() {
  const { f, run } = shared;
  return {
    meta: f.database.getMeta(), consumer: f.database.authority.runs.get(run.envelope.runId),
    source: f.database.authority.runs.get(f.run.envelope.runId),
    review: f.database.authority.ocrReviews.latest(f.run.envelope.runId),
    snapshots: f.database.authority.ocrReviews.snapshots(f.run.envelope.runId),
    gate: f.database.authority.gateResults.get(`${f.run.envelope.runId}:approve-records`),
    sourceResult: f.database.authority.runResults.get(f.run.envelope.runId),
    consumerResult: f.database.authority.runResults.get(run.envelope.runId),
  };
}
beforeAll(async () => { shared = await buildBulkFixture(); baseline = structuredClone(custody()); });
beforeEach(() => { assert.equal(fixtureBuilds, 1); assert.deepEqual(custody(), baseline); });
afterEach(() => { assert.deepEqual(custody(), baseline); });

function runningBulkFixture() {
  const { f, run, revision, input } = shared;
  let profileChecks = 0;
  const authority = (captured = run, resolveDescriptor: (id: string) => AnyWorkflowDescriptor | undefined = f.resolve) => createApprovedOcrRecordReader({ database: f.database, reader: f.canonical.lifecycle, run: captured, resolveDescriptor, assertCurrent: () => { profileChecks++; f.admission.assertProfileRuntime(); } });
  const adapter = createOcrReviewAdapter({ reader: authority(), clock: f.clock });
  const invoke = async (value: z.input<typeof ReadApprovedOcrRecords.input>) => adapter.invoke({ capability: "ocr.review",
    payload: { schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.input, "output"), value: ReadApprovedOcrRecords.input.parse(value) } },
  { signal: new AbortController().signal, deadlineMonotonicMs: Infinity, requestId: "fixture" });
  const read = async (value: z.input<typeof ReadApprovedOcrRecords.input> = input) => {
    const response = await invoke(value);
    assert.equal(response.response.state, "produced");
    if (response.response.state !== "produced") assert.fail("Selection read refused");
    return ReadApprovedOcrRecords.output.parse(response.response.value.value);
  };
  const refused = async (value: z.input<typeof ReadApprovedOcrRecords.input>) => {
    assert.deepEqual(await read(value), { state: "refused", code: "OCR_REVIEW_REFUSED" });
  };
  return { f, run, revision, input, authority, invoke, read, refused, profileCheckCount: () => profileChecks };
}

it("ocr/approved-records — reads only the corrected, explicitly selected records from an authenticated OCR child", async () => {
  const { f, revision, read, profileCheckCount } = runningBulkFixture();
  const result = await read();
  assert.equal(profileCheckCount(), 2);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") assert.fail("Selection read refused");
  assert.deepEqual(result.sources[0].snapshot.records.map(record => record.recordId), [revision.records[1].recordId]);
  assert.deepEqual(result.sources[0].snapshot.records[0].fields, f.corrected);
  assert.equal("fields" in result.sources[0].review.records[1], false);
  assert.equal(result.sources[0].review.accounting.outcomes.some(outcome => "output" in outcome), false);
});

it("refuses substituted bulk consumer custody, task and dependency authority", async () => {
  const { f, run, input, authority, read, refused } = runningBulkFixture();
  assert.equal((await read()).state, "ready");
  for (const captured of [
    RunRecordSchema.parse({ ...run, claimGeneration: Number(run.claimGeneration) + 1 }),
    RunRecordSchema.parse({ ...run, input: { ...run.input, parsed: { ...run.input.parsed, value: { ...OcrInputSchema.parse(run.input.parsed.value), formType: "i9" } } } }),
  ]) assert.throws(() => authority(captured).readSources(input), /OCR_REVIEW_REFUSED/u);
  assert.throws(() => authority(run, () => undefined).readSources(input), /OCR_REVIEW_REFUSED/u);
  const live = f.canonical.lifecycle.read(run.envelope.runId); assert.ok(live.state === "present");
  for (const changed of [
    { ...live.run, cancelRequested: true },
    { ...live.run, lifecycle: { state: "queued" } },
    { ...live.run, lifecycle: { ...live.run.lifecycle, currentNodeId: "read-documents" } },
    { ...live.run, lifecycle: { ...live.run.lifecycle, workerId: "foreign-worker" } },
  ]) {
    const current = RunRecordSchema.parse(changed);
    const reader = { read: (id: string) => id === run.envelope.runId ? { ...live, run: current } : f.canonical.lifecycle.read(id) };
    assert.throws(() => createApprovedOcrRecordReader({ database: f.database, run, reader, resolveDescriptor: f.resolve,
      assertCurrent: () => f.admission.assertProfileRuntime() }).readSources(input), /OCR_REVIEW_REFUSED/u);
  }
  await refused({ ...input, delegationNodeId: NodeIdSchema.parse("foreign") });
});

it("refuses incomplete, foreign, altered and stale native bulk selections", async () => {
  const { f, run, input, invoke, read, refused } = runningBulkFixture();
  const accepted = await read(); assert.equal(accepted.state, "ready");
  const generation = f.database.getMeta().authorityGeneration;
  await assert.rejects(invoke({ ...input, outcomes: [] }));
  for (const change of ["missing", "foreign", "altered"] as const) {
    const altered = input.outcomes.map(outcome => {
      assert.equal(outcome.state, "done");
      if (outcome.state !== "done" || outcome.output.approvedSnapshot === null) assert.fail("Missing fixture selection");
      return { ...outcome, output: { ...outcome.output, approvedSnapshot: change === "missing" ? null : {
        ...outcome.output.approvedSnapshot,
        ...(change === "foreign" ? { sourceRunId: run.envelope.runId } : { digest: "f".repeat(64) }),
      } } };
    });
    await refused({ ...input, outcomes: altered });
  }
  const selected = input.outcomes[0];
  assert.ok(selected?.state === "done" && selected.output.approvedSnapshot !== null);
  assert.equal(selected.output.approvedSnapshot.sourceRunId, f.run.envelope.runId);
  const snapshot = f.database.authority.ocrReviews.snapshot(selected.output.approvedSnapshot.snapshotId); assert.ok(snapshot);
  const selectedIndex = shared.revision.records.findIndex(record => record.recordId === snapshot.selectedRecordIds[0]);
  assert.equal(selectedIndex, shared.revision.records.length - 1);
  const discard = f.command("discard-ocr-record", 2, selectedIndex);
  const result = f.canonical.kernel.execute(discard);
  assert.ok(result.state === "rejected" && result.code === "OCR_REVIEW_REFUSED");
  assert.equal(f.database.authority.commands.get(discard.commandId), undefined);
  assert.equal(f.database.authority.commandAudits.findByCommand(discard.commandId), undefined);
  assert.deepEqual(custody(), baseline);
  const repositories = f.database.authority, sourceRunId = f.run.envelope.runId;
  const earlier = repositories.ocrReviews.revision(sourceRunId, 1); assert.ok(earlier);
  assert.notEqual(earlier.revision, snapshot.revision);
  const approvedRecord = snapshot.records[0], unselected = shared.revision.records.find(record => !snapshot.selectedRecordIds.includes(record.recordId));
  assert.ok(approvedRecord && unselected);
  for (const change of ["stale review", "altered selection"] as const) {
    const database = ocrProofReadDatabase(f.database, { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      latest: id => change === "stale review" && id === sourceRunId ? earlier : repositories.ocrReviews.latest(id),
      snapshots: id => repositories.ocrReviews.snapshots(id).map(value => change === "altered selection" && value.snapshotId === snapshot.snapshotId
        ? OcrApprovedSnapshotSchema.parse({ ...value, selectedRecordIds: [unselected.recordId], records: [{ ...approvedRecord, recordId: unselected.recordId }] }) : value),
    } });
    const invalid = createOcrReviewAdapter({ clock: f.clock, reader: createApprovedOcrRecordReader({ database, reader: f.canonical.lifecycle, run,
      resolveDescriptor: f.resolve, assertCurrent: () => f.admission.assertProfileRuntime() }) });
    const response = await invalid.invoke({ capability: "ocr.review",
      payload: { schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.input, "output"), value: input } },
    { signal: new AbortController().signal, deadlineMonotonicMs: Infinity, requestId: change });
    assert.equal(response.response.state, "produced");
    if (response.response.state !== "produced") assert.fail("Invalid selection protocol unavailable");
    assert.deepEqual(ReadApprovedOcrRecords.output.parse(response.response.value.value), { state: "refused", code: "OCR_REVIEW_REFUSED" }, change);
  }
  assert.deepEqual(custody(), baseline);
  assert.deepEqual(await read(), accepted);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
});
