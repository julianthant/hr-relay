import { assertStoppedProfileBrowsersClosed, type ProfileBrowserClosure } from "../../storage/maintenance/profile-inventory.js";

import { resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import { FingerprintSchema, RunIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { SpanEventWireSchema } from "../../../models/events/types.js";
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import { RecoveryStopProofStore } from "../../storage/sqlite/recovery-stop-proof.js";
import { StoppedSystemProofSchema } from "../../storage/sqlite/recovery-contracts.js";
import {
  acquireRuntimeRestoreAdmission,
  observeRuntimeLockSnapshot,
  type RestoreAdmissionHandle,
} from "../../storage/sqlite/runtime-process-locks.js";
import { runQueuedSpanEvent } from "../commands/run-queued-span.js";

const NonNegativeIntSchema = z.number().int().nonnegative();

const SpanRootRepairRequestSchema = z.strictObject({
  runId: RunIdSchema,
  stoppedSystemProof: StoppedSystemProofSchema,
});

const SpanRootRepairReportSchema = z.strictObject({
  state: z.enum(["repaired", "already-repaired"]),
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  eventId: z.uuid(),
  repairedAt: z.iso.datetime({ offset: true }),
  sourceAuthorityGeneration: NonNegativeIntSchema,
  sourceAuthorityFingerprint: FingerprintSchema,
  priorCursor: NonNegativeIntSchema,
});
export type SpanRootRepairReport = z.infer<typeof SpanRootRepairReportSchema>;

const OfflineSpanRootRepairOptionsSchema = z.strictObject({
  stateRoot: z.string().min(1),
  authorityPath: z.string().min(1),
  processLockRoot: z.string().min(1),
  stoppedProofMaxAgeMs: z.number().int().positive(),
  busyTimeoutMs: z.number().int().positive(),
});

type AdmissionFactory = (
  input: Readonly<{ processLockRoot: string; pid: number }>,
  clock: Clock,
) => RestoreAdmissionHandle;

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function withoutProcessRepairFields(event: z.infer<typeof SpanEventWireSchema>): unknown {
  const { pid: _pid, repair: _repair, ...identity } = event as z.infer<typeof SpanEventWireSchema> & {
    readonly repair?: unknown;
  };
  return identity;
}

export class OfflineSpanRootRepairService {
  readonly #browserClosure: ProfileBrowserClosure;
  readonly #runtimeAdmission: RuntimeAdmission;
  readonly #authorityPath: string;
  readonly #processLockRoot: string;
  readonly #busyTimeoutMs: number;
  readonly #clock: Clock;
  readonly #proofs: RecoveryStopProofStore;
  readonly #admissionFactory: AdmissionFactory;
  readonly #pid: number;

  constructor(
    browserClosure: ProfileBrowserClosure,
    runtimeAdmission: RuntimeAdmission,
    input: unknown,
    clock: Clock = systemClock,
    admissionFactory: AdmissionFactory = acquireRuntimeRestoreAdmission,
    pid: number = process.pid,
  ) {
    this.#browserClosure = browserClosure;
    this.#runtimeAdmission = requireRuntimeAdmission(runtimeAdmission);
    this.#runtimeAdmission.assertExclusive();
    const options = OfflineSpanRootRepairOptionsSchema.parse(input);
    this.#authorityPath = resolve(options.authorityPath);
    this.#processLockRoot = resolve(options.processLockRoot);
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#clock = clock;
    this.#admissionFactory = admissionFactory;
    this.#pid = z.number().int().positive().parse(pid);
    this.#proofs = new RecoveryStopProofStore({
      processLockRoot: this.#processLockRoot,
      maxProofAgeMs: options.stoppedProofMaxAgeMs,
    }, clock);
  }

  repair(input: unknown): SpanRootRepairReport {
    const request = SpanRootRepairRequestSchema.parse(input);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(this.#authorityPath);
    const admission = this.#admissionFactory({
      processLockRoot: this.#processLockRoot,
      pid: this.#pid,
    }, this.#clock);
    try {
      const liveSnapshot = observeRuntimeLockSnapshot({
        processLockRoot: this.#processLockRoot,
        sourceDatabaseIdentity,
      }, this.#clock);
      this.#proofs.consumeAgainstLiveSnapshot(request.stoppedSystemProof, liveSnapshot);
      assertStoppedProfileBrowsersClosed(this.#runtimeAdmission,this.#clock,this.#browserClosure);

      const before = AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(
        this.#runtimeAdmission,
        this.#authorityPath,
        this.#busyTimeoutMs,
      );
      const database = AuthorityDatabase.open(this.#runtimeAdmission, {
        path: this.#authorityPath,
        busyTimeoutMs: this.#busyTimeoutMs,
        migrationOwner: "span-root-repair",
      }, this.#clock);
      try {
        return database.withAuthorityTransaction(() => {
        const run = database.authority.runs.get(request.runId);
        if (run === undefined) throw new Error(`span root repair run ${request.runId} does not exist`);
        if (run.sessionId === undefined) {
          throw new Error(`span root repair run ${request.runId} has no durable run session`);
        }
        const session = database.authority.runSessions.get(run.sessionId);
        if (session === undefined) throw new Error(`span root repair run ${request.runId} names a missing run session`);
        if (session.origin.kind !== "start-plan") {
          throw new Error(`span root repair run ${request.runId} was not started from a start plan`);
        }
        const plan = database.authority.startPlans.get(session.origin.startPlanId);
        if (plan === undefined) throw new Error(`span root repair run ${request.runId} names a missing start plan`);
        if (plan.consumedBy === undefined) {
          throw new Error(`span root repair run ${request.runId} names an unconsumed start plan`);
        }
        const command=database.authority.commands.get(plan.consumedBy.commandId);
        const audit=database.authority.commandAudits.findByCommand(plan.consumedBy.commandId);
        if(command===undefined || command.family!=="start" || command.type!=="start-run"
          || command.target.startPlanId!==plan.startPlanId || command.target.workflowId!==plan.workflowId
          || command.target.expectedVersion!==plan.version-1
          || command.payload.descriptorFingerprint!==plan.descriptorFingerprint || command.payload.configFingerprint!==plan.configFingerprint
          || command.payload.ingressSchemaHash!==plan.ingressSchemaHash || command.payload.canonicalInputSchemaHash!==plan.canonicalInputSchemaHash
          || command.payload.inputFingerprint!==plan.inputFingerprint || command.requestedBy!==session.origin.actorId
          || audit===undefined || !sameJson(audit.request,command) || audit.completedAt!==plan.consumedBy.consumedAt
          || audit.result.state!=="applied" || !audit.result.affectedTargets.some(target=>target.family==="run" && target.runId===request.runId) || !audit.versionChanges.some(change=>change.target.family==="run"
            && change.target.runId===request.runId && change.before===0 && change.after===1)) {
          throw new Error(`span root repair run ${request.runId} has no exact settled start command owner`);
        }
        const matches = plan.planned.filter((candidate) => candidate.itemId===run.envelope.itemId
          && sameJson(candidate.rawInput,run.input.raw) && sameJson(candidate.input,run.input.parsed));
        if (matches.length !== 1 || matches[0] === undefined) {
          throw new Error(
            `span root repair run ${request.runId} has ${String(matches.length)} matching planned entries; exactly one is required`,
          );
        }
        const planned = matches[0];
        const envelope = run.envelope;
        const bindings = [
          ["workflow", session.workflow, envelope.workflow],
          ["session start", session.startedAt, envelope.enqueuedAt],
          ["plan workflow", plan.workflowId, envelope.workflow],
          ["planned item", planned.itemId, envelope.itemId],
          ["descriptor version", plan.descriptorVersion, envelope.descriptorVersion],
          ["descriptor fingerprint", plan.descriptorFingerprint, envelope.contractFingerprint],
          ["config fingerprint", plan.configFingerprint, envelope.configFingerprint],
          ["config snapshot", plan.configSnapshotId, envelope.configSnapshotId],
          ["shape", plan.shape, envelope.shape],
          ["priority", plan.priority, envelope.priority],
          ["dry-run", plan.dryRun, envelope.dryRun],
          ["actor", plan.plannedBy, session.origin.actorId],
        ] as const;
        const mismatch = bindings.find(([, left, right]) => !sameJson(left, right));
        if (mismatch !== undefined) {
          throw new Error(`span root repair run ${request.runId} disagrees with its ${mismatch[0]} authority`);
        }
        if (!sameJson(plan.resolvedInstance, envelope.resolvedInstance)
          || !sameJson(planned.rawInput, run.input.raw)
          || !sameJson(planned.input, run.input.parsed)) {
          throw new Error(`span root repair run ${request.runId} disagrees with its planned input or instance authority`);
        }
        const queued = runQueuedSpanEvent({
          run,
          actorId: session.origin.actorId,
          title: planned.title,
          ...(planned.subtitle === undefined ? {} : { subtitle: planned.subtitle }),
        });
        const after = database.getMeta();
        if (before.authorityGeneration !== after.authorityGeneration) {
          throw new Error("timeline root repair authority changed during reconstruction");
        }
        const history = readTimelineRecords(database.authority.timelineEvents, 0, request.runId);
        const roots = history.records.filter((row) => row.payload.kind === "span" && row.payload.event.t === "run.queued");
        const expectedIdentity = withoutProcessRepairFields(SpanEventWireSchema.parse({ ...queued, pid: this.#pid }));
        if (roots.length > 0) {
          const row = roots[0];
          const root = row?.payload.kind === "span" ? row.payload.event : undefined;
          if (roots.length === 1 && root?.t === "run.queued"
            && root.repair?.kind === "timeline-authority-reconstruction"
            && sameJson(withoutProcessRepairFields(root), expectedIdentity)) {
            const { kind: _kind, ...evidence } = root.repair;
            return SpanRootRepairReportSchema.parse({ state: "already-repaired", runId: request.runId,
              workflow: root.workflow, eventId: row?.eventId, ...evidence });
          }
          throw new Error(`span root repair run ${request.runId} already has ${String(roots.length)} queue root(s)`);
        }
        if (history.records.length === 0) throw new Error(`span root repair run ${request.runId} has no timeline events to recover around`);
        const now = this.#clock.now();
        const repair = { kind: "timeline-authority-reconstruction" as const,
          repairedAt: now.toISOString(), sourceAuthorityGeneration: before.authorityGeneration,
          sourceAuthorityFingerprint: before.authorityContentFingerprint, priorCursor: history.cursor };
        const eventId = lifecycleCommandId("timeline-root-repair", request.runId);
        database.authority.timelineEvents.append({ schemaVersion: 1, eventId,
          workflow: queued.workflow, scope: { kind: "run", runId: request.runId },
          occurredAt: queued.ts, recordedAt: repair.repairedAt, retentionDate: localDatePart(now),
          payload: { kind: "span", event: { ...queued, pid: this.#pid, repair } }, source: { kind: "native" } });
        const { kind: _kind, ...evidence } = repair;
        return SpanRootRepairReportSchema.parse({ state: "repaired", runId: request.runId,
          workflow: queued.workflow, eventId, ...evidence });
        });
      } finally { database.close(); }
    } finally {
      admission.release();
    }
  }
}
