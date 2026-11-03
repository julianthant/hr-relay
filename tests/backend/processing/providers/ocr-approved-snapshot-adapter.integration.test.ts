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

import { createDeterministicUcpathContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UcpathContactPageSnapshotSchema, type UcpathContactPageSnapshot } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { RunDryRunPreviewResultSchema, RunDelegatedDryRunPreviewResultSchema, readRunPreviewResult } from "../../../../src/models/run/result.js";
import { sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
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
  const manifest = retainedDelegationManifests(f.database.authority, f.parentRun.envelope.runId).find(manifest => manifest.edgeId === "approved-records");
  assert.ok(manifest);
  return authenticateOriginalDelegationGroup(f.database.authority, manifest).children.map(child => child.original);
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
  assert.equal(f.harness.sessions.opens(), 0);
});
it("authenticates record reads under an admitted member's actual claim and node, refusing task, claim, record, reference and later-draft substitutions", async () => {
  const f = await world.fixture({ coordinator: true, record: true }); release(f, [0]);
  const [member] = await admitMembers(f); assert.ok(member);
  const owner = testWorkerLifetime(f.database, f.parentRun.envelope.workflow, 1), runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const claimed = f.canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.parentRun.envelope.workflow, workerId: owner.workerId, workerLifetime: owner.workerLifetime,
    runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
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
  const adapter = (run = claimed.run) => createOcrApprovedSnapshotAdapter({ clock: f.clock, reader: createApprovedOcrRecordReader({ database: f.database, run, reader: f.canonical.lifecycle,
    resolveDescriptor: f.resolve, assertCurrent: () => f.admission.assertProfileRuntime() }) });
  const read = async (run = claimed.run, query: z.input<typeof OcrApprovalReadRequestSchema> = rawQuery) => {
    const result = await adapter(run).invoke({ ...request, payload: { ...request.payload, value: query } }, options); assert.ok(result.response.state === "produced");
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
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 2)).state, "applied");
  assert.equal((await read()).state, "refused");
  assert.deepEqual(f.database.authority.ocrReviews.snapshot(input.approval.snapshotId), snapshot);
  assert.equal(f.harness.sessions.opens(), 0);
});
it("accounts for an actual unavailable real member as failed without inventing a saved child output", async () => {
  const f = await world.fixture({ coordinator: true, record: true }); release(f, [0]);
  let result = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.equal(result.outcomes.at(-1)?.state, "failed");
  result = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done");
  const stored = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(stored);
  const output = EmergencyContactResultSchema.parse(stored.result.value);
  assert.equal(output.members.length, 1); assert.equal(output.members[0]?.state, "failed");
  const [member] = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member"); assert.ok(member);
  assert.equal(f.database.authority.failures.listByRun(member.envelope.runId)[0]?.code, "CONTACT_SAVE_UNAVAILABLE");
  assert.equal(f.harness.sessions.opens(), 0);
});

it("previews a nonempty parent through ordinary OCR, selected child preparations and authenticated aggregation with zero writes", async () => {
  const selection = [1, 0];
  const ports: ReturnType<typeof createDeterministicUcpathContactPage>[] = [], captures: UcpathContactPageSnapshot[] = [];
  const sessions = sessionFactoryHarness({ ucpath: openIndex => {
    const index = selection[openIndex - 1]; assert.ok(index !== undefined);
    const port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
      displayedEid: String(10800000 + index), displayedName: "Example, Avery" }) });
    ports.push(port);
    return createDeterministicUcpathPersonOrgDriver(undefined, undefined, port);
  } });
  const f = await world.fixture({ coordinator: true, record: true, pageCount: 2, dryRun: true, sessions,
    screenshotCapture: { capture: async context => {
      assert.equal(context.screenshot.state, "available");
      const port = ports.at(-1); assert.ok(port); captures.push(await port.snapshot());
    } },
  });
  assert.equal(f.parentRun.envelope.dryRun, true);
  assert.equal(sessions.opens(), 0);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-gate");
  const selected = release(f, selection), members = await admitMembers(f);
  assert.deepEqual(members.map(member => EmergencyContactMemberInputSchema.parse(member.input.parsed.value).record.recordId), selected);
  const ocrResult = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(ocrResult);
  assert.equal(readRunPreviewResult(ocrResult), undefined);
  const result = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done",
    JSON.stringify(result.outcomes.map(outcome => ({ state: outcome.state }))));
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
  assert.equal(ports.length, 2);
  assert.ok(ports.every(port => port.actions.includes("demote-primary:0") && port.actions.includes("fill-name:1")));
  assert.ok(captures.some(page => page.observation === "persisted" && page.rows[0]?.primary));
  assert.ok(captures.some(page => page.observation === "staged" && page.rows[0]?.primary === false && page.rows[1]?.primary));
  assert.ok(ports.every(port => !("save" in port) && !("commit" in port)));
  const all = [f.parentRun, f.run, ...f.database.authority.runs.listChildren(f.run.envelope.runId), ...members];
  for (const run of all) {
    assert.equal(run.envelope.dryRun, true);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
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
});
