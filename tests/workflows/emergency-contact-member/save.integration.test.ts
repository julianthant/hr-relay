import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import type { UcpathContactPagePort } from "../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { EmergencyContactMemberResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { createConfirmedActionPublisher } from "../../../src/backend/logs/confirmed-action-publisher.js";
import { readApprovedOcrRecordTask } from "../../../src/backend/processing/ocr/tasks/read-approved-record.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { ucpathDriver } from "../../../src/backend/systems/ucpath/driver-declaration.js";
import { createDeterministicContactPersistence } from "../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { interpretContactPage } from "../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { ucpathSession } from "../../../src/backend/systems/ucpath/session-provider.js";
import { probeEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/match-emergency-contact-plan.js";
import { readEmergencyContactsTask } from "../../../src/backend/systems/ucpath/tasks/read-emergency-contacts.js";
import { saveEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/save-emergency-contact.js";
import { stageEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/stage-emergency-contact.js";
import { verifyEmergencyContactTask } from "../../../src/backend/systems/ucpath/tasks/verify-emergency-contact-plan.js";
import { OcrApprovalReadResultSchema, OcrApprovalReadRequestSchema } from "../../../src/models/processing/ocr/approved-snapshot.js";
import type { UcpathContactPageSnapshot } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { UcpathContactPageSnapshotSchema } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../src/models/validation/schema-bound-value.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { approvedEmergencyContact,contactEffect,planEmergencyContact } from "../../../src/rules/ucpath/emergency-contact.js";
import { defineBrowserStore,defineServiceStore,defineTaskStoreRegistry,type RegisteredTaskStore } from "../../../src/workflow-kit/task-registry.js";
import { emergencyContactMemberStore } from "../../../src/workflows/emergency-contact-member/task-registry.js";
import { contactSaveMember } from "../../support/fixtures/ocr/contact-save-workflow.js";
import { testRunLifecycle } from "../../support/fixtures/run-lifecycle-fixtures.js";
import fixture from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { seedUnknownContactWrite } from "../../support/helpers/backend/unknown-contact-write.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
const compiled = contactSaveMember;
const approved = EMERGENCY_CONTACT_MEMBER_EXAMPLE;
const contact = approvedEmergencyContact(approved.record);
const desired = contactEffect(contact);

type FailurePoint = "pending" | "save-before" | "save-after" | "partial" | "primary-conflict" | "unreadable" | "mismatch" | "staged-readback" | "stale-readback" | "verifier" | "prepare" | "identity" | "drift" | "capture-before" | "capture-after" | "read" | "probe" | "capture-prepare";
async function memberFixture(options: { rows?: UcpathContactPageSnapshot["rows"]; failure?: FailurePoint; priorWrite?: "attempting" | "parked"; interrupt?: boolean } = {}) {
  const browser = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { readContacts: readEmergencyContactsTask,
    stageContact: stageEmergencyContactTask, probeContact: probeEmergencyContactTask, verifyContact: verifyEmergencyContactTask, saveContact: saveEmergencyContactTask });
  const service = defineServiceStore("ocr", { readRecord: readApprovedOcrRecordTask });
  const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => !["ucpath", "ocr", "workflow:emergency-contact-member"].includes(store.namespace)), browser, service, emergencyContactMemberStore];
  const tasks = entries.flatMap(store => Object.values(store.tasks));
  const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))], tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
  const page = UcpathContactPageSnapshotSchema.parse({ ...fixture.page, rows: options.rows ?? fixture.page.rows, totalRows: (options.rows ?? fixture.page.rows).length });
  const ports: UcpathContactPagePort[] = [], captures: UcpathContactPageSnapshot[] = [];
  let reads = 0, providerCalls = 0, ticks = Date.parse(page.observedAt);
  const persistence = createDeterministicContactPersistence(page, () => new Date(++ticks).toISOString());
  let entered = (): void => undefined, release = (): void => undefined;
  const inFlight = new Promise<void>(resolve => { entered = resolve; });
  const maySettle = new Promise<void>(resolve => { release = resolve; });
  const sessions = sessionFactoryHarness({ ucpath: () => {
    const session = persistence.session();
    ports.push(session.port);
    const save = { async save() {
      if (options.failure === "save-before") throw new Error("fixture-save-failed");
      await session.save.save();
      if (options.interrupt === true) { entered(); await maySettle; }
      if (options.failure === "partial") {
        const saved = persistence.snapshot();
        persistence.replacePersisted({ ...saved, totalRows: saved.totalRows - 1, rows: saved.rows.slice(1).map((row, rowIndex) => ({ ...row, rowIndex })) });
      }
      if (options.failure === "primary-conflict" || options.failure === "mismatch") {
        const saved = persistence.snapshot();
        persistence.replacePersisted({ ...saved, rows: saved.rows.map(row => row.rowIndex === 0 ? { ...row,
          ...(options.failure === "primary-conflict" ? { primary: true } : { phone: "2025550101" }) } : row) });
      }
      if (options.failure === "save-after") throw new Error("fixture-save-response-lost");
    }, async readPersisted() {
      const observed = await session.save.readPersisted();
      if (options.failure === "unreadable") throw new Error("fixture-readback-unreadable");
      if (options.failure === "staged-readback") return { ...observed, observation: "staged" as const };
      if (options.failure === "stale-readback") return { ...observed, observedAt: IsoInstantSchema.parse(page.observedAt) };
      return observed;
    } };
    const driver = createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, options.failure === "pending" ? undefined : save);
    return { ...driver,
      async readEmergencyContacts(input: Parameters<typeof driver.readEmergencyContacts>[0]) {
        reads++;
        if (options.failure === "read" || options.failure === "probe" && reads > 1) throw new Error("fixture-contact-read-failed");
        if (options.failure === "verifier" && persistence.submissions.length > 0) throw new Error("fixture-native-verifier-failed");
        return driver.readEmergencyContacts(input);
      },
      async stageEmergencyContact(input: Parameters<typeof driver.stageEmergencyContact>[0], plan: Parameters<typeof driver.stageEmergencyContact>[1]) {
        if (options.failure === "prepare") throw new Error("fixture-prepare-failed");
        const staged = await driver.stageEmergencyContact(input, plan);
        return options.failure === "drift" ? { ...staged, rows: staged.rows.map(row => row.kind === "contact" && row.rowIndex === 0
          ? { ...row, effect: { ...row.effect, phone: "2025550101" } } : row) } : staged;
      },
      async read(id: Parameters<typeof driver.read>[0]) {
        if (options.failure === "identity") return "Another Employee";
        return driver.read(id);
      },
    };
  } });
  const h = await world.executorHarness({ descriptor: compiled.descriptor, stores, sessions, screenshotCapture: { capture: async context => {
    assert.equal(context.screenshot.state, "available");
    const port = ports.at(-1); assert.ok(port);
    const snapshot = await port.snapshot(); captures.push(snapshot);
    if (options.failure === "capture-prepare" && snapshot.observation === "staged" && context.trigger.kind === "task-point" && context.trigger.boundary === "step") throw new Error("fixture-prepare-capture-failed");
    if (options.failure === "capture-before" && context.trigger.kind === "task-point" && context.trigger.boundary === "before-submit") throw new Error("fixture-before-capture-failed");
    if (options.failure === "capture-after" && context.trigger.kind === "task-point" && context.trigger.boundary === "after-submit") throw new Error("fixture-after-capture-failed");
  } } });
  const { database, clock, path } = h.authority;
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
    sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: h.deps.log });
  const taskNotes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
  const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: randomUUID(), clock, capacity: 256,
    append: event => { const authority = database.authority.runs.get(event.action.runId); assert.ok(authority); taskNotes.emitConfirmedAction(event, authority); } });
  const execution = canonicalChildExecution({ ...h.deps, taskNotes, confirmedActionPublisher: publisher, writeSequencer: sequencer, providers: {
    configSnapshots: database.authority.configSnapshots, idFactory: { next: () => randomUUID() }, adapters: {
      "ocr.approved-snapshot": { capability: "ocr.approved-snapshot", async invoke(_request, options) {
        providerCalls++;
        const request = schemaBoundValueSchema(OcrApprovalReadRequestSchema, deriveSchemaHash(OcrApprovalReadRequestSchema, "output")).parse(_request.payload).value;
        assert.equal(request.kind, "record");
        const record = { ...approved.record, recordId: request.kind === "record" ? request.recordId : approved.record.recordId };
        return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(OcrApprovalReadResultSchema, "output"), value: { state: "record", record } } },
          evidence: { summary: "Synthetic isolated approved member", capturedAt: IsoInstantSchema.parse(clock.now().toISOString()), providerRequestId: options.requestId } };
      } },
    },
  } }, database, path, id => id === compiled.descriptor.id ? compiled.descriptor : undefined);
  const prior = options.priorWrite === undefined ? undefined : seedUnknownContactWrite(database, { ...contact, plan: planEmergencyContact(interpretContactPage(page, contact), desired) }, clock.now().toISOString(), options.priorWrite === "parked");
  const run = execution.start(compiled.descriptor, approved, { dryRun: false });
  const signal = new AbortController();
  let settled = false;
  const running = execution.execute(run, signal.signal).finally(() => { settled = true; });
  if (options.interrupt === true) {
    await inFlight;
    signal.abort(new Error("fixture-operator-interrupted-save"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, "the outstanding Save callback retains lifetime ownership");
    assert.equal(database.authority.writeIntents.listByRun(run.envelope.runId)[0]?.status, "attempting");
    assert.deepEqual(sessions.closeReasons(), []);
    release();
  }
  const result = await running;
  const failures = database.authority.failures.listByRun(run.envelope.runId);
  return { ...h, clock, database, run, result, failures, ports, captures, providerCalls, reads, prior, execution, stores, persistence,

  };
}

it("commits the declared primary demotion and addition once, then independently verifies and durably settles the persisted whole set", async () => {
  const f = await memberFixture();
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  const stored = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(stored);
  const output = EmergencyContactMemberResultSchema.parse(stored.result.value).proof;
  const original = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), contact).rows[0]; assert.ok(original?.kind === "contact");
  assert.deepEqual(output.contacts.rows, [{ kind: "contact", rowIndex: 0, effect: { ...original.effect, primary: false } }, { kind: "contact", rowIndex: 1, effect: desired }]);
  assert.equal(output.contacts.observation, "persisted");
  assert.ok(f.captures.some(snapshot => snapshot.observation === "staged" && snapshot.rows[0]?.primary === false && snapshot.rows[1]?.primary === true));
  const receipts = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: [compiled.descriptor] });
  const receipt = receipts.ensureReceipt(f.run.envelope.runId);
  assert.equal(receipt.result, "verified-done");
  assert.deepEqual(receipts.ensureReceipt(f.run.envelope.runId), receipt);
  assert.equal(f.reads, 3, "initial read, native probe and mandatory native verifier");
  const intents = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "committed");
  assert.ok(f.database.authority.runCheckpoints.latest(f.run.envelope.workflow, f.run.envelope.itemId, "contact-preview"));
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.equal(createTransactionHistory(f.database.authority).query({ from: date, to: date, runId: f.run.envelope.runId }).rows.length, 1);
});
for (const failure of ["pending", "save-before", "save-after", "partial", "primary-conflict", "unreadable", "mismatch", "staged-readback", "stale-readback", "verifier", "capture-after"] as const) it(`parks ${failure} after the fence without a forged output or retry`, async () => {
  const f = await memberFixture({ failure });
  const intents = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "parked");
  const intent = intents[0]; assert.ok(intent);
  assert.equal(f.database.authority.writeAttempts.get(intent.currentAttemptId)?.outcome.state, "parked");
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-write");
  if (failure === "partial") assert.equal(f.persistence.snapshot().rows.length, 1);
  if (failure === "primary-conflict") assert.deepEqual(f.persistence.snapshot().rows.map(row => row.primary), [true, true]);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.equal(f.database.authority.runCheckpoints.latest(f.run.envelope.workflow, f.run.envelope.itemId, "contact-preview"), undefined);
  const submissions = f.persistence.submissions.length;
  assert.equal(submissions, failure === "save-before" || failure === "pending" ? 0 : 1);
  const retry = f.execution.start(compiled.descriptor, { ...approved, record: { ...approved.record, recordId: `${"b".repeat(64)}#emergency-contact#2` } }, { dryRun: false });
  await f.execution.execute(retry, world.SIGNAL);
  assert.equal(f.persistence.submissions.length, submissions);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(retry.envelope.runId), []);
  if (failure === "save-after") assert.match(f.database.authority.failures.listByRun(retry.envelope.runId)[0]?.summary ?? "", /parked/u);
});
for (const failure of ["read", "probe", "prepare", "identity", "drift", "capture-prepare", "capture-before"] as const) it(`refuses ${failure} before the fence with zero Save and intents`, async () => {
  const f = await memberFixture({ failure });
  assert.ok(f.failures.length > 0);
  assert.equal(f.persistence.submissions.length, 0);
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
});

it("keeps interrupted Save ownership until callback settlement, then parks without output or another click", async () => {
  const f = await memberFixture({ interrupt: true });
  assert.equal(f.persistence.submissions.length, 1);
  assert.equal(f.database.authority.writeIntents.listByRun(f.run.envelope.runId)[0]?.status, "parked");
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  const retry = f.execution.start(compiled.descriptor, { ...approved, record: { ...approved.record, recordId: `${"b".repeat(64)}#emergency-contact#2` } }, { dryRun: false });
  await f.execution.execute(retry, world.SIGNAL);
  assert.equal(f.persistence.submissions.length, 1);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(retry.envelope.runId), []);
  assert.match(f.database.authority.failures.listByRun(retry.envelope.runId)[0]?.summary ?? "", /parked/u);
});

it("saves an addition with no demotion when the complete original set has no primary", async () => {
  const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows.map(row => ({ ...row, primary: false }));
  const f = await memberFixture({ rows });
  assert.deepEqual(f.failures, []);
  assert.equal(f.persistence.submissions.length, 1);
  assert.deepEqual(f.persistence.snapshot().rows.map(row => row.primary), [false, true]);
});
