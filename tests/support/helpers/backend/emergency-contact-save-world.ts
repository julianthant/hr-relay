import type { UcpathContactPagePort } from "../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { readApprovedOcrRecordTask } from "../../../../src/backend/processing/ocr/tasks/read-approved-record.js";
import { createWriteSequencer, type WriteSequencerAuthority } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { interpretContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { ucpathSession } from "../../../../src/backend/systems/ucpath/session-provider.js";
import { probeEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/match-emergency-contact-plan.js";
import { readEmergencyContactsTask } from "../../../../src/backend/systems/ucpath/tasks/read-emergency-contacts.js";
import { saveEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/save-emergency-contact.js";
import { stageEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/stage-emergency-contact.js";
import { verifyEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/verify-emergency-contact-plan.js";
import { OcrApprovalReadResultSchema, OcrApprovalReadRequestSchema } from "../../../../src/models/processing/ocr/approved-snapshot.js";
import type { UcpathContactPageSnapshot } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../src/models/validation/schema-bound-value.js";
import type { StepOmissions } from "../../../../src/models/workflow/step-omission.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { EidSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { approvedEmergencyContact,contactEffect,planEmergencyContact } from "../../../../src/rules/ucpath/emergency-contact.js";
import { defineBrowserStore,defineServiceStore,defineTaskStoreRegistry,type RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { emergencyContactMemberStore } from "../../../../src/workflows/emergency-contact-member/task-registry.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { testRunLifecycle } from "../../fixtures/run-lifecycle-fixtures.js";
import fixture from "../../fixtures/ui/ucpath/emergency-contact.fixture.json";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { seedUnknownContactWrite } from "./unknown-contact-write.js";
import { sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { onbaseFilingFixture } from "./onbase-filing-fixture.js";
import { onbaseModule } from "../registered-workflows.js";

export const contactSaveMember = compileWorkflow(emergencyContactMemberWorkflow);
const approved = EMERGENCY_CONTACT_MEMBER_EXAMPLE;
const contact = approvedEmergencyContact(approved.record);
const desired = contactEffect(contact);

type FailurePoint = "pending" | "save-before" | "save-after" | "partial" | "primary-conflict" | "unreadable" | "mismatch" | "staged-readback" | "stale-readback" | "verifier" | "prepare" | "identity" | "drift" | "capture-before" | "capture-after" | "read" | "probe" | "capture-prepare" | "staged-page-drift" | "timeout" | "lost-page" | "unknown-response" | "foreign-eid" | "foreign-name" | "identity-before-click";
async function memberFixture(world: ReturnType<typeof createRunExecutorTestWorld>, options: { sequencerAuthority?: (database: WriteSequencerAuthority) => WriteSequencerAuthority; rows?: UcpathContactPageSnapshot["rows"]; failure?: FailurePoint; priorWrite?: "attempting" | "parked"; interrupt?: boolean; dryRun?: boolean; sourcePage?: number | null; onbaseUnavailable?: true; onbaseFiling?: "file" | "skip"; stepOmissions?: StepOmissions } = {}) {
  const browser = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { readContacts: readEmergencyContactsTask,
    stageContact: stageEmergencyContactTask, probeContact: probeEmergencyContactTask, verifyContact: verifyEmergencyContactTask, saveContact: saveEmergencyContactTask });
  const service = defineServiceStore("ocr", { readRecord: readApprovedOcrRecordTask });
  const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => !["ucpath", "ocr", "workflow:emergency-contact-member"].includes(store.namespace)), browser, service, emergencyContactMemberStore];
  const tasks = entries.flatMap(store => Object.values(store.tasks));
  const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))], tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
  const page = UcpathContactPageSnapshotSchema.parse({ ...fixture.page, rows: options.rows ?? fixture.page.rows, totalRows: (options.rows ?? fixture.page.rows).length });
  let wrongPerson = false;
  const ports: UcpathContactPagePort[] = [], captures: UcpathContactPageSnapshot[] = [];
  let reads = 0, providerCalls = 0, ticks = Date.parse(page.observedAt);
  const persistence = createDeterministicContactPersistence(page, () => new Date(++ticks).toISOString());
  let entered = (): void => undefined, release = (): void => undefined;
  const inFlight = new Promise<void>(resolve => { entered = resolve; });
  const maySettle = new Promise<void>(resolve => { release = resolve; });
  const filing = await onbaseFilingFixture();
  const sessions = sessionFactoryHarness({ onbase: options.onbaseUnavailable === true ? () => { throw new Error("fixture-onbase-unavailable"); } : filing.session(() => h.authority.clock), ucpath: () => {
    const session = persistence.session();
    const port: UcpathContactPagePort = { ...session.port, async snapshot() {
      const observed = await session.port.snapshot();
      return wrongPerson ? { ...observed, displayedEid: "10000002" } : observed;
    } };
    ports.push(port);
    const save = { async save(capability: Parameters<typeof session.save.save>[0]) {
      if (options.failure === "save-before") throw new Error("fixture-save-failed");
      await session.save.save(capability);
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
      if (options.failure === "save-after" || options.failure === "timeout" || options.failure === "lost-page" || options.failure === "unknown-response") throw new Error(`fixture-${options.failure}`);
    }, async readPersisted(subject: Parameters<typeof session.save.readPersisted>[0]) {
      const observed = await session.save.readPersisted(subject);
      if (options.failure === "unreadable") throw new Error("fixture-readback-unreadable");
      if (options.failure === "staged-readback") return { ...observed, observation: "staged" as const };
      if (options.failure === "stale-readback") return { ...observed, observedAt: IsoInstantSchema.parse(page.observedAt) };
      if (options.failure === "foreign-eid") return { ...observed, emplId: EidSchema.parse("10000002") };
      if (options.failure === "foreign-name") return { ...observed, displayedName: "Another Person" };
      return observed;
    } };
    const driver = createDeterministicUcpathPersonOrgDriver(undefined, undefined, port, options.failure === "pending" ? undefined : save);
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
  const h = await world.executorHarness({ descriptor: contactSaveMember.descriptor, stores, sessions, screenshotCapture: { capture: async context => {
    assert.equal(context.screenshot.state, "available");
    const port = ports.at(-1); assert.ok(port);
    const snapshot = await port.snapshot(); captures.push(snapshot);
    if (options.failure === "identity-before-click" && context.trigger.kind === "task-point" && context.trigger.boundary === "before-submit") wrongPerson = true;
    if (options.failure === "staged-page-drift" && context.trigger.kind === "task-point" && context.trigger.boundary === "before-submit") {
      await port.demotePrimary(1, desired);
    }
    if (options.failure === "capture-prepare" && snapshot.observation === "staged" && context.trigger.kind === "task-point" && context.trigger.boundary === "step") throw new Error("fixture-prepare-capture-failed");
    if (options.failure === "capture-before" && context.trigger.kind === "task-point" && context.trigger.boundary === "before-submit") throw new Error("fixture-before-capture-failed");
    if (options.failure === "capture-after" && context.trigger.kind === "task-point" && context.trigger.boundary === "after-submit") throw new Error("fixture-after-capture-failed");
  } } });
  const { database, clock, path } = h.authority;
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: options.sequencerAuthority?.(database) ?? database,
    sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: h.deps.log });
  const taskNotes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
  const execution = canonicalChildExecution({ ...h.deps, taskNotes, writeSequencer: sequencer, artifacts: filing.artifacts, providers: {
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
  } }, database, path, id => id === contactSaveMember.descriptor.id ? contactSaveMember.descriptor : id === "onbase" ? onbaseModule.descriptor : undefined);
  const prior = options.priorWrite === undefined ? undefined : seedUnknownContactWrite(database, { ...contact, plan: planEmergencyContact(interpretContactPage(page, contact), desired) }, clock.now().toISOString(), options.priorWrite === "parked");
  // A second record of the same person comes from another page, so its OnBase filing is a different child item.
  const member = (recordId: string = approved.record.recordId, sourcePage: number | null = options.sourcePage === undefined ? 2 : options.sourcePage) => ({ ...approved, record: { ...approved.record, recordId }, document: filing.document, sourcePage, onbaseFiling: options.onbaseFiling ?? "file" });
  const run = execution.start(contactSaveMember.descriptor, member(), { dryRun: options.dryRun ?? false,
    ...(options.stepOmissions === undefined ? {} : { stepOmissions: options.stepOmissions,
      selectedStepKeys: contactSaveMember.descriptor.timeline.map(step => step.key)
        .filter(key => !options.stepOmissions?.some(omission => omission.step === key)) }) });
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
  const children = () => database.authority.runs.listChildren(run.envelope.runId);
  return { ...h, clock, database, run, result, failures, ports, captures, providerCalls, reads, prior, execution, stores, persistence, filing, member, children };
}

export function createEmergencyContactSaveWorld() {
  const world = createRunExecutorTestWorld();
  return { cleanup: world.cleanup, SIGNAL: world.SIGNAL, memberFixture: (options?: Parameters<typeof memberFixture>[1]) => memberFixture(world, options) };
}
