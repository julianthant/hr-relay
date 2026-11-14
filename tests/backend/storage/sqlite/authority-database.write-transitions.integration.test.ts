import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { ZodError } from "zod";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-safety.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { UUID_1, UUID_2, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WRITE_FIXTURE_NOW } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("a parked write leaves only through the operator's bound resolution", () => {
  it("refuses every unbound or mis-bound route from parked to retryable and leaves both rows untouched", async () => {
    const h = await harness();
    const { intent: fenced } = attemptingIntentFixture(UUID_5);
    assert.equal(fenceWriteFixture(h.database, attemptingIntentFixture(UUID_5)).state, "fenced");
    const parked = h.database.withAuthorityTransaction((repositories) => repositories.writeIntents.parkAttempt({
      writeIntentId: fenced.writeIntentId,
      generation: fenced.generation,
      expectedVersion: fenced.version,
      code: "unknown",
      message: "seeded park",
      authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "seeded park"),
      now: WRITE_FIXTURE_NOW,
    }));
    assert.equal(parked.status, "parked");
    if (parked.status !== "parked") return;
    const snapshot = () => canonicalJsonStringify({
      intent: h.database.authority.writeIntents.get(parked.writeIntentId),
      attempt: h.database.authority.writeAttempts.get(parked.currentAttemptId),
    });
    const before = snapshot();
    const settlement = {
      state: "operator-confirmed-absent" as const,
      writeIntentId: parked.writeIntentId,
      generation: parked.generation,
      operator: "local-operator",
      confirmedAt: WRITE_FIXTURE_NOW,
    };
    const binding = (decision: "present" | "absent") => ({
      commandId: UUID_1, auditId: UUID_2, writeIntentId: parked.writeIntentId, writeAttemptId: parked.currentAttemptId,
      generation: parked.generation, bindingProofDigest: parked.bindingProofDigest, idempotencyKeyDigest: parked.idempotencyKeyDigest,
      runId: parked.runId, runAttempt: parked.runAttempt, expectedRunVersion: 1, decision, resolvedAt: WRITE_FIXTURE_NOW,
    });
    const target = { writeIntentId: parked.writeIntentId, generation: parked.generation, expectedVersion: parked.version };

    assert.throws(() => h.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.settleRetryable({ ...target, settlement, now: WRITE_FIXTURE_NOW })));
    assert.throws(() => h.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.parkAttempt({ ...target, code: "ambiguous", message: "re-park", now: WRITE_FIXTURE_NOW,
        authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "re-park") })));
    assert.throws(() => h.database.settleResolvedParkedAbsence({ writeIntentId: parked.writeIntentId, generation: parked.generation,
      expectedIntentVersion: parked.version, settlement, resolution: binding("present") }),
    (error: unknown) => error instanceof ZodError && error.issues.some((issue) => issue.path.join(".") === "resolution.decision"));
    assert.throws(() => h.database.settleResolvedParkedAbsence({ writeIntentId: parked.writeIntentId, generation: parked.generation,
      expectedIntentVersion: parked.version, settlement, resolution: binding("absent") }));

    assert.equal(snapshot(), before, "no refused route rewrote the parked intent or its attempt");
  });
});
