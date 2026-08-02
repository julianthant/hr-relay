/**
 * Shared run/worker fixtures for the 1f claim store.
 *
 * These are deliberately the *minimum* legal shapes: a queued first-attempt run
 * and a worker-start request. Every test that needs a claimed, parked, or
 * terminal row derives it by driving the real repository, so no test can assert
 * against a state the production transitions cannot actually produce.
 */
import { HASH_A, HASH_B, HASH_C, NOW, UUID_2, UUID_3, UUID_4 } from "./phase1c-contract-fixtures.js";

export const RUN_ID = UUID_2;
export const ITEM_ID = UUID_3;
export const TRACE_ID = "pl-170000-2222";
export const WORKFLOW_ID = "person-lookup";
export const WORKER_ID = "worker-1";

export const RUN_ENVELOPE = {
  runId: RUN_ID,
  workflow: WORKFLOW_ID,
  itemId: ITEM_ID,
  traceId: TRACE_ID,
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
  resolvedInstance: { ucpath: "prod", crm: "prod" },
  configFingerprint: HASH_B,
  configSnapshotId: UUID_4,
  shape: "single",
  priority: "bulk",
  dryRun: false,
  attempt: 1,
  enqueuedAt: NOW,
};

export const RUN_INPUT = {
  raw: { emplId: "10873698" },
  parsed: {
    schemaHash: HASH_C,
    value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
  },
  ingressSchemaHash: HASH_A,
};

export const QUEUED_RUN = {
  envelope: RUN_ENVELOPE,
  input: RUN_INPUT,
  lifecycle: { state: "queued" },
  claimGeneration: 0,
  hidden: false,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

export const WORKER_START_REQUEST = {
  workerId: WORKER_ID,
  workflow: WORKFLOW_ID,
  processId: 4242,
  requestedBy: "local-operator",
  now: NOW,
};
