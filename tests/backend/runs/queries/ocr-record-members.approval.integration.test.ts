import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildOcrReviewSection } from "../../../../src/backend/runs/queries/ocr-review.js";
import { readQueueRecordMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { EmergencyContactMemberInputSchema } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { EmergencyContactMemberResultSchema } from "../../../../src/models/workflows/emergency-contact/result.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { isQueueTopLevel, isQueueMember } from "../../../../src/models/dashboard/queue-parent.js";
import type { QueueRecordMember, QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";
import { correctedOcrRecord } from "../../../../src/dashboard/surfaces/run-detail/review/review-model.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import contactPage from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { scaledMs } from "../../../support/time-scale.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;

function authorityState(f: Fixture, database = f.database) {
  return database.withAuthorityReadSnapshot(() => {
    const repositories = database.authority;
    const runs = ["emergency-contact", "ocr", "emergency-contact-member", "ocr-page", "person-lookup", "i9-lookup"]
      .flatMap(workflow => repositories.runs.listByWorkflow(workflow));
    const review = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
    return { generation: database.getMeta().authorityGeneration, runs,
      reviews: Array.from({ length: review.revision }, (_, index) => repositories.ocrReviews.revision(f.run.envelope.runId, index + 1)),
      snapshots: repositories.ocrReviews.snapshots(f.run.envelope.runId),
      extractions: repositories.ocrExtractions.findBySource(f.reading.input.image.sha256),
      groups: [f.parentRun, f.run].map(run => repositories.dependencies.groups(run.envelope.runId, "retained")),
      checkpoints: runs.map(run => repositories.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)),
      results: runs.map(run => repositories.runResults.get(run.envelope.runId)),
      intents: runs.map(run => repositories.writeIntents.listByRun(run.envelope.runId)) };
  });
}

function served(f: Fixture, database = f.database, reader = f.canonical.lifecycle, verifyMemberTargets = false) {
  const before = authorityState(f, database);
  const projection = createOperatorProjection({ database, stateRoot: f.harness.authority.stateRoot, clock: f.clock,
    reader, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: createTransactionHistory(database.authority), descriptors: { resolve: f.resolve } });
  projection.ingestFromTimeline();
  assert.equal(projection.health().state, "live");
  const wire = projection.buildDashboardDayWire(f.clock.todayLocal());
  const parent = wire.queueSurfaces.find(row => row.runId === f.parentRun.envelope.runId);
  const ocr = wire.queueSurfaces.find(row => row.runId === f.run.envelope.runId);
  assert.ok(parent?.surfaceKind === "operation" && ocr?.surfaceKind === "operation");
  assert.equal(parent.availableSections.includes("review"), false);
  assert.equal(ocr.availableSections.includes("review"), true);
  const deps = createOperatorRunDetail({ database, stateRoot: f.harness.authority.stateRoot, projection, runReader: reader,
    canonical: { database, reader, descriptors: { resolve: f.resolve } } });
  const parentDetail = buildRunDetail(deps, parent.runId), ocrDetail = buildRunDetail(deps, ocr.runId);
  const review = buildOcrReviewSection(deps, ocr.runId); assert.equal(review.section, "review");
  if (review.section !== "review") assert.fail("Missing OCR review");
  assert.ok(review.payload.ocr);
  if (verifyMemberTargets) {
    for (const row of [parent, ocr]) {
      for (const member of row.recordMembers?.members ?? []) {
        const detail = buildRunDetail(deps, member.target.runId);
        assert.equal(detail.runId, member.target.runId);
        assert.equal(detail.header.workflowId, member.target.workflowId);
        assert.equal(detail.panelKind, member.target.panelKind);
        if (member.target.section === "review") {
          const target = member.target;
          const section = buildOcrReviewSection(deps, target.runId); assert.ok(section.section === "review");
          assert.ok(section.payload.ocr?.revision.records.some(record => record.recordId === target.record.recordId));
        }
      }
    }
  }
  assert.deepEqual(projection.buildDashboardDayWire(f.clock.todayLocal()).queueSurfaces, wire.queueSurfaces);
  assert.deepEqual(authorityState(f, database), before);
  return { projection, wire, parent, ocr, parentDetail, ocrDetail, review: review.payload };
}

function displayIdentity(row: QueueSurfaceWire) {
  return { runId: row.runId, itemId: row.itemId, workflowId: row.workflowId, traceId: row.traceId, attempt: row.attempt,
    startedAt: row.startedAt, runNumber: row.runNumber, title: row.title, displayName: row.displayName,
    linkedRuns: row.linkedRuns.map(({ status: _status, ...link }) => link) };
}

for (const dryRun of [true, false]) {
  it(`keeps mixed OCR approval identities and exclusions through native ${dryRun ? "Preview" : "Save"}, full-day reads and restart`, async () => {
    const employee = UcpathCandidateSchema.parse({ emplId: "10800000", name: "Example, Avery", department: "Housing Dining Hospitality",
      jobTitle: "Fixture employee", employeeStatus: "active", hdh: true, hrStatus: "Active",
      startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" });
    let ticks = Date.parse(contactPage.page.observedAt);
    const persistence = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
      displayedEid: employee.emplId, displayedName: employee.name }), () => new Date(++ticks).toISOString());
    const sessions = sessionFactoryHarness({ ucpath: () => {
      const session = persistence.session();
      return createDeterministicUcpathPersonOrgDriver({ results: [employee],
        selection: { status: "resolved", selected: employee, candidateEids: [employee.emplId] } }, undefined, session.port, session.save);
    }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
    const f = await world.fixture({ coordinator: true, member: childWorkflowModuleOf("emergency-contact", "emergency-contact-member"),
      record: true, pageCount: 3, dryRun, sessions, operatorEvidence: true,
      reviewedPages: Array.from({ length: 3 }, () => ({ employeeName: employee.name,
        contactName: "Original Contact", correctedContactName: "Released Contact" })),
      screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
    const repositories = f.database.authority, signal = new AbortController().signal;
    const original = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
    assert.equal(original.records.length, 3);
    const extractions = repositories.ocrExtractions.findBySource(f.reading.input.image.sha256);
    assert.equal(extractions.length, 3);
    assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1, 0)).state, "applied");
    assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2, 2)).state, "applied");
    const addition = CommandRequestSchema.parse({ commandId: randomUUID(), family: "ocr-review", type: "add-ocr-record", source: "dashboard",
      requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: { runId: f.run.envelope.runId, expectedRevision: 3 },
      payload: { pages: [{ pageKind: "emergency-contact", sourcePage: 3 }] } });
    assert.equal(f.canonical.kernel.execute(addition).state, "applied");
    const created = served(f);
    const createdRevision = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(createdRevision);
    assert.ok(created.review.ocr);
    const createdReview = { ...created.review, ocr: { ...created.review.ocr, revision: createdRevision } };
    const manual = createdRevision.records.at(-1); assert.ok(manual?.provenance);
    assert.equal(manual.discarded, true);
    const correction = CommandRequestSchema.parse({ ...f.command("correct-ocr-record", 4),
      payload: correctedOcrRecord(createdReview, manual.recordId, { "employee.name": employee.name,
        "employee.employeeId": employee.emplId, "contact.name": "Released Contact", "contact.relationship": "Spouse", sourcePage: "3" }) });
    assert.equal(f.canonical.kernel.execute(correction).state, "applied");
    assert.equal(f.canonical.kernel.execute(CommandRequestSchema.parse({ ...f.command("restore-ocr-record", 5),
      payload: { recordId: manual.recordId } })).state, "applied");
    const review = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
    assert.equal(review.revision, 6);
    assert.deepEqual(review.seed, original.seed);
    const ids = review.records.map(record => record.recordId);
    assert.deepEqual(ids.slice(0, 3), [1, 2, 3].map(page => `${f.reading.input.document.sha256}#emergency-contact#${page}`));
    assert.equal(manual.recordId, `${f.reading.input.document.sha256}#operator-added-emergency-contact-${addition.commandId}#1`);
    const primaryId = ids[0]; assert.ok(primaryId);
    const selected = [primaryId, manual.recordId];
    assert.deepEqual(review.records.map(record => record.discarded), [false, false, true, false]);
    assert.deepEqual(review.records[3]?.provenance, { kind: "operator-added", commandId: addition.commandId,
      createdAt: f.clock.now().toISOString(), pages: [{ pageKind: "emergency-contact", sourcePage: 3 }] });
    const lookup = repositories.dependencies.groups(f.run.envelope.runId).find(({ group }) => group.invocation.nodeId === "lookup-identities");
    assert.ok(lookup); assert.equal(lookup.group.children.length, 1);
    const nativeLookup = lookup.group.children[0]; assert.ok(nativeLookup);
    const unrelatedDescriptor = f.resolve("person-lookup"); assert.ok(unrelatedDescriptor);
    const unrelated = f.canonical.start(unrelatedDescriptor, PersonLookupInput.parse({ emplId: "10800001" }), { dryRun: false });
    const currentTime = f.clock.now();
    f.clock.advanceWall(86_400_000);
    const otherDay = f.clock.todayLocal();
    const otherDayRun = f.canonical.start(unrelatedDescriptor, PersonLookupInput.parse({ emplId: "10800002" }), { dryRun: false });
    f.clock.setWall(currentTime);
    assert.notEqual(otherDay, f.clock.todayLocal());
    const assertOtherDay = (view: ReturnType<typeof served>, database = f.database) => {
      const native = authorityState(f, database);
      const day = view.projection.buildDashboardDayWire(otherDay);
      assert.deepEqual(day.queueSurfaces.map(row => row.runId), [otherDayRun.envelope.runId]);
      assert.equal(day.queueSurfaces[0]?.workflowId, "person-lookup");
      assert.equal(day.queueSurfaces[0]?.startedAt, otherDayRun.envelope.enqueuedAt);
      assert.deepEqual(authorityState(f, database), native);
    };

    const before = served(f), identity = displayIdentity(before.parent);
    assertOtherDay(before);
    assert.equal(before.parent.status, "running");
    assert.equal(before.ocr.status, "awaiting-approval");
    assert.equal(before.parentDetail.gate.state, "absent");
    assert.equal(before.ocrDetail.gate.state, "open");
    assert.equal(before.review.ocr?.approval?.runId, f.run.envelope.runId);
    assert.deepEqual(before.parent.recordMembers?.members.map(member => ({ kind: member.kind, title: member.title,
      label: member.statusLabel, runId: member.target.runId })),
    [{ kind: "reading", title: "3 pages", label: "Reading", runId: f.run.envelope.runId }]);
    assert.deepEqual(before.ocr.recordMembers?.members.map(member => member.kind === "record" ? member.record.recordId : member.kind), ids);
    assert.equal(before.ocr.recordMembers?.members.some(member => member.kind === "page-failure"), false);
    assert.equal(repositories.runs.listChildren(f.parentRun.envelope.runId).length, 1);
    assert.equal(repositories.runs.listByWorkflow("emergency-contact-member").length, 0);
    assert.deepEqual(before.parent.linkedRuns.map(link => ({ runId: link.runId, workflowId: link.workflowId, panelKind: link.panelKind })),
      [{ runId: f.run.envelope.runId, workflowId: "ocr", panelKind: "review" }]);

    assert.equal(f.canonical.kernel.execute(f.approval(selected)).state, "applied");
    const approved = repositories.ocrReviews.snapshots(f.run.envelope.runId); assert.equal(approved.length, 1);
    assert.deepEqual(approved[0]?.selectedRecordIds, selected);
    assert.deepEqual(approved[0]?.records, [review.records[0], review.records[3]]);
    assert.deepEqual(approved[0]?.records[1]?.provenance, review.records[3]?.provenance);
    const released = await f.canonical.step(f.parentRun, signal);
    assert.equal(released.run.envelope.runId, f.run.envelope.runId);
    assert.equal(released.outcome.state, "done");

    const assertPhase = (view: ReturnType<typeof served>, labels: readonly string[]) => {
      assert.deepEqual(displayIdentity(view.parent), identity);
      assert.equal(view.parentDetail.gate.state, "absent");
      assert.equal(view.ocrDetail.gate.state, "absent");
      assert.equal(view.review.ocr?.approval, undefined);
      assert.deepEqual(view.review.ocr?.revision, review);
      assert.deepEqual(view.review.ocr?.approvedSnapshots, approved);
      const members = view.parent.recordMembers?.members; assert.ok(members);
      assert.equal(members.length, 4);
      assert.deepEqual(members.map(member => member.kind === "record" ? member.record : member.kind),
        ids.map(recordId => ({ runId: f.run.envelope.runId, recordId })));
      assert.deepEqual(members.map(member => member.statusLabel), labels);
      for (const index of [1, 2]) {
        const member: QueueRecordMember = members[index]; assert.ok(member?.kind === "record" && member.target.section === "review");
        assert.equal(member.status, "cancelled");
        assert.deepEqual(member.target.record, { runId: f.run.envelope.runId, recordId: ids[index] });
        assert.equal(member.target.runId, f.run.envelope.runId);
        assert.equal(member.target.panelKind, "review");
        assert.equal(member.childRunIds.some(id => repositories.runs.get(id)?.envelope.workflow === "emergency-contact-member"), false);
      }
      assert.ok(view.wire.queueSurfaces.some(row => row.runId === unrelated.envelope.runId && isQueueTopLevel(row)));
      assert.equal(view.wire.queueSurfaces.some(row => row.runId === nativeLookup.child.envelope.runId && isQueueTopLevel(row)), false);
      assert.equal(view.wire.queueSurfaces.filter(row => row.workflowId === "person-lookup" && isQueueTopLevel(row)).length, 1);
      assert.equal(view.wire.queueSurfaces.some(row => row.workflowId === "ocr-page" && (isQueueTopLevel(row) || isQueueMember(row))), false);
    };
    const running = dryRun ? "Previewing" : "Saving", terminal = dryRun ? "Previewed" : "Saved";
    assertPhase(served(f), [running, "Not approved", "Not approved", running]);
    const admission = await f.canonical.step(f.parentRun, signal);
    assert.equal(admission.run.envelope.runId, f.parentRun.envelope.runId);
    assert.equal(admission.outcome.state, "yielded-delegation");
    const group = repositories.dependencies.groups(f.parentRun.envelope.runId).find(({ group }) => group.invocation.nodeId === "members");
    assert.ok(group); assert.equal(group.group.children.length, 2);
    assert.deepEqual(group.group.invocation.children.map(child => child.sourceRecordIds), selected.map(id => [id]));
    const members = group.group.children;
    assert.deepEqual(members.map(member => EmergencyContactMemberInputSchema.parse(member.child.input.parsed.value).record),
      [review.records[0], review.records[3]]);
    const admitted = served(f, f.database, f.canonical.lifecycle, true); assertPhase(admitted, [running, "Not approved", "Not approved", running]);
    for (const [index, recordId] of selected.entries()) {
      const member = members[index]; assert.ok(member);
      const row = admitted.parent.recordMembers?.members.find(row => row.kind === "record" && row.record.recordId === recordId); assert.ok(row);
      assert.equal(row.target.runId, member.child.envelope.runId);
      assert.equal(row.target.section, "logs");
      assert.equal(row.target.workflowId, "emergency-contact-member");
      assert.ok(row.childRunIds.includes(member.child.envelope.runId));
    }
    assert.equal(persistence.submissions.length, 0);
    const completed = await f.canonical.execute(f.parentRun, signal);
    const settledParent = completed.run;
    assert.ok(settledParent?.lifecycle.state === "terminal" && settledParent.lifecycle.outcome === "done",
      JSON.stringify(completed.outcomes.map(outcome => outcome.state)));
    assert.equal(repositories.runs.listByWorkflow("emergency-contact-member").length, 2);
    const settled = served(f); assertPhase(settled, [terminal, "Not approved", "Not approved", terminal]);
    assertOtherDay(settled);
    assert.equal(persistence.submissions.length, dryRun ? 0 : 1);
    for (const member of members) {
      const result = repositories.runResults.get(member.child.envelope.runId); assert.ok(result);
      if (dryRun) {
        assert.equal(RunDryRunPreviewResultSchema.parse(result.result.value).externalCommit, "none");
        assert.deepEqual(repositories.writeIntents.listByRun(member.child.envelope.runId), []);
      } else {
        const output = EmergencyContactMemberResultSchema.parse(result.result.value);
        assert.ok(output.disposition === "committed" || output.disposition === "already-present");
        assert.equal(output.proof.effect.name, "Released Contact");
      }
    }
    assert.deepEqual(repositories.ocrExtractions.findBySource(f.reading.input.image.sha256), extractions);
    const mismatch = (id: string) => {
      const descriptor = f.resolve(id);
      return id === "emergency-contact-member" && descriptor !== undefined ? { ...descriptor, version: descriptor.version + 1 } : descriptor;
    };
    const nativeBefore = authorityState(f);
    const retained = f.database.withAuthorityReadSnapshot(() => readQueueRecordMembers(repositories, f.canonical.lifecycle,
      settledParent, repositories.runs.listChildren(f.parentRun.envelope.runId), mismatch));
    assert.deepEqual(retained?.members.map(member => member.statusLabel),
      [dryRun ? "Previewed" : "Done", "Not approved", "Not approved", dryRun ? "Previewed" : "Done"]);
    assert.deepEqual(authorityState(f), nativeBefore);

    await f.harness.manager.closeAll("worker-stop"); f.database.close();
    const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "ocr-approval-phase-proof" }, f.clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    f.harness.authority.replaceClosedDatabase(reopened);
    const reopenedBeforeRead = authorityState(f, reopened);
    assert.deepEqual({ ...reopenedBeforeRead, generation: nativeBefore.generation }, nativeBefore);
    const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID }, resolveDescriptor: f.resolve,
      publishQueued: () => assert.fail("Read-only restart must not enqueue") });
    const restarted = served(f, reopened, reader);
    assertOtherDay(restarted, reopened);
    assert.deepEqual(restarted.wire.queueSurfaces, settled.wire.queueSurfaces);
    assert.deepEqual(displayIdentity(restarted.parent), identity);
    assert.deepEqual(restarted.review, settled.review);
    assert.deepEqual(authorityState(f, reopened), reopenedBeforeRead);
  }, scaledMs(60_000));
}

it("keeps failed OCR pages on their own Logs while hiding successful reads under the linked review", async () => {
  const f = await world.fixture({ coordinator: true, record: true, pageCount: 3, failManualPageOnce: 2 });
  const view = served(f);
  assert.equal(view.parent.status, "running");
  assert.equal(view.parentDetail.gate.state, "absent");
  assert.equal(view.ocrDetail.gate.state, "open");
  assert.deepEqual(view.parent.recordMembers?.members.map(member => member.statusLabel), ["Reading"]);
  const pages = f.database.authority.runs.listChildren(f.run.envelope.runId).filter(run => run.envelope.workflow === "ocr-page");
  assert.equal(pages.length, 3);
  const failed = pages.find(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
  const members = view.ocr.recordMembers?.members; assert.ok(members);
  assert.equal(members.filter(member => member.kind === "record").length, 2);
  const failures = members.filter(member => member.kind === "page-failure"); assert.equal(failures.length, 1);
  const failure = failures[0]; assert.ok(failure?.kind === "page-failure");
  assert.equal(failure.sourcePage, 2);
  assert.equal(failure.ownerRunId, f.run.envelope.runId);
  assert.equal(failure.statusLabel, "Failed");
  assert.equal(failure.target.runId, failed.envelope.runId);
  assert.equal(failure.target.workflowId, "ocr-page");
  assert.equal(failure.target.section, "logs");
  assert.deepEqual(failure.childRunIds, [failed.envelope.runId]);
  for (const page of pages.filter(run => run.envelope.runId !== failed.envelope.runId)) {
    const row = view.wire.queueSurfaces.find(row => row.runId === page.envelope.runId); assert.ok(row);
    assert.equal(isQueueTopLevel(row) || isQueueMember(row), false);
    assert.equal(members.some(member => member.target.runId === page.envelope.runId), false);
  }
  assert.equal(f.database.authority.runs.listByWorkflow("emergency-contact-member").length, 0);
});
