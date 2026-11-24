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
import { searchPartitionDay } from "../../src/models/dashboard/search-calendar.js";
import { SpanEventWireSchema } from "../../src/models/events/types.js";
import { NotificationRecordSchema, NotificationTriggerSchema } from "../../src/models/notifications/notifications.js";
import { RunRecordSchema, type RunLifecycle, type RunRecord } from "../../src/models/run/record.js";
import { FailureRecordSchema } from "../../src/models/trust/failure.js";
import { deriveStableUuid, deriveTraceId } from "../../src/rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID, NodeIdSchema } from "../../src/rules/identity/ids.js";
import { capturedInstantClock, systemClock } from "../../src/rules/time/clock.js";
import { sha256Hex } from "../../src/rules/validation/sha256.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../src/workflow-kit/workflow.js";

const CopyProfileSchema = z.enum(["development", "staging"]);
type CopyProfile = z.infer<typeof CopyProfileSchema>;
const seedStates = ["succeeded", "failed", "waiting", "paused", "cancelled", "needs-review"] as const;
type SeedState = typeof seedStates[number];
type SeedSlot = Readonly<{ workflow: AnyWorkflowDescriptor; state: SeedState; day: string }>;
const dayMs = 86_400_000;

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

const seedNamespace = "relay-copy-seed";
const seedDigest = sha256Hex(seedNamespace);

function seedRun(slot: SeedSlot, profileId: string, now: Date, buildId: string) {
  const { workflow, day, state } = slot;
  const key = `${profileId}/${workflow.id}/${day}/${state}`;
  const id = (kind: string) => deriveStableUuid(seedNamespace, `${kind}/${key}`);
  const hash = sha256Hex(key);
  const durationMs = 35_000 + Number.parseInt(hash.slice(0, 4), 16) * 5;
  const minuteOffsetMs = Number.parseInt(hash.slice(8, 12), 16) % 3_600_000;
  const timeMs = Math.min(now.getTime(), Date.parse(`${day}T19:00:00.000Z`) + minuteOffsetMs);
  const enqueuedAt = new Date(timeMs).toISOString();
  const settledAt = new Date(Math.min(now.getTime(), timeMs + durationMs)).toISOString();
  const runId = id("run");
  const traceId = deriveTraceId(workflow.code, runId, capturedInstantClock(enqueuedAt));
  const title = `Synthetic ${workflow.label} ${day} ${state}`;
  const runtimeNodes = descriptorRuntimeNodes(workflow);
  const gate = runtimeNodes.find(node => node.kind === "gate" && node.resolvedBy === "operator");
  const steps = workflow.timeline.flatMap(category => category.nodes);
  const step = steps[Number.parseInt(hash.slice(4, 8), 16) % steps.length];
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
  const lifecycle: z.input<typeof RunRecordSchema>["lifecycle"] = state === "waiting"
    ? { state: "parked-gate", gateId: gate?.id ?? "synthetic-review", resumeAt: step?.id ?? "synthetic-review", parkedAt: settledAt }
    : state === "paused" ? { state: "queued" }
    : { state: "terminal", outcome: outcome[state] satisfies Extract<RunLifecycle, { state: "terminal" }>["outcome"], endedAt: settledAt,
      ...(failure === undefined ? {} : { failureId: failure.failureId, errorSummary: failure.summary }) };
  const run = RunRecordSchema.parse({
    envelope: { runId, workflow: workflow.id, itemId: id("item"), traceId, descriptorVersion: workflow.version,
      contractFingerprint: workflow.contractFingerprint, buildId, configFingerprint: seedDigest,
      configSnapshotId: id("config"), resolvedInstance: {}, shape: "single", priority: "interactive", dryRun: true, attempt: 1, enqueuedAt },
    input: { raw: {}, parsed: { schemaHash: seedDigest, protectedBindings: [], value: {} }, ingressSchemaHash: seedDigest },
    lifecycle, claimGeneration: state === "paused" || state === "cancelled" ? 0 : 1, displayName: title,
    ...(state === "paused" ? { pause: { state: "paused", commandId: id("pause"), requestedAt: settledAt, pausedAt: settledAt } } : {}),
    ...(state === "succeeded" ? { completion: { ...completionFields, kind: "done", resultDigest: seedDigest } } : {}),
    ...(failure === undefined ? {} : { completion: { ...completionFields, kind: "failed", failureId: failure.failureId } }),
    version: 3, createdAt: enqueuedAt, updatedAt: settledAt,
  });
  const spanPath = runSpanPath(run.envelope.traceId);
  const common = { workflow: workflow.id, runId, traceId, attempt: run.envelope.attempt, pid: 1 };
  const events: unknown[] = [{ ...runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title }), pid: 1 }];
  if (run.claimGeneration > 0) events.push({ ...common, t: "run.claimed", workerId: claim.workerId, claimGeneration: 1, ts: enqueuedAt, spanPath });
  if (run.lifecycle.state === "terminal") {
    const { outcome } = run.lifecycle;
    const failureRef = failure === undefined ? {} : { failureId: failure.failureId };
    if (step !== undefined && (outcome === "done" || outcome === "failed")) {
      const task = { ...common, kind: "task", parentSpanPath: spanPath, spanPath: taskSpanPath(traceId, NodeIdSchema.parse(step.id), 1, 1) };
      events.push({ ...task, t: "span.started", ts: enqueuedAt, name: step.label });
      events.push({ ...task, ...failureRef, t: "span.ended", ts: settledAt, outcome });
    }
    events.push({ ...common, ...failureRef, t: "span.ended", kind: "run", ts: settledAt, spanPath, outcome });
  }
  return { ...slot, run, failure, events: SpanEventWireSchema.array().parse(events) };
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

async function seedCopy(profile: CopyProfile) {
  return withStoppedCopy(profile, async admission => {
    const [{ seedIsolatedHistory }, { COPY_HISTORY_SEED_BUILD }, { READABLE_WORKFLOW_MODULES }] = await Promise.all([
      import("../../src/backend/storage/maintenance/isolated-history-import.js"),
      import("../../src/backend/storage/sqlite/isolated-history-store.js"),
      import("../../src/backend/app/registries/workflow-registry.js"),
    ]);
    const now = systemClock.now(), { profileId } = admission.profileBinding;
    const fromDay = dateAtOffset(Date.parse(`${searchPartitionDay(now)}T00:00:00Z`), 89);
    const byState = Object.fromEntries(seedStates.map(state => [state, 0]));
    const byNotificationKind = Object.fromEntries(NotificationTriggerSchema.options.map(kind => [kind, 0]));
    const report = await seedIsolatedHistory(admission, profile, { fromDay, build(existing) {
      const runs = planSeedRuns(now, existing, READABLE_WORKFLOW_MODULES.map(({ descriptor }) => descriptor))
        .map(slot => seedRun(slot, profileId, now, COPY_HISTORY_SEED_BUILD));
      const notifications = seedNotifications(runs, profileId, now);
      for (const { state } of runs) byState[state] += 1;
      for (const { trigger } of notifications) byNotificationKind[trigger] += 1;
      return { runs, notifications };
    } });
    return { ...report, byState, byNotificationKind };
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
