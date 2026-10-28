import { traceOf } from "../../../../fixtures/dashboard/fixture-identity.js";
import { sectionResponse } from "../../../../fixtures/dashboard/run-detail/section-wire.js";
import { SubjectProofSchema, WriteIntentRecordSchema, WriteAttemptRecordSchema, deriveWriteBindingProofDigest, deriveIdempotencyKeyDigest } from "../../../../../../src/rules/write-safety/write-safety.js";
import { deriveWriteAuthorityReason } from "../../../../../../src/rules/write-safety/write-authority-reason.js";
import { idempotencyKeyDigestReference } from "../../../../../../src/rules/redaction/redaction.js";
import type * as FixtureGateTypes from "../../../../fixtures/dashboard/fixture-gate.js";
import type * as FixtureIdentityTypes from "../../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../../fixtures/dashboard/fixture-queue.js";


export function createGatesParkSetup({ buildFixtureIdentityGate, at, uuidOf, FIXTURE_IDS }: {
buildFixtureIdentityGate: typeof FixtureGateTypes.buildFixtureIdentityGate;
at: typeof FixtureIdentityTypes.at;
uuidOf: typeof FixtureIdentityTypes.uuidOf;
FIXTURE_IDS: typeof FixtureQueueTypes.FIXTURE_IDS;
}) {
  const GATE_NODE_ID = "identity-approval";

  const FIXTURE_IDENTITY_GATE = { ...buildFixtureIdentityGate({
    runId: FIXTURE_IDS.openGateRun,
    gateId: GATE_NODE_ID,
    label: "Identity Approval",
    parkedAt: at(49),
    resumeAt: "approval",
    expectedVersion: 5,
    observedAt: at(48),
    documentName: "Morrow, Bea",
  }), native: { eventId: uuidOf(9501), order: 4, runId: FIXTURE_IDS.openGateRun, attempt: 1,
    traceId: traceOf(5), spanPath: `${traceOf(5)}/${GATE_NODE_ID}`, nodeId: GATE_NODE_ID } };

  const FIXTURE_IDENTITY_GATE_NAME_MISMATCH = { ...buildFixtureIdentityGate({
    runId: FIXTURE_IDS.gateNameMismatchRun,
    gateId: GATE_NODE_ID,
    label: "Identity Approval",
    parkedAt: at(24),
    resumeAt: "approval",
    expectedVersion: 44,
    observedAt: at(23),
    documentName: "Okonkwo, Adaeze",
  }), native: { eventId: uuidOf(13401), order: 4, runId: FIXTURE_IDS.gateNameMismatchRun, attempt: 1,
    traceId: traceOf(44), spanPath: `${traceOf(44)}/${GATE_NODE_ID}`, nodeId: GATE_NODE_ID } };

  const PARKED_WRITE_INTENT_ID = uuidOf(906);

  const PARKED_WRITE_PROOF = SubjectProofSchema.parse({
    kind: "subject-match", version: 1, proofId: uuidOf(907), runId: FIXTURE_IDS.parkedRun,
    attempt: 1, leaseId: uuidOf(908), taskId: "ucpath/terminate-person",
    observationId: "ucpath.termination.subject", pageStateId: "ucpath.termination-ready",
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "3".repeat(64), displaySuffix: "7012" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "3".repeat(64), displaySuffix: "7012" },
    match: "match", observedAt: at(44), afterPrepareSpanPath: "termination/prepare",
  });

  const PARKED_WRITE_BINDING_DIGEST = deriveWriteBindingProofDigest(PARKED_WRITE_PROOF);

  const PARKED_WRITE_KEY = "10807012|termination|2026-08-28";

  const PARKED_WRITE_REASON = deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "fixture verifier unknown");

  const PARKED_WRITE_ATTEMPT = WriteAttemptRecordSchema.parse({
    writeAttemptId: uuidOf(909), writeIntentId: PARKED_WRITE_INTENT_ID, generation: 1,
    runId: FIXTURE_IDS.parkedRun, runAttempt: 1, leaseId: PARKED_WRITE_PROOF.leaseId,
    bindingProof: PARKED_WRITE_PROOF, bindingProofDigest: PARKED_WRITE_BINDING_DIGEST,
    fencedAt: at(44), recordedAt: at(45),
    outcome: { state: "parked", code: "unknown", message: "Fixture verification unknown", authorityReason: PARKED_WRITE_REASON },
  });

  const PARKED_WRITE_INTENT = WriteIntentRecordSchema.parse({
    writeIntentId: PARKED_WRITE_INTENT_ID, workflowId: "person-lookup", itemId: uuidOf(910),
    taskId: PARKED_WRITE_PROOF.taskId, system: "ucpath", idempotencyKey: PARKED_WRITE_KEY,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", PARKED_WRITE_KEY),
    currentAttemptId: PARKED_WRITE_ATTEMPT.writeAttemptId, generation: 1, runId: FIXTURE_IDS.parkedRun,
    runAttempt: 1, bindingProof: PARKED_WRITE_PROOF, bindingProofDigest: PARKED_WRITE_BINDING_DIGEST,
    fencedAt: at(44), version: 2, createdAt: at(44), updatedAt: at(45), status: "parked",
    parkedCode: "unknown", message: "Fixture verification unknown", authorityReason: PARKED_WRITE_REASON,
  });

  const PARKED_WRITE_TARGET = { writeIntentId: PARKED_WRITE_INTENT.writeIntentId,
    intentGeneration: PARKED_WRITE_INTENT.generation, writeAttemptId: PARKED_WRITE_ATTEMPT.writeAttemptId,
    bindingProofDigest: PARKED_WRITE_BINDING_DIGEST, occurrenceKeyDigest: PARKED_WRITE_INTENT.idempotencyKeyDigest };

  const PARKED_WRITE_SYSTEM = "ucpath";

  const PARKED_WRITE_REVISION = 6;

  const FIXTURE_PARKED_WRITE = {
    runId: FIXTURE_IDS.parkedRun,
    native: { eventId: uuidOf(9960), order: 50, runId: FIXTURE_IDS.parkedRun, attempt: 1, traceId: traceOf(6), nodeId: "terminate" },
    writeIntentId: PARKED_WRITE_INTENT_ID,
    generation: 1,
    runAttempt: 1,
    system: PARKED_WRITE_SYSTEM,
    taskId: "ucpath/terminate-person",
    idempotencyKeyDigest: "7".repeat(64),
    fencedAt: at(44),
    parkedAt: at(45),
    parkedCode: "unknown",
    parkedMessage: `Write intent ${PARKED_WRITE_INTENT_ID} is parked (unknown) for `
      + `${idempotencyKeyDigestReference("7".repeat(64))}. Verify the target system, then use one typed resolution.`,
    subject: {
      state: "subject-match",
      proofId: uuidOf(907),
      observedAt: at(44),
      evidence: {
        kind: "person",
        identifierKind: "eid",
        bindingDigest: "3".repeat(64),
        displaySuffix: "7012",
      },
    },
    proofContract: {
      state: "served",
      commitTaskId: "ucpath/terminate-person",
      completionKind: "save-verify",
      schemaHash: "c".repeat(64),
      fields: [
        { kind: "fixed", path: "kind", value: "ucpath-termination" },
        { kind: "text", path: "emplId", pattern: "^10\\d{6}$", serverOnlyRules: false },
        {
          kind: "text",
          path: "effectiveDate",
          pattern: "^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$",
          serverOnlyRules: false,
        },
        { kind: "text", path: "transactionId", pattern: "^T\\d{6,}$", serverOnlyRules: false },
        {
          kind: "choice",
          path: "approvalStatus",
          options: ["Approved", "Denied", "Error", "Manually Processed", "Pending", "Pushed Back"],
        },
        { kind: "text", path: "displayedName", minLength: 1, serverOnlyRules: false },
        { kind: "fixed", path: "source", value: "ss-smart-hr-detail-read" },
      ],
    },
    actions: [
      {
        key: "recheck-write",
        label: "Check again",
        detail: "Read the target system again. A verified transaction continues the run; uncertainty keeps the write parked.",
        intent: "warning",
        icon: "resolve",
        placement: ["banner", "footer"],
        kind: "command",
        command: "recheck-write",
        expectedVersion: PARKED_WRITE_REVISION,
        confirm: {
          title: "Check the target system again",
          body: "Relay reads ucpath again and submits nothing. If it finds this write, the run continues to its next step.",
          confirmLabel: "Check again",
          tone: "neutral",
        },
        writeTarget: PARKED_WRITE_TARGET,
      },
      {
        key: "resolve-write-absent",
        label: "I confirmed it is NOT there",
        detail: "Release the fence so the run may attempt the write again under a new generation.",
        intent: "primary",
        icon: "resolve",
        placement: ["banner", "footer"],
        kind: "command",
        command: "resolve-write-absent",
        expectedVersion: PARKED_WRITE_REVISION,
        confirm: {
          title: "Confirm the transaction is absent",
          body: `This authorizes a fresh attempt against ${PARKED_WRITE_SYSTEM}. If the transaction does exist, `
            + "the retry submits it a SECOND time.",
          confirmLabel: "It is not there",
          tone: "destructive",
        },
        writeTarget: PARKED_WRITE_TARGET,
      },
    ],
  } as const;

  const FIXTURE_GATE_PARK_SECTIONS = Object.freeze({
    [FIXTURE_IDS.parkedRun]: Object.freeze({
      "parked-write": sectionResponse({ section: "parked-write", payload: FIXTURE_PARKED_WRITE }),
    }),
    [FIXTURE_IDS.openGateRun]: Object.freeze({
      "identity-gate": sectionResponse({
        section: "identity-gate",
        payload: { state: "available", value: FIXTURE_IDENTITY_GATE },
      }),
    }),
    [FIXTURE_IDS.gateNameMismatchRun]: Object.freeze({
      "identity-gate": sectionResponse({
        section: "identity-gate",
        payload: { state: "available", value: FIXTURE_IDENTITY_GATE_NAME_MISMATCH },
      }),
    }),
  });

  return { PARKED_WRITE_INTENT, FIXTURE_IDENTITY_GATE, FIXTURE_IDENTITY_GATE_NAME_MISMATCH, FIXTURE_PARKED_WRITE, FIXTURE_GATE_PARK_SECTIONS };
}
