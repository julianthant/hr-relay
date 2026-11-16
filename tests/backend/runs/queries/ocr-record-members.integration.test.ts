import { ocrModule } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { scaledMs } from "../../../support/time-scale.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { afterEach, it } from "vitest";
import { ocrHostRun, readOcrRecordBindings, readOcrQueueMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import type { DelegatedRecordBinding } from "../../../../src/models/workflow/delegated-record.js";
import { readDelegationScopeEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { OcrReviewCheckpointSchema } from "../../../../src/models/workflows/ocr/review-seed.js";
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
import { createNotificationTargetQuery } from "../../../../src/backend/runs/queries/notifications.js";
import { notificationRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { isQueueTopLevel } from "../../../../src/models/dashboard/queue-parent.js";
import { queueKeyboardEntries } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { ocrReviewCards } from "../../../../src/dashboard/surfaces/run-detail/review/review-model.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { buildOcr } from "../../../../src/workflows/ocr/steps/source-pages/step.js";
import type { ChildVisibility } from "../../../../src/models/workflow/delegation-policy.js";

import { assertMemberLogsServed } from "../../../support/helpers/backend/member-log-targets.js";
import { sessionFactoryHarness, healthyCrmDriver, EXECUTOR_EID } from "../../../support/helpers/phase1f-executor-harness.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

function failAveryLookupOnce(result: Parameters<typeof createDeterministicUcpathPersonOrgDriver>[0]) {
  let failed = false;
  return sessionFactoryHarness({ ucpath: () => {
    const driver = createDeterministicUcpathPersonOrgDriver(result);
    return { ...driver, async searchPersonOrg(input: Parameters<typeof driver.searchPersonOrg>[0]) {
      if (!failed && input.kind === "by-name" && input.name === "Example, Avery") {
        failed = true;
        throw new Error("Synthetic first UCPath lookup failure.");
      }
      return driver.searchPersonOrg(input);
    } };
  }, crm: () => healthyCrmDriver() });
}

function memberDeps(f: Awaited<ReturnType<typeof world.fixture>>) {
  const descriptors = { resolve: f.resolve };
  const projection = createOperatorProjection({ database: f.database, stateRoot: f.harness.authority.stateRoot, clock: f.clock, reader: f.canonical.lifecycle,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(f.database.authority), descriptors });
  projection.ingestFromTimeline();
  return createOperatorRunDetail({ database: f.database, stateRoot: f.harness.authority.stateRoot, projection, runReader: f.canonical.lifecycle,
    canonical: { database: f.database, reader: f.canonical.lifecycle, descriptors } });
}

const parent = composeWorkflowModule(compileFixtureWorkflow(defineWorkflow({
  requiredWorkbookFields: ocrWorkflow.requiredWorkbookFields, workbookReference: ocrWorkflow.workbookReference,
  id: "ocr-navigation-parent", version: 1, code: "onp", label: "Navigation parent", icon: "FileScan", category: "documents",
  input: OcrInputSchema, canonicalInput: defineCanonicalInput(OcrInputSchema, OcrCanonicalInputSchema, [OCR_INPUT_EXAMPLE]),
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], role: defineWorkflowRole({ kind: "composition" }), scenarios: ["ocr/navigation"],
  identity: { matchKey: input => input.document.sha256 }, presentation: { title: () => "Navigation parent" },
  steps: ({ delegate, result }) => {
    const source = delegate({ id: "read-documents", target: { id: WorkflowIdSchema.parse("ocr"), input: OcrInputSchema, result: OcrWorkflowResultSchema },
      edgeId: "documents", cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "hidden-unless-failed" },
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

it("binds three records to two native queued lookups and retains their shared failed-child retry history", async () => {
  const sessions = failAveryLookupOnce({ results: [], selection: { status: "not-found", selected: null, candidateEids: [], searchName: "Example, Robin" } });
  const f = await world.fixture({ record: true, release: true, pageCount: 3,
    lookupNames: ["Example, Avery", "Example, Robin", "Example, Avery"], pauseAtLookup: true, sessions });
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
  const queuedLookupIds = new Set(f.database.authority.runs.listChildren(f.run.envelope.runId).filter(run => run.envelope.workflow === "person-lookup").map(run => run.envelope.runId));
  assert.equal(assertMemberLogsServed(memberDeps(f), presentation.members), 3);
  assert.ok(presentation.members.every(member => queuedLookupIds.has(member.target.runId)), "lookup members open their own lookup child's log");
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
  const execution = await f.canonical.execute(f.run, new AbortController().signal);
  const child = f.database.authority.runs.get(original.currentChildRunId); assert.ok(child);
  assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
  const failure = execution.outcomes.find(outcome => outcome.state === "failed"); assert.ok(failure?.state === "failed");
  assert.equal(f.database.authority.failures.get(failure.failureId)?.code, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED");
  const failedMembers = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority, f.canonical.lifecycle,
    f.run.envelope.runId, id => f.resolve(id)?.label ?? id))?.members ?? [];
  const failedRows = failedMembers.filter(member => member.status === "failed");
  assert.equal(failedRows.length, 2);
  assert.ok(failedRows.every(member => member.target.section === "logs" && member.target.runId === child.envelope.runId), "failed members open the failed lookup child's log");
  assert.equal(assertMemberLogsServed(memberDeps(f), failedMembers), failedMembers.length);
  const retry = { commandId: randomUUID(), family: "run", type: "retry", source: "run-detail", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: child.version } };
  assert.equal(f.canonical.kernel.execute(retry).state, "applied");
  assert.equal(f.canonical.kernel.execute(retry).state, "already-applied");
  const retried = read(); assert.ok(retried);
  assert.deepEqual(retried.bindings.map(binding => binding.record), source.bindings.map(binding => binding.record));
  assert.equal(retried.bindings[0]?.currentChildRunId, retried.bindings[2]?.currentChildRunId);
  const replacement = retried.bindings[0]; assert.ok(replacement);
  assert.notEqual(replacement.currentChildRunId, original.currentChildRunId);
  assert.deepEqual(replacement.childRunIds, [original.currentChildRunId, replacement.currentChildRunId]);
  assert.deepEqual(retried.bindings[1], source.bindings[1]);

  const queued = f.database.authority.runs.get(replacement.currentChildRunId); assert.ok(queued);
  assert.equal(queued.lifecycle.state, "queued");
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: queued.envelope.runId, expectedVersion: queued.version } }).state, "applied");
  const cancelled = f.database.authority.runs.get(queued.envelope.runId); assert.ok(cancelled);
  assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  const parentBefore = f.database.authority.runs.get(f.run.envelope.runId);
  const childrenBefore = f.database.authority.runs.listChildren(f.run.envelope.runId);
  const bindingsBefore = read();
  const refused = f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "run-detail", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: cancelled.envelope.runId, expectedVersion: cancelled.version } });
  assert.ok(refused.state === "rejected" && refused.code === "RUN_CONTINUATION_REFUSED", JSON.stringify(refused));
  assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), parentBefore);
  assert.deepEqual(f.database.authority.runs.listChildren(f.run.envelope.runId), childrenBefore);
  assert.deepEqual(read(), bindingsBefore);
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

it("presents the hosted OCR run through its host: one visible row, the host serving the review and its members", async () => {
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
  assert.equal(childRow.parent?.visibility, "hidden-unless-failed");
  assert.equal(isQueueTopLevel(childRow), false);
  assert.deepEqual(parentRow.linkedRuns, []);
  assert.equal(parentRow.panelKind, "review");
  assert.deepEqual(parentRow.recordMembers?.members.map(member => ({ kind: member.kind, title: member.title,
    statusLabel: member.statusLabel, runId: member.target.runId })), [
    { kind: "reading", title: "2 pages", statusLabel: "Reading", runId: childRow.runId },
  ]);
  assert.equal(parentRow.recordMembers?.members[0]?.status,"running");
  const refs = childRow.recordMembers?.members.map(member => {
    assert.equal(member.kind, "record");
    if (member.kind !== "record") assert.fail("Expected a person record");
    assert.equal(member.target.section, "review");
    return member.record;
  });
  assert.equal(refs?.length, 2);
  assert.ok(wire.workflowCounts.every(count => count.workflowId !== "ocr"));
  const deps = createOperatorRunDetail({ database, stateRoot: f.harness.authority.stateRoot, projection, runReader: f.canonical.lifecycle,
    canonical: { database, reader: f.canonical.lifecycle, descriptors } });
  const detail = buildRunDetail(deps, childRow.runId);
  assert.equal(detail.panelKind, "review");
  assert.equal(detail.header.workflowId, "ocr");
  const hostDetail = buildRunDetail(deps, parentRow.runId);
  assert.equal(hostDetail.panelKind, "review");
  assert.equal(hostDetail.ocrRecordCount, 2);
  assert.ok(hostDetail.availableSections.includes("review"));
  assert.equal(parentRow.recordMembers?.members[0]?.target.panelKind, detail.panelKind);
  const hostSection = await readRunSection(deps, parentRow.runId, "review");
  assert.deepEqual(hostSection, await readRunSection(deps, childRow.runId, "review"));
  if (hostSection.section !== "review") assert.fail("Expected the hosted OCR review");
  assert.equal(hostSection.payload.runId, childRow.runId);
  assert.equal(hostSection.payload.ocr?.approval?.runId, childRow.runId);
  assert.equal(database.withAuthorityReadSnapshot(() => ocrHostRun(database.authority, f.run))?.envelope.runId, parentRow.runId);
  assert.equal(database.withAuthorityReadSnapshot(() => ocrHostRun(database.authority, f.parentRun)), undefined);
  const notification = notificationRecordOf({ seed: 7, title: "Records ready", lastSeenAt: f.run.createdAt });
  notification.links = [{ kind: "run", runId: f.run.envelope.runId }];
  const target = createNotificationTargetQuery({ get: () => notification, read: id => f.canonical.lifecycle.read(id), failure: () => undefined,
    command: () => undefined, bulk: () => undefined,
    host: run => database.withAuthorityReadSnapshot(() => ocrHostRun(database.authority, run)) });
  assert.deepEqual(target(notification.notificationId, notification.actorId), { kind: "run", runId: parentRow.runId, day: clock.todayLocal() });
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

it("shows verified shared identities while another native lookup is still queued before review publication", async () => {
  const person = { emplId: EXECUTOR_EID, name: "Example, Avery", department: "Housing Dining Hospitality", jobTitle: "Fixture employee",
    employeeStatus: "active" as const, hdh: true, hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
  const sessions = sessionFactoryHarness({ ucpath: () => createDeterministicUcpathPersonOrgDriver({ results: [person], selection: { status: "resolved", selected: person, candidateEids: [EXECUTOR_EID] } }), crm: () => healthyCrmDriver() });
  const f = await world.fixture({ record: true, release: true, pageCount: 3,
    lookupNames: ["Example, Avery", "Example, Robin", "Example, Avery"], pauseAtLookup: true, sessions });
  const next = await f.canonical.step(f.run, new AbortController().signal);
  assert.equal(next.run.envelope.workflow, "person-lookup");
  assert.equal(next.outcome.state, "done");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId), undefined);
  const presentation = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority, f.canonical.lifecycle,
    f.run.envelope.runId, id => f.resolve(id)?.label ?? id));
  assert.ok(presentation);
  assert.deepEqual(presentation.members.map(member => member.statusLabel), ["Verified", "Looking up", "Verified"]);
  assert.equal(presentation.members[0]?.title, `Example, Avery · EID ${EXECUTOR_EID}`);
  assert.equal(presentation.members[2]?.title, presentation.members[0]?.title);
});

it("records each settled delegation join once although a later delegation yields and the parent is claimed again", async () => {
  const person = { emplId: EXECUTOR_EID, name: "Example, Avery", department: "Housing Dining Hospitality", jobTitle: "Fixture employee",
    employeeStatus: "active" as const, hdh: true, hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
  const sessions = sessionFactoryHarness({ ucpath: () => createDeterministicUcpathPersonOrgDriver({ results: [person], selection: { status: "resolved", selected: person, candidateEids: [EXECUTOR_EID] } }), crm: () => healthyCrmDriver() });
  const f = await world.fixture({ record: true, release: true, pageCount: 3, lookupNames: ["Example, Avery", "Example, Avery", "Example, Avery"], pauseAtLookup: true, sessions });
  await f.canonical.execute(f.run, new AbortController().signal);
  const settled = (nodeId: string) => f.database.authority.timelineEvents.page({ runId: f.run.envelope.runId, limit: 1000 }).flatMap(({ payload }) =>
    payload.kind === "span" && payload.event.t === "span.ended" && payload.event.kind === "task" && payload.event.spanPath.startsWith(`${f.run.envelope.traceId}/${nodeId}#`)
      ? [payload.event.outcome] : []);
  assert.deepEqual(settled("read-pages"), ["done"], "the page join settled before the lookup yielded and is not recorded again on the next claim");
  assert.deepEqual(settled("lookup-identities"), ["done"]);
});

it("binds I-9 signer records to their own native group and keeps its history covered", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2, formType: "i9",
    lookupNames: ["Example, Avery", "Example, Avery"], pauseAtLookup: true });
  const group = f.database.authority.dependencies.groups(f.run.envelope.runId).find(({ group }) => group.invocation.nodeId === "lookup-signers");
  assert.ok(group);
  assert.equal(group.group.children.length, 1);
  const child = group.group.children[0]; assert.ok(child);
  assert.equal(child.child.envelope.workflow, "i9-lookup");
  const source = f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings(f.database.authority, f.run.envelope.runId));
  assert.ok(source);
  assert.equal(source.bindings.length, 2);
  assert.ok(source.bindings.every(binding => binding.currentChildRunId === child.child.envelope.runId));
  const presentation = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority, f.canonical.lifecycle,
    f.run.envelope.runId, id => f.resolve(id)?.label ?? id));
  assert.ok(presentation);
  assert.deepEqual(presentation.members.map(member => member.statusLabel), ["Looking up", "Looking up"]);
  assert.ok(presentation.runIds.includes(child.child.envelope.runId));
});

it("keeps current records and reused retry history during a partially readmitted OCR lookup epoch", async () => {
  let failedPage = true;
  const person = { emplId: EXECUTOR_EID, name: "Example, Avery", department: "Housing Dining Hospitality", jobTitle: "Fixture employee",
    employeeStatus: "active" as const, hdh: true, hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
  const sessions = failAveryLookupOnce({ results: [person],
    selection: { status: "resolved", selected: person, candidateEids: [EXECUTOR_EID] } });
  const f = await world.fixture({ record: true, release: true, pageCount: 2,
    lookupNames: ["Example, Avery", "Example, Morgan"], pauseAtLookup: true,
    sessions, manualPageFailure: page => failedPage && page === 2 });
  const lookup = f.database.authority.dependencies.groups(f.run.envelope.runId)
    .find(({ group }) => group.invocation.nodeId === "lookup-identities")?.group.children[0]?.child; assert.ok(lookup);
  assert.equal(lookup.lifecycle.state, "queued");
  const queuedBindings = f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings(f.database.authority,f.run.envelope.runId)); assert.ok(queuedBindings);
  assert.equal(queuedBindings.bindings.length, 1);
  assert.equal(queuedBindings.bindings[0]?.currentChildRunId, lookup.envelope.runId);
  const failedExecution = await f.canonical.execute(f.run, new AbortController().signal);
  const failed = f.database.authority.runs.get(lookup.envelope.runId); assert.ok(failed);
  assert.ok(failed.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed");
  const failure = failedExecution.outcomes.find(outcome => outcome.state === "failed"); assert.ok(failure?.state === "failed");
  assert.equal(f.database.authority.failures.get(failure.failureId)?.code, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED");
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "run-detail", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: lookup.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  const initialExecution = await f.canonical.execute(f.run, new AbortController().signal);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state,"parked-gate",
    JSON.stringify({ outcomes: initialExecution.outcomes, failures: [f.run, ...f.database.authority.runs.listChildren(f.run.envelope.runId)].flatMap(run =>
      f.database.authority.failures.listByRun(run.envelope.runId).map(failure => ({ node: failure.nodeId, summary: failure.summary }))) }));
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record",1)).state,"applied");
  const reviewed = f.database.withAuthorityReadSnapshot(() => readOcrQueueMembers(f.database.authority,f.canonical.lifecycle,
    f.run.envelope.runId,id => f.resolve(id)?.label ?? id)); assert.ok(reviewed);
  assert.equal(reviewed.members[0]?.title,"Example, Avery · EID 10800000");
  const before = f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings(f.database.authority,f.run.envelope.runId)); assert.ok(before);
  assert.equal(before.seed.records.length,1);
  assert.equal(before.bindings[0]?.childRunIds.length,2);
  assert.equal(before.bindings[0]?.childRunIds[0],lookup.envelope.runId);
  const page = f.database.authority.runs.listChildren(f.run.envelope.runId)
    .find(child => child.envelope.workflow === "ocr-page" && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(page);
  failedPage = false;
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: page.envelope.runId, expectedVersion: page.version } }).state, "applied");
  assert.equal((await f.canonical.step(f.run,new AbortController().signal)).outcome.state,"done");
  const readmitted = await f.canonical.step(f.run,new AbortController().signal);
  assert.equal(readmitted.outcome.state,"yielded-delegation", JSON.stringify(readmitted.outcome.state === "failed"
    ? f.database.authority.failures.get(readmitted.outcome.failureId) : readmitted.outcome));
  f.database.withAuthorityReadSnapshot(() => {
    const lookupSeeds = f.database.authority.dependencies.groups(f.run.envelope.runId)
      .filter(({ group }) => ["lookup-identities", "lookup-signers"].includes(group.invocation.nodeId))
      .map(({ group }) => {
        const checkpoint = readDelegationScopeEvidence(f.database.authority,group.parent,group.invocation.scopeEvidence)
          .find(source => source.nodeId === "build-review" && "checkpoint" in source);
        assert.ok(checkpoint !== undefined && "checkpoint" in checkpoint && checkpoint.checkpoint !== undefined);
        return [group.invocation.nodeId,OcrReviewCheckpointSchema.parse(checkpoint.checkpoint.output.value).records.length];
      });
    assert.deepEqual(lookupSeeds,[["lookup-identities",2],["lookup-signers",1]]);
    const current = readOcrRecordBindings(f.database.authority,f.run.envelope.runId); assert.ok(current);
    const expectedRecords = [1,2].map(page => `${f.reading.input.document.sha256}#emergency-contact#${page}`);
    assert.deepEqual(current.seed.records.map(record => record.recordId),expectedRecords);
    assert.deepEqual(current.bindings[0]?.record,before.bindings[0]?.record);
    assert.deepEqual(current.bindings[0]?.childRunIds,before.bindings[0]?.childRunIds);
    const rows = readOcrQueueMembers(f.database.authority,f.canonical.lifecycle,f.run.envelope.runId,id => f.resolve(id)?.label ?? id); assert.ok(rows);
    assert.deepEqual(rows.members.map(row => row.kind === "record" ? row.record.recordId : row.kind),current.seed.records.map(record => record.recordId));
    assert.ok(rows.runIds.includes(lookup.envelope.runId));
    assert.deepEqual([...rows.runIds].sort(),f.database.authority.runs.listChildren(f.run.envelope.runId).map(run => run.envelope.runId).sort());
    assert.equal(rows.members[0]?.title,`Example, Avery · EID ${EXECUTOR_EID}`);
    assert.deepEqual(rows.members.map(row => row.childRunIds.includes(lookup.envelope.runId)),[true,false]);
    assert.equal(rows.members[1]?.statusLabel,"Looking up");
    assert.equal(rows.members.some(row => row.kind === "page-failure"),false);
    const generation = f.database.getMeta().authorityGeneration;
    assert.throws(() => readOcrQueueMembers(f.database.authority,{ read: id => {
      const read = f.canonical.lifecycle.read(id);
      if (read.state !== "present" || id !== f.run.envelope.runId) return read;
      const { delegationRefresh: _refresh,...run } = read.run;
      return { ...read,run };
    } },f.run.envelope.runId,id => f.resolve(id)?.label ?? id),/OCR_REVIEW_REFUSED/u);
    assert.throws(() => readOcrRecordBindings({ ...f.database.authority, dependencies: { ...f.database.authority.dependencies,
      groups: (id,selection) => f.database.authority.dependencies.groups(id,selection).map(entry => entry.group.invocation.nodeId !== "lookup-identities" ? entry : {
        ...entry,group: { ...entry.group,invocation: { ...entry.group.invocation,children: entry.group.invocation.children.map((child,index) => index !== 0 ? child : { ...child,sourceRecordIds: [] }) } },
      }),
    } },f.run.envelope.runId),/OCR_REVIEW_REFUSED/u);
    assert.equal(f.database.getMeta().authorityGeneration,generation);
  });
  const projection = createOperatorProjection({ database: f.database,stateRoot: f.harness.authority.stateRoot,clock: f.clock,
    reader: f.canonical.lifecycle,appVersion: "0.1.0",descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: createTransactionHistory(f.database.authority),descriptors: { resolve: f.resolve } });
  const wire = projection.buildDashboardDayWire(f.clock.todayLocal());
  const row = wire.queueSurfaces.find(row => row.runId === f.run.envelope.runId);
  assert.ok(row?.surfaceKind === "operation");
  assert.deepEqual(row.recordMembers?.members.map(member => member.kind === "record" ? member.record.recordId : member.kind),
    [1,2].map(page => `${f.reading.input.document.sha256}#emergency-contact#${page}`));
  const children = new Set<string>(f.database.authority.runs.listChildren(f.run.envelope.runId).map(run => run.envelope.runId));
  assert.equal(queueKeyboardEntries(wire.queueSurfaces).some(entry => entry.kind === "run" && children.has(entry.runId)),false);
}, scaledMs(60_000));

it("authenticates canonical shared lookup membership while preserving source page order", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 10, pauseAtLookup: true,
    lookupNames: Array.from({ length: 10 },() => "Example, Avery"),recordPages: [2,10] });
  const source = f.database.withAuthorityReadSnapshot(() => readOcrRecordBindings(f.database.authority,f.run.envelope.runId)); assert.ok(source);
  const expected = [2,10].map(page => `${f.reading.input.document.sha256}#emergency-contact#${page}`);
  const group = f.database.authority.dependencies.groups(f.run.envelope.runId)
    .find(({ group }) => group.invocation.nodeId === "lookup-identities"); assert.ok(group);
  assert.deepEqual(group.group.invocation.children[0]?.sourceRecordIds,expected.toReversed());
  assert.deepEqual(source.seed.records.map(record => record.recordId),expected);
  assert.deepEqual(source.bindings.map(binding => binding.record.recordId),expected);
  assert.equal(source.bindings[0]?.currentChildRunId,source.bindings[1]?.currentChildRunId);
},scaledMs(60_000));
