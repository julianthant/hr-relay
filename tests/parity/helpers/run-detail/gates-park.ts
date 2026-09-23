import { idempotencyKeyDigestReference } from "../../../../src/domain/redaction.js";
import { buildFixtureIdentityGate } from "../fixture-gate.js";
import { at,uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { sectionResponse } from "./section-wire.js";

const GATE_NODE_ID = "identity-approval";

export const FIXTURE_IDENTITY_GATE = buildFixtureIdentityGate({
  runId: FIXTURE_IDS.openGateRun,
  gateId: GATE_NODE_ID,
  label: "Identity Approval",
  parkedAt: at(49),
  resumeAt: "approval",
  expectedVersion: 5,
  observedAt: at(48),
  documentName: "Blirea, Glaundi",
});

export const FIXTURE_IDENTITY_GATE_TYPED_EID = buildFixtureIdentityGate({
  runId: FIXTURE_IDS.gateTypedEidRun,
  gateId: GATE_NODE_ID,
  label: "Identity Approval",
  parkedAt: at(24),
  resumeAt: "approval",
  expectedVersion: 44,
  observedAt: at(23),
  documentName: "Okonkwo, Adaeze",
});

const PARKED_WRITE_INTENT_ID = uuidOf(906);
const PARKED_WRITE_TARGET = { writeIntentId: PARKED_WRITE_INTENT_ID, intentGeneration: 1 };
const PARKED_WRITE_SYSTEM = "ucpath";
const PARKED_WRITE_REVISION = 6;

export const FIXTURE_PARKED_WRITE = {
  runId: FIXTURE_IDS.parkedRun,
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
      key: "resolve-write-present",
      label: "I confirmed it IS there",
      detail: "Record the transaction you found, with its proof. The run settles as committed and never clicks again.",
      intent: "warning",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-present",
      expectedVersion: PARKED_WRITE_REVISION,
      confirm: {
        title: "Confirm the transaction exists",
        body: `This files ${PARKED_WRITE_SYSTEM} transaction ${PARKED_WRITE_INTENT_ID} as committed on this run's `
          + "evidence. If it is not actually there, the run finishes reporting work nobody did.",
        confirmLabel: "It is there",
        tone: "destructive",
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

export const FIXTURE_GATE_PARK_SECTIONS = Object.freeze({
  [FIXTURE_IDS.parkedRun]: Object.freeze({
    "parked-write": sectionResponse({ section: "parked-write", payload: FIXTURE_PARKED_WRITE }),
  }),
  [FIXTURE_IDS.openGateRun]: Object.freeze({
    "identity-gate": sectionResponse({
      section: "identity-gate",
      payload: { state: "available", value: FIXTURE_IDENTITY_GATE },
    }),
  }),
  [FIXTURE_IDS.gateTypedEidRun]: Object.freeze({
    "identity-gate": sectionResponse({
      section: "identity-gate",
      payload: { state: "available", value: FIXTURE_IDENTITY_GATE_TYPED_EID },
    }),
  }),
});
