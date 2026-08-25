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
import { archiveRetention } from "../../../src/domain/archive/retention.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH, uuidOf } from "./fixture-day.js";

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
    // Both copied off ARCHIVED_ROW above, byte for byte — the index entry is a
    // copy of the frozen row's own fields, so a fixture that disagreed with the
    // row would photograph a state production cannot produce.
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
    // Charter §25's change record: the WHY the reference set had no way to
    // photograph before, with the commit half taking its PRESENT arm here and
    // the plan below taking the absent one.
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
        kind: "minor",
        what: "Person Lookup's CRM cross-check tolerates a middle initial",
        why: "three subjects a week were parking on a name mismatch that was not one",
        commit: { state: "absent", reason: "authored from the dashboard before the change was tagged" },
      },
    },
    plannedBy: "local-operator",
    plannedAt: at(90),
    state: "planned",
  }],
});

/**
 * D223's frozen sections, carried by a generation-3 record (D242 added the
 * frozen short code beside the frozen label) — the payloads the
 * five tabs render. The corpus photographs the range on purpose: log lines at
 * two levels, data entries dated by both a live and a derived observation, a
 * member row, an attempt history with a REAL retry in it (attempt 1 failed a
 * step, attempt 2 settled), and a described capture tile — the tile is what
 * makes the Evidence tab a tab rather than a list of ids.
 */
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
      editing: { state: "locked", reason: "an archived run is read-only; there is nothing to resume a correction into" },
      entries: [
        {
          label: "Employee ID",
          valueRedacted: "108*****",
          edit: { state: "locked", reason: "an archived run is read-only" },
          observedAt: at(4),
          source: "live",
        },
        {
          label: "Department",
          valueRedacted: "Supply Chain Services",
          edit: { state: "locked", reason: "an archived run is read-only" },
          observedAt: at(12),
          source: "derived",
        },
      ],
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
  // The pointers above, resolved. This run filed nothing, so there is nothing
  // to resolve — an empty list here is the same fact as an empty pointer list,
  // never a resolution that silently dropped a row.
  ledger: [],
  // Computed by the SAME domain function the server calls, off this fixture's
  // own row — a hand-authored retention block would let the reference drift
  // from the policy it is meant to photograph.
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
  // The whole-report completion split the headline tile reads, equal by
  // construction to the two rows' columns below — the schema refuses the
  // fixture outright if they ever part company.
  completion: { readBack: 5, warnings: 1, warningsUnknown: 1 },
  workflows: [
    {
      workflowId: "person-lookup",
      registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" },
      runs: 9,
      completion: { readBack: 5, warnings: 1, warningsUnknown: 0 },
      failed: 1, cancelled: 0, partial: 0, open: 2,
    },
    // The honest half: a workflow whose descriptor was retired still ran, and
    // the report names it rather than inventing a label from its id. Its one
    // `done` run has no derived receipt, so it lands in the unread column —
    // the reference photographs an amber cell rather than a clean-looking 1.
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
    // The Who sample: two RUNNING runs, one of which the day payload holds a
    // row for and one of which it does not — so the reference photographs the
    // resolved name AND the honest fallback beside it, which is the pair a
    // screenshot of only-resolvable ids would never catch.
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
  /**
   * D236's second authority. Two systems, and the load-bearing half is the
   * amber one: `kuali` filed a TEST-instance entry, which the reference
   * photographs tinted, and a corpus where every entry was production would
   * never catch a surface that dropped the tint.
   */
  ledger: {
    systems: [
      { system: "ucpath", entries: 6, prod: 6, test: 0 },
      { system: "kuali", entries: 3, prod: 2, test: 1 },
    ],
  },
});

export const FIXTURE_ARCHIVED_RUN_ID = ARCHIVED_RUN_ID;
