import { personLookupDescriptor } from "../../registered-workflows.js";
import { DashboardDayWireSchema, type DashboardDayWire, type QueueSurfaceWire } from "../../../../../src/models/dashboard/projection.js";
import { queueRowActions } from "../../../../../src/backend/runs/projections/queue-row-actions.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureNotificationsTypes from "../../../fixtures/dashboard/fixture-notifications.js";


type PipelineState = "pending" | "active" | "done" | "failed" | "skipped" | "blocked";

export type Status = QueueSurfaceWire["status"];

interface SurfaceSeed {
  readonly seed: number;
  readonly status: Status;
  readonly title: string;
  readonly surfaceKind?: "single" | "preview" | "member" | "operation";
  readonly parentSeed?: number;
  readonly subtitle?: string | { absent: string };
  readonly liveMessage?: string | { absent: string };

  readonly dryRun?: boolean;
  // Use more than one warning so the corpus detects a hardcoded count.
  readonly warnings?: { count: number; first: string };
  readonly pipeline?: readonly [PipelineState, PipelineState, PipelineState, PipelineState];
  readonly startedMinute?: number;
  readonly memberSeeds?: readonly number[];
  readonly memberStatuses?: readonly Status[];
}

export function createFixtureQueueSetup({ at, CONFIG_FINGERPRINT, FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH, traceOf, uuidOf, WORKFLOW_ID, FIXTURE_BACKFILL_NOTIFICATIONS, FIXTURE_NOTIFICATIONS }: {
at: typeof FixtureIdentityTypes.at;
CONFIG_FINGERPRINT: typeof FixtureIdentityTypes.CONFIG_FINGERPRINT;
FIXTURE_APP_VERSION: typeof FixtureIdentityTypes.FIXTURE_APP_VERSION;
FIXTURE_DAY: typeof FixtureIdentityTypes.FIXTURE_DAY;
FIXTURE_DESCRIPTOR_HASH: typeof FixtureIdentityTypes.FIXTURE_DESCRIPTOR_HASH;
traceOf: typeof FixtureIdentityTypes.traceOf;
uuidOf: typeof FixtureIdentityTypes.uuidOf;
WORKFLOW_ID: typeof FixtureIdentityTypes.WORKFLOW_ID;
FIXTURE_BACKFILL_NOTIFICATIONS: typeof FixtureNotificationsTypes.FIXTURE_BACKFILL_NOTIFICATIONS;
FIXTURE_NOTIFICATIONS: typeof FixtureNotificationsTypes.FIXTURE_NOTIFICATIONS;
}) {
  const PIPELINE_NODES = [
    ["searching", "searching"],
    ["cross-verify", "Cross Verification"],
    ["active-status", "Active Status"],
    ["crm-dates", "CRM Dates"],
  ] as const;

  function pipeline(states: readonly [PipelineState, PipelineState, PipelineState, PipelineState]) {
    return PIPELINE_NODES.map(([id, label], index) => ({ id, label, state: states[index] }));
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

    const gateOpenedAt = input.status === "awaiting-approval"
      ? present(at(Math.min(startedMinute + 2, 59)))
      : absent(`run is ${input.status} and is not waiting on a gate`);
    const warnings = input.warnings === undefined
      ? absent(
        TERMINAL.has(input.status)
          ? "this run's evidence receipt records no warning"
          : `run is ${input.status} and has not produced a terminal result`,
      )
      : { state: "present", count: input.warnings.count, first: input.warnings.first } as const;
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

      appVersion: input.seed === 4
        ? { state: "absent", reason: "No app build is recorded for this fixture." }
        : { state: "present", value: FIXTURE_APP_VERSION },
      descriptorVersion: 1,
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      configFingerprint: CONFIG_FINGERPRINT,
      resolvedInstances: [
        { system: "ucpath", instance: "prod" },
        { system: "crm", instance: "prod" },
      ],

      dryRun: input.dryRun ?? false,
      priority: input.seed === 9 ? "bulk" : "interactive",

      runNumber: input.seed === 4
        ? { state: "absent", reason: "No run number is recorded for this fixture." }
        : { state: "present", value: input.seed },
      // Keep session absence in this corpus; no surface consumes the field.
      session: { state: "absent", reason: "This fixture has no run session." },
      containment: kind === "member" ? "member" : "root",
      linkedRuns: [],
      facts: TERMINAL.has(input.status)
        ? { state: "absent", reason: "this run's evidence receipt records no output fact" }
        : { state: "absent", reason: `run is ${input.status} and has not produced a terminal result` },
      startedAt: at(startedMinute),

      updatedAt: at(settledMinute),
      endedAt: TERMINAL.has(input.status)
        ? { state: "present", value: at(settledMinute) }
        : { state: "absent", reason: `run is ${input.status} and has not ended` },
      gateOpenedAt,
      title: input.title,
      // The fixture corpus renames nothing, so every reference row draws the
      // server-derived title — which is what the demo's un-renamed rows draw too.
      displayName: { state: "absent", reason: "the operator has not renamed this run" },
      subtitle,
      status: input.status,
      liveMessage,
      warnings,
      pipeline: pipeline(input.pipeline ?? ["pending", "pending", "pending", "pending"]),
      panelKind: kind === "operation" ? "group" : kind === "member" ? "member" : "run",
      availableSections: input.status === "failed"
        ? ["logs", "receipt", "context-data", "context-attempts", "failure"]
        : ["logs", "receipt", "context-data", "context-attempts"],

      actions: queueRowActions(personLookupDescriptor.actions, {
        status: input.status,
        rowRevision: input.seed,
        dryRun: input.dryRun ?? false,
        isChild: input.parentSeed !== undefined,
        parkedWrite: false,
        memberCount: kind === "operation" ? (input.memberSeeds ?? []).length : 0,
        isMember: kind === "member",
        // Every fixture row serves `displayName` absent (`:202`), so no reference
        // has ever photographed a named run — the label stays "Name this run…".
        named: false,
        hasReviewPanel: personLookupDescriptor.capabilities?.review ?? false,
      }),
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
        memberPreview: memberSeeds.length === 0
          ? { state: "absent", reason: "this group has fanned out to no members yet" }
          : { state: "present", value: `EID 10873698 +${String(memberSeeds.length - 1)} more` },
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
        { seed: 44, status: "awaiting-approval", title: "Morrow, Bea", parentSeed: 40, surfaceKind: "member", pipeline: ["done", "blocked", "pending", "pending"], liveMessage: "Waiting on identity review", startedMinute: 22 },
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
        warnings: { count: 2, first: "member EID 10990031 replayed a checkpoint older than its freshness limit" },
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
    { seed: 3, status: "done", title: "EID 10101010", subtitle: "with CRM dates", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "done", "done", "done"], startedMinute: 35 },
    { seed: 4, status: "failed", title: "EID 10555001", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "failed", "pending", "skipped"], startedMinute: 33 },
    { seed: 5, status: "awaiting-approval", title: "Morrow, Bea", liveMessage: "Waiting on identity review", pipeline: ["done", "blocked", "pending", "pending"], startedMinute: 47 },
    { seed: 6, status: "blocked", title: "EID 10777012", subtitle: { absent: "no subtitle was derived for this input" }, liveMessage: "A write to UCPath is parked pending proof", pipeline: ["done", "active", "pending", "pending"], startedMinute: 44 },
    { seed: 7, status: "cancelled", title: "EID 10222009", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "skipped", "skipped", "skipped"], startedMinute: 26 },
    { seed: 8, status: "partial", title: "EID 10333015", subtitle: "with CRM dates", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "done", "done", "failed"], startedMinute: 24, warnings: { count: 3, first: "CRM separation dates were replayed from a checkpoint older than the freshness limit" } },
    { seed: 9, status: "queued", title: "EID 10873698", surfaceKind: "preview", subtitle: "preview", liveMessage: { absent: "preview rows do not execute" }, startedMinute: 57, dryRun: true },
  ];

  const rawSurfaces: Record<string, unknown>[] = [
    ...SINGLE_SEEDS.map((seed) => surfaceOf(seed)),
    ...GROUPS.flatMap(({ group, members }) => [surfaceOf(group), ...members.map((member) => surfaceOf(member))]),
  ];

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

  const FIXTURE_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
    day: FIXTURE_DAY,
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    projectionGeneration: 1,
    snapshotCursor: "pc:1",
    monthCounts: [
      { day: "2026-08-01", count: 6 },
      { day: "2026-08-02", count: 9 },
      { day: FIXTURE_DAY, count: TOP_LEVEL_COUNT },
    ],

    workflowCounts: [{
      workflowId: WORKFLOW_ID,
      count: countableSurfaces(rawSurfaces).length,
      statusCounts: statusCountsOf(countableSurfaces(rawSurfaces) as { status: string }[]),
    }],
    statusCounts: statusCountsOf(countableSurfaces(rawSurfaces) as { status: string }[]),
    queueSurfaces: rawSurfaces,

    workerPools: [],
    workerOperations: [],
    workerAuthority: { state: "present", members: ["running", "idle", "starting", "failed", "idle"].map((phase, index) => ({
      workerId: `person-lookup-worker-${String(index + 1)}`, workflow: WORKFLOW_ID,
      ordinal: index + 1, poolIndex: index + 1, membershipRevision: 1, phase,
      retiredAt: null, retirementCommandId: null, reservationCommandId: null, createdAt: at(0), updatedAt: at(0),
    })) },
    workerCards: [
      {
        workerId: "person-lookup-worker-1",
        member: { workflowId: WORKFLOW_ID, workerId: "person-lookup-worker-1", ordinal: 1, poolIndex: 1, membershipRevision: 1 },
        workflowId: WORKFLOW_ID,
        state: "running",
        directive: "run",
        startedAt: at(12),
        currentRun: { state: "present", runId: uuidOf(2), traceId: traceOf(2) },
        browserRequirements: { state: "present", systems: ["crm", "ucpath"] },
        browsers: [
          { sessionId: uuidOf(901), system: "ucpath", openedAt: at(13) },
          { sessionId: uuidOf(902), system: "crm", openedAt: at(21) },
        ],
        leaseVersion: 14,
        revision: 1,
      },
      {
        workerId: "person-lookup-worker-2",
        member: { workflowId: WORKFLOW_ID, workerId: "person-lookup-worker-2", ordinal: 2, poolIndex: 2, membershipRevision: 1 },
        workflowId: WORKFLOW_ID,
        state: "idle",
        directive: "run",
        startedAt: at(9),
        currentRun: { state: "absent", reason: "no claimable work at this priority" },
        browserRequirements: { state: "present", systems: ["crm", "ucpath"] },
        browsers: [{ sessionId: uuidOf(903), system: "ucpath", openedAt: at(10) }],
        leaseVersion: 9,
        revision: 1,
      },
      {
        workerId: "person-lookup-worker-3",
        member: { workflowId: WORKFLOW_ID, workerId: "person-lookup-worker-3", ordinal: 3, poolIndex: 3, membershipRevision: 1 },
        workflowId: WORKFLOW_ID,
        state: "starting",
        directive: "run",
        startedAt: at(46),
        currentRun: { state: "absent", reason: "no claimed run" },
        browserRequirements: { state: "present", systems: ["crm", "ucpath"] },
        browsers: [],
        leaseVersion: 1,
        revision: 1,
      },
      {
        workerId: "person-lookup-worker-4",
        member: { workflowId: WORKFLOW_ID, workerId: "person-lookup-worker-4", ordinal: 4, poolIndex: 4, membershipRevision: 1 },
        workflowId: WORKFLOW_ID,
        state: "failed",
        directive: "stop",
        startedAt: at(5),
        endedAt: at(33),
        stopReason: "crashed",
        currentRun: { state: "absent", reason: "worker stopped" },
        browserRequirements: { state: "present", systems: ["crm", "ucpath"] },
        browsers: [],
        leaseVersion: 6,
        revision: 3,
      },
      {
        workerId: "person-lookup-worker-5",
        member: { workflowId: WORKFLOW_ID, workerId: "person-lookup-worker-5", ordinal: 5, poolIndex: 5, membershipRevision: 1 },
        workflowId: WORKFLOW_ID,
        state: "idle",
        directive: "pause",
        startedAt: at(2),
        currentRun: { state: "absent", reason: "no claimable work at this priority" },
        browserRequirements: { state: "present", systems: ["crm", "ucpath"] },
        browsers: [],
        leaseVersion: 4,
        revision: 1,
      },
    ],
    notifications: FIXTURE_NOTIFICATIONS,
  });

  const BACKFILL_GAP_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    notifications: FIXTURE_BACKFILL_NOTIFICATIONS,
  });

  const FIXTURE_IDS = Object.freeze({
    queuedRun: uuidOf(1),
    runningRun: uuidOf(2),
    doneRun: uuidOf(3),
    failedRun: uuidOf(4),
    openGateRun: uuidOf(5),

    gateTypedEidRun: uuidOf(44),
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

  return { absent, FIXTURE_DAY_WIRE, BACKFILL_GAP_DAY_WIRE, FIXTURE_IDS };
}
