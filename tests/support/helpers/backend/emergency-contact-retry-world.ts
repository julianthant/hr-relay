import type { SpanEmitter } from "../../../../src/backend/logs/span-emitter.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UCPATH_CONTACT_DISPLAYED_NAME, UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { composeWorkflowModule, compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowStore } from "../../../../src/workflow-kit/task-registry.js";
import { readEmergencyContactResultTask } from "../../../../src/workflows/emergency-contact/tasks/read-result.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import fixture from "../../fixtures/ui/ucpath/emergency-contact.fixture.json" with { type: "json" };
import { createOcrReviewWorld } from "./ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../phase1f-executor-harness.js";

export const contactSaveMember = compileWorkflow(emergencyContactMemberWorkflow);

export function createEmergencyContactRetryWorld() {
  const world = createOcrReviewWorld();
  return { cleanup: world.cleanup, async fixture(options: Readonly<{ failures?: number; onFencedSave?: () => void }> = {}) {
    const control = { failuresRemaining: options.failures ?? 1, unknownAfterSave: false, failAfterSave: false, failAccounting: false };
    const hooks: { onSpan?: (event: Parameters<SpanEmitter["emit"]>[0]) => void; onTransactionSettled?: () => void } = {};
    const accountingStore = defineWorkflowStore("emergency-contact", { readResult: defineTask(readEmergencyContactResultTask.contract, {
      sessions: [], async run(args) {
        if (control.failAccounting) return args.ctx.fail("OCR_REVIEW_REFUSED", "Synthetic parent accounting failure.");
        return readEmergencyContactResultTask.impl.run(args);
      },
    }) });
    const facts = ["Example, Avery", "Example, Blake"].map((employeeName, index) => ({ employeeName, contactName: `Original Contact ${String(index)}`, correctedContactName: `Released Contact ${String(index)}` }));
    let ticks = Date.parse(fixture.page.observedAt);
    const persistence = new Map<string, ReturnType<typeof createDeterministicContactPersistence>>();
    const sessions = sessionFactoryHarness({ ucpath: (): ReturnType<typeof createDeterministicUcpathPersonOrgDriver> => {
      const base = createDeterministicUcpathPersonOrgDriver();
      let activeEid: string | undefined;
      let active: ReturnType<typeof createDeterministicUcpathPersonOrgDriver> | undefined;
      function forSubject(input: { emplId: string; expectedName: string }) {
        if (active !== undefined && activeEid === input.emplId) return active;
        activeEid = input.emplId;
        let backend = persistence.get(input.emplId);
        if (backend === undefined) {
          backend = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...fixture.page, displayedEid: input.emplId, displayedName: input.expectedName }), () => new Date(++ticks).toISOString());
          persistence.set(input.emplId, backend);
        }
        const session = backend.session();
        active = createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, session.save);
        return active;
      }
      return { ...base,
        async searchPersonOrg(input) {
          assert.equal(input.kind, "by-name"); assert.ok("name" in input);
          const index = facts.findIndex(fact => fact.employeeName === input.name); assert.ok(index >= 0);
          const candidate = { emplId: String(10800000 + index), name: input.name, department: "Housing Dining Hospitality", jobTitle: "Fixture employee", employeeStatus: "active", hdh: true,
            hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
          return SearchPersonOrgOutputSchema.parse({ results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] } });
        },
        readEmergencyContacts: input => forSubject(input).readEmergencyContacts(input),
        async stageEmergencyContact(input, plan) {
          if (input.emplId === "10800001" && control.failuresRemaining > 0) {
            control.failuresRemaining -= 1;
            throw new Error("fixture-second-member-prepare-refused");
          }
          return forSubject(input).stageEmergencyContact(input, plan);
        },
        async saveEmergencyContact(input, capability) {
          options.onFencedSave?.();
          const result = await forSubject(input).saveEmergencyContact(input, capability);
          if (control.unknownAfterSave) throw new Error("fixture-save-response-lost");
          return result;
        },
        read: id => id === UCPATH_CONTACT_DISPLAYED_NAME && active !== undefined ? active.read(id) : base.read(id),
      };
    }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
    const member = composeWorkflowModule(contactSaveMember, taskStoreRegistry.stores);
    const f = await world.fixture({ coordinator: true, member, approvedStore: accountingStore, onSpan: event => hooks.onSpan?.(event),
      onTransactionSettled: () => {
        hooks.onTransactionSettled?.();
        if (control.failAfterSave) { control.failAfterSave = false; throw new Error("fixture-local-failure-after-committed-save"); }
    }, record: true, release: true, pageCount: 2, reviewedPages: facts, operatorEvidence: true, sessions, screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
    assert.equal(persistence.size, 0);
    for (let index = 0; index < facts.length; index++) {
      const command = f.command("correct-ocr-record", index + 1, index);
      assert.equal(f.canonical.kernel.execute({ ...command, payload: { ...command.payload, assertedEid: String(10800000 + index) } }).state, "applied");
    }
    assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
    const interrupted = await f.canonical.execute(f.parentRun, new AbortController().signal);
    assert.equal(interrupted.run?.lifecycle.state, "queued", "a terminal failed sibling requeues the allow-partial parent");
    const current = (runId = f.parentRun.envelope.runId) => { const run = f.database.authority.runs.get(runId); assert.ok(run); return run; };
    const command = (type: "retry" | "pause" | "resume", run: RunRecord) => ({ commandId: randomUUID(), family: "run" as const,
      type, source: "run-detail" as const, requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
      target: { runId: run.envelope.runId, expectedVersion: run.version } });
    const children = () => f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member");
    return { ...f, facts, persistence, control, hooks, current, runCommand: command, children };
  } };
}
