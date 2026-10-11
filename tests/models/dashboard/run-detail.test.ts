import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema,QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { CaptureListSchema,RunCaptureArtifactWireSchema,RunDetailSectionResponseSchema,RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { failureDetailWireFixture,receiptWireFixture } from "../../support/helpers/trust/trust-wire-fixtures.js";

const RUN_1 = "11111111-1111-4111-8111-111111111111";
const RUN_2 = "22222222-2222-4222-8222-222222222222";
const ITEM_1 = "33333333-3333-4333-8333-333333333333";
const NOTE_1 = "44444444-4444-4444-8444-444444444444";
const RECORD_1 = "55555555-5555-4555-8555-555555555555";
const ARTIFACT_1 = "66666666-6666-4666-8666-666666666666";
const NOTIFICATION_1 = "77777777-7777-4777-8777-777777777777";
const FAILURE_1 = "99999999-9999-4999-8999-999999999999";
const SESSION_1 = "88888888-8888-4888-8888-888888888888";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-07-31T17:00:00.000Z";

const QUEUE = {
  runId: RUN_1,
  itemId: ITEM_1,
  workflowId: "onboarding",
  traceId: "on-120000-1111",
  attempt: 1,
  lineage: { state: "root" },
  actorId: "local-operator",
  appVersion: { state: "present", value: "1.0.0" },
  descriptorVersion: 1,
  descriptorHash: HASH_A,
  configFingerprint: HASH_B,
  resolvedInstances: [{ system: "ucpath", instance: "prod" }],
  dryRun: false,
priority: "interactive",
runNumber: { state: "present", value: 1 },
session: { state: "absent", reason: "This fixture has no run session." },
containment: "root",
linkedRuns: [],
facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
  startedAt: NOW,
  updatedAt: NOW,
  endedAt: { state: "absent", reason: "run is running" },
  gateOpenedAt: { state: "absent", reason: "run is running and is not waiting on a gate" },
  displayName: { state: "absent", reason: "the operator has not renamed this run" },
  title: "Onboard employee",
  subtitle: { state: "present", value: "EID ••••1234" },
  status: "running",
  liveMessage: { state: "present", value: "Searching UCPath" },
  warnings: { state: "absent", reason: "run is running and has not produced a terminal result" },
  pipeline: [{ id: "search", label: "Search", state: "active" }],
  panelKind: "run",
  availableSections: ["logs", "receipt", "context-data"],
  // The row's served controls, bound to `rowRevision` as their CAS target.
  actions: [
    {
      key: "cancel", label: "Cancel run", intent: "destructive", icon: "cancel",
      placement: ["footer", "menu"], kind: "command", command: "cancel", expectedVersion: 1,
      confirm: {
        title: "Cancel this run",
        body: "This stops the run where it is and settles it cancelled.",
        confirmLabel: "Cancel the run",
        tone: "destructive",
      },
    },
    {
      key: "rename", label: "Rename run\u2026", intent: "neutral", icon: "rename",
      placement: ["menu"], kind: "command", command: "rename", expectedVersion: 1,
    },
  ],
  rowRevision: 1,
  surfaceKind: "single",
};

const DAY = {
  day: "2026-07-31",
  descriptorHash: HASH_A,
  projectionGeneration: 1,
  snapshotCursor: "pc:1",
  monthCounts: [{ day: "2026-07-31", count: 1 }],
  workflowCounts: [{ workflowId: "onboarding", count: 1, statusCounts: [{ status: "running", count: 1 }] }],
  statusCounts: [{ status: "running", count: 1 }],
  queueSurfaces: [QUEUE],
  workerPools: [],
  workerCards: [{
    workerId: "ucpath-worker",
    workflowId: "onboarding",
    state: "working",
    directive: "run",
    startedAt: NOW,
    currentRun: { state: "present", runId: RUN_1, traceId: "on-120000-1111" },
    browsers: [{ sessionId: SESSION_1, system: "ucpath", openedAt: NOW }],
    leaseVersion: 3,
    revision: 1,
  }],
  notifications: [{ kind: "notification", channel: "inbox", count: 1, publicationId: "a".repeat(64), trigger: "verified-done", readState: "unread", notificationId: NOTIFICATION_1, actorId: "local-operator", severity: "info", title: "Run started", state: "unread", occurredAt: NOW, revision: 1, context: { state: "available", workflow: "Onboarding", subject: "Onboard employee" } }],
};

const DETAIL = {
  runId: RUN_1,
  rowRevision: 1,
  panelKind: "run",
  header: { runId: RUN_1, traceId: "on-120000-1111", workflowId: "onboarding", actorId: "local-operator", title: "Onboard employee", status: "running", attempt: 1 },
  timeline: { events: [{ noteId: NOTE_1, sequence: 0, at: NOW, label: "Started", state: "active", notRun: { state: "absent", reason: "this step ran" } }] },
  gate: { state: "absent", reason: "no gate is open" },
  outcome: { state: "absent", reason: "run is active" },
  context: { dataFacts: 2, evidenceFacts: 1, attempts: 1 },
  availableSections: ["logs", "receipt", "context-data"],
};

const NOTE_PAGE = {
  runId: RUN_1,
  notes: [{ noteId: NOTE_1, runId: RUN_1, sequence: 0, at: NOW, level: "info", message: "Started" }],
  nextCursor: { state: "absent", reason: "end-of-page" },
};
const REVIEW_PAGE = {
  runId: RUN_1,
  records: [{ recordId: RECORD_1, runId: RUN_1, recordRevision: 1, label: "Employee", state: "pending", evidence: [] }],
};
const PEOPLE_PAGE = {
  parentRunId: RUN_1,
  members: [{ runId: RUN_2, parentRunId: RUN_1, rowRevision: 1, label: "Employee", status: "queued" }],
  total: 1,
  nextCursor: { state: "absent", reason: "end-of-page" },
};
const ARTIFACT = {
  state: "available",
  value: {
    artifactId: ARTIFACT_1,
    sha256: HASH_A,
    byteLength: 100,
    sensitivity: "redacted",
    redaction: "applied",
    mediaKind: "image",
    mediaType: "image/png",
    width: 1280,
    height: 720,
  },
};


const WORKFLOW_PRIMITIVE = {
  id: "onboarding",
  code: "on",
  label: "Onboarding",
  categoryId: "onboarding",
  descriptorFingerprint: HASH_A,
  availability: { state: "available" },
  role: { kind: "standalone" },

  start: {
    summary: "Look one person up in UCPath and CRM.",
    enqueue: "reject-active",
    // Keep this non-1 so the wire fixture never makes a guessed default
    // appear equivalent to a producer-supplied descriptor version.
    version: 7,

    spreadsheetIntake: true,
    inputRun: {
      placeholder: "Enter EIDs or names, semicolon-separated",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [{ when: { kind: "otherwise" }, emit: "query" }],
      },
    },
    steps: [
      {
        key: "identity",
        label: "Identity",
        includedByDefault: true,
        control: { state: "required", reason: "Identity is required." },
      },
      {
        key: "crm-dates",
        label: "CRM Dates",
        includedByDefault: false,
        control: { state: "selectable", inputField: "includeCrmDates" },
      },
    ],
  },
};

const BOOTSTRAP = {
  wireVersion: 1,
  appVersion: "1.0.0",
  descriptorHash: HASH_A,
  settingsSchemaHash: HASH_B,
  protectedSchemaHash: HASH_A,
  projectionGeneration: 1,
  actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: NOW },
  workflows: [WORKFLOW_PRIMITIVE],
  systemInstances: [{ system: "ucpath", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "test URL not configured" } }],
  settingsSections: [{ id: "general", label: "General", revision: 1 }],
  featureAvailability: [{ feature: "ocr", availability: { state: "available" } }],
};

function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectPaths(value: unknown, path: readonly (string | number)[] = []): readonly (readonly (string | number)[])[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectPaths(item, [...path, index]));
  }
  if (!isPlainObject(value)) return [];
  return [path, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}

function addUnknownAt(value: unknown, target: readonly (string | number)[], depth = 0): unknown {
  if (depth === target.length) {
    if (!isPlainObject(value)) throw new Error("unknown-key target must be an object");
    return { ...value, unexpectedBoundaryKey: true };
  }
  const segment = target[depth];
  if (typeof segment === "number") {
    if (!Array.isArray(value)) throw new Error("unknown-key path expected an array");
    return Array.from(value, (child: unknown, index) => (
      index === segment ? addUnknownAt(child, target, depth + 1) : child
    ));
  }
  if (!isPlainObject(value)) throw new Error("unknown-key path expected an object");
  return Object.fromEntries(Object.entries(value).map(([key, child]) => (
    key === segment ? [key, addUnknownAt(child, target, depth + 1)] : [key, child]
  )));
}

function assertRecursivelyStrict(schema: { safeParse(input: unknown): { success: boolean } }, fixture: unknown): void {
  assert.equal(schema.safeParse(fixture).success, true);
  for (const path of objectPaths(fixture)) {
    assert.equal(schema.safeParse(addUnknownAt(fixture, path)).success, false, `accepted unknown key at ${path.join(".") || "root"}`);
  }
}

describe("dashboard wire primitives", () => {
  it("parses recursively strict bootstrap, day, and detail resources", () => {
    assertRecursivelyStrict(FrontendBootstrapWireSchema, BOOTSTRAP);
    assertRecursivelyStrict(DashboardDayWireSchema, DAY);
    assertRecursivelyStrict(RunDetailWireSchema, DETAIL);
  });

  it("keeps version, fingerprint, generation, revision, cursor, and identities distinct", () => {
    assert.equal(FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, wireVersion: 2 }).success, false);
    assert.equal(FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, projectionGeneration: 0 }).success, false);
    assert.equal(FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, descriptorHash: BOOTSTRAP.appVersion }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, rowRevision: 1.5 }).success, false);
    for (const cursor of [1, "1", "pc:0", "pc:-1", "pc:1.5", "cursor:1"]) {
      assert.equal(DashboardDayWireSchema.safeParse({ ...DAY, snapshotCursor: cursor }).success, false, String(cursor));
    }
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, runId: RUN_2 }).success, false);
  });

  it("rejects incompatible panel sections, open terminal gates, and duplicate detail identities", () => {
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, availableSections: [...DETAIL.availableSections, "review"] }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, panelKind: "review", availableSections: ["review", "people"] }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, panelKind: "group", availableSections: ["people", "review"] }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({
      ...DETAIL,
      gate: { state: "open", gateId: NOTE_1, label: "Approve", openedAt: NOW, revision: 1 },
      outcome: { state: "terminal", result: "verified-done", completedAt: NOW },
    }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({
      ...DETAIL,
      timeline: { events: [...DETAIL.timeline.events, DETAIL.timeline.events[0]] },
    }).success, false);
  });

  it("a replayed step names the checkpoint it replayed, and measures nothing", () => {
    const stepped = (member: unknown) => ({
      ...DETAIL,
      timeline: { ...DETAIL.timeline, steps: [{ label: "Kronos timecard", state: "replayed", members: [member] }] },
    });
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", replayedFrom: { attempt: 8, claimGeneration: 2 } }),
    ).success, true);

    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", replayedFrom: { attempt: 8 } }),
    ).success, true);
    // Replayed with no source is a claim with no citation.
    assert.equal(RunDetailWireSchema.safeParse(stepped({ label: "Timecard", state: "replayed" })).success, false);
    // A source on anything else says a step both ran and did not.
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "done", replayedFrom: { attempt: 8 } }),
    ).success, false);
    // `took 0s` is exactly the sentence this arm exists to delete.
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", durationSec: 0, replayedFrom: { attempt: 8 } }),
    ).success, false);
  });
});

describe("lazy detail and artifact resources", () => {
  it("correlates every lazy section with a closed payload", () => {
    const sections = [
      { section: "logs", payload: NOTE_PAGE },

      { section: "receipt", payload: { state: "available", value: receiptWireFixture() } },
      { section: "review", payload: REVIEW_PAGE },
      { section: "people", payload: PEOPLE_PAGE },
      {
        section: "context-data",
        payload: {
          runId: RUN_1,
          state: "available",
          entries: [
            {
              label: "EID",
              valueRedacted: "••••1234",
              coordinate: { nodeId: "crm-dates", fieldPath: "emplId" },
              checkpoint: {
                state: "present", runId: RUN_1, attempt: 1, claimGeneration: 1,
                descriptorVersion: 1, contractFingerprint: HASH_A, schemaHash: HASH_B, writtenAt: NOW,
              },
              valueState: "present",
            },
            {
              label: "Starts on",
              valueRedacted: "Not recorded for this run",
              coordinate: { nodeId: "crm-dates", fieldPath: "startsOn.value" },
              checkpoint: { state: "absent", reason: "no-checkpoint-for-run" },
              valueState: "absent",
            },
          ],
        },
      },
      { section: "context-evidence", payload: { runId: RUN_1, entries: [] } },
      { section: "context-attempts", payload: { runId: RUN_1, entries: [] } },
      { section: "failure", payload: { state: "available", value: failureDetailWireFixture({
        runId: RUN_1, failureId: FAILURE_1, traceId: "on-120000-1111", workflowId: "onboarding",
      }) } },
      { section: "captures", payload: { runId: RUN_1, artifacts: [{ artifact: ARTIFACT.value,
        origins: [{ bundleId: RECORD_1, originKind: "operator-request" }] }] } },
    ];
    for (const section of sections) assert.equal(RunDetailSectionResponseSchema.safeParse(section).success, true, section.section);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "logs", payload: REVIEW_PAGE }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "review", payload: { ...REVIEW_PAGE, records: [...REVIEW_PAGE.records, REVIEW_PAGE.records[0]] } }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "people", payload: { ...PEOPLE_PAGE, members: [...PEOPLE_PAGE.members, PEOPLE_PAGE.members[0]], total: 2 } }).success, false);
  });

  it("requires strict nonempty unique capture memberships and identical bundle kinds across tiles", () => {
    const capture = { artifact: ARTIFACT.value, origins: [{ bundleId: RECORD_1, originKind: "failure" }] };
    assertRecursivelyStrict(RunCaptureArtifactWireSchema, capture);
    assert.equal(RunCaptureArtifactWireSchema.safeParse({ ...capture, origins: [] }).success, false);
    assert.equal(RunCaptureArtifactWireSchema.safeParse({ artifact: ARTIFACT.value }).success, false);
    assert.equal(RunCaptureArtifactWireSchema.safeParse({ ...capture, origins: [...capture.origins, ...capture.origins] }).success, false);
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [] }).success, false);
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [capture, capture] }).success, false);
    const other = { artifact: { ...ARTIFACT.value, artifactId: RUN_2 }, origins: [{ bundleId: RECORD_1, originKind: "operator-request" }] };
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [capture, other] }).success, false);
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [capture, { ...other, origins: capture.origins }] }).success, true);
  });
});
