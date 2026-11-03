import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { emergencyContactIdempotencyKey } from "../../../../src/models/systems/ucpath/contact-contract.js";
import type { UcpathContactWriteTarget } from "../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UcpathSaveEmergencyContact } from "../../../../src/models/systems/ucpath/save-emergency-contact.js";
import { UCPATH_CONTACT_DISPLAYED_NAME } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { WriteAttemptRecordSchema,WriteIntentRecordSchema,deriveIdempotencyKeyDigest,deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { fenceWriteFixture } from "../write-fence-fixture.js";

export function seedUnknownContactWrite(database: AuthorityDatabase, target: UcpathContactWriteTarget, now: string, parked: boolean) {
  const runId = randomUUID(), intentId = randomUUID(), attemptId = randomUUID(), leaseId = randomUUID();
  const bindingProof = { kind: "subject-match", version: 1, proofId: randomUUID(), runId, attempt: 1, leaseId,
    taskId: UcpathSaveEmergencyContact.id, observationId: UCPATH_CONTACT_DISPLAYED_NAME, pageStateId: "ucpath.emergency-contact.editor-ready",
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0001" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0001" },
    match: "match", observedAt: now, afterPrepareSpanPath: "ecm-090000-aaaa/contact-preview/prepare" };
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof), key = emergencyContactIdempotencyKey(target);
  const intent = WriteIntentRecordSchema.parse({ writeIntentId: intentId, workflowId: "write-fixture", itemId: runId, taskId: UcpathSaveEmergencyContact.id,
    system: "ucpath", idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key), currentAttemptId: attemptId,
    generation: 1, runId, runAttempt: 1, bindingProof, bindingProofDigest, fencedAt: now, version: 1, createdAt: now, updatedAt: now, status: "attempting" });
  const attempt = WriteAttemptRecordSchema.parse({ writeAttemptId: attemptId, writeIntentId: intentId, generation: 1, runId, runAttempt: 1,
    leaseId, bindingProof, bindingProofDigest, fencedAt: now, outcome: { state: "attempting" }, recordedAt: now });
  assert.equal(fenceWriteFixture(database, { intent, attempt }).state, "fenced");
  if (parked) {
    const owner = database.authority.runs.get(runId); assert.ok(owner);
    const held = runClaim(owner); assert.ok(held);
    database.authority.writeIntents.parkAttempt({ writeIntentId: intentId, generation: 1, expectedVersion: 1, code: "unknown", message: "Synthetic prior contact submission is unknown", now,
      authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic-contact") });
    assert.equal(database.authority.runs.transition({ runId, expectedVersion: owner.version, claim: { workerId: held.workerId, claimGeneration: held.claimGeneration }, now,
      lifecycle: { state: "parked-write", writeIntentId: intentId, intentGeneration: 1, parkedAt: now, code: "unknown", message: "Synthetic prior contact submission is unknown" } }).state, "applied");
  }
  const stored = database.authority.writeIntents.get(intentId); assert.ok(stored);
  return stored;
}
