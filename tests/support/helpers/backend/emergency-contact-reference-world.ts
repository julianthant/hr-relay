import assert from "node:assert/strict";
import { referenceCheckLines, referenceGateId } from "./reference-check-lines.js";
import { randomUUID } from "node:crypto";
import { childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunGate, resolveGateArmAnswer } from "../../../../src/backend/runs/queries/run-detail/gate-park.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { GateDecisionWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { UCPATH_CONTACT_DISPLAYED_NAME, UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { CommandRequestSchema, GateArmAnswerRequestSchema } from "../../../../src/rules/commands/commands.js";
import fixture from "../../fixtures/ui/ucpath/emergency-contact.fixture.json" with { type: "json" };
import { testRunService } from "../../fixtures/run-lifecycle-fixtures.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { createOcrReviewWorld } from "./ocr-review-world.js";
import { CANCEL_ROW_ACTION } from "./reference-check-write-world.js";

/** Two approved records on two pages: Avery is 10800000, Blake is 10800001. */
export const EMERGENCY_CONTACT_PEOPLE = ["Example, Avery", "Example, Blake"].map((employeeName, index) => ({ employeeName, emplId: String(10800000 + index),
  contactName: `Original Contact ${String(index)}`, correctedContactName: `Released Contact ${String(index)}` }));

/** Runs an Emergency Contact PDF with two approved people through OCR release to its members, without OnBase filing, against real library spreadsheets. */
export function createEmergencyContactReferenceWorld() {
  const world = createOcrReviewWorld();
  return { cleanup: world.cleanup, async fixture(options: Readonly<{ dryRun?: boolean; checks?: NonNullable<Parameters<typeof world.fixture>[0]>["checks"] }> = {}) {
    let ticks = Date.parse(fixture.page.observedAt);
    const now = () => new Date(++ticks).toISOString();
    const persistence = new Map<string, ReturnType<typeof createDeterministicContactPersistence>>();
    const sessions = sessionFactoryHarness({ ucpath: (): ReturnType<typeof createDeterministicUcpathPersonOrgDriver> => {
      const base = createDeterministicUcpathPersonOrgDriver();
      let activeEid: string | undefined, active: ReturnType<typeof createDeterministicUcpathPersonOrgDriver> | undefined;
      const forSubject = (input: { emplId: string; expectedName: string }) => {
        if (active !== undefined && activeEid === input.emplId) return active;
        activeEid = input.emplId;
        let backend = persistence.get(input.emplId);
        if (backend === undefined) {
          backend = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...fixture.page, displayedEid: input.emplId, displayedName: input.expectedName }), now);
          persistence.set(input.emplId, backend);
        }
        const session = backend.session();
        active = createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, session.save);
        return active;
      };
      return { ...base,
        async searchPersonOrg(input) {
          assert.ok("name" in input);
          const person = EMERGENCY_CONTACT_PEOPLE.find(candidate => candidate.employeeName === input.name); assert.ok(person);
          const candidate = { emplId: person.emplId, name: input.name, department: "Housing Dining Hospitality", jobTitle: "Fixture employee", employeeStatus: "active", hdh: true,
            hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
          return SearchPersonOrgOutputSchema.parse({ results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] } });
        },
        readEmergencyContacts: input => forSubject(input).readEmergencyContacts(input),
        stageEmergencyContact: (input, plan) => forSubject(input).stageEmergencyContact(input, plan),
        saveEmergencyContact: (input, capability) => forSubject(input).saveEmergencyContact(input, capability),
        read: id => id === UCPATH_CONTACT_DISPLAYED_NAME && active !== undefined ? active.read(id) : base.read(id),
      };
    }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
    const f = await world.fixture({ coordinator: true, member: childWorkflowModuleOf("emergency-contact", "emergency-contact-member"), record: true, release: true, pageCount: 2, reviewedPages: EMERGENCY_CONTACT_PEOPLE, operatorEvidence: true,
      onbaseFiling: "skip", sessions, ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.checks === undefined ? {} : { checks: options.checks }),
      screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
    for (const [index, person] of EMERGENCY_CONTACT_PEOPLE.entries()) {
      const command = f.command("correct-ocr-record", index + 1, index);
      assert.equal(f.canonical.kernel.execute({ ...command, payload: { ...command.payload, assertedEid: person.emplId } }).state, "applied");
    }
    assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
    const signal = () => new AbortController().signal;
    const current = (run: RunRecord) => { const stored = f.database.authority.runs.get(run.envelope.runId); assert.ok(stored); return stored; };
    /** Each member run, by the Employee ID its record names. */
    const members = () => new Map(f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(child => child.envelope.workflow === "emergency-contact-member")
      .map(child => [String(Reflect.get(Reflect.get(child.input.parsed.value as object, "record") as object, "assertedEid")), child]));
    const member = (emplId: string) => { const run = members().get(emplId); assert.ok(run, emplId); return current(run); };
    const execute = async () => (await f.canonical.execute(f.parentRun, signal())).run;
    const events = (run: RunRecord) => f.database.authority.timelineEvents.page({}).filter(event => event.scope.kind === "run" && event.scope.runId === run.envelope.runId);
    const checkLines = (run: RunRecord) => referenceCheckLines(events(run));
    const nodeSpans = (run: RunRecord, nodeId: string) => events(run).flatMap(event => event.payload.kind === "span" && event.payload.event.t === "span.ended"
      && event.payload.event.spanPath.includes(`/${nodeId}#`) ? [[event.payload.event.outcome, "notRunReason" in event.payload.event ? event.payload.event.notRunReason : undefined]] : []);
    /** UCPath contact Saves submitted for one employee. */
    const saves = (emplId: string) => persistence.get(emplId)?.submissions.length ?? 0;
    const reader = testRunService(f.database, f.clock);
    const gateDeps = { runReader: reader, authority: { listGateResults: (runId: string) => f.database.authority.gateResults.listByRun(runId) },
      projection: { queueSurface: () => ({ actions: [CANCEL_ROW_ACTION] }) },
      canonical: { reader, database: f.database, descriptors: { resolve: f.resolve } } } as unknown as RunDetailQueryDeps;
    const card = (run: RunRecord) => {
      const parked = current(run);
      const gate = GateDecisionWireSchema.parse(buildRunGate(gateDeps, parked.envelope.runId, undefined, parked));
      assert.ok(gate.state === "open" && gate.decision !== undefined);
      return gate.decision;
    };
    const continueAnyway = (run: RunRecord) => {
      const answer = GateArmAnswerRequestSchema.parse({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
        family: "gate", type: "answer-gate-arm", target: { runId: run.envelope.runId, gateId: referenceGateId(current(run)), expectedVersion: current(run).version }, payload: { arm: "continue" } });
      const resolution = resolveGateArmAnswer(gateDeps, answer, undefined);
      assert.ok(resolution.state === "accepted", JSON.stringify(resolution));
      return f.canonical.kernel.execute(resolution.request);
    };
    const cancel = (run: RunRecord) => f.canonical.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "queue-row", family: "run", type: "cancel", target: { runId: run.envelope.runId, expectedVersion: current(run).version } }));
    return { ...f, current, members, member, execute, events, checkLines, nodeSpans, saves, card, continueAnyway, cancel };
  } };
}
