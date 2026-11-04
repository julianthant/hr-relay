import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { createDeterministicContactPersistence } from "../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { UCPATH_CONTACT_DISPLAYED_NAME, UcpathContactPageSnapshotSchema } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { SearchPersonOrgOutputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { EmergencyContactMemberInputSchema } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { EmergencyContactResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import { composeWorkflowModule } from "../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactMemberWorkflow } from "../../../src/workflows/emergency-contact-member/workflow.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import fixture from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { createOcrReviewWorld } from "../../support/helpers/backend/ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";

const contactSaveMember = compileWorkflow(emergencyContactMemberWorkflow);

const world = createOcrReviewWorld();
afterEach(world.cleanup);
it("keeps the one OCR release and native member lineage while reporting one verified Save and one failed sibling without a forged output", async () => {
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
        if (input.emplId === "10800001") throw new Error("fixture-second-member-prepare-refused");
        return forSubject(input).stageEmergencyContact(input, plan);
      },
      saveEmergencyContact: (input, capability) => forSubject(input).saveEmergencyContact(input, capability),
      read: id => id === UCPATH_CONTACT_DISPLAYED_NAME && active !== undefined ? active.read(id) : base.read(id),
    };
  }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
  const member = composeWorkflowModule(contactSaveMember, taskStoreRegistry.stores);
  const f = await world.fixture({ coordinator: true, member, record: true, release: true, pageCount: 2, reviewedPages: facts, operatorEvidence: true, sessions, screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
  assert.equal(persistence.size, 0);
  for (let index = 0; index < facts.length; index++) {
    const command = f.command("correct-ocr-record", index + 1, index);
    assert.equal(f.canonical.kernel.execute({ ...command, payload: { ...command.payload, assertedEid: String(10800000 + index) } }).state, "applied");
  }
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  const interrupted = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.equal(interrupted.run?.lifecycle.state, "queued", "a terminal failed sibling requeues the allow-partial parent");
  const execution = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(execution.run?.lifecycle.state === "terminal" && execution.run.lifecycle.outcome === "done", JSON.stringify({ lifecycle: execution.run?.lifecycle, failures: f.database.authority.runs.listChildren(f.parentRun.envelope.runId).flatMap(child => f.database.authority.failures.listByRun(child.envelope.runId)).map(failure => ({ code: failure.code, summary: failure.summary })) }));
  const snapshot = f.database.authority.ocrReviews.snapshots(f.run.envelope.runId); assert.equal(snapshot.length, 1);
  const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(child => child.envelope.workflow === "emergency-contact-member");
  assert.equal(children.length, 2);
  assert.deepEqual(children.map(child => EmergencyContactMemberInputSchema.parse(child.input.parsed.value).record), snapshot[0]?.records);
  assert.ok(children.every(child => EmergencyContactMemberInputSchema.parse(child.input.parsed.value).approval.snapshotId === snapshot[0]?.snapshotId));
  const stored = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(stored);
  const result = EmergencyContactResultSchema.parse(stored.result.value);
  assert.deepEqual(result.members.map(member => member.state), ["done", "failed"]);
  const first = result.members[0], second = result.members[1]; assert.ok(first?.state === "done" && second?.state === "failed");
  assert.equal(first.output.disposition, "committed");
  assert.equal(first.output.proof.effect.name, facts[0]?.correctedContactName);
  assert.equal("output" in second, false);
  assert.equal(persistence.get("10800000")?.submissions.length, 1);
  const succeeded = children[0]; assert.ok(succeeded);
  assert.equal(f.database.authority.writeIntents.listByRun(succeeded.envelope.runId)[0]?.status, "committed");
  assert.ok(f.database.authority.runCheckpoints.latest(succeeded.envelope.workflow, succeeded.envelope.itemId, "contact-preview"));
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.equal(createTransactionHistory(f.database.authority).query({ from: date, to: date, runId: succeeded.envelope.runId }).rows.length, 1);
  const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [contactSaveMember.descriptor] });
  assert.equal(receipts.ensureReceipt(succeeded.envelope.runId).result, "verified-done");
  assert.equal(persistence.get("10800001")?.submissions.length, 0);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(children[1].envelope.runId), []);
  const rows = f.database.withAuthorityReadSnapshot(() => {
    const parent = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(parent);
    return readQueueRecordMembers(f.database.authority, f.canonical.lifecycle, parent,
      f.database.authority.runs.listChildren(parent.envelope.runId), f.resolve);
  });
  assert.ok(rows);
  assert.deepEqual(rows.members.map(row => row.statusLabel), ["Saved", "Failed"]);
  assert.deepEqual(rows.members.map(row => row.target.runId), children.map(child => child.envelope.runId));
  assert.ok(rows.members.every(row => row.kind === "record" && row.record.runId === f.run.envelope.runId));
});
