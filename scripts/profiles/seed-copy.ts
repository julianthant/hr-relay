import { lstatSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { runSpanPath, taskSpanPath } from "../../src/backend/logs/span-emitter.js";
import { runQueuedSpanEvent } from "../../src/backend/runs/commands/run-queued-span.js";
import type { RuntimeAdmission } from "../../src/backend/storage/admission/admission.js";
import { acquireRuntimeLifetimeLock, RuntimeAlreadyRunningError } from "../../src/backend/storage/admission/lifetime-lock.js";
import { noSymlinkAncestry } from "../../src/backend/storage/configuration/credential-safe-file.js";
import type { DirectoryIdentity } from "../../src/backend/storage/file-identity.js";
import { hasUnprovedSourceClosure } from "../../src/backend/storage/source-closure.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { notificationTitle } from "../../src/models/dashboard/projection.js";
import { PACIFIC_TIME_ZONE, searchPartitionDay } from "../../src/models/dashboard/search-calendar.js";
import { SpanEventWireSchema } from "../../src/models/events/types.js";
import { NotificationRecordSchema, NotificationTriggerSchema } from "../../src/models/notifications/notifications.js";
import { RunRecordSchema, type RunLifecycle, type RunRecord } from "../../src/models/run/record.js";
import { RunSessionRecordSchema } from "../../src/models/run/session.js";
import { deriveIdempotencyKeyDigest, deriveWriteBindingProofDigest, WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../src/rules/write-safety/write-safety.js";
import { FailureRecordSchema } from "../../src/models/trust/failure.js";
import { deriveSchemaHash } from "../../src/models/validation/schema-bound-value.js";
import { canonicalInputSamples } from "../../src/models/workflow/canonical-input.js";
import { I9_CHECK_START_EXAMPLE } from "../../src/models/workflows/i9-check/start.js";
import { OCR_INPUT_EXAMPLE } from "../../src/models/workflows/ocr/input.js";
import { ONBOARDING_INPUT_EXAMPLE } from "../../src/models/workflows/onboarding/input.js";
import { WorkStudyCanonicalInput } from "../../src/models/workflows/work-study/input.js";
import { deriveStableUuid, deriveTraceId } from "../../src/rules/identity/identifiers.js";
import { BrowserSystemIdSchema, LOCAL_OPERATOR_ACTOR_ID, NodeIdSchema } from "../../src/rules/identity/ids.js";
import { capturedInstantClock, systemClock } from "../../src/rules/time/clock.js";
import { sha256Hex } from "../../src/rules/validation/sha256.js";
import { descriptorRuntimeNodes, workflowProjections, type AnyWorkflowDescriptor } from "../../src/workflow-kit/workflow.js";
import { CopySampleSessionSchema, SAMPLE_WORKER_ORDINAL_FLOOR, sampleWorkerId, type CopySampleSession } from "../../src/backend/app/composition/dashboard/copy-samples.js";
import configuredWorkflowSources from "../../config/dashboard-workflow-sources.json" with { type: "json" };

const CopyProfileSchema = z.enum(["development", "staging"]);
type CopyProfile = z.infer<typeof CopyProfileSchema>;
const seedStates = ["succeeded", "failed", "waiting", "paused", "cancelled", "needs-review"] as const;
type SeedState = typeof seedStates[number];
/** Today's live queue: the history states plus the ones a worker holds. */
const liveStates = ["queued", "running", "cancelling", "needs-duo", ...seedStates] as const;
type LiveState = typeof liveStates[number];
type SeedSlot = Readonly<{ workflow: AnyWorkflowDescriptor; state: SeedState; day: string }>
  | Readonly<{ workflow: AnyWorkflowDescriptor; state: LiveState; day: string; live: Readonly<{ order: number; workerId?: string; sessionId?: string }> }>;
const dayMs = 86_400_000;
const workflowSources = z.record(z.string(), z.enum(["served", "hidden"])).parse(configuredWorkflowSources);

/** The instant today began in Pacific time; on a DST day wall-clock hours and elapsed hours differ by one. */
export function pacificDayStart(now: Date): number {
  const day = searchPartitionDay(now);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC_TIME_ZONE, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(now);
  const part = (type: "hour" | "minute" | "second") => Number(parts.find(entry => entry.type === type)?.value);
  const start = now.getTime() - now.getUTCMilliseconds() - ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000;
  if (searchPartitionDay(new Date(start)) !== day) return start + 3_600_000;
  return searchPartitionDay(new Date(start - 1)) === day ? start - 3_600_000 : start;
}

function dateAtOffset(today: number, daysAgo: number): string {
  return new Date(today - daysAgo * dayMs).toISOString().slice(0, 10);
}

function representedState({ lifecycle, pause }: Pick<RunRecord, "lifecycle" | "pause">): SeedState | undefined {
  if (lifecycle.state === "parked-write" || lifecycle.state === "terminal" && lifecycle.outcome === "interrupted") return "needs-review";
  if (pause?.state === "paused") return "paused";
  if (lifecycle.state === "parked-gate") return "waiting";
  if (lifecycle.state !== "terminal") return undefined;
  if (lifecycle.outcome === "done") return "succeeded";
  if (lifecycle.outcome === "failed" || lifecycle.outcome === "cancelled") return lifecycle.outcome;
  return undefined;
}

function planSeedRuns(now: Date, existing: readonly RunRecord[], descriptors: readonly AnyWorkflowDescriptor[]): readonly SeedSlot[] {
  const today = Date.parse(`${searchPartitionDay(now)}T00:00:00Z`);
  const days = Array.from({ length: 90 }, (_, daysAgo) => dateAtOffset(today, daysAgo));
  const weekByDay = new Map(days.map((day, offset) => [day, Math.floor(offset / 7)]));
  const presentDays = new Set<string>();
  const presentWeeks = new Map<string, Set<number>>();
  const recentStates = new Map<string, Set<SeedState>>();
  for (const descriptor of descriptors) {
    presentWeeks.set(descriptor.id, new Set());
    recentStates.set(descriptor.id, new Set());
  }
  for (const run of existing) {
    const day = searchPartitionDay(new Date(run.envelope.enqueuedAt));
    const week = weekByDay.get(day);
    if (week === undefined) continue;
    presentDays.add(day);
    presentWeeks.get(run.envelope.workflow)?.add(week);
    const state = representedState(run);
    if (week === 0 && state !== undefined) recentStates.get(run.envelope.workflow)?.add(state);
  }

  const slots: SeedSlot[] = [];
  const add = (workflow: SeedSlot["workflow"], state: SeedState, day: string) => {
    slots.push({ workflow, state, day });
    presentDays.add(day);
  };
  const settled = ["succeeded", "succeeded", "failed", "cancelled", "needs-review"] as const;
  for (const [index, descriptor] of descriptors.entries()) {
    for (const [stateIndex, state] of seedStates.entries()) {
      if (!recentStates.get(descriptor.id)?.has(state)) add(descriptor, state, days[1 + (index + stateIndex) % 6]);
    }
    for (let offset = 7; offset < days.length; offset += 7) {
      if (presentWeeks.get(descriptor.id)?.has(offset / 7)) continue;
      const span = Math.min(7, days.length - offset);
      add(descriptor, settled[(index + offset) % settled.length], days[offset + index % span]);
    }
  }
  for (const [offset, day] of days.entries()) {
    if (presentDays.has(day)) continue;
    add(descriptors[offset % descriptors.length], settled[offset % settled.length], day);
  }
  for (const [index, state] of seedStates.entries()) {
    if (!slots.some(slot => slot.state === state)) add(descriptors[index % descriptors.length], state, days[index]);
  }
  return slots;
}

/** The sample worker that holds a claimed state; the one on the cancelling run is stopping. */
const heldBy = (state: LiveState) => state === "running" || state === "needs-duo" ? "busy" as const : state === "cancelling" ? "stopping" as const : undefined;
const spareWorkers = ["idle", "waiting", "starting", "stopped"] as const;

type QueueCapabilities = (workflowId: string) => Readonly<{ groupedBatchLayout?: boolean }> | undefined;

/** Every live state for every served workflow today, the sample workers that hold the claimed ones, and a Partial group. */
function planLiveRuns(now: Date, descriptors: readonly AnyWorkflowDescriptor[], capabilities: QueueCapabilities, profileId: string) {
  const day = searchPartitionDay(now);
  let ordinal = SAMPLE_WORKER_ORDINAL_FLOOR;
  const slots: SeedSlot[] = [];
  const batches: { sessionId: string; workflow: AnyWorkflowDescriptor }[] = [];
  const sessions: { session: Omit<CopySampleSession, "browsers" | "runId">; state: LiveState | typeof spareWorkers[number]; workflow: AnyWorkflowDescriptor }[] = [];
  for (const workflow of descriptors) {
    const browsers = workflowProjections(workflow).systems.length > 0;
    for (const [order, state] of liveStates.entries()) {
      // A Duo wait needs a browser; without one the run reads as a second Running row.
      if (state === "needs-duo" && !browsers) continue;
      const held = heldBy(state);
      if (held === undefined) { slots.push({ workflow, state, day, live: { order } }); continue; }
      const session = { workflow: workflow.id, ordinal: ++ordinal, state: held, startedAt: now.toISOString() };
      slots.push({ workflow, state, day, live: { order, workerId: sampleWorkerId(session) } });
      sessions.push({ session, state, workflow });
    }
    if (capabilities(workflow.id)?.groupedBatchLayout === true) {
      // A finished group with a done and a cancelled member reads Partial.
      const sessionId = deriveStableUuid(seedNamespace, `batch/${profileId}/${workflow.id}/${day}`);
      for (const state of ["succeeded", "cancelled"] as const) slots.push({ workflow, state, day, live: { order: liveStates.length, sessionId } });
      batches.push({ sessionId, workflow });
    }
  }
  // Spare cards go to workflows with browsers, so each card shows its sign-in and last browsers.
  const browsered = descriptors.filter(workflow => workflowProjections(workflow).systems.length > 0);
  for (const [index, state] of spareWorkers.entries()) {
    const workflow = browsered[index % browsered.length];
    sessions.push({ session: { workflow: workflow.id, ordinal: ++ordinal, state, startedAt: now.toISOString() }, state, workflow });
  }
  return { slots, sessions, batches };
}

/** A worker's browsers: busy on its first system, ready on the rest; a Duo wait holds its first system's sign-in. */
function sampleSession({ session, state, workflow }: ReturnType<typeof planLiveRuns>["sessions"][number], runId: string | undefined): CopySampleSession {
  const systems = BrowserSystemIdSchema.array().parse(workflowProjections(workflow).systems);
  const browsers = systems.map((system, index) => ({ system, duo: state === "needs-duo" && index === 0,
    health: index > 0 || state === "idle" || state === "stopped" ? "authenticated" as const
      : state === "needs-duo" || state === "starting" || state === "waiting" ? "starting" as const : "unknown" as const }));
  return CopySampleSessionSchema.parse({ ...session, ...(runId === undefined ? {} : { runId }), browsers });
}

const seedNamespace = "relay-copy-seed";
const seedDigest = sha256Hex(seedNamespace);

const seedInputs = new Map<string, unknown>([
  ["person-lookup", { name: "Example, Person" }],
  ["separations", { documentNumber: "4510", timekeeperName: "Synthetic Timekeeper", timekeeperInitials: "ST" }],
  ["onboarding", ONBOARDING_INPUT_EXAMPLE],
  ["work-study", canonicalInputSamples(WorkStudyCanonicalInput)[0]],
  ["i9-check-start", I9_CHECK_START_EXAMPLE],
  ["crm-doc-download", { people: "fixture@example.test" }],
  ["emergency-contact", {
    document: OCR_INPUT_EXAMPLE.document, readingId: OCR_INPUT_EXAMPLE.readingId, reading: OCR_INPUT_EXAMPLE.reading,
    roster: null, onbaseFiling: "skip",
  }],
]);

function seedInput(workflow: AnyWorkflowDescriptor): RunRecord["input"] {
  const raw = seedInputs.get(workflow.id);
  if (raw === undefined) throw new SeedCopyError(`seed-copy-input-missing: ${workflow.id}`);
  const protectedBindings = workflow.protectedInputs?.map(declaration => ({
    ...declaration, kind: "protected-store" as const,
    valueId: deriveStableUuid(seedNamespace, `${workflow.id}/${declaration.name}`),
  })) ?? [];
  return RunRecordSchema.shape.input.parse({
    raw,
    parsed: { schemaHash: deriveSchemaHash(workflow.canonicalInput, "output"), protectedBindings,
      value: workflow.canonicalInput.parse(workflow.input.parse(raw)) },
    ingressSchemaHash: deriveSchemaHash(workflow.input, "input"),
  });
}

const parkedTaskId = "ucpath/create-termination";

/** The parked intent and its attempt a review card reads. Synthetic: the sample run refuses every answer. */
function seedParkedWrite({ run, nodeId, parked, id, at }: Readonly<{ run: RunRecord; nodeId: string; at: string;
  parked: Readonly<{ writeIntentId: string; code: "unknown"; message: string }>; id: (kind: string) => string }>) {
  const { runId, itemId, workflow, traceId } = run.envelope;
  const subject = { kind: "person", identifierKind: "eid", bindingDigest: seedDigest, displaySuffix: "SYNTHETIC" } as const;
  const bindingProof = { kind: "subject-match", version: 1, proofId: id("proof"), runId, attempt: 1, leaseId: id("lease"), taskId: parkedTaskId,
    observationId: "ucpath.termination.subject", pageStateId: "ucpath.termination-ready", expected: subject, observed: subject, match: "match",
    observedAt: at, afterPrepareSpanPath: `${traceId}/${nodeId}/prepare` } as const;
  const bound = { writeIntentId: parked.writeIntentId, generation: 1, runId, runAttempt: 1, bindingProof,
    bindingProofDigest: deriveWriteBindingProofDigest(bindingProof), fencedAt: at };
  const authorityReason = { version: 1, code: "inline-recovery-unknown", evidence: { kind: "probe", digest: seedDigest } } as const;
  const idempotencyKey = `${seedNamespace}|SYNTHETIC|${runId}`;
  const intent = WriteIntentRecordSchema.parse({ ...bound, workflowId: workflow, itemId, taskId: parkedTaskId, system: "ucpath", idempotencyKey,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", idempotencyKey), currentAttemptId: id("write-attempt"), version: 1,
    createdAt: at, updatedAt: at, status: "parked", parkedCode: parked.code, message: parked.message, authorityReason });
  const attempt = WriteAttemptRecordSchema.parse({ ...bound, writeAttemptId: id("write-attempt"), leaseId: bindingProof.leaseId,
    outcome: { state: "parked", code: parked.code, message: parked.message, authorityReason }, recordedAt: at });
  return { intent, attempt, nodeId: NodeIdSchema.parse(nodeId) };
}

function seedRun(slot: SeedSlot, profileId: string, now: Date, buildId: string) {
  const { workflow, day, state } = slot;
  const live = "live" in slot ? slot.live : undefined;
  const key = `${profileId}/${workflow.id}/${day}/${live === undefined ? "" : live.sessionId === undefined ? "live/" : "batch/"}${state}`;
  const id = (kind: string) => deriveStableUuid(seedNamespace, `${kind}/${key}`);
  const hash = sha256Hex(key);
  const durationMs = 35_000 + Number.parseInt(hash.slice(0, 4), 16) * 5;
  const minuteOffsetMs = Number.parseInt(hash.slice(8, 12), 16) % 3_600_000;
  // A live run started minutes ago, never before today began in Pacific time.
  const timeMs = live === undefined ? Math.min(now.getTime(), Date.parse(`${day}T19:00:00.000Z`) + minuteOffsetMs)
    : Math.max(pacificDayStart(now), now.getTime() - (live.order + 2) * 240_000);
  const enqueuedAt = new Date(timeMs).toISOString();
  const settledAt = new Date(Math.min(now.getTime(), timeMs + durationMs)).toISOString();
  const runId = id("run");
  const traceId = deriveTraceId(workflow.code, runId, capturedInstantClock(enqueuedAt));
  const title = `Synthetic ${workflow.label} ${live === undefined ? day : "today"} ${state}`;
  const runtimeNodes = descriptorRuntimeNodes(workflow);
  const gate = runtimeNodes.find(node => node.kind === "gate" && node.resolvedBy === "operator");
  // Gates and child runs own no task span.
  const spanless = new Set<string>(runtimeNodes.filter(node => node.kind === "gate" || node.kind === "child-run").map(node => node.id));
  const steps = workflow.timeline.flatMap(category => category.nodes).filter(node => !spanless.has(node.id));
  // Today's separation under review is parked on its termination write; history and other workflows stay interrupted.
  const writeNode = live === undefined || state !== "needs-review" ? undefined
    : runtimeNodes.find(node => node.kind === "transaction" && node.commit.uses.id === parkedTaskId);
  const writeStep = steps.findIndex(node => node.id === writeNode?.id);
  if (writeNode !== undefined && writeStep < 0) throw new SeedCopyError(`seed-copy-write-step-missing: ${workflow.id}`);
  // A Duo wait holds the first sign-in; any other state has at least one step behind it.
  const current = writeNode !== undefined ? writeStep : state === "needs-duo" ? 0 : Math.max(Math.min(1, steps.length - 1),
    live?.workerId !== undefined ? Math.floor(steps.length / 2) : Number.parseInt(hash.slice(4, 8), 16) % steps.length);
  const step = steps[current];
  // A waiting run stops at its gate: every step before it is done.
  const timelineNodes = workflow.timeline.flatMap(category => category.nodes);
  const stepsBeforeGate = timelineNodes.slice(0, Math.max(0, timelineNodes.findIndex(node => node.id === gate?.id))).filter(node => !spanless.has(node.id)).length;
  const claim = { workerId: seedNamespace, claimGeneration: 1 };
  const completionFields = { schemaVersion: 1, expectedVersion: 2, claim, authorizedAt: settledAt } as const;
  const failure = state !== "failed" ? undefined : FailureRecordSchema.parse({
    failureId: id("failure"), fingerprint: sha256Hex(`${seedNamespace}/${workflow.id}/${step?.id ?? "run"}`),
    runId, traceId, attempt: 1, workflowId: workflow.id, nodeId: step?.id,
    code: "RUN_INTERRUPTED_BY_CRASH", summary: "Synthetic example failure", transient: false, writeState: "not-attempted",
    causeChain: [{ code: "RUN_INTERRUPTED_BY_CRASH", summary: "Synthetic example failure", role: "primary", transient: false }],
    remediation: [{ kind: "no-safe-action", message: "This run is synthetic history." }], occurredAt: settledAt,
  });
  const outcome = { succeeded: "done", failed: "failed", cancelled: "cancelled", "needs-review": "interrupted" } as const;
  const claimed = live?.workerId === undefined ? undefined : { workerId: live.workerId, claimedAt: new Date(Math.min(now.getTime(), timeMs + 1000)).toISOString(), heartbeatAt: now.toISOString() };
  const parked = { writeIntentId: id("write-intent"), code: "unknown", message: "Synthetic example: the save could not be confirmed." } as const;
  const lifecycle: z.input<typeof RunRecordSchema>["lifecycle"] = writeNode !== undefined
    ? { state: "parked-write", writeIntentId: parked.writeIntentId, intentGeneration: 1, parkedAt: settledAt, code: parked.code, message: parked.message }
    : claimed !== undefined
    ? { state: "running", ...claimed, ...(step === undefined ? {} : { currentNodeId: step.id }) }
    : state === "queued" ? { state: "queued" }
    : state === "waiting"
    ? { state: "parked-gate", gateId: gate?.id ?? "synthetic-review", resumeAt: step?.id ?? "synthetic-review", parkedAt: settledAt }
    : state === "paused" ? { state: "queued" }
    : state === "running" || state === "cancelling" || state === "needs-duo" ? (() => { throw new SeedCopyError(`seed-copy-worker-missing: ${state}`); })()
    : { state: "terminal", outcome: outcome[state] satisfies Extract<RunLifecycle, { state: "terminal" }>["outcome"], endedAt: settledAt,
      ...(failure === undefined ? {} : { failureId: failure.failureId, errorSummary: failure.summary }) };
  const run = RunRecordSchema.parse({
    envelope: { runId, workflow: workflow.id, itemId: id("item"), traceId, descriptorVersion: workflow.version,
      contractFingerprint: workflow.contractFingerprint, buildId, configFingerprint: seedDigest,
      configSnapshotId: id("config"), resolvedInstance: {}, shape: "single", priority: "interactive", dryRun: writeNode === undefined, attempt: 1, enqueuedAt },
    input: seedInput(workflow),
    lifecycle, claimGeneration: state === "queued" ? 0 : 1, displayName: title,
    ...(live?.sessionId === undefined ? {} : { sessionId: live.sessionId }),
    ...(state === "cancelling" ? { cancelRequested: true } : {}),
    ...(state === "paused" ? { pause: { state: "paused", commandId: id("pause"), requestedAt: settledAt, pausedAt: settledAt } } : {}),
    ...(state === "succeeded" ? { completion: { ...completionFields, kind: "done", resultDigest: seedDigest } } : {}),
    ...(failure === undefined ? {} : { completion: { ...completionFields, kind: "failed", failureId: failure.failureId } }),
    version: 3, createdAt: enqueuedAt, updatedAt: settledAt,
  });
  const spanPath = runSpanPath(run.envelope.traceId);
  const common = { workflow: workflow.id, runId, traceId, attempt: run.envelope.attempt, pid: 1 };
  const events: Record<string, unknown>[] = [{ ...runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title }), pid: 1 }];
  if (run.claimGeneration > 0 && step !== undefined) {
    const startedMs = Date.parse(claimed?.claimedAt ?? enqueuedAt);
    events.push({ ...common, t: "run.claimed", workerId: claimed?.workerId ?? claim.workerId, claimGeneration: 1, ts: new Date(startedMs).toISOString(), spanPath });
    // Steps before the current one finished. A held run's current step is open, a paused or parked run has not reached the next one.
    const reached = state === "succeeded" ? steps.length : state === "waiting" && gate !== undefined ? stepsBeforeGate : state === "paused" || state === "waiting" ? Math.max(1, current) : current + 1;
    const stepMs = (Date.parse(claimed === undefined ? settledAt : now.toISOString()) - startedMs) / reached;
    const outcome = run.lifecycle.state === "terminal" ? run.lifecycle.outcome : undefined;
    for (const [position, node] of steps.slice(0, reached).entries()) {
      let at = startedMs + position * stepMs;
      const task = { ...common, kind: "task", parentSpanPath: spanPath, spanPath: taskSpanPath(traceId, NodeIdSchema.parse(node.id), 1, 1) };
      const ts = new Date(at).toISOString();
      events.push({ ...task, t: "span.started", ts, name: node.label });
      const open = (claimed !== undefined || writeNode !== undefined) && position === reached - 1;
      at += stepMs;
      const last = position === reached - 1 && outcome !== undefined && outcome !== "done";
      if (!open) events.push({ ...task, ...(last && failure !== undefined ? { failureId: failure.failureId } : {}), t: "span.ended",
        ts: new Date(at).toISOString(), outcome: last ? outcome : "done" });
    }
  }
  if (state === "waiting" && gate !== undefined && run.claimGeneration > 0) {
    events.push({ ...common, t: "gate.opened", ts: settledAt, spanPath, gate: gate.id });
  }
  if (run.lifecycle.state === "terminal") {
    const failureRef = failure === undefined ? {} : { failureId: failure.failureId };
    events.push({ ...common, ...failureRef, t: "span.ended", kind: "run", ts: settledAt, spanPath, outcome: run.lifecycle.outcome });
  }
  const write = writeNode === undefined ? undefined : seedParkedWrite({ run, nodeId: writeNode.id, parked, id, at: settledAt });
  return { ...slot, run, failure, write, events: events.map(event => SpanEventWireSchema.parse(event)) };
}

function seedNotifications(runs: readonly ReturnType<typeof seedRun>[], profileId: string, now: Date) {
  const example = (state: SeedState) => {
    const found = runs.find(row => row.state === state);
    if (found === undefined) throw new SeedCopyError(`seed-copy-notification-missing-example: ${state}`);
    return found.run.envelope.runId;
  };
  const links = {
    failed: [{ kind: "run", runId: example("failed") }],
    "gate-waiting": [{ kind: "run", runId: example("waiting") }],
    "write-parked": [{ kind: "run", runId: example("needs-review") }],
    repeating: [{ kind: "run", runId: example("failed") }],
    storage: [{ kind: "storage", diagnosticFingerprint: seedDigest }],
    "verified-done": [{ kind: "run", runId: example("succeeded") }],
    "backfill-gap": [],
    command: [{ kind: "command-result", commandId: deriveStableUuid(seedNamespace, `command/${profileId}`) }],
  } as const;
  const at = new Date(Math.min(now.getTime(), Date.parse(`${searchPartitionDay(now)}T20:00:00.000Z`))).toISOString();
  return NotificationTriggerSchema.options.map(trigger => {
    const key = `notification/${profileId}/${trigger}`;
    const count = trigger === "repeating" ? 3 : 1;
    return NotificationRecordSchema.parse({
      notificationId: deriveStableUuid(seedNamespace, key), actorId: LOCAL_OPERATOR_ACTOR_ID, dedupeFingerprint: sha256Hex(key),
      trigger, channel: trigger === "verified-done" ? "inbox" : "ping", status: "unread", snooze: { state: "not-snoozed" },
      title: `Synthetic ${notificationTitle(trigger)}`, summary: `Synthetic example for ${notificationTitle(trigger).toLowerCase()}.`, links: links[trigger],
      count, lastSeenAt: at, version: count, createdAt: at, updatedAt: at,
    });
  });
}

class SeedCopyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SeedCopyError";
  }
}

async function withStoppedCopy<T>(profile: CopyProfile, work: (admission: RuntimeAdmission) => Promise<T>): Promise<T> {
  const copy = CopyProfileSchema.parse(profile);
  const { applicationDataWorkspace, rebuildRuntimeIsolation, runtimeProfile } = await import("../../src/backend/app/config/runtime-isolation.js");
  const workspace = applicationDataWorkspace(undefined, copy);
  const { lockPort } = runtimeProfiles[copy];
  const { backendPort, frontendPort, lockPort: productionLockPort } = runtimeProfiles.production;
  const productionPorts: readonly number[] = [backendPort, frontendPort, productionLockPort];
  if (runtimeProfile !== copy || workspace === applicationDataWorkspace(undefined, "production")
    || productionPorts.includes(lockPort)) {
    throw new SeedCopyError("seed-copy-target-refused");
  }
  const control = join(workspace, ".tracker", "control");
  const identities = new Map<string, DirectoryIdentity>();
  const assertCopyPaths = () => {
    try {
      noSymlinkAncestry(join(workspace, rebuildRuntimeIsolation.artifactRoot), identities);
      return noSymlinkAncestry(control, identities);
    } catch (cause) { throw new SeedCopyError("seed-copy-target-refused", { cause }); }
  };
  assertCopyPaths();
  const lock = await acquireRuntimeLifetimeLock(lockPort).catch((error: unknown) => {
    if (error instanceof RuntimeAlreadyRunningError) throw new SeedCopyError(`seed-copy-profile-running: stop the ${copy} dashboard`, { cause: error });
    throw error;
  });
  let retain = false;
  try {
    if (!assertCopyPaths() || !lstatSync(join(control, "installation.json"), { throwIfNoEntry: false })?.isFile()) {
      throw new SeedCopyError("seed-copy-signup-required: sign in to the copy and stop its dashboard");
    }
    const { acquireEntrypointAdmission } = await import("../../src/backend/storage/admission/bootstrap-admission.js");
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const { activeProfileId } = machine.readProfileRegistry();
      if (activeProfileId === null) throw new SeedCopyError("seed-copy-signin-required: sign in to the copy and stop its dashboard");
      const admission = machine.admitProfile(activeProfileId);
      try { return await work(admission); }
      finally { admission.release(); }
    } finally { machine.release(); }
  } catch (error) {
    retain = hasUnprovedSourceClosure(error);
    throw error;
  } finally { if (!retain) await lock.close(); }
}

type SeedModule = Readonly<{ descriptor: AnyWorkflowDescriptor }>;

/** The whole generated set for one copy: history, today's live runs and groups, notifications and Sessions cards. */
export function planCopySeed(input: Readonly<{ now: Date; existing: readonly RunRecord[]; modules: readonly SeedModule[];
  capabilities: QueueCapabilities; profileId: string; buildId: string }>) {
  const { now, profileId } = input;
  const descriptors = input.modules.map(({ descriptor }) => descriptor);
  const live = planLiveRuns(now, descriptors.filter(descriptor => workflowSources[descriptor.id] === "served"), input.capabilities, profileId);
  const runs = [...planSeedRuns(now, input.existing, descriptors), ...live.slots].map(slot => seedRun(slot, profileId, now, input.buildId));
  const notifications = seedNotifications(runs, profileId, now);
  const batches = live.batches.map(({ sessionId, workflow }) => {
    const startedAt = runs.find(row => row.run.sessionId === sessionId)?.run.envelope.enqueuedAt;
    if (startedAt === undefined) throw new SeedCopyError("seed-copy-batch-empty");
    return RunSessionRecordSchema.parse({ sessionId, workflow: workflow.id, startedAt, createdAt: startedAt, groupInQueue: true, version: 1,
      origin: { kind: "start-plan", startPlanId: deriveStableUuid(seedNamespace, `plan/${sessionId}`), actorId: LOCAL_OPERATOR_ACTOR_ID } });
  });
  const byState = Object.fromEntries(seedStates.map(state => [state, 0]));
  const todayByState = Object.fromEntries(liveStates.map(state => [state, 0]));
  const byNotificationKind = Object.fromEntries(NotificationTriggerSchema.options.map(kind => [kind, 0]));
  const sessionsByState: Record<string, number> = {};
  for (const row of runs) {
    if ("live" in row) todayByState[row.state] += 1;
    else byState[row.state] += 1;
  }
  for (const { trigger } of notifications) byNotificationKind[trigger] += 1;
  const sessions = live.sessions.map(planned => {
    const workerId = sampleWorkerId(planned.session);
    const run = runs.find(row => row.run.lifecycle.state === "running" && row.run.lifecycle.workerId === workerId);
    sessionsByState[planned.state] = (sessionsByState[planned.state] ?? 0) + 1;
    return { workerId, payload: sampleSession(planned, run?.run.envelope.runId) };
  });
  return { runs, notifications, batches, sessions, counts: { byState, todayByState, sessionsByState, byNotificationKind } };
}

async function seedCopy(profile: CopyProfile) {
  return withStoppedCopy(profile, async admission => {
    const [{ seedIsolatedHistory }, { COPY_HISTORY_SEED_BUILD }, { CHILD_ONLY_WORKFLOW_MODULES, WORKFLOW_MODULES, workflowQueueCapabilities }] = await Promise.all([
      import("../../src/backend/storage/maintenance/isolated-history-import.js"),
      import("../../src/backend/storage/sqlite/isolated-history-store.js"),
      import("../../src/backend/app/registries/workflow-registry.js"),
    ]);
    const now = systemClock.now(), { profileId } = admission.profileBinding;
    const fromDay = dateAtOffset(Date.parse(`${searchPartitionDay(now)}T00:00:00Z`), 89);
    let counts: ReturnType<typeof planCopySeed>["counts"] | undefined;
    const report = await seedIsolatedHistory(admission, profile, { fromDay, build(existing) {
      const plan = planCopySeed({ now, existing, modules: WORKFLOW_MODULES, capabilities: workflowQueueCapabilities, profileId, buildId: COPY_HISTORY_SEED_BUILD });
      counts = plan.counts;
      return plan;
    } });
    const skippedChildOnlyWorkflows = CHILD_ONLY_WORKFLOW_MODULES.map(({ descriptor }) => descriptor.id);
    return { ...report, ...counts, skippedChildOnlyWorkflows };
  });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const selected = z.tuple([CopyProfileSchema]).safeParse(process.argv.slice(2));
  if (!selected.success) {
    process.stderr.write("Usage: tsx scripts/profiles/seed-copy.ts <development|staging>\n");
    process.exitCode = 1;
  } else {
    const [profile] = selected.data;
    process.env[RUNTIME_PROFILE_ENV] = profile;
    try { process.stdout.write(`${JSON.stringify(await seedCopy(profile), null, 2)}\n`); }
    catch (error) {
      const reason = error instanceof SeedCopyError ? error.message
        : error instanceof z.ZodError ? `seed-copy-invalid-data: ${error.issues.map(issue => issue.code).join(", ")}`
        : error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,80}$/u.test(error.code) ? error.code
        : error instanceof Error && /^[a-z-]{5,80}(?:: [a-z_]+)?$/u.test(error.message) ? error.message : "seed-copy-failed";
      process.stderr.write(`${reason}\n`);
      process.exitCode = 1;
    }
  }
}
