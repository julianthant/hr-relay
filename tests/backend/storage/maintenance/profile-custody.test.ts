import assert from "node:assert/strict";
import { it } from "vitest";
import { assertCredentialCopyResourcesClosed, assertShutdownResourcesClosed } from "../../../../src/backend/storage/maintenance/profile-custody.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { ExclusiveSessionLeaseSchema } from "../../../../src/models/sessions/exclusive-session-lease.js";
import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { NOW, UUID_1, UUID_6, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const empty: ReturnType<AuthorityDatabase["readProfileResourceCustody"]> = {
  authorityGeneration: 0, upgrades: [], slots: [], runs: [], writeIntents: [], duoLeases: [],
  exclusiveSessionLeases: [], pendingArtifacts: [], artifactReferences: [], configSnapshots: [],
};
const queued = RunRecordSchema.parse(QUEUED_RUN);
const paused = RunRecordSchema.parse({ ...queued, pause: {
  state: "paused", commandId: UUID_1, requestedAt: NOW, pausedAt: NOW,
} });

it("requires exclusive browser identity release before shutdown can retain paused work", () => {
  const lease = ExclusiveSessionLeaseSchema.parse({ identityKey: "a".repeat(64), generation: 1,
    workerId: "onbase-worker-1", workerLeaseGeneration: 1, sessionId: UUID_6, acquiredAt: NOW, releasedAt: null });
  const facts = { ...empty, runs: [paused], exclusiveSessionLeases: [lease] };
  assert.throws(() => assertShutdownResourcesClosed(facts), /credential-maintenance-custody-unproved/u);
  assert.doesNotThrow(() => assertShutdownResourcesClosed({ ...facts,
    exclusiveSessionLeases: [ExclusiveSessionLeaseSchema.parse({ ...lease, releasedAt: NOW })] }));
});

it("retains an acknowledged pause only for shutdown, keeping credential-copy closure strict", () => {
  assert.doesNotThrow(() => assertShutdownResourcesClosed({ ...empty, runs: [paused] }));
  assert.throws(() => assertCredentialCopyResourcesClosed({ ...empty, runs: [paused] }), /credential-maintenance-custody-unproved/u);
  assert.throws(() => assertShutdownResourcesClosed({ ...empty, runs: [queued] }), /profile-shutdown-custody-unproved/u);
  const requested = RunRecordSchema.parse({ ...queued, pause: { state: "requested", commandId: UUID_1, requestedAt: NOW } });
  assert.throws(() => assertShutdownResourcesClosed({ ...empty, runs: [requested] }), /profile-shutdown-custody-unproved/u);
});

it("retains UNKNOWN only under its exact parked run and generation, without permitting credential copy", () => {
  const intent = WriteIntentRecordSchema.parse(WRITE_INTENT_ATTEMPTING);
  assert.equal(intent.status, "attempting");
  if (intent.status !== "attempting") throw new Error("Synthetic submit must remain unsettled");
  const parked = RunRecordSchema.parse({ ...queued, envelope: { ...queued.envelope,
    workflow: intent.workflowId, itemId: intent.itemId, runId: intent.runId, attempt: intent.runAttempt }, lifecycle: {
    state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
    parkedAt: NOW, code: "unknown", message: "Synthetic unsettled submit",
  } });
  const facts = { ...empty, runs: [parked], writeIntents: [intent] };
  assert.doesNotThrow(() => assertShutdownResourcesClosed(facts));
  assert.throws(() => assertCredentialCopyResourcesClosed(facts), /credential-maintenance-custody-unproved/u);
  for (const lifecycle of [{ ...parked.lifecycle, writeIntentId: UUID_6 }, { ...parked.lifecycle, intentGeneration: intent.generation + 1 }]) {
    const changed = RunRecordSchema.parse({ ...parked, lifecycle });
    assert.throws(() => assertShutdownResourcesClosed({ ...facts, runs: [changed] }), /profile-shutdown-custody-unproved/u);
  }
  assert.throws(() => assertShutdownResourcesClosed({ ...facts, runs: [] }), /profile-shutdown-custody-unproved/u);
  assert.throws(() => assertShutdownResourcesClosed({ ...facts, writeIntents: [] }), /profile-shutdown-custody-unproved/u);
  assert.throws(() => assertShutdownResourcesClosed({ ...facts, runs: [paused] }), /profile-shutdown-custody-unproved/u);
  for (const envelope of [{ ...parked.envelope, workflow: "other-workflow" }, { ...parked.envelope, itemId: UUID_6 },
    { ...parked.envelope, attempt: parked.envelope.attempt + 1 }, { ...parked.envelope, runId: UUID_6 }]) {
    const changed = RunRecordSchema.parse({ ...parked, envelope });
    assert.throws(() => assertShutdownResourcesClosed({ ...facts, runs: [changed] }), /profile-shutdown-custody-unproved/u);
  }
});
