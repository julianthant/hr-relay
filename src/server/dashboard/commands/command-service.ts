/**
 * The dashboard command service: the kernel is the ONE command path (D113);
 * this wrapper adds exactly what doc 03 assigns to 1g around it —
 *
 * 1. `run.queued` span emission for every run an applied `start-run` created
 *    (a run is born at ENQUEUE, doc 03 §1.1). Authority commits FIRST inside
 *    the kernel's transaction; the JSONL line follows — the doc's crash gap
 *    ("repairable, never a lost filing") lives between those two steps.
 * 1b. The same emission for every run an applied `enqueue-intake-manifest`
 *    fanned out (D171). A spreadsheet row's run is born at enqueue like any
 *    other, and its title comes from the workflow's OWN presentation over the
 *    manifest's stored `parsedInput` — the manifest is the durable record of
 *    what was enqueued, so the queue rows and the manifest cannot disagree.
 * 2. `gate.resolved` span emission for an applied `resolve-gate`.
 * 3. A projection refresh for applied run-family commands that emit no span
 *    (hide/unhide/rename/bump/cancel change authority presentation/lifecycle
 *    only). The run-span END for a cancelled RUNNING run stays executor-owned
 *    — a second emitter here would double-close the span identity.
 *
 * No transport concern reaches the kernel: this service takes the already
 * schema-recognized command envelope as `unknown` and the kernel does its own
 * exhaustive parse.
 */
import { z } from "zod";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { Clock } from "../../../domain/clock.js";
import { CommandRequestSchema, type CommandResult } from "../../../domain/commands.js";
import type { IntakePlanManifest } from "../../../domain/intake/manifest.js";
import type { IntakeSession } from "../../../domain/intake/session.js";
import { sha256Hex } from "../../../domain/sha256.js";
import type { StartPlanRecord } from "../../../domain/run/start-plan.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { CommandKernel } from "../../../core/command-kernel.js";
import { runSpanPath } from "../../../core/span-emitter.js";
import type { SpanJsonlWriter } from "../../../infra/events/span-jsonl-writer.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";

export interface DashboardCommandServiceDeps {
  readonly kernel: CommandKernel;
  readonly clock: Clock;
  readonly spans: SpanJsonlWriter;
  readonly projection: RunQueueProjection;
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  readonly authorityRead: {
    getRun(runId: string): RunRecord | undefined;
    getStartPlan(startPlanId: string): StartPlanRecord | undefined;
    getIntakeSession(intakeSessionId: string): IntakeSession | undefined;
    getIntakeManifest(manifestId: string): IntakePlanManifest | undefined;
  };
}

export interface DashboardCommandService {
  execute(input: unknown): CommandResult;
}

const SPANLESS_RUN_TYPES = new Set(["hide", "unhide", "rename", "bump", "cancel"]);

export function createDashboardCommandService(deps: DashboardCommandServiceDeps): DashboardCommandService {
  return Object.freeze({
    execute(input: unknown): CommandResult {
      const result = deps.kernel.execute(input);
      if (result.state !== "applied") return result;
      // The kernel already validated the request exhaustively; this re-parse
      // only recovers the typed view the emission step dispatches on.
      const request = CommandRequestSchema.parse(input);

      if (request.family === "start") {
        const plan = deps.authorityRead.getStartPlan(request.target.startPlanId);
        if (plan === undefined) {
          throw new Error(`start plan ${request.target.startPlanId} vanished after its command applied`);
        }
        for (const planned of plan.planned) {
          const run = deps.authorityRead.getRun(planned.runId);
          if (run === undefined) {
            throw new Error(`run ${planned.runId} from applied start plan ${plan.startPlanId} is missing from authority`);
          }
          deps.spans.emit({
            t: "run.queued",
            kind: "run",
            ts: run.envelope.enqueuedAt,
            workflow: run.envelope.workflow,
            runId: run.envelope.runId,
            attempt: run.envelope.attempt,
            traceId: run.envelope.traceId,
            spanPath: runSpanPath(run.envelope.traceId),
            itemId: run.envelope.itemId,
            ...(run.envelope.parent === undefined ? {} : { parentRunId: run.envelope.parent.runId }),
            shape: run.envelope.shape,
            priority: run.envelope.priority,
            dryRun: run.envelope.dryRun,
            ...(run.envelope.retryOf === undefined ? {} : { retryOf: run.envelope.retryOf }),
            actorId: request.requestedBy,
            title: planned.title,
            ...(planned.subtitle === undefined ? {} : { subtitle: planned.subtitle }),
            descriptorVersion: run.envelope.descriptorVersion,
            contractFingerprint: run.envelope.contractFingerprint,
            resolvedInstance: run.envelope.resolvedInstance,
            configFingerprint: run.envelope.configFingerprint,
            configSnapshotId: run.envelope.configSnapshotId,
          });
        }
        return result;
      }

      if (request.family === "intake" && request.type === "enqueue-intake-manifest") {
        const session = deps.authorityRead.getIntakeSession(request.target.intakeSessionId);
        if (session?.intakeManifestId === undefined) {
          throw new Error(
            `intake session ${request.target.intakeSessionId} names no manifest after its enqueue applied`,
          );
        }
        const manifest = deps.authorityRead.getIntakeManifest(session.intakeManifestId);
        if (manifest === undefined) {
          throw new Error(`intake manifest ${session.intakeManifestId} is missing from authority after its enqueue applied`);
        }
        const descriptor = deps.descriptors.resolve(manifest.workflow);
        if (descriptor === undefined) {
          throw new Error(`workflow ${manifest.workflow} vanished from the registry after its intake enqueue applied`);
        }
        const planning = workflowPlanning(descriptor);
        // The join is the ITEM id, which the manifest and the run envelope both
        // carry and which `duplicate-identity` guarantees is unique in a file.
        const enqueued = new Map<string, RunRecord>();
        for (const target of result.affectedTargets) {
          if (target.family !== "run") continue;
          const run = deps.authorityRead.getRun(target.runId);
          if (run === undefined) {
            throw new Error(`run ${target.runId} from applied intake manifest ${manifest.manifestId} is missing from authority`);
          }
          enqueued.set(run.envelope.itemId, run);
        }
        if (enqueued.size !== manifest.validRows.length) {
          throw new Error(
            `intake manifest ${manifest.manifestId} has ${String(manifest.validRows.length)} valid rows but its `
            + `command reported ${String(enqueued.size)} runs; refusing to file a partial fan-out`,
          );
        }
        for (const row of manifest.validRows) {
          const run = enqueued.get(row.itemId);
          if (run === undefined) {
            throw new Error(
              `intake manifest ${manifest.manifestId} source row ${String(row.sourceRow)} (${row.itemId}) has no enqueued run`,
            );
          }
          const subtitle = planning.subtitle(row.parsedInput);
          deps.spans.emit({
            t: "run.queued",
            kind: "run",
            ts: run.envelope.enqueuedAt,
            workflow: run.envelope.workflow,
            runId: run.envelope.runId,
            attempt: run.envelope.attempt,
            traceId: run.envelope.traceId,
            spanPath: runSpanPath(run.envelope.traceId),
            itemId: run.envelope.itemId,
            shape: run.envelope.shape,
            priority: run.envelope.priority,
            dryRun: run.envelope.dryRun,
            actorId: request.requestedBy,
            title: planning.title(row.parsedInput),
            ...(subtitle === undefined ? {} : { subtitle }),
            descriptorVersion: run.envelope.descriptorVersion,
            contractFingerprint: run.envelope.contractFingerprint,
            resolvedInstance: run.envelope.resolvedInstance,
            configFingerprint: run.envelope.configFingerprint,
            configSnapshotId: run.envelope.configSnapshotId,
          });
        }
        return result;
      }

      if (request.family === "gate") {
        const run = deps.authorityRead.getRun(request.target.runId);
        if (run === undefined) {
          throw new Error(`run ${request.target.runId} vanished after its gate command applied`);
        }
        deps.spans.emit({
          t: "gate.resolved",
          ts: deps.clock.now().toISOString(),
          workflow: run.envelope.workflow,
          runId: run.envelope.runId,
          attempt: run.envelope.attempt,
          traceId: run.envelope.traceId,
          spanPath: runSpanPath(run.envelope.traceId),
          gate: request.target.gateId,
          /**
           * The display/audit key, never the decision payload. Until gate
           * descriptors declare display keys (2h Review), the one honest key
           * is the fact of resolution itself.
           */
          resolutionKey: "resolved",
          resultHash: z.string().regex(/^[0-9a-f]{64}$/).parse(
            sha256Hex(`hrauto:gate-resolved-span:v1\0${canonicalJsonStringify(request.payload.result)}`),
          ),
        });
        return result;
      }

      if (request.family === "run" && request.type === "retry") {
        // The kernel minted a NEW run linked by retryOf; it is born at
        // enqueue like any other, so it gets its run.queued span here.
        const newRunTarget = result.affectedTargets.find(
          (target) => target.family === "run" && target.runId !== request.target.runId,
        );
        if (newRunTarget?.family !== "run") {
          throw new Error(`applied retry of ${request.target.runId} reported no new run target`);
        }
        const run = deps.authorityRead.getRun(newRunTarget.runId);
        if (run === undefined) {
          throw new Error(`retry run ${newRunTarget.runId} is missing from authority after its command applied`);
        }
        const original = deps.projection.runFold(request.target.runId);
        if (original === undefined) {
          throw new Error(
            `retry of ${request.target.runId} cannot emit run.queued: the original run has no span fold to carry its title`,
          );
        }
        deps.spans.emit({
          t: "run.queued",
          kind: "run",
          ts: run.envelope.enqueuedAt,
          workflow: run.envelope.workflow,
          runId: run.envelope.runId,
          attempt: run.envelope.attempt,
          traceId: run.envelope.traceId,
          spanPath: runSpanPath(run.envelope.traceId),
          itemId: run.envelope.itemId,
          ...(run.envelope.parent === undefined ? {} : { parentRunId: run.envelope.parent.runId }),
          shape: run.envelope.shape,
          priority: run.envelope.priority,
          dryRun: run.envelope.dryRun,
          retryOf: request.target.runId,
          actorId: request.requestedBy,
          title: original.queued.title,
          ...(original.queued.subtitle === undefined ? {} : { subtitle: original.queued.subtitle }),
          descriptorVersion: run.envelope.descriptorVersion,
          contractFingerprint: run.envelope.contractFingerprint,
          resolvedInstance: run.envelope.resolvedInstance,
          configFingerprint: run.envelope.configFingerprint,
          configSnapshotId: run.envelope.configSnapshotId,
        });
        return result;
      }

      if (request.family === "run" && SPANLESS_RUN_TYPES.has(request.type)) {
        deps.projection.refreshRun(request.target.runId);
      }
      return result;
    },
  });
}
