import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { readRunPanel } from "../../../src/backend/runs/queries/run-detail.js";
import { projectTypedSteps } from "../../../src/backend/runs/queries/run-detail/typed-values.js";
import { readRerunValues } from "../../../src/backend/runs/start/rerun-values.js";
import { projectStartRows, projectStartSteps, startRowWire } from "../../../src/backend/runs/start/step-selection.js";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { sourceBadge, startRowsOf } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { EmergencyContactMemberResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import assert from "node:assert/strict";
import { afterEach,it } from "vitest";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { releaseSeededWriteOwners } from "../../support/helpers/timeline-write-fixture.js";
import { interpretContactPage } from "../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { UcpathContactPageSnapshotSchema } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { approvedEmergencyContact,contactEffect } from "../../../src/rules/ucpath/emergency-contact.js";
import fixture from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { contactSaveMember as compiled, createEmergencyContactSaveWorld } from "../../support/helpers/backend/emergency-contact-save-world.js";

const world = createEmergencyContactSaveWorld();
afterEach(world.cleanup);
const { memberFixture } = world;
const contact = approvedEmergencyContact(EMERGENCY_CONTACT_MEMBER_EXAMPLE.record);
const desired = contactEffect(contact);

function receiptFor(f: Awaited<ReturnType<typeof memberFixture>>) {
  return createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: [compiled.descriptor] })
    .ensureReceipt(f.run.envelope.runId);
}

it("emergency-contact/verified-save — commits the declared primary demotion and addition once, then independently verifies and durably settles the persisted whole set", async () => {
  const f = await memberFixture();
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  const stored = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(stored);
  const saved = EmergencyContactMemberResultSchema.parse(stored.result.value);
  assert.ok(saved.disposition !== "omitted");
  const output = saved.proof;
  const original = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), contact).rows[0]; assert.ok(original?.kind === "contact");
  assert.deepEqual(output.contacts.rows, [{ kind: "contact", rowIndex: 0, effect: { ...original.effect, primary: false } }, { kind: "contact", rowIndex: 1, effect: desired }]);
  assert.equal(output.contacts.observation, "persisted");
  assert.ok(f.captures.some(snapshot => snapshot.observation === "staged" && snapshot.rows[0]?.primary === false && snapshot.rows[1]?.primary === true));
  const receipts = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: [compiled.descriptor] });
  const receipt = receipts.ensureReceipt(f.run.envelope.runId);
  assert.equal(receipt.result, "verified-done");
  assert.deepEqual(receipts.ensureReceipt(f.run.envelope.runId), receipt);
  assert.equal(f.reads, 4, "initial read, native probe, mandatory native verifier and the re-entry read after filing");
  const intents = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "committed");
  assert.ok(f.database.authority.runCheckpoints.latest(f.run.envelope.workflow, f.run.envelope.itemId, "contact-preview"));
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.equal(createTransactionHistory(f.database.authority).query({ from: date, to: date, runId: f.run.envelope.runId }).rows.length, 1);
  assert.equal(f.filing.imports(), 1, "a committed Save files exactly one Import");
  const children = f.children(); assert.equal(children.length, 1);
  assert.deepEqual(children[0]?.input.parsed.value, { ucpathId: contact.emplId, document: f.filing.document, sourcePage: 2 });
  assert.ok(children[0]?.lifecycle.state === "terminal" && children[0].lifecycle.outcome === "done");
  assert.equal(f.database.authority.writeIntents.listByRun(children[0].envelope.runId)[0]?.status, "committed");
});
it("do-not-file-save — a run picked \"do not file\" commits its Save, admits no filing child, clicks no Import and settles done with no failure", async () => {
  const f = await memberFixture({ onbaseFiling: "skip" });
  assert.deepEqual(f.failures, []);
  assert.deepEqual(f.result.outcomes.map(outcome => outcome.state), ["done"]);
  assert.equal(f.persistence.submissions.length, 1);
  const stored = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(stored?.lifecycle.state === "terminal" && stored.lifecycle.outcome === "done");
  assert.equal(f.database.authority.writeIntents.listByRun(f.run.envelope.runId)[0]?.status, "committed");
  const saved = EmergencyContactMemberResultSchema.parse(f.database.authority.runResults.get(f.run.envelope.runId)?.result.value);
  assert.ok(saved.disposition !== "omitted");
  assert.equal(saved.proof.contacts.observation, "persisted");
  assert.deepEqual(f.children(), []);
  assert.equal(f.filing.imports(), 0);
  // The filing step is unavailable in this fixture: a "do not file" member never reaches it.
  const unavailable = await memberFixture({ onbaseFiling: "skip", onbaseUnavailable: true });
  assert.deepEqual(unavailable.failures, []);
  assert.deepEqual(unavailable.children(), []);
});
it("shared-page-save — a committed Save with no page to file admits no filing child and clicks no Import", async () => {
  const f = await memberFixture({ sourcePage: null });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "terminal");
  assert.equal(f.database.authority.writeIntents.listByRun(f.run.envelope.runId)[0]?.status, "committed");
  assert.deepEqual(f.children(), []);
  assert.equal(f.filing.imports(), 0);
});
it("failed-filing-save — a failed OnBase filing after a committed Save holds the member open on its one Save", async () => {
  const f = await memberFixture({ onbaseUnavailable: true });
  const child = f.children()[0]; assert.ok(child);
  assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
  const member = f.database.authority.runs.get(f.run.envelope.runId);
  assert.equal(member?.lifecycle.state, "queued", `a failed filing must hold its member open: ${JSON.stringify(member?.lifecycle)}`);
  assert.deepEqual(f.database.authority.dependencies.waitState(f.run.envelope.runId), { nodeId: "onbase-filing", state: "blocked" });
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.equal(f.persistence.submissions.length, 1);
  assert.equal(f.database.authority.writeIntents.listByRun(f.run.envelope.runId)[0]?.status, "committed");
  assert.equal(f.filing.imports(), 0);
});
for (const failure of ["identity-before-click", "timeout", "lost-page", "unknown-response", "foreign-eid", "foreign-name", "staged-page-drift", "pending", "save-before", "save-after", "partial", "primary-conflict", "unreadable", "mismatch", "staged-readback", "stale-readback", "verifier", "capture-after"] as const) it(`parks ${failure} after the fence without a forged output or retry`, async () => {
  const f = await memberFixture({ failure });
  const intents = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "parked");
  const intent = intents[0]; assert.ok(intent);
  assert.equal(f.database.authority.writeAttempts.get(intent.currentAttemptId)?.outcome.state, "parked");
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-write");
  if (failure === "partial") assert.equal(f.persistence.snapshot().rows.length, 1);
  if (failure === "primary-conflict") assert.deepEqual(f.persistence.snapshot().rows.map(row => row.primary), [true, true]);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.deepEqual(createTransactionHistory(f.database.authority).query({ from: date, to: date, runId: f.run.envelope.runId }).rows, []);
  assert.equal(f.database.authority.runCheckpoints.latest(f.run.envelope.workflow, f.run.envelope.itemId, "contact-preview"), undefined);
  assert.deepEqual(f.children(), [], "a parked Save admits no filing child");
  assert.equal(f.filing.imports(), 0);
  const submissions = f.persistence.submissions.length;
  assert.equal(submissions, failure === "identity-before-click" || failure === "staged-page-drift" || failure === "save-before" || failure === "pending" ? 0 : 1);
  const retry = f.execution.start(compiled.descriptor, f.member(`${"b".repeat(64)}#emergency-contact#2`, 1), { dryRun: false });
  await f.execution.execute(retry, world.SIGNAL);
  assert.equal(f.persistence.submissions.length, submissions);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(retry.envelope.runId), []);
  if (failure === "save-after" || failure === "staged-page-drift") assert.match(f.database.authority.failures.listByRun(retry.envelope.runId)[0]?.summary ?? "", /parked/u);
});
for (const failure of ["read", "probe", "prepare", "identity", "drift", "capture-prepare", "capture-before"] as const) it(`refuses ${failure} before the fence with zero Save and intents`, async () => {
  const f = await memberFixture({ failure });
  assert.ok(f.failures.length > 0);
  assert.equal(f.persistence.submissions.length, 0);
  assert.deepEqual(f.children(), [], "a refused Save admits no filing child");
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
});
it("uses complete persisted exact presence without a new intent or Save", async () => {
  const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows;
  rows[0] = { ...rows[0], primary: false };
  rows[1] = { ...rows[1], rowIndex: 1, name: desired.name, relationship: desired.relationship, primary: true, phone: desired.phone ?? "", sameAddressAsEmployee: false,
    address: desired.address.kind === "explicit" ? desired.address.fields : null };
  const f = await memberFixture({ rows });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 0);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
  assert.equal(f.filing.imports(), 1, "an already-present Save still files exactly one Import");
  assert.equal(f.children().length, 1);
});

it("keeps interrupted Save ownership until callback settlement, verifies and commits it once, then abandons the run without a result or another click", async () => {
  const f = await memberFixture({ interrupt: true });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  assert.equal(f.reads, 3, "initial read, native probe and mandatory native verifier");
  const intents = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "committed");
  assert.ok(f.database.authority.runCheckpoints.latest(f.run.envelope.workflow, f.run.envelope.itemId, "contact-preview"));
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.equal(createTransactionHistory(f.database.authority).query({ from: date, to: date, runId: f.run.envelope.runId }).rows.length, 1);
  assert.deepEqual(f.result.outcomes.map(outcome => outcome.state), ["abandoned"]);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.notEqual(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "terminal");
  // The controller recovers the abandoned claim when the interrupted worker exits.
  releaseSeededWriteOwners(f.database, f.clock.now().toISOString());
  const retry = f.execution.start(compiled.descriptor, f.member(`${"b".repeat(64)}#emergency-contact#2`, 1), { dryRun: false });
  await f.execution.execute(retry, world.SIGNAL);
  assert.equal(f.persistence.submissions.length, 1);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(retry.envelope.runId), []);
  assert.deepEqual(f.database.authority.failures.listByRun(retry.envelope.runId), []);
  const reused = f.database.authority.runResults.get(retry.envelope.runId); assert.ok(reused);
  assert.equal(EmergencyContactMemberResultSchema.parse(reused.result.value).disposition, "already-present");
});

it("saves an addition with no demotion when the complete original set has no primary", async () => {
  const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows.map(row => ({ ...row, primary: false }));
  const f = await memberFixture({ rows });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  assert.deepEqual(f.persistence.snapshot().rows.map(row => row.primary), [false, true]);
});

it("prepares the real production workflow in dry run with zero Save clicks and no write intent", async () => {
  const f = await memberFixture({ dryRun: true });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 0);
  assert.equal(f.filing.imports(), 0, "a dry run never clicks Import");
  assert.ok(f.children().every(child => child.envelope.dryRun && f.database.authority.writeIntents.listByRun(child.envelope.runId).length === 0));
  assert.ok(f.captures.some(snapshot => snapshot.observation === "staged"));
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
});

it("turns off the UCPath Save without preparing, fencing or clicking it and logs Done outside Relay", async () => {
  const f = await memberFixture({ stepOmissions: [{ step: "contact-preview", facts: {} }] });
  const runId = f.run.envelope.runId;
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 0);
  assert.ok(!f.captures.some(snapshot => snapshot.observation === "staged"));
  assert.deepEqual(f.database.authority.writeIntents.listByRun(runId), []);
  assert.equal(f.filing.imports(), 1, "an included OnBase filing still runs after a manually completed Save");
  assert.deepEqual(f.database.authority.runResults.get(runId)?.result.value, { disposition: "omitted", step: "contact-preview" });
  const receipt = receiptFor(f);
  assert.partialDeepStrictEqual(receipt.output.find(fact => fact.field === "step"), { state: "satisfied", value: { value: "contact-preview" } });

  const { stateRoot } = f.authority;
  const reader = testRunService(f.database, f.clock);
  const descriptors = { resolve: (id: string) => id === compiled.descriptor.id ? compiled.descriptor : undefined };
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(f.database.authority), descriptors });
  projection.ingestFromTimeline();
  const panel = await readRunPanel(createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { database: f.database, reader, descriptors } }), runId, world.SIGNAL);
  assert.match(logPlainText(projectRunLogs({ ...panel, unavailableEvidence: [] }, { artifactUrl: () => "unused" }).steps), /Done outside Relay/u);
});

it("uses the typed reference result to open the downstream review before a live Save", async () => {
  const f = await memberFixture({ stepOmissions: [{ step: "reference-check", facts: { referenceResult: "Unconfirmed" } }] });
  const runId = f.run.envelope.runId;
  const blocked = f.database.authority.runs.get(runId);
  assert.ok(blocked?.lifecycle.state === "parked-gate");
  assert.equal(blocked.lifecycle.gateId, "reference-field-review-read-contacts");
  const asserted = f.database.authority.runCheckpoints.latest(f.run.envelope.workflow, f.run.envelope.itemId, "reference-fields-read-contacts");
  assert.equal(asserted?.assertion?.step, "reference-check");
  assert.deepEqual(asserted?.output.value, { captured: null, matches: [], mismatches: [], review: true });
  assert.deepEqual(f.failures, []);
  assert.deepEqual(f.children(), []);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(runId), []);
  const { stateRoot } = f.authority;
  const reader = testRunService(f.database, f.clock);
  const descriptors = { resolve: (id: string) => id === compiled.descriptor.id ? compiled.descriptor : undefined };
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(f.database.authority), descriptors });
  projection.ingestFromTimeline();
  const panel = await readRunPanel(createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { database: f.database, reader, descriptors } }), runId, world.SIGNAL);
  const { gate } = panel.detail;
  assert.ok(gate.state === "open" && gate.decision?.options.some(option => option.id === "continue"));
  assert.equal(gate.decision.context, "Reference spreadsheet result: Unconfirmed");
});

it("records the receipt after a confirmed manual reference read", async () => {
  const f = await memberFixture({ onbaseFiling: "skip", stepOmissions: [{ step: "reference-check", facts: { referenceResult: "Confirmed" } }] });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  assert.partialDeepStrictEqual(receiptFor(f).output.find(fact => fact.field === "disposition"),
    { state: "satisfied", value: { value: "committed" } });
});

it("records the Save receipt without releasing a child when OnBase filing is done by hand", async () => {
  const f = await memberFixture({ stepOmissions: [{ step: "onbase-filing", facts: {} }] });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  assert.deepEqual(f.children(), []);
  assert.equal(f.filing.imports(), 0);
  assert.partialDeepStrictEqual(receiptFor(f).output.find(fact => fact.field === "disposition"),
    { state: "satisfied", value: { value: "committed" } });
});

it("authenticates OCR approval, skips both writes and withholds the typed ID from Logs and Rerun", async () => {
  const f = await memberFixture({ stepOmissions: [
    { step: "contact-plan", facts: { emplId: contact.emplId } },
    { step: "contact-preview", facts: {} },
    { step: "onbase-filing", facts: {} },
  ] });
  assert.deepEqual(f.failures, []);
  assert.equal(f.providerCalls, 1);
  assert.equal(f.reads, 0);
  assert.deepEqual(f.children(), []);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
  assert.deepEqual(f.database.authority.runResults.get(f.run.envelope.runId)?.result.value, { disposition: "omitted", step: "contact-preview" });
  assert.partialDeepStrictEqual(receiptFor(f).output.find(fact => fact.field === "step"),
    { state: "satisfied", value: { value: "contact-preview" } });

  const source = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(source?.lifecycle.state === "terminal" && source.lifecycle.outcome === "done");
  const fields = projectTypedSteps(source, compiled.descriptor).get("contact-plan")?.typedValues?.fields;
  assert.deepEqual(fields, [{ key: "emplId", label: "Employee ID", withheld: true, mark: "Typed by hand" }]);
  const values = readRerunValues({ database: f.database, reader: f.execution.lifecycle,
    descriptors: { resolve: id => id === compiled.descriptor.id ? compiled.descriptor : undefined } },
  { runId: source.envelope.runId, expectedVersion: source.version });
  assert.ok(values.state === "available", JSON.stringify(values));
  assert.deepEqual(values.snapshot.typed?.map(({ step }) => step), ["contact-preview", "onbase-filing"]);
  const rows = startRowsOf({ steps: projectStartSteps(compiled.descriptor), rows: projectStartRows(compiled.descriptor).map(startRowWire) });
  const contactPlan = rows.find(({ key }) => key === "contact-plan");
  assert.ok(contactPlan);
  assert.equal(sourceBadge(contactPlan, values.snapshot), "skipped");
});
