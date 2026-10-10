
import { archiveRetention } from "../../../src/models/archive/retention.js";
import {
ActivityReportWireSchema,
type ActivityReportWire,
} from "../../../src/models/dashboard/activity.js";
import {
ActivityVolumeSchema,
buildActivityVolumeBoundarySkeleton,
createActivityDatePartReader,
} from "../../../src/models/dashboard/activity-volume.js";
import {
ArchiveIndexWireSchema,
ArchivedRunDetailWireSchema,
type ArchiveIndexWire,
type ArchivedRunDetailWire,
} from "../../../src/models/dashboard/archive.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH,uuidOf } from "./fixture-identity.js";

const PRIOR_HASH = "b".repeat(64);
const PLAN_FINGERPRINT = "c".repeat(64);
const CHANGE_FINGERPRINT = "d".repeat(64);
const ARCHIVED_RUN_ID = "aa11bb22-0001-4000-8000-aa11bb220001";
const BLOCKED_RUN_ID = "aa11bb22-0002-4000-8000-aa11bb220002";
const SWEEP_ID = "aa11bb22-0003-4000-8000-aa11bb220003";
const PLAN_ID = "aa11bb22-0004-4000-8000-aa11bb220004";
const ARCHIVE_DIGEST = "e".repeat(64);
const NOTE_ID = "aa11bb22-0005-4000-8000-aa11bb220005";
const CAPTURE_ARTIFACT_ID = "aa11bb22-000a-4000-8000-aa11bb22000a";
const CAPTURE_BUNDLE_ID = "aa11bb22-000b-4000-8000-aa11bb22000b";
const MEMBER_RUN_ID = "aa11bb22-000c-4000-8000-aa11bb22000c";

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
priority: "interactive",
runNumber: { state: "present", value: 1 },
session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
containment: "root",
linkedRuns: [],
facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
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
  archiveSchemaGeneration: 3,
  generatedAt: at(120),
  currentAppVersion: FIXTURE_APP_VERSION,
  entries: [{
    runId: ARCHIVED_RUN_ID,
    traceId: "pl-090400-aa11",
    workflowId: "person-lookup",
    workflowLabel: "Person Lookup",
    workflowCode: { state: "present", value: "pl" },
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

    dryRun: false,
    warnings: { state: "absent", reason: "this run's evidence receipt records no warning" },
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

    changeRecord: {
      state: "present",
      value: {
        kind: "major",
        what: "Person Lookup now reads the empl record beside the name",
        why: "a two-job subject resolved the wrong employment row, so the step's output shape changed",
        commit: { state: "present", value: "9f2c41d" },
      },
    },
    fromVersions: [1],
  }],
  versionState: [{
    workflowId: "person-lookup",
    workflowLabel: "Person Lookup",
    workflowCode: "pl",
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

    changeRecord: {
      state: "present",
      value: {
        kind: "major",
        what: "Person Lookup's CRM cross-check moved its subject match onto a canonical name field",
        why: "the old descriptor cannot express the canonical field, so its runs cannot be rendered by the new one",
        commit: { state: "absent", reason: "authored from the dashboard before the change was tagged" },
      },
    },
    plannedBy: "local-operator",
    plannedAt: at(90),
    state: "planned",
  }],
});


const ARCHIVED_SECTIONS = {
  logs: {
    state: "present",
    value: {
      runId: ARCHIVED_RUN_ID,
      notes: [
        { noteId: NOTE_ID, runId: ARCHIVED_RUN_ID, sequence: 0, at: at(4), level: "info", message: "UCPath person read started" },
        {
          noteId: "aa11bb22-000d-4000-8000-aa11bb22000d",
          runId: ARCHIVED_RUN_ID,
          sequence: 1,
          at: at(12),
          level: "warning",
          message: "CRM session was replaced after a dead-session probe",
        },
        {
          noteId: "aa11bb22-000e-4000-8000-aa11bb22000e",
          runId: ARCHIVED_RUN_ID,
          sequence: 2,
          at: at(21),
          level: "info",
          message: "Cross verification agreed on both identifiers",
        },
      ],
      nextCursor: { state: "absent", reason: "end-of-page" },
    },
  },
  data: {
    state: "present",
    value: {
      runId: ARCHIVED_RUN_ID,
      state: "unavailable",
      reason: "descriptor-mismatch",
      entries: [],
    },
  },
  people: {
    state: "present",
    value: {
      parentRunId: ARCHIVED_RUN_ID,
      members: [{
        runId: MEMBER_RUN_ID,
        parentRunId: ARCHIVED_RUN_ID,
        rowRevision: 4,
        label: "EID 10873698",
        status: "done",
      }],
      total: 1,
      nextCursor: { state: "absent", reason: "end-of-page" },
    },
  },
  attempts: {
    state: "present",
    value: [
      {
        attempt: 1,
        steps: 2,
        startedAt: { state: "present", value: at(4) },
        endedAt: { state: "present", value: at(11) },
        outcomes: [{ outcome: "done", count: 1 }, { outcome: "failed", count: 1 }],
        unfinished: 0,
      },
      {
        attempt: 2,
        steps: 2,
        startedAt: { state: "present", value: at(12) },
        endedAt: { state: "present", value: at(21) },
        outcomes: [{ outcome: "done", count: 2 }],
        unfinished: 0,
      },
    ],
  },
  captures: {
    state: "present",
    value: [{
      artifactId: CAPTURE_ARTIFACT_ID,
      bundleId: CAPTURE_BUNDLE_ID,
      kind: "screenshot",
      mediaType: "image/png",
      byteLength: 184_320,
      digest: "f".repeat(64),
      sensitivity: "redacted",
      capturedAt: at(11),
      origin: "failure",
      dimensions: { width: 1440, height: 900 },
      step: { state: "present", nodeId: "cross-verify" },
      system: { state: "present", value: "crm" },
      retention: { kind: "ordinary", purgeAfter: "2026-09-02T09:11:00.000Z" },
    }],
  },
} as const;

export const FIXTURE_ARCHIVED_RUN: ArchivedRunDetailWire = ArchivedRunDetailWireSchema.parse({
  wireVersion: 1,
  archiveSchemaGeneration: 3,
  runId: ARCHIVED_RUN_ID,
  applicationId: SWEEP_ID,
  workflowId: "person-lookup",
  workflowLabel: "Person Lookup",
  workflowCode: { state: "present", value: "pl" },
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
    artifactIds: [CAPTURE_ARTIFACT_ID],
    checkpointNodeIds: ["ucpath-person", "cross-verify"],
    writeIntentIds: [],
    ledgerPartitions: [],
  },
  sections: { state: "present", value: ARCHIVED_SECTIONS },

  ledger: [],

  retention: archiveRetention({
    now: at(120),
    endedAt: { state: "present", value: at(21) },
    pointerCounts: { artifacts: 1, checkpoints: 2, writeIntents: 0, ledgerLines: 0 },
  }),
  relaunches: [],
  relaunch: {
    state: "available",
    current: { workflowId: "person-lookup", descriptorVersion: 2, contractFingerprint: FIXTURE_DESCRIPTOR_HASH },
  },
});

export const FIXTURE_ACTIVITY_RANGE = { from: "2026-07-01", to: FIXTURE_DAY } as const;
export const FIXTURE_ACTIVITY_UNAVAILABLE_RANGE = { from: "2026-07-02", to: FIXTURE_DAY } as const;
const FIXTURE_ACTIVITY_TIME_ZONE = "America/Los_Angeles";
const FIXTURE_ACTIVITY_DAYS = [
  { day: "2026-07-29", runs: 3 },
  { day: "2026-07-30", runs: 4 },
  { day: FIXTURE_DAY, runs: 5 },
] as const;

function fixtureActivityVolume(range: { from: string; to: string }, days: readonly { day: string; runs: number }[]) {
  const boundary = buildActivityVolumeBoundarySkeleton(range, FIXTURE_ACTIVITY_TIME_ZONE);
  const datePart = createActivityDatePartReader(FIXTURE_ACTIVITY_TIME_ZONE);
  const coveredRuns = days.reduce((total, day) => total + day.runs, 0);
  return ActivityVolumeSchema.parse({
    state: "complete",
    ...boundary,
    coveredRuns,
    // This synthetic report assigns counts to three known calendar dates. Fold those counts into
    // real report-zone intervals; do not invent per-run instants for the chart.
    buckets: boundary.buckets.map((bucket) => {
      const startDay = datePart(bucket.start);
      const endDay = datePart(bucket.endExclusive);
      const runs = days.reduce((total, day) => total + (day.day >= startDay && day.day < endDay ? day.runs : 0), 0);
      return { ...bucket, runs };
    }),
  });
}

export const FIXTURE_ACTIVITY_REPORT: ActivityReportWire = ActivityReportWireSchema.parse({
  wireVersion: 1,
  from: FIXTURE_ACTIVITY_RANGE.from,
  to: FIXTURE_ACTIVITY_RANGE.to,
  generatedAt: at(120),
  totalRuns: 12,
  terminalRuns: 10,
  inFlightRuns: 2,

  people: { state: "present", distinct: 8, evidenceRows: 12 },
  days: FIXTURE_ACTIVITY_DAYS,
  volume: fixtureActivityVolume(FIXTURE_ACTIVITY_RANGE, FIXTURE_ACTIVITY_DAYS),

  completion: { readBack: 5, warnings: 1, warningsUnknown: 1 },
  workflows: [
    {
      workflowId: "person-lookup",
      registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" },
      runs: 9,
      completion: { readBack: 5, warnings: 1, warningsUnknown: 0 },
      failed: 1, cancelled: 0, partial: 0, open: 2,
    },

    {
      workflowId: "retired-workflow",
      registration: {
        state: "unregistered",
        reason: "workflow retired-workflow is no longer registered; its label and category are unavailable",
      },
      runs: 3,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 1 },
      failed: 1, cancelled: 1, partial: 0, open: 0,
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
    { status: "done", runs: 7, sample: [] },
    { status: "failed", runs: 2, sample: [] },

    { status: "running", runs: 2, sample: [uuidOf(20), ARCHIVED_RUN_ID] },
    { status: "cancelled", runs: 1, sample: [] },
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

  ledger: {
    systems: [
      { system: "ucpath", entries: 6, prod: 6, test: 0 },
      { system: "kuali", entries: 3, prod: 2, test: 1 },
    ],
  },
});


export const FIXTURE_ACTIVITY_UNAVAILABLE_REPORT: ActivityReportWire = ActivityReportWireSchema.parse({
  ...FIXTURE_ACTIVITY_REPORT,
  from: FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from,
  to: FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to,
  volume: fixtureActivityVolume(FIXTURE_ACTIVITY_UNAVAILABLE_RANGE, FIXTURE_ACTIVITY_DAYS),
  people: {
    state: "absent",
    evidenceRows: 12,
    unavailableRows: 0,
    reason: "current run/member rows lack validated canonical identity; distinct people is unavailable",
  },
});

export const FIXTURE_ARCHIVED_RUN_ID = ARCHIVED_RUN_ID;

import { SavedArchiveReportWireSchema,SavedVersionIndexWireSchema } from "../../../src/models/dashboard/archive.js";
/** V's generic H baseline is authored independently of live descriptors and Queue shapes. */
export const FIXTURE_SAVED_REPORT = SavedArchiveReportWireSchema.parse({ state: "available", runId: ARCHIVED_RUN_ID,
  title: "Synthetic saved lookup", workflow: "retired-synthetic-workflow", descriptorVersion: "1", outcome: "done",
  completedAt: at(21), capturedAt: at(25), archiveFingerprint: ARCHIVE_DIGEST,
  sections: [
    { kind: "values", title: "Saved facts", values: [{ label: "Subject", value: "Synthetic person" }, { label: "Result", value: "Verified" }, { label: "Unrecorded fact", value: null }] },
    { kind: "table", title: "Saved work", columns: ["Step", "Outcome"], rows: [["Lookup", "Completed"], ["Cross-check", "Completed"]] },
    { kind: "text", title: "Historical note", text: "Saved before this workflow was retired. Readable without current workflow registration." },
    { kind: "unavailable", title: "Unretained evidence", reason: "No additional evidence was retained." },
  ], files: [{ digest: PRIOR_HASH, byteLength: 28, mediaType: "text/yaml", name: "Synthetic attachment", artifactIds: [CAPTURE_ARTIFACT_ID] }],
});
export const FIXTURE_SAVED_VERSIONS = SavedVersionIndexWireSchema.parse({ appVersion: FIXTURE_APP_VERSION,
  workflows: [{ workflow: "person-lookup", label: "Person lookup", version: 2, fingerprint: FIXTURE_DESCRIPTOR_HASH }],
  changes: [], historicalChanges: 1 });
