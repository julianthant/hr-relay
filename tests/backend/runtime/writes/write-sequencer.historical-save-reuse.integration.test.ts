import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { nodeIdOfTaskSpanPath } from "../../../../src/backend/runs/lifecycle/support.js";
import { RunTerminalEvidenceResultSchema } from "../../../../src/models/run/result.js";
import { operatorFailureSentence } from "../../../../src/models/failures/error-catalog.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety.js";
import fixture from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { contactSaveMember, createEmergencyContactSaveWorld } from "../../../support/helpers/backend/emergency-contact-save-world.js";

const world = createEmergencyContactSaveWorld();
afterEach(world.cleanup);

async function repeatContact(removed: boolean, options: { sameItem?: boolean; dryRun?: boolean } = {}) {
  const f = await world.memberFixture({ sourcePage: null });
  const [intent] = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.ok(intent?.status === "committed");
  assert.equal(f.persistence.submissions.length, 1);
  if (removed) f.persistence.replacePersisted(UcpathContactPageSnapshotSchema.parse(fixture.page));

  const member = f.member(options.sameItem ? undefined : `${"b".repeat(64)}#emergency-contact#2`, 1);
  const fresh = f.execution.start(contactSaveMember.descriptor, member, { dryRun: options.dryRun ?? false });
  const result = await f.execution.execute(fresh, world.SIGNAL);
  const probed = f.database.authority.timelineEvents.page({ runId: fresh.envelope.runId, limit: 1000 })
    .some(({ payload }) => payload.kind === "span" && payload.event.t === "data.observed"
      && payload.event.taskId === "ucpath/match-emergency-contact-plan");
  assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.equal(f.database.authority.writeIntents.countDryRunEvidenceByRun(fresh.envelope.runId).writeAttempts, 0);
  return { f, fresh, result, intent, probed };
}

it.each([
  ["a new item", {}],
  ["the same item", { sameItem: true }],
  ["a dry run", { dryRun: true }],
] as const)("fails %s before filing when a previously saved contact has been removed", async (_case, options) => {
  const { f, fresh, result, probed } = await repeatContact(true, options);
  assert.deepEqual({
    probed,
    outcome: result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome,
    failureCodes: f.database.authority.failures.listByRun(fresh.envelope.runId).map(failure => failure.code),
    filingChildren: f.database.authority.runs.listChildren(fresh.envelope.runId).length,
    imports: f.filing.imports(),
    saves: f.persistence.submissions.length,
  }, { probed: true, outcome: "failed", failureCodes: ["WRITE_COMMITTED_EFFECT_ABSENT"], filingChildren: 0, imports: 0, saves: 1 });
  assert.equal(operatorFailureSentence("WRITE_COMMITTED_EFFECT_ABSENT"),
    "The earlier Save is gone from UCPath. Check it, then rerun.");
  const evidence = f.database.authority.runResults.get(fresh.envelope.runId);
  assert.equal(RunTerminalEvidenceResultSchema.parse(evidence?.result.value).kind, "failed-evidence");
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

it("probes again after losing the fence to a committed contact Save", async () => {
  let publishWinner: (() => void) | undefined;
  const f = await world.memberFixture({ sourcePage: null, sequencerAuthority: database => ({
    authority: { ...database.authority, writeIntents: { ...database.authority.writeIntents,
      findByPermanentKey: (system, key) => publishWinner === undefined
        ? database.authority.writeIntents.findByPermanentKey(system, key) : undefined,
    } },
    withAuthorityTransaction: work => database.withAuthorityTransaction(repositories => work({
      ...repositories, writeIntents: { ...repositories.writeIntents, fenceAttempt(input) {
        const result = repositories.writeIntents.fenceAttempt(input);
        if (publishWinner !== undefined) {
          assert.equal(result.state, "existing");
          publishWinner();
          publishWinner = undefined;
        }
        return result;
      } },
    })),
    commitWriteAttempt: database.commitWriteAttempt.bind(database),
    commitRecheckedParkedWrite: database.commitRecheckedParkedWrite.bind(database),
    settleResolvedParkedAbsence: database.settleResolvedParkedAbsence.bind(database),
  }) });
  const [winner] = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.ok(winner?.status === "committed");

  // The loser's first lookup and page read precede the winner. Its real fence sees the committed row.
  const saved = f.persistence.snapshot();
  f.persistence.replacePersisted(UcpathContactPageSnapshotSchema.parse(fixture.page));
  publishWinner = () => f.persistence.replacePersisted(saved);
  const loser = f.execution.start(contactSaveMember.descriptor, f.member(`${"b".repeat(64)}#emergency-contact#2`, null), { dryRun: false });
  const result = await f.execution.execute(loser, world.SIGNAL);

  assert.equal(publishWinner, undefined);
  assert.deepEqual(f.database.authority.failures.listByRun(loser.envelope.runId).map(row => row.summary), []);
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done");
  const observations = f.database.authority.timelineEvents.page({ runId: loser.envelope.runId, limit: 1000 })
    .flatMap(({ payload }) => payload.kind === "span" && payload.event.t === "data.observed"
      && payload.event.taskId === "ucpath/match-emergency-contact-plan" ? [payload.event.spanPath] : []);
  assert.equal(new Set(observations).size, 2);
  assert.ok(observations.every(path => nodeIdOfTaskSpanPath(path) === "contact-preview"));
  const checkpoint = f.database.authority.runCheckpoints.latest(loser.envelope.workflow, loser.envelope.itemId, "contact-preview");
  const outcome = TransactionOutcomeSchema.parse(checkpoint?.output.value);
  assert.equal(outcome.proofSource, "durable-intent");
  assert.deepEqual(outcome.proof, winner.completionProof);
  assert.equal(f.persistence.submissions.length, 1);
  assert.equal(f.database.authority.writeIntents.countDryRunEvidenceByRun(loser.envelope.runId).writeAttempts, 0);
});
