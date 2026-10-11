import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { QueueSurfaceWireSchema as QueueSurfaceWireSchema_m0 } from "../../../src/models/dashboard/projection.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { isTerminalQueueStatus as isTerminalQueueStatus_m1 } from "../../../src/models/dashboard/projection.js";


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

describe_m0("dashboard wire primitives", () => {


  it_m0("binds every served action to the row's own revision, once per key", () => {
    const [cancel, hide] = QUEUE.actions;
    assert_m0.ok(cancel !== undefined && hide !== undefined);

    assert_m0.equal(
      QueueSurfaceWireSchema_m0.safeParse({
        ...QUEUE,
        actions: [{ ...cancel, expectedVersion: 2 }, hide],
      }).success,
      false,
      "accepted an action whose expectedVersion is not the row's rowRevision",
    );
    assert_m0.equal(
      QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, rowRevision: 2 }).success,
      false,
      "accepted a bumped rowRevision while every action still named the old one",
    );
    assert_m0.equal(
      QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, actions: [cancel, { ...hide, key: "cancel" }] }).success,
      false,
      "accepted two served actions sharing one key",
    );
    // The empty list is a real answer, never a refusal: it says this row's
    // workflow enables no command the kernel would accept in this lifecycle.
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, actions: [] }).success, true);
  });

  it_m0("keeps queue surfaces flat and operation-only membership coherent", () => {
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse(QUEUE).success, true);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, surfaceKind: "preview" }).success, true);
    const member = {
      ...QUEUE,
      surfaceKind: "member",
      containment: "member",
      lineage: { state: "child", parentRunId: RUN_2 },
    };
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse(member).success, true);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, surfaceKind: "member" }).success, false);

    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...member, containment: "root" }).success, false);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, containment: "member" }).success, false);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, containment: "linked" }).success, false);
    // A linked child keeps its own single row: parented, and NOT counted.
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({
      ...QUEUE, containment: "linked", lineage: { state: "child", parentRunId: RUN_2 },
    }).success, true);
    // A row may not chip itself, nor name one target twice.
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({
      ...QUEUE,
      linkedRuns: [{ runId: RUN_1, workflowId: "onboarding", label: "Onboarding", panelKind: "run", status: "running" }],
    }).success, false);
    const chip = { runId: RUN_2, workflowId: "onboarding", label: "Onboarding", panelKind: "run", status: "running" };
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, linkedRuns: [chip] }).success, true);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, linkedRuns: [chip, chip] }).success, false);
    const operation = {
      ...QUEUE,
      surfaceKind: "operation",
      panelKind: "group",
      availableSections: ["people", "logs", "receipt"],
      memberRunIds: [RUN_2],
      memberRollup: { total: 1, terminal: 0, failed: 0 },
      memberPreview: { state: "present", value: "Ada Lovelace" },
    };
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse(operation).success, true);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...QUEUE, memberRunIds: [RUN_2] }).success, false);
    assert_m0.equal(QueueSurfaceWireSchema_m0.safeParse({ ...operation, memberRunIds: [RUN_2, RUN_2], memberRollup: { total: 2, terminal: 0, failed: 0 } }).success, false);
    assert_m0.equal(JSON.stringify(operation).includes("members\":"), false);
    assert_m0.equal(JSON.stringify(DAY).includes("notes\":"), false);
    assert_m0.equal(JSON.stringify(DAY).includes("bytes\":"), false);
  });
});
}

{


describe_m1("queue row timing", () => {

  it_m1("refuses a status that is not part of the served queue vocabulary", () => {
    assert_m1.throws(() => isTerminalQueueStatus_m1("finished"));
  });
});
}
