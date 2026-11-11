import { scaledMs } from "../../../support/time-scale.js";
import { childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { readQueueRecordMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { approvedEmergencyContact, contactEffect } from "../../../../src/rules/ucpath/emergency-contact.js";
import { interpretContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { UCPATH_CONTACT_DISPLAYED_NAME } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it } from "vitest";
import type { z } from "zod";
import { createOcrApprovedSnapshotAdapter } from "../../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { authenticateOriginalDelegationGroup,retainedDelegationManifests } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { OcrApprovedSnapshotSchema } from "../../../../src/models/ocr/review.js";
import { OcrApprovalReadRequestSchema,OcrApprovalReadResultSchema } from "../../../../src/models/processing/ocr/approved-snapshot.js";
import { ReadApprovedOcrSnapshot } from "../../../../src/models/processing/ocr/read-approved-snapshot.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash,schemaBoundValueSchema } from "../../../../src/models/validation/schema-bound-value.js";
import { EmergencyContactMemberInputSchema } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { EmergencyContactResultSchema, EmergencyContactMemberResultSchema } from "../../../../src/models/workflows/emergency-contact/result.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { ocrProofReadDatabase } from "../../../support/helpers/backend/ocr-proof-reads.js";

import { createDeterministicUcpathContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UcpathContactPageSnapshotSchema, type UcpathContactPageSnapshot } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { RunDryRunPreviewResultSchema, RunDelegatedDryRunPreviewResultSchema, RunTerminalEvidenceResultSchema, readRunPreviewResult } from "../../../../src/models/run/result.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import contactPage from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
function release(f: Fixture, selectedIndices: readonly number[]) {
  const initial = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(initial);
  for (let index = 0; index < initial.records.length; index++) {
    const command = f.command("correct-ocr-record", index + 1, index);
    assert.equal(f.canonical.kernel.execute({ ...command, payload: { ...command.payload, assertedEid: String(10800000 + index) } }).state, "applied");
  }
  const current = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(current);
  const selected = selectedIndices.map(index => { const record = current.records[index]; assert.ok(record); return record.recordId; });
  assert.equal(f.canonical.kernel.execute(f.approval(selected)).state, "applied");
  return selected;
}
async function admitMembers(f: Fixture) {
  const ocr = await f.canonical.step(f.parentRun, new AbortController().signal);
  assert.equal(ocr.run.envelope.workflow, "ocr"); assert.equal(ocr.outcome.state, "done");
  const parent = await f.canonical.step(f.parentRun, new AbortController().signal);
  assert.equal(parent.run.envelope.runId, f.parentRun.envelope.runId); assert.equal(parent.outcome.state, "yielded-delegation");
  return f.database.withAuthorityReadSnapshot(() => {
    const manifest = retainedDelegationManifests(f.database.authority, f.parentRun.envelope.runId).find(manifest => manifest.edgeId === "approved-records");
    assert.ok(manifest);
    return authenticateOriginalDelegationGroup(f.database.authority, manifest).children.map(child => child.original);
  });
}
it("ocr/approved-snapshot — consumes a corrected released record and admits its exact native member", async () => {
  const f = await world.fixture({ coordinator: true, record: true, pageCount: 1 });
  assert.equal(f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member").length, 0);
  const selected = release(f, [0]), children = await admitMembers(f);
  const snapshot = f.database.authority.ocrReviews.snapshots(f.run.envelope.runId)[0]; assert.ok(snapshot);
  const checkpoint = f.database.authority.runCheckpoints.listByAttempt(f.parentRun.envelope.workflow, f.parentRun.envelope.itemId, "approved-records", f.parentRun.envelope.attempt).at(-1); assert.ok(checkpoint);
  assert.deepEqual(ReadApprovedOcrSnapshot.output.parse(checkpoint.output.value).snapshot, OcrApprovedSnapshotSchema.parse(snapshot));
  const members = children.map(child => EmergencyContactMemberInputSchema.parse(child.input.parsed.value));
  assert.deepEqual(members.map(member => member.record.recordId), selected);
  assert.deepEqual(members.map(member => member.record), snapshot.records);
  assert.deepEqual(members.map(member => member.record.assertedEid), ["10800000"]);
  assert.equal(snapshot.records.length, 1);
  for (const child of children) {
    assert.equal(child.lifecycle.state, "queued"); assert.equal(child.envelope.dryRun, false);
    assert.equal(f.database.authority.runResults.get(child.envelope.runId), undefined);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(child.envelope.runId), []);
  }
  const readRows = (resolve = f.resolve) => f.database.withAuthorityReadSnapshot(() => {
    const parent = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(parent);
    return readQueueRecordMembers(f.database.authority, f.canonical.lifecycle, parent,
      f.database.authority.runs.listChildren(parent.envelope.runId), resolve);
  });
  const rows = readRows(); assert.ok(rows);
  assert.deepEqual(rows.members.map(row => row.statusLabel), ["Saving"]);
  assert.deepEqual(rows.members.map(row => row.target.runId), children.map(child => child.envelope.runId));
  const native = f.database.authority.dependencies.groups(f.parentRun.envelope.runId).find(({ group }) => group.invocation.nodeId === "members"); assert.ok(native);
  assert.deepEqual(native.group.invocation.children.map(child => child.sourceRecordIds), selected.map(recordId => [recordId]));
  const generation = f.database.getMeta().authorityGeneration;
  const retained = readRows(id => {
    const descriptor = f.resolve(id);
    return descriptor?.id === "emergency-contact-member" ? { ...descriptor, version: descriptor.version + 1 } : descriptor;
  });
  assert.deepEqual(retained?.members.map(row => row.statusLabel), ["Running"]);
  assert.deepEqual(retained?.members.map(row => row.childRunIds), rows.members.map(row => row.childRunIds));
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(readRows(), rows);
  assert.equal(f.harness.sessions.opens(), 0);
});
it("admits the members delegation once wall time has passed since the approved snapshot read", async () => {
  const f = await world.fixture({ coordinator: true, record: true, pageCount: 1 });
  release(f, [0]);
  const admit = f.canonical.lifecycle.admitDelegation.bind(f.canonical.lifecycle);
  let admitted = 0;
  f.canonical.lifecycle.admitDelegation = (context, plan) => { admitted++; f.clock.advanceWall(1); return admit(context, plan); };
  assert.equal((await f.canonical.step(f.parentRun, new AbortController().signal)).outcome.state, "done");
  const parent = await f.canonical.step(f.parentRun, new AbortController().signal);
  assert.equal(parent.outcome.state, "yielded-delegation", parent.outcome.state === "failed" ? f.database.authority.failures.get(parent.outcome.failureId)?.summary : parent.outcome.state);
  assert.ok(admitted > 0);
  assert.equal(f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member").length, 1);
});
it("authenticates record reads under an admitted member's actual claim and node, refusing task, claim, record, reference and stale-snapshot substitutions while freezing approved authority", async () => {
  const f = await world.fixture({ coordinator: true, record: true }); release(f, [0]);
  const [member] = await admitMembers(f); assert.ok(member);
  const owner = testWorkerLifetime(f.database, f.parentRun.envelope.workflow, 1), runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const claimed = f.canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.parentRun.envelope.workflow, workerId: owner.workerId, runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied" && "run" in claimed);
  assert.equal(claimed.run.envelope.runId, member.envelope.runId);
  const claim = { workerId: owner.workerId, claimGeneration: claimed.run.claimGeneration };
  const transition = (state: "validating" | "running", currentNodeId?: string) => {
    const current = f.database.authority.runs.get(member.envelope.runId); assert.ok(current);
    const result = f.canonical.lifecycle.workerTransition({ commandId: randomUUID(), runId: member.envelope.runId, claim, expectedVersion: current.version,
      lifecycle: { ...current.lifecycle, state, ...(currentNodeId === undefined ? {} : { currentNodeId }) } });
    assert.equal(result.state, "applied");
  };
  transition("validating"); transition("running", "map-contact");
  const input = EmergencyContactMemberInputSchema.parse(member.input.parsed.value);
  const rawQuery = { kind: "record" as const, approval: input.approval, recordId: input.record.recordId };
  const request = { capability: "ocr.approved-snapshot" as const, payload: { schemaHash: deriveSchemaHash(OcrApprovalReadRequestSchema, "output"),
    value: { kind: "record", approval: input.approval, recordId: input.record.recordId } } };
  const options = { signal: new AbortController().signal, deadlineMonotonicMs: 60_000, requestId: "native-member-record" };
  const adapter = (run = claimed.run, database = f.database) => createOcrApprovedSnapshotAdapter({ clock: f.clock, reader: createApprovedOcrRecordReader({ database, run, reader: f.canonical.lifecycle,
    resolveDescriptor: f.resolve, assertCurrent: () => f.admission.assertProfileRuntime() }) });
  const read = async (run = claimed.run, query: z.input<typeof OcrApprovalReadRequestSchema> = rawQuery, database = f.database) => {
    const result = await adapter(run, database).invoke({ ...request, payload: { ...request.payload, value: query } }, options); assert.ok(result.response.state === "produced");
    return schemaBoundValueSchema(OcrApprovalReadResultSchema, deriveSchemaHash(OcrApprovalReadResultSchema, "output")).parse(result.response.value).value;
  };
  assert.equal((await read()).state, "refused");
  transition("running", "approved-record");
  const accepted = await read(); assert.ok(accepted.state === "record"); assert.deepEqual(accepted.record, input.record);
  assert.equal((await read(RunRecordSchema.parse({ ...claimed.run, claimGeneration: Number(claimed.run.claimGeneration) + 1 }))).state, "refused");
  const changed = RunRecordSchema.parse({ ...claimed.run, input: { ...claimed.run.input, parsed: { ...claimed.run.input.parsed, value: { ...input, record: { ...input.record, assertedEid: "10899999" } } } } });
  assert.equal((await read(changed)).state, "refused");
  for (const approval of [{ ...input.approval, sourceRunId: f.parentRun.envelope.runId }, { ...input.approval, digest: "e".repeat(64) }]) {
    assert.equal((await read(claimed.run, { ...rawQuery, approval })).state, "refused");
  }
  assert.equal((await read(claimed.run, { ...rawQuery, recordId: `${"b".repeat(64)}#emergency-contact#2` })).state, "refused");
  const snapshot = f.database.authority.ocrReviews.snapshot(input.approval.snapshotId); assert.ok(snapshot);
  const repositories = f.database.authority, sourceRunId = f.run.envelope.runId;
  const custody = () => ({ meta: f.database.getMeta(), review: repositories.ocrReviews.latest(sourceRunId),
    source: repositories.runs.get(sourceRunId), consumer: repositories.runs.get(member.envelope.runId),
    snapshots: repositories.ocrReviews.snapshots(sourceRunId), gate: repositories.gateResults.get(`${sourceRunId}:approve-records`) });
  const frozen = custody();
  const correction = f.command("correct-ocr-record", snapshot.revision);
  const refusedCorrection = { ...correction, payload: { ...correction.payload, assertedEid: "10899999" } };
  const result = f.canonical.kernel.execute(refusedCorrection);
  assert.ok(result.state === "rejected" && result.code === "OCR_REVIEW_REFUSED");
  assert.deepEqual(repositories.commands.get(refusedCorrection.commandId), refusedCorrection);
  assert.deepEqual(repositories.commandAudits.findByCommand(refusedCorrection.commandId)?.result, result);
  const settled = { ...frozen, meta: { ...frozen.meta, authorityGeneration: frozen.meta.authorityGeneration + 2 } };
  assert.deepEqual(custody(), settled);
  assert.deepEqual(await read(), accepted);
  const earlier = repositories.ocrReviews.revision(sourceRunId, 1); assert.ok(earlier);
  assert.notEqual(earlier.revision, snapshot.revision);
  for (const change of ["stale review", "altered snapshot"] as const) {
    const database = ocrProofReadDatabase(f.database, { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      latest: id => change === "stale review" && id === sourceRunId ? earlier : repositories.ocrReviews.latest(id),
      snapshots: id => repositories.ocrReviews.snapshots(id).map(value => change === "altered snapshot" && value.snapshotId === snapshot.snapshotId
        ? OcrApprovedSnapshotSchema.parse({ ...value, reviewDigest: "f".repeat(64) }) : value),
    } });
    assert.deepEqual(await read(claimed.run, rawQuery, database), { state: "refused", code: "OCR_REVIEW_REFUSED" }, change);
  }
  assert.deepEqual(custody(), settled);
  assert.deepEqual(await read(), accepted);
  assert.deepEqual(f.database.authority.ocrReviews.snapshot(input.approval.snapshotId), snapshot);
  assert.equal(f.harness.sessions.opens(), 0);
});
it("accounts for an actual foreign-person refusal as failed without inventing a saved child output", async () => {
  const port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse(contactPage.page) });
  const sessions = sessionFactoryHarness({ ucpath: () => createDeterministicUcpathPersonOrgDriver(undefined, undefined, port) });
  const f = await world.fixture({ coordinator: true, record: true, sessions }); release(f, [0]);
  let result = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.equal(result.outcomes.at(-1)?.state, "failed");
  result = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done");
  const stored = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(stored);
  const output = EmergencyContactResultSchema.parse(stored.result.value);
  assert.equal(output.members.length, 1); assert.equal(output.members[0]?.state, "failed");
  const [member] = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member"); assert.ok(member);
  assert.equal(f.database.authority.failures.listByRun(member.envelope.runId)[0]?.code, "CONTACT_SUBJECT_MISMATCH");
  assert.ok(f.harness.sessions.opens() > 0);
  assert.ok(port.actions.every(action => !/^(fill|demote|add)/u.test(action)));
  const failed = f.database.authority.runResults.get(member.envelope.runId); assert.ok(failed);
  assert.equal(RunTerminalEvidenceResultSchema.parse(failed.result.value).kind, "failed-evidence");
  assert.equal(EmergencyContactMemberResultSchema.safeParse(failed.result.value).success, false);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(member.envelope.runId), []);
});

it("previews a nonempty parent through ordinary OCR, selected child preparations and authenticated aggregation with zero writes", async () => {
  const reviewedPages = [
    { employeeName: "Example, Avery", contactName: "Robin Draft", correctedContactName: "Robin Corrected" },
    { employeeName: "Sample, Blair", contactName: "Casey Draft", correctedContactName: "Casey Corrected" },
    { employeeName: "Fixture, Cameron", contactName: "Drew Draft", correctedContactName: "Drew Corrected" },
  ];
  const selection = [2, 0];
  const ports = new Map<string, ReturnType<typeof createDeterministicUcpathContactPage>>();
  const captures = new Map<string, UcpathContactPageSnapshot[]>(), searched: string[] = [];
  const target = childWorkflowModuleOf("emergency-contact", "emergency-contact-member");
  const nativeMembers = new Map<string, { input: z.output<typeof EmergencyContactMemberInputSchema>; fingerprint: string }>();
  let released = false;
  function contactDriver(eid: string) {
    assert.equal(released, true, "contact acquisition must follow the native OCR release");
    const index = selection.find(index => String(10800000 + index) === eid); assert.ok(index !== undefined);
    const facts = reviewedPages[index]; assert.ok(facts);
    let port = ports.get(eid);
    if (port === undefined) {
      port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
        displayedEid: eid, displayedName: facts.employeeName }) });
      ports.set(eid, port);
    }
    return createDeterministicUcpathPersonOrgDriver(undefined, undefined, port);
  }
  const sessions = sessionFactoryHarness({ ucpath: (): ReturnType<typeof createDeterministicUcpathPersonOrgDriver> => {
    const driver = createDeterministicUcpathPersonOrgDriver();
    let activeEid: string | undefined;
    return { ...driver,
      async searchPersonOrg(input) {
        assert.ok(input.kind === "by-name"); searched.push(input.name);
        const index = reviewedPages.findIndex(page => page.employeeName === input.name); assert.ok(index >= 0);
        if (index !== 0) return SearchPersonOrgOutputSchema.parse({ results: [],
          selection: { status: "not-found", selected: null, candidateEids: [], searchName: input.name } });
        const candidate = { emplId: String(10800000 + index), name: input.name, department: "Housing Dining Hospitality", jobTitle: "Fixture employee",
          employeeStatus: "active", hdh: true, hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
        return SearchPersonOrgOutputSchema.parse({ results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] } });
      },
      async readEmergencyContacts(input) { activeEid = input.emplId; return contactDriver(input.emplId).readEmergencyContacts(input); },
      async stageEmergencyContact(input, plan) { activeEid = input.emplId; return contactDriver(input.emplId).stageEmergencyContact(input, plan); },
      async read(id) { if (id !== UCPATH_CONTACT_DISPLAYED_NAME) return driver.read(id); assert.ok(activeEid); return contactDriver(activeEid).read(id); },
    };
  }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
  const f = await world.fixture({ coordinator: true, record: true, pageCount: 3, reviewedPages, operatorEvidence: true, dryRun: true, sessions,
    screenshotCapture: { capture: async context => {
      assert.equal(context.screenshot.state, "available");
      const member = nativeMembers.get(context.runId);
      if (member === undefined) { assert.notEqual(context.descriptorFingerprint, target.descriptor.contractFingerprint); return; }
      assert.equal(context.descriptorFingerprint, member.fingerprint);
      assert.ok(member.input.record.assertedEid);
      const port = ports.get(member.input.record.assertedEid); assert.ok(port);
      const snapshot = await port.snapshot(); assert.equal(snapshot.displayedEid, member.input.record.assertedEid);
      const previous = captures.get(context.runId) ?? []; previous.push(snapshot); captures.set(context.runId, previous);
    } },
  });
  assert.equal(f.parentRun.envelope.dryRun, true);
  assert.equal(ports.size, 0);
  assert.deepEqual(searched, reviewedPages.map(page => page.employeeName));
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-gate");
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  assert.equal(review.records.length, 3);
  const identities = f.readResult().identities;
  assert.equal(identities.length, 3);
  for (const [index, identity] of identities.entries()) {
    assert.ok(identity.outcome.state === "done");
    assert.ok("activeStatus" in identity.outcome.output);
    assert.equal(identity.outcome.output.activeStatus.state, index === 0 ? "active" : "not-found");
    assert.equal(identity.outcome.output.activeStatus.details.eid, index === 0 ? "10800000" : null);
  }
  const selected = release(f, selection);
  released = true;
  const members = await admitMembers(f);
  for (const member of members) {
    assert.equal(member.envelope.contractFingerprint, target.descriptor.contractFingerprint);
    nativeMembers.set(member.envelope.runId, { input: EmergencyContactMemberInputSchema.parse(member.input.parsed.value), fingerprint: member.envelope.contractFingerprint });
  }
  const snapshot = f.database.authority.ocrReviews.snapshots(f.run.envelope.runId)[0]; assert.ok(snapshot);
  assert.deepEqual(snapshot.selectedRecordIds, selected);
  assert.deepEqual(snapshot.records.map(record => approvedEmergencyContact(record).contact.name), selection.map(index => reviewedPages[index]?.correctedContactName));
  assert.ok(snapshot.records.every(record => record.recordId !== review.records[1]?.recordId));
  assert.deepEqual(members.map(member => EmergencyContactMemberInputSchema.parse(member.input.parsed.value).record), snapshot.records);
  assert.deepEqual(members.map(member => EmergencyContactMemberInputSchema.parse(member.input.parsed.value).record.recordId), selected);
  const ocrResult = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(ocrResult);
  assert.equal(readRunPreviewResult(ocrResult), undefined);
  const pendingRows = f.database.withAuthorityReadSnapshot(() => {
    const parent = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(parent);
    return readQueueRecordMembers(f.database.authority, f.canonical.lifecycle, parent,
      f.database.authority.runs.listChildren(parent.envelope.runId), f.resolve);
  });
  assert.ok(pendingRows);
  assert.deepEqual(pendingRows.members.map(row => row.kind === "record" ? row.record.recordId : row.kind), review.records.map(record => record.recordId));
  assert.deepEqual(pendingRows.members.map(row => row.statusLabel), ["Previewing", "Not approved", "Previewing"]);
  for (const [index, row] of pendingRows.members.entries()) {
    assert.ok(row.kind === "record");
    if (index === 1) { assert.equal(row.target.section, "review"); continue; }
    const member = members.find(member => EmergencyContactMemberInputSchema.parse(member.input.parsed.value).record.recordId === row.record.recordId);
    assert.ok(member);
    assert.equal(row.target.section, "logs"); assert.equal(row.target.runId, member.envelope.runId);
    assert.ok(row.childRunIds.includes(member.envelope.runId));
  }
  const result = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done",
    JSON.stringify(result.outcomes.map(outcome => ({ state: outcome.state }))));
  f.database.withAuthorityReadSnapshot(() => {
    const parentResult = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(parentResult);
    const preview = RunDelegatedDryRunPreviewResultSchema.parse(parentResult.result.value);
    assert.equal(preview.externalCommit, "none");
    assert.equal(preview.steps.find(step => step.nodeId === "members")?.state, "delegation-preview");
    assert.equal(preview.steps.find(step => step.nodeId === "read-result")?.state, "unavailable");
    assert.equal(EmergencyContactResultSchema.safeParse(parentResult.result.value).success, false);
    const receipt = parentResult.dependencies.find(dependency => dependency.nodeId === "members");
    assert.ok(receipt?.state === "delegation-resolved");
    assert.deepEqual(receipt.members.map(member => member.runId), members.map(member => member.envelope.runId));
    for (const member of members) {
      assert.equal(member.envelope.dryRun, true);
      const stored = f.database.authority.runResults.get(member.envelope.runId); assert.ok(stored);
      assert.equal(RunDryRunPreviewResultSchema.parse(stored.result.value).externalCommit, "none");
      assert.equal(EmergencyContactMemberResultSchema.safeParse(stored.result.value).success, false);
    }
    const all = [f.parentRun];
    for (let index = 0; index < all.length; index++) { const run = all[index]; assert.ok(run); all.push(...f.database.authority.runs.listChildren(run.envelope.runId)); }
    assert.equal(all.filter(run => run.envelope.workflow === "person-lookup").length, 3);
    assert.equal(all.filter(run => run.envelope.workflow === "i9-lookup").length, 0);
    for (const run of all) {
      assert.equal(run.envelope.dryRun, true);
      const stored = f.database.authority.runResults.get(run.envelope.runId); assert.ok(stored);
      assert.equal(readRunPreviewResult(stored) !== undefined, ["emergency-contact", "emergency-contact-member"].includes(run.envelope.workflow));
      assert.deepEqual(f.database.authority.writeIntents.listByRun(run.envelope.runId), []);
      assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
    }
  });
  assert.equal(ports.size, 2);
  for (const member of members) {
    const input = EmergencyContactMemberInputSchema.parse(member.input.parsed.value), desired = contactEffect(approvedEmergencyContact(input.record));
    assert.ok(input.record.assertedEid);
    const port = ports.get(input.record.assertedEid); assert.ok(port);
    assert.ok(port.actions.includes("demote-primary:0") && port.actions.includes("fill-fields:1") && port.actions.includes("fill-name:1"));
    assert.ok(port.actions.indexOf("demote-primary:0") < port.actions.indexOf("fill-fields:1"));
    assert.ok(port.actions.indexOf("fill-fields:1") < port.actions.indexOf("fill-name:1"));
    const pair = captures.get(member.envelope.runId); assert.ok(pair && pair.length >= 2);
    const original = pair[0], final = pair.at(-1); assert.ok(original && final);
    assert.equal(original.observation, "persisted"); assert.equal(original.rows[0]?.primary, true);
    assert.equal(final.observation, "staged"); assert.equal(final.rows[0]?.primary, false);
    const primaries = interpretContactPage(final, approvedEmergencyContact(input.record)).rows.filter(row => row.kind === "contact" && row.effect.primary);
    assert.equal(primaries.length, 1); assert.ok(primaries[0]?.kind === "contact"); assert.deepEqual(primaries[0].effect, desired);
    assert.ok(!("save" in port) && !("commit" in port));
  }

  const currentParent = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(currentParent?.appVersion);
  const projection = createOperatorProjection({ database: f.database, reader: f.canonical.lifecycle, stateRoot: f.harness.authority.stateRoot,
    clock: f.clock, appVersion: currentParent.appVersion, descriptorSetHash: FingerprintSchema.parse(sha256Hex(f.root.descriptor.contractFingerprint)),
    ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  projection.rebuildFromTimeline();
  const surface = projection.queueSurface(f.parentRun.envelope.runId); assert.ok(surface?.surfaceKind === "operation");
  assert.deepEqual([...surface.memberRunIds].sort(), members.map(member => member.envelope.runId).sort());
  assert.deepEqual(surface.memberRollup, { total: 2, terminal: 2, failed: 0 });
  assert.deepEqual(surface.linkedRuns, []);
  assert.deepEqual(surface.recordMembers?.members.map(row => row.kind === "record" ? row.record.recordId : row.kind), review.records.map(record => record.recordId));
  assert.deepEqual(surface.recordMembers?.members.map(row => row.statusLabel), ["Previewed", "Not approved", "Previewed"]);
  assert.ok(surface.recordMembers?.members.every(row => row.statusLabel !== "Saved"));
  const ocrSurface = projection.queueSurface(f.run.envelope.runId); assert.ok(ocrSurface);
  assert.equal(ocrSurface.parent?.runId, f.parentRun.envelope.runId);
  assert.equal(ocrSurface.parent?.visibility, "hidden-unless-failed");
  for (const member of members) {
    const memberSurface = projection.queueSurface(member.envelope.runId); assert.ok(memberSurface);
    assert.equal(memberSurface.parent?.runId, f.parentRun.envelope.runId);
  }
  let cursor = 0;
  for (;;) {
    const events = f.database.authority.timelineEvents.page({ after: cursor, limit: 1000 });
    assert.ok(events.every(event => event.payload.kind !== "span" || event.payload.event.t !== "transaction.fenced"));
    if (events.length < 1000) break;
    const last = events.at(-1); assert.ok(last); cursor = last.cursor;
  }
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.deepEqual(createTransactionHistory(f.database.authority).query({ from: date, to: date }).rows, []);
}, scaledMs(60_000));
