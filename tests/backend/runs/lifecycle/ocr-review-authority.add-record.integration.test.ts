import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { onbaseOcrWorldChild } from "../../../support/helpers/backend/onbase-child-fixture.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { buildOcrReviewSection } from "../../../../src/backend/runs/queries/ocr-review.js";
import { readOcrQueueMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { correctedOcrRecord } from "../../../../src/dashboard/surfaces/run-detail/review/review-model.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { replaceOcrCommandRead, replaceOcrAuditRead } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { EmergencyContactMemberInputSchema } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { RunDelegatedDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { createDeterministicUcpathContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import contactPage from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { scaledMs } from "../../../support/time-scale.js";
import { ocrForm } from "../../../../src/models/ocr/form-registry.js";
import { sourceFixture, submittedPage } from "../../../support/fixtures/ocr/source-pages.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
function reviewReader(f: Fixture) {
  const reader = f.canonical.lifecycle, stateRoot = f.harness.authority.stateRoot;
  const projection = createOperatorProjection({ database: f.database, stateRoot, reader, clock: f.clock, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([f.root.descriptor.contractFingerprint]), ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  const deps = createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { database: f.database, reader, descriptors: { resolve: f.resolve } } });
  return () => { const section = buildOcrReviewSection(deps, f.run.envelope.runId); assert.ok(section.section === "review"); return section.payload; };
}
function add(f: Fixture, expectedRevision = 1, sourcePage = 2) {
  return CommandRequestSchema.parse({ commandId: randomUUID(), requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
    source: "dashboard", family: "ocr-review", type: "add-ocr-record", target: { runId: f.run.envelope.runId, expectedRevision },
    payload: { pages: [{ pageKind: "emergency-contact", sourcePage }] } });
}

it.each(["oath", "emergency-contact", "i9"] as const)("creates and approves an operator-added %s record when no record was extracted", async formType => {
  const f = await world.fixture({ release: true, pageCount: 2, formType }), read = reviewReader(f), before = read(); assert.ok(before.ocr);
  assert.equal(before.ocr.revision.records.length, 0);
  const form = ocrForm(formType), source = sourceFixture(2, formType);
  const pages = form.pageKinds.map((pageKind, index) => ({ pageKind, sourcePage: index + 1 }));
  const request = CommandRequestSchema.parse({ ...add(f), payload: { pages } });
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const created = read(), manual = created.ocr?.revision.records[0]; assert.ok(manual);
  const readings = form.pageKinds.map(kind => submittedPage(source.inputs[0], "Example, Manual", kind).record);
  const values = Object.fromEntries(form.fields.map(field => {
    const answer = readings.map(record => record?.answers[field.path]).find(answer => answer?.state === "read");
    return [field.path, answer?.state === "read" ? answer.raw : ""];
  }));
  const correction = CommandRequestSchema.parse({ ...request, commandId: randomUUID(), type: "correct-ocr-record",
    target: { ...request.target, expectedRevision: 2 }, payload: correctedOcrRecord(created, manual.recordId, {
      ...values, [form.fields.find(field => field.canonicalFieldId === "eid")?.path ?? "assertedEid"]: "10800001",
    }) });
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  const include = CommandRequestSchema.parse({ ...request, commandId: randomUUID(), type: "restore-ocr-record",
    target: { ...request.target, expectedRevision: 3 }, payload: { recordId: manual.recordId } });
  assert.equal(f.canonical.kernel.execute(include).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval([manual.recordId])).state, "applied");
  const approved = read();
  assert.deepEqual(approved.ocr?.revision.seed, before.ocr.revision.seed);
  assert.equal(approved.ocr?.approvedSnapshots[0].records[0].recordId, manual.recordId);
  assert.deepEqual(approved.ocr?.approvedSnapshots[0].records[0].provenance?.pages, pages);
});

it("durably creates, corrects and approves an operator-added record through native downstream dry-run execution and restart", async () => {
  // Each browser session opens the saved page; a dry run never saves, so every session sees the initial page.
  const contactPages: ReturnType<typeof createDeterministicUcpathContactPage>[] = [];
  const onbaseChild = onbaseOcrWorldChild();
  const sessions = sessionFactoryHarness({ ucpath: (): ReturnType<typeof createDeterministicUcpathPersonOrgDriver> => {
    const contact = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
      displayedEid: "10800001", displayedName: "Example, Manual" }) });
    contactPages.push(contact);
    const driver = createDeterministicUcpathPersonOrgDriver(undefined, undefined, contact);
    return { ...driver, async searchPersonOrg(input) {
      return input.kind === "by-name" ? SearchPersonOrgOutputSchema.parse({ results: [],
        selection: { status: "not-found", selected: null, candidateEids: [], searchName: input.name } }) : driver.searchPersonOrg(input);
    } };
  }, crm: healthyCrmDriver, onbase: onbaseChild.session });
  const f = await world.fixture({ coordinator: true, record: true, release: true, pageCount: 2, dryRun: true, sessions, ...onbaseChild.fixture });
  const read = reviewReader(f), original = read(); assert.ok(original.ocr);
  const request = add(f), runId = f.run.envelope.runId, repositories = f.database.authority;
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const created = read(); assert.ok(created.ocr);
  const manual = created.ocr.revision.records.at(-1); assert.ok(manual?.provenance);
  assert.equal(created.records.length, original.records.length + 1);
  assert.equal(created.ocr.revision.revision, 2);
  assert.equal(manual.provenance.commandId, request.commandId);
  assert.equal(manual.provenance.kind, "operator-added");
  assert.deepEqual(manual.provenance.pages, [{ pageKind: "emergency-contact", sourcePage: 2 }]);
  assert.equal(manual.discarded, true); assert.equal(manual.assertedEid, null);
  assert.ok(manual.fields.blockingPaths.length > 0);
  assert.deepEqual(created.ocr.revision.seed, original.ocr.revision.seed);
  assert.equal(f.canonical.kernel.execute(request).state, "already-applied");
  assert.equal(read().ocr?.revision.records.length, 3);
  assert.equal(f.canonical.kernel.execute({ ...request, payload: { pages: [{ pageKind: "emergency-contact", sourcePage: 1 }] } }).state, "rejected");
  const correction = CommandRequestSchema.parse({ ...f.command("correct-ocr-record", 2), payload: correctedOcrRecord(created, manual.recordId, {
    "employee.name": "Example, Manual", "employee.employeeId": "10800001", "contact.name": "Manual Contact",
    "contact.relationship": "Sibling", "contact.cellPhone": "2025550111", sourcePage: "1",
  }) });
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  const changes = [request, correction];
  for (const [revision, type] of [[3, "restore-ocr-record"], [4, "discard-ocr-record"], [5, "restore-ocr-record"]] as const) {
    const command = CommandRequestSchema.parse({ ...f.command(type, revision), payload: { recordId: manual.recordId } });
    assert.equal(f.canonical.kernel.execute(command).state, "applied"); changes.push(command);
  }
  const rows = readOcrQueueMembers(repositories, f.canonical.lifecycle, runId, () => "OCR"); assert.ok(rows);
  assert.equal(rows.members.filter(row => row.kind === "record").length, 3);
  assert.equal(rows.members.find(row => row.kind === "record" && row.record.recordId === manual.recordId)?.statusLabel, "Ready");
  const approval = f.approval([manual.recordId]);
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  const frozen = () => ({ review: repositories.ocrReviews.latest(runId), run: repositories.runs.get(runId),
    snapshots: repositories.ocrReviews.snapshots(runId) });
  const before = frozen();
  let generation = f.database.getMeta().authorityGeneration;
  for (const late of [add(f, 6), ...(["correct-ocr-record", "discard-ocr-record", "restore-ocr-record"] as const).map(type =>
    CommandRequestSchema.parse({ ...f.command(type, 6),
      ...(type === "correct-ocr-record" ? { payload: correctedOcrRecord(read(), manual.recordId, { "contact.name": "Late" }) } : { payload: { recordId: manual.recordId } }) }))]) {
    const refused = f.canonical.kernel.execute(late);
    assert.ok(refused.state === "rejected" && refused.code === "OCR_REVIEW_REFUSED");
    assert.deepEqual(repositories.commands.get(late.commandId), late);
    assert.deepEqual(repositories.commandAudits.findByCommand(late.commandId)?.result, refused);
    assert.deepEqual(frozen(), before);
    generation += 2;
    assert.equal(f.database.getMeta().authorityGeneration, generation);
  }
  for (const command of [...changes, approval]) {
    assert.equal(f.canonical.kernel.execute(command).state, "already-applied");
    assert.equal(f.sources.commandResult(runId, command.commandId).state, "recorded");
    assert.deepEqual(frozen(), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
  }
  const completed = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(completed.run?.lifecycle.state === "terminal" && completed.run.lifecycle.outcome === "done", JSON.stringify({
    outcomes: completed.outcomes.map(outcome => outcome.state),
    runs: [f.parentRun, ...repositories.runs.listChildren(f.parentRun.envelope.runId)].map(run => ({ workflow: run.envelope.workflow,
      lifecycle: repositories.runs.get(run.envelope.runId)?.lifecycle,
      failures: repositories.failures.listByRun(run.envelope.runId).map(failure => failure.code) })),
  }));
  const parentResult = repositories.runResults.get(f.parentRun.envelope.runId); assert.ok(parentResult);
  assert.equal(RunDelegatedDryRunPreviewResultSchema.parse(parentResult.result.value).externalCommit, "none");
  const members = repositories.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member");
  assert.equal(members.length, 1);
  const member = members[0]; assert.ok(member);
  const input = EmergencyContactMemberInputSchema.parse(member.input.parsed.value);
  assert.equal(input.record.recordId, manual.recordId); assert.equal(input.record.assertedEid, "10800001");
  assert.deepEqual(input.record.provenance?.pages, [{ pageKind: "emergency-contact", sourcePage: 1 }]);
  const result = repositories.runResults.get(member.envelope.runId); assert.ok(result);
  assert.equal(RunDelegatedDryRunPreviewResultSchema.parse(result.result.value).externalCommit, "none");
  for (const run of [f.parentRun, f.run, member]) assert.deepEqual(repositories.writeIntents.listByRun(run.envelope.runId), []);
  assert.ok(contactPages.some(page => page.actions.includes("fill-fields:1")));
  const snapshot = repositories.ocrReviews.snapshots(runId)[0]; assert.ok(snapshot);
  await f.harness.manager.closeAll("worker-stop"); f.database.close();
  const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "ocr-add-record-restart" }, f.clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  f.harness.authority.replaceClosedDatabase(reopened);
  const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID }, publishQueued: () => assert.fail("Unexpected enqueue") });
  const retained = readOcrReviewAuthority(reopened.authority, reader, runId); assert.ok(retained);
  assert.equal(retained.revision.revision, 6);
  assert.deepEqual(readOcrSnapshotsAuthority(reopened.authority, retained), [snapshot]);
}, scaledMs(60_000));

it("refuses stale/foreign additions and missing or altered original creation evidence without changing the review", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2 }), request = add(f), runId = f.run.envelope.runId;
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const repositories = f.database.authority;
  const observe = () => ({ review: repositories.ocrReviews.latest(runId), run: repositories.runs.get(runId) });
  const before = observe();
  const generation = f.database.getMeta().authorityGeneration;
  const conflicted = add(f);
  const conflict = f.canonical.kernel.execute(conflicted);
  assert.equal(conflict.state, "conflict");
  assert.deepEqual(repositories.commands.get(conflicted.commandId), conflicted);
  assert.deepEqual(repositories.commandAudits.findByCommand(conflicted.commandId)?.result, conflict);
  for (const candidate of [add(f, 2, 99), { ...add(f, 2), target: { runId: randomUUID(), expectedRevision: 2 } }]) {
    const refused = f.canonical.kernel.execute(candidate);
    assert.ok(refused.state === "rejected" && refused.code === "OCR_REVIEW_REFUSED");
    assert.deepEqual(repositories.commands.get(candidate.commandId), candidate);
    assert.deepEqual(repositories.commandAudits.findByCommand(candidate.commandId)?.result, refused);
  }
  assert.deepEqual(observe(), before);
  assert.equal(f.database.getMeta().authorityGeneration, generation + 6);
  assert.ok(readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId));
  for (const invalid of [replaceOcrCommandRead(repositories, request.commandId, undefined),
    replaceOcrCommandRead(repositories, request.commandId, CommandRequestSchema.parse({ ...request, payload: { pages: [{ pageKind: "emergency-contact", sourcePage: 1 }] } })),
    replaceOcrCommandRead(repositories, request.commandId, CommandRequestSchema.parse({ ...request, requestedBy: "foreign-operator" })),
    replaceOcrAuditRead(repositories, request.commandId, undefined)]) {
    assert.throws(() => readOcrReviewAuthority(invalid, f.canonical.lifecycle, runId), /OCR_REVIEW_REFUSED/u);
    assert.deepEqual(observe(), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation + 6);
  }
});
