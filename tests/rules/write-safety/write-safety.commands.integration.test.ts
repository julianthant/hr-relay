import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe,it } from "vitest";
import { deriveWriteBindingProofDigest } from "../../../src/rules/write-safety/write-safety.js";
import { WRITE_ATTEMPT,WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW,id } from "../../support/helpers/database-foundation/fixtures.js";
import { resolutionCommand,resolutionFixture } from "../../support/helpers/failure-resolution/fixtures.js";

describe("D resolution command authority", () => {
  it("annotation cannot settle a parked UNKNOWN write or admit its generic retry", () => {
    const f = resolutionFixture();
    try {
      const run = f.createRun(id(83));
      assert.equal(run.lifecycle.state, "running");
      if (run.lifecycle.state !== "running") throw new Error("fixture not running");
      const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId };
      const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
      const intent = { ...WRITE_INTENT_ATTEMPTING, runId: run.envelope.runId, bindingProof, bindingProofDigest,
        workflowId: run.envelope.workflow, itemId: run.envelope.itemId };
      assert.equal(f.db.authority.writeIntents.fenceAttempt({ intent,
        attempt: { ...WRITE_ATTEMPT, runId: run.envelope.runId, bindingProof, bindingProofDigest } }).state, "fenced");
      const parked = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration },
        lifecycle: { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: 1,
          parkedAt: NOW, code: "unknown", message: "Synthetic UNKNOWN submit" }, now: NOW });
      assert.equal(parked.state, "applied");
      if (parked.state !== "applied") throw new Error("fixture not parked");
      const retry = () => f.kernel.execute({ commandId: randomUUID(), requestedAt: NOW,
        requestedBy: "local-operator", source: "dashboard", reason: "Synthetic retry",
        family: "run", type: "retry", target: { runId: run.envelope.runId, expectedVersion: parked.run.version } });
      const before = JSON.stringify({ run: f.db.authority.runs.get(run.envelope.runId),
        intent: f.db.authority.writeIntents.get(intent.writeIntentId) });
      const first = retry(); assert.equal(first.state, "rejected");
      if (first.state === "rejected") assert.match(first.message, /never generic retry/u);
      assert.equal(f.kernel.execute(resolutionCommand()).state, "applied");
      const after = retry(); assert.equal(after.state, "rejected");
      if (after.state === "rejected") assert.match(after.message, /never generic retry/u);
      assert.equal(JSON.stringify({ run: f.db.authority.runs.get(run.envelope.runId),
        intent: f.db.authority.writeIntents.get(intent.writeIntentId) }), before);
      assert.equal(f.db.authority.failures.get(f.record.failureId)?.writeState, "unknown");
    } finally { f.dispose(); }
  });
});
