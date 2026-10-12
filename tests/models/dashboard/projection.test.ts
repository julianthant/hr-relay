import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { isTerminalQueueStatus } from "../../../src/models/dashboard/projection.js";

{

const RUN_1 = "11111111-1111-4111-8111-111111111111";
const RUN_2 = "22222222-2222-4222-8222-222222222222";
const ITEM_1 = "33333333-3333-4333-8333-333333333333";
const NOTIFICATION_1 = "77777777-7777-4777-8777-777777777777";
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

describe("dashboard wire primitives", () => {

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


    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, actions: [] }).success, true);
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

    assert.equal(QueueSurfaceWireSchema.safeParse({ ...member, containment: "root" }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, containment: "member" }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, containment: "linked" }).success, false);

    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...QUEUE, containment: "linked", lineage: { state: "child", parentRunId: RUN_2 },
    }).success, true);

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
});
}

{

describe("queue row timing", () => {

  it("refuses a status that is not part of the served queue vocabulary", () => {
    assert.throws(() => isTerminalQueueStatus("finished"));
  });
});
}
