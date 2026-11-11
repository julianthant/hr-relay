import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { readApprovedOcrRecordTask } from "../../../../src/backend/processing/ocr/tasks/read-approved-record.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { ucpathSession } from "../../../../src/backend/systems/ucpath/session-provider.js";
import { probeEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/match-emergency-contact-plan.js";
import { readEmergencyContactsTask } from "../../../../src/backend/systems/ucpath/tasks/read-emergency-contacts.js";
import { saveEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/save-emergency-contact.js";
import { stageEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/stage-emergency-contact.js";
import { verifyEmergencyContactTask } from "../../../../src/backend/systems/ucpath/tasks/verify-emergency-contact-plan.js";
import { OcrApprovalReadRequestSchema,OcrApprovalReadResultSchema } from "../../../../src/models/processing/ocr/approved-snapshot.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { deriveSchemaHash,schemaBoundValueSchema } from "../../../../src/models/validation/schema-bound-value.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { defineBrowserStore,defineServiceStore,defineTaskStoreRegistry,type RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactMemberStore } from "../../../../src/workflows/emergency-contact-member/task-registry.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { testRunLifecycle } from "../../fixtures/run-lifecycle-fixtures.js";
import fixture from "../../fixtures/ui/ucpath/emergency-contact.fixture.json";
import { ONBASE_SOURCE_DOCUMENT,onbaseChildFixture } from "./onbase-child-fixture.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { onbaseModule } from "../registered-workflows.js";

/** A saved Emergency Contact member run with its bound OnBase child, run to its terminal result. */
export function createEcMemberOnbaseWorld() {
  const world = createRunExecutorTestWorld();
  const compiled = compileWorkflow(emergencyContactMemberWorkflow);
  const approved = { ...EMERGENCY_CONTACT_MEMBER_EXAMPLE, document: ONBASE_SOURCE_DOCUMENT, sourcePage: 2 };
  async function savedMember() {
    const browser = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { readContacts: readEmergencyContactsTask,
      stageContact: stageEmergencyContactTask, probeContact: probeEmergencyContactTask, verifyContact: verifyEmergencyContactTask, saveContact: saveEmergencyContactTask });
    const service = defineServiceStore("ocr", { readRecord: readApprovedOcrRecordTask });
    const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => !["ucpath", "ocr", "workflow:emergency-contact-member"].includes(store.namespace)), browser, service, emergencyContactMemberStore];
    const tasks = entries.flatMap(store => Object.values(store.tasks));
    const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))], tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
    const page = UcpathContactPageSnapshotSchema.parse(fixture.page);
    let ticks = Date.parse(page.observedAt);
    const persistence = createDeterministicContactPersistence(page, () => new Date(++ticks).toISOString());
    const onbase = onbaseChildFixture();
    const sessions = sessionFactoryHarness({ onbase: () => onbase.driver(h.authority.clock), ucpath: () => {
      const session = persistence.session();
      return createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, session.save);
    } });
    const h = await world.executorHarness({ descriptor: compiled.descriptor, stores, sessions, screenshotCapture: { capture: async () => undefined } });
    const { database, clock, path } = h.authority;
    const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
      sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
      operator: "local-operator", log: h.deps.log });
    const taskNotes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
    const execution = canonicalChildExecution({ ...h.deps, taskNotes, writeSequencer: sequencer, artifacts: onbase.artifacts, providers: {
      configSnapshots: database.authority.configSnapshots, idFactory: { next: () => randomUUID() }, adapters: {
        "ocr.approved-snapshot": { capability: "ocr.approved-snapshot", async invoke(_request, options) {
          const request = schemaBoundValueSchema(OcrApprovalReadRequestSchema, deriveSchemaHash(OcrApprovalReadRequestSchema, "output")).parse(_request.payload).value;
          const record = { ...approved.record, recordId: request.kind === "record" ? request.recordId : approved.record.recordId };
          return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(OcrApprovalReadResultSchema, "output"), value: { state: "record", record } } },
            evidence: { summary: "Synthetic isolated approved member", capturedAt: IsoInstantSchema.parse(clock.now().toISOString()), providerRequestId: options.requestId } };
        } },
      },
    } }, database, path, id => id === compiled.descriptor.id ? compiled.descriptor : id === onbaseModule.descriptor.id ? onbaseModule.descriptor : undefined);
    const run = execution.start(compiled.descriptor, approved, { dryRun: false });
    await execution.execute(run, world.SIGNAL);
    return { database, execution, run, descriptors: [compiled.descriptor, onbaseModule.descriptor] };
  }
  return { savedMember, cleanup: world.cleanup };
}
