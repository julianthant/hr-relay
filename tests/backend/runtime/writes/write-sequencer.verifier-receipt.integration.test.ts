import assert from "node:assert/strict";
import { z } from "zod";
import { afterEach, it } from "vitest";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

import { UcpathSaveEmergencyContact } from "../../../../src/models/systems/ucpath/save-emergency-contact.js";
import { UcpathPendingSweepSettlementProofSchema } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { compositionHarness, compositionClaimRunning, compositionContext, SWEEP_NODE, COMPOSITION_EID, COMPOSITION_UCPATH_NAME } from "../../../support/helpers/separations-composition-fixtures.js";
import { createDeterministicUcpathDriverRow } from "../../../support/helpers/ucpath-pending-row-fixtures.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

it("parks after one click when the verifier finds a different receipt from the callback", async () => {
  const h = await harness();
  const { run, claim } = claimRunning(h.database, h.clock);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  h.world.commitOutput = { transactionId: "T123456" };
  h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });

  await assert.rejects(h.execute(contextFor(run, claim, writeFixtureSaveDescriptor)),
    (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown");
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
  assert.ok(h.world.events.includes("verify"));
  assert.equal(intentByKey(h.database)?.status, "parked");
  assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-write");
  assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  assert.ok(!h.database.authority.timelineEvents.page({ runId: run.envelope.runId })
    .some(row => row.payload.kind === "operation-confirmed"));
});

it("publishes the verifier's later observation of the same cleared pending set", async () => {
  const rows = [createDeterministicUcpathDriverRow(COMPOSITION_EID).transactionRow({ displayedName: COMPOSITION_UCPATH_NAME })];
  const h = await compositionHarness({ rows });
  try {
    const { run, claim } = compositionClaimRunning(h.database, h.clock);
    const now = h.clock.now.bind(h.clock);
    const scans: string[] = [];
    h.clock.now = () => {
      if (h.ucpath.events.filter(event => event === "scan").length > scans.length) {
        h.clock.advanceWall(1);
        scans.push(now().toISOString());
      }
      return now();
    };
    const context = compositionContext(run, claim, SWEEP_NODE, false, rows);
    const result = await h.bound(() => h.sequencer.executeTransaction(context));
    const outcome = z.object({ disposition: z.literal("committed"), proof: UcpathPendingSweepSettlementProofSchema,
      output: z.object({ cleared: UcpathPendingSweepSettlementProofSchema }) }).parse(result);
    assert.ok(scans.length >= 2);
    assert.notEqual(scans.at(-1), scans.at(-2));
    assert.equal(outcome.proof.observedAt, scans.at(-1));
    assert.deepEqual(outcome.output.cleared, outcome.proof);
  } finally { await h.dispose(); }
});

it("identifies the same emergency contact effect across persisted reads and distinguishes a changed effect", () => {
  const { effectIdentity } = UcpathSaveEmergencyContact.writeSafety.completion;
  assert.ok(effectIdentity);
  const { proof } = UcpathSaveEmergencyContact.example;
  const later = UcpathSaveEmergencyContact.writeSafety.completion.proofSchema.parse({ ...proof,
    contacts: { ...proof.contacts, observedAt: "2026-11-01T12:01:00.000Z" } });
  const effect = { ...proof.effect, name: "Different Synthetic Contact" };
  const changed = UcpathSaveEmergencyContact.writeSafety.completion.proofSchema.parse({ ...later, effect,
    contacts: { ...later.contacts, rows: [{ kind: "contact", rowIndex: 0, effect }] } });
  assert.deepEqual(effectIdentity(later), effectIdentity(proof));
  assert.notDeepEqual(effectIdentity(changed), effectIdentity(proof));
});
