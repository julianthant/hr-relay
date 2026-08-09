/**
 * The deterministic parity fixture corpus (doc 13 §7.2, test-only adapter #1).
 *
 * Every exported value is CONSTRUCTED by parsing through the owning strict
 * wire schema at module init — a fixture that drifts from a contract fails
 * loudly at import time, never silently at render time. The corpus covers the
 * doc 13 §7.1 reference matrix for the 1i Person Lookup slice: all eight
 * queue statuses across the three row types, operation groups at member
 * counts 1/3/4/12/13, run/member/group panel kinds, open-gate / failed /
 * running / terminal / empty detail states, start-plan planned+refused, and
 * command applied/conflict/rejected results.
 */
import { z } from "zod";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import {
  FrontendBootstrapWireSchema,
  type FrontendBootstrapWire,
} from "../../../src/domain/dashboard/bootstrap.js";
import {
  DashboardDayWireSchema,
  type DashboardDayWire,
  type QueueSurfaceWire,
} from "../../../src/domain/dashboard/projection.js";
import {
  NotePageSchema,
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../../src/domain/dashboard/run-detail.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import {
  StartPlanResponseSchema,
  type StartPlanResponse,
} from "../../../src/dashboard/client/commands.js";

/* ── identity helpers (aligned with tests/unit/server/helpers/dashboard-harness.ts) ── */

export function uuidOf(seed: number): string {
  const digits = String(seed).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
}

export function traceOf(seed: number): string {
  const tick = String(seed % 60).padStart(2, "0");
  return `pl-09${tick}${tick}-${String(seed % 10000).padStart(4, "0")}`;
}

export const FIXTURE_DAY = "2026-08-03";
/** The pinned browser clock for parity captures — everything below is in its past. */
export const FIXTURE_NOW = "2026-08-03T10:05:00.000-07:00";
export const FIXTURE_APP_VERSION = "0.1.0";

const CONTRACT_FINGERPRINT = personLookupDescriptor.contractFingerprint;
export const FIXTURE_DESCRIPTOR_HASH = descriptorSetHash([CONTRACT_FINGERPRINT]);
const CONFIG_FINGERPRINT = "b".repeat(64);
const WORKFLOW_ID = personLookupDescriptor.id;

const at = (minute: number, second = 0): string =>
  `2026-08-03T09:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000-07:00`;

/* ── queue surfaces ──────────────────────────────────────────────────────── */

type PipelineState = "pending" | "active" | "done" | "failed" | "skipped" | "blocked";
type Status = QueueSurfaceWire["status"];

const PIPELINE_NODES = [
  ["searching", "searching"],
  ["cross-verify", "Cross Verification"],
  ["active-status", "Active Status"],
  ["crm-dates", "CRM Dates"],
] as const;

function pipeline(states: readonly [PipelineState, PipelineState, PipelineState, PipelineState]) {
  return PIPELINE_NODES.map(([id, label], index) => ({ id, label, state: states[index] }));
}

interface SurfaceSeed {
  readonly seed: number;
  readonly status: Status;
  readonly title: string;
  readonly surfaceKind?: "single" | "preview" | "member" | "operation";
  readonly parentSeed?: number;
  readonly subtitle?: string | { absent: string };
  readonly liveMessage?: string | { absent: string };
  readonly pipeline?: readonly [PipelineState, PipelineState, PipelineState, PipelineState];
  readonly startedMinute?: number;
  readonly memberSeeds?: readonly number[];
  readonly memberStatuses?: readonly Status[];
}

const TERMINAL: ReadonlySet<Status> = new Set(["done", "failed", "cancelled", "partial"]);

function present(value: string) {
  return { state: "present", value } as const;
}
function absent(reason: string) {
  return { state: "absent", reason } as const;
}

function surfaceOf(input: SurfaceSeed): Record<string, unknown> {
  const kind = input.surfaceKind ?? "single";
  const startedMinute = input.startedMinute ?? 40;
  // Different per row, and clamped so the fixture instants stay inside the
  // authored 09:xx hour rather than rolling into an unparseable minute.
  const settledMinute = Math.min(startedMinute + 2 + (input.seed % 5), 59);
  const subtitle = input.subtitle === undefined
    ? present("person lookup")
    : typeof input.subtitle === "string"
      ? present(input.subtitle)
      : absent(input.subtitle.absent);
  const liveMessage = input.liveMessage === undefined
    ? absent("no live message is being emitted")
    : typeof input.liveMessage === "string"
      ? present(input.liveMessage)
      : absent(input.liveMessage.absent);
  const base = {
    runId: uuidOf(input.seed),
    itemId: uuidOf(input.seed + 5000),
    workflowId: WORKFLOW_ID,
    traceId: traceOf(input.seed),
    attempt: 1,
    lineage: input.parentSeed === undefined
      ? { state: "root" }
      : { state: "child", parentRunId: uuidOf(input.parentSeed) },
    actorId: "local-operator",
    // D179: the row carries the build the RUN was enqueued under. The corpus
    // pins one stamped row and one unstamped one so both arms of the union are
    // photographed — a run from before the stamp existed is a real state.
    appVersion: input.seed === 4
      ? { state: "absent", reason: "enqueued before runs stamped their app build (D179)" }
      : { state: "present", value: FIXTURE_APP_VERSION },
    descriptorVersion: 1,
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    configFingerprint: CONFIG_FINGERPRINT,
    resolvedInstances: [
      { system: "ucpath", instance: "prod" },
      { system: "crm", instance: "prod" },
    ],
    startedAt: at(startedMinute),
    // D124: a settled run carries its own terminal instant, so the row can
    // show what it TOOK instead of counting since it started, and the
    // terminal-authority contract makes `updatedAt` that same instant. The
    // durations deliberately DIFFER per row — a corpus where every finished
    // run took the same time would render identically whether the row read
    // `endedAt` or any other constant. An in-flight row states the absence
    // and why, and may not carry a terminal instant at all.
    updatedAt: at(settledMinute),
    endedAt: TERMINAL.has(input.status)
      ? { state: "present", value: at(settledMinute) }
      : { state: "absent", reason: `run is ${input.status} and has not ended` },
    title: input.title,
    subtitle,
    status: input.status,
    liveMessage,
    pipeline: pipeline(input.pipeline ?? ["pending", "pending", "pending", "pending"]),
    panelKind: kind === "operation" ? "group" : kind === "member" ? "member" : "run",
    availableSections: input.status === "failed"
      ? ["logs", "receipt", "context-data", "context-attempts", "failure"]
      : ["logs", "receipt", "context-data", "context-attempts"],
    rowRevision: input.seed,
  };
  if (kind === "operation") {
    const memberSeeds = input.memberSeeds ?? [];
    const memberStatuses = input.memberStatuses ?? [];
    const terminal = memberStatuses.filter((status) => TERMINAL.has(status)).length;
    const failed = memberStatuses.filter((status) => status === "failed").length;
    return {
      ...base,
      surfaceKind: "operation",
      memberRunIds: memberSeeds.map((seed) => uuidOf(seed)),
      memberRollup: { total: memberSeeds.length, terminal, failed },
    };
  }
  return { ...base, surfaceKind: kind };
}

const GROUPS: readonly { group: SurfaceSeed; members: SurfaceSeed[] }[] = [
  {
    group: {
      seed: 20, status: "running", title: "Weekly HDH roster check (1)",
      surfaceKind: "operation", memberSeeds: [21], memberStatuses: ["running"],
      liveMessage: "1 member running", startedMinute: 30,
    },
    members: [
      { seed: 21, status: "running", title: "EID 10611004", parentSeed: 20, surfaceKind: "member", pipeline: ["active", "pending", "pending", "pending"], startedMinute: 31 },
    ],
  },
  {
    group: {
      seed: 30, status: "running", title: "New-hire lookups — batch 3",
      surfaceKind: "operation", memberSeeds: [31, 32, 33], memberStatuses: ["done", "running", "queued"],
      liveMessage: "2 of 3 members remaining", startedMinute: 28,
    },
    members: [
      { seed: 31, status: "done", title: "Alvarez, Maria", parentSeed: 30, surfaceKind: "member", pipeline: ["done", "done", "done", "skipped"], startedMinute: 29 },
      { seed: 32, status: "running", title: "EID 10480021", parentSeed: 30, surfaceKind: "member", pipeline: ["done", "active", "pending", "pending"], liveMessage: "Cross-verifying against CRM", startedMinute: 30 },
      { seed: 33, status: "queued", title: "Okafor, Chinedu", parentSeed: 30, surfaceKind: "member", startedMinute: 30 },
    ],
  },
  {
    group: {
      seed: 40, status: "awaiting-approval", title: "Rehire eligibility sweep",
      surfaceKind: "operation", memberSeeds: [41, 42, 43, 44], memberStatuses: ["done", "done", "failed", "awaiting-approval"],
      liveMessage: "1 member is waiting on you", startedMinute: 20,
    },
    members: [
      { seed: 41, status: "done", title: "EID 10120933", parentSeed: 40, surfaceKind: "member", pipeline: ["done", "done", "done", "skipped"], startedMinute: 21 },
      { seed: 42, status: "done", title: "EID 10577410", parentSeed: 40, surfaceKind: "member", pipeline: ["done", "done", "done", "skipped"], startedMinute: 21 },
      { seed: 43, status: "failed", title: "Tran, Bao", parentSeed: 40, surfaceKind: "member", pipeline: ["done", "failed", "pending", "skipped"], startedMinute: 22 },
      { seed: 44, status: "awaiting-approval", title: "Blirea, Glaundi", parentSeed: 40, surfaceKind: "member", pipeline: ["done", "blocked", "pending", "pending"], liveMessage: "Waiting on identity review", startedMinute: 22 },
    ],
  },
  {
    group: {
      seed: 50, status: "done", title: "Onboarding cohort — July stragglers",
      surfaceKind: "operation",
      memberSeeds: [51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62],
      memberStatuses: ["done", "done", "done", "done", "done", "done", "done", "done", "done", "done", "done", "done"],
      liveMessage: { absent: "run is terminal" }, startedMinute: 5,
    },
    members: Array.from({ length: 12 }, (_, index): SurfaceSeed => ({
      seed: 51 + index,
      status: "done",
      title: `EID 10${String(300100 + index)}`,
      parentSeed: 50,
      surfaceKind: "member",
      pipeline: ["done", "done", "done", "skipped"],
      startedMinute: 6,
    })),
  },
  {
    group: {
      seed: 70, status: "partial", title: "Separation audit — August",
      surfaceKind: "operation",
      memberSeeds: [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83],
      memberStatuses: ["done", "done", "done", "done", "done", "done", "done", "done", "done", "failed", "failed", "cancelled", "running"],
      liveMessage: "2 members failed", startedMinute: 10,
    },
    members: [
      ...Array.from({ length: 9 }, (_, index): SurfaceSeed => ({
        seed: 71 + index,
        status: "done",
        title: `EID 10${String(410200 + index)}`,
        parentSeed: 70,
        surfaceKind: "member",
        pipeline: ["done", "done", "done", "skipped"],
        startedMinute: 11,
      })),
      { seed: 80, status: "failed", title: "Castillo, Ren", parentSeed: 70, surfaceKind: "member", pipeline: ["done", "failed", "pending", "skipped"], startedMinute: 12 },
      { seed: 81, status: "failed", title: "EID 10990031", parentSeed: 70, surfaceKind: "member", pipeline: ["failed", "pending", "pending", "skipped"], startedMinute: 12 },
      { seed: 82, status: "cancelled", title: "EID 10990032", parentSeed: 70, surfaceKind: "member", pipeline: ["done", "skipped", "skipped", "skipped"], startedMinute: 13 },
      { seed: 83, status: "running", title: "Haddad, Lina", parentSeed: 70, surfaceKind: "member", pipeline: ["done", "active", "pending", "pending"], startedMinute: 14 },
    ],
  },
];

const SINGLE_SEEDS: readonly SurfaceSeed[] = [
  { seed: 1, status: "queued", title: "EID 10873698", liveMessage: { absent: "run has not started" }, startedMinute: 55 },
  { seed: 2, status: "running", title: "Battistessa, Johnnie", liveMessage: "Searching UCPath for Battistessa, Johnnie", pipeline: ["active", "pending", "pending", "pending"], startedMinute: 52 },
  { seed: 3, status: "done", title: "EID 10001573", subtitle: "with CRM dates", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "done", "done", "done"], startedMinute: 35 },
  { seed: 4, status: "failed", title: "EID 10555001", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "failed", "pending", "skipped"], startedMinute: 33 },
  { seed: 5, status: "awaiting-approval", title: "Blirea, Glaundi", liveMessage: "Waiting on identity review", pipeline: ["done", "blocked", "pending", "pending"], startedMinute: 47 },
  { seed: 6, status: "blocked", title: "EID 10777012", subtitle: { absent: "no subtitle was derived for this input" }, liveMessage: "A write to UCPath is parked pending proof", pipeline: ["done", "active", "pending", "pending"], startedMinute: 44 },
  { seed: 7, status: "cancelled", title: "EID 10222009", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "skipped", "skipped", "skipped"], startedMinute: 26 },
  { seed: 8, status: "partial", title: "EID 10333015", subtitle: "with CRM dates", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "done", "done", "failed"], startedMinute: 24 },
  { seed: 9, status: "queued", title: "EID 10873698", surfaceKind: "preview", subtitle: "preview", liveMessage: { absent: "preview rows do not execute" }, startedMinute: 57 },
];

const rawSurfaces: Record<string, unknown>[] = [
  ...SINGLE_SEEDS.map((seed) => surfaceOf(seed)),
  ...GROUPS.flatMap(({ group, members }) => [surfaceOf(group), ...members.map((member) => surfaceOf(member))]),
];

/**
 * D81 count semantics, mirrored from the real projection
 * (src/server/dashboard/projectors/run-queue-projection.ts): delegated
 * members are contained in their operation's rollup and EXCLUDED from
 * workflowCounts, statusCounts, and the day total.
 */
const countableSurfaces = (surfaces: readonly Record<string, unknown>[]): Record<string, unknown>[] =>
  surfaces.filter((surface) => surface.surfaceKind !== "member");

const TOP_LEVEL_COUNT = SINGLE_SEEDS.length + GROUPS.length;

function statusCountsOf(surfaces: readonly { status: string }[]): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const surface of surfaces) {
    counts.set(surface.status, (counts.get(surface.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => ({ status, count }));
}

export const FIXTURE_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
  day: FIXTURE_DAY,
  descriptorHash: FIXTURE_DESCRIPTOR_HASH,
  projectionGeneration: 1,
  snapshotCursor: "pc:1",
  monthCounts: [
    { day: "2026-08-01", count: 6 },
    { day: "2026-08-02", count: 9 },
    { day: FIXTURE_DAY, count: TOP_LEVEL_COUNT },
  ],
  workflowCounts: [{ workflowId: WORKFLOW_ID, count: countableSurfaces(rawSurfaces).length }],
  statusCounts: statusCountsOf(countableSurfaces(rawSurfaces) as { status: string }[]),
  queueSurfaces: rawSurfaces,
  workerCards: [
    {
      workerId: "person-lookup-worker-1",
      system: "ucpath",
      state: "working",
      currentRun: { state: "present", runId: uuidOf(2), traceId: traceOf(2) },
      revision: 1,
    },
    {
      workerId: "person-lookup-worker-2",
      system: "ucpath",
      state: "idle",
      currentRun: { state: "absent", reason: "no claimable work at this priority" },
      revision: 1,
    },
    {
      workerId: "person-lookup-worker-3",
      system: "crm",
      state: "waiting",
      currentRun: { state: "absent", reason: "waiting on the ucpath session lease" },
      revision: 2,
    },
    {
      workerId: "person-lookup-worker-4",
      system: "crm",
      state: "failed",
      currentRun: { state: "absent", reason: "browser session closed unexpectedly" },
      revision: 3,
    },
    {
      workerId: "person-lookup-worker-5",
      system: "ucpath",
      state: "paused",
      currentRun: { state: "absent", reason: "paused by the operator" },
      revision: 1,
    },
  ],
  notifications: [
    {
      notificationId: uuidOf(801),
      actorId: "local-operator",
      severity: "warning",
      title: "A write to UCPath is parked pending proof",
      state: "unread",
      occurredAt: at(45),
      revision: 1,
    },
    {
      notificationId: uuidOf(802),
      actorId: "local-operator",
      severity: "info",
      title: "Onboarding cohort — July stragglers completed",
      state: "read",
      occurredAt: at(18),
      revision: 1,
    },
  ],
});

export const FIXTURE_IDS = Object.freeze({
  queuedRun: uuidOf(1),
  runningRun: uuidOf(2),
  doneRun: uuidOf(3),
  failedRun: uuidOf(4),
  openGateRun: uuidOf(5),
  parkedRun: uuidOf(6),
  cancelledRun: uuidOf(7),
  partialRun: uuidOf(8),
  previewRun: uuidOf(9),
  groupOf1: uuidOf(20),
  groupOf3: uuidOf(30),
  groupOf4: uuidOf(40),
  groupOf12: uuidOf(50),
  groupOf13: uuidOf(70),
  memberRun: uuidOf(31),
  /** command-route behavior selectors for the fixture BFF */
  conflictRun: uuidOf(5),
  rejectedRun: uuidOf(7),
  failureId: uuidOf(904),
});

/* ── run detail ──────────────────────────────────────────────────────────── */

interface DetailSeed {
  readonly seed: number;
  readonly panelKind: "run" | "member" | "group";
  readonly title: string;
  readonly status: Status;
  readonly gate: unknown;
  readonly outcome: unknown;
  readonly timeline: readonly {
    seed: number;
    minute: number;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    /** Only on a `skipped` step, and only when the executor recorded one. */
    notRunReason?: "condition-false" | "branch-not-selected";
  }[];
  readonly dataFacts?: number;
}

function detailOf(input: DetailSeed): RunDetailWire {
  return RunDetailWireSchema.parse({
    runId: uuidOf(input.seed),
    rowRevision: input.seed,
    panelKind: input.panelKind,
    header: {
      runId: uuidOf(input.seed),
      traceId: traceOf(input.seed),
      workflowId: WORKFLOW_ID,
      actorId: "local-operator",
      title: input.title,
      status: input.status,
      attempt: 1,
    },
    timeline: {
      events: input.timeline.map((event, index) => ({
        noteId: uuidOf(input.seed * 100 + 9000 + index),
        sequence: index,
        at: at(event.minute),
        label: event.label,
        state: event.state,
        notRun: event.notRunReason === undefined
          ? {
            state: "absent",
            reason: event.state === "skipped"
              ? "this step did not run; its span recorded no reason"
              : "this step ran",
          }
          : { state: "present", reason: event.notRunReason },
      })),
    },
    gate: input.gate,
    outcome: input.outcome,
    context: { dataFacts: input.dataFacts ?? 2, evidenceFacts: 0, attempts: 1 },
    availableSections: input.status === "failed"
      ? ["logs", "receipt", "context-data", "context-attempts", "failure"]
      : ["logs", "receipt", "context-data", "context-attempts"],
  });
}

const NO_GATE = absent("this run reached no gate");
const STILL_RUNNING = absent("run is still executing");

export const FIXTURE_RUN_DETAILS: Readonly<Record<string, RunDetailWire>> = Object.freeze({
  [FIXTURE_IDS.queuedRun]: detailOf({
    seed: 1, panelKind: "run", title: "EID 10873698", status: "queued",
    gate: absent("this run has not started"), outcome: absent("this run has not started"),
    timeline: [], dataFacts: 0,
  }),
  [FIXTURE_IDS.runningRun]: detailOf({
    seed: 2, panelKind: "run", title: "Battistessa, Johnnie", status: "running",
    gate: NO_GATE, outcome: STILL_RUNNING,
    timeline: [{ seed: 2, minute: 52, label: "searching", state: "active" }],
  }),
  [FIXTURE_IDS.doneRun]: detailOf({
    seed: 3, panelKind: "run", title: "EID 10001573", status: "done",
    gate: NO_GATE,
    outcome: { state: "terminal", result: "verified-done", completedAt: at(39) },
    timeline: [
      { seed: 3, minute: 35, label: "searching", state: "done" },
      { seed: 3, minute: 36, label: "cross-verify", state: "done" },
      { seed: 3, minute: 37, label: "active-status", state: "done" },
      { seed: 3, minute: 38, label: "crm-dates", state: "done" },
    ],
  }),
  [FIXTURE_IDS.failedRun]: detailOf({
    seed: 4, panelKind: "run", title: "EID 10555001", status: "failed",
    gate: NO_GATE,
    outcome: { state: "terminal", result: "failed", completedAt: at(36) },
    timeline: [
      { seed: 4, minute: 33, label: "searching", state: "done" },
      { seed: 4, minute: 35, label: "cross-verify", state: "failed" },
    ],
  }),
  [FIXTURE_IDS.openGateRun]: detailOf({
    seed: 5, panelKind: "run", title: "Blirea, Glaundi", status: "awaiting-approval",
    gate: { state: "open", gateId: uuidOf(105), label: "identity-review", openedAt: at(49), revision: 1 },
    outcome: STILL_RUNNING,
    timeline: [
      { seed: 5, minute: 47, label: "searching", state: "done" },
      { seed: 5, minute: 49, label: "gate:identity-review", state: "blocked" },
    ],
  }),
  [FIXTURE_IDS.memberRun]: detailOf({
    seed: 31, panelKind: "member", title: "Alvarez, Maria", status: "done",
    gate: NO_GATE,
    outcome: { state: "terminal", result: "verified-done", completedAt: at(32) },
    timeline: [
      { seed: 31, minute: 29, label: "searching", state: "done" },
      { seed: 31, minute: 30, label: "cross-verify", state: "done" },
      { seed: 31, minute: 31, label: "active-status", state: "done" },
      // The live exit run's exact shape (master plan §Phase 1): a conditional
      // node whose `when` was false. It is SKIPPED, never "cancelled".
      { seed: 31, minute: 32, label: "crm-dates", state: "skipped", notRunReason: "condition-false" },
    ],
  }),
  [FIXTURE_IDS.groupOf13]: detailOf({
    seed: 70, panelKind: "group", title: "Separation audit — August", status: "partial",
    gate: NO_GATE, outcome: absent("members are still executing"),
    timeline: [
      { seed: 70, minute: 10, label: "fan-out", state: "done" },
      { seed: 70, minute: 14, label: "members", state: "active" },
    ],
  }),
});

/* ── lazy sections ───────────────────────────────────────────────────────── */

interface NoteSeed {
  readonly level: "info" | "warning" | "error";
  readonly minute: number;
  readonly message: string;
}

function notePageOf(seed: number, notes: readonly NoteSeed[]): z.infer<typeof NotePageSchema> {
  return NotePageSchema.parse({
    runId: uuidOf(seed),
    notes: notes.map((note, index) => ({
      noteId: uuidOf(seed * 1000 + index + 1),
      runId: uuidOf(seed),
      sequence: index,
      at: at(note.minute, index),
      level: note.level,
      message: note.message,
    })),
    nextCursor: { state: "absent", reason: "end-of-page" },
  });
}

/**
 * Adapter #1 authors payloads; it derives nothing. A receipt is DERIVED from
 * authority rows this adapter has none of (D141), so it truthfully serves an
 * absence with the reason — adapter #2, the seeded BFF over the real database,
 * is where a real receipt is exercised.
 */
const RECEIPT_MISSING = {
  state: "missing",
  reason: "this fixture adapter holds no authority rows to derive a receipt from",
} as const;

/** The failed run's record, in the strict already-redacted wire shape (D142). */
function failureDetail(runId: string, failureId: string, seed: number) {
  const summary = "cross-verify failed: subject mismatch between CRM and UCPath";
  return {
    runId,
    failureId,
    traceId: traceOf(seed),
    attempt: 1,
    workflowId: "person-lookup",
    nodeId: "cross-verify",
    taskId: "crm/read-onboarding-record",
    fingerprint: "e".repeat(64),
    code: "SUBJECT_MISMATCH",
    summary,
    transient: false,
    writeState: "not-attempted",
    subject: {
      state: "present",
      expected: { kind: "eid", digest: "1".repeat(64), displayRedacted: "\u2022\u2022\u2022\u20225001" },
      observed: { kind: "eid", digest: "2".repeat(64), displayRedacted: "\u2022\u2022\u2022\u20224136" },
    },
    page: {
      screen: "crm.onboarding",
      state: "crm.onboarding.record-ready",
      urlRedacted: "https://crm.example/onboarding/[redacted]",
      titleRedacted: "Onboarding record",
    },
    action: { operation: "read", sequence: 3 },
    causeChain: [{ code: "SUBJECT_MISMATCH", summary, role: "primary", transient: false }],
    remediation: [{
      kind: "operator-action",
      message: "Confirm which EID is correct at the source before re-running; nothing was written.",
    }],
    sameFingerprintSeen: 1,
    diagnosticBundle: {
      state: "absent",
      reason: "no diagnostic bundle was captured; automatic capture is a separate 2g slice",
    },
    occurredAt: at(35),
  };
}

/** A locked context-data row, the fixture's default (2i-C wire shape). */
type DataEntrySeed = {
  label: string;
  valueRedacted: string;
  edit?: Record<string, unknown>;
};

const LOCKED_NOT_DECLARED = {
  state: "locked",
  reason: "not declared correctable by this workflow",
} as const;

function sectionsOf(
  seed: number,
  notes: readonly NoteSeed[],
  dataEntries: readonly DataEntrySeed[],
  failureId?: string,
  editing?: Record<string, unknown>,
): Readonly<Record<string, RunDetailSectionResponse>> {
  const runId = uuidOf(seed);
  const sections: Record<string, unknown> = {
    logs: { section: "logs", payload: notePageOf(seed, notes) },
    receipt: { section: "receipt", payload: RECEIPT_MISSING },
    "context-data": {
      section: "context-data",
      payload: {
        runId,
        editing: editing ?? {
          state: "locked",
          reason: "run is terminal; corrections apply only to a non-executing resumable run",
        },
        entries: dataEntries.map((entry) => ({
          label: entry.label,
          valueRedacted: entry.valueRedacted,
          edit: entry.edit ?? LOCKED_NOT_DECLARED,
        })),
      },
    },
    "context-attempts": {
      section: "context-attempts",
      payload: {
        runId,
        entries: [{ label: "Attempt 1", valueRedacted: `${at(30)} · this attempt` }],
      },
    },
  };
  if (failureId !== undefined) {
    sections.failure = {
      section: "failure",
      payload: { state: "available", value: failureDetail(runId, failureId, seed) },
    };
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(sections).map(([name, value]) => [name, RunDetailSectionResponseSchema.parse(value)]),
  ));
}

export const FIXTURE_SECTIONS: Readonly<Record<string, Readonly<Record<string, RunDetailSectionResponse>>>> = Object.freeze({
  // The 2i-C showcase: a RETRY-queued run — resumable, unclaimed, with the
  // prior attempt's recorded checkpoints — is the one state where the merged
  // Data/Edit-Data surface is genuinely editable. One row editable at rest,
  // one carrying a staged correction. (The open-gate run cannot host this:
  // its seeded twin is CLAIMED while its gate is open, so both adapters
  // render it locked.)
  [FIXTURE_IDS.queuedRun]: sectionsOf(1, [
    { level: "info", minute: 55, message: "Run queued at interactive priority" },
  ], [
    {
      label: "Starts on",
      valueRedacted: "2026-07-15",
      edit: {
        state: "editable",
        nodeId: "crm-dates",
        fieldPath: "startsOn.value",
        value: "2026-07-15",
        pendingCorrection: { state: "none" },
      },
    },
    {
      label: "Invited on",
      valueRedacted: "2026-06-01",
      edit: {
        state: "editable",
        nodeId: "crm-dates",
        fieldPath: "invitedOn.value",
        value: "2026-06-01",
        pendingCorrection: { state: "pending", value: "2026-06-02", correctedAt: at(50) },
      },
    },
  ], undefined, { state: "editable", expectedVersion: 2 }),
  [FIXTURE_IDS.runningRun]: sectionsOf(2, [
    { level: "info", minute: 52, message: "Searching UCPath directory for Battistessa, Johnnie" },
    { level: "info", minute: 53, message: "2 candidates returned from person search" },
    { level: "info", minute: 54, message: "Selecting the exact name match" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "pending" },
  ], undefined, {
    state: "locked",
    reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
      + "editing reopens when it parks or finishes",
  }),
  [FIXTURE_IDS.doneRun]: sectionsOf(3, [
    { level: "info", minute: 35, message: "Searching UCPath directory for EID 10001573" },
    { level: "info", minute: 36, message: "Cross-verified against the CRM onboarding record" },
    { level: "info", minute: 37, message: "Active status resolved: active" },
    { level: "info", minute: 38, message: "CRM onboarding dates recorded" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "active" },
  ]),
  [FIXTURE_IDS.failedRun]: sectionsOf(4, [
    { level: "info", minute: 33, message: "Searching UCPath directory for EID 10555001" },
    { level: "warning", minute: 34, message: "CRM record name disagrees with the UCPath name" },
    { level: "error", minute: 35, message: "cross-verify failed: subject mismatch between CRM and UCPath" },
    { level: "error", minute: 36, message: "Run failed at cross-verify; nothing was written" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "not-reached" },
  ], FIXTURE_IDS.failureId),
  [FIXTURE_IDS.openGateRun]: sectionsOf(5, [
    { level: "info", minute: 47, message: "Searching UCPath directory for Blirea, Glaundi" },
    { level: "warning", minute: 48, message: "Two candidates share the name Blirea, Glaundi" },
    { level: "info", minute: 49, message: "identity-review gate opened for candidate selection" },
  ], [
    { label: "Selection", valueRedacted: "ambiguous (2 candidates)" },
    { label: "Active status", valueRedacted: "pending" },
  ], undefined, {
    // The seeded twin of this run is CLAIMED while its gate is open, so both
    // adapters must render the same locked shape (dual-adapter structure).
    state: "locked",
    reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
      + "editing reopens when it parks or finishes",
  }),
  [FIXTURE_IDS.memberRun]: sectionsOf(31, [
    { level: "info", minute: 29, message: "Searching UCPath directory for Alvarez, Maria" },
    { level: "info", minute: 31, message: "Active status resolved: active" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "active" },
  ]),
  [FIXTURE_IDS.groupOf13]: sectionsOf(70, [
    { level: "info", minute: 10, message: "Fan-out planned 13 member lookups" },
    { level: "warning", minute: 13, message: "2 members failed cross-verification" },
  ], [
    { label: "Selection", valueRedacted: "13 members" },
    { label: "Active status", valueRedacted: "mixed" },
  ]),
});

/* ── bootstrap ───────────────────────────────────────────────────────────── */

export const FIXTURE_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
  wireVersion: 1,
  appVersion: FIXTURE_APP_VERSION,
  descriptorHash: FIXTURE_DESCRIPTOR_HASH,
  settingsSchemaHash: descriptorSetHash(["settings-schema"]),
  projectionGeneration: 1,
  actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: FIXTURE_NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: at(0) },
  workflows: [{
    id: WORKFLOW_ID,
    label: personLookupDescriptor.label,
    categoryId: personLookupDescriptor.category,
    descriptorFingerprint: CONTRACT_FINGERPRINT,
    availability: { state: "available" },
  }],
  workflowCategories: [{ id: personLookupDescriptor.category, label: "Search", order: 0 }],
  systemInstances: [
    { system: "ucpath", prod: "available", test: { state: "available" } },
    { system: "crm", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "no CRM test instance is configured" } },
  ],
  settingsSections: [{ id: "general", label: "General", revision: 1 }],
  featureAvailability: [
    { feature: "capture", availability: { state: "unavailable", code: "deferred", reason: "mobile capture lands in 2h" } },
    { feature: "ocr", availability: { state: "unavailable", code: "deferred", reason: "OCR review lands in 2h" } },
    // D178: the advisory SHIPPED, so the fixture mirrors what a real process
    // with no key composed says — `not-configured` naming the family — rather
    // than a `deferred` milestone the server no longer produces.
    {
      feature: "ai-advisory",
      availability: {
        state: "unavailable",
        code: "not-configured",
        reason: "no GEMINI_API_KEY is set, so no ai.advisory provider is composed in this process",
      },
    },
    { feature: "archive", availability: { state: "unavailable", code: "deferred", reason: "archive lands in 2i" } },
    { feature: "workflow-editor", availability: { state: "unavailable", code: "deferred", reason: "the editor lands in a later phase" } },
  ],
});

/* ── start plan + command results ────────────────────────────────────────── */

export const FIXTURE_START_PLAN: StartPlanResponse = StartPlanResponseSchema.parse({
  wireVersion: 1,
  startPlanId: uuidOf(900),
  workflowId: WORKFLOW_ID,
  expectedVersion: 1,
  expiresAt: "2026-08-03T10:15:00.000-07:00",
  dryRun: false,
  priority: "interactive",
  plannedBy: "local-operator",
  configSnapshotId: uuidOf(901),
  fingerprints: {
    descriptorFingerprint: CONTRACT_FINGERPRINT,
    configFingerprint: CONFIG_FINGERPRINT,
    ingressSchemaHash: "c".repeat(64),
    canonicalInputSchemaHash: "d".repeat(64),
    inputFingerprint: "e".repeat(64),
  },
  planned: [
    { runId: uuidOf(910), traceId: traceOf(910), title: "EID 10873698", subtitle: "person lookup", matchKey: "eid:10873698" },
    { runId: uuidOf(911), traceId: traceOf(911), title: "Battistessa, Johnnie", subtitle: "person lookup", matchKey: "name:Battistessa, Johnnie" },
  ],
  refused: [
    { entry: 3, code: "duplicate-active", message: "an active run already exists for eid:10873698" },
  ],
});

export const FIXTURE_COMMAND_RESULTS: Readonly<Record<"applied" | "conflict" | "rejected", CommandResult>> = Object.freeze({
  applied: CommandResultSchema.parse({
    state: "applied",
    commandId: uuidOf(920),
    affectedTargets: [{ family: "run", runId: uuidOf(910) }],
  }),
  conflict: CommandResultSchema.parse({
    state: "conflict",
    commandId: uuidOf(921),
    currentVersion: 2,
    message: "the row moved while you were looking at it; the fresh projection replaces it",
  }),
  rejected: CommandResultSchema.parse({
    state: "rejected",
    commandId: uuidOf(922),
    code: "policy-refused",
    message: "a cancelled run cannot be retried from this surface",
  }),
});
