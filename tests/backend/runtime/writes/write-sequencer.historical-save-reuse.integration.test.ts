import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety.js";
import fixture from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { contactSaveMember, createEmergencyContactSaveWorld } from "../../../support/helpers/backend/emergency-contact-save-world.js";

const world = createEmergencyContactSaveWorld();
afterEach(world.cleanup);

async function repeatContact(removed: boolean) {
  const f = await world.memberFixture({ sourcePage: null });
  const [intent] = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.ok(intent?.status === "committed");
  assert.equal(f.persistence.submissions.length, 1);
  if (removed) f.persistence.replacePersisted(UcpathContactPageSnapshotSchema.parse(fixture.page));

  const fresh = f.execution.start(contactSaveMember.descriptor, f.member(`${"b".repeat(64)}#emergency-contact#2`, 1), { dryRun: false });
  const result = await f.execution.execute(fresh, world.SIGNAL);
  const probed = f.database.authority.timelineEvents.page({ runId: fresh.envelope.runId, limit: 1000 })
    .some(({ payload }) => payload.kind === "span" && payload.event.t === "data.observed"
      && payload.event.taskId === "ucpath/match-emergency-contact-plan");
  assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.equal(f.database.authority.writeIntents.countDryRunEvidenceByRun(fresh.envelope.runId).writeAttempts, 0);
  return { f, fresh, result, intent, probed };
}

it("parks a fresh member before filing when a previously saved contact has been removed", async () => {
  const { f, fresh, result, probed } = await repeatContact(true);
  assert.deepEqual({
    probed,
    parked: result.run?.lifecycle.state === "parked-write" || result.run?.lifecycle.state === "parked-gate",
    filingChildren: f.database.authority.runs.listChildren(fresh.envelope.runId).length,
    imports: f.filing.imports(),
    saves: f.persistence.submissions.length,
  }, { probed: true, parked: true, filingChildren: 0, imports: 0, saves: 1 });
  assert.equal(f.database.authority.runResults.get(fresh.envelope.runId), undefined);
});

it("reuses the committed proof after a fresh probe confirms the contact is still present", async () => {
  const { f, fresh, result, intent, probed } = await repeatContact(false);
  const checkpoint = f.database.authority.runCheckpoints.latest(fresh.envelope.workflow, fresh.envelope.itemId, "contact-preview");
  assert.equal(checkpoint?.runId, fresh.envelope.runId);
  const outcome = TransactionOutcomeSchema.parse(checkpoint?.output.value);
  assert.equal(outcome.disposition, "already-present");
  assert.equal(outcome.proofSource, "durable-intent");
  assert.deepEqual(outcome.proof, intent.completionProof);
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done");
  assert.equal(f.persistence.submissions.length, 1);
  assert.equal(f.filing.imports(), 1);
  assert.equal(probed, true);
});
