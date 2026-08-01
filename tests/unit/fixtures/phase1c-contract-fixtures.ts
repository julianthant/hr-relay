import { ConfigSchema } from "../../../src/domain/config/schema.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
} from "../../../src/domain/write-safety.js";

export const UUID_1 = "11111111-1111-4111-8111-111111111111";
export const UUID_2 = "22222222-2222-4222-8222-222222222222";
export const UUID_3 = "33333333-3333-4333-8333-333333333333";
export const UUID_4 = "44444444-4444-4444-8444-444444444444";
export const UUID_5 = "55555555-5555-4555-8555-555555555555";
export const UUID_6 = "66666666-6666-4666-8666-666666666666";
export const UUID_7 = "77777777-7777-4777-8777-777777777777";
export const UUID_8 = "88888888-8888-4888-8888-888888888888";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);
export const NOW = "2026-07-31T17:00:00.000Z";
export const LATER = "2026-07-31T17:01:00.000Z";
export const LATEST = "2026-07-31T17:02:00.000Z";
export const IDEMPOTENCY_KEY = "10001573|termination|2026-08-01";
export const IDEMPOTENCY_KEY_DIGEST = deriveIdempotencyKeyDigest("ucpath", IDEMPOTENCY_KEY);

const BASE_COMMAND = {
  commandId: UUID_1,
  requestedAt: NOW,
  requestedBy: "local-operator",
  source: "dashboard",
};

const RUN_TARGET = { runId: UUID_2, expectedVersion: 1 };
const INTAKE_TARGET = { intakeSessionId: UUID_3, expectedVersion: 1 };
const WORKER_TARGET = { workerId: "worker-1", expectedVersion: 1 };
const CAPTURE_TARGET = { captureSessionId: UUID_4, expectedVersion: 1 };

export const COMMAND_FIXTURES: readonly unknown[] = [
  { ...BASE_COMMAND, family: "start", type: "start-run", target: { workflowId: "onboarding", startPlanId: UUID_3 }, payload: { descriptorFingerprint: HASH_A, configFingerprint: HASH_B, inputFingerprint: HASH_C } },
  { ...BASE_COMMAND, family: "intake", type: "inspect-intake", target: INTAKE_TARGET, payload: { artifactId: UUID_4 } },
  { ...BASE_COMMAND, family: "intake", type: "confirm-intake-mapping", target: INTAKE_TARGET, payload: { mappingFingerprint: HASH_A } },
  { ...BASE_COMMAND, family: "intake", type: "correct-intake-row", target: INTAKE_TARGET, payload: { rowId: UUID_5, correctionArtifactId: UUID_6, correctionFingerprint: HASH_B } },
  { ...BASE_COMMAND, family: "intake", type: "exclude-intake-row", target: INTAKE_TARGET, payload: { rowId: UUID_5, reason: "Source row is not in scope" } },
  { ...BASE_COMMAND, family: "intake", type: "validate-intake", target: INTAKE_TARGET },
  { ...BASE_COMMAND, family: "intake", type: "enqueue-intake-manifest", target: { intakeManifestId: UUID_4, expectedVersion: 1 } },
  { ...BASE_COMMAND, family: "worker-browser", type: "plan-worker-count", target: { workflowId: "onboarding", expectedVersion: 1 }, payload: { desiredWorkers: 2 } },
  { ...BASE_COMMAND, family: "worker-browser", type: "spawn-worker", target: { workflowId: "onboarding", expectedVersion: 1 }, payload: { workerId: "worker-1" } },
  { ...BASE_COMMAND, family: "worker-browser", type: "stop-worker", target: WORKER_TARGET },
  { ...BASE_COMMAND, family: "worker-browser", type: "pause-worker", target: WORKER_TARGET },
  { ...BASE_COMMAND, family: "worker-browser", type: "resume-worker", target: WORKER_TARGET },
  { ...BASE_COMMAND, family: "worker-browser", type: "refresh-browser", target: { ...WORKER_TARGET, browserSessionId: UUID_4 } },
  { ...BASE_COMMAND, family: "worker-browser", type: "reopen-browser", target: { ...WORKER_TARGET, browserSessionId: UUID_4 } },
  { ...BASE_COMMAND, family: "settings", type: "apply-settings", target: { expectedRevision: 1 }, payload: { settingsSchemaHash: HASH_A, patchFingerprint: HASH_B, patch: {} } },
  { ...BASE_COMMAND, family: "version-archive", type: "plan-version-bump", target: { scope: { kind: "workflows", workflowIds: ["onboarding"] } }, payload: { targetVersion: "1.1.0", changeFingerprint: HASH_A } },
  { ...BASE_COMMAND, family: "version-archive", type: "apply-version-bump", target: { versionPlanId: UUID_3, expectedVersion: 1 }, payload: { planFingerprint: HASH_A } },
  { ...BASE_COMMAND, family: "version-archive", type: "relaunch-archived-run", target: { archivedRunId: UUID_2, archiveFingerprint: HASH_A } },
  ...["retry", "cancel", "bump", "hide", "unhide"].map((type) => ({ ...BASE_COMMAND, family: "run", type, target: RUN_TARGET })),
  { ...BASE_COMMAND, family: "run", type: "rename", target: RUN_TARGET, payload: { displayName: "Summer onboarding" } },
  { ...BASE_COMMAND, family: "run", type: "edit-checkpoint", target: RUN_TARGET, payload: { checkpoint: { schemaHash: HASH_A, value: "corrected" }, checkpointFingerprint: HASH_B } },
  { ...BASE_COMMAND, family: "run", type: "resolve-write-present", target: { ...RUN_TARGET, writeIntentId: UUID_4, intentGeneration: 1 }, payload: { proof: { schemaHash: HASH_A, value: "receipt-123" }, evidenceNote: "Confirmed in the target system" } },
  { ...BASE_COMMAND, family: "run", type: "resolve-write-absent", target: { ...RUN_TARGET, writeIntentId: UUID_4, intentGeneration: 1 }, payload: { evidenceNote: "Confirmed absent in the target system" } },
  { ...BASE_COMMAND, family: "gate", type: "resolve-gate", target: { runId: UUID_2, gateId: "identity-approval", expectedVersion: 1 }, payload: { result: { schemaHash: HASH_A, value: "approved" } } },
  { ...BASE_COMMAND, family: "notification", type: "notification-read", target: { notificationId: UUID_3, actorId: "local-operator", expectedVersion: 1 } },
  { ...BASE_COMMAND, family: "notification", type: "notification-unread", target: { notificationId: UUID_3, actorId: "local-operator", expectedVersion: 1 } },
  { ...BASE_COMMAND, family: "notification", type: "notification-snooze", target: { notificationId: UUID_3, actorId: "local-operator", expectedVersion: 1 }, payload: { until: LATER } },
  { ...BASE_COMMAND, family: "capture", type: "capture-upload", target: CAPTURE_TARGET, payload: { photoId: UUID_5, artifactId: UUID_6, contentFingerprint: HASH_A } },
  { ...BASE_COMMAND, family: "capture", type: "capture-replace", target: CAPTURE_TARGET, payload: { photoId: UUID_5, artifactId: UUID_6, contentFingerprint: HASH_A } },
  { ...BASE_COMMAND, family: "capture", type: "capture-reorder", target: CAPTURE_TARGET, payload: { orderedPhotoIds: [UUID_5, UUID_6] } },
  { ...BASE_COMMAND, family: "capture", type: "capture-delete", target: CAPTURE_TARGET, payload: { photoId: UUID_5 } },
  { ...BASE_COMMAND, family: "capture", type: "capture-finalize", target: CAPTURE_TARGET },
  { ...BASE_COMMAND, family: "capture", type: "capture-retry-finalize", target: CAPTURE_TARGET },
  { ...BASE_COMMAND, family: "capture", type: "capture-discard", target: CAPTURE_TARGET },
];

export const SUBJECT_EVIDENCE = {
  kind: "person",
  identifierKind: "eid",
  bindingDigest: HASH_A,
  displaySuffix: "1234",
};

export const SUBJECT_PROOF = {
  kind: "subject-match",
  version: 1,
  proofId: UUID_5,
  runId: UUID_2,
  attempt: 1,
  leaseId: UUID_6,
  taskId: "ucpath/terminate-person",
  observationId: "ucpath.termination.subject",
  pageStateId: "ucpath.termination-ready",
  expected: SUBJECT_EVIDENCE,
  observed: SUBJECT_EVIDENCE,
  match: "match",
  observedAt: NOW,
  afterPrepareSpanPath: "termination/prepare",
};
export const BINDING_PROOF_DIGEST = deriveWriteBindingProofDigest(SUBJECT_PROOF);

export const UNSCOPED_PROOF = {
  kind: "unscoped",
  version: 1,
  proofId: UUID_5,
  runId: UUID_2,
  attempt: 1,
  leaseId: UUID_6,
  taskId: "onbase/upload-document",
  pageStateId: "onbase.upload-ready",
  reviewedReasonId: "document-without-person-scope",
  observedAt: NOW,
  afterPrepareSpanPath: "upload/prepare",
};

export const ABSENCE_1 = {
  idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
  source: "ucpath.termination.search",
  sourceState: "ucpath.termination-results",
  observedAt: LATER,
  queryDigest: HASH_B,
  evidenceRef: `observation:${UUID_7}`,
};

export const ABSENCE_2 = {
  ...ABSENCE_1,
  observedAt: LATEST,
  evidenceRef: `observation:${UUID_8}`,
};

export const DEPENDENCY_RECORD = {
  dependencyId: UUID_1,
  manifestId: UUID_2,
  edgeId: "lookup-person",
  parentRunId: UUID_3,
  childRunId: UUID_4,
  childItemId: UUID_5,
  policy: {
    onChildFailed: "fail-parent",
    cascadeCancel: "cascade",
    afterChildRetry: "resume-parent",
    visibility: "inline",
  },
  state: "active",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

export const DELEGATION_MANIFEST = {
  manifestId: UUID_2,
  parentRunId: UUID_3,
  edgeId: "lookup-person",
  inputSchemaHash: HASH_A,
  resultSchemaHash: HASH_B,
  cardinality: "one",
  join: "one",
  policy: {
    onChildFailed: "fail-parent",
    cascadeCancel: "cascade",
    afterChildRetry: "resume-parent",
    visibility: "inline",
  },
  children: [{ dependencyId: UUID_1, childRunId: UUID_4, childItemId: UUID_5, canonicalInputFingerprint: HASH_C }],
  createdAt: NOW,
  manifestFingerprint: HASH_A,
};

export const GATE_RESULT = {
  runId: UUID_2,
  gateId: "identity-approval",
  commandId: UUID_1,
  expectedVersion: 1,
  resolvedBy: "local-operator",
  resolvedAt: NOW,
  checkpointFingerprint: HASH_B,
  result: { schemaHash: HASH_A, value: "approved" },
};

export const NOTIFICATION = {
  notificationId: UUID_3,
  actorId: "local-operator",
  dedupeFingerprint: HASH_A,
  trigger: "write-parked",
  channel: "ping",
  status: "unread",
  snooze: { state: "not-snoozed" },
  title: "Write needs review",
  summary: "A termination write could not be proven present or absent.",
  links: [{ kind: "run", runId: UUID_2 }],
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

export const CONFIG_SNAPSHOT = {
  configSnapshotId: UUID_1,
  revision: 1,
  fingerprint: HASH_A,
  capturedAt: NOW,
  capturedBy: "local-operator",
  config: ConfigSchema.parse({}),
  provenance: {},
};

export const WRITE_INTENT_ATTEMPTING = {
  writeIntentId: UUID_1,
  workflowId: "separation",
  itemId: UUID_3,
  taskId: "ucpath/terminate-person",
  system: "ucpath",
  idempotencyKey: IDEMPOTENCY_KEY,
  idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
  currentAttemptId: UUID_4,
  generation: 1,
  runId: UUID_2,
  runAttempt: 1,
  bindingProof: SUBJECT_PROOF,
  bindingProofDigest: BINDING_PROOF_DIGEST,
  fencedAt: NOW,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  status: "attempting",
};

export const WRITE_ATTEMPT = {
  writeAttemptId: UUID_4,
  writeIntentId: UUID_1,
  generation: 1,
  runId: UUID_2,
  runAttempt: 1,
  leaseId: UUID_6,
  bindingProof: SUBJECT_PROOF,
  bindingProofDigest: BINDING_PROOF_DIGEST,
  fencedAt: NOW,
  outcome: { state: "attempting" },
  recordedAt: NOW,
};

export const LEDGER_PAYLOAD = {
  workflowId: "separation",
  itemId: UUID_3,
  system: "ucpath",
  idempotencyKey: IDEMPOTENCY_KEY,
  idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
  writeIntentId: UUID_1,
  intentGeneration: 1,
  proof: { schemaHash: HASH_B, value: "T123456" },
  completionKind: "receipt",
  proofSource: "normal-output",
  bindingProofDigest: BINDING_PROOF_DIGEST,
  subject: { state: "present", value: SUBJECT_EVIDENCE },
  runId: UUID_2,
  traceId: "se-120000-2222",
  attempt: 1,
  operator: "local-operator",
  instance: "prod",
  configFingerprint: HASH_A,
  dryRun: false,
  fencedAt: NOW,
  confirmedAt: LATER,
  externalOccurredAt: { state: "absent" },
};

export const LEDGER_OUTBOX_PAYLOAD = { kind: "ledger-entry", entry: LEDGER_PAYLOAD };
export const COMMITTED_OUTCOME = {
  disposition: "committed",
  proofSource: "normal-output",
  proof: LEDGER_PAYLOAD.proof,
  output: { schemaHash: HASH_C, value: { transactionId: "T123456" } },
  confirmedAt: LATER,
};
export const SPAN_OUTBOX_PAYLOAD = {
  kind: "write-committed-span",
  writeIntentId: UUID_1,
  intentGeneration: 1,
  runId: UUID_2,
  traceId: "se-120000-2222",
  workflowId: "separation",
  itemId: UUID_3,
  attempt: 1,
  system: "ucpath",
  idempotencyKey: IDEMPOTENCY_KEY,
  idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
  bindingProofDigest: BINDING_PROOF_DIGEST,
  occurredAt: LATER,
  outcome: COMMITTED_OUTCOME,
};

export const LEDGER_OUTBOX_RECORD = {
  outboxId: UUID_7,
  aggregate: { kind: "write-intent", writeIntentId: UUID_1, generation: 1 },
  payload: LEDGER_OUTBOX_PAYLOAD,
  projection: { state: "pending" },
  createdAt: LATER,
};

export const SPAN_OUTBOX_RECORD = {
  outboxId: UUID_8,
  aggregate: { kind: "write-intent", writeIntentId: UUID_1, generation: 1 },
  payload: SPAN_OUTBOX_PAYLOAD,
  projection: { state: "pending" },
  createdAt: LATER,
};

export const ATOMIC_WRITE_COMMIT = {
  writeIntentId: UUID_1,
  generation: 1,
  completionProof: LEDGER_PAYLOAD.proof,
  confirmedAt: LATER,
  outcome: COMMITTED_OUTCOME,
  ledgerOutbox: LEDGER_OUTBOX_RECORD,
  terminalSpanOutbox: SPAN_OUTBOX_RECORD,
};
