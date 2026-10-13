
import { CONFIG_SNAPSHOT, HASH_A, HASH_C, LATER, NOW, UUID_2, UUID_3, UUID_5 } from "./phase1c-contract-fixtures.js";
import {
  deriveCanonicalInputDigest,
  derivePlannedInputFingerprint,
  PlannedRunSchema,
} from "../../../src/models/run/start-plan.js";


export function sequentialIdFactory(prefix = "a"): { readonly uuid: () => string; readonly minted: () => readonly string[] } {
  const minted: string[] = [];
  let next = 0;
  return {
    uuid: () => {
      next += 1;
      const tail = String(next).padStart(4, "0");
      const id = `${prefix.repeat(8)}-${tail}-4000-8000-${tail}${"0".repeat(8)}`;
      minted.push(id);
      return id;
    },
    minted: () => Object.freeze([...minted]),
  };
}

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
  configFingerprint: CONFIG_SNAPSHOT.fingerprint,
  configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
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
    protectedBindings: [],
    value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
  },
  ingressSchemaHash: HASH_A,
};

export const QUEUED_RUN = {
  envelope: RUN_ENVELOPE,
  input: RUN_INPUT,
  lifecycle: { state: "queued" },
  claimGeneration: 0,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const START_PLAN_INGRESS_SCHEMA_HASH = HASH_A;
const START_PLAN_CANONICAL_INPUT_SCHEMA_HASH = HASH_C;
const START_PLAN_PLANNED = PlannedRunSchema.array().parse([{
  itemId: ITEM_ID,
  title: "EID 10873698",
  rawInput: RUN_INPUT.raw,
  input: RUN_INPUT.parsed,
  canonicalInputDigest: deriveCanonicalInputDigest(RUN_INPUT.parsed.value),
  matchKey: "eid:10873698",
}]);

export const START_PLAN = {
  startPlanId: UUID_5,
  workflowId: WORKFLOW_ID,
  descriptorVersion: 1,
  descriptorFingerprint: HASH_A,
  configFingerprint: CONFIG_SNAPSHOT.fingerprint,
  configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
  ingressSchemaHash: START_PLAN_INGRESS_SCHEMA_HASH,
  canonicalInputSchemaHash: START_PLAN_CANONICAL_INPUT_SCHEMA_HASH,
  inputFingerprint: derivePlannedInputFingerprint(
    START_PLAN_PLANNED,
    START_PLAN_INGRESS_SCHEMA_HASH,
    START_PLAN_CANONICAL_INPUT_SCHEMA_HASH,
  ),
  resolvedInstance: { ucpath: "prod", crm: "prod" },
  shape: "single",
  priority: "bulk",
  dryRun: false,
  planned: START_PLAN_PLANNED,
  refused: [],
  plannedBy: "local-operator",
  plannedAt: NOW,
  expiresAt: LATER,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

export const WORKER_START_REQUEST = {
  workerId: WORKER_ID,
  workflow: WORKFLOW_ID,
  browserSystems: ["crm", "ucpath"],
  processId: 4242,
  requestedBy: "local-operator",
  now: NOW,
};


export const RUN_SESSION_ID = "99999999-9999-4999-8999-999999999999";
export const RUN_SESSION = {
  sessionId: RUN_SESSION_ID,
  workflow: WORKFLOW_ID,
  origin: { kind: "start-plan", startPlanId: UUID_5, actorId: "local-operator" },
  startedAt: NOW,
  createdAt: NOW,
} as const;
