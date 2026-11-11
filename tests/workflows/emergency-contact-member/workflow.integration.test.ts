import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { readApprovedOcrRecordTask } from "../../../src/backend/processing/ocr/tasks/read-approved-record.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { ucpathDriver } from "../../../src/backend/systems/ucpath/driver-declaration.js";
import { createDeterministicUcpathContactPage } from "../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { interpretContactPage } from "../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { ucpathSession } from "../../../src/backend/systems/ucpath/session-provider.js";
import { probeEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/match-emergency-contact-plan.js";
import { readEmergencyContactsTask } from "../../../src/backend/systems/ucpath/tasks/read-emergency-contacts.js";
import { saveEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/save-emergency-contact.js";
import { stageEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/stage-emergency-contact.js";
import { verifyEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/verify-emergency-contact-plan.js";
import { OcrApprovalReadResultSchema } from "../../../src/models/processing/ocr/approved-snapshot.js";
import { readRunPreviewResult } from "../../../src/models/run/result.js";
import type { UcpathContactPageSnapshot } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { UcpathContactPageSnapshotSchema } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { approvedEmergencyContact,contactEffect,planEmergencyContact } from "../../../src/rules/ucpath/emergency-contact.js";
import { defineBrowserStore,defineServiceStore,defineTaskStoreRegistry,type RegisteredTaskStore } from "../../../src/workflow-kit/task-registry.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactMemberStore } from "../../../src/workflows/emergency-contact-member/task-registry.js";
import { emergencyContactMemberWorkflow } from "../../../src/workflows/emergency-contact-member/workflow.js";
import { testRunLifecycle } from "../../support/fixtures/run-lifecycle-fixtures.js";
import fixture from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { seedUnknownContactWrite } from "../../support/helpers/backend/unknown-contact-write.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { ONBASE_SOURCE_DOCUMENT, onbaseChildFixture } from "../../support/helpers/backend/onbase-child-fixture.js";
import { onbaseModule } from "../../support/helpers/registered-workflows.js";
import { OnbaseInputSchema } from "../../../src/models/systems/onbase/import-document.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
const compiled = compileWorkflow(emergencyContactMemberWorkflow);
const approved = { ...EMERGENCY_CONTACT_MEMBER_EXAMPLE, document: ONBASE_SOURCE_DOCUMENT, sourcePage: 2 };
const contact = approvedEmergencyContact(approved.record);
const desired = contactEffect(contact);

async function memberFixture(options: { rows?: UcpathContactPageSnapshot["rows"]; dryRun?: boolean; unknownProbe?: boolean; captureFailure?: boolean; priorWrite?: "attempting" | "parked" } = {}) {
  const browser = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { readContacts: readEmergencyContactsTask,
    stageContact: stageEmergencyContactTask, probeContact: probeEmergencyContactTask, verifyContact: verifyEmergencyContactTask, saveContact: saveEmergencyContactTask });
  const service = defineServiceStore("ocr", { readRecord: readApprovedOcrRecordTask });
  const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => !["ucpath", "ocr", "workflow:emergency-contact-member"].includes(store.namespace)), browser, service, emergencyContactMemberStore];
  const tasks = entries.flatMap(store => Object.values(store.tasks));
  const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))], tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
  const page = UcpathContactPageSnapshotSchema.parse({ ...fixture.page, rows: options.rows ?? fixture.page.rows, totalRows: (options.rows ?? fixture.page.rows).length });
  const ports: ReturnType<typeof createDeterministicUcpathContactPage>[] = [], captures: UcpathContactPageSnapshot[] = [];
  let reads = 0, providerCalls = 0;
  const onbase = onbaseChildFixture();
  const sessions = sessionFactoryHarness({ onbase: () => onbase.driver(h.authority.clock), ucpath: () => {
    const port = createDeterministicUcpathContactPage({ initial: page }); ports.push(port);
    const driver = createDeterministicUcpathPersonOrgDriver(undefined, undefined, port);
    return { ...driver, async readEmergencyContacts(input: Parameters<typeof driver.readEmergencyContacts>[0]) {
      const set = await driver.readEmergencyContacts(input); reads++;
      return options.unknownProbe === true && reads > 1 ? { ...set, rows: set.rows.map(row => row.kind === "contact" ? { ...row, effect: { ...row.effect, phone: "2025550101" } } : row) } : set;
    } };
  } });
  const h = await world.executorHarness({ descriptor: compiled.descriptor, stores, sessions, screenshotCapture: { capture: async context => {
    assert.equal(context.screenshot.state, "available");
    const port = ports.at(-1); assert.ok(port);
    const snapshot = await port.snapshot(); captures.push(snapshot);
    if (options.captureFailure === true && snapshot.observation === "staged") throw new Error("fixture-final-capture-failed");
  } } });
  const { database, clock, path } = h.authority;
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
    sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: h.deps.log });
  const taskNotes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
  const execution = canonicalChildExecution({ ...h.deps, taskNotes, writeSequencer: sequencer, artifacts: onbase.artifacts, providers: {
    configSnapshots: database.authority.configSnapshots, idFactory: { next: () => randomUUID() }, adapters: {
      "ocr.approved-snapshot": { capability: "ocr.approved-snapshot", async invoke(_request, options) {
        providerCalls++;
        return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(OcrApprovalReadResultSchema, "output"), value: { state: "record", record: approved.record } } },
          evidence: { summary: "Synthetic isolated approved member", capturedAt: IsoInstantSchema.parse(clock.now().toISOString()), providerRequestId: options.requestId } };
      } },
    },
  } }, database, path, id => id === compiled.descriptor.id ? compiled.descriptor : id === onbaseModule.descriptor.id ? onbaseModule.descriptor : undefined);
  const prior = options.priorWrite === undefined ? undefined : seedUnknownContactWrite(database, { ...contact, plan: planEmergencyContact(interpretContactPage(page, contact), desired) }, clock.now().toISOString(), options.priorWrite === "parked");
  const run = execution.start(compiled.descriptor, approved, { dryRun: options.dryRun ?? true });
  const result = await execution.execute(run, world.SIGNAL);
  const failures = database.authority.failures.listByRun(run.envelope.runId);
  const stored = database.authority.runResults.get(run.envelope.runId);
  return { ...h, database, run, result, failures, ports, captures, providerCalls, reads, prior, execution, stores, onbase,
    preview: () => { assert.ok(stored); const preview = readRunPreviewResult(stored); assert.ok(preview); return preview; },
    assertNoWrites() {
      assert.deepEqual(database.authority.writeIntents.listByRun(run.envelope.runId), []);
      assert.deepEqual(database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
      assert.ok(h.emitter.events().every(event => event.t !== "transaction.fenced" || event.runId !== run.envelope.runId));
      const date = clock.now().toISOString().slice(0, 10);
      assert.deepEqual(createTransactionHistory(database.authority).query({ from: date, to: date, runId: run.envelope.runId }).rows, []);
      assert.ok(ports.every(port => !("save" in port) && !("commit" in port)));
    },
  };
}

it("emergency-contact/dry-run — previews ordered primary demotion and addition with original and final captures and zero writes", async () => {
  const f = await memberFixture();
  assert.deepEqual(f.failures.map(failure => ({ code: failure.code, summary: failure.summary })), []);
  const preview = f.preview(), step = preview.steps.find(step => step.state === "transaction-preview");
  assert.ok(step?.state === "transaction-preview");
  assert.equal(step.preview.outcome.state, "would-prepare");
  assert.ok(f.captures.some(page => page.observation === "persisted" && page.rows[0]?.primary));
  assert.ok(f.captures.some(page => page.observation === "staged" && page.rows[0]?.primary === false && page.rows[1]?.primary));
  assert.ok(f.ports.some(port => port.actions.includes("demote-primary:0")));
  f.assertNoWrites();
});
it("emergency-contact/dry-run — previews the contact Save then the OnBase child import with zero Save clicks, Import clicks or fenced intents", async () => {
  const f = await memberFixture();
  assert.deepEqual(f.failures, []);
  assert.deepEqual(f.preview().steps.filter(step => step.state === "transaction-preview" || step.state === "delegation-preview")
    .map(step => [String(step.nodeId), step.state]), [["contact-preview", "transaction-preview"], ["onbase-import", "delegation-preview"]]);
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  assert.deepEqual(children.map(child => [child.envelope.workflow, child.envelope.dryRun]), [["onbase", true]]);
  const child = children[0]; assert.ok(child);
  assert.deepEqual(OnbaseInputSchema.parse(child.input.parsed.value), { ucpathId: approved.record.assertedEid, document: approved.document, sourcePage: 2 });
  assert.equal(f.onbase.imports(), 0);
  assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(child.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  assert.ok(f.emitter.events().every(event => event.t !== "transaction.fenced"));
  const member = f.emitter.events().filter(event => "runId" in event && event.runId === f.run.envelope.runId);
  assert.equal(member.filter(event => event.t === "transaction.previewed").length, 1, "the member re-entry after its child reuses the kept preview");
  for (const role of ["probe", "prepare"]) assert.equal(member.filter(event => event.t === "span.started" && event.spanPath.endsWith(`/contact-preview/${role}`)).length, 1);
  assert.deepEqual(f.database.authority.runCheckpoints.listByItem(f.run.envelope.workflow, f.run.envelope.itemId)
    .filter(row => row.runId === f.run.envelope.runId && row.nodeId === "contact-preview"), []);
  // A dry-run preview does not read child receipts.
  const receipt = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: [compiled.descriptor, onbaseModule.descriptor] }).ensureReceipt(f.run.envelope.runId);
  assert.equal(receipt.result, "partial");
  const onbaseRow = receipt.verification.find(row => row.obligation === "node.onbase-import");
  assert.deepEqual(onbaseRow && { verdict: onbaseRow.verdict, evidence: onbaseRow.evidence }, { verdict: "unknown", evidence: [] });
  assert.equal(f.database.authority.evidenceReceipts.findByRun(child.envelope.runId), undefined);
  f.assertNoWrites();
});
it("emergency-contact/unambiguous-addition — prepares the approved primary without demotion when none exists", async () => {
  const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows.map(row => ({ ...row, primary: false }));
  const f = await memberFixture({ rows });
  assert.deepEqual(f.failures, []);
  assert.ok(f.ports.some(port => port.actions.includes("fill-name:1")));
  assert.ok(f.ports.every(port => !port.actions.some(action => action.startsWith("demote-primary"))));
  f.assertNoWrites();
});
it("emergency-contact/exact-existing-effect — uses actual protected presence and skips preparation", async () => {
  const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows;
  rows[0] = { ...rows[0], primary: false };
  rows[1] = { rowIndex: 1, name: desired.name, relationship: desired.relationship, primary: true, phone: desired.phone ?? "", sameAddressAsEmployee: false,
    address: desired.address.kind === "explicit" ? desired.address.fields : null };
  const f = await memberFixture({ rows });
  assert.deepEqual(f.failures, []);
  const step = f.preview().steps.find(step => step.state === "transaction-preview");
  assert.ok(step?.state === "transaction-preview");
  assert.equal(step.preview.outcome.state, "already-present");
  assert.ok(f.ports.every(port => !port.actions.some(action => /^(fill|demote|add)/u.test(action))));
  f.assertNoWrites();
});
it("emergency-contact/conflict-refused — refuses multiple primaries before preparation", async () => {
  const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows;
  rows[1] = { ...rows[0], rowIndex: 1, name: "Another Primary" };
  const f = await memberFixture({ rows });
  assert.equal(f.failures[0]?.code, "CONTACT_PLAN_REFUSED");
  assert.ok(f.ports.every(port => !port.actions.some(action => /^(fill|demote|add)/u.test(action))));
  f.assertNoWrites();
});
it("emergency-contact/unknown — refuses an unknown full-set probe without preparing or submitting", async () => {
  const f = await memberFixture({ unknownProbe: true });
  assert.equal(f.failures[0]?.nodeId, "contact-preview");
  assert.ok(f.reads >= 2);
  assert.match(f.failures[0]?.summary ?? "", /is indeterminate/u);
  assert.ok(f.ports.every(port => !port.actions.some(action => /^(fill|demote|add)/u.test(action))));
  f.assertNoWrites();
});
it("fails the preview when its final full-set capture fails", async () => {
  const f = await memberFixture({ captureFailure: true });
  assert.ok(f.failures.length > 0);
  assert.ok(f.captures.some(page => page.observation === "staged"));
  f.assertNoWrites();
});

for (const status of ["attempting", "parked"] as const) it(`refuses a persisted ${status} permanent key without a new probe, preparation, attempt or submission`, async () => {
  const f = await memberFixture({ priorWrite: status });
  assert.ok(f.prior);
  assert.equal(f.prior.status, status);
  assert.equal(f.failures[0]?.nodeId, "contact-preview");
  assert.match(f.failures[0]?.summary ?? "", status === "attempting" ? /mid-submit/u : /parked/u);
  assert.equal(f.reads, 1);
  assert.ok(f.ports.every(port => !port.actions.some(action => /^(fill|demote|add)/u.test(action))));
  assert.deepEqual(f.database.authority.writeIntents.get(f.prior.writeIntentId), f.prior);
  assert.equal(f.database.authority.writeAttempts.get(f.prior.currentAttemptId)?.outcome.state, status);
  f.assertNoWrites();
});

