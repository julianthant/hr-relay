import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArtifactRefWireSchema, ArtifactResourceWireSchema, CapturePointerWireSchema } from "../../src/domain/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../src/domain/dashboard/bootstrap.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../src/domain/dashboard/projection.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../src/domain/dashboard/run-detail.js";
import {
  DashboardStreamEnvelopeSchema,
  DashboardTopicPatchSchema,
  DashboardTopicSnapshotSchema,
} from "../../src/domain/dashboard/subscription.js";
import { failureDetailWireFixture, receiptWireFixture } from "./fixtures/trust-wire-fixtures.js";

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
session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
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
  notifications: [{ notificationId: NOTIFICATION_1, actorId: "local-operator", severity: "info", title: "Run started", state: "unread", occurredAt: NOW, revision: 1 }],
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

/** One served workflow entry, including D219's required `role` fact. */
const WORKFLOW_PRIMITIVE = {
  id: "onboarding",
  code: "on",
  label: "Onboarding",
  categoryId: "onboarding",
  descriptorFingerprint: HASH_A,
  availability: { state: "available" },
  role: { kind: "standalone" },
  // D264/D11 — the served start block. It carries the typed-input door on
  // purpose: the strict-boundary arm below walks whatever this literal reaches,
  // so an inputRun-less primitive would leave `InputRunSurfaceSchema` and its
  // parser spec unwalked by the very test that exists to walk them.
  start: {
    summary: "Look one person up in UCPath and CRM.",
    enqueue: "reject-active",
    // C96: keep this non-1 so the wire fixture never makes a guessed default
    // appear equivalent to a producer-supplied descriptor version.
    version: 7,
    inputRun: {
      placeholder: "Enter EIDs or names, semicolon-separated",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [{ when: { kind: "otherwise" }, emit: "query" }],
      },
    },
  },
};

const BOOTSTRAP = {
  wireVersion: 1,
  appVersion: "1.0.0",
  descriptorHash: HASH_A,
  settingsSchemaHash: HASH_B,
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

  /**
   * A served control's CAS target is the row it rides. The two arms below are
   * the whole reason `actions[]` is refined rather than merely typed: a
   * descriptor projected against another revision is a control that conflicts
   * on click for a reason the operator cannot see, and two descriptors sharing
   * a `key` collapse into one control in both surfaces that render them.
   */
  it("binds every served action to the row's own revision, once per key", () => {
    const [cancel, hide] = QUEUE.actions;
    assert.ok(cancel !== undefined && hide !== undefined);

    assert.equal(
      QueueSurfaceWireSchema.safeParse({
        ...QUEUE,
        actions: [{ ...cancel, expectedVersion: 2 }, hide],
      }).success,
      false,
      "accepted an action whose expectedVersion is not the row's rowRevision",
    );
    assert.equal(
      QueueSurfaceWireSchema.safeParse({ ...QUEUE, rowRevision: 2 }).success,
      false,
      "accepted a bumped rowRevision while every action still named the old one",
    );
    assert.equal(
      QueueSurfaceWireSchema.safeParse({ ...QUEUE, actions: [cancel, { ...hide, key: "cancel" }] }).success,
      false,
      "accepted two served actions sharing one key",
    );
    // The empty list is a real answer, never a refusal: it says this row's
    // workflow enables no command the kernel would accept in this lifecycle.
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, actions: [] }).success, true);
  });

  /**
   * D219 — a chunk harness is a step of its composition, and the wire refuses
   * to describe a nesting the receiving surface could not draw.
   */
  it("refuses a served chunk harness whose composition is not in the same document", () => {
    const composition = {
      ...WORKFLOW_PRIMITIVE,
      id: "separations",
      code: "se",
      label: "Separations",
      role: { kind: "composition" },
    };
    const harness = {
      ...WORKFLOW_PRIMITIVE,
      id: "separations-kuali-read",
      code: "sk",
      label: "Separations — Kuali read",
      role: { kind: "chunk-harness", of: "separations", step: "kuali-extraction" },
    };
    // Both served: the harness's parent is right there, so it parses.
    assert.equal(
      FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, workflows: [composition, harness] }).success,
      true,
    );
    // The parent is missing entirely — a dangling `of`.
    const dangling = FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, workflows: [harness] });
    assert.equal(dangling.success, false);
    assert.match(
      JSON.stringify(dangling.error?.issues ?? []),
      /separations-kuali-read is served as a chunk harness of separations/,
    );
    // The parent is served, but is not a composition.
    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...composition, role: { kind: "standalone" } }, harness],
      }).success,
      false,
    );
    // And the union itself is closed: no fourth kind, and `of` only on the arm
    // that owns it.
    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...WORKFLOW_PRIMITIVE, role: { kind: "sub-workflow" } }],
      }).success,
      false,
    );
    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...WORKFLOW_PRIMITIVE, role: { kind: "standalone", of: "separations" } }],
      }).success,
      false,
    );
  });

  it("keeps queue surfaces flat and operation-only membership coherent", () => {
    assert.equal(QueueSurfaceWireSchema.safeParse(QUEUE).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, surfaceKind: "preview" }).success, true);
    const member = {
      ...QUEUE,
      surfaceKind: "member",
      containment: "member",
      lineage: { state: "child", parentRunId: RUN_2 },
    };
    assert.equal(QueueSurfaceWireSchema.safeParse(member).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, surfaceKind: "member" }).success, false);
    /*
     * Containment, lineage and surface kind are three views of one fact, and
     * the schema refuses every way they can disagree. The load-bearing arm is
     * the second: a row that called itself a member while presenting as a
     * single run would be counted twice — once in its parent's rollup and once
     * in the day's totals — because `surfaceKind` is what the count filter
     * reads and `containment` is what the layout reads.
     */
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...member, containment: "root" }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, containment: "member" }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, containment: "linked" }).success, false);
    // A linked child keeps its own single row: parented, and NOT counted.
    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...QUEUE, containment: "linked", lineage: { state: "child", parentRunId: RUN_2 },
    }).success, true);
    // A row may not chip itself, nor name one target twice.
    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...QUEUE,
      linkedRuns: [{ runId: RUN_1, workflowId: "onboarding", label: "Onboarding", panelKind: "run", status: "running" }],
    }).success, false);
    const chip = { runId: RUN_2, workflowId: "onboarding", label: "Onboarding", panelKind: "run", status: "running" };
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, linkedRuns: [chip] }).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, linkedRuns: [chip, chip] }).success, false);
    const operation = {
      ...QUEUE,
      surfaceKind: "operation",
      panelKind: "group",
      availableSections: ["people", "logs", "receipt"],
      memberRunIds: [RUN_2],
      memberRollup: { total: 1, terminal: 0, failed: 0 },
      memberPreview: { state: "present", value: "Ada Lovelace" },
    };
    assert.equal(QueueSurfaceWireSchema.safeParse(operation).success, true);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, memberRunIds: [RUN_2] }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...operation, memberRunIds: [RUN_2, RUN_2], memberRollup: { total: 2, terminal: 0, failed: 0 } }).success, false);
    assert.equal(JSON.stringify(operation).includes("members\":"), false);
    assert.equal(JSON.stringify(DAY).includes("notes\":"), false);
    assert.equal(JSON.stringify(DAY).includes("bytes\":"), false);
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

  it("D259 — a replayed step names the checkpoint it replayed, and measures nothing", () => {
    const stepped = (member: unknown) => ({
      ...DETAIL,
      timeline: { ...DETAIL.timeline, steps: [{ label: "Kronos timecard", state: "replayed", members: [member] }] },
    });
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", replayedFrom: { attempt: 8, claimGeneration: 2 } }),
    ).success, true);
    // A pre-D214 checkpoint names no execution, and the wire must not invent one.
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
      // D140/D142: both sections carry CONTENT now, not a pointer. The
      // receipt is the real builder's output so this stays honest when its
      // shape moves; the failure is the strict, already-redacted projection.
      { section: "receipt", payload: { state: "available", value: receiptWireFixture() } },
      { section: "review", payload: REVIEW_PAGE },
      { section: "people", payload: PEOPLE_PAGE },
      {
        section: "context-data",
        payload: {
          runId: RUN_1,
          editing: { state: "editable", expectedVersion: 3 },
          entries: [
            {
              label: "EID",
              valueRedacted: "••••1234",
              edit: { state: "locked", reason: "not declared correctable by this workflow" },
            },
            {
              label: "Starts on",
              valueRedacted: "2026-07-15",
              edit: {
                state: "editable",
                nodeId: "crm-dates",
                fieldPath: "startsOn.value",
                value: "2026-07-15",
                pendingCorrection: {
                  state: "pending",
                  value: "2026-07-16",
                  correctedAt: "2026-08-03T17:00:00.000Z",
                },
              },
            },
          ],
        },
      },
      { section: "context-evidence", payload: { runId: RUN_1, entries: [] } },
      { section: "context-attempts", payload: { runId: RUN_1, entries: [] } },
      { section: "failure", payload: { state: "available", value: failureDetailWireFixture({
        runId: RUN_1, failureId: FAILURE_1, traceId: "on-120000-1111", workflowId: "onboarding",
      }) } },
      { section: "captures", payload: { runId: RUN_1, artifacts: [ARTIFACT] } },
    ];
    for (const section of sections) assert.equal(RunDetailSectionResponseSchema.safeParse(section).success, true, section.section);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "logs", payload: REVIEW_PAGE }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "review", payload: { ...REVIEW_PAGE, records: [...REVIEW_PAGE.records, REVIEW_PAGE.records[0]] } }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "people", payload: { ...PEOPLE_PAGE, members: [...PEOPLE_PAGE.members, PEOPLE_PAGE.members[0]], total: 2 } }).success, false);
  });

  it("requires opaque content-addressed artifact metadata and explicit missing states", () => {
    assertRecursivelyStrict(ArtifactResourceWireSchema, ARTIFACT);
    const pdf = { ...ARTIFACT.value, mediaKind: "pdf", mediaType: "application/pdf", pageCount: 2 };
    const data = { ...ARTIFACT.value, mediaKind: "data", mediaType: "application/json" };
    assert.equal(ArtifactRefWireSchema.safeParse(pdf).success, false, "image dimensions are forbidden on PDF refs");
    const pdfWithoutImageDimensions = Object.fromEntries(Object.entries(pdf).filter(([key]) => key !== "width" && key !== "height"));
    const dataWithoutImageDimensions = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "width" && key !== "height"));
    assert.equal(ArtifactRefWireSchema.safeParse(pdfWithoutImageDimensions).success, true);
    assert.equal(ArtifactRefWireSchema.safeParse(dataWithoutImageDimensions).success, true);
    for (const resource of [
      { state: "missing", artifactId: ARTIFACT_1, reason: "not found" },
      { state: "purged", artifactId: ARTIFACT_1, reason: "retention expired" },
      { state: "error", artifactId: ARTIFACT_1, code: "ARTIFACT_READ_FAILED", message: "read failed", retryable: true },
    ]) assert.equal(ArtifactResourceWireSchema.safeParse(resource).success, true);
    assert.equal(ArtifactResourceWireSchema.safeParse({ state: "missing", artifactId: ARTIFACT_1, reason: "gone", path: "/tmp/secret" }).success, false);
    assert.equal(ArtifactResourceWireSchema.safeParse({ state: "available", value: { ...ARTIFACT.value, sha256: undefined } }).success, false);
    assert.equal(CapturePointerWireSchema.safeParse({ artifactId: ARTIFACT_1, dimensions: { state: "present", width: 100, height: 200 } }).success, true);
    assert.equal(CapturePointerWireSchema.safeParse({ artifactId: ARTIFACT_1, dimensions: { state: "missing", reason: "legacy capture had no geometry" } }).success, true);
    assert.equal(CapturePointerWireSchema.safeParse({ artifactId: ARTIFACT_1, dimensions: { state: "present" } }).success, false);
  });
});

describe("subscription snapshots, patches, and resets", () => {
  const snapshots = [
    { topic: "dashboard-day", payload: DAY },
    { topic: "run-detail", payload: DETAIL },
    { topic: "run-logs", payload: NOTE_PAGE },
    { topic: "run-review", payload: REVIEW_PAGE },
    { topic: "run-people", payload: PEOPLE_PAGE },
    { topic: "artifact", payload: ARTIFACT },
  ];
  const patches = [
    { topic: "dashboard-day", payload: { operation: "replace-queue-surface", target: { runId: RUN_1, rowRevision: 1 }, replacement: QUEUE } },
    { topic: "run-detail", payload: { operation: "replace-run-detail", target: { runId: RUN_1, rowRevision: 1 }, replacement: DETAIL } },
    { topic: "run-logs", payload: { operation: "append-note", target: { runId: RUN_1, noteId: NOTE_1 }, note: NOTE_PAGE.notes[0] } },
    { topic: "run-review", payload: { operation: "replace-review-record", target: { recordId: RECORD_1, recordRevision: 1 }, replacement: REVIEW_PAGE.records[0] } },
    { topic: "run-people", payload: { operation: "replace-person", target: { runId: RUN_2, rowRevision: 1 }, replacement: PEOPLE_PAGE.members[0] } },
    { topic: "artifact", payload: { operation: "replace-artifact-resource", target: { artifactId: ARTIFACT_1 }, replacement: ARTIFACT } },
  ];

  it("parses every correlated snapshot and patch arm", () => {
    for (const snapshot of snapshots) {
      assert.equal(DashboardTopicSnapshotSchema.safeParse(snapshot).success, true, snapshot.topic);
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot }).success, true, snapshot.topic);
    }
    for (const patch of patches) {
      assert.equal(DashboardTopicPatchSchema.safeParse(patch).success, true, patch.topic);
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", cursor: "pc:2", ...patch }).success, true, patch.topic);
    }
    const hello = { type: "hello", wireVersion: 1, descriptorHash: HASH_A, projectionGeneration: 1, cursor: "pc:2" };
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(hello).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(hello).success, true, "duplicate cursor delivery remains representable and idempotent");
    for (const reason of ["cursor-expired", "generation-changed", "descriptor-changed"]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason, cursor: "pc:2" }).success, true);
    }
    for (const state of ["live", "reconnecting", "degraded"]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "health", state }).success, true);
    }
  });

  it("rejects topic/payload mismatches, wrong arms, and identity/revision drift", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "run-detail", cursor: "pc:2", payload: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", topic: "run-detail", cursor: "pc:2", payload: snapshots[1]?.payload }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason: "silent-drop", cursor: "pc:2" }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "dashboard-day", payload: DAY }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[0],
      payload: { operation: "replace-queue-surface", target: { runId: RUN_2, rowRevision: 1 }, replacement: QUEUE },
    }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[3],
      payload: { operation: "replace-review-record", target: { recordId: RECORD_1, recordRevision: 2 }, replacement: REVIEW_PAGE.records[0] },
    }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[2],
      payload: { operation: "append-note", target: { runId: RUN_2, noteId: NOTE_1 }, note: NOTE_PAGE.notes[0] },
    }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[0],
      payload: { ...patches[0]?.payload, update: { runId: RUN_2 } },
    }).success, false);
  });
});
