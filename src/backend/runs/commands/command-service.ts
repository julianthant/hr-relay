import { deriveBulkChildCommand, deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";

import { z } from "zod";
import {
  AssistantModelPreferenceCommandRequestSchema,
  BulkRunCommandRequestSchema,
  BulkRunCommandResponseSchema,
  CommandRequestSchema,
  CommandResultSchema,
  needsWorkerCapacity,
  type BulkRunCommandOutcome,
  type BulkRunCommandResponse,
  type CapacityRequest,
  type CommandResult,
  type RunWorkerStartupFailure,
} from "../../../rules/commands/commands.js";
import type { CommandKernel } from "./command-kernel.js";
import type { RunQueueProjection } from "../projections/run-queue-projection.js";
import { errorText } from "../lifecycle/support.js";
import { RunWorkerStartupError, type RunWorkerCapacity } from "./run-worker-capacity.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import type { NotificationInbox } from "../notifications/inbox.js";

export interface DashboardCommandServiceDeps {
  readonly kernel: CommandKernel;
  readonly projection: Pick<RunQueueProjection, "ingestFromTimeline" | "refreshRun">;
  readonly startWorkerCapacity?: RunWorkerCapacity;
  readonly quitAccepted?: () => void;
  readonly commandNotices?: Pick<NotificationInbox, "record">;
}

export interface DashboardCommandService {
  execute(input: unknown): CommandResult;

  submit(input: unknown): Promise<CommandResult>;

  executeBulk(input: unknown): Promise<BulkRunCommandResponse>;
}

// Derive child command IDs from bulk ID and run ID for exact replay.
export { deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";


const SPANLESS_RUN_TYPES = new Set([
  "pause", "resume", "rename", "bump", "cancel", "delete",
  "recheck-write", "resolve-write-absent",
]);

export function createDashboardCommandService(deps: DashboardCommandServiceDeps): DashboardCommandService {
  function executeOne(input: unknown, parentCommandId?: string): CommandResult {
      return projectResult(input, deps.kernel.execute(input, parentCommandId));
  }
  function projectResult(input: unknown, result: CommandResult): CommandResult {
      if (result.state !== "applied") return result;
      // The kernel already validated the request exhaustively; this re-parse
      // only recovers the typed view the emission step dispatches on.
      const request = CommandRequestSchema.parse(input);
      if (request.family === "application") {
        for (const target of request.payload.targets) deps.projection.refreshRun(target.runId);
        return result;
      }

      if (request.family === "start" || (request.family === "intake" && request.type === "enqueue-intake-manifest")
        || (request.family === "run" && (request.type === "retry" || request.type === "recover-run"))) {
        deps.projection.ingestFromTimeline();
        return result;
      }

      if (request.family === "gate" || request.family === "run" && request.type === "resolve-workbook-reference-row") {
        deps.projection.ingestFromTimeline();
        return result;
      }
      if (request.family === "ocr-review") deps.projection.refreshRun(request.target.runId);

      if (request.family === "run" && SPANLESS_RUN_TYPES.has(request.type)) {
        deps.projection.refreshRun(request.target.runId);
      }
      return result;
  }

  // Choose sync or async execution by envelope family; malformed input still reaches kernel validation.
  const WorkerBrowserSniffSchema = z.strictObject({ family: z.literal("worker-browser") }).loose();

  const startTails = new Map<string, Promise<void>>();
  /** One capacity ensure at a time per workflow, so concurrent commands never race a spawn; a `start:` key admits that workflow's Starts one at a time. */
  async function inWorkflowLane<Result>(key: string, work: () => Promise<Result>): Promise<Result> {
    const previous = startTails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>(resolve => { release = resolve; });
    startTails.set(key, current);
    if (previous !== undefined) await previous;
    try { return await work(); }
    finally {
      if (startTails.get(key) === current) startTails.delete(key);
      release();
    }
  }
  async function ensureCapacity(capacity: RunWorkerCapacity, request: CapacityRequest, result: CommandResult): Promise<RunWorkerStartupFailure | undefined> {
    try { await capacity.ensure(request, result); return undefined; }
    catch (error) {
      if (result.state !== "applied" && result.state !== "already-applied") throw error;
      return error instanceof RunWorkerStartupError ? error.failure : {
        state: "unknown", code: "RUN_QUEUED_WORKER_UNAVAILABLE",
        message: ERROR_CATALOG.RUN_QUEUED_WORKER_UNAVAILABLE.text, detail: errorText(error),
      };
    }
  }
  async function submit(input: unknown): Promise<CommandResult> {
    if (AssistantModelPreferenceCommandRequestSchema.safeParse(input).success) return deps.kernel.executeAssistantModelPreference(input);
    if (WorkerBrowserSniffSchema.safeParse(input).success) {
      return deps.kernel.executeWorkerPool(input);
    }
    const parsed = CommandRequestSchema.safeParse(input);
    if (parsed.success && parsed.data.family === "application") {
      const result = executeOne(input);
      if (result.state === "applied" && parsed.data.type === "pause-all-and-quit") deps.quitAccepted?.();
      return result;
    }
    if (!parsed.success) return executeOne(input);
    const request = parsed.data;
    const capacity = deps.startWorkerCapacity;
    const key = needsWorkerCapacity(request) ? capacity?.workflowOf(request) : undefined;
    if (request.family === "start") {
      const start = async () => projectResult(request, await deps.kernel.executeStart(request));
      // Starts of one workflow still admit one at a time, so their preflights never overlap; only capacity leaves the reply.
      const result = key === undefined ? await start() : await inWorkflowLane(`start:${key}`, start);
      if (capacity === undefined || key === undefined || (result.state !== "applied" && result.state !== "already-applied")) return result;
      // Start replies once its run is committed; a startup that fails later shows on the workflow's worker cards.
      capacity.detach(inWorkflowLane(key, () => capacity.ensure(request, result)));
      return result;
    }
    if (capacity === undefined || key === undefined || !needsWorkerCapacity(request)) return executeOne(request);
    return inWorkflowLane(key, async () => {
      const result = executeOne(request);
      if (result.state !== "applied" && result.state !== "already-applied") return result;
      const workerStartup = await ensureCapacity(capacity, request, result);
      return workerStartup === undefined ? result : CommandResultSchema.parse({ ...result, workerStartup });
    });
  }

  return Object.freeze({
    execute: executeOne,
    submit,

    // Whole-request refusals reach no target; each target outcome remains a separate vector entry.
    async executeBulk(input: unknown): Promise<BulkRunCommandResponse> {
      const parsed = BulkRunCommandRequestSchema.safeParse(input);
      if (!parsed.success) {

        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: `the bulk request does not parse: ${z.prettifyError(parsed.error)}`,
        });
      }
      const request = parsed.data;

      const runIds = request.targets.map(({ runId }) => runId);
      if (new Set(runIds).size !== runIds.length) {
        // Repeated run targets would replay one child ID and falsely claim two independent outcomes.
        return BulkRunCommandResponseSchema.parse({
          state: "refused",
          code: "schema-mismatch",
          message: "the bulk request names the same run more than once; a run appears at most once in a batch",
        });
      }

      const results: BulkRunCommandOutcome[] = [];
      const queued = new Map<string, { child: CapacityRequest; result: CommandResult }>(), workflowOfRun = new Map<string, string>();
      for (const target of request.targets) {
        const commandId = deriveBulkChildCommandId(request.bulkCommandId, target.runId);
        const child = deriveBulkChildCommand(request, target);
        let result: CommandResult;
        try {
          result = executeOne(child, request.bulkCommandId);
          const typed = CommandRequestSchema.parse(child);
          if (deps.startWorkerCapacity !== undefined && (result.state === "applied" || result.state === "already-applied") && needsWorkerCapacity(typed)) {
            const workflow = deps.startWorkerCapacity.workflowOf(typed);
            if (workflow !== undefined) {
              workflowOfRun.set(target.runId, workflow);
              if (!queued.has(workflow)) queued.set(workflow, { child: typed, result });
            }
          }
        } catch (error) {
          // Report an untyped throw per run and continue the remaining targets; it is not a target refusal.
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: errorText(error) });
          break;
        }
        if (result.state === "rejected" && result.code === "bulk-child-errored") {
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: result.message });
          break;
        }
        if (result.state === "pending" || result.state === "confirmation-required") {
          results.push({ outcome: "errored", runId: target.runId, commandId, detail: "Command has no terminal outcome; retain its original identity." });
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

      const capacity = deps.startWorkerCapacity;
      if (capacity !== undefined) for (const [workflow, { child, result }] of queued) {
        const workerStartup = await inWorkflowLane(workflow, () => ensureCapacity(capacity, child, result));
        if (workerStartup === undefined) continue;
        for (const [index, outcome] of results.entries()) {
          if (outcome.outcome === "applied" && workflowOfRun.get(outcome.runId) === workflow) results[index] = { ...outcome, workerStartup };
        }
      }
      if (results.length < request.targets.length || results.some(result => result.outcome !== "applied")) {
        const count = (outcome: string) => results.filter(result => result.outcome === outcome).length;
        const parts = [[count("applied"), "applied"], [count("conflict"), count("conflict") === 1 ? "conflict" : "conflicts"], [count("refused"), "refused"], [count("errored"), "failed"],
          [request.targets.length - results.length, "not attempted"]].filter(([n]) => n !== 0).map(([n, label]) => `${n} ${label}`);
        deps.commandNotices?.record({ kind: "bulk-incomplete", bulkCommandId: request.bulkCommandId, summary: parts.join(" · ") });
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
