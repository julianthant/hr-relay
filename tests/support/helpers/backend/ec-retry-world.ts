import assert from "node:assert/strict";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UCPATH_CONTACT_DISPLAYED_NAME, UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import fixture from "../../fixtures/ui/ucpath/emergency-contact.fixture.json";
import { createOcrReviewWorld } from "./ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../phase1f-executor-harness.js";

export function createEcRetryWorld() {
  const world = createOcrReviewWorld();
  return { cleanup: world.cleanup, async fixture(options: { failure?: "unknown"; dryRun?: boolean } = {}) {
  const facts = ["Example, Avery", "Example, Blake"].map((employeeName, index) => ({ employeeName, contactName: `Original Contact ${String(index)}`, correctedContactName: `Released Contact ${String(index)}` }));
  let remainingFailures = 1;
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
      const save = options.failure === "unknown" && input.emplId === "10800001" ? { ...session.save, async save() {
        await session.save.save(); throw new Error("fixture-unknown-save-reply");
      } } : session.save;
      active = createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, save);
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
        if (options.failure === undefined && input.emplId === "10800001" && remainingFailures-- > 0) throw new Error("fixture-member-prepare-refused");
        return forSubject(input).stageEmergencyContact(input, plan);
      },
      saveEmergencyContact: (input, capability) => forSubject(input).saveEmergencyContact(input, capability),
      read: id => id === UCPATH_CONTACT_DISPLAYED_NAME && active !== undefined ? active.read(id) : base.read(id),
    };
  }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
  const member = composeWorkflowModule(compileWorkflow(emergencyContactMemberWorkflow), taskStoreRegistry.stores);
  const f = await world.fixture({ coordinator: true, member, record: true, release: true, pageCount: 2, reviewedPages: facts, operatorEvidence: true, dryRun: options.dryRun, sessions, screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
  assert.equal(persistence.size, 0);
  for (let index = 0; index < facts.length; index++) {
    const command = f.command("correct-ocr-record", index + 1, index);
    assert.equal(f.canonical.kernel.execute({ ...command, payload: { ...command.payload, assertedEid: String(10800000 + index) } }).state, "applied");
  }
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  return { ...f, member, persistence, facts };
  } };
}
