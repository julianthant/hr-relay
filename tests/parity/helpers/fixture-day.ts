/**
 * The deterministic parity fixture corpus (ref frontend-backend-integration §7.2, test-only adapter #1).
 *
 * Every exported value is CONSTRUCTED by parsing through the owning strict
 * wire schema at module init — a fixture that drifts from a contract fails
 * loudly at import time, never silently at render time. The corpus covers the
 * ref frontend-backend-integration §7.1 reference matrix for the 1i Person Lookup slice: all eight
 * queue statuses across the three row types, operation groups at member
 * counts 1/3/4/12/13, run/member/group panel kinds, open-gate / failed /
 * running / terminal / empty detail states, start-plan planned+refused, and
 * command applied/conflict/rejected results.
 */
import { z } from "zod";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { queueRowActions } from "../../../src/server/dashboard/projectors/queue-row-actions.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import { personLookupModule } from "../../../src/workflows/person-lookup/module.js";
import { separationsIdentityCheckModule } from "../../../src/workflows/separations/identity-check/module.js";
import { separationsKronosTimecardModule } from "../../../src/workflows/separations/kronos-timecard/module.js";
import { separationsKualiFinalizationModule } from "../../../src/workflows/separations/kuali-finalization/module.js";
import { separationsKualiReadModule } from "../../../src/workflows/separations/kuali-extraction/module.js";
import { separationsUcpathTerminationModule } from "../../../src/workflows/separations/ucpath-transaction/module.js";
import { separationsModule } from "../../../src/workflows/separations/module.js";
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
  type TimelineStepWire,
} from "../../../src/domain/dashboard/run-detail.js";
import {
  DiagnosticBundleWireSchema,
  type DiagnosticBundleWire,
} from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { deriveDiagnosticContentDigest } from "../../../src/domain/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../src/domain/trust/diagnostic.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import {
  StartPlanResponseSchema,
  type StartPlanResponse,
} from "../../../src/dashboard/client/commands.js";
import {
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
  type SettingsFactsWire,
} from "../../../src/domain/dashboard/settings.js";
import { buildSettingsFacts } from "../../../src/server/dashboard/queries/settings.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { manualClock } from "../../../src/domain/clock.js";
import { buildFixtureIdentityGate } from "./fixture-gate.js";

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

const FIXTURE_DIAGNOSTIC_REDACTION = {
  fields: [
    { key: "employeeName", state: "transformed", classification: "sensitive-hr", transform: "digest", value: "a".repeat(64) },
    { key: "ucpathPassword", state: "redacted", classification: "secret", transform: "drop" },
  ],
  warnings: ["unclassified diagnostic field at index 3 dropped"],
} as const;

const FIXTURE_DIAGNOSTIC_ATTACHMENTS = [
  {
    kind: "screenshot",
    artifactId: uuidOf(905),
    mediaType: "image/png",
    byteLength: 200,
    digest: "1".repeat(64),
    sensitivity: "redacted",
    width: 1280,
    height: 720,
  },
  {
    kind: "accessibility-excerpt",
    artifactId: uuidOf(906),
    mediaType: "text/yaml",
    byteLength: 128,
    digest: "2".repeat(64),
    sensitivity: "redacted",
  },
] as const;

const FIXTURE_DIAGNOSTIC_IDENTITY = {
  runId: uuidOf(4),
  origin: { kind: "operator-request", requestedBy: "local-operator" },
  capturedAt: at(35),
  configFingerprint: CONFIG_FINGERPRINT,
  descriptorFingerprint: CONTRACT_FINGERPRINT,
  redaction: FIXTURE_DIAGNOSTIC_REDACTION,
  attachments: FIXTURE_DIAGNOSTIC_ATTACHMENTS,
} as const;

/** E29's deterministic durable D137 row. The manifest route serves this canonical value exactly. */
export const FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST: DiagnosticBundle = DiagnosticBundleSchema.parse({
  bundleId: uuidOf(904),
  runId: FIXTURE_DIAGNOSTIC_IDENTITY.runId,
  origin: FIXTURE_DIAGNOSTIC_IDENTITY.origin,
  createdAt: FIXTURE_DIAGNOSTIC_IDENTITY.capturedAt,
  contentDigest: deriveDiagnosticContentDigest(FIXTURE_DIAGNOSTIC_IDENTITY),
  configFingerprint: FIXTURE_DIAGNOSTIC_IDENTITY.configFingerprint,
  descriptorFingerprint: FIXTURE_DIAGNOSTIC_IDENTITY.descriptorFingerprint,
  redaction: FIXTURE_DIAGNOSTIC_IDENTITY.redaction,
  attachments: FIXTURE_DIAGNOSTIC_IDENTITY.attachments,
  retention: { kind: "pinned", reason: "fix" },
});

/** E29's strict browser projection of the durable row. */
export const FIXTURE_DIAGNOSTIC_BUNDLE: DiagnosticBundleWire = DiagnosticBundleWireSchema.parse({
  bundleId: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.bundleId,
  capturedAt: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.createdAt,
  byteSize: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments.reduce((total, attachment) => total + attachment.byteLength, 0),
  contentDigest: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.contentDigest,
  redaction: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.redaction,
  contents: [
    {
      ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments[0],
      key: "Screenshot",
      detail: "image/png · 200 bytes · 1280 × 720 px · redacted",
    },
    {
      ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments[1],
      key: "Accessibility excerpt",
      detail: "text/yaml · 128 bytes · redacted",
    },
  ],
});

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
  /** D6 — the rehearsal flag. Every envelope carries it; the corpus pins both arms. */
  readonly dryRun?: boolean;
  /**
   * D22/D126 — the `△ N` chip's real count and the first warning's sentence.
   * Deliberately NOT `1` on the row that carries it: a corpus whose served
   * count equals the constant it replaced cannot tell the two renderings apart.
   */
  readonly warnings?: { count: number; first: string };
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
  /**
   * D12 — an `awaiting-approval` row is the ONLY row that may date a gate, and
   * the instant comes from the gate's own record rather than from `updatedAt`.
   * The fixture opens the gate two minutes after the run started so the age is
   * a real interval and not a zero.
   */
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
    // D6: the flag lives on the envelope, so every row carries it and there is
    // no absent arm — a rehearsal that renders like a real filing is the
    // cheapest way to read a dry run as a submitted transaction.
    dryRun: input.dryRun ?? false,
    priority: input.seed === 9 ? "bulk" : "interactive",
    /*
     * D230: the corpus pins BOTH arms for the same reason it pins both arms of
     * `appVersion` — a run enqueued before schema v15 carries no ordinal, and a
     * reference set that only ever photographed the present arm would not show
     * what the footer does when the number is genuinely absent.
     */
    runNumber: input.seed === 4
      ? { state: "absent", reason: "enqueued before runs carried a workflow ordinal (D230)" }
      : { state: "present", value: input.seed },
    // D269: the parity corpus predates run sessions and no surface reads the
    // field yet; an absent arm keeps every frozen reference byte-identical.
    session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
    containment: kind === "member" ? "member" : "root",
    linkedRuns: [],
    facts: TERMINAL.has(input.status)
      ? { state: "absent", reason: "this run's evidence receipt records no output fact" }
      : { state: "absent", reason: `run is ${input.status} and has not produced a terminal result` },
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
    /**
     * The row's served controls, built by the PRODUCTION projection helper over
     * this workflow's real `WorkflowActionPolicy` — never a hand-listed corpus
     * copy. A parity reference exists to photograph what an operator sees, and a
     * fixture that authored its own action set would photograph the fixture's
     * opinion of the contract instead of the contract.
     *
     * `parkedWrite` is `false` throughout: a `blocked` seed does not declare
     * which lifecycle it is (parked-write or interrupted), and the flag changes
     * only the confirm dialog's body sentence, which no reference captures.
     */
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
      workflowLabel: personLookupDescriptor.label,
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
  { seed: 3, status: "done", title: "EID 10001573", subtitle: "with CRM dates", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "done", "done", "done"], startedMinute: 35 },
  { seed: 4, status: "failed", title: "EID 10555001", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "failed", "pending", "skipped"], startedMinute: 33 },
  { seed: 5, status: "awaiting-approval", title: "Blirea, Glaundi", liveMessage: "Waiting on identity review", pipeline: ["done", "blocked", "pending", "pending"], startedMinute: 47 },
  { seed: 6, status: "blocked", title: "EID 10777012", subtitle: { absent: "no subtitle was derived for this input" }, liveMessage: "A write to UCPath is parked pending proof", pipeline: ["done", "active", "pending", "pending"], startedMinute: 44 },
  { seed: 7, status: "cancelled", title: "EID 10222009", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "skipped", "skipped", "skipped"], startedMinute: 26 },
  { seed: 8, status: "partial", title: "EID 10333015", subtitle: "with CRM dates", liveMessage: { absent: "run is terminal" }, pipeline: ["done", "done", "done", "failed"], startedMinute: 24, warnings: { count: 3, first: "CRM separation dates were replayed from a checkpoint older than the freshness limit" } },
  { seed: 9, status: "queued", title: "EID 10873698", surfaceKind: "preview", subtitle: "preview", liveMessage: { absent: "preview rows do not execute" }, startedMinute: 57, dryRun: true },
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
  // One workflow in the fixture, so its per-workflow status dimension IS the
  // day's — which is exactly the agreement the real projection's single fold
  // guarantees (R2 D5-D12 widened this array; R4-1 reads the same entries).
  workflowCounts: [{
    workflowId: WORKFLOW_ID,
    count: countableSurfaces(rawSurfaces).length,
    statusCounts: statusCountsOf(countableSurfaces(rawSurfaces) as { status: string }[]),
  }],
  statusCounts: statusCountsOf(countableSurfaces(rawSurfaces) as { status: string }[]),
  queueSurfaces: rawSurfaces,
  /**
   * D248 — five cards, chosen so the corpus photographs every arm the wire can
   * reach: a busy worker holding two sessions, an idle one holding an odd
   * single tile (it spans both columns), a `starting` daemon that has opened
   * nothing yet, a worker whose process DIED (`crashed`, which is what the
   * attention chip counts), and a live worker carrying a standing `pause`
   * directive beside a state word that is still `idle`.
   */
  workerPools: [],
  workerCards: [
    {
      workerId: "person-lookup-worker-1",
      workflowId: WORKFLOW_ID,
      state: "working",
      directive: "run",
      startedAt: at(12),
      currentRun: { state: "present", runId: uuidOf(2), traceId: traceOf(2) },
      browsers: [
        { sessionId: uuidOf(901), system: "ucpath", openedAt: at(13) },
        { sessionId: uuidOf(902), system: "crm", openedAt: at(21) },
      ],
      leaseVersion: 14,
      revision: 1,
    },
    {
      workerId: "person-lookup-worker-2",
      workflowId: WORKFLOW_ID,
      state: "idle",
      directive: "run",
      startedAt: at(9),
      currentRun: { state: "absent", reason: "no claimable work at this priority" },
      browsers: [{ sessionId: uuidOf(903), system: "ucpath", openedAt: at(10) }],
      leaseVersion: 9,
      revision: 1,
    },
    {
      workerId: "person-lookup-worker-3",
      workflowId: WORKFLOW_ID,
      state: "starting",
      directive: "run",
      startedAt: at(46),
      currentRun: { state: "absent", reason: "no claimed run" },
      browsers: [],
      leaseVersion: 1,
      revision: 1,
    },
    {
      workerId: "person-lookup-worker-4",
      workflowId: WORKFLOW_ID,
      state: "failed",
      directive: "stop",
      startedAt: at(5),
      endedAt: at(33),
      stopReason: "crashed",
      currentRun: { state: "absent", reason: "worker stopped" },
      browsers: [],
      leaseVersion: 6,
      revision: 3,
    },
    {
      workerId: "person-lookup-worker-5",
      workflowId: WORKFLOW_ID,
      state: "idle",
      directive: "pause",
      startedAt: at(2),
      currentRun: { state: "absent", reason: "no claimable work at this priority" },
      browsers: [],
      leaseVersion: 4,
      revision: 1,
    },
  ],
  notifications: [
    {
      kind: "notification",
      notificationId: uuidOf(801),
      actorId: "local-operator",
      severity: "warning",
      title: "A write to UCPath is parked pending proof",
      state: "unread",
      occurredAt: at(45),
      revision: 1,
    },
    {
      kind: "notification",
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

/**
 * A46's deterministic browser-proof profile. It is deliberately separate
 * from the ordinary queue corpus, so adding the pinned safety state cannot
 * redraw unrelated references. The strict parse proves the production wire
 * accepts exactly the closed arm the browser receives.
 */
export const BACKFILL_GAP_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
  ...FIXTURE_DAY_WIRE,
  notifications: [
    ...[803, 804, 805, 806, 807, 808].map((seed, index) => ({
      kind: "backfill-gap",
      notificationId: uuidOf(seed),
      actorId: "local-operator",
      severity: "error",
      title: "Notification history is incomplete",
      state: "pinned",
      occurredAt: at(47 + index),
    } as const)),
    ...FIXTURE_DAY_WIRE.notifications,
  ],
});

export const FIXTURE_IDS = Object.freeze({
  queuedRun: uuidOf(1),
  runningRun: uuidOf(2),
  doneRun: uuidOf(3),
  failedRun: uuidOf(4),
  openGateRun: uuidOf(5),
  /**
   * The SECOND gated run (D226) — a delegated member of the rehire sweep,
   * already in the day wire since the corpus was written and until now with no
   * detail behind it. It carries the OTHER approval ceremony, and reusing an
   * existing row is what keeps the queue references byte-identical: a new
   * top-level row would move every count, every band and every queue capture
   * to photograph a dialog.
   */
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
  /**
   * D225's CATEGORICAL steps — one segment per descriptor-declared category.
   *
   * The corpus served none of these until now, so `Timeline` took its
   * `!categorical` arm for every reference and the strip the run-detail panel
   * ACTUALLY draws for a composed graph — the segment button, its member
   * disclosure, the `×N` marker, the replayed tone and the two-half axis — had
   * never been photographed at all. Every one of those is a decision about
   * markup (D273 item 2), which is exactly the kind a screenshot is supposed to
   * hold and a fold cannot see.
   */
  readonly steps?: readonly TimelineStepWire[];
  readonly dataFacts?: number;
  /**
   * An explicit advertisement, for a state the status alone cannot imply. A
   * `blocked` row is `parked-write` OR `interrupted` — the lifecycle knows and
   * the coarse queue status does not (the real `availableSections` reads
   * `authority.lifecycle`, not `header.status`), so the corpus states it.
   */
  readonly sections?: readonly string[];
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
      ...(input.steps === undefined ? {} : { steps: input.steps }),
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
    availableSections: input.sections ?? (input.status === "failed"
      ? ["logs", "receipt", "context-data", "context-attempts", "failure"]
      : ["logs", "receipt", "context-data", "context-attempts"]),
  });
}

/**
 * The gate NODE's id — what the `identity-gate` SECTION is keyed by, and what a
 * `resolve-gate` command targets. It is deliberately not the same value as the
 * run detail's `gate.gateId`, which the server derives as a deterministic uuid
 * per `(run, gate)` for the timeline; the fixture carries both, exactly as the
 * two wires do.
 */
const GATE_NODE_ID = "identity-approval";

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
  /*
    THE GATED RUN (ref write-safety §14.4, D226). The corpus has photographed this run's
    open-gate CARD since it was written and never served the section behind it,
    so the decision card drew no way to answer it and the three ceremonies
    §14.6 risk 1 exists to enforce were unphotographed. It advertises
    `identity-gate` now, and the section carries a packet built by the
    production fold — see `fixture-gate.ts` for why the shape is derived rather
    than authored.
  */
  [FIXTURE_IDS.openGateRun]: detailOf({
    seed: 5, panelKind: "run", title: "Blirea, Glaundi", status: "awaiting-approval",
    gate: { state: "open", gateId: uuidOf(105), label: "identity-review", openedAt: at(49), revision: 5 },
    outcome: STILL_RUNNING,
    timeline: [
      { seed: 5, minute: 47, label: "searching", state: "done" },
      { seed: 5, minute: 49, label: "gate:identity-review", state: "blocked" },
    ],
    sections: ["logs", "receipt", "context-data", "context-attempts", "identity-gate"],
  }),
  /*
    The SECOND ceremony, on a delegated member. The names on this one do not
    match at all — `T002173685`'s own shape — so `deriveApprovalShape` returns
    `type-the-eid` and the operator must state the EID rather than recognise it.
  */
  [FIXTURE_IDS.gateTypedEidRun]: detailOf({
    seed: 44, panelKind: "member", title: "Blirea, Glaundi", status: "awaiting-approval",
    gate: { state: "open", gateId: uuidOf(144), label: "identity-review", openedAt: at(24), revision: 44 },
    outcome: STILL_RUNNING,
    timeline: [
      { seed: 44, minute: 22, label: "searching", state: "done" },
      { seed: 44, minute: 24, label: "gate:identity-review", state: "blocked" },
    ],
    sections: ["logs", "receipt", "context-data", "context-attempts", "identity-gate"],
  }),
  /*
    THE PARKED WRITE (ref write-safety §4.1, W2). The one lifecycle whose ordinary
    controls are refused by name, and — until this reference existed — the one
    the corpus had never opened at all: the queue photographed its `blocked`
    row from the day the corpus was written, and nothing had ever asked what
    the panel behind it drew. A run is NOT terminal while a write is parked, so
    its outcome is absent with the reason and its receipt section is not
    advertised: a receipt states a settled verdict and this run has none.
  */
  [FIXTURE_IDS.parkedRun]: detailOf({
    seed: 6, panelKind: "run", title: "EID 10777012", status: "blocked",
    gate: NO_GATE,
    outcome: absent("a write to UCPath is fenced and unresolved; the run is stopped"),
    timeline: [
      { seed: 6, minute: 44, label: "searching", state: "done" },
      { seed: 6, minute: 45, label: "terminate", state: "blocked" },
    ],
    sections: ["logs", "context-data", "context-attempts", "parked-write"],
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
  /*
    THE CATEGORICAL STRIP (D225), on the run it was written for.

    D225 exists because the composed separations graph drew eighteen truncated
    stubs, and the sweep is the only fixture run whose shape is a composed
    graph — so it is the one that carries `steps`. Every state the strip tones
    differently is here on purpose: `done` with a measurement, `done` whose
    category re-ran (the `×N` marker a gate park/resume produces, folded into
    ONE segment rather than drawn twice), `active`, `replayed` (D259 — EVERY
    member replayed, so no member and therefore no category has a duration to
    print), and `pending`. A strip photographed only in `done` would prove
    nothing about the four tones beside it.
  */
  [FIXTURE_IDS.groupOf13]: detailOf({
    seed: 70, panelKind: "group", title: "Separation audit — August", status: "partial",
    gate: NO_GATE, outcome: absent("members are still executing"),
    timeline: [
      { seed: 70, minute: 10, label: "fan-out", state: "done" },
      { seed: 70, minute: 14, label: "members", state: "active" },
    ],
    steps: [
      {
        label: "Identity check",
        state: "done",
        durationSec: 46,
        members: [
          { label: "Person lookup", state: "done", durationSec: 31 },
          { label: "Identity approval", state: "done", durationSec: 15 },
        ],
      },
      {
        label: "UCPath termination",
        state: "done",
        durationSec: 168,
        // The gate parked and resumed, so the `always-rerun` node executed
        // twice. It is ONE category with `×2`, not two segments.
        executions: 2,
        members: [
          { label: "Open the termination", state: "done", durationSec: 122 },
          { label: "Confirm the effective date", state: "done", durationSec: 46 },
        ],
      },
      {
        label: "Kuali finalization",
        state: "active",
        members: [{ label: "Finalize the separation document", state: "active" }],
      },
      {
        label: "Separation timecard",
        state: "replayed",
        // No `durationSec`: a replay emits no span, and `took 0s` is the exact
        // lie D259 removed from this surface.
        members: [
          { label: "Read the timecard", state: "replayed", replayedFrom: { attempt: 1, claimGeneration: 2 } },
          { label: "Close the pay period", state: "replayed", replayedFrom: { attempt: 1, claimGeneration: 2 } },
        ],
      },
      {
        label: "Separation document",
        state: "pending",
        members: [{ label: "File to OnBase", state: "pending" }],
      },
    ],
  }),
});

/* ── lazy sections ───────────────────────────────────────────────────────── */

interface NoteSeed {
  readonly level: "info" | "warning" | "error";
  readonly minute: number;
  readonly message: string;
}

/**
 * A LIVE combined log page, built the way the server builds one (D270 / L3).
 *
 * `buildRunSection`'s `logs` arm composes `rows` FIRST — one row per ordered
 * log entry, a note entry becoming a `kind: "note"` row whose `logId` is the
 * note's own id — and then derives `notes` from those rows as the exact
 * compatibility mirror. This fixture does the same, in that order, because the
 * live renderer (`logRowsOf` → `requireLiveLogRows`) reads `rows` and THROWS
 * when a live page omits them: a page authored the other way round is not a
 * thinner fixture, it is a screen that unmounts before anything is asserted.
 *
 * `rows` is optional on the wire only so a frozen archive written before this
 * vocabulary stays readable, which is why `NotePageSchema.parse` alone cannot
 * catch the omission — `requireLiveRows` below is the half that can.
 */
function notePageOf(seed: number, notes: readonly NoteSeed[]): z.infer<typeof NotePageSchema> {
  const rows = notes.map((note, index) => ({
    kind: "note" as const,
    logId: uuidOf(seed * 1000 + index + 1),
    sequence: index,
    note: {
      noteId: uuidOf(seed * 1000 + index + 1),
      runId: uuidOf(seed),
      sequence: index,
      at: at(note.minute, index),
      level: note.level,
      message: note.message,
    },
  }));
  return requireLiveRows(NotePageSchema.parse({
    runId: uuidOf(seed),
    rows,
    notes: rows.map((row) => row.note),
    nextCursor: { state: "absent", reason: "end-of-page" },
  }));
}

/**
 * Fail loud when an authored LIVE page carries the archive-only shape.
 *
 * Every page this adapter serves answers a live `?section=logs` query, so the
 * optional arm of the wire is never the right one here. Asserting it at the
 * point of authorship names the fixture; discovering it in the browser costs a
 * silent unmount and a theme assertion blaming the capture.
 */
function requireLiveRows(page: z.infer<typeof NotePageSchema>): z.infer<typeof NotePageSchema> {
  if (page.rows === undefined) {
    throw new Error(
      `fixture log page for run ${String(page.runId)} omits rows; a live log page must carry the `
      + "combined row vocabulary the renderer reads, and the notes-only shape belongs to frozen archives",
    );
  }
  return page;
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
      state: "present",
      bundleId: FIXTURE_DIAGNOSTIC_BUNDLE.bundleId,
    },
    occurredAt: at(35),
  };
}

/** A locked context-data row, the fixture's default (2i-C wire shape). */
type DataEntrySeed = {
  label: string;
  valueRedacted: string;
  edit?: Record<string, unknown>;
  /** W2: the fact's own provenance, when the producing checkpoint carried one. */
  observedAt?: string;
  source?: "live" | "derived" | "operator";
  correctedAt?: string;
};

const LOCKED_NOT_DECLARED = {
  state: "locked",
  reason: "not declared correctable by this workflow",
} as const;

/**
 * The parked write, in the durable facts the real query projects (ref write-safety §4.1).
 *
 * Adapter #1 AUTHORS this payload, and `sectionsOf` parses every section it
 * returns through `RunDetailSectionResponseSchema` — so the bytes the corpus
 * photographs are bytes the real wire would accept, including the schema's own
 * `superRefine`: `parkedAt` may not precede `fencedAt`, and EVERY served action
 * must target this exact intent and generation. A hand-rolled blob that drifted
 * from either would fail here rather than in a screenshot.
 *
 * The two action descriptors are the server's, word for word
 * (`parkedWriteActions` in `src/server/dashboard/queries/run-detail.ts`). They
 * are copied rather than imported because that function is not exported and
 * takes an authority `RunRecord` this adapter has none of — so the copy is
 * PINNED to the server's, modulo the identities the two adapters legitimately
 * differ on, by `tests/unit/server/parked-write-section.test.ts`. A copy nobody
 * compares is a reference that documents last month's copy.
 */
const PARKED_WRITE_INTENT_ID = uuidOf(906);
const PARKED_WRITE_TARGET = { writeIntentId: PARKED_WRITE_INTENT_ID, intentGeneration: 1 };
const PARKED_WRITE_SYSTEM = "ucpath";
const PARKED_WRITE_REVISION = 6;

export const FIXTURE_PARKED_WRITE = {
  runId: FIXTURE_IDS.parkedRun,
  writeIntentId: PARKED_WRITE_INTENT_ID,
  generation: 1,
  runAttempt: 1,
  system: PARKED_WRITE_SYSTEM,
  taskId: "ucpath/terminate-person",
  idempotencyKeyDigest: "7".repeat(64),
  fencedAt: at(44),
  parkedAt: at(45),
  parkedCode: "unknown",
  // The KERNEL's own sentence — ref write-safety §4's `park()` interpolates the driver's
  // thrown error into it. The surface prints it verbatim and writes none of
  // its own, which is what this reference is here to photograph.
  parkedMessage:
    "the UCPath save was submitted and the confirmation page never rendered: read-back timed out "
    + "after 30000ms at ucpath.termination-confirmed",
  subject: {
    state: "subject-match",
    proofId: uuidOf(907),
    observedAt: at(44),
    evidence: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "3".repeat(64),
      displaySuffix: "7012",
    },
  },
  /**
   * D245 — what a confirmed-present resolution has to carry. The server derives
   * this from the commit contract's own `completion.proofSchema`
   * (`describeProofShape`); this adapter states the same shape by hand for the
   * fixture's own `ucpath/terminate-person`, mirroring the real
   * `UcpathTerminationProofSchema`: two literals the schema pins, an EID and a
   * date under their own patterns, the receipt, the closed approval-status
   * vocabulary, and the name the page displayed.
   *
   * Photographing the SERVED arm rather than the `unavailable` one is
   * deliberate. Before D245 this reference recorded the present arm as a
   * disabled control with a refusal — which is exactly the corpus-records-a-
   * defect shape D187 found — and a parked run in the shipped build now gets
   * the form.
   */
  proofContract: {
    state: "served",
    commitTaskId: "ucpath/terminate-person",
    completionKind: "save-verify",
    schemaHash: "c".repeat(64),
    fields: [
      { kind: "fixed", path: "kind", value: "ucpath-termination" },
      { kind: "text", path: "emplId", pattern: "^10\\d{6}$", serverOnlyRules: false },
      {
        kind: "text",
        path: "effectiveDate",
        pattern: "^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$",
        serverOnlyRules: false,
      },
      { kind: "text", path: "transactionId", pattern: "^T\\d{6,}$", serverOnlyRules: false },
      {
        kind: "choice",
        path: "approvalStatus",
        options: ["Approved", "Denied", "Error", "Manually Processed", "Pending", "Pushed Back"],
      },
      { kind: "text", path: "displayedName", minLength: 1, serverOnlyRules: false },
      { kind: "fixed", path: "source", value: "ss-smart-hr-detail-read" },
    ],
  },
  actions: [
    {
      key: "resolve-write-present",
      label: "I confirmed it IS there",
      detail: "Record the transaction you found, with its proof. The run settles as committed and never clicks again.",
      intent: "warning",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-present",
      expectedVersion: PARKED_WRITE_REVISION,
      confirm: {
        title: "Confirm the transaction exists",
        body: `This files ${PARKED_WRITE_SYSTEM} transaction ${PARKED_WRITE_INTENT_ID} as committed on this run's `
          + "evidence. If it is not actually there, the run finishes reporting work nobody did.",
        confirmLabel: "It is there",
        tone: "destructive",
      },
      writeTarget: PARKED_WRITE_TARGET,
    },
    {
      key: "resolve-write-absent",
      label: "I confirmed it is NOT there",
      detail: "Release the fence so the run may attempt the write again under a new generation.",
      intent: "primary",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-absent",
      expectedVersion: PARKED_WRITE_REVISION,
      confirm: {
        title: "Confirm the transaction is absent",
        body: `This authorizes a fresh attempt against ${PARKED_WRITE_SYSTEM}. If the transaction does exist, `
          + "the retry submits it a SECOND time.",
        confirmLabel: "It is not there",
        tone: "destructive",
      },
      writeTarget: PARKED_WRITE_TARGET,
    },
  ],
} as const;

function sectionsOf(
  seed: number,
  notes: readonly NoteSeed[],
  dataEntries: readonly DataEntrySeed[],
  failureId?: string,
  editing?: Record<string, unknown>,
  parkedWrite?: unknown,
  identityGate?: unknown,
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
          // OMITTED, never nulled — the wire's members are optional and an
          // absent one is what "this build cannot date this value" looks like.
          ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
          ...(entry.source === undefined ? {} : { source: entry.source }),
          ...(entry.correctedAt === undefined ? {} : { correctedAt: entry.correctedAt }),
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
  if (parkedWrite !== undefined) {
    sections["parked-write"] = { section: "parked-write", payload: parkedWrite };
  }
  if (identityGate !== undefined) {
    // Wrapped in the wire's own resource envelope: the section is
    // `wireResourceSchema(IdentityGateDetailWireSchema)`, so the corpus serves
    // an `available` arm and the panel's `missing`/`error` arms stay reachable
    // for a build that cannot describe a gate.
    sections["identity-gate"] = {
      section: "identity-gate",
      payload: { state: "available", value: identityGate },
    };
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(sections).map(([name, value]) => [name, RunDetailSectionResponseSchema.parse(value)]),
  ));
}

/**
 * THE TWO GATED PACKETS (ref write-safety §14.4/§14.6, D226).
 *
 * Their ceremonies are DERIVED — `buildFixtureIdentityGate` feeds real inputs
 * to the production fold and `deriveApprovalShape` decides. The only thing that
 * differs between them is the document's own spelling of the name, which is the
 * honest lever: §14.6 makes the shape a server decision precisely so nobody
 * downstream may choose a cheaper control, and a fixture that asserted the
 * shape would photograph its own opinion of that policy.
 */
export const FIXTURE_IDENTITY_GATE = buildFixtureIdentityGate({
  runId: FIXTURE_IDS.openGateRun,
  gateId: GATE_NODE_ID,
  label: "Identity Approval",
  parkedAt: at(49),
  resumeAt: "approval",
  expectedVersion: 5,
  observedAt: at(48),
  // The names agree; a search on the document's name resolves a DIFFERENT
  // person, so the gate asks WHICH — `choose-a-candidate`.
  documentName: "Blirea, Glaundi",
});

export const FIXTURE_IDENTITY_GATE_TYPED_EID = buildFixtureIdentityGate({
  runId: FIXTURE_IDS.gateTypedEidRun,
  gateId: GATE_NODE_ID,
  label: "Identity Approval",
  parkedAt: at(24),
  resumeAt: "approval",
  expectedVersion: 44,
  observedAt: at(23),
  // The names do not match at all — `T002173685`'s shape — so the riskiest
  // ceremony applies and the EID is typed rather than recognised.
  documentName: "Okonkwo, Adaeze",
});

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
    // W2: the same two rows now carry the provenance the wire serves — one a
    // plain live read (clock only, no badge, because `live` is what most rows
    // are and a badge on every row is a badge on none) and one an operator
    // correction, which is the row the `corrected` badge exists for.
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
      observedAt: at(51),
      source: "live",
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
      observedAt: at(50),
      source: "operator",
      correctedAt: at(50),
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
  }, undefined, FIXTURE_IDENTITY_GATE),
  [FIXTURE_IDS.gateTypedEidRun]: sectionsOf(44, [
    { level: "info", minute: 22, message: "Searching UCPath directory for Blirea, Glaundi" },
    { level: "warning", minute: 23, message: "The UCPath detail displays a different name for this EID" },
    { level: "info", minute: 24, message: "identity-review gate opened; the EID must be typed" },
  ], [
    { label: "Selection", valueRedacted: "name mismatch" },
    { label: "Active status", valueRedacted: "pending" },
  ], undefined, {
    state: "locked",
    reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
      + "editing reopens when it parks or finishes",
  }, undefined, FIXTURE_IDENTITY_GATE_TYPED_EID),
  [FIXTURE_IDS.parkedRun]: sectionsOf(6, [
    { level: "info", minute: 44, message: "Searching UCPath directory for EID 10777012" },
    { level: "info", minute: 44, message: "Subject bound: the termination page names the expected EID" },
    { level: "warning", minute: 45, message: "Save submitted; the confirmation page did not render" },
    { level: "warning", minute: 45, message: "Write fenced at generation 1; the run is parked pending proof" },
  ], [
    { label: "Selection", valueRedacted: "exact-match", observedAt: at(44), source: "live" },
    { label: "Termination reason", valueRedacted: "Resign - No Reason Given", observedAt: at(44), source: "derived" },
  ], undefined, {
    // Ref dashboard-surfaces D19: a parked run is not executing, but it is not resumable by a
    // correction either — the kernel's own arm says so, so the fixture does.
    state: "locked",
    reason: "run is parked-write; corrections apply only to a non-executing resumable run",
  }, FIXTURE_PARKED_WRITE),
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
    code: personLookupDescriptor.code,
    label: personLookupDescriptor.label,
    categoryId: personLookupDescriptor.category,
    descriptorFingerprint: CONTRACT_FINGERPRINT,
    availability: { state: "available" },
    // D219 — the served taxonomy fact. The corpus carries one standalone
    // workflow, so nothing here nests under anything.
    role: { kind: "standalone" },
    // D264/D11/C96 — the Run Modal's four start facts, now SERVED rather than read
    // off the bundled descriptor tuple. Projected from the descriptor exactly
    // as `buildBootstrap` projects it, because a fixture that composed its own
    // sentence here would photograph a modal no server can produce.
    start: {
      ...(personLookupDescriptor.summary === undefined
        ? {}
        : { summary: personLookupDescriptor.summary }),
      enqueue: personLookupDescriptor.enqueue,
      // C96's deliberate non-1 producer value. The start-run parity corpus
      // observes this as `Person Lookup v7`, so a client that guesses or
      // hardcodes v1 cannot agree with this fixture's bootstrap document.
      version: 7,
      ...(personLookupDescriptor.surfaces.inputRun === undefined
        ? {}
        : { inputRun: personLookupDescriptor.surfaces.inputRun }),
    },
  }],
  systemInstances: [
    { system: "ucpath", prod: "available", test: { state: "available" } },
    { system: "crm", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "no CRM test instance is configured" } },
  ],
  /*
    The SERVER's own three, spelled by the same shared constants
    `buildBootstrap` spells them with (D274 item 6, ledger 3 SE40–SE42). The
    corpus served a single invented `general` section, so the only Settings
    page it could ever have photographed was the NAMED BUILD GAP arm — "this
    build has no renderer for `general`" — and the three real panes behind the
    gear had never been rendered by the lane at all.
  */
  settingsSections: [
    { id: "storage", label: "Storage health", revision: 1 },
    { id: SETTINGS_SYSTEM_HOSTS_SECTION_ID, label: "System hosts", revision: 1 },
    { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
  ],
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

/* ── settings facts ──────────────────────────────────────────────────────── */

/**
 * `GET /api/v1/settings/facts` — BUILT by the production fold, never authored.
 *
 * `buildSettingsFacts` is the server's own projection of the resolved config
 * and the descriptor tuple (D274 item 6). Hand-writing a host list or a
 * capability row here would photograph the fixture's opinion of those
 * derivations instead of the derivations — the same reason `fixture-gate.ts`
 * builds its packet rather than spelling one.
 *
 * The inputs are the DEFAULTS and the day corpus's one descriptor: an empty
 * env and empty settings resolve to `ConfigSchema`'s shipped hosts, so the
 * System hosts table is the deployment every developer starts from, and the
 * capability row joins the single `workflows[]` entry the bootstrap above
 * serves. `manualClock` pins the resolution instant so nothing here can be
 * dated by the wall clock.
 */
export const FIXTURE_SETTINGS_FACTS: SettingsFactsWire = buildSettingsFacts({
  config: resolveConfig({}, {}, manualClock(new Date(FIXTURE_NOW))),
  descriptors: [personLookupDescriptor],
});

/**
 * The start-picker reference needs the actual registry shape, while the day
 * fixture above intentionally remains the Person Lookup queue corpus. Keeping
 * these as separate profiles prevents a picker-coverage addition from
 * redrawing unrelated queue references.
 *
 * Every role comes from its real `module.ts`, not a fixture-local spelling: in
 * particular, the Kronos timecard is a `timekeeping` harness of `separations`.
 * That cross-category fact is the regression this profile exists to capture.
 */
const START_PICKER_MODULES = Object.freeze([
  personLookupModule,
  separationsKronosTimecardModule,
  separationsKualiReadModule,
  separationsIdentityCheckModule,
  separationsUcpathTerminationModule,
  separationsKualiFinalizationModule,
  separationsModule,
]);

export const FIXTURE_START_PICKER_DESCRIPTOR_HASH = descriptorSetHash(
  START_PICKER_MODULES.map(({ descriptor }) => descriptor.contractFingerprint),
);

export const FIXTURE_START_PICKER_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
  ...FIXTURE_BOOTSTRAP,
  descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
  workflows: START_PICKER_MODULES.map(({ descriptor, role }) => ({
    id: descriptor.id,
    code: descriptor.code,
    label: descriptor.label,
    categoryId: descriptor.category,
    descriptorFingerprint: descriptor.contractFingerprint,
    availability: { state: "available" },
    role,
    start: {
      ...(descriptor.summary === undefined ? {} : { summary: descriptor.summary }),
      enqueue: descriptor.enqueue,
      version: descriptor.version,
      ...(descriptor.surfaces.inputRun === undefined
        ? {}
        : { inputRun: descriptor.surfaces.inputRun }),
    },
  })),
});

/** The start-picker profile's day and bootstrap name the same current descriptor set. */
export const FIXTURE_START_PICKER_DAY_WIRE: DashboardDayWire = DashboardDayWireSchema.parse({
  ...FIXTURE_DAY_WIRE,
  descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
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
