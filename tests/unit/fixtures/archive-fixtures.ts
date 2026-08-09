/**
 * Shared archive fixtures (D179).
 *
 * Every value here is parsed through the PRODUCTION schema and every digest is
 * computed by the PRODUCTION function, so a fixture cannot drift into a shape
 * authority would refuse — the archive's whole argument is that the stored
 * bytes are the record, and a hand-written approximation of them would be the
 * one thing the tests must never assert against.
 */
import {
  archivedRunContentDigest,
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  ArchiveRelaunchRecordSchema,
  versionBumpPlanFingerprint,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
  type ArchivedRunRecord,
  type ArchiveRelaunchRecord,
  type VersionBumpApplication,
  type VersionBumpPlan,
} from "../../../src/domain/archive/model.js";
import { VersionPlanStorageRecordSchema } from "../../../src/infra/sqlite/storage-records.js";
import { HASH_A, HASH_B, HASH_C, NOW, UUID_1, UUID_5, UUID_6, UUID_7 } from "./phase1c-contract-fixtures.js";
import { ITEM_ID, RUN_ID, RUN_INPUT, TRACE_ID, WORKFLOW_ID } from "./phase1f-run-fixtures.js";

export const ARCHIVE_APPLICATION_ID = UUID_6;
export const ARCHIVE_PLAN_ID = UUID_7;
/** The FRESH run a relaunch mints — never the archived run's own identity. */
export const RELAUNCHED_RUN_ID = UUID_5;

const CURRENT_IDENTITY = {
  workflowId: WORKFLOW_ID,
  descriptorVersion: 2,
  contractFingerprint: HASH_B,
};

export const VERSION_BUMP_PLAN: VersionBumpPlan = VersionBumpPlanSchema.parse({
  archiveSchemaGeneration: 1,
  versionPlanId: ARCHIVE_PLAN_ID,
  scope: { kind: "workflows", workflowIds: [WORKFLOW_ID] },
  targetVersion: "0.2.0",
  changeFingerprint: HASH_C,
  observedAppVersion: "0.1.0",
  observedIdentities: [CURRENT_IDENTITY],
  candidates: [{
    runId: RUN_ID,
    traceId: TRACE_ID,
    workflowId: WORKFLOW_ID,
    title: "EID 10873698",
    enqueuedAt: NOW,
    drift: ["descriptor-version", "contract-fingerprint"],
  }],
  blockers: [],
  plannedBy: "local-operator",
  plannedAt: NOW,
});

export const VERSION_PLAN_ROW = VersionPlanStorageRecordSchema.parse({
  versionPlanId: ARCHIVE_PLAN_ID,
  version: 1,
  planFingerprint: versionBumpPlanFingerprint(VERSION_BUMP_PLAN),
  state: "planned",
  plan: VERSION_BUMP_PLAN,
  createdAt: NOW,
});

export const VERSION_BUMP_APPLICATION: VersionBumpApplication = VersionBumpApplicationSchema.parse({
  archiveSchemaGeneration: 1,
  applicationId: ARCHIVE_APPLICATION_ID,
  versionPlanId: ARCHIVE_PLAN_ID,
  scope: { kind: "workflows", workflowIds: [WORKFLOW_ID] },
  targetVersion: "0.2.0",
  changeFingerprint: HASH_C,
  appliedAppVersion: "0.1.0",
  appliedIdentities: [CURRENT_IDENTITY],
  archivedRunIds: [RUN_ID],
  appliedBy: "local-operator",
  appliedAt: NOW,
});

const ARCHIVED_ROW = {
  runId: RUN_ID,
  itemId: ITEM_ID,
  workflowId: WORKFLOW_ID,
  traceId: TRACE_ID,
  attempt: 1,
  lineage: { state: "root" },
  actorId: "local-operator",
  appVersion: { state: "present", value: "0.1.0" },
  descriptorVersion: 1,
  descriptorHash: HASH_A,
  configFingerprint: HASH_B,
  resolvedInstances: [{ system: "ucpath", instance: "prod" }],
  startedAt: NOW,
  updatedAt: NOW,
  endedAt: { state: "present", value: NOW },
  title: "EID 10873698",
  subtitle: { state: "absent", reason: "the start plan proposed no subtitle" },
  status: "done",
  liveMessage: { state: "absent", reason: "an archived run has no live message" },
  pipeline: [{ id: "ucpath-person", label: "ucpath-person", state: "done" }],
  panelKind: "run",
  availableSections: ["logs"],
  rowRevision: 4,
  surfaceKind: "single",
};

const ARCHIVED_DETAIL = {
  runId: RUN_ID,
  rowRevision: 4,
  panelKind: "run",
  header: {
    runId: RUN_ID,
    traceId: TRACE_ID,
    workflowId: WORKFLOW_ID,
    actorId: "local-operator",
    title: "EID 10873698",
    status: "done",
    attempt: 1,
  },
  timeline: {
    events: [{
      noteId: UUID_1,
      sequence: 0,
      at: NOW,
      label: "UCPath person read",
      state: "done",
      notRun: { state: "absent", reason: "the step ran" },
    }],
  },
  gate: { state: "absent", reason: "this workflow declares no gate" },
  outcome: { state: "terminal", result: "verified-done", completedAt: NOW },
  context: { dataFacts: 4, evidenceFacts: 1, attempts: 1 },
  availableSections: ["logs"],
};

const ARCHIVED_CONTENT = ArchivedRunContentSchema.parse({
  archiveSchemaGeneration: 1,
  runId: RUN_ID,
  applicationId: ARCHIVE_APPLICATION_ID,
  workflowId: WORKFLOW_ID,
  traceId: TRACE_ID,
  archivedIdentity: { workflowId: WORKFLOW_ID, descriptorVersion: 1, contractFingerprint: HASH_A },
  appVersion: { state: "present", value: "0.1.0" },
  drift: ["descriptor-version", "contract-fingerprint"],
  archivedAt: NOW,
  archivedBy: "local-operator",
  row: ARCHIVED_ROW,
  detail: ARCHIVED_DETAIL,
  receipt: { state: "absent", reason: "this run settled before receipts were derived" },
  failure: { state: "absent", reason: "the run did not fail" },
  evidence: { artifactIds: [], checkpointNodeIds: ["ucpath-person"], writeIntentIds: [], ledgerPartitions: [] },
  input: RUN_INPUT,
});

export const ARCHIVED_RUN: ArchivedRunRecord = ArchivedRunRecordSchema.parse({
  ...ARCHIVED_CONTENT,
  contentDigest: archivedRunContentDigest(ARCHIVED_CONTENT),
});

export const ARCHIVE_RELAUNCH: ArchiveRelaunchRecord = ArchiveRelaunchRecordSchema.parse({
  archiveSchemaGeneration: 1,
  runId: RELAUNCHED_RUN_ID,
  archivedRunId: RUN_ID,
  relaunchedIdentity: CURRENT_IDENTITY,
  relaunchedBy: "local-operator",
  relaunchedAt: NOW,
});
