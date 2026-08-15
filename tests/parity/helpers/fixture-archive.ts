/**
 * The Archive and Activity fixtures (2i-G, D179/D180).
 *
 * These are hand-authored and then PARSED through the production wire schemas,
 * which is the opposite of `fixture-explorer.ts` and deliberately so: the
 * explorer's payload is derived from the live registry, so building it any
 * other way would let the fixture disagree with the projection. An archived
 * run is the opposite kind of value — it is a FROZEN artefact of a bump that
 * already happened, so the honest fixture is a stored record, and the schema
 * parse is what stops it drifting from the shape authority holds.
 *
 * The corpus deliberately carries both halves of every union the surface can
 * render: a stamped app build and an unstamped one, a receipt present and
 * absent, a workflow with archivable runs and one with a BLOCKER, and a plan
 * that is reviewable but would be refused. A reference set that only ever
 * photographed the happy path would not be a test of a refusal surface.
 */
import {
  ActivityReportWireSchema,
  type ActivityReportWire,
} from "../../../src/domain/dashboard/activity.js";
import {
  ArchiveIndexWireSchema,
  ArchivedRunDetailWireSchema,
  type ArchiveIndexWire,
  type ArchivedRunDetailWire,
} from "../../../src/domain/dashboard/archive.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./fixture-day.js";

const PRIOR_HASH = "b".repeat(64);
const PLAN_FINGERPRINT = "c".repeat(64);
const CHANGE_FINGERPRINT = "d".repeat(64);
const ARCHIVED_RUN_ID = "aa11bb22-0001-4000-8000-aa11bb220001";
const BLOCKED_RUN_ID = "aa11bb22-0002-4000-8000-aa11bb220002";
const SWEEP_ID = "aa11bb22-0003-4000-8000-aa11bb220003";
const PLAN_ID = "aa11bb22-0004-4000-8000-aa11bb220004";
const ARCHIVE_DIGEST = "e".repeat(64);
const NOTE_ID = "aa11bb22-0005-4000-8000-aa11bb220005";

const at = (minute: number): string =>
  `${FIXTURE_DAY}T${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00.000Z`;

const ARCHIVED_ROW = {
  runId: ARCHIVED_RUN_ID,
  itemId: "aa11bb22-0009-4000-8000-aa11bb220009",
  workflowId: "person-lookup",
  traceId: "pl-090400-aa11",
  attempt: 1,
  lineage: { state: "root" },
  actorId: "local-operator",
  appVersion: { state: "present", value: "0.0.9" },
  descriptorVersion: 1,
  descriptorHash: PRIOR_HASH,
  configFingerprint: PRIOR_HASH,
  resolvedInstances: [{ system: "ucpath", instance: "prod" }],
  dryRun: false,
  startedAt: at(4),
  updatedAt: at(21),
  endedAt: { state: "present", value: at(21) },
  gateOpenedAt: { state: "absent", reason: "run is done and is not waiting on a gate" },
  displayName: { state: "absent", reason: "the operator has not renamed this run" },
  title: "EID 10873698",
  subtitle: { state: "absent", reason: "the start plan proposed no subtitle" },
  status: "done",
  liveMessage: { state: "absent", reason: "an archived run has no live message" },
  warnings: { state: "absent", reason: "this run's evidence receipt records no warning" },
  pipeline: [
    { id: "ucpath-person", label: "ucpath-person", state: "done" },
    { id: "cross-verify", label: "cross-verify", state: "done" },
  ],
  panelKind: "run",
  availableSections: ["logs"],
  /*
   * EMPTY by the archive's own contract: the frozen row is the last row the
   * operator saw and D179's archived tables abort UPDATE and DELETE in SQL, so
   * there is no command a control here could send. Relaunch is served from the
   * ARCHIVED detail, which is not a live run row.
   */
  actions: [],
  rowRevision: 6,
  surfaceKind: "single",
};

const ARCHIVED_DETAIL = {
  runId: ARCHIVED_RUN_ID,
  rowRevision: 6,
  panelKind: "run",
  header: {
    runId: ARCHIVED_RUN_ID,
    traceId: "pl-090400-aa11",
    workflowId: "person-lookup",
    actorId: "local-operator",
    title: "EID 10873698",
    status: "done",
    attempt: 1,
  },
  timeline: {
    events: [
      {
        noteId: NOTE_ID,
        sequence: 0,
        at: at(4),
        label: "UCPath person read",
        state: "done",
        notRun: { state: "absent", reason: "the step ran" },
      },
      {
        noteId: "aa11bb22-0006-4000-8000-aa11bb220006",
        sequence: 1,
        at: at(21),
        label: "Cross verification",
        state: "done",
        notRun: { state: "absent", reason: "the step ran" },
      },
    ],
  },
  gate: { state: "absent", reason: "this workflow declares no gate" },
  outcome: { state: "terminal", result: "verified-done", completedAt: at(21) },
  context: { dataFacts: 7, evidenceFacts: 2, attempts: 1 },
  availableSections: ["logs"],
};

export const FIXTURE_ARCHIVE_INDEX: ArchiveIndexWire = ArchiveIndexWireSchema.parse({
  wireVersion: 1,
  archiveSchemaGeneration: 1,
  generatedAt: at(120),
  currentAppVersion: FIXTURE_APP_VERSION,
  entries: [{
    runId: ARCHIVED_RUN_ID,
    traceId: "pl-090400-aa11",
    workflowId: "person-lookup",
    workflowLabel: "Person Lookup",
    title: "EID 10873698",
    status: "done",
    archivedIdentity: { workflowId: "person-lookup", descriptorVersion: 1, contractFingerprint: PRIOR_HASH },
    appVersion: { state: "present", value: "0.0.9" },
    drift: ["descriptor-version", "contract-fingerprint"],
    startedAt: at(4),
    endedAt: { state: "present", value: at(21) },
    archivedAt: at(60),
    applicationId: SWEEP_ID,
    // The SAME value the frozen row carries — the index copies it, never
    // re-derives it, so the two surfaces cannot name different instances.
    resolvedInstances: [{ system: "ucpath", instance: "prod" }],
    archiveFingerprint: ARCHIVE_DIGEST,
  }],
  sweeps: [{
    applicationId: SWEEP_ID,
    versionPlanId: "aa11bb22-0007-4000-8000-aa11bb220007",
    scope: { kind: "workflows", workflowIds: ["person-lookup"] },
    targetVersion: "0.1.0",
    appliedAppVersion: FIXTURE_APP_VERSION,
    appliedIdentities: [
      { workflowId: "person-lookup", descriptorVersion: 2, contractFingerprint: FIXTURE_DESCRIPTOR_HASH },
    ],
    appliedBy: "local-operator",
    appliedAt: at(60),
    archivedCount: 1,
  }],
  versionState: [{
    workflowId: "person-lookup",
    workflowLabel: "Person Lookup",
    current: { workflowId: "person-lookup", descriptorVersion: 2, contractFingerprint: FIXTURE_DESCRIPTOR_HASH },
    archivable: 0,
    // The load-bearing half of the corpus: a parked write that a bump must
    // refuse to bury, photographed in the reference set rather than described.
    blockers: [{
      runId: BLOCKED_RUN_ID,
      traceId: "pl-091200-aa22",
      workflowId: "person-lookup",
      runState: "parked-write",
      title: "EID 10456712",
      enqueuedAt: at(12),
      drift: ["descriptor-version"],
    }],
  }],
  plans: [{
    versionPlanId: PLAN_ID,
    expectedVersion: 1,
    planFingerprint: PLAN_FINGERPRINT,
    scope: { kind: "workflows", workflowIds: ["person-lookup"] },
    targetVersion: "0.2.0",
    changeFingerprint: CHANGE_FINGERPRINT,
    observedAppVersion: FIXTURE_APP_VERSION,
    observedIdentities: [
      { workflowId: "person-lookup", descriptorVersion: 2, contractFingerprint: FIXTURE_DESCRIPTOR_HASH },
    ],
    candidates: [],
    blockers: [{
      runId: BLOCKED_RUN_ID,
      traceId: "pl-091200-aa22",
      workflowId: "person-lookup",
      runState: "parked-write",
      title: "EID 10456712",
      enqueuedAt: at(12),
      drift: ["descriptor-version"],
    }],
    plannedBy: "local-operator",
    plannedAt: at(90),
    state: "planned",
  }],
});

export const FIXTURE_ARCHIVED_RUN: ArchivedRunDetailWire = ArchivedRunDetailWireSchema.parse({
  wireVersion: 1,
  archiveSchemaGeneration: 1,
  runId: ARCHIVED_RUN_ID,
  applicationId: SWEEP_ID,
  workflowId: "person-lookup",
  workflowLabel: "Person Lookup",
  archivedIdentity: { workflowId: "person-lookup", descriptorVersion: 1, contractFingerprint: PRIOR_HASH },
  appVersion: { state: "present", value: "0.0.9" },
  drift: ["descriptor-version", "contract-fingerprint"],
  archivedAt: at(60),
  archivedBy: "local-operator",
  archiveFingerprint: ARCHIVE_DIGEST,
  row: ARCHIVED_ROW,
  detail: ARCHIVED_DETAIL,
  receipt: { state: "absent", reason: "this run settled before receipts were derived" },
  failure: { state: "absent", reason: "the run did not settle with a structured failure" },
  evidence: {
    artifactIds: [],
    checkpointNodeIds: ["ucpath-person", "cross-verify"],
    writeIntentIds: [],
    ledgerPartitions: [],
  },
  relaunches: [],
  relaunch: {
    state: "available",
    current: { workflowId: "person-lookup", descriptorVersion: 2, contractFingerprint: FIXTURE_DESCRIPTOR_HASH },
  },
});

export const FIXTURE_ACTIVITY_RANGE = { from: "2026-07-01", to: FIXTURE_DAY } as const;

export const FIXTURE_ACTIVITY_REPORT: ActivityReportWire = ActivityReportWireSchema.parse({
  wireVersion: 1,
  from: FIXTURE_ACTIVITY_RANGE.from,
  to: FIXTURE_ACTIVITY_RANGE.to,
  generatedAt: at(120),
  totalRuns: 12,
  terminalRuns: 10,
  inFlightRuns: 2,
  days: [
    { day: "2026-07-29", runs: 3 },
    { day: "2026-07-30", runs: 4 },
    { day: FIXTURE_DAY, runs: 5 },
  ],
  workflows: [
    {
      workflowId: "person-lookup",
      registration: { state: "registered", label: "Person Lookup", categoryId: "people" },
      runs: 9,
    },
    // The honest half: a workflow whose descriptor was retired still ran, and
    // the report names it rather than inventing a label from its id.
    {
      workflowId: "retired-workflow",
      registration: {
        state: "unregistered",
        reason: "workflow retired-workflow is no longer registered; its label and category are unavailable",
      },
      runs: 3,
    },
  ],
  categories: [
    { category: { state: "registered", categoryId: "people" }, runs: 9 },
    {
      category: { state: "unregistered", reason: "the workflows behind these runs are no longer registered" },
      runs: 3,
    },
  ],
  statuses: [
    { status: "done", runs: 7 },
    { status: "failed", runs: 2 },
    { status: "running", runs: 2 },
    { status: "cancelled", runs: 1 },
  ],
  outcomes: [
    { outcome: "done", runs: 7 },
    { outcome: "failed", runs: 2 },
    { outcome: "cancelled", runs: 1 },
  ],
  failures: [
    { code: "SESSION_LOST", runs: 1, transient: 1, sample: [ARCHIVED_RUN_ID] },
    { code: "SUBJECT_MISMATCH", runs: 1, transient: 0, sample: [BLOCKED_RUN_ID] },
  ],
  durations: {
    measuredRuns: 9,
    unmeasuredRuns: 1,
    medianMs: { state: "present", value: 874_000 },
    longestMs: { state: "present", value: 1_632_000, runId: ARCHIVED_RUN_ID },
    totalMs: 8_431_000,
  },
});

export const FIXTURE_ARCHIVED_RUN_ID = ARCHIVED_RUN_ID;
