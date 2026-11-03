import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { afterEach, it } from "vitest";
import { readOcrRecordBindings, readOcrQueueMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import type { DelegatedRecordBinding } from "../../../../src/models/workflow/delegated-record.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/operator.js";
import { buildRunDetail, readRunSection } from "../../../../src/backend/runs/queries/run-detail.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { OcrInputSchema, OcrCanonicalInputSchema, OCR_INPUT_EXAMPLE } from "../../../../src/models/workflows/ocr/input.js";
import { OcrWorkflowResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow, composeWorkflowModule, compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { compileFixtureWorkflow } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { FingerprintSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { ocrReviewCards } from "../../../../src/dashboard/surfaces/run-detail/review/review-model.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { buildOcr } from "../../../../src/workflows/ocr/steps/source-pages/step.js";
import type { ChildVisibility } from "../../../../src/models/workflow/delegation-policy.js";
import { ocrModule } from "../../../../src/backend/app/registries/workflow-registry.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

const parent = composeWorkflowModule(compileFixtureWorkflow(defineWorkflow({
  id: "ocr-navigation-parent", version: 1, code: "onp", label: "Navigation parent", icon: "FileScan", category: "documents",
  input: OcrInputSchema, canonicalInput: defineCanonicalInput(OcrInputSchema, OcrCanonicalInputSchema, [OCR_INPUT_EXAMPLE]),
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], role: defineWorkflowRole({ kind: "composition" }), scenarios: ["ocr/navigation"],
  identity: { matchKey: input => input.document.sha256 }, presentation: { title: () => "Navigation parent" },
  steps: ({ delegate, result }) => {
    const source = delegate({ id: "read-documents", target: { id: WorkflowIdSchema.parse("ocr"), input: OcrInputSchema, result: OcrWorkflowResultSchema },
      edgeId: "documents", cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "linked" },
    }, [], { bind: ({ input }) => [input], deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "documents", label: "Documents" }, [source]]], result: result(OcrCanonicalInputSchema, [], ({ input }) => input) };
  },
})), []);

function lookupVisibilityModule(visibility: ChildVisibility) {
  return composeWorkflowModule(compileWorkflow(defineWorkflow({ ...ocrWorkflow,
    steps: author => buildOcr({ ...author, delegate: (identity, references, binds) => author.delegate(
      identity.id === "lookup-identities" ? { ...identity, policy: { ...identity.policy, visibility } } : identity, references, binds) }),
  })), ocrModule.stores);
}

for (const visibility of ["inline", "linked", "hidden-unless-failed"] as const) {
  it(`retains authored ${visibility} visibility for a record-bound native lookup`, async () => {
    const f = await world.fixture({ record: true, release: true, lookupNames: ["Example, Avery"], pauseAtLookup: true, ocr: lookupVisibilityModule(visibility) });
    const presentation = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority, f.canonical.lifecycle,
      f.run.envelope.runId, id => f.resolve(id)?.label ?? id));
    assert.ok(presentation);
    assert.equal(presentation.members.length, visibility === "inline" ? 1 : 0);
    const group = f.database.authority.dependencies.groups(f.run.envelope.runId).find(({ group }) => group.invocation.nodeId === "lookup-identities");
    assert.ok(group);
    assert.equal(group.manifest.policy.visibility, visibility);
    assert.equal(group.group.children.length, 1);
    assert.equal(group.group.children[0]?.child.lifecycle.state, "queued");
    const child = group.group.children[0]; assert.ok(child);
    assert.ok(presentation.runIds.includes(child.child.envelope.runId));
  });
}

it("binds three records to two native queued lookups without duplicating their work", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 3,
    lookupNames: ["Example, Avery", "Example, Robin", "Example, Avery"], pauseAtLookup: true });
  const read = () => f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings(f.database.authority, f.run.envelope.runId));
  const source = read(); assert.ok(source);
  assert.equal(source.seed.records.length, 3);
  assert.equal(source.bindings.length, 3);
  const presentation = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority, f.canonical.lifecycle,
    f.run.envelope.runId, id => f.resolve(id)?.label ?? id));
  assert.ok(presentation);
  assert.equal(presentation.members.length, 3);
  assert.ok(presentation.members.every(member => member.kind === "record" && member.statusLabel === "Looking up"));
  assert.equal(new Set(presentation.runIds).size, 5);
  assert.equal(new Set(source.bindings.map(binding => binding.currentChildRunId)).size, 2);
  assert.deepEqual(source.bindings.map(binding => binding.record), source.seed.records.map(record => ({
    runId: f.run.envelope.runId, recordId: record.recordId,
  })));
  for (const binding of source.bindings) {
    assert.deepEqual(binding.childRunIds, [binding.currentChildRunId]);
    assert.equal(f.database.authority.runs.get(binding.currentChildRunId)?.lifecycle.state, "queued");
  }
  assert.equal(source.bindings[0]?.currentChildRunId, source.bindings[2]?.currentChildRunId);
  assert.notEqual(source.bindings[0]?.currentChildRunId, source.bindings[1]?.currentChildRunId);
  for (const [index, name] of ["Example, Avery", "Example, Robin", "Example, Avery"].entries()) {
    const binding: DelegatedRecordBinding | undefined = source.bindings[index]; assert.ok(binding);
    const child = f.database.authority.runs.get(binding.currentChildRunId); assert.ok(child);
    const input = PersonLookupInput.parse(child.input.parsed.value);
    assert.ok("name" in input); assert.equal(input.name, name);
  }
  const generation = f.database.getMeta().authorityGeneration;
  const checkpoints = f.database.authority.runCheckpoints;
  assert.throws(() => f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings({ ...f.database.authority,
    runCheckpoints: { ...checkpoints, listByAttempt: (...args) => checkpoints.listByAttempt(...args).map(checkpoint => checkpoint.nodeId !== "build-review" ? checkpoint : {
      ...checkpoint, output: { ...checkpoint.output, value: { ...source.seed, records: source.seed.records.toReversed() } },
    }) },
  }, f.run.envelope.runId)), /OCR_REVIEW_REFUSED/u);
  assert.deepEqual(read(), source);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  const original = source.bindings[0]; assert.ok(original);
  const child = f.database.authority.runs.get(original.currentChildRunId); assert.ok(child);
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: child.version } }).state, "applied");
  const cancelled = f.database.authority.runs.get(child.envelope.runId); assert.ok(cancelled);
  const retry = { commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: cancelled.version } };
  assert.equal(f.canonical.kernel.execute(retry).state, "applied");
  assert.equal(f.canonical.kernel.execute(retry).state, "already-applied");
  const retried = read(); assert.ok(retried);
  assert.deepEqual(retried.bindings.map(binding => binding.record), source.bindings.map(binding => binding.record));
  assert.equal(retried.bindings[0]?.currentChildRunId, retried.bindings[2]?.currentChildRunId);
  const replacement = retried.bindings[0]; assert.ok(replacement);
  assert.notEqual(replacement.currentChildRunId, original.currentChildRunId);
  assert.deepEqual(replacement.childRunIds, [original.currentChildRunId, replacement.currentChildRunId]);
  assert.deepEqual(retried.bindings[1], source.bindings[1]);

});

it("keeps unidentified records without inventing a lookup child or changing native storage", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 3, pauseAtLookup: true });
  const source = f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings(f.database.authority, f.run.envelope.runId));
  assert.ok(source);
  assert.equal(source.seed.records.length, 3);
  assert.deepEqual(source.bindings, []);
  const manifest = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId).find(entry => entry.edgeId === "ocr-identities");
  assert.ok(manifest);
  assert.deepEqual(manifest.children, []);
  assert.ok(source.seed.records.every(record => record.lookup.state === "unavailable"));
  const presentation = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority, f.canonical.lifecycle,
    f.run.envelope.runId, id => f.resolve(id)?.label ?? id));
  assert.ok(presentation);
  assert.equal(presentation.members.length, 3);
  assert.ok(presentation.members.every(member => member.kind === "record" && member.statusLabel === "Needs lookup"
    && member.target.section === "review" && member.target.record.recordId === member.record.recordId));
});

it("serves a linked OCR child's own review and timeline while its parent's record lines retain exact stable focus", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2, parent });
  const { database, clock } = f;
  const descriptors = { resolve: f.resolve };
  const projection = createOperatorProjection({ database, stateRoot: f.harness.authority.stateRoot, clock, reader: f.canonical.lifecycle,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
  const publications: string[] = [];
  const generation = database.getMeta().authorityGeneration;
  projection.onChange(change => database.withAuthorityTransaction(() => { publications.push(change.kind); }));
  projection.ingestFromTimeline();
  assert.deepEqual(publications, ["snapshot"]);
  assert.equal(database.getMeta().authorityGeneration, generation);
  const wire = projection.buildDashboardDayWire(clock.todayLocal());
  const parentRow = wire.queueSurfaces.find(row => row.runId === f.parentRun.envelope.runId);
  const childRow = wire.queueSurfaces.find(row => row.runId === f.run.envelope.runId);
  assert.ok(parentRow && childRow);
  assert.equal(parentRow.status, "running");
  assert.equal(childRow.status, "awaiting-approval");
  assert.equal(parentRow.surfaceKind, "operation");
  assert.equal(childRow.surfaceKind, "operation");
  if (parentRow.surfaceKind !== "operation" || childRow.surfaceKind !== "operation") assert.fail("Missing record presentations");
  assert.equal(childRow.parent?.visibility, "linked");
  assert.ok(parentRow.linkedRuns.some(link => link.runId === childRow.runId && link.panelKind === "review"));
  assert.deepEqual(parentRow.recordMembers, childRow.recordMembers);
  const refs = childRow.recordMembers?.members.map(member => {
    assert.equal(member.kind, "record");
    if (member.kind !== "record") assert.fail("Expected a person record");
    assert.equal(member.target.section, "review");
    return member.record;
  });
  assert.equal(refs?.length, 2);
  const deps = createOperatorRunDetail({ database, stateRoot: f.harness.authority.stateRoot, projection, runReader: f.canonical.lifecycle,
    canonical: { database, reader: f.canonical.lifecycle, descriptors } });
  const detail = buildRunDetail(deps, childRow.runId);
  assert.equal(detail.panelKind, "review");
  assert.equal(detail.header.workflowId, "ocr");
  const steps = detail.timeline.steps; assert.ok(steps);
  assert.ok(steps.some(step => step.key === "approval"));
  assert.ok(!steps.some(step => step.key === "documents"));
  const section = await readRunSection(deps, childRow.runId, "review");
  assert.equal(section.section, "review");
  if (section.section !== "review") assert.fail("Expected OCR review");
  assert.deepEqual(section.payload.ocr?.revision.records.map(record => ({ runId: childRow.runId, recordId: record.recordId })), refs);
  assert.ok(section.payload.records.every(record => !refs?.some(ref => ref.recordId === String(record.recordId))));
  const cards = ocrReviewCards(section.payload, (runId, revision, page) => `/source/${runId}/${revision}/${page}`);
  assert.deepEqual(cards.map(card => card.record.id), refs?.map(ref => ref.recordId));
  assert.deepEqual(cards.map(card => card.disposition.label), ["Pending", "Pending"]);
  assert.deepEqual(cards.map(card => card.pages[0].imageUrl), [1, 2].map(page => `/source/${childRow.runId}/1/${page}`));
  assert.equal(database.authority.runs.get(f.run.envelope.runId)?.envelope.shape, f.run.envelope.shape);
});
