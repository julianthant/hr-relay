/**
 * The dashboard command service: the kernel is the ONE command path (D113);
 * this wrapper adds exactly what ref dashboard-surfaces assigns to 1g around it —
 *
 * 1. `run.queued` span emission for every run an applied `start-run` created
 *    (a run is born at ENQUEUE, ref dashboard-surfaces §1.1). Authority commits FIRST inside
 *    the kernel's transaction; the JSONL line follows — the doc's crash gap
 *    ("repairable, never a lost filing") lives between those two steps.
 * 1b. The same emission for every run an applied `enqueue-intake-manifest`
 *    fanned out (D171). A spreadsheet row's run is born at enqueue like any
 *    other, and its title comes from the workflow's OWN presentation over the
 *    manifest's stored `parsedInput` — the manifest is the durable record of
 *    what was enqueued, so the queue rows and the manifest cannot disagree.
 * 2. `gate.resolved` span emission for an applied `resolve-gate`.
 * 3. A projection refresh for applied run-family commands that emit no span
 *    (rename/bump/cancel change authority presentation/lifecycle
 *    only). The run-span END for a cancelled RUNNING run stays executor-owned
 *    — a second emitter here would double-close the span identity.
 * 4. After emitting, each arm ticks `projection.ingestFromDisk()` (D218) so
 *    the lines it just appended fold before the response returns — the
 *    operator's follow-up read then already sees the run it was told about.
 *    That is the SAME disk cursor the compose-level poll advances, not a
 *    second ingest path: every event still reaches the fold as bytes read
 *    back from the stream file.
 *
 * No transport concern reaches the kernel: this service takes the already
 * schema-recognized command envelope as `unknown` and the kernel does its own
 * exhaustive parse.
 *
 * 5. D235's BULK arm, which is this same path executed N times. A bulk request
 *    is N real CAS-bound transitions and it is composed as N child commands —
 *    NOT as one transaction spanning every target, and not as a second command
 *    path. Two consequences fall out and both are the point: a child's outcome
 *    is settled by the SAME kernel arm a single press would have reached, so
 *    the refusal vocabulary cannot fork; and a retry in the batch gets its
 *    `run.queued` span from step 4 above, which is the reason the loop runs
 *    through this service and never through the kernel directly.
 */
import { z } from "zod";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { Clock } from "../../../domain/clock.js";
import {
  BulkRunCommandRequestSchema,
  BulkRunCommandResponseSchema,
  CommandRequestSchema,
  type BulkRunCommandOutcome,
  type BulkRunCommandResponse,
  type CommandResult,
} from "../../../domain/commands.js";
import { deriveStableUuid } from "../../../domain/identifiers.js";
import { CommandIdSchema } from "../../../domain/ids.js";
import type { IntakePlanManifest } from "../../../domain/intake/manifest.js";
import type { IntakeSession } from "../../../domain/intake/session.js";
import { sha256Hex } from "../../../domain/sha256.js";
import type { StartPlanRecord } from "../../../domain/run/start-plan.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { CommandKernel } from "../../../core/command-kernel.js";
import { runSpanPath } from "../../../core/span-emitter.js";
import type { SpanJsonlWriter } from "../../../infra/events/span-jsonl-writer.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import { errorText } from "../support.js";
import { TargetNotFoundError } from "../../failures.js";

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
  /**
   * D235: `BulkRunCommandRequest` in, the complete per-run vector out. It never
   * throws for a target's own outcome — a refusal, a conflict and an untyped
   * error are all VALUES the operator has to read — and it never answers with a
   * count.
   */
  executeBulk(input: unknown): BulkRunCommandResponse;
}

/**
 * D235: a child command's id is DERIVED from the bulk id and the run it names,
 * so re-delivering one bulk request replays exactly the same N children rather
 * than filing N new ones. `ids.uuid()` would satisfy the type and break that
 * sentence — D174's lesson, one family over.
 */
const BULK_CHILD_COMMAND_NAMESPACE = "hrauto:bulk-run-child-command:v1";

export function bulkChildCommandId(bulkCommandId: string, runId: string): z.infer<typeof CommandIdSchema> {
  // Parsed rather than asserted: a derivation that stopped producing UUID shape
  // would otherwise reach the kernel's journal as a key nothing can look up.
  return CommandIdSchema.parse(deriveStableUuid(BULK_CHILD_COMMAND_NAMESPACE, `${bulkCommandId}\0${runId}`));
}

/**
 * Applied run commands that emit no span but DO change what the queue row
 * projects, so the projection has to be told. The two ref write-safety §4.1 write
 * resolutions belong here for exactly the reason `cancel` does: they move the
 * run off `parked-write` (to `queued` on absent, to a settled outcome on
 * present) and the row's status is folded from authority. Without the refresh
 * the operator resolves the write and the queue keeps saying `blocked`.
 */
const SPANLESS_RUN_TYPES = new Set([
  "rename", "bump", "cancel",
  "resolve-write-present", "resolve-write-absent",
]);

export function createDashboardCommandService(deps: DashboardCommandServiceDeps): DashboardCommandService {
  function executeOne(input: unknown): CommandResult {
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
        deps.projection.ingestFromDisk();
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
        deps.projection.ingestFromDisk();
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
        deps.projection.ingestFromDisk();
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
          throw new TargetNotFoundError(
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
        deps.projection.ingestFromDisk();
        return result;
      }

      if (request.family === "run" && SPANLESS_RUN_TYPES.has(request.type)) {
        deps.projection.refreshRun(request.target.runId);
      }
      return result;
  }

  return Object.freeze({
    execute: executeOne,

    /**
     * D235's loop. Every refusal below reaches NO target — it is a statement
     * about the request, not about a run — and every per-target answer is a
     * vector entry, because ref dashboard-surfaces §2.4 forbids collapsing a partial result
     * into "Done".
     */
    executeBulk(input: unknown): BulkRunCommandResponse {
      const parsed = BulkRunCommandRequestSchema.safeParse(input);
      if (!parsed.success) {
        // An empty target set lands HERE (`targets` is `.min(1)`), which is the
        // named refusal a zero-eligible selection must get. Answering "applied
        // to 0 runs" would be a bulk command that did nothing and said nothing.
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: `the bulk request does not parse: ${z.prettifyError(parsed.error)}`,
        });
      }
      const request = parsed.data;

      if (request.mode !== "best-effort") {
        /*
         * D235: `all-or-none` is schema-recognized and this runtime does not
         * execute it. One command is one authority transaction here, and a mode
         * that promises "one transaction or none" across N independent runs
         * cannot be honoured by a loop — so it refuses by name rather than
         * running best-effort under an all-or-none label, which would be the
         * surface lying about atomicity it never had. The owner and the trigger
         * are named in ref dashboard-surfaces's bulk section.
         */
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "capability-unavailable",
          message: `bulk mode "${request.mode}" is schema-recognized and unexecuted: one command is one authority `
            + "transaction, so an all-or-none batch would need a kernel arm that spans N commands. Nothing was "
            + "attempted; re-send the batch as best-effort to receive the per-run vector",
        });
      }

      const runIds = request.targets.map(({ runId }) => runId);
      if (new Set(runIds).size !== runIds.length) {
        // Two targets naming one run derive ONE child command id, so the second
        // would replay the first and be reported as applied-by-replay for a
        // transition it never made. Refuse the request instead.
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: "the bulk request names the same run more than once; a run appears at most once in a batch",
        });
      }

      const results: BulkRunCommandOutcome[] = [];
      for (const target of request.targets) {
        const commandId = bulkChildCommandId(request.bulkCommandId, target.runId);
        const child = {
          commandId,
          requestedAt: request.requestedAt,
          requestedBy: request.requestedBy,
          source: request.source,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
          family: "run" as const,
          type: request.type,
          target,
        };
        let result: CommandResult;
        try {
          result = executeOne(child);
        } catch (error) {
          /*
           * An untyped throw is the authority or this service reporting that it
           * cannot answer, not a run refusing. It is REPORTED per run — the
           * message verbatim, never a substituted code — and the pass STOPS:
           * issuing further writes into a system that just failed to answer is
           * the opposite of fail-loud. `requestedCount` on the response is what
           * makes the untried remainder visible.
           */
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: errorText(error) });
          break;
        }
        results.push(
          result.state === "conflict"
            ? {
              outcome: "conflict",
              runId: target.runId,
              commandId,
              currentVersion: result.currentVersion,
              detail: result.message,
            }
            : result.state === "rejected"
              ? { outcome: "refused", runId: target.runId, commandId, code: result.code, detail: result.message }
              : {
                outcome: "applied",
                runId: target.runId,
                commandId,
                replayed: result.state === "already-applied",
                detail: result.state === "already-applied"
                  ? `${request.type} had already been recorded for this run under the same batch`
                  : `${request.type} recorded`,
              },
        );
      }

      return BulkRunCommandResponseSchema.parse({
        state: "vector",
        bulkCommandId: request.bulkCommandId,
        type: request.type,
        requestedCount: request.targets.length,
        results,
      });
    },
  });
}
